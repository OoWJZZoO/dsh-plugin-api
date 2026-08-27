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
    loader: { entries() { return [] } },
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
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
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
  assert.equal(state.pluginApi.apiVersion, '0.7')
  assert.deepEqual(state.pluginApi.features, [
    { name: 'tools', isActive: true },
    { name: 'events', isActive: true },
    { name: 'agent', isActive: true },
    { name: 'llm', isActive: true },
    { name: 'llm/request', isActive: true },
    { name: 'llm/admission', isActive: true },
    { name: 'security', isActive: true },
    { name: 'session', isActive: true },
    { name: 'sessionBranch', isActive: false, reason: 'sessionBranch: feature mount did not produce a disposer; feature disabled' },
    { name: 'sessionDurable', isActive: true },
    { name: 'execRoute', isActive: true },
    { name: 'sessionRoute', isActive: true },
    { name: 'settings', isActive: true },
    { name: 'systemPrompt', isActive: true },
    { name: 'services', isActive: true },
    { name: 'typert', isActive: true },
    { name: 'settingsRemote', isActive: true },
    { name: 'remote', isActive: true },
    { name: 'execution', isActive: true },
    { name: 'recovery', isActive: true },
    { name: 'coordination', isActive: true },
    { name: 'workspaceTransactions', isActive: true },
    { name: 'diagnostics', isActive: true },
    { name: 'tasks', isActive: true },

    { name: 'toolDiscovery', isActive: true },

    { name: 'skillsActivation', isActive: false, reason: 'skillsActivation: feature mount did not produce a disposer; feature disabled' },

    { name: 'context', isActive: true },

    { name: 'profile', isActive: true },

    // This fixture's loader carries no adapter-decoration replacement rows,
    // so the composition probe fails and the feature degrades to a disabled
    // entry (the mounter never runs).
    { name: 'llmAdapters', isActive: false, reason: 'loader.entries: loader composition is unavailable; llmAdapters.composition: the adapter decoration replacement composition is not active' },

    // The minimal registry stub in this fixture rejects the sessionChannel
    // feature key, so the mounter degrades to a disabled entry.
    { name: 'sessionChannel', isActive: false, reason: 'ctx.effect: failed to register cleanup for feature "sessionChannel": dsh-plugin-api feature "sessionChannel" is disabled: cannot mount unknown feature "sessionChannel"' },
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



assert.equal(features.length, 30)

  assert.deepEqual(features[0], { name: 'tools', isActive: true })
  assert.deepEqual(features[1], { name: 'events', isActive: true })
  assert.deepEqual(features[2], { name: 'agent', isActive: true })
  assert.deepEqual(features[3], { name: 'llm', isActive: true })
  assert.deepEqual(features[4], { name: 'llm/request', isActive: true })
  assert.equal(features[5].name, 'llm/admission')
  assert.equal(features[5].isActive, false)
  assert.match(features[5].reason, /apiProxy/)
  assert.deepEqual(features[6], { name: 'security', isActive: true })
  assert.deepEqual(features[7], { name: 'session', isActive: true })
  assert.deepEqual(features[8], { name: 'sessionBranch', isActive: false, reason: 'sessionBranch: feature mount did not produce a disposer; feature disabled' })
  assert.deepEqual(features[9], { name: 'sessionDurable', isActive: true })
  assert.deepEqual(features[10], { name: 'execRoute', isActive: true })
  assert.deepEqual(features[11], { name: 'sessionRoute', isActive: true })
  assert.deepEqual(features[12], { name: 'settings', isActive: true })
  assert.deepEqual(features[13], { name: 'systemPrompt', isActive: true })
  assert.deepEqual(features[14], { name: 'services', isActive: true })
  assert.deepEqual(features[15], { name: 'typert', isActive: true })
  assert.deepEqual(features[16], { name: 'settingsRemote', isActive: true })
  assert.deepEqual(features[17], { name: 'remote', isActive: true })
  assert.deepEqual(features[18], { name: 'execution', isActive: true })
  assert.deepEqual(features[19], { name: 'recovery', isActive: true })
  assert.deepEqual(features[20], { name: 'coordination', isActive: true })
  assert.deepEqual(features[21], { name: 'workspaceTransactions', isActive: true })
  assert.deepEqual(features[22], { name: 'diagnostics', isActive: true })
assert.deepEqual(features[23], { name: 'tasks', isActive: true })
  assert.deepEqual(features[24], { name: 'toolDiscovery', isActive: true })
  assert.deepEqual(features[25], { name: 'skillsActivation', isActive: false, reason: 'skillsActivation: feature mount did not produce a disposer; feature disabled' })
  assert.deepEqual(features[26], { name: 'context', isActive: true })
  assert.deepEqual(features[27], { name: 'profile', isActive: true })

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
  // The execution llm source adapter adds one listener; the security facade
  // stream listener is registered after the request owner's
  // (model-request-before evaluates the effective request).
  assert.equal(state.listeners.filter((l) => l.name === 'llm/stream').length, 3)
  // One facade pre-execute listener plus one execution tools source adapter
  // plus one workspace-transaction evidence intake observer plus one security
  // facade listener.
  assert.equal(state.listeners.filter((l) => l.name === 'tools/pre-execute').length, 4)
})

test('repeated apply reuses the existing branded service and does not provide twice', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const firstService = state.pluginApi
  apply(ctx)

  assert.equal(state.provideCount, 1)
  assert.equal(state.pluginApi, firstService)
  assert.equal(state.pluginApi.isActive, true)
  // One facade request listener plus one execution observation listener plus
  // one security facade listener; a repeated apply must not add more.
  assert.equal(state.listeners.filter((l) => l.name === 'llm/stream').length, 3)
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
