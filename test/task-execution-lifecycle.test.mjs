import test from 'node:test'
import assert from 'node:assert/strict'
import { createTaskExecutionObservation } from '../lib/task-execution-observation.js'

const NOW = '2026-08-25T00:00:00.000Z'
let nowValue = Date.parse(NOW)
const now = () => new Date(nowValue).toISOString()

function createCoordinationDouble() {
  const records = new Map()
  const watchers = new Map()
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
    acquire({ resource, ownerId, leaseMs, provenance }) {
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
        provenance: provenance ?? [],
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
        provenance: [...(current.provenance ?? []), { kind: 'takeover', id: current.generation, certainty: 'observed' }],
      }
      records.set(resource.key, value)
      return Promise.resolve({ ok: true, handle: { ...value } })
    },
    watch(resource) {
      const subscription = {
        current() {
          const current = records.get(resource.key)
          if (!current) return Promise.resolve({ code: 'unavailable' })
          return Promise.resolve(redact(current))
        },
        subscribe(fn) {
          const listeners = watchers.get(resource.key) ?? new Set()
          watchers.set(resource.key, listeners)
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
        dispose() { return true },
      }
      return subscription
    },
  }
}

function createSources({ coordination } = {}) {
  const execution = {
    get() {}, observe() {}, history() {}, onChange() {},
    availability: { status: 'available' },
  }
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
  const diagnostics = { get() {}, onChange() {} }
  const workspaceTransactions = { get() {} }
  const jobs = { get() {}, list() {}, read() {} }
  return {
    execution,
    recovery,
    coordination: coordination ?? createCoordinationDouble(),
    diagnostics,
    workspaceTransactions,
    ctx: {
      get(name) {
        if (name === 'jobs') return jobs
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

test('register requires stable identity, owner/scope, intent, and creation provenance', async () => {
  const { owner } = createOwner()
  const base = {
    taskId: 'task-1',
    ownerId: 'owner-1',
    scope: taskScope,
    intent: { kind: 'review', summary: 'review PR' },
    provenance: [{ kind: 'creation', id: 'cre-1', certainty: 'observed' }],
  }
  const ok = await owner.api.register(base)
  assert.equal(ok.ok, true)
  assert.equal(ok.code, 'registered')
  assert.equal(ok.task.state, 'registered')
  assert.equal(Object.isFrozen(ok.task), true)
  for (const [key, mutate] of [
    ['taskId', (v) => ({ ...v, taskId: undefined })],
    ['ownerId', (v) => ({ ...v, ownerId: '' })],
    ['scope', (v) => ({ ...v, scope: undefined })],
    ['intent', (v) => ({ ...v, intent: undefined })],
  ]) {
    const result = await owner.api.register(mutate(base))
    assert.equal(result.ok, false, `${key} must be rejected`)
    assert.equal(result.code, 'invalid-input')
  }
})

test('equivalent immutable metadata is idempotent; conflicting metadata is identity-conflict without merging', async () => {
  const { owner } = createOwner()
  const base = {
    taskId: 'task-1',
    ownerId: 'owner-1',
    scope: taskScope,
    intent: { kind: 'review', summary: 'review PR' },
  }
  const first = await owner.api.register(base)
  assert.equal(first.ok, true)
  const replay = await owner.api.register(base)
  assert.equal(replay.ok, true)
  assert.equal(replay.idempotent, true)
  const conflict = await owner.api.register({ ...base, ownerId: 'owner-2' })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.code, 'identity-conflict')
  const got = await owner.api.get('task-1')
  assert.equal(got.task.ownerId, 'owner-1')
  assert.equal(got.task.intent.summary, 'review PR')
})

test('start creates a distinct attempt/run linked to the parent task without publishing an active attempt', async () => {
  const { owner } = createOwner()
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  const started = await owner.api.start('task-1', {
    runId: 'run-1',
    workflowId: 'wf-1',
    executionId: 'exec-1',
    sessionId: 'session-1',
    jobId: 'job-1',
  })
  assert.equal(started.ok, true)
  assert.equal(started.runId, 'run-1')
  assert.equal(started.attemptId.startsWith('id-'), true)
  assert.equal(started.links.workflow.id, 'wf-1')
  assert.equal(started.links.execution.id, 'exec-1')
  assert.equal(started.links.job.id, 'job-1')
  const got = await owner.api.get('task-1')
  // the task stays registered; the attempt is registered (fencing pending)
  assert.equal(got.task.state, 'registered')
  assert.equal(got.task.attempts.length, 1)
  assert.equal(got.task.attempts[0].state, 'registered')
  assert.equal(got.task.activeAttemptId, started.attemptId)
  // retry gets a distinct attempt identity; the parent task identity is unchanged
  const retry = await owner.api.start('task-1', { runId: 'run-2' })
  assert.equal(retry.attemptId !== started.attemptId, true)
  const gotRetry = await owner.api.get('task-1')
  assert.equal(gotRetry.task.taskId, 'task-1')
  assert.equal(gotRetry.task.attempts.length, 2)
})

test('start preserves links only when the source confirms them; unavailable links stay unavailable', async () => {
  const sources = createSources()
  sources.execution.get = undefined
  const { owner } = createOwner(sources)
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  const started = await owner.api.start('task-1', { executionId: 'exec-1', workflowId: 'wf-1' })
  assert.equal(started.ok, true)
  const got = await owner.api.get('task-1')
  const links = got.task.attempts[0].links
  // workflow adapter confirms; the broken execution source degrades per source
  assert.equal(links.workflow?.id, 'wf-1')
  assert.equal(links.execution, undefined)
})

test('claim validates coordination fencing before publishing active; competing claim conflicts deterministically', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  await owner.api.start('task-1', { workflowId: 'wf-1' })
  const acquired = await sources.coordination.acquire({
    resource: { scope: 'workspace', key: 'repo-a:task' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })
  const claimed = await owner.api.claim('task-1', {
    ownerId: 'owner-1',
    lease: acquired.handle,
    reason: 'start work',
  })
  assert.equal(claimed.ok, true)
  assert.equal(claimed.code, 'active')
  assert.equal(claimed.generation, acquired.handle.generation)
  const got = await owner.api.get('task-1')
  assert.equal(got.task.state, 'active')
  assert.equal(got.task.attempts[0].state, 'active')
  assert.equal(got.task.attempts[0].ownerId, 'owner-1')

  // a competing claim from another owner is a deterministic conflict
  const otherLease = await sources.coordination.acquire({
    resource: { scope: 'workspace', key: 'repo-a:task' },
    ownerId: 'owner-2',
    leaseMs: 60_000,
  })
  const foreign = await owner.api.claim('task-1', { ownerId: 'owner-2', lease: otherLease.handle })
  assert.equal(foreign.ok, false)
  assert.equal(foreign.code, 'conflict')
  const gotAfter = await owner.api.get('task-1')
  assert.equal(gotAfter.task.attempts[0].ownerId, 'owner-1')
})

test('claim requires a valid lease handle and rejects stale fencing', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  await owner.api.start('task-1')
  const noLease = await owner.api.claim('task-1', { ownerId: 'owner-1' })
  assert.equal(noLease.ok, false)
  assert.equal(noLease.code, 'invalid-input')
  // a fabricated lease that the coordination facade cannot confirm
  const forged = await owner.api.claim('task-1', {
    ownerId: 'owner-1',
    lease: {
      resource: { scope: 'workspace', key: 'repo-a:task' },
      ownerId: 'owner-1',
      generation: 'gen:does-not-exist',
      fencingToken: 'tok-x',
      expiresAt: new Date(nowValue + 60_000).toISOString(),
    },
  })
  assert.equal(forged.ok, false)
  assert.ok(['stale-fencing', 'unavailable', 'unsupported'].includes(forged.code))
})

test('reassign calls coordination takeover first and publishes a new attempt/generation only after success', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  await owner.api.start('task-1', { workflowId: 'wf-1' })
  const acquired = await sources.coordination.acquire({
    resource: { scope: 'workspace', key: 'repo-a:task' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })
  await owner.api.claim('task-1', { ownerId: 'owner-1', lease: acquired.handle })

  // a takeover with the wrong expected generation fails and leaves state
  const failed = await owner.api.reassign('task-1', {
    ownerId: 'owner-2',
    expectedGeneration: 'gen:WRONG',
    reason: 'handoff',
  })
  assert.equal(failed.ok, false)
  assert.equal(failed.code, 'conflict')
  const gotFailed = await owner.api.get('task-1')
  assert.equal(gotFailed.task.state, 'active')
  assert.equal(gotFailed.task.attempts[0].ownerId, 'owner-1')

  // a valid takeover reassigns and supersedes the prior attempt
  const reassigned = await owner.api.reassign('task-1', {
    ownerId: 'owner-2',
    expectedGeneration: acquired.handle.generation,
    reason: 'handoff to reviewer',
  })
  assert.equal(reassigned.ok, true)
  assert.equal(reassigned.code, 'reassigned')
  assert.equal(reassigned.generation.startsWith('gen:'), true)
  const got = await owner.api.get('task-1')
  assert.equal(got.task.state, 'active')
  assert.equal(got.task.attempts.length, 2)
  const superseded = got.task.attempts.find((a) => a.state === 'superseded')
  const active = got.task.attempts.find((a) => a.state === 'active')
  assert.ok(superseded)
  assert.equal(superseded.ownerId, 'owner-1')
  assert.equal(active.ownerId, 'owner-2')
})

test('reassign preserves the reassign reason in provenance', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  await owner.api.start('task-1')
  const acquired = await sources.coordination.acquire({
    resource: { scope: 'workspace', key: 'repo-a:task' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })
  await owner.api.claim('task-1', { ownerId: 'owner-1', lease: acquired.handle })
  await owner.api.reassign('task-1', {
    ownerId: 'owner-2',
    expectedGeneration: acquired.handle.generation,
    reason: 'handoff because reviewer is ready',
  })
  const got = await owner.api.get('task-1')
  const newAttempt = got.task.attempts[got.task.attempts.length - 1]
  assert.ok(newAttempt.provenance.some((entry) => entry.kind === 'reason' && entry.id === 'handoff because reviewer is ready'))
})

test('stale attempt submissions are rejected or kept as bounded late provenance and never change task state', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  await owner.api.start('task-1', { runId: 'run-1' })
  const acquired = await sources.coordination.acquire({
    resource: { scope: 'workspace', key: 'repo-a:task' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })
  const claimed = await owner.api.claim('task-1', { ownerId: 'owner-1', lease: acquired.handle })
  // settle the current attempt
  const settled = await owner.api.settle('task-1', { attemptId: claimed.attemptId, outcome: 'success', evidence: { source: 'double' } })
  assert.equal(settled.ok, true)
  assert.equal(settled.state, 'settled')
  // a stale attempt with a conflicting outcome cannot settle the terminal task
  const late = await owner.api.settle('task-1', { attemptId: claimed.attemptId, outcome: 'error', reason: 'late' })
  assert.equal(late.ok, true)
  assert.equal(late.late, true)
  assert.equal(late.idempotent, true)
  const got = await owner.api.get('task-1')
  assert.equal(got.task.state, 'settled')
  assert.equal(got.task.terminalOutcome, 'success')
})

test('a disposed facade returns inactive', async () => {
  const { owner } = createOwner()
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'x' } })
  owner.dispose()
  const result = await owner.api.start('task-1')
  assert.equal(result.code, 'inactive')
  const registered = await owner.api.register({ taskId: 'task-2', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'x' } })
  assert.equal(registered.code, 'inactive')
})

test('task and execution identities never collide across the projection', async () => {
  const { owner } = createOwner()
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  await owner.api.start('task-1', { executionId: 'exec-1' })
  const got = await owner.api.get('task-1')
  // the task ID was never rewritten into the execution link and vice versa
  assert.equal(got.task.taskId, 'task-1')
  assert.equal(got.task.attempts[0].links.execution.id, 'exec-1')
  assert.notEqual(got.task.attempts[0].links.execution.id, got.task.taskId)
})