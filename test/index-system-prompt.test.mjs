import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

function createMockCtx(options = {}) {
  const systemPrompt = options.systemPrompt === false
    ? undefined
    : {
        sectionCalls: [],
        section(section) {
          systemPrompt.sectionCalls.push(section)
          return systemPrompt.sectionDisposer
        },
        context() { return 'context-disposer' },
        variable() { return 'variable-disposer' },
        tools() { return 'tools-disposer' },
        suppressRuntimeContext() { return 'suppress-disposer' },
        sectionDisposer: () => {},
      }

  const web = {
    registerSearchProvider() { return () => {} },
    registerFetchProvider() { return () => {} },
  }
  const services = {
    loader: { entries() { return [] } },
    llm: {
      resolveModelInfo() {},
      prepareCall() {},
      stream() {},
      registerAdapter() {},
      registerConfigurableProviders() {},
      registerModelDiscovery() {},
    },
    agents: { get() {}, list() {}, roots() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    sessions: { get() {}, list() {}, fork() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web,
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(options.services ?? {}),
  }
  const state = {
    pluginApi: undefined,
    effects: [],
    listeners: [],
  }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') state.pluginApi = value
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
  return { ctx, state, services, systemPrompt }
}

test('apply mounts the systemPrompt API and core-inactive calls forward to the official service', () => {
  const { ctx, state, systemPrompt } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)
  assert.equal(state.pluginApi.prompts.isActive, true)

  const section = { name: 's1', order: 1, text: 'hello' }
  assert.equal(state.pluginApi.prompts.section(section), systemPrompt.sectionDisposer)
  assert.equal(systemPrompt.sectionCalls.length, 2, 'the facade hint section registers first')
  assert.equal(systemPrompt.sectionCalls.at(-1), section)

  assert.equal(state.pluginApi.prompts.context({ name: 'c1', order: 2, text: 'ctx' }), 'context-disposer')
  assert.equal(state.pluginApi.prompts.variable('v', () => 'x'), 'variable-disposer')
  assert.equal(state.pluginApi.prompts.tools(() => ({ schemas: [] })), 'tools-disposer')
  assert.equal(state.pluginApi.prompts.suppressRuntimeContext(), 'suppress-disposer')
})

test('systemPrompt guard failure disables only systemPrompt and keeps the facade active', () => {
  const { ctx, state } = createMockCtx({ systemPrompt: false })
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)
  const features = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough')
assert.equal(features.length, 31)
  assert.deepEqual(features[0], { name: 'tools', isActive: true })
  assert.deepEqual(features[1], { name: 'events', isActive: true })
  assert.deepEqual(features[2], { name: 'agent', isActive: true })
  assert.deepEqual(features[3], { name: 'llm', isActive: true })
  assert.deepEqual(features[4], { name: 'llm/request', isActive: true })
  assert.deepEqual(features[5], { name: 'llm/admission', isActive: true })
  assert.deepEqual(features[6], { name: 'security', isActive: true })
  assert.deepEqual(features[7], { name: 'session', isActive: true })
  assert.deepEqual(features[8], { name: 'sessionBranch', isActive: false, reason: 'sessionBranch: feature mount did not produce a disposer; feature disabled' })
  assert.deepEqual(features[9], { name: 'sessionDurable', isActive: true })
  assert.deepEqual(features[10], { name: 'execRoute', isActive: true })
  assert.deepEqual(features[11], { name: 'sessionRoute', isActive: true })
  assert.deepEqual(features[12], { name: 'settings', isActive: true })
  assert.equal(features[13].name, 'systemPrompt')
  assert.equal(features[13].isActive, false)
  assert.match(features[13].reason, /systemPrompt\.service/)
  assert.deepEqual(features[14], { name: 'services', isActive: true })
assert.equal(features[25].name, 'toolDiscovery')
  assert.equal(features[25].isActive, false)
  assert.match(features[25].reason, /systemPrompt/)
  assert.equal(features[26].name, 'skillsActivation')
  assert.equal(features[27].name, 'context')
  assert.equal(features[28].name, 'profile')


  assert.throws(
    () => state.pluginApi.prompts.section({ name: 's', order: 0, text: 'x' }),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'prompts')
      return true
    },
  )
  assert.equal(typeof state.pluginApi.events.on, 'function')
})

test('apply is idempotent for the systemPrompt feature mount', () => {
  const { ctx, state, systemPrompt } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  assert.doesNotThrow(() => apply(ctx))

  assert.equal(state.pluginApi.prompts.isActive, true)
  const section = { name: 's1', order: 1, text: 'hello' }
  assert.equal(state.pluginApi.prompts.section(section), systemPrompt.sectionDisposer)
})
