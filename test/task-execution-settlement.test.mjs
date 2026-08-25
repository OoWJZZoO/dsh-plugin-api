import test from 'node:test'
import assert from 'node:assert/strict'
import { createTaskExecutionObservation } from '../lib/task-execution-observation.js'

const NOW = '2026-08-25T00:00:00.000Z'
let nowValue = Date.parse(NOW)
const now = () => new Date(nowValue).toISOString()

function createCoordinationDouble() {
  const records = new Map()
  let generationSeq = 0
  const redact = (value) => ({
    resource: value.resource,
    ownerId: value.ownerId,
    generation: value.generation,
    expiresAt: value.expiresAt,
    state: value.state,
    version: value.version,
    fencingValid: value.state === 'active',
  })
  return {
    _records: records,
    acquire({ resource, ownerId, leaseMs }) {
      if (records.get(resource.key)?.state === 'active') {
        return Promise.resolve({ ok: false, code: 'conflict', observed: redact(records.get(resource.key)) })
      }
      generationSeq += 1
      const value = {
        resource,
        ownerId,
        generation: `gen:${String(generationSeq).padStart(12, '0')}`,
        fencingToken: `tok-${generationSeq}`,
        expiresAt: new Date(nowValue + leaseMs).toISOString(),
        state: 'active',
        version: 0,
      }
      records.set(resource.key, value)
      return Promise.resolve({ ok: true, handle: { ...value } })
    },
    takeover({ resource, ownerId, expectedProof }) {
      const current = records.get(resource.key)
      if (!current || current.generation !== expectedProof?.generation) {
        return Promise.resolve({ ok: false, code: 'conflict', observed: current ? redact(current) : undefined })
      }
      generationSeq += 1
      const value = {
        resource,
        ownerId,
        generation: `gen:${String(generationSeq).padStart(12, '0')}`,
        fencingToken: `tok-${generationSeq}`,
        expiresAt: new Date(nowValue + 60_000).toISOString(),
        state: 'active',
        version: 0,
      }
      records.set(resource.key, value)
      return Promise.resolve({ ok: true, handle: { ...value } })
    },
    watch(resource) {
      return {
        current() {
          const current = records.get(resource.key)
          if (!current) return Promise.resolve({ code: 'unavailable' })
          return Promise.resolve(redact(current))
        },
        subscribe() { return () => false },
        dispose() { return true },
      }
    },
  }
}

function createSources() {
  const coordination = createCoordinationDouble()
  const recovery = {
    classify(input) {
      if (input?.kind === 'aborted') return { ok: true, class: 'aborted' }
      if (input?.kind === 'denied') return { ok: true, class: 'denied' }
      if (input?.kind === 'superseded') return { ok: true, class: 'superseded' }
      return { ok: true, class: 'transient' }
    },
    evaluate() { return { ok: true, decision: { action: 'stop' } } },
    availability: { status: 'available' },
  }
  return {
    coordination,
    recovery,
    execution: { get() {}, observe() {}, history() {}, onChange() {}, availability: { status: 'available' } },
    diagnostics: { get() {} },
    workspaceTransactions: { get() {} },
    ctx: {
      get(name) {
        if (name === 'jobs') return { get() {}, list() {}, read() {} }
        if (name === 'sessions') return { get() {} }
        return null
      },
      on() { return () => {} },
    },
  }
}

let idSeq = 0
function createOwner(sources = createSources()) {
  return {
    sources,
    owner: createTaskExecutionObservation({
      ctx: sources.ctx,
      execution: sources.execution,
      recovery: sources.recovery,
      coordination: sources.coordination,
      diagnostics: sources.diagnostics,
      workspaceTransactions: sources.workspaceTransactions,
      logger: { error() {} },
      now,
      idFactory: () => `id-${(idSeq += 1)}`,
    }),
  }
}

const taskScope = { kind: 'workspace', key: 'repo-a' }

async function registerStartClaim(ownerApi, sources, { taskId = 'task-1' } = {}) {
  await ownerApi.register({ taskId, ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  await ownerApi.start(taskId, { workflowId: 'wf-1' })
  const acquired = await sources.coordination.acquire({
    resource: { scope: 'workspace', key: 'repo-a:task' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })
  const claimed = await ownerApi.claim(taskId, { ownerId: 'owner-1', lease: acquired.handle })
  assert.equal(claimed.ok, true)
  return claimed
}

test('settle publishes exactly one authoritative settlement with outcome, reason, source, and provenance', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  const claimed = await registerStartClaim(owner.api, sources)
  const settled = await owner.api.settle('task-1', {
    attemptId: claimed.attemptId,
    outcome: 'success',
    reason: 'PR merged',
    source: { kind: 'workflow', id: 'wf-1' },
    evidence: { integration: 'double' },
  })
  assert.equal(settled.ok, true)
  assert.equal(settled.code, 'settled')
  assert.equal(settled.outcome, 'success')
  assert.equal(settled.state, 'settled')
  const got = await owner.api.get('task-1')
  assert.equal(got.task.state, 'settled')
  assert.equal(got.task.terminalOutcome, 'success')
  assert.equal(got.task.attempts[0].state, 'settled')
  assert.equal(got.task.attempts[0].outcome, 'success')
  assert.equal(got.task.attempts[0].reason, 'PR merged')
  // recovery safety classification is attached as provenance
  assert.ok(got.task.attempts[0].provenance.some((entry) => entry.kind === 'recovery-classification'))
  // the caller-supplied source reference is preserved as settlement provenance
  assert.ok(got.task.attempts[0].provenance.some((entry) => entry.kind === 'workflow' && entry.id === 'wf-1'))

  // duplicate settlement with equivalent evidence is an idempotent no-op
  const duplicate = await owner.api.settle('task-1', { attemptId: claimed.attemptId, outcome: 'success' })
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.idempotent, true)
})

test('aborted and denied outcomes are preserved, never reinterpreted as retryable success', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  const claimed = await registerStartClaim(owner.api, sources)
  for (const outcome of ['aborted', 'denied', 'superseded', 'error']) {
    const bundleN = createOwner(createSources())
    const ownerN = bundleN.owner
    const claimedN = await registerStartClaim(ownerN.api, bundleN.sources, { taskId: `task-${outcome}` })
    const settled = await ownerN.api.settle(`task-${outcome}`, {
      attemptId: claimedN.attemptId,
      outcome,
      reason: `because ${outcome}`,
      evidence: { source: 'double' },
    })
    assert.equal(settled.ok, true)
    assert.equal(settled.outcome, outcome)
    const got = await ownerN.api.get(`task-${outcome}`)
    assert.equal(got.task.terminalOutcome, outcome)
    // aborted/denied/superseded are never marked retry-safe (recovery
    // classification carries them)
    assert.ok(got.task.attempts[0].provenance.some((e) => e.kind === 'recovery-classification'))
  }
})

test('contradictory or incomplete settlement evidence yields unknown, not inferred success', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  const claimed = await registerStartClaim(owner.api, sources)
  // an error outcome without evidence is incomplete -> unknown observation state
  const settled = await owner.api.settle('task-1', { attemptId: claimed.attemptId, outcome: 'error', reason: 'broke' })
  assert.equal(settled.ok, true)
  assert.equal(settled.state, 'unknown')
  const got = await owner.api.get('task-1')
  assert.equal(got.task.state, 'unknown')
  assert.equal(got.task.terminalOutcome, undefined)
})

test('multiple starts create distinct attempt identities under one unchanged task identity', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  const first = await owner.api.start('task-1', { runId: 'run-1', workflowId: 'wf-1' })
  assert.equal(first.ok, true)
  const second = await owner.api.start('task-1', { runId: 'run-2' })
  assert.equal(second.ok, true)
  assert.notEqual(second.attemptId, first.attemptId)
  const got = await owner.api.get('task-1')
  assert.equal(got.task.taskId, 'task-1')
  assert.equal(got.task.attempts.length, 2)
  assert.equal(got.task.attempts[0].runId, 'run-1')
  assert.equal(got.task.attempts[1].runId, 'run-2')
  assert.equal(got.task.activeAttemptId, second.attemptId)
  // each run kept its own confirmed links
  assert.equal(got.task.attempts[0].links.workflow.id, 'wf-1')
})

test('old attempt or duplicate callback after a terminal task state preserves the terminal record with late provenance', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  const claimed = await registerStartClaim(owner.api, sources)
  await owner.api.settle('task-1', { attemptId: claimed.attemptId, outcome: 'success', reason: 'done', evidence: { source: 'double' } })
  // a conflicting late settlement from the same attempt is rejected as late
  const late = await owner.api.settle('task-1', { attemptId: claimed.attemptId, outcome: 'error', reason: 'late error' })
  assert.equal(late.ok, true)
  assert.equal(late.late, true)
  const got = await owner.api.get('task-1')
  assert.equal(got.task.state, 'settled')
  assert.equal(got.task.terminalOutcome, 'success')
})

test('reassign gated takeover: failed takeover leaves the current attempt authoritative', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  const claimed = await registerStartClaim(owner.api, sources)
  const failed = await owner.api.reassign('task-1', {
    ownerId: 'owner-2',
    expectedGeneration: 'gen:wrong',
    reason: 'nope',
  })
  assert.equal(failed.ok, false)
  const got = await owner.api.get('task-1')
  assert.equal(got.task.state, 'active')
  assert.equal(got.task.attempts[0].attemptId, claimed.attemptId)
  assert.equal(got.task.attempts[0].ownerId, 'owner-1')
})

test('history returns bounded truncated-aware events with nextCursor', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  await owner.api.start('task-1')
  const historySmall = await owner.api.history('task-1')
  assert.equal(historySmall.ok, true)
  assert.equal(historySmall.truncated, false)
  assert.ok(historySmall.events.length >= 1)
  assert.equal(Object.isFrozen(historySmall.events), true)
  // cursor pagination returns the tail after the given revision
  const page = await owner.api.history('task-1', { limit: 1 })
  assert.equal(page.truncated, true)
  assert.equal(page.events.length, 1)
  assert.ok(page.nextCursor)
  // a missing task returns a typed unavailable, never fabricated history
  const missing = await owner.api.history('task-void')
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'unavailable')
})