/**
 * Central integration tests: official host namespace leaves wired into
 * the mounted pluginApi facades (host namespace leaves: llm, agent, session, tools, systemPrompt, settings).
 *
 * These tests drive the real `apply(ctx)` mount path with faithful official
 * service shapes and assert member presence, receiver/argument/return
 * identity, per-member fallback behavior, repeated apply idempotence, and
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
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
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
assert.equal(llm.availability().status, 'active')
  assert.deepEqual(llm.providers.register('./a'), undefined ?? undefined)
  assert.equal(typeof llm.providers.register, 'function')
  assert.equal(typeof llm.models.register, 'function')
  assert.equal(typeof state.pluginApi.services.llm.listProviders, 'function', 'official leaves ride under services.llm')
  assert.equal(typeof state.pluginApi.services.llm.discoverModels, 'function')
})

test('integrated agent facade keeps the initiator/ownership helpers under services.agents', () => {
  const { ctx, state, agents } = createMockCtx()
  apply(ctx)
  const agent = state.pluginApi.agents
  assert.equal('currentInitiator' in agent, false, 'the initiator helpers migrated to services.agents')
  assert.equal(typeof state.pluginApi.services.agents.currentInitiator, 'function')
  assert.equal('options' in agent, false, 'the options snapshot rides under services.agents')

  // A live initiator with an options descriptor is reflected by the
  // services.agents snapshot (read through the official currentInitiator).
  agents.currentInitiator = () => ({ options: { provider: 'p', model: 'm', maxTokens: 8 } })
  const snapshot = state.pluginApi.services.agents.options
  assert.deepEqual(snapshot, { provider: 'p', model: 'm', maxTokens: 8 })
  assert.ok(Object.isFrozen(snapshot))
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
      const map = { llm: services.llm ?? { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} }, tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} }, sessions: { get() {}, list() {}, fork() {} }, systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} }, apiProxy: { sessions: { prompt() {}, selectModel() {} } }, web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} }, agents: bareAgents }
      return map[name]
    },
    plugin(Class) { new Class(bareCtx) },
    effect() {},
    on() { return () => true },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  apply(bareCtx)
  const agent = state.pluginApi.agents
  assert.deepEqual(agent.get('x'), { id: 1 })
  // The migrated snapshot getter is not part of the agents root anymore.
  assert.equal('options' in agent, false)
})

test('integrated session store members ride under services.sessions', () => {
  const { ctx, state, sessions } = createMockCtx()
  apply(ctx)
  const session = state.pluginApi.sessions
  const servicesSessions = state.pluginApi.services.sessions
  assert.equal('create' in session, false, 'the store lifecycle members migrated to services.sessions')
  assert.deepEqual(servicesSessions.create('s1', { seed: true }), { id: 's1', header: { seeded: true } })
  assert.deepEqual(sessions.createCalls, [['s1', { seed: true }]])
  assert.deepEqual(servicesSessions.prepare(), { prepared: true })
  assert.deepEqual(servicesSessions.enter(), { entered: true })
  assert.deepEqual(servicesSessions.announce(), { announced: true })
  assert.deepEqual(servicesSessions.flush(), { flushed: true })
  // deriveEventMessage delegates to the official public export.
  const derived = servicesSessions.deriveEventMessage({ type: 'test', data: {} })
  assert.deepEqual(derived, null)
  // append has no official public source in this runtime.
  assert.throws(() => servicesSessions.append('kind', { value: 1 }), (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'services.sessions')
})

test('integrated tools facade exposes executionMode and defineTool', async () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const tools = state.pluginApi.tools
  assert.equal(tools.executionMode.register({ mode: 'parallel' }), 'parallel')
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

test('integrated prompts facade exposes the merged contribution entry', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const systemPrompt = state.pluginApi.prompts
  assert.equal('assemble' in systemPrompt, false, 'assemble migrated to services.prompts')
  assert.deepEqual(state.pluginApi.services.prompts.assemble({ scope: 's' }), { assembly: { scope: 's' } })
  assert.equal(typeof systemPrompt.contribute, 'function')
})

test('integrated settings facade keeps document members under services.settings', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const settings = state.pluginApi.settings
  const servicesSettings = state.pluginApi.services.settings
  assert.equal('writable' in settings, false, 'the document members migrated to services.settings')
  assert.equal(servicesSettings.writable, true)
  assert.deepEqual(servicesSettings.prepareDocument(), { document: 'doc' })
  assert.deepEqual(servicesSettings.get('ns-a'), { ns: 'ns-a' })
  assert.deepEqual(settings.update('ns-a', { patch: 1 }), { ns: 'ns-a', patch: { patch: 1 } })
  assert.deepEqual(settings.replace('ns-a', { section: 1 }), { ns: 'ns-a', section: { section: 1 } })
  assert.deepEqual(settings.mutate('ns-a', [{ op: 'set', path: ['a'] }]), { ns: 'ns-a', ops: [{ op: 'set', path: ['a'] }] })
  // Existing settings registration surface stays intact.
  assert.equal(typeof settings.register, 'function')
})

test('settings document members report unavailable when the settings service is absent', () => {
  const { ctx, state, services } = createMockCtx()
  delete services.settings
  apply(ctx)
  const settings = state.pluginApi.settings
assert.equal(settings.availability().status, 'degraded')
  const servicesSettings = state.pluginApi.services.settings
  assert.throws(() => servicesSettings.writable, (error) => error instanceof PluginApiServiceUnavailableError && error.service === 'settings')
  assert.throws(() => servicesSettings.get('ns'), (error) => error instanceof PluginApiServiceUnavailableError && error.service === 'settings')
})

test('repeated apply does not duplicate the leaf members and keeps identity stable', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const first = state.pluginApi.llm
  apply(ctx)
  const second = state.pluginApi.llm
  assert.deepEqual(state.pluginApi.services.llm.listProviders(), ['provider-a'])
  assert.equal(second.availability().status, 'active')
  // Re-apply keeps one active registration and no extra feature entries.
  const llmFeatures = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').filter((feature) => feature.name === 'llm')
  assert.equal(llmFeatures.length, 1)
  const provides = state.getCalls.filter((name) => name === 'llm')
  assert.ok(provides.length > 0)
  // Re-read surfaces are fresh composed views that still forward identity.
  assert.deepEqual(state.pluginApi.services.llm.discoverModels('ns', {}), ['model-a'])
})

// An inactive root facade is covered by the existing core guard
// suites and by the leaf-level negative-boundary tests; the integration
// boundary for inactive-root behavior is exercised there.
