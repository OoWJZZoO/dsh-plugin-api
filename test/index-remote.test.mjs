import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

function noOp() {}

function createTypertRegistry() {
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
    : { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} }
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
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
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
    providedServices: [],
  }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') {
          state.pluginApi = value
          state.provideCount += 1
          return () => {}
        }
        state.providedServices.push({ name, value })
        return () => {
          const index = state.providedServices.findIndex((s) => s.name === name && s.value === value)
          if (index >= 0) state.providedServices.splice(index, 1)
          return true
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

test('apply mounts remote then the observation faces (execution, diagnostics) and exposes pluginApi.remote', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const names = state.pluginApi.features.map((f) => f.name)
  assert.ok(names.includes('remote'), 'remote feature listed')
  assert.equal(names.indexOf('remote'), names.indexOf('settingsRemote') + 1, 'remote mounts after settingsRemote')
  assert.equal(names[names.length - 6], 'remote', 'remote stays directly before execution')
  assert.equal(names[names.length - 5], 'execution', 'execution stays directly before recovery')
  assert.equal(names[names.length - 4], 'recovery', 'recovery stays directly before coordination')
  assert.equal(names[names.length - 3], 'coordination', 'coordination stays directly before diagnostics')
  assert.equal(names[names.length - 2], 'diagnostics', 'diagnostics stays directly before usage')
  assert.equal(names[names.length - 1], 'usage', 'usage is the last FEATURE_MOUNTERS entry')
  assert.equal(state.pluginApi.remote.isActive, true)
  assert.equal(typeof state.pluginApi.remote.publish, 'function')
  assert.equal(typeof state.pluginApi.remote.dispose, 'function')
})

test('pluginApi.remote and pluginApi.settings.remote coexist without overriding each other', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  // Settings remote surface intact.
  assert.equal(typeof state.pluginApi.settings.remote, 'function')
  // Generic top-level surface intact (its own owner semantics, AC 5.4).
  assert.equal(typeof state.pluginApi.remote.publish, 'function')
  assert.notEqual(state.pluginApi.settings.remote, state.pluginApi.remote.publish)
})

test('remote feature is active while the facade is active (known feature, not disabled)', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const feature = state.pluginApi.features.find((f) => f.name === 'remote')
  assert.deepEqual(feature, { name: 'remote', isActive: true })
  assert.equal(state.pluginApi.remote.isActive, true)
})

test('a healthy generic publish through the mounted facade registers the service via ctx.reflect.provide', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const service = { get() { return { value: { enabled: true } } }, set() { return { ok: true } } }
  const disposer = state.pluginApi.remote.publish('extraproAnchorConfig', service)
  assert.equal(typeof disposer, 'function')
  const published = state.providedServices.find((s) => s.name === 'extraproAnchorConfig')
  assert.ok(published, 'service published through official boundary')
  disposer()
})

test('apply stays fail-safe (feature-disabled disabled surface) when the typert protocol is unavailable', () => {
  // A ctx whose typert registry is absent means the `typert` guard fails closed;
  // `remote` depends on `typert` and must not crash apply or break other features.
  const { ctx, state } = createMockCtx({ services: { typert: undefined } })
  assert.doesNotThrow(() => apply(ctx))
  assert.ok(state.pluginApi)
  // `remote` is not active because its typert prerequisite is missing, but the
  // surface still exists (disabled shape) and apply never threw.
  const feature = state.pluginApi.features.find((f) => f.name === 'remote')
  assert.ok(!feature || feature.isActive === false)
  assert.equal(state.pluginApi.remote.isActive, false)
  assert.throws(() => state.pluginApi.remote.publish('k', { get() {} }), PluginApiFeatureDisabledError)
})

test('apply never throws even when remote guard primitives are malformed', () => {
  const { ctx, state } = createMockCtx({ services: { typert: {} } })
  assert.doesNotThrow(() => apply(ctx))
  assert.ok(state.pluginApi)
  const feature = state.pluginApi.features.find((f) => f.name === 'remote')
  assert.ok(!feature || feature.isActive === false, 'remote disabled rather than crashing apply')
})
