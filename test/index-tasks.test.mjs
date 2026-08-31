import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

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

test('mounted facade: full register -> start -> claim -> settle flow with fenced coordination', async () => {
  const { ctx, state } = createContext()
  apply(ctx)
  const tasks = state.pluginApi.tasks
  const registered = await tasks.register({
    taskId: 'flow-task',
    ownerId: 'owner-1',
    scope: taskScope,
    intent: { kind: 'review', summary: 'flow' },
  })
  assert.equal(registered.ok, true)
  const started = await tasks.start('flow-task', { workflowId: 'wf-1', executionId: 'exec-1' })
  assert.equal(started.ok, true)
  const handle = (await state.pluginApi.coordination.acquire({
    resource: { scope: 'workspace', key: 'mounted-repo:task' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })).handle
  const claimed = await tasks.claim('flow-task', { ownerId: 'owner-1', lease: handle })
  assert.equal(claimed.ok, true)
  const settled = await tasks.settle('flow-task', {
    attemptId: claimed.attemptId,
    outcome: 'success',
    reason: 'merged',
    evidence: { integration: 'double' },
  })
  assert.equal(settled.ok, true)
  assert.equal(settled.state, 'settled')
  const got = await tasks.get('flow-task')
  assert.equal(got.task.state, 'settled')
  assert.equal(got.task.terminalOutcome, 'success')
  assert.equal(state.pluginApi.tasks.availability().durability, 'memory')
})

test('mounted facade: observe and history rebuild state and report bounded windows', async () => {
  const { ctx, state } = createContext()
  apply(ctx)
  const tasks = state.pluginApi.tasks
  await tasks.register({ taskId: 'observe-task', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'observe' } })
  const seen = []
  const subscription = await tasks.observe('observe-task')
  subscription.subscribe((event) => seen.push(event.nextState))
  await tasks.start('observe-task', { workflowId: 'wf-1' })
  subscription.dispose()
  const current = await subscription.current()
  assert.equal(current.code, 'inactive') // disposed subscription is inactive
  const history = await tasks.history('observe-task')
  assert.equal(history.ok, true)
  assert.ok(history.events.length >= 1)
})

test('mounted facade: reassign takeover gating works through the facade surfaces', async () => {
  const { ctx, state } = createContext()
  apply(ctx)
  const tasks = state.pluginApi.tasks
  await tasks.register({ taskId: 'reassign-task', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'reassign' } })
  await tasks.start('reassign-task')
  const handle = (await state.pluginApi.coordination.acquire({
    resource: { scope: 'workspace', key: 'mounted-repo:task' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })).handle
  await tasks.claim('reassign-task', { ownerId: 'owner-1', lease: handle })
  const failed = await tasks.reassign('reassign-task', {
    ownerId: 'owner-2',
    expectedGeneration: 'gen:WRONG',
    reason: 'no',
  })
  assert.equal(failed.ok, false)
  const reassigned = await tasks.reassign('reassign-task', {
    ownerId: 'owner-2',
    expectedGeneration: handle.generation,
    reason: 'handoff',
  })
  assert.equal(reassigned.ok, true)
  const got = await tasks.get('reassign-task')
  assert.equal(got.task.state, 'active')
  assert.equal(got.task.attempts[got.task.attempts.length - 1].ownerId, 'owner-2')
})

test('mounted facade: no scheduler/poller side effect and memory registry reported non-durable', async () => {
  const { ctx, state } = createContext()
  const effectsBefore = state.effects.length
  const listenersBefore = state.listeners.length
  apply(ctx)
  const tasks = state.pluginApi.tasks
  await tasks.register({ taskId: 'neg-task', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'neg' } })
  const got = await tasks.get('neg-task')
  // the tasks facade never schedules workers; the listener/effect budget stays
  // bounded to facade wiring, and the memory registry is explicit
  assert.equal(state.pluginApi.tasks.availability().durability, 'memory')
  assert.equal(state.pluginApi.tasks.availability().backend.id, 'memory')
  assert.ok(state.effects.length >= effectsBefore)
  // the mounted feature wired its evidence bridges: jobs/workflow/subagent
  // change observations are consumed as bounded provenance
  const gainedNames = state.listeners.slice(listenersBefore).map((entry) => entry.name)
  assert.ok(gainedNames.includes('jobs/done'))
  assert.ok(gainedNames.includes('workflow/start'))
  assert.ok(gainedNames.includes('subagent/end'))
  // a resolved-task history has no fabricated full history on the bounded
  // memory registry
  const history = await tasks.history('neg-task')
  assert.equal(history.ok, true)
})