import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

function createContext(options = {}) {
  const services = {
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    typert: {
      register() {}, get() {}, resolve() {}, list() {}, getPackage() {}, listPackages() {}, toJSONSchema() {},
      local: { get() {}, hasSeen() {}, list() {}, subscribe() {} },
      remotes: { register() {}, get() {}, list() {}, subscribe() {} },
      lookups: { register() {}, configure() {}, get() {}, definitions() {}, keys() {}, subscribe() {} },
      contexts: { registerHost() {}, configureHost() {}, registerClient() {}, getHost() {}, getClient() {}, subscribe() {} },
    },
    ...(options.services ?? {}),
  }
  const state = { pluginApi: undefined, effects: [], listeners: [], errors: [] }
  const ctx = {
    logger: { error(message) { state.errors.push(message) }, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect(fn, label) { state.effects.push({ fn, label }) },
    on(name, listener) { state.listeners.push({ name, listener }); return () => {} },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  return { ctx, state, services }
}

const taskScope = { kind: 'workspace', key: 'mounted-repo' }

function activeCoordinationLease(pluginApi) {
  return pluginApi.coordination.acquire({
    resource: { scope: 'workspace', key: 'mounted-repo:task' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })
}

test('healthy apply mounts the tasks facade after diagnostics/usage and exposes the frozen surface', async () => {
  const { ctx, state } = createContext()
  assert.doesNotThrow(() => apply(ctx))
  const names = state.pluginApi.features.map((entry) => entry.name)
  assert.ok(names.includes('tasks'))
  assert.ok(names.indexOf('coordination') < names.indexOf('tasks'))
  assert.ok(names.indexOf('diagnostics') < names.indexOf('tasks'))
  const tasks = state.pluginApi.tasks
  assert.equal(typeof tasks.register, 'function')
  assert.equal(typeof tasks.start, 'function')
  assert.equal(typeof tasks.claim, 'function')
  assert.equal(typeof tasks.reassign, 'function')
  assert.equal(typeof tasks.settle, 'function')
  assert.equal(typeof tasks.attach, 'function')
  assert.equal(typeof tasks.get, 'function')
  assert.equal(typeof tasks.observe, 'function')
  assert.equal(typeof tasks.history, 'function')
  assert.equal(Object.isFrozen(tasks), true)

  const registered = await tasks.register({
    taskId: 'mounted-task',
    ownerId: 'owner-1',
    scope: taskScope,
    intent: { kind: 'review', summary: 'mounted' },
  })
  assert.equal(registered.ok, true)
  assert.equal(registered.task.state, 'registered')
  const got = await tasks.get('mounted-task')
  assert.equal(got.task.state, 'registered')
  assert.equal(got.task.availability.durability, 'memory')
})

test('tasks typed results keep other facade surfaces intact and claim works through the facade', async () => {
  const { ctx, state } = createContext()
  apply(ctx)
  const tasks = state.pluginApi.tasks
  const registered = await tasks.register({
    taskId: 'mounted-task-2',
    ownerId: 'owner-1',
    scope: taskScope,
    intent: { kind: 'review', summary: 'mounted' },
  })
  assert.equal(registered.ok, true)
  await tasks.start('mounted-task-2', { workflowId: 'wf-1' })
  const handle = (await activeCoordinationLease(state.pluginApi)).handle
  const claimed = await tasks.claim('mounted-task-2', { ownerId: 'owner-1', lease: handle })
  assert.equal(claimed.ok, true)
  assert.equal(claimed.code, 'active')
  const invalid = await tasks.register({})
  assert.equal(invalid.ok, false)
  assert.equal(invalid.code, 'invalid-input')
  // isolation: unrelated surfaces stay working
  assert.equal(typeof state.pluginApi.workspaceTransactions.prepare, 'function')
  assert.equal(typeof state.pluginApi.recovery.evaluate, 'function')
  assert.equal(typeof state.pluginApi.execution.observe, 'function')
})

test('stale tasks facade is typed unavailable after its owner slot is unmounted', async () => {
  const { ctx, state } = createContext()
  apply(ctx)
  const old = state.pluginApi.tasks
  const token = state.pluginApi._readSlot('tasks')
  assert.ok(token)
  const removed = state.pluginApi.unmountFeature('tasks', state.pluginApi._tasksSlot)
  assert.equal(removed, true)
  assert.throws(() => old.register({}), PluginApiFeatureDisabledError)
  assert.throws(() => state.pluginApi.tasks.settle('tx'), PluginApiFeatureDisabledError)
})

test('repeated apply is idempotent and keeps the live tasks surface', async () => {
  const { ctx, state } = createContext()
  apply(ctx)
  apply(ctx)
  const registered = await state.pluginApi.tasks.register({
    taskId: 'mounted-task-3',
    ownerId: 'owner-1',
    scope: taskScope,
    intent: { kind: 'review', summary: 'mounted' },
  })
  assert.equal(registered.ok, true)
})

test('tasks guard fails safe with missing ctx.on and leaves other features active', async () => {
  const { ctx, state } = createContext()
  const on = ctx.on
  ctx.on = undefined
  assert.doesNotThrow(() => apply(ctx))
  const feature = state.pluginApi.features.find((entry) => entry.name === 'tasks')
  assert.equal(feature?.isActive, false)
  assert.throws(() => state.pluginApi.tasks.register({}), PluginApiFeatureDisabledError)
  assert.equal(state.pluginApi.features.find((entry) => entry.name === 'coordination')?.isActive, true)
  assert.equal(state.pluginApi.features.find((entry) => entry.name === 'workspaceTransactions')?.isActive, false)
  ctx.on = on
})

test('tasks mount survives missing optional source seams and keeps isolation from other surfaces', async () => {
  const { ctx, state } = createContext({
    services: {
      storage: { transactionCapability() { throw new Error('broken probe') } },
    },
  })
  assert.doesNotThrow(() => apply(ctx))
  const feature = state.pluginApi.features.find((entry) => entry.name === 'tasks')
  assert.equal(feature?.isActive, true)
  assert.equal(state.pluginApi.features.find((entry) => entry.name === 'execution')?.isActive, true)
  assert.equal(state.pluginApi.features.find((entry) => entry.name === 'usage')?.isActive, true)
})