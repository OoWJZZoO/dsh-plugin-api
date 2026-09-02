import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

function createMockCtx(options = {}) {
  const services = {
    loader: { entries() { return [] } },
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
    ...(options.services ?? {}),
  }
  const state = { pluginApi: undefined, listeners: [], effects: [], errors: [] }
  const ctx = {
    logger: { error(message) { state.errors.push(message) }, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect(fn, label) {
      if (options.effectThrows) throw new Error('effect registration failed')
      state.effects.push({ fn, label })
    },
    on(name, listener, eventOptions) {
      const entry = { name, listener, eventOptions }
      state.listeners.push(entry)
      return () => {
        const index = state.listeners.indexOf(entry)
        if (index >= 0) state.listeners.splice(index, 1)
      }
    },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  return { ctx, state, services }
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve))
}

function featureOf(state, name) {
  return state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((entry) => entry.name === name)
}

test('healthy apply mounts diagnostics after remote and exposes a working projection', async () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const diagnostics = featureOf(state, 'diagnostics')
  assert.ok(diagnostics)
  assert.equal(diagnostics.isActive, true)

  const names = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').map((entry) => entry.name)
assert.equal(names.indexOf('diagnostics'), names.indexOf('workspaceTransactions') + 1, 'diagnostics mounts directly after workspaceTransactions')
  assert.equal(names[names.length - 8], 'diagnostics', 'diagnostics mounts directly before tasks')
  assert.equal(names[names.length - 7], 'tasks', 'tasks stays directly before toolDiscovery')
  assert.equal(names[names.length - 6], 'toolDiscovery', 'tool discovery mounts directly before skillsActivation')
  assert.equal(names[names.length - 5], 'skillsActivation', 'skills activation mounts directly before context')
  assert.equal(names[names.length - 4], 'context', 'context mounts directly before profile')
  assert.equal(names[names.length - 3], 'profile', 'profile stays directly before llmAdapters')
  assert.equal(names[names.length - 2], 'llmAdapters', 'adapter decoration mounts directly before sessionChannel')
  assert.equal(names[names.length - 1], 'sessionChannel', 'sessionChannel is the last FEATURE_MOUNTERS entry')


  const diag = state.pluginApi.diagnostics
  assert.equal(typeof diag.register, 'function')
  assert.equal(typeof diag.get, 'function')
  assert.equal(typeof diag.observe, 'function')

  const dispose = diag.register({
    ownerId: 'o', checkId: 'c', scope: 'plugin',
    run() { return { health: 'healthy', availability: 'active' } },
  })
  await settle()
  const view = diag.get({ scope: 'plugin' })
  assert.equal(view.checks.length, 1)
  assert.equal(view.checks[0].health, 'healthy')
  assert.equal(Object.isFrozen(view), true)
  assert.equal(dispose(), true)

  // host scope exposes the bounded facade aggregate
  const host = diag.get({ scope: 'host' })
  assert.ok(host.checks.some((check) => check.ownerId === 'facade'))
})

test('re-applying is idempotent and never duplicates the diagnostics feature', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  apply(ctx)
  const diagnostics = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').filter((entry) => entry.name === 'diagnostics')
  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].isActive, true)
})

test('a sibling feature failing keeps the diagnostics feature and the rest of the facade active', () => {
  const { ctx, state } = createMockCtx({ services: { tools: undefined } })
  assert.doesNotThrow(() => apply(ctx))
  const tools = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((entry) => entry.name === 'tools')
  const diagnostics = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((entry) => entry.name === 'diagnostics')
  assert.ok(tools)
assert.equal(tools.isActive, false)
  assert.ok(diagnostics)
  assert.equal(diagnostics.isActive, true)
  assert.equal(typeof state.pluginApi.diagnostics.get, 'function')
})

test('a failing cleanup registration leaves the feature inert and apply returns normally with a typed disabled surface', () => {
  const { ctx, state } = createMockCtx({ effectThrows: true })
  assert.doesNotThrow(() => apply(ctx))
  const diagnostics = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((entry) => entry.name === 'diagnostics')
  assert.ok(diagnostics)
  assert.equal(diagnostics.isActive, false)
  // The disabled surface never returns silent data: it throws a typed error.
  assert.throws(() => state.pluginApi.diagnostics.get({ scope: 'plugin' }), PluginApiFeatureDisabledError)
  assert.throws(() => state.pluginApi.diagnostics.register({ ownerId: 'o', checkId: 'c', scope: 'plugin', run() {} }), PluginApiFeatureDisabledError)
})
