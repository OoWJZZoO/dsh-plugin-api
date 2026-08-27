import test from 'node:test'
import assert from 'node:assert/strict'
import { LlmRuntime } from '../lib/forked-runtime.js'
import { attachDecorationRegistry, DecorationRegistrationStatus } from '../lib/decoration-registry.js'

/**
 * Runtime + attached decoration registry harness for the registration surface
 * and chain-building tests. Mirrors the harness in contract-fidelity.test.mjs.
 */
function createHarness() {
  const listeners = new Map()
  const warns = []
  const ctx = {
    reflect: {
      provide(name, instance) {
        ctx[name] = instance
      },
    },
    logger: {
      warn(message) {
        warns.push(message)
      },
    },
    events: {
      dispatch(mode, [name]) {
        return [...(listeners.get(name) ?? [])]
      },
    },
    waterfall(self, name, arg, callback) {
      return callback()
    },
    effect(fn) {
      const iterator = fn()
      let cleanup = () => {}
      let result
      while (!(result = iterator.next()).done) {
        if (typeof result.value === 'function') cleanup = result.value
      }
      let released = false
      return () => {
        if (released) return
        released = true
        cleanup()
      }
    },
    on(name, listener) {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      return () => {
        const index = list.indexOf(listener)
        if (index >= 0) list.splice(index, 1)
      }
    },
    emit(name) {
      for (const listener of listeners.get(name) ?? []) listener()
    },
  }
  return { ctx, listeners, warns }
}

function makeAdapter({ streamImpl } = {}) {
  return {
    providerInfo(provider) {
      return { id: provider, name: provider }
    },
    providerRetryPolicy() {},
    async listModels(provider) {
      return [{ provider, id: `${provider}-m1`, name: 'Model 1' }]
    },
    async resolveModel(provider, model) {
      return { provider, id: model, name: 'Model 1' }
    },
    stream(options) {
      if (streamImpl) return streamImpl(options)
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: 'ok' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

function setup({ providers = [] } = {}) {
  const { ctx, listeners, warns } = createHarness()
  const runtime = new LlmRuntime(ctx)
  const attached = attachDecorationRegistry(runtime, { logger: ctx.logger })
  const handles = providers.map((provider) => runtime.registerAdapter([provider], makeAdapter()))
  return { ctx, listeners, warns, runtime, attached, facet: attached.facet, registry: attached.registry, handles }
}

const def = (overrides = {}) => ({
  id: 'metrics',
  match: () => true,
  priority: 'normal',
  capabilities: { execution: { phases: ['stream'], retry: 'none' } },
  wrap: async function* (op) {
    yield* await op.next()
  },
  ...overrides,
})

test('decorate validates id, match, wrap, priority, capabilities and phases', () => {
  const { facet } = setup()
  const cases = [
    [{ ...def(), id: '' }, /id/],
    [{ ...def(), match: 'not-a-function' }, /match/],
    [{ ...def(), wrap: undefined }, /wrap/],
    [{ ...def(), priority: 'urgent' }, /priority/],
    [{ ...def(), capabilities: { execution: { phases: ['stream'], retry: 'none' }, unknown: true } }, /unknown/],
    [{ ...def(), capabilities: { execution: { phases: ['stream', 'other'], retry: 'none' } } }, /phases/],
    [{ ...def(), capabilities: { execution: { phases: ['stream'], retry: 'always' } } }, /retry/],
  ]
  for (const [definition, pattern] of cases) {
    const result = facet.decorate(definition, 'owner-a')
    assert.equal(result.status, DecorationRegistrationStatus.VALIDATION, result.reason)
    assert.match(result.reason, pattern)
  }
})

test('decorate rejects an unavailable owner', () => {
  const { facet } = setup()
  const result = facet.decorate(def(), '')
  assert.equal(result.status, DecorationRegistrationStatus.UNAVAILABLE)
})

test('decorate defaults priority and capabilities for a minimal definition', () => {
  const { facet } = setup()
  const result = facet.decorate({ id: 'min', match: () => true, wrap: async function* (op) { yield* await op.next() } }, 'owner-a')
  assert.equal(result.status, DecorationRegistrationStatus.OK)
  const snapshot = facet.snapshot()
  const min = snapshot.decorations.find((d) => d.id === 'min')
  assert.equal(min.priority, 'normal')
  assert.equal(min.capabilities.execution.retry, 'none')
  assert.equal(min.capabilities.metadata.labels, false)
})

test('equivalent same-owner registration is idempotent; conflicting is rejected without merging', () => {
  const { facet } = setup()
  const definition = def()
  const first = facet.decorate(definition, 'owner-a')
  assert.equal(first.status, DecorationRegistrationStatus.OK)
  // same definition object → same match/wrap function references → idempotent
  const same = facet.decorate(definition, 'owner-a')
  assert.equal(same.status, DecorationRegistrationStatus.OK)
  assert.equal(same.existing, true)
  const conflicting = facet.decorate(def({ priority: 'high' }), 'owner-a')
  assert.equal(conflicting.status, DecorationRegistrationStatus.CONFLICT)
  const snapshot = facet.snapshot()
  assert.equal(snapshot.decorations.length, 1)
  assert.equal(snapshot.decorations[0].priority, 'normal')
})

test('different owners may reuse the same id with isolated records', () => {
  const { facet } = setup()
  const a = facet.decorate(def(), 'owner-a')
  const b = facet.decorate(def({ priority: 'low' }), 'owner-b')
  assert.equal(a.status, DecorationRegistrationStatus.OK)
  assert.equal(b.status, DecorationRegistrationStatus.OK)
  const snapshot = facet.snapshot()
  assert.equal(snapshot.decorations.length, 2)
  assert.deepEqual(snapshot.decorations.map((d) => d.owner).sort(), ['owner-a', 'owner-b'])
})

test('chain order follows priority tiers, then epoch commit sequence across owners', () => {
  const { registry, facet } = setup({ providers: ['demo'] })
  facet.decorate(def({ id: 'low1', priority: 'low' }), 'owner-a')
  facet.decorate(def({ id: 'high1', priority: 'high' }), 'owner-b')
  facet.decorate(def({ id: 'normal2', priority: 'normal' }), 'owner-a')
  facet.decorate(def({ id: 'normal1', priority: 'normal' }), 'owner-b')
  const chain = registry.adapter.chainFor({ provider: 'demo', model: 'demo-m1', options: {}, signal: undefined })
  assert.equal(chain.length, 4)
  // priority tier descending; within a tier, epoch commit sequence (registration order)
  assert.deepEqual(
    chain.map((l) => l.id),
    ['high1', 'normal2', 'normal1', 'low1'],
  )
})

test('a match that throws degrades only that decoration for the reconcile', () => {
  const { registry, facet } = setup({ providers: ['demo'] })
  facet.decorate(def({ id: 'bad', match: () => { throw new Error('boom') } }), 'owner-a')
  facet.decorate(def({ id: 'good' }), 'owner-b')
  const chain = registry.adapter.chainFor({ provider: 'demo', model: 'demo-m1', options: {}, signal: undefined })
  assert.equal(chain.length, 1)
  assert.equal(chain[0].id, 'good')
})

test('no matching decoration produces no chain and no synthetic adapter', () => {
  const { runtime, registry, facet } = setup({ providers: ['demo'] })
  facet.decorate(def({ id: 'none', match: () => false }), 'owner-a')
  const chain = registry.adapter.chainFor({ provider: 'demo', model: 'demo-m1', options: {}, signal: undefined })
  assert.equal(chain, null)
  assert.deepEqual(runtime.listProviders(), [{ id: 'demo', name: 'demo' }])
})

test('replace rebuilds the binding: old chain superseded, new route reconciled', () => {
  const { registry, facet, handles } = setup({ providers: ['demo'] })
  facet.decorate(def(), 'owner-a')
  const oldChain = registry.adapter.chainFor({ provider: 'demo', model: 'demo-m1', options: {}, signal: undefined })
  assert.equal(oldChain.length, 1)
  const oldBinding = oldChain[0].binding
  handles[0].replace(['demo'])
  assert.equal(oldBinding.lifecycleState, 'revoked')
  const newChain = registry.adapter.chainFor({ provider: 'demo', model: 'demo-m1', options: {}, signal: undefined })
  assert.equal(newChain.length, 1)
  assert.notEqual(newChain[0].binding, oldBinding)
  assert.equal(newChain[0].binding.lifecycleState, 'active')
})

test('adapter disposal revokes bindings and the chain disappears', () => {
  const { registry, facet, handles } = setup({ providers: ['demo'] })
  facet.decorate(def(), 'owner-a')
  assert.equal(registry.adapter.chainFor({ provider: 'demo', model: 'demo-m1', options: {}, signal: undefined }).length, 1)
  handles[0]()
  assert.equal(registry.adapter.chainFor({ provider: 'demo', model: 'demo-m1', options: {}, signal: undefined }), null)
})

test('handle dispose is identity-bound: stale handle cannot remove a newer generation', () => {
  const { facet, registry } = setup({ providers: ['demo'] })
  const first = facet.decorate(def(), 'owner-a')
  assert.equal(first.status, DecorationRegistrationStatus.OK)
  const firstDispose = registry.handleDispose('owner-a', 'metrics', first.record.generation)
  assert.equal(firstDispose.status, DecorationRegistrationStatus.OK)
  const second = facet.decorate(def(), 'owner-a')
  assert.equal(second.status, DecorationRegistrationStatus.OK)
  const stale = registry.handleDispose('owner-a', 'metrics', first.record.generation)
  assert.equal(stale.status, DecorationRegistrationStatus.UNAVAILABLE)
  const snapshot = facet.snapshot()
  assert.equal(snapshot.decorations.length, 1)
})

test('projections are frozen, detached, and expose no secrets or adapter objects', () => {
  const { facet } = setup({ providers: ['demo'] })
  facet.decorate(def(), 'owner-a')
  const snapshot = facet.snapshot()
  assert.equal(Object.isFrozen(snapshot), true)
  assert.equal(Object.isFrozen(snapshot.decorations[0]), true)
  const serialized = JSON.stringify(snapshot)
  for (const secret of ['apiKey', 'password', 'secret', 'BEGIN', 'END']) {
    assert.ok(!serialized.includes(secret), `snapshot must not expose "${secret}"`)
  }
  for (const decoration of snapshot.decorations) {
    assert.ok(!decoration.bindings.some((b) => b.adapter !== undefined), 'no adapter instance in the projection')
    assert.ok(decoration.owner.includes('owner-a'))
  }
})

test('the audit ring is bounded and carries only bounded summaries', () => {
  const { registry, facet } = setup({ providers: ['demo'] })
  for (let i = 0; i < 260; i += 1) {
    facet.decorate(def({ id: `d${i}` }), `owner-${i % 3}`)
  }
  const audit = registry._audit()
  assert.ok(audit.length <= 200, `audit ring must be bounded, got ${audit.length}`)
  const serialized = JSON.stringify(audit)
  for (const secret of ['apiKey', 'prompt', 'password', 'BEGIN', 'END']) {
    assert.ok(!serialized.includes(secret), `audit must not expose "${secret}"`)
  }
})

test('epoch increments across the four mutation boundaries and reconcile', () => {
  const { runtime, registry, facet, handles } = setup({ providers: ['demo'] })
  const epoch0 = registry._epoch()
  facet.decorate(def(), 'owner-a') // registration triggers reconcile → +1
  assert.equal(registry._epoch(), epoch0 + 1)
  handles[0].replace(['demo']) // route replace → +1
  assert.equal(registry._epoch(), epoch0 + 2)
  handles[0]() // dispose → +1
  assert.equal(registry._epoch(), epoch0 + 3)
  const dir = runtime.registerConfigurableProviders([{ provider: 'x', displayName: 'X', settingsNs: 'ns', settingsPath: ['a'] }])
  assert.equal(registry._epoch(), epoch0 + 4)
  dir()
  assert.equal(registry._epoch(), epoch0 + 5)
  const disc = runtime.registerModelDiscovery('ns2', async () => [])
  assert.equal(registry._epoch(), epoch0 + 6)
  disc()
  assert.equal(registry._epoch(), epoch0 + 7)
})
