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


test('apply mounts profile last with a working composed surface', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const features = state.pluginApi.features
  assert.equal(features[features.length - 2].name, 'profile')
  assert.equal(features[features.length - 2].isActive, true)
  assert.equal(features[features.length - 1].name, 'sessionChannel')

  const profile = state.pluginApi.profile
  assert.equal(typeof profile.inspect, 'function')
  assert.equal(typeof profile.health, 'function')
  assert.equal(typeof profile.planDiff, 'function')
  // stable namespace shape: mutation members exist (typed-disabled until the
  // mutation owner mounts).
  assert.equal(typeof profile.apply, 'function')
  assert.equal(typeof profile.snapshot.create, 'function')
  assert.equal(typeof profile.snapshot.modify, 'function')
  assert.equal(typeof profile.snapshot.validate, 'function')
  assert.equal(typeof profile.snapshot.delete, 'function')
  assert.equal(typeof profile.snapshot.apply, 'function')

  // runtime view works through the composed surface.
  const view = profile.inspect({ view: 'runtime' })
  assert.equal(view.code, 'ok')
  assert.equal(view.view, 'runtime')
})

test('repeated apply keeps profile mounted once (idempotent re-apply)', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(state.provideCount, 1)
  // the profile getter composes per access (agent style), so the surface
  // shape — not reference identity — is the stable contract.
  const profile = state.pluginApi.profile
  assert.equal(typeof profile.inspect, 'function')
  assert.equal(typeof profile.apply, 'function')
  assert.equal(typeof profile.snapshot.validate, 'function')
  const profileFeatures = state.pluginApi.features.filter((entry) => entry.name === 'profile')
  assert.equal(profileFeatures.length, 1)
})
