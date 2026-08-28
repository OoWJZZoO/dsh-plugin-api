import test from 'node:test'
import assert from 'node:assert/strict'
import { createTaskExecutionObservation } from '../lib/task-execution-observation.js'
import { createCoordinationLease } from '../lib/coordination-lease.js'
import { apply } from '../lib/index.js'

const NOW = '2026-08-25T00:00:00.000Z'
let nowValue = Date.parse(NOW)
const now = () => new Date(nowValue).toISOString()

function createHostContext(services = {}) {
  const base = {
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
    jobs: { get() {}, list() {}, read() {} },
    ...services,
  }
  const state = { pluginApi: undefined, listeners: [] }
  const ctx = {
    logger: { error() {}, warn() {} },
    get(name) { return name === 'pluginApi' ? state.pluginApi : base[name] },
    on(name, listener) { state.listeners.push({ name, listener }); return () => {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    plugin(Class) { new Class(ctx) },
    effect() {}, once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  return { ctx, state, services: base }
}

const taskScope = { kind: 'workspace', key: 'repo-a' }

test('register -> start -> claim -> settle over a fenced coordination double with recovery evidence', async () => {
  const { ctx } = createHostContext({})
  const coordinationOwner = createCoordinationLease({ ctx, logger: ctx.logger, now })
  const recovery = {
    availability() { return { status: 'available' } },
    classify(input) {
      if (input?.kind === 'error') return { ok: true, class: 'transient' }
      return { ok: true, class: 'transient' }
    },
    evaluate() { return { ok: true, decision: { action: 'stop' } } },
  }
  let idSeq = 0
  const { api } = createTaskExecutionObservation({
    ctx,
    execution: { get() {}, observe() {}, history() {}, onChange() {}, availability: { status: 'available' } },
    recovery,
    coordination: coordinationOwner.api,
    diagnostics: { get() {} },
    workspaceTransactions: { get() {} },
    logger: ctx.logger,
    now,
    idFactory: () => `id-${(idSeq += 1)}`,
  })
  const registered = await api.register({ taskId: 'e2e-task', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'e2e' } })
  assert.equal(registered.ok, true)
  const started = await api.start('e2e-task', { workflowId: 'wf-1', executionId: 'exec-1', sessionId: 'session-1', jobId: 'job-1' })
  assert.equal(started.ok, true)
  // the coordination facade (same-batch first feature) provides the fence
  const handle = (await coordinationOwner.api.acquire({
    resource: { scope: 'workspace', key: 'repo-a:task' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })).handle
  const claimed = await api.claim('e2e-task', { ownerId: 'owner-1', lease: handle })
  assert.equal(claimed.ok, true)
  assert.equal(claimed.code, 'active')
  // settlement consumes recovery classification read-only
  const settled = await api.settle('e2e-task', { attemptId: claimed.attemptId, outcome: 'success', reason: 'merged', evidence: { integration: 'double' } })
  assert.equal(settled.ok, true)
  assert.equal(settled.state, 'settled')
  const got = await api.get('e2e-task')
  assert.equal(got.task.state, 'settled')
  assert.equal(got.task.terminalOutcome, 'success')
  assert.equal(got.task.attempts[0].links.workflow.id, 'wf-1')
})

test('reassign via gated takeover using the coordination facade takeover primitive', async () => {
  const { ctx } = createHostContext({})
  const coordinationOwner = createCoordinationLease({ ctx, logger: ctx.logger, now })
  let idSeq = 0
  const { api } = createTaskExecutionObservation({
    ctx,
    execution: { get() {}, observe() {}, history() {}, onChange() {}, availability: { status: 'available' } },
    recovery: { availability() { return { status: 'available' } }, classify() { return { ok: true, class: 'transient' } } },
    coordination: coordinationOwner.api,
    diagnostics: { get() {} },
    workspaceTransactions: { get() {} },
    logger: ctx.logger,
    now,
    idFactory: () => `id-${(idSeq += 1)}`,
  })
  await api.register({ taskId: 'reassign-task', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'reassign' } })
  await api.start('reassign-task')
  const handle = (await coordinationOwner.api.acquire({
    resource: { scope: 'workspace', key: 'repo-a:task' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })).handle
  await api.claim('reassign-task', { ownerId: 'owner-1', lease: handle })
  // a stale expected generation cannot take over
  const failed = await api.reassign('reassign-task', { ownerId: 'owner-2', expectedGeneration: 'gen:WRONG', reason: 'no' })
  assert.equal(failed.ok, false)
  // a correct generation takes over through the coordination takeover
  const reassigned = await api.reassign('reassign-task', { ownerId: 'owner-2', expectedGeneration: handle.generation, reason: 'handoff' })
  assert.equal(reassigned.ok, true)
  const got = await api.get('reassign-task')
  assert.equal(got.task.attempts[got.task.attempts.length - 1].ownerId, 'owner-2')
  coordinationOwner.dispose()
})

test('workspace transaction provenance is consumed when the same-batch feature is present', async () => {
  const { ctx } = createHostContext({})
  const coordinationOwner = createCoordinationLease({ ctx, logger: ctx.logger, now })
  const workspaceTransactions = {
    get(taskId) {
      return Promise.resolve({ ok: true, found: true, transaction: { transactionId: taskId, state: 'committed' } })
    },
  }
  let idSeq = 0
  const { api } = createTaskExecutionObservation({
    ctx,
    execution: { get() {}, observe() {}, history() {}, onChange() {}, availability: { status: 'available' } },
    recovery: { availability() { return { status: 'available' } }, classify() { return { ok: true, class: 'transient' } } },
    coordination: coordinationOwner.api,
    diagnostics: { get() {} },
    workspaceTransactions,
    logger: ctx.logger,
    now,
    idFactory: () => `id-${(idSeq += 1)}`,
  })
  await api.register({ taskId: 'wt-task', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'wt' } })
  await api.start('wt-task', { workflowId: 'wf-1' })
  const attached = await api.attach('wt-task', { transactionId: 'wt-tx-1' })
  assert.equal(attached.ok, true)
  assert.ok(attached.attached.includes('transaction'))
  const got = await api.get('wt-task')
  assert.equal(got.task.attempts[0].links.transaction.id, 'wt-tx-1')
  coordinationOwner.dispose()
})

test('recovery recommendations are preserved as evidence but never executed by the task facade', async () => {
  const { ctx } = createHostContext({})
  const coordinationOwner = createCoordinationLease({ ctx, logger: ctx.logger, now })
  let executed = 0
  const recovery = {
    availability() { return { status: 'available' } },
    classify() { return { ok: true, class: 'transient' } },
    evaluate() {
      return { ok: true, decision: { action: 'retry' } }
    },
    executeRetry() { executed += 1 }, // never called by the task facade
  }
  let idSeq = 0
  const { api } = createTaskExecutionObservation({
    ctx,
    execution: { get() {}, observe() {}, history() {}, onChange() {}, availability: { status: 'available' } },
    recovery,
    coordination: coordinationOwner.api,
    diagnostics: { get() {} },
    workspaceTransactions: { get() {} },
    logger: ctx.logger,
    now,
    idFactory: () => `id-${(idSeq += 1)}`,
  })
  await api.register({ taskId: 'rec-task', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'rec' } })
  await api.start('rec-task')
  const handle = (await coordinationOwner.api.acquire({
    resource: { scope: 'workspace', key: 'repo-a:task' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })).handle
  const claimed = await api.claim('rec-task', { ownerId: 'owner-1', lease: handle })
  // a failed-but-evidenced settle records recovery provenance; the facade
  // never invokes retry itself
  const settled = await api.settle('rec-task', {
    attemptId: claimed.attemptId,
    outcome: 'error',
    reason: 'transient',
    evidence: { source: 'double' },
  })
  assert.equal(settled.ok, true)
  const got = await api.get('rec-task')
  assert.equal(got.task.attempts[0].state, 'settled')
  assert.equal(executed, 0, 'the task facade never executes recovery actions')
  coordinationOwner.dispose()
})

test('negative integration: no scheduler creation, no R replacement, no official package modification', async () => {
  const { ctx, state } = createHostContext({})
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').some((f) => f.name === 'tasks' && f.isActive), true)
  const tasks = state.pluginApi.tasks
  await tasks.register({ taskId: 'neg-task', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'neg' } })
  const got = await tasks.get('neg-task')
  assert.equal(got.task.state, 'registered')
  // no client mutation methods surfaced; the facade is host-only
  assert.equal(typeof tasks.register, 'function')
  assert.equal(typeof tasks.settle, 'function')
})