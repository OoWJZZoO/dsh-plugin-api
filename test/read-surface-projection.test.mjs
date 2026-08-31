import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

function createHarness(extraServices = {}) {
  const services = {
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() { return [] }, execute() {}, presentAs() {} },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {}, renderPrompt() {}, renderContextSections() {}, renderContextSnapshot() {}, joinContextSections() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    ...extraServices,
  }
  const state = { pluginApi: undefined, effects: [], listeners: [] }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect(fn, label) { state.effects.push({ fn, label }) },
    on(name, listener) { state.listeners.push({ name, listener }); return () => {} },
    once() {}, emit() {}, serial() {}, parallel() {} , bail() {}, waterfall() {},
    model() { return { name: 'x' } },
    runtime: { name: 'test', version: '0.1.0-rc.6' },
  }
  return { ctx, state, services }
}

test('read projections expose the target get/list/inspect members with frozen views', () => {
  const { ctx, state } = createHarness({ web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} } })
  apply(ctx)
  const api = state.pluginApi
  for (const member of ['llm.adapters.list', 'llm.routing.observe', 'llm.routing.circuit.inspect', 'sessions.observe', 'sessions.durable.list', 'sessions.durable.get', 'sessions.durable.observe', 'sessions.channels.list', 'tools.list', 'tools.discovery.list', 'tools.discovery.audit.list', 'attachments.projection.get', 'mcp.observe', 'coordination.observe', 'security.audit.list', 'diagnostics.observe', 'settings.inspect']) {
    let target = api
    for (const segment of member.split('.')) target = target?.[segment]
    assert.equal(typeof target, 'function', `${member} must be exposed as a read member`)
  }
})

test('read projections on the disabled surface stay shape-compatible with typed failure', () => {
  const harness = createHarness()
  apply(harness.ctx)
  // Unmounted features keep the target member shape and reject with typed
  // disabled errors; mounted read paths return frozen views.
  const api = harness.state.pluginApi
  // coordination is a self-hosted bounded adapter: it stays live and reports
  // its backing honestly through the namespace availability
  assert.equal(typeof api.coordination.observe, 'function')
  assert.ok(['active', 'degraded', 'unavailable'].includes(api.coordination.availability().status))
  assert.equal(typeof api.diagnostics.observe, 'function')
  assert.equal(typeof api.mcp.observe, 'function')
  assert.throws(() => api.skills.activation.exposure.list(), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED')
  assert.throws(() => api.skills.activation.audit.list(), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED')
  assert.ok(Object.isFrozen(api.tools.list()), 'mounted read path returns a frozen view')
  assert.doesNotThrow(() => api.settings.inspect())
})

test('namespace availability() reports the three-value status with bounded frozen details', () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  for (const namespace of ['events', 'llm', 'agents', 'executions', 'sessions', 'tools', 'skills', 'prompts', 'attachments', 'mcp', 'tasks', 'coordination', 'workspaces', 'security', 'diagnostics', 'settings', 'profiles', 'remotes', 'storage']) {
    const view = api[namespace].availability()
    assert.ok(Object.isFrozen(view), `${namespace}.availability() must be frozen`)
    assert.ok(['active', 'degraded', 'unavailable'].includes(view.status), `${namespace}.availability().status must be three-valued`)
  }
  for (const sub of [['llm', 'routing'], ['executions', 'recovery'], ['sessions', 'branches'], ['sessions', 'channels'], ['tools', 'discovery'], ['skills', 'activation'], ['prompts', 'provenance'], ['attachments', 'projection']]) {
    const view = api[sub[0]][sub[1]].availability()
    assert.ok(Object.isFrozen(view), `${sub.join('.')}.availability() must be frozen`)
    assert.ok(['active', 'degraded', 'unavailable'].includes(view.status), `${sub.join('.')}.availability().status must be three-valued`)
  }
})

test('namespace availability stays shape-compatible when the backing is missing', () => {
  const harness = createHarness()
  apply(harness.ctx)
  const api = harness.state.pluginApi
  // mcp has no backing provider in this harness: the namespace shape exists
  // and reports unavailable instead of disappearing.
  assert.equal(typeof api.mcp, 'object')
  assert.equal(api.mcp.availability().status, 'unavailable')
  assert.equal(api.attachments.availability().status, 'unavailable')
})

test('capabilityMatrix is separate from capabilities and from availability', () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  const matrix = api.capabilityMatrix()
  assert.ok(Object.isFrozen(matrix))
  assert.ok(Object.isFrozen(matrix.clusters))
  assert.ok(matrix.clusters.length >= 70, 'the conservation matrix covers every capability cluster')
  for (const row of matrix.clusters) {
    assert.ok(['retained', 'renamed', 'merged', 'migrated', 'deleted', 'gap'].includes(row.status), `${row.capabilityCluster}: closed conservation status`)
    assert.ok(Array.isArray(row.qualifiers))
  }
  const root = matrix.clusters.find((row) => row.capabilityCluster === 'facade.root')
  assert.equal(root.status, 'retained')
  assert.equal(api.capabilities.get('llm').status, 'active', 'capabilities reports current presence')
  assert.equal(typeof api.capabilities, 'object')
  assert.equal(api.capabilities.list().includes('llm'), true)
})

test('business results never embed availability; availability lives on the namespace', async () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  const registered = await api.tasks.register({ taskId: 'w4-task', ownerId: 'owner-1', scope: { kind: 'workspace', key: 'w' }, intent: { kind: 'review', summary: 's' } })
  assert.equal(registered.ok, true)
  const got = await api.tasks.get('w4-task')
  assert.equal(got.task.state, 'registered')
  assert.equal('availability' in got.task, false, 'task results must not embed availability')
  assert.equal(typeof api.tasks.availability().status, 'string')
})