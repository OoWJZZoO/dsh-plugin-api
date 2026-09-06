/**
 * Focused tests for the shared loop boundary interaction slice
 * (admission/cancel boundary + attempt lifecycle facts).
 *
 * Contract anchors:
 * - `docs/specs/session-interaction-operation/requirements.md` Requirement 11
 * - `docs/specs/session-activity-projection/requirements.md` Requirement 9
 * - ability to pause/verify the payload fields frozen by both lines.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTIVITY_OBSERVATION_CONTRACT_SYMBOL,
  ADMIT_REJECT_REASONS,
  ATTEMPT_END_EVENT,
  ATTEMPT_FACTS_CONTRACT_VERSION,
  ATTEMPT_FOLLOW_UP,
  ATTEMPT_OUTCOMES,
  ATTEMPT_START_EVENT,
  ATTEMPT_SUPERSEDED_CAUSE,
  INTERACTION_ACTIVE_SYMBOL,
  buildAttemptEndPayload,
  buildAttemptStartPayload,
  createInteractionBoundary,
  interactionBoundaryOf,
  mapTurnEndOutcome,
  redactTurnEndReason,
} from '../lib/interaction-slice.js'

function makeAgent(sessionId, { hasPending = false, emit } = {}) {
  return {
    id: `agent-${sessionId}`,
    session: { id: sessionId },
    inbox: { hasPending },
    loopCtx: {
      emit: emit ?? (() => {}),
    },
    cancel(cause, options) {
      this.calls ??= []
      this.calls.push({ cause, options })
    },
  }
}

function collectEmit() {
  const emitted = []
  return { emitted, emit: (name, payload) => emitted.push({ name, payload }) }
}

test('attempt-fact vocabulary is closed and frozen', () => {
  assert.deepEqual(ATTEMPT_OUTCOMES, ['success', 'error', 'aborted', 'denied', 'superseded'])
  assert.deepEqual(ATTEMPT_FOLLOW_UP, ['none', 'queued'])
  assert.equal(ATTEMPT_FACTS_CONTRACT_VERSION, '1')
  assert.equal(ATTEMPT_START_EVENT, 'agent/attempt/start')
  assert.equal(ATTEMPT_END_EVENT, 'agent/attempt/end')
  assert.equal(typeof INTERACTION_ACTIVE_SYMBOL, 'symbol')
  assert.ok(ADMIT_REJECT_REASONS.includes('busy'))
})

test('attempt-start payload carries exactly the frozen contract fields', () => {
  const payload = buildAttemptStartPayload({
    attemptId: 'a1',
    operationId: 'op1',
    executionId: 'ex1',
    sessionId: 's1',
    seq: 3,
    observedAt: 't1',
  })
  assert.deepEqual(Object.keys(payload).sort(), ['attemptId', 'executionId', 'observedAt', 'operationId', 'seq', 'sessionId'])
  assert.equal(payload.attemptId, 'a1')
  assert.equal(payload.operationId, 'op1')
  assert.equal(payload.executionId, 'ex1')
  assert.equal(payload.sessionId, 's1')
  assert.equal(payload.seq, 3)
  assert.equal(payload.observedAt, 't1')
  assert.ok(Object.isFrozen(payload))
  // optional correlation fields default to null (shared vocabulary)
  const unowned = buildAttemptStartPayload({ attemptId: 'a2', sessionId: 's2', seq: 4, observedAt: 't2' })
  assert.equal(unowned.operationId, null)
  assert.equal(unowned.executionId, null)
})

test('attempt-end payload carries outcome/classification/followUp with bounded redacted reason', () => {
  const long = 'x'.repeat(400)
  const payload = buildAttemptEndPayload({
    attemptId: 'a1',
    operationId: 'op1',
    executionId: 'ex1',
    sessionId: 's1',
    seq: 3,
    observedAt: 't1',
    outcome: 'success',
    reason: long,
    classification: 'completed',
    followUp: 'queued',
  })
  assert.deepEqual(Object.keys(payload).sort(), [
    'attemptId', 'classification', 'executionId', 'followUp', 'observedAt', 'operationId', 'outcome', 'reason', 'seq', 'sessionId'])
  assert.ok(payload.reason.length <= 130, 'reason is bounded')
  assert.equal(payload.followUp, 'queued')
  assert.equal(payload.outcome, 'success')
  assert.equal(payload.classification, 'completed')
})

test('mapTurnEndOutcome covers every official turn-end reason', () => {
  assert.deepEqual(mapTurnEndOutcome({ kind: 'completed' }), { outcome: 'success', classification: 'completed' })
  assert.deepEqual(mapTurnEndOutcome({ kind: 'blocked' }), { outcome: 'denied', classification: 'blocked' })
  assert.deepEqual(mapTurnEndOutcome({ kind: 'error', error: { message: 'boom', code: 'X' } }), { outcome: 'error', classification: 'X' })
  assert.deepEqual(mapTurnEndOutcome({ kind: 'max-tokens' }), { outcome: 'error', classification: 'max-tokens' })
  assert.deepEqual(mapTurnEndOutcome({ kind: 'interrupted' }), { outcome: 'error', classification: 'interrupted' })
  assert.deepEqual(mapTurnEndOutcome({ kind: 'aborted', reason: { kind: 'user' } }), { outcome: 'aborted', classification: 'aborted' })
  // def guard for unexpected/null inputs
  assert.deepEqual(mapTurnEndOutcome(null), { outcome: 'error', classification: 'no-turn-end' })
})

test('superseded is only reported when the aborting cause carries the supersede marker', () => {
  const supersededCause = { kind: 'aborted', message: 'replaced' }
  supersededCause[ATTEMPT_SUPERSEDED_CAUSE] = true
  assert.deepEqual(mapTurnEndOutcome({ kind: 'aborted', reason: supersededCause }), { outcome: 'superseded', classification: 'superseded' })
  assert.deepEqual(mapTurnEndOutcome({ kind: 'aborted', reason: { kind: 'user' } }), { outcome: 'aborted', classification: 'aborted' })
})

test('reason redaction is bounded and strips non-text structures', () => {
  assert.equal(redactTurnEndReason({ kind: 'completed' }), undefined)
  assert.equal(redactTurnEndReason({ kind: 'blocked' }), undefined)
  assert.equal(redactTurnEndReason({ kind: 'error', error: { message: 'y'.repeat(500), code: 'X' } }), 'y'.repeat(120) + '...')
  assert.equal(redactTurnEndReason({ kind: 'aborted', reason: { message: 'stopped' } }), 'stopped')
  assert.equal(redactTurnEndReason({ kind: 'aborted', reason: undefined }), '')
})

test('admit accepts once and rejects duplicate idempotency key while pending', () => {
  const boundary = createInteractionBoundary({})
  const agent = makeAgent('s1')
  boundary.attachAgent(agent)
  const first = boundary.admit({ sessionId: 's1', operationId: 'op1', idempotencyKey: 'k1' })
  assert.equal(first.accepted, true)
  const dup = boundary.admit({ sessionId: 's1', operationId: 'op2', idempotencyKey: 'k1' })
  assert.equal(dup.accepted, false)
  assert.equal(dup.code, 'pending')
  const sameOp = boundary.admit({ sessionId: 's1', operationId: 'op1' })
  assert.equal(sameOp.accepted, false)
  assert.equal(sameOp.code, 'pending')
})

test('admit rejects when no agent slot exists or the session is busy', () => {
  const boundary = createInteractionBoundary({})
  assert.equal(boundary.admit({ sessionId: 's-missing', operationId: 'op1' }).code, 'no-agent')
  const agent = makeAgent('s1')
  boundary.attachAgent(agent)
  boundary.admit({ sessionId: 's1', operationId: 'op1' })
  boundary.beginAttempt(agent, { turn: 1, observedAt: 't1' })
  const busy = boundary.admit({ sessionId: 's1', operationId: 'op2' })
  assert.equal(busy.accepted, false)
  assert.equal(busy.code, 'busy')
  assert.equal(boundary.admit({ sessionId: 's1', operationId: 1 }).code, 'invalid-input')
})

test('beginAttempt attributes the FIFO pending admission and emits a frozen start fact', () => {
  const { emitted, emit } = collectEmit()
  const boundary = createInteractionBoundary({})
  const agent = makeAgent('s1', { emit })
  boundary.attachAgent(agent)
  boundary.admit({ sessionId: 's1', operationId: 'op1', executionId: 'ex1' })
  const started = boundary.beginAttempt(agent, { turn: 2, observedAt: 't1' })
  assert.equal(started.operationId, 'op1')
  assert.equal(started.executionId, 'ex1')
  assert.ok(typeof started.attemptId === 'string')
  const [fact] = emitted
  assert.equal(fact.name, ATTEMPT_START_EVENT)
  assert.equal(fact.payload.sessionId, 's1')
  assert.equal(fact.payload.operationId, 'op1')
  assert.equal(fact.payload.seq, 2)
  assert.ok(Object.isFrozen(fact.payload))
})

test('endAttempt emits a frozen end fact with loop-side outcome and followUp', () => {
  const { emitted, emit } = collectEmit()
  const boundary = createInteractionBoundary({})
  const agent = makeAgent('s1', { hasPending: true, emit })
  boundary.attachAgent(agent)
  boundary.admit({ sessionId: 's1', operationId: 'op1' })
  boundary.beginAttempt(agent, { turn: 2, observedAt: 't1' })
  const ended = boundary.endAttempt(agent, { turnEnds: { kind: 'completed' }, turn: 2, observedAt: 't2' })
  assert.equal(ended.outcome, 'success')
  assert.equal(ended.followUp, 'queued')
  const [, fact] = emitted
  assert.equal(fact.name, ATTEMPT_END_EVENT)
  assert.equal(fact.payload.outcome, 'success')
  assert.equal(fact.payload.followUp, 'queued')
  assert.equal(fact.payload.seq, 2)
  assert.ok(Object.isFrozen(fact.payload))
})

test('queued follow-up turn inherits the previous attempt attribution', () => {
  const boundary = createInteractionBoundary({})
  const agent = makeAgent('s1', { hasPending: true })
  boundary.attachAgent(agent)
  boundary.admit({ sessionId: 's1', operationId: 'op1' })
  boundary.beginAttempt(agent, { turn: 1, observedAt: 't1' })
  boundary.endAttempt(agent, { turnEnds: { kind: 'completed' }, turn: 1, observedAt: 't2' })
  // next turn: no pending admission, but lastFollowUp queued -> inheritance
  agent.inbox.hasPending = false
  const next = boundary.beginAttempt(agent, { turn: 2, observedAt: 't3' })
  assert.equal(next.operationId, 'op1')
  boundary.endAttempt(agent, { turnEnds: { kind: 'completed' }, turn: 2, observedAt: 't4' })
  assert.equal(boundary.availability().status, 'active')
})

test('cancelAttempt removes a pending admission before attempt start', () => {
  const boundary = createInteractionBoundary({})
  const agent = makeAgent('s1')
  boundary.attachAgent(agent)
  const { attemptRef } = boundary.admit({ sessionId: 's1', operationId: 'op1' })
  const result = boundary.cancelAttempt(attemptRef, { reason: { message: 'user cancelled' } })
  assert.deepEqual(result, { ok: true, code: 'accepted' })
  const started = boundary.beginAttempt(agent, { turn: 1, observedAt: 't1' })
  assert.equal(started.operationId, null, 'pending admission was removed; attempt is unowned')
})

test('cancelAttempt propagates best-effort to the live attempt without writing a terminal', () => {
  const boundary = createInteractionBoundary({})
  const agent = makeAgent('s1')
  let cancelled = 0
  agent.cancel = (cause, options) => {
    cancelled += 1
    agent.lastCause = cause
    agent.lastOptions = options
  }
  boundary.attachAgent(agent)
  const { attemptRef } = boundary.admit({ sessionId: 's1', operationId: 'op1' })
  boundary.beginAttempt(agent, { turn: 1, observedAt: 't1' })
  const result = boundary.cancelAttempt(attemptRef, { reason: { message: 'stop' } })
  assert.equal(result.ok, true)
  assert.equal(cancelled, 1)
  assert.equal(agent.lastOptions.keepInbox, true)
  assert.equal(agent.lastCause.kind, 'aborted')
  // supersede cancel carries the marker so the end fact maps to superseded
  boundary.cancelAttempt(attemptRef, { reason: { message: 'replaced', superseded: true } })
  assert.equal(agent.lastCause[ATTEMPT_SUPERSEDED_CAUSE], true)
})

test('supersede marker carried through cancelAttempt produces a superseded attempt-end fact', () => {
  const boundary = createInteractionBoundary({})
  const agent = makeAgent('s1')
  boundary.attachAgent(agent)
  const { attemptRef } = boundary.admit({ sessionId: 's1', operationId: 'op1' })
  boundary.beginAttempt(agent, { turn: 1, observedAt: 't1' })
  // a superseding consumer (e.g. stop-then-restore calling the shared boundary
  // with the marker) requests the replacement
  boundary.cancelAttempt(attemptRef, { reason: { message: 'replaced by restore', superseded: true } })
  const caused = agent.calls.at(-1)?.cause
  const ended = boundary.endAttempt(agent, { turnEnds: { kind: 'aborted', reason: caused }, turn: 1, observedAt: 't2' })
  assert.equal(ended.outcome, 'superseded')
  assert.equal(ended.followUp, 'none')
})

test('stale and invalid cancel attempts return typed results', () => {
  const boundary = createInteractionBoundary({})
  assert.deepEqual(boundary.cancelAttempt({ sessionId: 's-x', operationId: 'op1' }), { ok: false, code: 'stale' })
  assert.deepEqual(boundary.cancelAttempt(null, {}), { ok: false, code: 'invalid-input' })
})

test('fact emission failure is contained and never affects the loop', () => {
  const boundary = createInteractionBoundary({})
  const agent = makeAgent('s1', {
    emit() {
      throw new Error('emitter exploded')
    },
  })
  boundary.attachAgent(agent)
  boundary.admit({ sessionId: 's1', operationId: 'op1' })
  assert.doesNotThrow(() => boundary.beginAttempt(agent, { turn: 1, observedAt: 't1' }))
  assert.doesNotThrow(() => boundary.endAttempt(agent, { turnEnds: { kind: 'completed' }, turn: 1, observedAt: 't2' }))
})

test('availability and dispose lifecycle', () => {
  const boundary = createInteractionBoundary({})
  assert.equal(boundary.availability().status, 'active')
  assert.equal(boundary.availability().contractVersion, ATTEMPT_FACTS_CONTRACT_VERSION)
  boundary.dispose()
  assert.equal(boundary.availability().status, 'unavailable')
  assert.equal(boundary.admit({ sessionId: 's1', operationId: 'op1' }).code, 'unavailable')
})

test('interactionBoundaryOf resolves only well-shaped boundaries from a marked service', () => {
  const agent = makeAgent('s1')
  const service = { [INTERACTION_ACTIVE_SYMBOL]: createInteractionBoundary({}) }
  assert.ok(interactionBoundaryOf(service))
  assert.equal(interactionBoundaryOf({}), null)
  assert.equal(interactionBoundaryOf({ [INTERACTION_ACTIVE_SYMBOL]: { admit: () => {} } }), null)
})

test('activity observation contract symbol is exported for the apply probe (shared vocabulary)', () => {
  assert.equal(typeof ACTIVITY_OBSERVATION_CONTRACT_SYMBOL, 'symbol')
})