import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import {
  LlmInputPolicyRegistrationError,
  LlmRequestTransformRegistrationError,
  PluginApiFeatureDisabledError,
  PluginApiInactiveError,
} from '../lib/errors.js'

function createMockCtx(options = {}) {
  const services = {
    llm: {
      resolveModelInfo: options.resolveModelInfo
        ?? (async () => ({ provider: 'provider-a', id: 'model-a', name: 'model-a', inputModalities: ['text'] })),
      prepareCall() {},
      stream() {},
      registerAdapter() {},
      registerConfigurableProviders() {},
      registerModelDiscovery() {},
      ...(options.llm ?? {}),
    },
    agents: { get() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} }, ...(options.apiProxy ?? {}) },
    tools: {
      register() {},
      restrict() {},
      guard() {},
      get() {},
      schemas() {},
      execute() {},
      presentAs() {},
    },
    sessions: { get() {}, list() {}, fork() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    web: { registerSearchProvider() {}, registerFetchProvider() {} },
    ...(options.services ?? {}),
  }
  const state = {
    pluginApi: undefined,
    effects: [],
    listeners: [],
  }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') state.pluginApi = value
      },
    },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      if (name in services) return services[name]
      return undefined
    },
    plugin(Class) {
      new Class(ctx)
      if (options.prepareThrowsFor) {
        const prepareFeature = state.pluginApi.prepareFeature.bind(state.pluginApi)
        state.pluginApi.prepareFeature = (name, api) => {
          if (name === options.prepareThrowsFor) throw new Error(`prepared ${name} failure`)
          return prepareFeature(name, api)
        }
      }
    },
    effect(fn, label) {
      state.effects.push({ fn, label })
      if (options.effectThrowsFor && label.includes(options.effectThrowsFor)) {
        throw new Error('simulated cleanup registration failure')
      }
    },
    on(name, listener) {
      const entry = { name, listener }
      state.listeners.push(entry)
      let disposed = false
      return () => {
        if (disposed) return false
        disposed = true
        const index = state.listeners.indexOf(entry)
        if (index < 0) return false
        state.listeners.splice(index, 1)
        return true
      }
    },
    once() {},
    emit() {},
    serial() {},
    parallel() {},
    bail() {},
    waterfall() {},
  }
  return { ctx, state, services }
}

test('apply mounts llm/request before llm/admission with usable surfaces', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))

  const features = state.pluginApi.features
  const requestIndex = features.findIndex((f) => f.name === 'llm/request')
  const admissionIndex = features.findIndex((f) => f.name === 'llm/admission')
  assert.ok(requestIndex >= 0 && admissionIndex > requestIndex, 'llm/request mounts before llm/admission')

  const disposer = state.pluginApi.llm.request.transform({
    id: 'probe',
    mode: 'compat',
    apply() { return { kind: 'pass' } },
    isConverged() { return true },
  })
  assert.throws(
    () => state.pluginApi.llm.request.transform({ id: 'probe', mode: 'compat', apply() {}, isConverged() {} }),
    LlmRequestTransformRegistrationError,
    'duplicate transform id is rejected',
  )
  assert.equal(disposer(), true)
  assert.equal(disposer(), false)

  const policyDisposer = state.pluginApi.llm.admission.register({
    id: 'probe-policy',
    input: 'image',
    match() { return true },
    process() { return { kind: 'pass' } },
    validate() { return true },
  })
  assert.equal(policyDisposer(), true)
  assert.equal(policyDisposer(), false)

  assert.throws(
    () => state.pluginApi.llm.admission.register({ id: 'p', input: 'audio', match() {}, process() {}, validate() {} }),
    LlmInputPolicyRegistrationError,
  )
})

test('staged publication: effect failure rolls back the disabled facade, disposes resources, and disables admission', () => {
  const { ctx, state, services } = createMockCtx({ effectThrowsFor: 'llm/request' })
  const originalResolve = services.llm.resolveModelInfo
  assert.doesNotThrow(() => apply(ctx))

  const features = state.pluginApi.features
  const request = features.find((f) => f.name === 'llm/request')
  const admission = features.find((f) => f.name === 'llm/admission')
  assert.equal(request.isActive, false)
  assert.match(request.reason, /failed to register cleanup/)
  assert.equal(admission.isActive, false, 'request failure independently P2-disables admission')

  assert.throws(
    () => state.pluginApi.llm.request.transform({}),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'llm/request',
  )
  // The gateway was never installed: the official resolver is untouched.
  assert.equal(services.llm.resolveModelInfo, originalResolve)
  // Unrelated features still mounted.
  assert.equal(features.find((f) => f.name === 'tools').isActive, true)
  assert.equal(features.find((f) => f.name === 'events').isActive, true)
})

test('private L4/L2 prepare failure leaves no owner residue while preserving independent L4 activation', () => {
  for (const featureName of ['llm/request', 'llm/admission']) {
    const { ctx, state, services } = createMockCtx({ prepareThrowsFor: featureName })
    const originalResolve = services.llm.resolveModelInfo
    assert.doesNotThrow(() => apply(ctx))

    const request = state.pluginApi.features.find((feature) => feature.name === 'llm/request')
    const admission = state.pluginApi.features.find((feature) => feature.name === 'llm/admission')
    assert.equal(request.isActive, featureName !== 'llm/request')
    assert.equal(admission.isActive, false)
    assert.equal(services.llm.resolveModelInfo, originalResolve, 'an unpublished L2 gateway must not retain its resolver wrapper')
    assert.equal(
      state.listeners.filter((entry) => entry.name === 'llm/stream').length,
      featureName === 'llm/request' ? 0 : 1,
      'only a committed L4 owner may retain the raw listener',
    )
  }
})

test('request guard failure disables both llm/request and llm/admission without wrapping anything', () => {
  const { ctx, state, services } = createMockCtx({ llm: { stream: undefined } })
  const originalResolve = services.llm.resolveModelInfo
  const originalPrompt = services.apiProxy.sessions.prompt
  assert.doesNotThrow(() => apply(ctx))

  const features = state.pluginApi.features
  assert.equal(features.find((f) => f.name === 'llm/request').isActive, false)
  assert.equal(features.find((f) => f.name === 'llm/admission').isActive, false)
  assert.throws(
    () => state.pluginApi.llm.request.transform({}),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'llm/request',
  )
  assert.equal(services.llm.resolveModelInfo, originalResolve)
  assert.equal(services.apiProxy.sessions.prompt, originalPrompt)
  assert.equal(state.listeners.filter((l) => l.name === 'llm/stream').length, 0)
})

test('reapply is idempotent: one stream listener and one gateway wrapper', () => {
  const { ctx, state, services } = createMockCtx()
  const originalResolve = services.llm.resolveModelInfo
  apply(ctx)
  const firstWrapper = services.llm.resolveModelInfo
  const listenerCountAfterFirst = state.listeners.filter((l) => l.name === 'llm/stream').length

  apply(ctx)

  assert.equal(state.listeners.filter((l) => l.name === 'llm/stream').length, listenerCountAfterFirst)
  assert.equal(services.llm.resolveModelInfo, firstWrapper, 'no second gateway wrapper layer')
  assert.notEqual(services.llm.resolveModelInfo, originalResolve, 'the gateway wrapper is installed')
  assert.equal(state.pluginApi.features.find((f) => f.name === 'llm/request').isActive, true)
  assert.equal(state.pluginApi.features.find((f) => f.name === 'llm/admission').isActive, true)
})

test('facade modelInfo stays authoritative pre-overlay inside an active gateway scope', async () => {
  const { ctx, state } = createMockCtx({
    apiProxy: {
      sessions: {
        async prompt() {
          // The official admission check runs inside the gateway scope.
          const info = await ctx.get('pluginApi').llm.modelInfo('provider-a', 'model-a')
          assert.deepEqual(info.inputModalities, ['text'],
            'facade modelInfo must bypass the gateway overlay even inside a scope')
          return { ok: true }
        },
        selectModel() {},
      },
    },
  })
  state.pluginApi = undefined
  apply(ctx)

  state.pluginApi.llm.admission.register({
    id: 'img',
    input: 'image',
    match() { return true },
    process() { return { kind: 'pass' } },
    validate() { return true },
  })

  const result = await ctx.get('apiProxy').sessions.prompt({ payload: { sessionId: 's1' } })
  assert.deepEqual(result, { ok: true })
})

test('inert core keeps P1 precedence for the request and admission surfaces', () => {
  const previous = process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
  process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = '1'
  try {
    const { ctx, state } = createMockCtx()
    assert.doesNotThrow(() => apply(ctx))
    assert.throws(() => state.pluginApi.llm.request.transform({}), PluginApiInactiveError)
    assert.throws(() => state.pluginApi.llm.admission.register({}), PluginApiInactiveError)
  } finally {
    if (previous === undefined) delete process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
    else process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = previous
  }
})
