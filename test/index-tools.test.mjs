import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

function createMockCtx(options = {}) {
  const tools = options.tools === false
    ? undefined
    : {
        registerCalls: [],
        registerDisposer: () => {},
        register(definition) {
          tools.registerCalls.push(definition)
          return tools.registerDisposer
        },
        restrict(filter) {
          tools.restrictCalls.push(filter)
          return tools.restrictDisposer
        },
        restrictCalls: [],
        restrictDisposer: () => {},
        guard(guard) {
          tools.guardCalls.push(guard)
          return tools.guardDisposer
        },
        guardCalls: [],
        guardDisposer: () => {},
        get(name, scope) {
          tools.getCalls.push([name, scope])
          return tools.getResult
        },
        getCalls: [],
        getResult: { name: 'looked-up' },
        schemas(scope) {
          tools.schemasCalls.push(scope)
          return tools.schemasResult
        },
        schemasCalls: [],
        schemasResult: [{ name: 'schema' }],
        execute(input) {
          tools.executeCalls.push(input)
          return Promise.resolve(tools.executeResult)
        },
        executeCalls: [],
        executeResult: { isError: false, content: [] },
        presentAs(...args) {
          tools.presentAsCalls.push(args)
          return tools.presentAsDisposer
        },
        presentAsCalls: [],
        presentAsDisposer: () => {},
      }

  const web = options.web === false
    ? undefined
    : {
        registerSearchProvider(provider) {
          web.searchProviderCalls.push(provider)
          return web.searchDisposer
        },
        registerFetchProvider(provider) {
          web.fetchProviderCalls.push(provider)
          return web.fetchDisposer
        },
        searchProviderCalls: [],
        fetchProviderCalls: [],
        searchDisposer: () => {},
        fetchDisposer: () => {},
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
    sessions: { get() {}, list() {}, fork() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    ...(tools ? { tools } : {}),
    ...(web ? { web } : {}),
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
    ...(options.events === false ? {} : { waterfall() {} }),
  }

  return { ctx, state, services, tools, web }
}

test('tools active: apply mounts pluginApi.tools and extends the events catalog with six tool events', async () => {
  const { ctx, state, tools } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)
  assert.equal(state.pluginApi.tools.isActive, true)

  const features = state.pluginApi.features
  assert.equal(features.length, 20)
  assert.deepEqual(features[0], { name: 'tools', isActive: true })
  assert.deepEqual(features[1], { name: 'events', isActive: true })
  assert.deepEqual(features[2], { name: 'agent', isActive: true })
  assert.deepEqual(features[3], { name: 'llm', isActive: true })
  assert.deepEqual(features[4], { name: 'llm/request', isActive: true })
  assert.deepEqual(features[5], { name: 'llm/admission', isActive: true })
  assert.deepEqual(features[6], { name: 'session', isActive: true })
  assert.deepEqual(features[7], { name: 'sessionDurable', isActive: true })
  assert.deepEqual(features[8], { name: 'execRoute', isActive: true })
  assert.deepEqual(features[9], { name: 'sessionRoute', isActive: true })

  const catalog = state.pluginApi.events.catalog
  assert.equal(catalog['tools/change']?.mode, 'emit')
  assert.equal(catalog['tools/execute']?.freeze, 'except-signal')
  assert.equal(Object.keys(catalog).length, 47)

  const definition = { name: 'demo', output: {} }
  const disposer = state.pluginApi.tools.register(definition)
  assert.equal(tools.registerCalls.length, 1)
  assert.equal(tools.registerCalls[0], definition)
  assert.equal(disposer, tools.registerDisposer)

  const input = { callId: '1', name: 'demo', arguments: {}, signal: new AbortController().signal }
  assert.deepEqual(await state.pluginApi.tools.execute(input), tools.executeResult)
  assert.equal(tools.executeCalls[0], input)
})

test('tools guard failure disables only tools and keeps the events catalog at base 41', () => {
  const { ctx, state } = createMockCtx({ tools: false })
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)

  const features = state.pluginApi.features
  assert.equal(features.length, 20)
  assert.equal(features[0].name, 'tools')
  assert.equal(features[0].isActive, false)
  assert.match(features[0].reason, /tools service/)
  assert.deepEqual(features[1], { name: 'events', isActive: true })
  assert.deepEqual(features[2], { name: 'agent', isActive: true })
  assert.deepEqual(features[3], { name: 'llm', isActive: true })
  assert.deepEqual(features[4], { name: 'llm/request', isActive: true })
  assert.deepEqual(features[5], { name: 'llm/admission', isActive: true })
  assert.deepEqual(features[6], { name: 'session', isActive: true })
  assert.deepEqual(features[7], { name: 'sessionDurable', isActive: true })
  assert.equal(features[8].name, 'execRoute')
  assert.equal(features[8].isActive, false)
  assert.match(features[8].reason, /execRoute cannot resolve the official tools service/)

  assert.equal(state.pluginApi.events.catalog['session/created']?.mode, 'emit')
  assert.equal(state.pluginApi.events.catalog['tools/change'], undefined)
  assert.equal(Object.keys(state.pluginApi.events.catalog).length, 41)

  assert.throws(
    () => state.pluginApi.tools.register({ name: 'x' }),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'tools')
      return true
    },
  )
})

test('repeated apply does not re-mount the tools feature', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const service = state.pluginApi
  let toolsMountCalls = 0
  const originalMountFeature = service.mountFeature.bind(service)
  service.mountFeature = (name, api) => {
    if (name === 'tools') toolsMountCalls += 1
    return originalMountFeature(name, api)
  }

  assert.doesNotThrow(() => apply(ctx))
  assert.equal(toolsMountCalls, 0)
  assert.equal(service.tools.isActive, true)
})
