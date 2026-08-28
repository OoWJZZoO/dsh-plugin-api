import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

function createMockCtx({ systemPrompt = true } = {}) {
  const state = { pluginApi: undefined, effects: [], listeners: [] }
  const officialSystemPrompt = systemPrompt
    ? {
        section() { return 'section-disposer' },
        context() { return 'context-disposer' },
        variable() { return 'variable-disposer' },
        tools() { return 'tools-disposer' },
        suppressRuntimeContext() { return 'suppress-disposer' },
      }
    : undefined
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
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    sessions: { get() {}, list() {}, fork() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    ...(officialSystemPrompt ? { systemPrompt: officialSystemPrompt } : {}),
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
      return services[name]
    },
    plugin(ServiceClass) { new ServiceClass(ctx) },
    effect(fn, label) { state.effects.push({ fn, label }) },
    on(name, listener) { state.listeners.push({ name, listener }); return () => {} },
    once() {},
    emit() {},
    serial() {},
    parallel() {},
    bail() {},
    waterfall() {},
  }
  return { ctx, state }
}

test('apply exposes both public system-prompt helpers with the installed official namespace', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))

  const assembly = {
    sections: [],
    contexts: [{ name: 'runtime', text: 'hello' }],
    tools: [],
    variables: {},
  }
  const sections = [{ name: 'runtime', text: 'hello' }]
  assert.equal(
    state.pluginApi.prompts.renderContextSnapshot(assembly),
    'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nhello',
  )
  assert.equal(
    state.pluginApi.prompts.joinContextSections(sections),
    'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nhello',
  )
  assert.equal(state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').some(({ name }) => name === 'officialPassthrough'), false)
  assert.ok(state.effects.some(({ label }) => label === 'dsh-plugin-api: officialPassthrough cleanup'))
})

test('a missing base system-prompt service does not disable valid helper exports', () => {
  const { ctx, state } = createMockCtx({ systemPrompt: false })
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(state.pluginApi.prompts.isActive, false)

  const assembly = { sections: [], contexts: [], tools: [], variables: {} }
  assert.equal(state.pluginApi.prompts.renderContextSnapshot(assembly), '')
  assert.throws(
    () => state.pluginApi.prompts.section({}),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'prompts',
  )
})

test('official helper cleanup and reapply revoke old references without disturbing the new owner', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const oldSurface = state.pluginApi.prompts
  const oldEffect = state.effects.find(({ label }) => label === 'dsh-plugin-api: officialPassthrough cleanup').fn
  const oldCleanup = oldEffect()
  oldCleanup()

  assert.throws(
    () => oldSurface.joinContextSections([]),
    (error) => error instanceof PluginApiFeatureDisabledError
      && error.feature === 'systemPrompt.joinContextSections',
  )

  apply(ctx)
  const newSurface = state.pluginApi.prompts
  assert.notEqual(newSurface, oldSurface)
  assert.equal(newSurface.joinContextSections([]), '')

  oldCleanup()
  assert.equal(state.pluginApi.prompts, newSurface)
  assert.equal(state.pluginApi.prompts.joinContextSections([]), '')
})
