import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

function createMockCtx(options = {}) {
  const web = {
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

  const sessions = options.sessions === false
    ? undefined
    : {
        get() {},
        list() {},
        fork() {},
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
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web,
    ...(sessions ? { sessions } : {}),
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
      return () => false
    },
    once(name, listener) {
      state.listeners.push({ name, listener, once: true })
      return () => false
    },
    emit() {},
    serial() {},
    parallel() {},
    bail() {},
    waterfall() {},
  }

  return { ctx, state, services, web, sessions }
}

test('apply mounts session after events with a composed events catalog', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)

  const catalog = state.pluginApi.events.catalog
  assert.ok(catalog, 'events catalog must exist')
  assert.equal(Object.keys(catalog).length, 47)
  assert.ok(Object.isFrozen(catalog), 'composed catalog must be frozen')
  for (const name of [
    'session/created',
    'session/disposed',
    'session/event',
    'session/flush',
  ]) {
    assert.ok(catalog[name], `${name} must be in the composed catalog`)
  }

  assert.equal(state.pluginApi.session.isActive, true)
  const listener = () => {}
  state.pluginApi.session.on('session/event', listener)
  assert.ok(state.listeners.some((l) => l.name === 'session/event'), 'session/event must register a native hook')

  assert.ok(Array.isArray(state.pluginApi.session.sessionEventTypes))
  assert.ok(Object.isFrozen(state.pluginApi.session.sessionEventTypes))
  assert.ok(Array.isArray(state.pluginApi.session.surfaceEventTypes))
  assert.ok(Object.isFrozen(state.pluginApi.session.surfaceEventTypes))
  assert.equal(typeof state.pluginApi.session.get, 'function')
  assert.equal(typeof state.pluginApi.session.fork, 'function')
  assert.equal(typeof state.pluginApi.session.header, 'function')
  assert.equal(typeof state.pluginApi.session.deriveMessages, 'function')
  assert.equal(typeof state.pluginApi.session.isSessionEventType, 'function')
})

test('session guard failure disables only session and keeps the facade active', () => {
  const { ctx, state } = createMockCtx({ sessions: false })
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)

  const features = state.pluginApi.features
  assert.equal(features.length, 9)
  assert.deepEqual(features.map((f) => f.name), ['tools', 'events', 'agent', 'session', 'web', 'llm', 'systemPrompt', 'llm/admission', 'settings'])
  assert.equal(features[0].isActive, true)
  assert.equal(features[1].isActive, true)
  assert.equal(features[2].isActive, true)
  assert.equal(features[3].isActive, false)
  assert.match(features[3].reason, /sessions\.get/)
  assert.equal(features[4].isActive, true)
  assert.equal(features[5].isActive, true)
  assert.equal(features[6].isActive, true)
  assert.equal(features[7].isActive, true)
  assert.equal(features[8].isActive, true)

  assert.throws(
    () => state.pluginApi.session.get('s1'),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'session')
      return true
    },
  )

  assert.equal(typeof state.pluginApi.events.on, 'function')
  assert.equal(typeof state.pluginApi.web.registerSearchProvider, 'function')
  assert.equal(typeof state.pluginApi.llm.admission.register, 'function')
})
