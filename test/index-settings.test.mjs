import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import {
  PluginApiFeatureDisabledError,
  PluginApiServiceUnavailableError,
} from '../lib/errors.js'

function createSettingsService() {
  const registerCalls = []
  return {
    registerCalls,
    register(ns, schema, options) {
      registerCalls.push({ ns, schema, options })
      return {
        get: () => ({ ns }),
        watch: () => () => {},
        update: async () => {},
        replace: async () => {},
      }
    },
    describe() {
      return []
    },
    get() {
      return undefined
    },
    mutate: async () => {},
  }
}

function createMockCtx(options = {}) {
  const settings = options.settings === undefined
    ? createSettingsService()
    : options.settings

  const services = {
    llm: { resolveModelInfo() {} },
    agents: { get() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: {
      registerSearchProvider() {},
      registerFetchProvider() {},
      search() {},
      fetch() {},
    },
  }
  if (settings !== null) services.settings = settings

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

test('apply mounts settings feature when settings service is complete', () => {
  const { ctx, state, services } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)
  assert.equal(state.pluginApi.settings.availability().status, 'degraded')
  assert.equal(typeof state.pluginApi.settings.register, 'function')
  assert.equal(typeof state.pluginApi.settings.scope, 'function')
  assert.equal(typeof state.pluginApi.settings.inspect, 'function')
  assert.equal('installSettingsSection' in state.pluginApi.settings, false, 'the deleted member is absent')

  const handle = state.pluginApi.settings.register('my-plugin', {})
  assert.equal(services.settings.registerCalls.length, 1)
  assert.equal(services.settings.registerCalls[0].ns, 'my-plugin')
  assert.equal(state.pluginApi.settings.scope('my-plugin'), handle)
})

test('apply keeps settings feature active in optional-settings mode and methods report unavailable', () => {
  const { ctx, state } = createMockCtx({ settings: null })
  assert.doesNotThrow(() => apply(ctx))

  assert.equal(state.pluginApi.settings.availability().status, 'degraded')
  assert.throws(() => state.pluginApi.settings.register('a', {}), PluginApiServiceUnavailableError)
  assert.throws(() => state.pluginApi.settings.scope('a'), PluginApiServiceUnavailableError)
  assert.throws(() => state.pluginApi.settings.inspect(), PluginApiServiceUnavailableError)
  assert.equal('installSettingsSection' in state.pluginApi.settings, false, 'the deleted member is absent')
})

test('settings guard failure disables only settings and keeps facade active', () => {
  const settings = createSettingsService()
  delete settings.describe
  const { ctx, state } = createMockCtx({ settings })
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)
  const feature = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((entry) => entry.name === 'settings')
  assert.ok(feature)
  assert.equal(feature.isActive, false)
  assert.match(feature.reason, /settings\.describe/)

  assert.throws(
    () => state.pluginApi.settings.register('a', {}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'settings')
      return true
    },
  )
})

test('re-applying the host plugin is idempotent for the settings feature', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const firstSettings = state.pluginApi.settings
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(state.pluginApi.settings, firstSettings)
  assert.equal(state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').filter((entry) => entry.name === 'settings').length, 1)
})
