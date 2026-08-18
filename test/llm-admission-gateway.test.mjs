import test from 'node:test'
import assert from 'node:assert/strict'
import { installLlmAdmissionGateway } from '../lib/llm-admission-gateway.js'
import { createLlmInputPolicyRegistry } from '../lib/llm-input-policy.js'
import { runAuthoritative } from '../lib/llm-request.js'

function makePolicy(overrides = {}) {
  return {
    id: 'img-policy',
    input: 'image',
    match() { return true },
    process() { return { kind: 'pass' } },
    validate() { return true },
    ...overrides,
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createHarness(options = {}) {
  const calls = { resolver: [] }
  const originalInfo = options.originalInfo ?? {
    provider: 'provider-a',
    id: 'model-a',
    name: 'model-a',
    inputModalities: ['text'],
  }
  const llm = {
    async resolveModelInfo(provider, model, signal) {
      calls.resolver.push({ provider, model })
      if (options.resolveModelInfo) return options.resolveModelInfo(provider, model, signal)
      if (options.resolveModelInfoThrows) throw options.resolveModelInfoThrows
      return originalInfo
    },
  }
  const sessions = {
    async prompt(request) {
      const info = await llm.resolveModelInfo('provider-a', 'model-a')
      if (info.inputModalities !== undefined && !info.inputModalities.includes('image')) {
        return { ok: false, code: 'attachment-error' }
      }
      if (options.promptExtra) await options.promptExtra(llm)
      return { ok: true, accepted: true }
    },
    async selectModel(request) {
      const info = await llm.resolveModelInfo(request.payload.provider, request.payload.model)
      if (info.inputModalities !== undefined && !info.inputModalities.includes('image')) {
        return { ok: false, code: 'model-unavailable' }
      }
      if (options.selectModelExtra) await options.selectModelExtra(llm)
      return { ok: true, selected: true }
    },
  }
  const apiProxy = { sessions }
  const registry = createLlmInputPolicyRegistry()
  const warns = []
  const gateway = installLlmAdmissionGateway({
    llm,
    apiProxy,
    policySource: registry,
    agents: options.agents ?? { get() { return undefined } },
    logger: { warn: (m) => warns.push(m) },
  })
  return { calls, llm, sessions, apiProxy, registry, warns, gateway }
}

test('selectModel scope overlays image only for the named check with matching selection', async () => {
  const harness = createHarness()
  harness.registry.register(makePolicy())

  const result = await harness.sessions.selectModel({
    payload: { sessionId: 's1', provider: 'provider-a', model: 'model-a' },
  })

  assert.deepEqual(result, { ok: true, selected: true })
  assert.equal(harness.calls.resolver.length, 1)
  assert.deepEqual(harness.calls.resolver[0], { provider: 'provider-a', model: 'model-a' })
})

test('native-image model is not modified', async () => {
  const harness = createHarness({
    originalInfo: { provider: 'provider-a', id: 'model-a', name: 'model-a', inputModalities: ['text', 'image'] },
  })
  harness.registry.register(makePolicy())

  const result = await harness.sessions.selectModel({
    payload: { sessionId: 's1', provider: 'provider-a', model: 'model-a' },
  })

  assert.deepEqual(result, { ok: true, selected: true })
  assert.equal(harness.calls.resolver.length, 1)
})

test('undefined inputModalities is not modified (official gate passes anyway)', async () => {
  const harness = createHarness({
    originalInfo: { provider: 'provider-a', id: 'model-a', name: 'model-a' },
  })
  harness.registry.register(makePolicy())

  const result = await harness.sessions.selectModel({
    payload: { sessionId: 's1', provider: 'provider-a', model: 'model-a' },
  })

  assert.deepEqual(result, { ok: true, selected: true })
})

test('no matching policy preserves official refusal', async () => {
  const harness = createHarness()

  const result = await harness.sessions.selectModel({
    payload: { sessionId: 's1', provider: 'provider-a', model: 'model-a' },
  })

  assert.deepEqual(result, { ok: false, code: 'model-unavailable' })
})

test('match throw and thenable are no-match with one diagnostic and official refusal is preserved', async () => {
  for (const match of [
    () => { throw new Error('match exploded') },
    () => Promise.resolve(true),
    () => 'yes',
  ]) {
    const harness = createHarness()
    harness.registry.register(makePolicy({ id: 'flaky', match }))

    const result = await harness.sessions.selectModel({
      payload: { sessionId: 's1', provider: 'provider-a', model: 'model-a' },
    })

    assert.deepEqual(result, { ok: false, code: 'model-unavailable' })
    assert.equal(harness.warns.some((w) => w.includes('policy-match:flaky')), true)
  }
})

test('resolver call with non-matching arguments inside a selectModel scope is not overlaid', async () => {
  const harness = createHarness({
    selectModelExtra: async (llm) => {
      const foreign = await llm.resolveModelInfo('other-provider', 'other-model')
      assert.deepEqual(foreign.inputModalities, ['text'], 'foreign consumer must not observe the overlay')
    },
  })
  harness.registry.register(makePolicy())

  const result = await harness.sessions.selectModel({
    payload: { sessionId: 's1', provider: 'provider-a', model: 'model-a' },
  })

  assert.deepEqual(result, { ok: true, selected: true })
  assert.equal(harness.calls.resolver.length, 2)
})

test('prompt scope overlays the named check and at most once', async () => {
  const harness = createHarness({
    promptExtra: async (llm) => {
      const second = await llm.resolveModelInfo('provider-a', 'model-a')
      assert.deepEqual(second.inputModalities, ['text'], 'at most one overlay per scope')
    },
  })
  harness.registry.register(makePolicy())

  const result = await harness.sessions.prompt({ payload: { sessionId: 's1' } })

  assert.deepEqual(result, { ok: true, accepted: true })
  assert.equal(harness.calls.resolver.length, 2)
})

test('matching-args resolver call after the selectModel check is not overlaid', async () => {
  const harness = createHarness({
    selectModelExtra: async (llm) => {
      const later = await llm.resolveModelInfo('provider-a', 'model-a')
      assert.deepEqual(later.inputModalities, ['text'], 'at most one overlay per scope')
    },
  })
  harness.registry.register(makePolicy())

  const result = await harness.sessions.selectModel({
    payload: { sessionId: 's1', provider: 'provider-a', model: 'model-a' },
  })

  assert.deepEqual(result, { ok: true, selected: true })
  assert.equal(harness.calls.resolver.length, 2)
})

test('facade modelInfo bypass never observes the overlay inside an active scope', async () => {
  const harness = createHarness({
    selectModelExtra: async (llm) => {
      const info = await runAuthoritative(() => llm.resolveModelInfo('provider-a', 'model-a'))
      assert.deepEqual(info.inputModalities, ['text'], 'the facade authoritative path stays pre-overlay')
    },
  })
  harness.registry.register(makePolicy())

  const result = await harness.sessions.selectModel({
    payload: { sessionId: 's1', provider: 'provider-a', model: 'model-a' },
  })

  assert.deepEqual(result, { ok: true, selected: true })
})

test('resolver calls outside any RPC scope are never overlaid', async () => {
  const harness = createHarness()
  harness.registry.register(makePolicy())

  const info = await harness.llm.resolveModelInfo('provider-a', 'model-a')

  assert.deepEqual(info.inputModalities, ['text'])
})

test('disposal during an in-flight RPC leaves the original resolver result and preserves official refusal', async () => {
  const gate = deferred()
  const harness = createHarness({
    resolveModelInfo: () => gate.promise,
  })
  harness.registry.register(makePolicy())

  const pending = harness.sessions.selectModel({
    payload: { sessionId: 's1', provider: 'provider-a', model: 'model-a' },
  })
  await Promise.resolve()
  assert.equal(harness.gateway.activeScopeCount(), 1)
  assert.equal(harness.gateway.dispose(), true)
  assert.equal(harness.gateway.dispose(), false)

  gate.resolve({ provider: 'provider-a', id: 'model-a', name: 'model-a', inputModalities: ['text'] })

  const result = await pending
  assert.deepEqual(result, { ok: false, code: 'model-unavailable' },
    'the in-flight admission must finish with the original resolver result only')
  await Promise.resolve()
  assert.equal(harness.gateway.activeScopeCount(), 0)
})

test('after disposal new RPCs create no scope and official refusal is preserved', async () => {
  const harness = createHarness()
  harness.registry.register(makePolicy())
  harness.gateway.dispose()

  const result = await harness.sessions.selectModel({
    payload: { sessionId: 's1', provider: 'provider-a', model: 'model-a' },
  })

  assert.deepEqual(result, { ok: false, code: 'model-unavailable' })
  assert.equal(harness.gateway.activeScopeCount(), 0)
})

test('resolver throw propagates the exact error object and never overlays', async () => {
  const boom = new Error('adapter resolver exploded')
  const harness = createHarness({
    resolveModelInfoThrows: boom,
  })
  harness.registry.register(makePolicy())

  await assert.rejects(
    harness.sessions.selectModel({ payload: { sessionId: 's1', provider: 'provider-a', model: 'model-a' } }),
    (error) => error === boom,
  )
})

test('foreign wrapper after ours is never removed; dispose degrades transparently', async () => {
  const harness = createHarness()
  harness.registry.register(makePolicy())

  const foreignCalls = []
  const originalResolve = harness.llm.resolveModelInfo
  harness.llm.resolveModelInfo = function foreignWrapper(provider, model, signal) {
    foreignCalls.push({ provider, model })
    return originalResolve(provider, model, signal)
  }

  harness.gateway.dispose()

  assert.equal(typeof harness.llm.resolveModelInfo, 'function')
  const info = await harness.llm.resolveModelInfo('provider-a', 'model-a')
  assert.deepEqual(foreignCalls, [{ provider: 'provider-a', model: 'model-a' }])
  assert.deepEqual(info.inputModalities, ['text'])
})

test('missing boundaries produce no gateway', () => {
  assert.equal(installLlmAdmissionGateway({}), null)
  assert.equal(installLlmAdmissionGateway({ llm: { resolveModelInfo() {} } }), null)
  const apiProxy = { sessions: { prompt() {}, selectModel() {} } }
  assert.equal(installLlmAdmissionGateway({ llm: { resolveModelInfo() {} }, apiProxy }), null)
})

test('stale scopes from a previous gateway epoch never overlay', async () => {
  const harness = createHarness()
  harness.registry.register(makePolicy())
  const firstResult = await harness.sessions.selectModel({
    payload: { sessionId: 's1', provider: 'provider-a', model: 'model-a' },
  })
  assert.deepEqual(firstResult, { ok: true, selected: true })
  harness.gateway.dispose()

  const result = await harness.sessions.selectModel({
    payload: { sessionId: 's1', provider: 'provider-a', model: 'model-a' },
  })
  assert.deepEqual(result, { ok: false, code: 'model-unavailable' })
})