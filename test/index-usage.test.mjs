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
    ...(options.tokenMeter ? { tokenMeter: { measure() {}, estimateMessage() {} } } : {}),
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

test('healthy apply activates the usage feature after execution with one intake listener', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const feature = state.pluginApi.features.find((entry) => entry.name === 'usage')
  assert.equal(feature?.isActive, true)
  const execFeature = state.pluginApi.features.find((entry) => entry.name === 'execution')
  assert.equal(execFeature?.isActive, true)
  assert.equal(typeof state.pluginApi.usage.record, 'function')
  assert.equal(typeof state.pluginApi.usage.pricing.register, 'function')
  assert.equal(typeof state.pluginApi.usage.query, 'function')
  // mount order guarantee: usage mounts after execution (index positions)
  const order = state.pluginApi.features.map((entry) => entry.name)
  assert.ok(order.indexOf('execution') < order.indexOf('usage'))
  // exactly one provider-confirmed intake listener on llm/stream
  const llmListeners = state.listeners.filter((l) => l.name === 'llm/stream').length
  assert.ok(llmListeners >= 1)
})

test('usage records and settles through the mounted face after apply', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  state.pluginApi.usage.pricing.register({ provider: 'deepseek', model: 'deepseek-chat', revision: 'v1', currency: 'USD', rates: { input: 1 } })
  assert.equal(
    state.pluginApi.usage.record(
      {
        sampleId: 's-1',
        operationId: 'op-1',
        executionId: 'exec-1',
        attempt: 1,
        provider: 'deepseek',
        model: 'deepseek-chat',
        metrics: { input: 7 },
        source: 'provider-confirmed',
        observedAt: '2026-08-24T00:00:00.000Z',
      },
      { ownerId: 'o', generation: 'g', operationId: 'op-1', scope: 'session' },
    ).status,
    'committed',
  )
  const settled = state.pluginApi.usage.settle('exec-1', { attempts: [1], ownerId: 'o', generation: 'g', operationId: 'op-1', scope: 'session' })
  assert.equal(settled.status, 'settled')
  const page = state.pluginApi.usage.query({ sessionId: 'sess-1' })
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].scope, 'session')
})

test('repeated apply retains the active usage feature without duplicate intake listeners', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const before = state.listeners.filter((l) => l.name === 'llm/stream').length
  apply(ctx)
  const after = state.listeners.filter((l) => l.name === 'llm/stream').length
  assert.equal(after, before)
  const feature = state.pluginApi.features.find((entry) => entry.name === 'usage')
  assert.equal(feature?.isActive, true)
})

test('the llm/stream intake listener is a non-intrusive pass-through', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  let nextCalls = 0
  const value = { chunks: [1, 2, 3] }
  const result = (() => {
    for (const entry of state.listeners) {
      if (entry.name !== 'llm/stream') continue
      // each registered listener must call next() exactly once and return its value
      const returned = entry.listener({}, () => {
        nextCalls += 1
        return value
      })
      if (returned !== undefined) return returned
    }
    return undefined
  })()
  assert.equal(result, value)
  assert.ok(nextCalls >= 1, 'each llm/stream listener invokes next exactly once')
})

test('a missing ctx.on disables usage without throwing through apply', () => {
  const { ctx, state } = createMockCtx({ tokenMeter: true })
  ctx.on = undefined
  const before = (state.pluginApi?.features ?? []).map((entry) => entry.name)
  assert.doesNotThrow(() => apply(ctx))
  const after = state.pluginApi?.features ?? before
  const usage = after.find((entry) => entry.name === 'usage')
  assert.ok(usage === undefined || usage.isActive === false, 'usage must not be active when ctx.on is missing')
})

test('usage availability reflects correlation/tokenMeter sources after apply', () => {
  const { ctx, state } = createMockCtx({ tokenMeter: true })
  apply(ctx)
  const execFeature = state.pluginApi.features.find((entry) => entry.name === 'execution')
  assert.equal(execFeature?.isActive, true) // EO active -> correlation available
  assert.equal(state.pluginApi.usage.availability.sources.correlation, 'available')
  assert.equal(state.pluginApi.usage.availability.sources.tokenMeter, 'available')
})
