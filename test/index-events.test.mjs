import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

function createMockCtx(options = {}) {
  const tools = options.tools === false
    ? undefined
    : {
        register() {},
        restrict() {},
        guard() {},
        get() {},
        schemas() {},
        execute() {},
        presentAs() {},
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
        search() {},
        fetch() {},
        searchProviderCalls: [],
        fetchProviderCalls: [],
        searchDisposer: () => {},
        fetchDisposer: () => {},
      }

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
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    ...(tools ? { tools } : {}),
    sessions: { get() {}, list() {}, fork() {} },
    ...(web ? { web } : {}),
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
    ...(options.events === false ? {} : { waterfall() {} }),
  }
  return { ctx, state, services, web }
}

test('apply mounts events with the frozen catalog and usable bus', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)
  const catalog = state.pluginApi.events.catalog
  assert.equal(catalog['tools/change']?.mode, 'emit')
  assert.ok(catalog)
  assert.equal(Object.keys(catalog).length, 47)
  assert.ok(Object.isFrozen(catalog), 'composed catalog must be frozen')
  for (const name of [
    'session/created',
    'session/disposed',
    'session/event',
    'session/flush',
  ]) {
    assert.ok(catalog[name], `${name} must be present in the composed catalog`)
  }

  const listener = () => {}
  state.pluginApi.events.on('goal/changed', listener)
  assert.ok(state.listeners.some((l) => l.name === 'goal/changed'))
})

test('services.web passes providers through to the official web service unchanged', () => {
  const { ctx, state, web } = createMockCtx()
  apply(ctx)

  const searchProvider = { id: 'search-1' }
  const fetchProvider = { id: 'fetch-1' }

  const searchResult = state.pluginApi.services.web.registerSearchProvider(searchProvider)
  const fetchResult = state.pluginApi.services.web.registerFetchProvider(fetchProvider)

  assert.equal(web.searchProviderCalls.length, 1)
  assert.equal(web.searchProviderCalls[0], searchProvider)
  assert.equal(searchResult, web.searchDisposer)

  assert.equal(web.fetchProviderCalls.length, 1)
  assert.equal(web.fetchProviderCalls[0], fetchProvider)
  assert.equal(fetchResult, web.fetchDisposer)
})

test('events guard failure disables only events and keeps facade active', () => {
  const { ctx, state } = createMockCtx({ events: false })
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)
  const features = state.pluginApi.features



  assert.equal(features.length, 17)
  assert.deepEqual(features[0], { name: 'tools', isActive: true })
  assert.equal(features[1].name, 'events')
  assert.equal(features[1].isActive, false)
  assert.match(features[1].reason, /ctx\.waterfall/)
  assert.deepEqual(features[2], { name: 'agent', isActive: true })
  assert.deepEqual(features[3], { name: 'llm', isActive: true })
  assert.deepEqual(features[4], { name: 'llm/request', isActive: true })
  assert.deepEqual(features[5], { name: 'llm/admission', isActive: true })
  assert.equal(features[6].name, 'session')
  assert.equal(features[6].isActive, false)
  assert.equal(features[7].name, 'sessionDurable')
  assert.equal(features[7].isActive, false)
  assert.equal(features[8].name, 'execRoute')
  assert.equal(features[8].isActive, false)
  assert.deepEqual(features[9].name, 'sessionRoute')
  assert.equal(features[9].isActive, false)
  assert.deepEqual(features[10], { name: 'settings', isActive: true })
  assert.deepEqual(features[11], { name: 'systemPrompt', isActive: true })
  assert.deepEqual(features[12], { name: 'services', isActive: true })
  assert.equal(features[13].name, 'typert')
  assert.equal(features[13].isActive, false)
  assert.equal(features[14].name, 'settingsRemote')
  assert.equal(features[14].isActive, false)
  assert.equal(features[15].name, 'remote')
  assert.equal(features[15].isActive, false)
  assert.equal(features[16].name, 'execution')
  assert.equal(features[16].isActive, true)

  assert.throws(
    () => state.pluginApi.events.on('goal/changed', () => {}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'events')
      return true
    },
  )
  assert.equal(typeof state.pluginApi.services.web.registerSearchProvider, 'function')
})

test('web service absence keeps the services feature active while disabling only the web facade', () => {
  const { ctx, state } = createMockCtx({ web: false })
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)
  const features = state.pluginApi.features

  assert.equal(features.length, 17)
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
  assert.deepEqual(features[10], { name: 'settings', isActive: true })
  assert.deepEqual(features[11], { name: 'systemPrompt', isActive: true })
  assert.equal(features[12].name, 'services')
  assert.equal(features[12].isActive, true)
  assert.equal(state.pluginApi.services.web.isActive, false)
  assert.throws(
    () => state.pluginApi.services.web.registerSearchProvider({}),
    (error) => error.feature === 'services.web',
  )
  assert.equal(features[13].name, 'typert')
  assert.equal(features[13].isActive, false)
  assert.equal(features[14].name, 'settingsRemote')
  assert.equal(features[14].isActive, false)
  assert.equal(features[15].name, 'remote')
  assert.equal(features[15].isActive, false)
  assert.equal(features[16].name, 'execution')
  assert.equal(features[16].isActive, true)

  // the disabled services namespace throws typed errors for web too
  assert.throws(
    () => state.pluginApi.services.web.registerSearchProvider({}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'services.web')
      return true
    },
  )
  assert.equal(typeof state.pluginApi.events.on, 'function')
})

const HOST_EVENT_LEAF_NAMES = [
  'agent-loop/config-start-failed',
  'agent-preset/selected',
  'cordis/dynamic-package',
  'cordis/dynamic-retract',
  'cordis/request-run',
  'cordis/request-run-resolved',
  'cordis/inspect-query',
  'cordis/inspect-query-resolved',
  'domain/changed',
]

function createHostEventProducers() {
  const producer = () => ({ marker: true })
  return {
    agentLoop: producer(),
    agentPresets: producer(),
    dynamicCordisRunner: producer(),
    cordisInspect: producer(),
    storageDomain: producer(),
  }
}

test('available host event producers contribute exactly nine catalog rows with the fixed schema', () => {
  const { ctx, state } = createMockCtx({ services: createHostEventProducers() })
  apply(ctx)
  const catalog = state.pluginApi.events.catalog
  assert.equal(Object.keys(catalog).length, 47 + HOST_EVENT_LEAF_NAMES.length)
  for (const name of HOST_EVENT_LEAF_NAMES) {
    const entry = catalog[name]
    assert.ok(entry, `${name} is cataloged`)
    assert.equal(entry.mode, 'emit')
    assert.equal(entry.scopeFiltered, false)
    assert.equal(entry.scopeKey, undefined)
    assert.equal(entry.fault, 'contain')
    assert.equal(entry.freeze, 'all')
    assert.ok(Object.isFrozen(entry), `${name} entry stays frozen`)
  }
})

test('missing host event producers keep the catalog at the baseline 47 rows', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const catalog = state.pluginApi.events.catalog
  assert.equal(Object.keys(catalog).length, 47)
  for (const name of HOST_EVENT_LEAF_NAMES) {
    assert.equal(catalog[name], undefined, `${name} stays omitted when its producer is absent`)
  }
})

test('malformed host event producers omit only their own rows', () => {
  const { ctx, state } = createMockCtx({
    services: {
      ...createHostEventProducers(),
      storageDomain: undefined,
      agentLoop: null,
    },
  })
  apply(ctx)
  const catalog = state.pluginApi.events.catalog
  assert.equal(catalog['domain/changed'], undefined)
  assert.equal(catalog['agent-loop/config-start-failed'], undefined)
  assert.equal(catalog['agent-preset/selected'] !== undefined, true)
  assert.equal(catalog['cordis/request-run'] !== undefined, true)
  assert.equal(Object.keys(catalog).length, 47 + 7)
})
