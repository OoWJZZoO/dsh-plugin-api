import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ATTEMPT_STATES,
  buildAvailability,
  canTransition,
  cloneBoundedPublic,
  normalizeIntent,
  normalizeLeaseHandle,
  normalizeLink,
  normalizeOwnerId,
  normalizeProvenance,
  normalizeRunLinks,
  normalizeScope,
  normalizeTaskId,
  redactAttempt,
  redactTaskRecord,
  TASK_OUTCOMES,
  TASK_SCOPES,
  TASK_STATES,
  TASK_TERMINAL,
} from '../lib/task-execution-normalize.js'
import { deepFreeze } from '../lib/deep-freeze.js'

test('normalizeTaskId accepts bounded ids and rejects empty/oversized values', () => {
  assert.equal(normalizeTaskId('task-1').ok, true)
  assert.equal(normalizeTaskId('').ok, false)
  assert.equal(normalizeTaskId(undefined).ok, false)
  assert.equal(normalizeTaskId('x'.repeat(500)).value.length, 120)
})

test('normalizeScope uses the fixed four-kind vocabulary with canonical key and display label', () => {
  const ok = normalizeScope({ kind: 'workspace', key: 'repo-a', label: 'Repo A' })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.kind, 'workspace')
  assert.equal(ok.value.label, 'Repo A')
  assert.equal(normalizeScope({ kind: 'planet', key: 'x' }).ok, false)
  assert.equal(normalizeScope({ kind: 'workspace' }).ok, false)
  assert.equal(normalizeScope(null).ok, false)
})

test('normalizeOwnerId and normalizeIntent bounds', () => {
  assert.equal(normalizeOwnerId('owner-1').ok, true)
  assert.equal(normalizeOwnerId('').ok, false)
  assert.equal(normalizeIntent({ kind: 'review', summary: 'review PR' }).ok, true)
  assert.equal(normalizeIntent({ kind: 'review' }).ok, false)
})

test('normalizeLink requires a source identity and keeps the certainty vocabulary', () => {
  const link = normalizeLink({ id: 'exec-1', generation: 'g1', certainty: 'served' }, 'execution')
  assert.equal(link.ok, true)
  assert.equal(link.value.id, 'exec-1')
  assert.equal(link.value.generation, 'g1')
  assert.equal(link.value.certainty, 'served')
  assert.equal(normalizeLink({ certainty: 'served' }, 'execution').ok, false)
  assert.equal(normalizeLink({ id: 'exec-1', certainty: 'bogus' }, 'execution').value.certainty, 'observed')
})

test('normalizeRunLinks preserves only confirmed links and rejects malformed members', () => {
  const ok = normalizeRunLinks({
    workflow: { id: 'wf-1', generation: 'g1' },
    execution: { id: 'exec-1', certainty: 'unavailable' },
    job: { id: 'job-1' },
    transaction: undefined,
    session: null,
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.workflow.id, 'wf-1')
  assert.equal(ok.value.execution.certainty, 'unavailable')
  assert.equal(ok.value.job.id, 'job-1')
  assert.equal(ok.value.session, undefined)
  assert.equal(ok.value.transaction, undefined)
  assert.equal(normalizeRunLinks({ execution: { certainty: 'x' } }).ok, false)
  assert.equal(normalizeRunLinks(null).ok, true)
})

test('normalizeLeaseHandle requires the exact coordination handle shape', () => {
  const valid = normalizeLeaseHandle({
    resource: { scope: 'workspace', key: 'repo-a' },
    ownerId: 'owner-1',
    generation: 'gen:1',
    fencingToken: 'tok-1',
    expiresAt: '2026-08-25T00:10:00.000Z',
  })
  assert.equal(valid.ok, true)
  assert.equal(valid.value.resource.key, 'repo-a')
  assert.equal(normalizeLeaseHandle({ generation: 'g' }).ok, false)
  assert.equal(normalizeLeaseHandle({ resource: { scope: 'workspace', key: 'k' }, ownerId: 'o', generation: 'g', fencingToken: 't', expiresAt: 'not-a-time' }).ok, false)
})

test('canTransition encodes the task transition table with terminal protection', () => {
  // registered fan-out: start stays registered, claim activates, reassign gates
  assert.equal(canTransition('registered', 'registered'), true)
  assert.equal(canTransition('registered', 'active'), true)
  assert.equal(canTransition('registered', 'reassigning'), true)
  // active fan-out
  assert.equal(canTransition('active', 'settling'), true)
  assert.equal(canTransition('active', 'reassigning'), true)
  assert.equal(canTransition('active', 'failed'), true)
  assert.equal(canTransition('active', 'unknown'), true)
  // reassigning -> active only
  assert.equal(canTransition('reassigning', 'active'), true)
  assert.equal(canTransition('reassigning', 'settled'), false)
  assert.equal(canTransition('reassigning', 'failed'), false)
  // settling -> settled/failed/unknown
  assert.equal(canTransition('settling', 'settled'), true)
  assert.equal(canTransition('settling', 'failed'), true)
  assert.equal(canTransition('settling', 'unknown'), true)
  assert.equal(canTransition('settling', 'active'), false)
  // terminal immutability
  for (const terminal of TASK_TERMINAL) {
    for (const state of TASK_STATES) {
      if (state === terminal) continue
      assert.equal(canTransition(terminal, state), false, `${terminal} -> ${state} must be rejected`)
    }
  }
  assert.equal(canTransition('active', 'active'), false)
  assert.equal(canTransition('bogus', 'active'), false)
})

test('task outcome vocabulary is the unified terminal set', () => {
  assert.deepEqual(TASK_OUTCOMES, ['success', 'error', 'aborted', 'denied', 'superseded'])
  assert.deepEqual(TASK_SCOPES, ['session', 'workspace', 'profile', 'process'])
  assert.deepEqual(TASK_TERMINAL, ['settled', 'failed', 'unknown'])
  assert.ok(ATTEMPT_STATES.includes('superseded'))
})

test('buildAvailability is a truth-subset: memory never durable, durable tiers merge to durable', () => {
  const memory = buildAvailability({
    status: 'available',
    scope: 'process',
    durability: 'memory',
    operations: { register: 'available', history: 'available' },
    sources: { execution: 'available' },
    backend: { id: 'memory' },
    epoch: 'epoch:1',
  })
  assert.equal(memory.durability, 'memory')
  assert.equal(memory.operations.register, 'available')
  assert.equal(memory.operations.claim, 'unknown')
  assert.equal(memory.sources.execution, 'available')
  assert.equal(memory.sources.jobs, 'unknown')
  const durable = buildAvailability({
    status: 'available',
    scope: 'workspace',
    durability: 'workspace',
    operations: { register: 'available' },
    sources: { execution: 'available' },
    backend: { id: 'storage-domain' },
  })
  assert.equal(durable.durability, 'durable')
  const unknown = buildAvailability({ durability: 'bogus', operations: {}, sources: {} })
  assert.equal(unknown.durability, 'unknown')
  assert.equal(unknown.status, 'unknown')
})

test('cloneBoundedPublic drops secrets and hostile getters and caps depth', () => {
  const hostile = {}
  Object.defineProperty(hostile, 'secret', {
    enumerable: true,
    get() { throw new Error('boom') },
  })
  assert.doesNotThrow(() => cloneBoundedPublic(hostile))
  const cloned = cloneBoundedPublic({ prompt: 'p', credential: 'c', safe: { authorization: 'a', value: 1 } })
  assert.equal(cloned.prompt, undefined)
  assert.equal(cloned.credential, undefined)
  assert.equal(cloned.safe.authorization, undefined)
  assert.equal(cloned.safe.value, 1)
  const circular = { a: 1 }
  circular.self = circular
  assert.doesNotThrow(() => cloneBoundedPublic(circular))
})

test('redactAttempt and redactTaskRecord keep bounded evidence and drop secrets', () => {
  const attempt = {
    attemptId: 'attempt-1',
    runId: 'run-1',
    ownerId: 'owner-1',
    generation: 'gen:1',
    fencingToken: 'tok-secret',
    state: 'active',
    links: {
      execution: { id: 'exec-1', generation: 'g1', certainty: 'observed' },
      session: { id: 'session-1', certainty: 'unavailable' },
    },
    startedAt: '2026-08-25T00:00:00.000Z',
    outcome: 'success',
    reason: 'done',
    provenance: [{ kind: 'run', id: 'run-1', certainty: 'observed' }],
  }
  const redactedAttempt = redactAttempt(attempt)
  assert.equal(redactedAttempt.attemptId, 'attempt-1')
  assert.equal(redactedAttempt.fencingToken, undefined)
  assert.equal(redactedAttempt.links.execution.id, 'exec-1')
  assert.equal(redactedAttempt.links.execution.certainty, 'observed')
  assert.equal(redactedAttempt.links.session.certainty, 'unavailable')
  assert.equal(redactedAttempt.outcome, 'success')
  assert.equal(Object.isFrozen(redactedAttempt), true)
  assert.equal(Object.isFrozen(redactedAttempt.links), true)

  const record = {
    taskId: 'task-1',
    ownerId: 'owner-1',
    scope: { kind: 'workspace', key: 'repo-a' },
    intent: { kind: 'review', summary: 'review PR' },
    state: 'active',
    revision: 2,
    activeAttemptId: 'attempt-1',
    attempts: [attempt],
    terminalOutcome: undefined,
    provenance: [{ kind: 'registration', id: 'task-1', certainty: 'observed' }],
    availability: { status: 'available' },
  }
  const redacted = redactTaskRecord(record, { audience: 'ui' })
  assert.equal(redacted.taskId, 'task-1')
  assert.equal(redacted.state, 'active')
  assert.equal(redacted.activeAttemptId, 'attempt-1')
  assert.equal(redacted.attempts.length, 1)
  assert.equal(redacted.attempts[0].fencingToken, undefined)
  assert.equal(redacted.provenance[0].id, 'task-1')
  assert.equal(redacted.audience, 'ui')
  assert.equal(Object.isFrozen(redacted), true)
})

test('normalize helpers never throw on hostile input', () => {
  const hostile = {}
  Object.defineProperty(hostile, 'kind', {
    enumerable: true,
    get() { throw new Error('boom') },
  })
  for (const fn of [
    () => normalizeScope(hostile),
    () => normalizeIntent(hostile),
    () => normalizeRunLinks(hostile),
    () => normalizeLeaseHandle(hostile),
    () => normalizeLink(hostile, 'x'),
    () => redactTaskRecord(hostile),
    () => redactAttempt(hostile),
    () => buildAvailability(hostile),
  ]) {
    assert.doesNotThrow(fn)
  }
})

test('provenance normalization is bounded and drops malformed entries', () => {
  const ok = normalizeProvenance([
    { kind: 'claim', id: 'gen:1', certainty: 'observed' },
    'junk',
    { kind: 'no-id' },
    { kind: 'reason', id: 'reassigned', certainty: 'stale' },
  ])
  assert.equal(ok.ok, true)
  assert.equal(ok.value.length, 2)
  assert.equal(ok.value[1].certainty, 'stale')
})