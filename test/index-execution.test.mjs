import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

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
  const services = {
    llm: {
      resolveModelInfo() {}, prepareCall() {}, stream() {},
      registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {},
    },
    agents: { get() {}, list() {}, roots() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    sessions: { get() {}, list() {}, fork() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    typert: createTypertRegistry(),
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
  }
  const state = { pluginApi: undefined, effects: [], listeners: [] }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      if (name in services) return services[name]
      return undefined
    },
    plugin(Class) { new Class(ctx) },
    effect(fn, label) { state.effects.push({ fn, label }) },
    on(name, listener) {
      state.listeners.push({ name, listener })
      return () => {}
    },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  return { ctx, state }
}

function emit(state, name, ...args) {
  for (const entry of state.listeners.filter((l) => l.name === name)) entry.listener(...args)
  return undefined
}

test('healthy apply activates the execution feature with one set of source listeners', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const feature = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((entry) => entry.name === 'execution')
  assert.equal(feature?.isActive, true)
  assert.equal(typeof state.pluginApi.executions.observe, 'function')
  for (const name of ['tools/pre-execute', 'tools/result', 'agent/request', 'llm/stream', 'session/created']) {
    assert.ok(state.listeners.some((l) => l.name === name), `expected execution listener ${name}`)
  }
})

test('execution source events produce a committed projection through the mounted face', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const exec = { agent: { session: { id: 's1' } } }
  emit(state, 'tools/pre-execute', exec, () => {})
  emit(state, 'tools/result', exec, { value: 1 })
  const page = state.pluginApi.executions.history('s1')
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].outcome, 'success')
})

test('repeated apply retains the active execution feature without duplicate listeners', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const before = state.listeners.filter((l) => l.name === 'tools/pre-execute').length
  apply(ctx)
  const after = state.listeners.filter((l) => l.name === 'tools/pre-execute').length
  assert.equal(after, before)
  const feature = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((entry) => entry.name === 'execution')
  assert.equal(feature?.isActive, true)
})

test('a missing ctx.on disables execution without throwing through apply', () => {
  const { ctx, state } = createMockCtx()
  ctx.on = undefined
  assert.doesNotThrow(() => apply(ctx))
  assert.ok(state.pluginApi)
  const feature = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((entry) => entry.name === 'execution')
  assert.ok(feature)
  assert.equal(feature.isActive, false)
})

test('execution does not add new events catalog entries', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  assert.equal(Object.keys(state.pluginApi.events.catalog).length, 47)
})
