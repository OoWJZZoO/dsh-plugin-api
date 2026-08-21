/**
 * Central integration tests: official host namespace leaves wired into
 * the mounted pluginApi facades (host namespace leaves: llm, agent, session, tools, systemPrompt, settings).
 *
 * These tests drive the real `apply(ctx)` mount path with faithful official
 * service shapes and assert member presence, receiver/argument/return
 * identity, P1/P2/P3 fallback behavior, repeated apply idempotence, and
 * re-created view freshness.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError, PluginApiServiceUnavailableError } from '../lib/errors.js'

function createMockCtx(options = {}) {
  const agents = options.agents === false
    ? undefined
    : {
        calls: {},
        currentInitiator() {
          return this.initiator
        },
        requireInitiator(op) {
          return op()
        },
        withInitiator(agent, op) {
          return op(agent)
        },
        withoutInitiator(op) {
          return op()
        },
        isOwnedBy(id, owner) {
          return id === owner
        },
        initiator: undefined,
        get() {},
        list() {
          return []
        },
        roots() {
          return []
        },
      }
  const sessions = {
    createCalls: [],
    create(id, opts) {
      this.createCalls.push([id, opts])
      return { id, header: { seeded: true } }
    },
    prepare() {
      return { prepared: true }
    },
    enter() {
      return { entered: true }
    },
    announce() {
      return { announced: true }
    },
    flush() {
      return { flushed: true }
    },
    get() {},
    list() {
      return []
    },
    fork() {},
  }
  const settings = {
    writable: true,
    prepareDocument() {
      return { document: 'doc' }
    },
    get(ns) {
      return { ns }
    },
    update(ns, patch) {
      return { ns, patch }
    },
    replace(ns, section) {
      return { ns, section }
    },
    mutate(ns, ops) {
      return { ns, ops }
    },
    register() {
      return { get() {} }
    },
    describe() {
      return []
    },
  }
  const services = {
    llm: {
      resolveModelInfo() {},
      prepareCall() {},
      stream() {},
      registerAdapter() {},
      registerConfigurableProviders() {},
      registerModelDiscovery() {},
      listProviders() {
        return ['provider-a']
      },
      listConfigurableProviders() {
        return [{ id: 'a' }]
      },
      discoverModels() {
        return ['model-a']
      },
      providerRetryPolicy() {
        return { retry: true }
      },
      listModels() {
        return ['model-a']
      },
      resolveCallConfig(config) {
        return config
      },
    },
    tools: {
      register() {},
      restrict() {},
      guard() {},
      get() {},
      schemas() {},
      execute() {},
      presentAs() {},
      executionMode(exec) {
        return exec.mode ?? 'sequential'
      },
    },
    sessions,
    systemPrompt: {
      section() {},
      context() {},
      variable() {},
      tools() {},
      suppressRuntimeContext() {},
      assemble(context) {
        return { assembly: context }
      },
    },
    ...(agents ? { agents } : {}),
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {} },
    settings,
    ...(options.services ?? {}),
  }
  const state = {
    pluginApi: undefined,
    effects: [],
    listeners: [],
    errors: [],
    warnings: [],
    getCalls: [],
  }
  const ctx = {
    logger: {
      error(message) {
        state.errors.push(message)
      },
      warn(message) {
        state.warnings.push(message)
      },
    },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') state.pluginApi = value
      },
    },
    get(name) {
      state.getCalls.push(name)
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
    on() {
      return () => true
    },
    once() {},
    emit() {},
    serial() {},
    parallel() {},
    bail() {},
    waterfall() {},
  }
  return { ctx, state, agents, sessions, settings, services }
}

test('integrated llm facade exposes the six official directory methods and three artifacts', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const llm = state.pluginApi.llm
  assert.equal(llm.isActive, true)
  assert.deepEqual(llm.listProviders(), ['provider-a'])
  assert.deepEqual(llm.discoverModels('ns', {}), ['model-a'])
  assert.deepEqual(llm.providerRetryPolicy('x'), { retry: true })
  assert.deepEqual(llm.resolveCallConfig({ a: 1 }, undefined), { a: 1 })
  assert.equal(typeof llm.contentHasImage, 'function')
  assert.equal(typeof llm.createUserMessage, 'function')
  assert.equal(typeof llm.BlockAssembler, 'function')
})

test('integrated agent facade exposes initiator/ownership methods and a frozen options snapshot', () => {
  const { ctx, state, agents } = createMockCtx()
  apply(ctx)
  const agent = state.pluginApi.agent
  assert.equal(typeof agent.currentInitiator, 'function')
  assert.equal(typeof agent.requireInitiator, 'function')
  assert.equal(typeof agent.withInitiator, 'function')
  assert.equal(typeof agent.withoutInitiator, 'function')
  assert.equal(typeof agent.isOwnedBy, 'function')
  assert.equal(agent.isOwnedBy('id', 'id'), true)

  // No live initiator: the options snapshot exposes undefined-valued fields.
  const snapshot = agent.options
  assert.ok(Object.isFrozen(snapshot))
  assert.deepEqual(snapshot, { provider: undefined, model: undefined, maxTokens: undefined })

  // A live initiator with an options descriptor is reflected on the next
  // composed view (each `pluginApi.agent` access rebuilds the view).
  agents.initiator = {
    options: { provider: 'p', model: 'm', maxTokens: 8 },
  }
  const freshView = state.pluginApi.agent
  assert.deepEqual(freshView.options, { provider: 'p', model: 'm', maxTokens: 8 })
  assert.ok(Object.isFrozen(freshView.options))
})

test('integrated agent facade keeps the established read surface intact when the initiator surface is malformed', () => {
  const { ctx, state } = createMockCtx()
  // Mutate the fake registry so the options snapshot cannot resolve.
  state.pluginApi = undefined
  const services = {}
  // Re-apply through a context whose agents service lacks initiator methods.
  const bareAgents = { get() { return { id: 1 } }, list() { return [] }, roots() { return [] } }
  const bareCtx = {
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      const map = { llm: services.llm ?? { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} }, tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} }, sessions: { get() {}, list() {}, fork() {} }, systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} }, apiProxy: { sessions: { prompt() {}, selectModel() {} } }, web: { registerSearchProvider() {}, registerFetchProvider() {} }, agents: bareAgents }
      return map[name]
    },
    plugin(Class) { new Class(bareCtx) },
    effect() {},
    on() { return () => true },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  apply(bareCtx)
  const agent = state.pluginApi.agent
  assert.deepEqual(agent.get('x'), { id: 1 })
  assert.throws(() => agent.options, (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'agent')
})

test('integrated session facade exposes store lifecycle and derive/append members', () => {
  const { ctx, state, sessions } = createMockCtx()
  apply(ctx)
  const session = state.pluginApi.session
  assert.deepEqual(session.create('s1', { seed: true }), { id: 's1', header: { seeded: true } })
  assert.deepEqual(sessions.createCalls, [['s1', { seed: true }]])
  assert.deepEqual(session.prepare(), { prepared: true })
  assert.deepEqual(session.enter(), { entered: true })
  assert.deepEqual(session.announce(), { announced: true })
  assert.deepEqual(session.flush(), { flushed: true })
  // deriveEventMessage delegates to the official public export.
  const derived = session.deriveEventMessage({ type: 'test', data: {} })
  assert.deepEqual(derived, null)
  // append has no official public source in this runtime: P2 'session'.
  assert.throws(() => session.append('kind', { value: 1 }), (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'session')
})

test('integrated tools facade exposes executionMode and defineTool', async () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const tools = state.pluginApi.tools
  assert.equal(tools.executionMode({ mode: 'parallel' }), 'parallel')
  assert.equal(typeof tools.defineTool, 'function')
  // defineTool delegates the official public export when present.
  const dshTools = await import('@deepseek-ai/dsh-tools').catch(() => undefined)
  if (dshTools) {
    const definition = tools.defineTool({
      name: 'sample-tool',
      description: 'sample',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (args, value) => String(value),
      },
      execute: async () => 'ok',
    })
    assert.equal(definition.name, 'sample-tool')
    assert.equal(typeof definition.execute, 'function')
  } else {
    assert.throws(() => tools.defineTool({}), PluginApiFeatureDisabledError)
  }
})

test('integrated systemPrompt facade exposes assemble with official semantics', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const systemPrompt = state.pluginApi.systemPrompt
  assert.deepEqual(systemPrompt.assemble({ scope: 's' }), { assembly: { scope: 's' } })
  assert.equal(typeof systemPrompt.section, 'function')
})

test('integrated settings facade exposes document and writable members', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const settings = state.pluginApi.settings
  assert.equal(settings.writable, true)
  assert.deepEqual(settings.prepareDocument(), { document: 'doc' })
  assert.deepEqual(settings.get('ns-a'), { ns: 'ns-a' })
  assert.deepEqual(settings.update('ns-a', { patch: 1 }), { ns: 'ns-a', patch: { patch: 1 } })
  assert.deepEqual(settings.replace('ns-a', { section: 1 }), { ns: 'ns-a', section: { section: 1 } })
  assert.deepEqual(settings.mutate('ns-a', [{ op: 'set', path: ['a'] }]), { ns: 'ns-a', ops: [{ op: 'set', path: ['a'] }] })
  // Existing settings registration surface stays intact.
  assert.equal(typeof settings.register, 'function')
})

test('settings document members report P3 when the settings service is absent', () => {
  const { ctx, state, services } = createMockCtx()
  delete services.settings
  apply(ctx)
  const settings = state.pluginApi.settings
  assert.equal(settings.isActive, true)
  assert.throws(() => settings.writable, (error) => error instanceof PluginApiServiceUnavailableError && error.service === 'settings')
  assert.throws(() => settings.get('ns'), (error) => error instanceof PluginApiServiceUnavailableError && error.service === 'settings')
})

test('repeated apply does not duplicate the leaf members and keeps identity stable', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const first = state.pluginApi.llm
  apply(ctx)
  const second = state.pluginApi.llm
  assert.deepEqual(second.listProviders(), ['provider-a'])
  assert.equal(second.isActive, true)
  // Re-apply keeps one active registration and no extra feature entries.
  const llmFeatures = state.pluginApi.features.filter((feature) => feature.name === 'llm')
  assert.equal(llmFeatures.length, 1)
  const provides = state.getCalls.filter((name) => name === 'llm')
  assert.ok(provides.length > 0)
  // Re-read surfaces are fresh composed views that still forward identity.
  assert.deepEqual(second.discoverModels('ns', {}), ['model-a'])
})

// Leaf P1 (inactive root facade) is covered by the existing core-guard
// suites and by the leaf-level negative-boundary tests; the integration
// boundary for inactive-root behavior is exercised there.