import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from '../lib/errors.js'

function createTypertRegistry() {
  const noOp = () => {}
  return {
    register: noOp, get: noOp, resolve: noOp, list: noOp, getPackage: noOp, listPackages: noOp, toJSONSchema: noOp,
    local: { get: noOp, hasSeen: noOp, list: noOp, subscribe: noOp },
    remotes: { register: noOp, get: noOp, list: noOp, subscribe: noOp },
    lookups: { register: noOp, configure: noOp, get: noOp, definitions: noOp, keys: noOp, subscribe: noOp },
    contexts: { registerHost: noOp, configureHost: noOp, registerClient: noOp, getHost: noOp, getClient: noOp, subscribe: noOp },
  }
}

function createMockCtx(options = {}) {
  const systemPrompt = options.systemPrompt === false
    ? undefined
    : {
        section() {},
        context() {},
        variable() {},
        tools() {},
        suppressRuntimeContext() {},
      }
  const services = {
    llm: {
      resolveModelInfo() {},
      prepareCall() {},
      stream() {},
      registerAdapter() {},
      registerConfigurableProviders() {},
      registerModelDiscovery() {},
    },
    agents: { get() {}, list() {}, roots() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
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
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    typert: createTypertRegistry(),
    web: { registerSearchProvider() {}, registerFetchProvider() {} },
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(options.services ?? {}),
  }
  const state = {
    pluginApi: undefined,
    provideCount: 0,
    effects: [],
    listeners: [],
  }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') {
          state.pluginApi = value
          state.provideCount += 1
        }
      },
    },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      if (name in services) return services[name]
      return undefined
    },
    plugin(Class) {
      new Class(ctx)
    },
    effect(fn, label) {
      state.effects.push({ fn, label })
    },
    on(name, listener) {
      state.listeners.push({ name, listener })
      return () => {}
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

test('apply with healthy ctx registers active service and mounts llm/request + llm/admission', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.provideCount, 1)
  assert.equal(state.pluginApi.isActive, true)
  assert.equal(state.pluginApi.apiVersion, '0.5')
  assert.deepEqual(state.pluginApi.features, [
    { name: 'tools', isActive: true },
    { name: 'events', isActive: true },
    { name: 'agent', isActive: true },
    { name: 'llm', isActive: true },
    { name: 'llm/request', isActive: true },
    { name: 'llm/admission', isActive: true },
    { name: 'session', isActive: true },
    { name: 'sessionDurable', isActive: true },
    { name: 'execRoute', isActive: true },
    { name: 'sessionRoute', isActive: true },
    { name: 'settings', isActive: true },
    { name: 'systemPrompt', isActive: true },
    { name: 'services', isActive: true },
    { name: 'typert', isActive: true },
    { name: 'settingsRemote', isActive: true },
    { name: 'remote', isActive: true },
  ])
  assert.equal(state.pluginApi.llm.isActive, true)
  assert.equal(typeof state.pluginApi.llm.request.transform, 'function')
  // admission.isActive is retired: the feature registry is the sole signal.
  assert.equal('isActive' in state.pluginApi.llm.admission, false)
  assert.equal(typeof state.pluginApi.llm.admission.register, 'function')
  assert.equal(typeof state.pluginApi.llm.modelInfo, 'function')
  assert.equal(typeof state.pluginApi.events.on, 'function')
  assert.equal(typeof state.pluginApi.session.get, 'function')
  assert.equal(typeof state.pluginApi.services.web.registerSearchProvider, 'function')
  assert.equal(state.pluginApi.services.typert.isActive, true)

  assert.equal(typeof state.pluginApi.systemPrompt.section, 'function')
  assert.equal(state.pluginApi.settings.isActive, true)
  assert.equal(typeof state.pluginApi.remote.publish, 'function')
  assert.equal(state.pluginApi.remote.isActive, true)
  assert.ok(state.listeners.some((l) => l.name === 'llm/stream'))
})

test('core guard failure (non-registration primitive) leaves an inert service and mounts nothing', () => {
  const previous = process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
  process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = '1'
  try {
    const { ctx, state } = createMockCtx()
    assert.doesNotThrow(() => apply(ctx))

    assert.ok(state.pluginApi)
    assert.equal(state.pluginApi.isActive, false)
    assert.deepEqual(state.pluginApi.features, [])
    assert.throws(() => state.pluginApi.assertCompatible('0.1'), PluginApiInactiveError)
    assert.throws(() => state.pluginApi.llm.admission.register({}), PluginApiInactiveError)
    assert.equal(state.listeners.length, 0)
  } finally {
    if (previous === undefined) delete process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
    else process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = previous
  }
})

test('core guard failure in ctx.plugin registers no service and does not throw', () => {
  const previous = process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
  process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = '1'
  try {
    const { ctx, state } = createMockCtx()
    ctx.plugin = undefined
    assert.doesNotThrow(() => apply(ctx))
    assert.equal(state.pluginApi, undefined)
    assert.equal(state.provideCount, 0)
  } finally {
    if (previous === undefined) delete process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
    else process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = previous
  }
})

test('feature guard failure disables only llm/admission and keeps the facade active', () => {
  const { ctx, state, services } = createMockCtx({ services: { apiProxy: undefined } })
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)
  const features = state.pluginApi.features



  assert.equal(features.length, 16)
  assert.deepEqual(features[0], { name: 'tools', isActive: true })
  assert.deepEqual(features[1], { name: 'events', isActive: true })
  assert.deepEqual(features[2], { name: 'agent', isActive: true })
  assert.deepEqual(features[3], { name: 'llm', isActive: true })
  assert.deepEqual(features[4], { name: 'llm/request', isActive: true })
  assert.equal(features[5].name, 'llm/admission')
  assert.equal(features[5].isActive, false)
  assert.match(features[5].reason, /apiProxy/)
  assert.deepEqual(features[6], { name: 'session', isActive: true })
  assert.deepEqual(features[7], { name: 'sessionDurable', isActive: true })
  assert.deepEqual(features[8], { name: 'execRoute', isActive: true })
  assert.deepEqual(features[9], { name: 'sessionRoute', isActive: true })
  assert.deepEqual(features[10], { name: 'settings', isActive: true })
  assert.deepEqual(features[11], { name: 'systemPrompt', isActive: true })
  assert.deepEqual(features[12], { name: 'services', isActive: true })
  assert.deepEqual(features[13], { name: 'typert', isActive: true })
  assert.deepEqual(features[14], { name: 'settingsRemote', isActive: true })
  assert.deepEqual(features[15], { name: 'remote', isActive: true })

  assert.throws(
    () => state.pluginApi.llm.admission.register({}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'llm/admission')
      return true
    },
  )
  assert.equal(typeof services.llm.resolveModelInfo, 'function')
  // The request owner stays available; admission disabled without a gateway.
  assert.equal(state.listeners.filter((l) => l.name === 'llm/stream').length, 1)
  assert.equal(state.listeners.filter((l) => l.name === 'tools/pre-execute').length, 1)
})

test('repeated apply reuses the existing branded service and does not provide twice', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const firstService = state.pluginApi
  apply(ctx)

  assert.equal(state.provideCount, 1)
  assert.equal(state.pluginApi, firstService)
  assert.equal(state.pluginApi.isActive, true)
  assert.equal(state.listeners.filter((l) => l.name === 'llm/stream').length, 1)
})

test('runtime version mismatch (core inert) does not intercept a direct internal-package interaction', () => {
  const previous = process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
  process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = '1'
  try {
    const { ctx, services } = createMockCtx()
    const originalResolveModelInfo = services.llm.resolveModelInfo
    const originalPrompt = services.apiProxy.sessions.prompt
    const originalSelectModel = services.apiProxy.sessions.selectModel

    apply(ctx)

    // Direct internal-package path is untouched by the inert facade.
    assert.equal(services.llm.resolveModelInfo, originalResolveModelInfo)
    assert.equal(services.apiProxy.sessions.prompt, originalPrompt)
    assert.equal(services.apiProxy.sessions.selectModel, originalSelectModel)
  } finally {
    if (previous === undefined) delete process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
    else process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = previous
  }
})
