import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeAdapterSpec,
  rejectStreamBackendEntry,
  createLlmAdapterRegistration,
} from '../lib/llm-adapter-registration.js'
import {
  LlmAdaptersValidationError,
  LlmAdaptersConflictError,
  LlmAdaptersUnavailableError,
  LlmAdaptersOwnerConflictError,
} from '../lib/errors.js'

const isFrozenDeep = (value) => {
  if (value === null || typeof value !== 'object') return true
  if (!Object.isFrozen(value)) return false
  return Object.values(value).every((child) => child === null || typeof child !== 'object' || isFrozenDeep(child))
}

const makeSpec = (overrides = {}) => ({
  provider: 'vision-x',
  models: [{ model: 'vision-x-large', inputModalities: ['image'] }],
  stream: async function* () { yield { delta: 'ok' } },
  ...overrides,
})

/**
 * Minimal official llm runtime mock honoring the official registerAdapter
 * contract: all-or-nothing route commit, providerInfo validation,
 * DUPLICATE_ADAPTER, dispose revokes routes and emits the official change
 * event (the facade must never emit a second one).
 */
function createOfficialLlm() {
  const routes = new Map()
  const adapters = new Map()
  const counts = { updated: 0 }
  const fail = (message) => Object.assign(new Error(message), { name: 'LlmError' })
  const llm = {
    registerAdapter(providers, adapter) {
      if (!Array.isArray(providers) || providers.length === 0) throw fail('an adapter must register at least one provider')
      const claimed = []
      for (const provider of providers) {
        if (typeof provider !== 'string' || provider.length === 0) throw fail('adapter provider names must be non-empty')
        if (routes.has(provider)) throw fail(`an adapter for provider "${provider}" is already registered`)
        const info = adapter.providerInfo(provider)
        if (info?.id !== provider || typeof info?.name !== 'string' || info.name.length === 0) {
          throw fail(`adapter metadata for provider "${provider}" must preserve its id and have a non-empty name`)
        }
        claimed.push(provider)
      }
      for (const provider of claimed) {
        routes.set(provider, { id: provider, name: adapter.providerInfo(provider).name, adapter })
        adapters.set(provider, adapter)
      }
      let released = false
      const dispose = () => {
        if (released) return
        released = true
        for (const provider of claimed) {
          routes.delete(provider)
          adapters.delete(provider)
        }
        counts.updated += 1
      }
      const handle = () => dispose()
      handle.replace = (next) => {
        if (released) throw fail('a disposed adapter registration cannot replace its routes')
        for (const provider of claimed) routes.set(provider, { id: provider, name: adapter.providerInfo(provider).name, adapter })
      }
      return handle
    },
  }
  return { llm, routes, adapters, counts }
}

function createCallerCtx({ owner = 'plugin-a' } = {}) {
  const effects = []
  return {
    owner,
    effects,
    effect(fn) { effects.push(fn) },
    teardown() { for (const fn of effects.splice(0)) fn()() },
  }
}

function createRegistration({ llm, ownerOf } = {}) {
  const resolved = llm ?? createOfficialLlm()
  const instance = createLlmAdapterRegistration({
    active: () => true,
    llmProvider: () => (llm === undefined ? resolved.llm : llm),
    ownerOf: ownerOf ?? ((callerCtx) => callerCtx?.owner ?? 'plugin-a'),
    facadeOwnerIds: new Set(['@deepseek-ai/dsh-plugin-api-main']),
  })
  return { instance, ...resolved }
}

test('normalizeAdapterSpec keeps the plain-object contract without SDK base classes', () => {
  const stream = async function* () {}
  const normalized = normalizeAdapterSpec(makeSpec({ stream }))
  assert.equal(normalized.provider, 'vision-x')
  assert.equal(normalized.stream, stream)
  assert.equal(normalized.models.length, 1)
  assert.equal(normalized.models[0].model, 'vision-x-large')
  assert.deepEqual(normalized.models[0].inputModalities, ['image'])
  assert.ok(isFrozenDeep(normalized.models))
})

test('normalizeAdapterSpec rejects foreign-entry specs with typed cross-references', () => {
  // decoration vocabulary → decorations entry
  assert.throws(
    () => normalizeAdapterSpec({ provider: 'p', models: [{ model: 'm' }], labels: { tone: 'fast' } }),
    (error) => error instanceof LlmAdaptersValidationError && /llm\.adapters\.decorations\.register/.test(error.message),
  )
  // discovery vocabulary → models entry
  assert.throws(
    () => normalizeAdapterSpec({ provider: 'p', models: [{ model: 'm' }], discover: () => {} }),
    (error) => error instanceof LlmAdaptersValidationError && /llm\.models\.register/.test(error.message),
  )
  // directory vocabulary → providers entry
  assert.throws(
    () => normalizeAdapterSpec({ provider: 'p', models: [{ model: 'm' }], settingsNs: 'ns', displayName: 'X' }),
    (error) => error instanceof LlmAdaptersValidationError && /llm\.providers\.register/.test(error.message),
  )
  // missing stream without any foreign vocabulary is still a base validation
  assert.throws(
    () => normalizeAdapterSpec({ provider: 'p', models: [{ model: 'm' }] }),
    (error) => error instanceof LlmAdaptersValidationError && /stream/.test(error.message),
  )
  assert.throws(() => normalizeAdapterSpec({ provider: '', models: [{ model: 'm' }], stream() {} }), LlmAdaptersValidationError)
  assert.throws(() => normalizeAdapterSpec({ provider: 'p', models: [], stream() {} }), LlmAdaptersValidationError)
  assert.throws(() => normalizeAdapterSpec({ provider: 'p', models: ['bare'], stream() {} }), LlmAdaptersValidationError)
})

test('rejectStreamBackendEntry guards the directory and discovery entries', () => {
  assert.throws(
    () => rejectStreamBackendEntry({ provider: 'p', stream() {} }, 'llm.providers.register'),
    (error) => error instanceof LlmAdaptersValidationError && /llm\.adapters\.register/.test(error.message),
  )
  assert.doesNotThrow(() => rejectStreamBackendEntry({ provider: 'p', displayName: 'X' }, 'llm.providers.register'))
  assert.doesNotThrow(() => rejectStreamBackendEntry(null, 'llm.models.register'))
})

test('register binds the official action and returns the fixed-shape handle', () => {
  const { instance, routes, counts } = createRegistration()
  const callerCtx = createCallerCtx()
  const handle = instance.register(makeSpec(), callerCtx)
  assert.deepEqual(
    { id: handle.id, ownerId: handle.ownerId, generation: handle.generation },
    { id: 'vision-x', ownerId: 'plugin-a', generation: 1 },
  )
  assert.equal(typeof handle.dispose, 'function')
  assert.ok(Object.isFrozen(handle))
  assert.ok(routes.has('vision-x'), 'route committed through the official action')
  assert.equal(counts.updated, 0, 'registration itself is not a revocation event')
})

test('registered stream implementation is the backend actually invoked', async () => {
  const { instance, adapters } = createRegistration()
  const seen = []
  const handle = instance.register(makeSpec({
    stream: async function* (options) { seen.push(options); yield { delta: 'from-impl' } },
  }), createCallerCtx())
  assert.ok(adapters.has('vision-x'))
  const chunks = []
  for await (const chunk of adapters.get('vision-x').stream({ model: 'vision-x-large' })) chunks.push(chunk)
  assert.deepEqual(seen, [{ model: 'vision-x-large' }])
  assert.deepEqual(chunks, [{ delta: 'from-impl' }])
  assert.equal(typeof handle.dispose, 'function')
})

test('official registration rejection surfaces as typed validation', () => {
  // An official seam that rejects the commit (any LlmError-class failure)
  // must surface as typed validation with the official reason preserved.
  const rejectingLlm = {
    registerAdapter() {
      throw Object.assign(new Error('an adapter for provider "vision-x" is already registered'), { name: 'LlmError' })
    },
  }
  const { instance } = createRegistration({ llm: rejectingLlm })
  assert.throws(
    () => instance.register(makeSpec(), createCallerCtx()),
    (error) => error instanceof LlmAdaptersValidationError && /already registered/.test(error.message),
  )
})

test('providerName flows through the official providerInfo contract', () => {
  const { instance, routes } = createRegistration()
  instance.register(makeSpec({ providerName: 'Vision X (image variants)' }), createCallerCtx())
  assert.equal(routes.get('vision-x').name, 'Vision X (image variants)')
})

test('owner derivation failure is typed unavailable', () => {
  const { instance } = createRegistration({ ownerOf: () => undefined })
  assert.throws(() => instance.register(makeSpec(), createCallerCtx()), LlmAdaptersUnavailableError)
})

test('same-owner same-content re-registration is idempotent', () => {
  const { instance, adapters, counts } = createRegistration()
  const callerCtx = createCallerCtx()
  const first = instance.register(makeSpec(), callerCtx)
  const officialCalls = adapters.size
  const second = instance.register(makeSpec(), callerCtx)
  assert.equal(second.generation, first.generation)
  assert.equal(second.id, first.id)
  assert.equal(adapters.size, officialCalls, 'no second official registration')
  assert.equal(counts.updated, 0)
})

test('same-owner different content without replace is a typed conflict', () => {
  const { instance, adapters } = createRegistration()
  const callerCtx = createCallerCtx()
  instance.register(makeSpec(), callerCtx)
  assert.throws(
    () => instance.register(makeSpec({ models: [{ model: 'vision-x-small' }] }), callerCtx),
    (error) => error instanceof LlmAdaptersConflictError && /replace/.test(error.message),
  )
  assert.ok(adapters.has('vision-x'), 'existing registration untouched')
})

test('CAS replace atomically swaps the implementation record', async () => {
  const { instance, adapters, counts } = createRegistration()
  const callerCtx = createCallerCtx()
  const first = instance.register(makeSpec({
    stream: async function* () { yield { delta: 'old' } },
  }), callerCtx)

  const swapped = instance.register(makeSpec({
    stream: async function* () { yield { delta: 'new' } },
  }), callerCtx, { replace: 1 })
  assert.equal(swapped.generation, 2, 'generation advanced by the swap')
  assert.equal(counts.updated, 0, 'a facade CAS swap emits no synthetic change event')

  const chunks = []
  for await (const chunk of adapters.get('vision-x').stream({})) chunks.push(chunk)
  assert.deepEqual(chunks, [{ delta: 'new' }], 'new selections use the new implementation')
})

test('CAS replace with a mismatched generation is a typed stale conflict and swaps nothing', async () => {
  const { instance, adapters } = createRegistration()
  const callerCtx = createCallerCtx()
  instance.register(makeSpec({ stream: async function* () { yield { delta: 'old' } } }), callerCtx)
  assert.throws(
    () => instance.register(makeSpec({ stream: async function* () { yield { delta: 'new' } } }), callerCtx, { replace: 99 }),
    (error) => error instanceof LlmAdaptersConflictError && /99/.test(error.message),
  )
  const chunks = []
  for await (const chunk of adapters.get('vision-x').stream({})) chunks.push(chunk)
  assert.deepEqual(chunks, [{ delta: 'old' }], 'nothing was swapped')
})

test('cross-owner registration is a deterministic owner conflict', () => {
  const { instance } = createRegistration()
  instance.register(makeSpec(), createCallerCtx({ owner: 'plugin-a' }))
  assert.throws(
    () => instance.register(makeSpec(), createCallerCtx({ owner: 'plugin-b' })),
    (error) => error instanceof LlmAdaptersOwnerConflictError && /another owner/.test(error.message),
  )
})

test('dispose revokes the route and is idempotent with a typed stale no-op', () => {
  const { instance, routes, counts } = createRegistration()
  const handle = instance.register(makeSpec(), createCallerCtx())
  const outcome = handle.dispose()
  assert.deepEqual({ ...outcome }, { ok: true, code: 'revoked' })
  assert.equal(routes.has('vision-x'), false, 'route revoked from future selection')
  assert.equal(counts.updated, 1, 'exactly one official revocation event')

  const stale = handle.dispose()
  assert.equal(stale.code, 'stale')
  assert.equal(counts.updated, 1, 'stale disposal does not emit a second event')

  const rows = instance.list()
  assert.equal(rows.some((row) => row.id === 'vision-x'), false, 'catalog projection stops listing it')
})

test('a stale disposer never revokes a newer generation', async () => {
  const { instance, adapters } = createRegistration()
  const callerCtx = createCallerCtx()
  const old = instance.register(makeSpec({ stream: async function* () { yield { delta: 'old' } } }), callerCtx)
  const next = instance.register(makeSpec({ stream: async function* () { yield { delta: 'new' } } }), callerCtx, { replace: 1 })
  assert.equal(next.generation, 2)

  const outcome = old.dispose()
  assert.equal(outcome.code, 'stale', 'old-generation disposer is a typed no-op')
  const chunks = []
  for await (const chunk of adapters.get('vision-x').stream({})) chunks.push(chunk)
  assert.deepEqual(chunks, [{ delta: 'new' }], 'newer generation registration survives')
})

test('caller fiber teardown disposes the identity-bound registration', () => {
  const { instance, routes } = createRegistration()
  const callerCtx = createCallerCtx()
  instance.register(makeSpec(), callerCtx)
  assert.ok(routes.has('vision-x'))
  callerCtx.teardown()
  assert.equal(routes.has('vision-x'), false)
})

test('list is a frozen snapshot with honest availability', () => {
  const official = createOfficialLlm()
  let llmAlive = true
  const instance = createLlmAdapterRegistration({
    active: () => true,
    llmProvider: () => (llmAlive ? official.llm : null),
    ownerOf: (callerCtx) => callerCtx?.owner ?? 'plugin-a',
  })
  instance.register(makeSpec(), createCallerCtx())
  const rows = instance.list()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].availability, 'active')
  assert.deepEqual(rows[0].models[0].inputModalities, ['image'])
  assert.ok(isFrozenDeep(rows), 'snapshot is deep frozen')

  llmAlive = false
  const degraded = instance.list()
  assert.equal(degraded[0].availability, 'unavailable', 'degraded backing is marked honestly')
})

test('register is typed unavailable when the official seam is absent; list stays honest', () => {
  const { instance } = createRegistration({ llm: null })
  assert.throws(() => instance.register(makeSpec(), createCallerCtx()), LlmAdaptersUnavailableError)
  const rows = instance.list()
  assert.equal(rows.length, 0)
  assert.ok(Object.isFrozen(rows))
})

test('an in-flight stream runs to natural completion across revocation', async () => {
  const { instance, adapters } = createRegistration()
  const callerCtx = createCallerCtx()
  const handle = instance.register(makeSpec({
    stream: async function* () { yield { delta: 'a' }; yield { delta: 'b' }; yield { delta: 'c' } },
  }), callerCtx)
  const iterator = adapters.get('vision-x').stream({})[Symbol.asyncIterator]()
  const first = await iterator.next()

  // revoke while the stream is open
  assert.deepEqual({ ...handle.dispose() }, { ok: true, code: 'revoked' })
  assert.equal(adapters.has('vision-x'), false)

  // the already-open stream keeps pulling from its captured generator
  const rest = []
  for (;;) {
    const { value, done } = await iterator.next()
    if (done) break
    rest.push(value)
  }
  assert.deepEqual([first.value, ...rest].map((chunk) => chunk.delta), ['a', 'b', 'c'])
})
