import test from 'node:test'
import assert from 'node:assert/strict'
import { mountLlmRequestFeature } from '../lib/llm-request.js'
import { installLlmAdmissionGateway } from '../lib/llm-admission-gateway.js'
import { createLlmInputPolicyRegistry } from '../lib/llm-input-policy.js'
import { LlmRequestTransformError } from '../lib/errors.js'

const contentHasImage = (content) => content.some((block) => (
  block.type === 'image' || (block.type === 'tool-result' && contentHasImage(block.content))
))

function makeRequest(content) {
  return {
    provider: 'provider-a',
    model: 'model-a',
    messages: [{ id: 'm1', role: 'user', source: { kind: 'user' }, content }],
    signal: new AbortController().signal,
  }
}

function createOwnerHarness({ logger }) {
  const listeners = []
  const ctx = {
    on(name, listener) {
      listeners.push(listener)
      return () => {}
    },
  }
  const llm = {
    stream() { throw new Error('must not re-enter') },
    async resolveModelInfo() {
      return { provider: 'provider-a', id: 'model-a', name: 'model-a', inputModalities: ['text'] }
    },
  }
  const owner = mountLlmRequestFeature({
    ctx,
    llm,
    contentHasImage,
    agents: { get() { return undefined } },
    policyHandle: { snapshotPolicies: () => [], isPolicyAvailable: () => true },
    resolveAuthoritative: (p, m, s) => llm.resolveModelInfo(p, m, s),
    logger,
  })
  assert.ok(owner)
  return { listener: listeners[0], owner }
}

test('a throwing logger is inert: the operation outcome is preserved and no raw error escapes', () => {
  let logAttempts = 0
  const harness = createOwnerHarness({
    logger: {
      warn() {
        logAttempts += 1
        throw new Error('logger exploded')
      },
    },
  })
  harness.owner.api.transform({
    id: 'boom',
    mode: 'compat',
    apply() { throw new Error('apply exploded') },
    isConverged() { return true },
  })

  let continuationCalls = 0
  assert.throws(
    () => harness.listener(makeRequest([{ type: 'text', text: 'hi' }]), () => { continuationCalls += 1 }),
    (error) => error instanceof LlmRequestTransformError && error.code === 'LLM_REQUEST_TRANSFORM_FAILED',
  )
  assert.equal(logAttempts >= 1, true, 'the logger was attempted')
  assert.equal(continuationCalls, 0)
})

test('a missing logger leaves the pipeline fully operational', () => {
  const harness = createOwnerHarness({ logger: {} })
  harness.owner.api.transform({
    id: 'noop',
    mode: 'compat',
    apply() { return { kind: 'pass' } },
    isConverged() { return true },
  })

  let continuationCalls = 0
  const result = harness.listener(makeRequest([{ type: 'text', text: 'hi' }]), () => {
    continuationCalls += 1
    return 'continued'
  })
  assert.equal(result, 'continued')
  assert.equal(continuationCalls, 1)
})

test('gateway match diagnostics are inert when the logger throws; official refusal is preserved', async () => {
  const llm = {
    async resolveModelInfo() {
      return { provider: 'provider-a', id: 'model-a', name: 'model-a', inputModalities: ['text'] }
    },
  }
  const sessions = {
    async prompt() {
      const info = await llm.resolveModelInfo('provider-a', 'model-a')
      if (info.inputModalities !== undefined && !info.inputModalities.includes('image')) {
        return { ok: false, code: 'attachment-error' }
      }
      return { ok: true }
    },
    async selectModel() { return { ok: true } },
  }
  const registry = createLlmInputPolicyRegistry()
  registry.register({
    id: 'flaky',
    input: 'image',
    match() { throw new Error('match exploded') },
    process() { return { kind: 'pass' } },
    validate() { return true },
  })
  const gateway = installLlmAdmissionGateway({
    llm,
    apiProxy: { sessions },
    policySource: registry,
    agents: { get() { return undefined } },
    logger: {
      warn() { throw new Error('logger exploded') },
    },
  })
  assert.ok(gateway)

  const result = await sessions.prompt({ payload: { sessionId: 's1' } })
  assert.deepEqual(result, { ok: false, code: 'attachment-error' },
    'a throwing logger must not change the admission outcome')
  gateway.dispose()
})

test('fail-safe apply(): guard failures and mount failures never throw through apply', async () => {
  const previous = process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
  process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = '1'
  try {
    const { apply } = await import('../lib/index.js')
    const ctx = {
      logger: { error() {}, warn() {} },
      reflect: { provide() {} },
      get() { return undefined },
      plugin() {},
      effect() {},
      on() { return () => {} },
      once() {},
      emit() {},
      serial() {},
      parallel() {},
      bail() {},
      waterfall() {},
    }
    assert.doesNotThrow(() => apply(ctx))
  } finally {
    if (previous === undefined) delete process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
    else process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = previous
  }
})