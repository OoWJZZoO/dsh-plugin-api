import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import {
  PluginApiFeatureDisabledError,
  PluginApiInactiveError,
  PluginApiServiceUnavailableError,
} from '../lib/errors.js'

function createHost(options = {}) {
  const services = {
    llm: {
      resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {},
      registerConfigurableProviders() {}, registerModelDiscovery() {},
    },
    agents: { get() {}, list() {}, roots() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    sessions: { get() {}, list() {}, fork() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
    jobs: {
      start() {}, list() {}, get() {}, read() {}, kill() {}, wait() {},
      onJobDone() {}, onJobsChanged() {}, attachController() {},
    },
    shellEnv: { register() {}, collect() {}, list() {} },
    ...options.services,
  }
  const state = { pluginApi: undefined, effects: [], listeners: [], provides: 0 }
  const ctx = {
    logger: options.logger ?? { error() {}, warn() {} },
    reflect: { provide(name, value) {
      if (name === 'pluginApi') {
        state.pluginApi = value
        state.provides += 1
      }
    } },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      if (options.throwGet === name) throw new Error(`${name} lookup failed`)
      return services[name]
    },
    plugin(Class) { new Class(ctx) },
    effect(fn, label) {
      if (options.throwEffect === label) throw new Error(`${label} registration failed`)
      state.effects.push({ fn, label })
    },
    on(name, listener) {
      state.listeners.push({ name, listener })
      let disposed = false
      return () => {
        if (disposed) return false
        disposed = true
        const index = state.listeners.findIndex((entry) => entry.listener === listener)
        if (index >= 0) state.listeners.splice(index, 1)
        return index >= 0
      }
    },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  return { ctx, state, services }
}

function feature(state, name) {
  return state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((entry) => entry.name === name)
}

test('combined host publishes additive immutable compat shapes once without synthetic public surfaces', () => {
  const { ctx, state } = createHost()
  apply(ctx)
  const first = state.pluginApi
  const views = [first.agents, first.tools, first.llm, first.sessions, first.services]

  apply(ctx)
  assert.equal(state.pluginApi, first)
  assert.equal(state.provides, 1)
  assert.deepEqual(state.listeners.map(({ name }) => name).sort(), [
    'agent-loop/assembled-context', 'agent/error', 'agent/request', 'approval/request', 'compaction/completed', 'fs/edit-intent', 'fs/write-intent',
    'jobs/changed', 'jobs/done', 'llm/stream', 'llm/stream', 'llm/stream',
    'session/created', 'session/disposed', 'session/event', 'session/event', 'session/event', 'session/event',
    'subagent/end', 'subagent/start', 'tools/execute', 'tools/post-execute', 'tools/pre-execute',
    'tools/pre-execute', 'tools/pre-execute', 'tools/pre-execute', 'tools/result', 'workflow/end', 'workflow/start',
  ])
  assert.equal(typeof first.llm.routing.forExecution, 'function')
  assert.equal(first.llm.routing.forExecution({}), undefined, 'missing capture remains query-only rather than a synthetic route value')
  assert.equal(typeof first.llm.requestTransforms.register, 'function')
  assert.equal(typeof first.llm.admissionPolicies.register, 'function')
  assert.equal(typeof first.sessions.onDurable, 'function')
  assert.equal(typeof first.sessions.appendMessage, 'function')
  assert.equal(Object.keys(first.events.catalog).length, 47)
  for (const excluded of ['llm/request', 'llm/admission', 'exec.route', 'agent/create', 'compaction/started']) {
    assert.equal(first.events.catalog[excluded], undefined)
  }
  for (const view of views) assert.ok(Object.isFrozen(view))
  assert.equal(Object.keys(first.services).length, 48)
  assert.equal(first.services.jobs.isActive, true)
  assert.equal(first.services.shellEnv.isActive, true)
})

test('combined host preserves core-inactive → feature-disabled → guard-disabled/degraded precedence', () => {
  const previous = process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
  process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = '1'
  try {
    const inert = createHost()
    apply(inert.ctx)
    assert.throws(() => inert.state.pluginApi.sessions.appendMessage(), PluginApiInactiveError)
  } finally {
    if (previous === undefined) delete process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
    else process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = previous
  }

  const active = createHost({ services: { apiProxy: undefined, settings: undefined } })
  apply(active.ctx)
  assert.equal(feature(active.state, 'llm/admission').isActive, false)
  assert.throws(() => active.state.pluginApi.llm.admissionPolicies.register({}), PluginApiFeatureDisabledError)
  assert.throws(() => active.state.pluginApi.settings.scope('consumer'), PluginApiServiceUnavailableError)
  assert.equal(active.state.pluginApi.services.compaction.isActive, false)
  assert.throws(() => active.state.pluginApi.services.compaction.compactNow(), /compaction/)
})

test('throwing mandatory substrate and logger disable only dependent compat surfaces while boot continues', () => {
  const logger = { error() { throw new Error('diagnostic failed') }, warn() { throw new Error('diagnostic failed') } }
  const { ctx, state } = createHost({ throwGet: 'tools', logger })
  assert.doesNotThrow(() => apply(ctx))

  assert.equal(feature(state, 'tools').isActive, false)
  assert.equal(feature(state, 'execRoute').isActive, false)
  assert.equal(feature(state, 'llm').isActive, true)
  assert.equal(feature(state, 'llm/request').isActive, true)
  assert.equal(feature(state, 'session').isActive, true)
  assert.equal(feature(state, 'sessionDurable').isActive, true)
  assert.throws(() => state.pluginApi.llm.routing.forExecution({}), PluginApiFeatureDisabledError)
})

test('durable retained references, repeated cleanup, and stale cleanup cannot affect a fresh epoch or unrelated LLM', () => {
  const { ctx, state } = createHost()
  apply(ctx)
  const retainedSession = state.pluginApi.sessions
  const retainedLlm = state.pluginApi.llm
  const firstCleanup = state.effects.find((entry) => entry.label === 'dsh-plugin-api: sessionDurable cleanup').fn()

  assert.equal(firstCleanup(), true)
  assert.equal(firstCleanup(), false)
  assert.throws(() => retainedSession.onDurable(), PluginApiFeatureDisabledError)
  assert.equal(typeof retainedLlm.requestTransforms.register, 'function')

  apply(ctx)
  const freshSession = state.pluginApi.sessions
  assert.equal(feature(state, 'sessionDurable').isActive, true)
  assert.throws(() => retainedSession.appendMessage(), PluginApiFeatureDisabledError)
  assert.equal(typeof freshSession.onDurable, 'function')
  assert.equal(firstCleanup(), false)
  assert.equal(feature(state, 'sessionDurable').isActive, true)
  assert.equal(typeof state.pluginApi.llm.requestTransforms.register, 'function')
  assert.equal(state.listeners.filter(({ name }) => name === 'session/event').length, 4)
})
