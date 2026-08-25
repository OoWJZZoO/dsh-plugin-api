import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { runFeatureGuard } from '../lib/guards.js'
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

function createMockCtx({ services: extra = {}, systemPrompt = true } = {}) {
  const systemPromptService = systemPrompt === false
    ? undefined
    : { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} }
  const services = {
    loader: { entries() { return [] } },
    llm: {
      resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {},
      registerConfigurableProviders() {}, registerModelDiscovery() {},
    },
    agents: { get() {}, list() {}, roots() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    sessions: { get() {}, list() {}, fork() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    typert: createTypertRegistry(),
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
    ...(systemPromptService ? { systemPrompt: systemPromptService } : {}),
    ...extra,
  }
  const state = { pluginApi: undefined, provideCount: 0, effects: [], listeners: [] }
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
    on(name, listener) { state.listeners.push({ name, listener }); return () => {} },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  return { ctx, state, services }
}

test('profile feature guard passes when the loader entries surface exists', () => {
  const result = runFeatureGuard('profile', { get: () => ({ entries() {} }) }, {})
  assert.equal(result.ok, true)
})

test('profile feature guard fails when ctx.get or the loader is missing', () => {
  const noGet = runFeatureGuard('profile', {}, {})
  assert.equal(noGet.ok, false)
  assert.ok(noGet.problems.some((p) => p.name === 'ctx.get'))
  const noLoader = runFeatureGuard('profile', { get: () => undefined }, {})
  assert.equal(noLoader.ok, false)
  assert.ok(noLoader.problems.some((p) => p.name === 'loader.entries'))
  const loaderWithoutEntries = runFeatureGuard('profile', { get: () => ({}) }, {})
  assert.equal(loaderWithoutEntries.ok, false)
})

test('profile members throw typed errors when the feature is disabled', () => {
  const { ctx, state } = createMockCtx({ services: { loader: undefined } })
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(state.pluginApi.isActive, true)
  const features = state.pluginApi.features
  const profileFeature = features.find((entry) => entry.name === 'profile')
  assert.equal(profileFeature.isActive, false)
  const profile = state.pluginApi.profile
  assert.throws(() => profile.inspect({ view: 'runtime' }), PluginApiFeatureDisabledError)
  assert.throws(() => profile.health('disk'), PluginApiFeatureDisabledError)
  assert.throws(() => profile.planDiff({ type: 'config', rows: [] }), PluginApiFeatureDisabledError)
  assert.throws(() => profile.apply({}), PluginApiFeatureDisabledError)
  assert.throws(() => profile.snapshot.create({}), PluginApiFeatureDisabledError)
})

test('inactive facade leaves the profile namespace inactive', () => {
  const previous = process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
  process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = '1'
  try {
    const { ctx, state } = createMockCtx()
    assert.doesNotThrow(() => apply(ctx))
    assert.equal(state.pluginApi.isActive, false)
    assert.throws(() => state.pluginApi.profile.inspect({ view: 'runtime' }), PluginApiInactiveError)
    assert.throws(() => state.pluginApi.profile.snapshot.create({}), PluginApiInactiveError)
  } finally {
    if (previous === undefined) delete process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
    else process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = previous
  }
})

test('profile mount failure degrades only profile and keeps unrelated features', () => {
  const { ctx, state } = createMockCtx()
  // Sabotage the inspection owner by making the loader throw at capture time;
  // the mount still succeeds (runtime view degrades), so the feature stays
  // active — the G1 container absorbs the loader failure.
  state.pluginApi = undefined
  ctx.services = undefined
  const services = {
    loader: { entries() { throw new Error('loader entries exploded') } },
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    agents: { get() {}, list() {}, roots() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    sessions: { get() {}, list() {}, fork() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    typert: createTypertRegistry(),
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
  }
  const ctx2 = {
    ...ctx,
    get(name) { if (name === 'pluginApi') return state.pluginApi; if (name in services) return services[name]; return undefined },
  }
  assert.doesNotThrow(() => apply(ctx2))
  const profileFeature = state.pluginApi.features.find((entry) => entry.name === 'profile')
  assert.equal(profileFeature.isActive, true)
  const view = state.pluginApi.profile.inspect({ view: 'runtime' })
  assert.equal(view.code, 'ok')
  assert.deepEqual(view.rows, [])
  assert.equal(state.pluginApi.tasks !== undefined, true)
})