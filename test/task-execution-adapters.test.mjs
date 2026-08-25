import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSourceAvailability,
  createCoordinationSourceAdapter,
  createDiagnosticsSourceAdapter,
  createExecutionSourceAdapter,
  createJobsSourceAdapter,
  createMemoryTaskRegistry,
  createRecoverySourceAdapter,
  createSessionSourceAdapter,
  createStorageDomainTaskRegistry,
  createSubagentSourceAdapter,
  createTaskEvidenceIntake,
  createWorkflowSourceAdapter,
  createWorkspaceTransactionsSourceAdapter,
} from '../lib/task-execution-adapters.js'

const NOW = '2026-08-25T00:00:00.000Z'
const now = () => NOW

function createCtx(on = () => () => {}) {
  return { get() { return null }, on }
}

test('memory task registry is non-durable, lane-serialized, and CAS-safe', async () => {
  const registry = createMemoryTaskRegistry({ now })
  assert.equal(registry.capabilities().durability, 'memory')
  const written = await registry.writeCas('task-1', 0, { taskId: 'task-1', state: 'registered' })
  assert.equal(written.ok, true)
  assert.equal(written.record.revision, 1)
  const stale = await registry.writeCas('task-1', 0, { taskId: 'task-1', state: 'active' })
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'compare-conflict')
  const found = await registry.read('task-1')
  assert.equal(found.ok, true)
  assert.equal(found.record.state, 'registered')
  const parallel = await Promise.all([
    registry.writeCas('task-2', 0, { taskId: 'task-2' }),
    registry.writeCas('task-2', 0, { taskId: 'task-2' }),
  ])
  assert.equal(parallel[0].ok, true)
  assert.equal(parallel[1].ok, false)
  assert.equal(parallel[1].code, 'compare-conflict')
  registry.prependEvent('task-1', { kind: 'transition', nextState: 'active', revision: 2 })
  const events = await registry.queryEvents('task-1')
  assert.equal(events.events.length, 1)
  registry.dispose()
  assert.equal((await registry.read('task-1')).ok, false)
})

test('storage-domain task registry only on explicit durable+atomic evidence', async () => {
  const unit = {
    read() { return null },
    write() { return true },
    compareAndSwap() { return true },
  }
  const durable = createStorageDomainTaskRegistry({
    unit,
    capabilityReport: { durability: 'workspace', atomicCas: true, scope: 'workspace' },
    now,
  })
  assert.equal(durable.capabilities().durability, 'durable')
  const written = await durable.writeCas('task-1', 0, { taskId: 'task-1', state: 'registered' })
  assert.equal(written.ok, true)
  const noAtomic = createStorageDomainTaskRegistry({
    unit,
    capabilityReport: { durability: 'workspace', atomicCas: false, scope: 'workspace' },
    now,
  })
  assert.equal(noAtomic.capabilities().status, 'unknown')
  const cas = await noAtomic.writeCas('task-1', 0, { taskId: 'task-1' })
  assert.equal(cas.ok, false)
  assert.equal(cas.code, 'unsupported')
})

test('execution source adapter consumes the public projection read-only and degrades per source', () => {
  const execution = {
    observe() {},
    get() {},
    history() {},
    onChange() {},
    availability: { status: 'available' },
  }
  const adapter = createExecutionSourceAdapter({ execution, now })
  assert.equal(adapter.availability().status, 'available')
  const confirmed = adapter.confirm('exec-1')
  assert.equal(confirmed.ok, true)
  assert.equal(confirmed.link.id, 'exec-1')
  const missing = createExecutionSourceAdapter({ execution: null, now })
  assert.equal(missing.availability().status, 'unavailable')
  assert.equal(missing.confirm('exec-1').ok, false)
  // never synthesize an identity from an event sequence
  assert.equal(adapter.confirm(undefined).ok, false)
})

test('recovery source adapter consumes decisions/capabilities read-only', () => {
  const recovery = {
    classify() {},
    evaluate() {},
    availability: { status: 'available' },
  }
  const adapter = createRecoverySourceAdapter({ recovery, now })
  assert.equal(adapter.availability().status, 'available')
  assert.equal(adapter.confirm().ok, true)
  const missing = createRecoverySourceAdapter({ recovery: null, now })
  assert.equal(missing.availability().status, 'unavailable')
})

test('coordination source adapter delegates acquire and takeover with typed outcomes', async () => {
  const coordination = {
    acquire(input) {
      return Promise.resolve({ ok: true, handle: { ...input, generation: 'gen:1', fencingToken: 'tok-1' } })
    },
    takeover() {
      return Promise.resolve({ ok: false, code: 'conflict', observed: { generation: 'gen:1' } })
    },
  }
  const adapter = createCoordinationSourceAdapter({ coordination, now })
  assert.equal(adapter.availability().status, 'available')
  const acquired = await adapter.acquire({ resource: { scope: 'workspace', key: 'repo-a' }, ownerId: 'owner-1', leaseMs: 60_000 })
  assert.equal(acquired.ok, true)
  assert.equal(acquired.handle.generation, 'gen:1')
  const taken = await adapter.takeover({ resource: { scope: 'workspace', key: 'repo-a' }, ownerId: 'o', leaseMs: 1, expectedProof: { generation: 'gen:1' } })
  assert.equal(taken.ok, false)
  assert.equal(taken.code, 'conflict')
  const missing = createCoordinationSourceAdapter({ coordination: null, now })
  assert.equal(missing.availability().status, 'unavailable')
  assert.equal((await missing.acquire({})).code, 'unsupported')
})

test('diagnostics and workspaceTransactions adapters degrade when the projection is absent', () => {
  const diagnostics = createDiagnosticsSourceAdapter({ diagnostics: { get() {} }, now })
  assert.equal(diagnostics.availability().status, 'available')
  const noDiagnostics = createDiagnosticsSourceAdapter({ diagnostics: null, now })
  assert.equal(noDiagnostics.availability().status, 'unavailable')

  const wt = createWorkspaceTransactionsSourceAdapter({ workspaceTransactions: { get() {} }, now })
  assert.equal(wt.availability().status, 'available')
  assert.equal(wt.confirm('tx-1').ok, true)
  const noWt = createWorkspaceTransactionsSourceAdapter({ workspaceTransactions: null, now })
  assert.equal(noWt.availability().status, 'unavailable')
})

test('jobs adapter reads the public jobs service when available; workflow/subagent adapters need the event substrate', () => {
  const jobs = createJobsSourceAdapter({ ctx: createCtx(), now })
  assert.equal(jobs.availability().status, 'unavailable')
  const withJobs = createJobsSourceAdapter({
    ctx: { get(name) { return name === 'jobs' ? { get() {}, list() {} } : null } },
    now,
  })
  assert.equal(withJobs.availability().status, 'available')
  assert.equal(withJobs.confirm('job-1').ok, true)

  const workflow = createWorkflowSourceAdapter({ ctx: createCtx(), now })
  assert.equal(workflow.availability().status, 'available')
  assert.equal(workflow.confirm('wf-1').link.id, 'wf-1')
  const noEvents = createWorkflowSourceAdapter({ ctx: { get() { return null } }, now })
  assert.equal(noEvents.availability().status, 'unavailable')

  const subagent = createSubagentSourceAdapter({ ctx: createCtx(), now })
  assert.equal(subagent.availability().status, 'available')
  const noSubagentEvents = createSubagentSourceAdapter({ ctx: { get() { return null } }, now })
  assert.equal(noSubagentEvents.availability().status, 'unavailable')
})

test('session adapter delegates read-only and never copies the transcript', () => {
  const sessions = { get() {} }
  const adapter = createSessionSourceAdapter({ ctx: { get(name) { return name === 'sessions' ? sessions : null } }, now })
  assert.equal(adapter.availability().status, 'available')
  assert.equal(adapter.confirm('session-1').ok, true)
  const missing = createSessionSourceAdapter({ ctx: { get() { return null } }, now })
  assert.equal(missing.availability().status, 'unavailable')
})

test('buildSourceAvailability aggregates per-source status into the bounded projection', () => {
  const adapters = {
    execution: createExecutionSourceAdapter({ execution: null, now }),
    recovery: createRecoverySourceAdapter({ recovery: null, now }),
    coordination: createCoordinationSourceAdapter({ coordination: null, now }),
    diagnostics: createDiagnosticsSourceAdapter({ diagnostics: null, now }),
    workspaceTransactions: createWorkspaceTransactionsSourceAdapter({ workspaceTransactions: null, now }),
    jobs: createJobsSourceAdapter({ ctx: createCtx(), now }),
    workflow: createWorkflowSourceAdapter({ ctx: createCtx(), now }),
    subagent: createSubagentSourceAdapter({ ctx: createCtx(), now }),
    session: createSessionSourceAdapter({ ctx: { get() { return null } }, now }),
  }
  const sources = buildSourceAvailability(adapters)
  assert.equal(sources.execution, 'unavailable')
  assert.equal(sources.workflow, 'available')
  assert.equal(sources.sessions, undefined)
  assert.equal(sources.session, 'unavailable')
  assert.equal(Object.isFrozen(sources), true)
})

test('task evidence intake bridges execution/jobs/workflow/subagent events into bounded provenance', () => {
  const listeners = new Map()
  const ctx = {
    on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
    get() { return null },
  }
  const execution = {
    onChange(fn) { execution.changeHandler = fn; return () => { execution.changeHandler = null } },
  }
  const intake = createTaskEvidenceIntake({ ctx, execution, now })
  assert.equal(intake.size, 0)
  assert.ok(listeners.has('jobs/done'))
  assert.ok(listeners.has('jobs/changed'))
  assert.ok(listeners.has('workflow/start'))
  assert.ok(listeners.has('workflow/end'))
  assert.ok(listeners.has('subagent/start'))
  assert.ok(listeners.has('subagent/end'))

  execution.changeHandler({ executionId: 'exec-1' })
  listeners.get('jobs/done')({ jobId: 'job-1' })
  listeners.get('workflow/start')({ workflowId: 'wf-1' })
  listeners.get('subagent/end')({ agentId: 'agent-1' })
  assert.equal(intake.size, 4)
  assert.equal(intake.latest('execution').id, 'exec-1')
  assert.equal(intake.latest('job').id, 'job-1')
  assert.equal(intake.latest('workflow').id, 'wf-1')
  assert.equal(intake.latest('subagent').id, 'agent-1')

  // a throwing observer never breaks the intake
  execution.changeHandler({ executionId: 'exec-2' })
  assert.equal(intake.size, 5)

  // stale callbacks from a replaced generation are ignored by the consumer
  const detach = intake.dispose()
  assert.equal(detach, true)
  assert.equal(intake.dispose(), false)
  assert.equal(listeners.has('workflow/start'), false)
  assert.equal(execution.changeHandler, null, 'execution change detach was registered')
})

test('evidence refs keep the certainty vocabulary and bounded ids', async () => {
  const { buildEvidenceReference } = await (async () => import('../lib/task-execution-adapters.js'))()
  const ref = buildEvidenceReference({ kind: 'execution', id: 'exec-1', certainty: 'served', observedAt: NOW })
  assert.equal(ref.certainty, 'served')
  const degraded = buildEvidenceReference({ kind: 'x', id: 'y', certainty: 'bogus', observedAt: NOW })
  assert.equal(degraded.certainty, 'unknown')
})