import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

function createMockCtx(options = {}) {
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
    llm: { resolveModelInfo() {} },
    agents: { get() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    sessions: { get() {}, list() {}, fork() {} },
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
  return { ctx, state, services, web }
}

test('apply mounts events with the frozen catalog and usable bus', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)

  const catalog = state.pluginApi.events.catalog
  assert.ok(catalog)
  assert.equal(Object.keys(catalog).length, 23)
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

test('web API passes providers through to the official web service unchanged', () => {
  const { ctx, state, web } = createMockCtx()
  apply(ctx)

  const searchProvider = { id: 'search-1' }
  const fetchProvider = { id: 'fetch-1' }

  const searchResult = state.pluginApi.web.registerSearchProvider(searchProvider)
  const fetchResult = state.pluginApi.web.registerFetchProvider(fetchProvider)

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
  assert.equal(features.length, 4)
  assert.equal(features[0].name, 'events')
  assert.equal(features[0].isActive, false)
  assert.match(features[0].reason, /ctx\.waterfall/)
  assert.equal(features[1].name, 'session')
  assert.equal(features[1].isActive, false)
  assert.deepEqual(features[2], { name: 'web', isActive: true })
  assert.deepEqual(features[3], { name: 'llm/admission', isActive: true })

  assert.throws(
    () => state.pluginApi.events.on('goal/changed', () => {}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'events')
      return true
    },
  )
  assert.equal(typeof state.pluginApi.web.registerSearchProvider, 'function')
})

test('web guard failure disables only web and keeps facade active', () => {
  const { ctx, state } = createMockCtx({ web: false })
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)
  const features = state.pluginApi.features
  assert.equal(features.length, 4)
  assert.deepEqual(features[0], { name: 'events', isActive: true })
  assert.deepEqual(features[1], { name: 'session', isActive: true })
  assert.equal(features[2].name, 'web')
  assert.equal(features[2].isActive, false)
  assert.match(features[2].reason, /registerSearchProvider/)
  assert.deepEqual(features[3], { name: 'llm/admission', isActive: true })

  assert.throws(
    () => state.pluginApi.web.registerSearchProvider({}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'web')
      return true
    },
  )
  assert.equal(typeof state.pluginApi.events.on, 'function')
})
