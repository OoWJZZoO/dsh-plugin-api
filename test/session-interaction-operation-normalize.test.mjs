/**
 * Pure-vocabulary tests for the session request operation facade.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  adjudicateTerminal,
  boundedText,
  buildAcceptedOutcome,
  buildAlreadyRunningOutcome,
  buildDeniedOutcome,
  buildDuplicateOutcome,
  buildOperationStatus,
  buildRejectedOutcome,
  buildUnavailableOutcome,
  CANCEL_BY_VALUES,
  mapSliceAdmissionRejection,
  mintId,
  REQUEST_MESSAGE_KINDS,
  TERMINAL_OUTCOMES,
  validateCancelInput,
  validateRequestSpec,
} from '../lib/session-interaction-operation-normalize.js'

test('terminal and message-kind vocabularies are closed and frozen', () => {
  assert.deepEqual(TERMINAL_OUTCOMES, ['success', 'error', 'aborted', 'denied', 'superseded'])
  assert.deepEqual(REQUEST_MESSAGE_KINDS, ['user-message'])
  assert.deepEqual(CANCEL_BY_VALUES, ['user', 'owner', 'system'])
})

test('request spec validation accepts the frozen contract fields', () => {
  const ok = validateRequestSpec({
    sessionId: 's1',
    message: { kind: 'user-message', text: 'hello', attachmentRefs: ['a1'] },
    idempotencyKey: 'k1',
    parent: 'p1',
    cause: 'retry',
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.sessionId, 's1')
  assert.equal(ok.value.message.kind, 'user-message')
  assert.ok(Object.isFrozen(ok.value.message))
  assert.deepEqual(ok.value.message.attachmentRefs, ['a1'])
})

test('request spec validation rejects malformed or unsupported input as invalid-input', () => {
  assert.equal(validateRequestSpec(null).ok, false)
  assert.equal(validateRequestSpec({}).code, 'invalid-input')
  assert.equal(validateRequestSpec({ sessionId: 's1' }).ok, true)
  assert.equal(validateRequestSpec({ sessionId: 's1', message: { kind: 'assistant/message', text: 'x' } }).code, 'invalid-input')
  assert.equal(validateRequestSpec({ sessionId: 's1', message: { kind: 'user-message' } }).code, 'invalid-input')
  assert.equal(validateRequestSpec({ sessionId: 's1', message: { kind: 'user-message', text: '' } }).code, 'invalid-input')
  assert.equal(validateRequestSpec({ sessionId: 's1', message: { kind: 'user-message', text: 'x', attachmentRefs: [1] } }).code, 'invalid-input')
  assert.equal(validateRequestSpec({ sessionId: 's1', idempotencyKey: '' }).code, 'invalid-input')
  assert.equal(validateRequestSpec({ sessionId: 's1', parent: 7 }).code, 'invalid-input')
  assert.equal(validateRequestSpec({ sessionId: 's1', signal: {} }).code, 'invalid-input')
})

test('cancel input validation accepts sessionId/operationId/reason/by with by vocabulary', () => {
  const ok = validateCancelInput({ operationId: 'op1', by: 'system', reason: 'stop-then-restore' })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.by, 'system')
  assert.equal(validateCancelInput({ sessionId: 's1' }).ok, true)
  assert.equal(validateCancelInput({}).ok, false)
  assert.equal(validateCancelInput({ operationId: '', sessionId: 's1' }).ok, false)
  assert.equal(validateCancelInput({ sessionId: 's1', by: 'robot' }).ok, false)
})

test('reason bounded text', () => {
  assert.equal(boundedText('ok'), 'ok')
  assert.equal(boundedText('x'.repeat(500)).length, 163)
})

test('adjudicateTerminal applies the frozen priority', () => {
  assert.deepEqual(adjudicateTerminal({ cancelRequested: true }), { outcome: 'aborted', classification: 'aborted' })
  assert.deepEqual(adjudicateTerminal({ cancelRequested: true, superseded: true }), { outcome: 'superseded', classification: 'superseded' })
  assert.deepEqual(adjudicateTerminal({ fact: { outcome: 'success', classification: 'completed' } }), { outcome: 'success', classification: 'completed' })
  assert.deepEqual(adjudicateTerminal({ timeoutRequested: true }), { outcome: 'error', classification: 'timeout' })
  assert.equal(adjudicateTerminal({}), null)
  // cancel (higher priority) overrides a loop-side error fact in the commit window
  assert.deepEqual(adjudicateTerminal({ cancelRequested: true, fact: { outcome: 'error', classification: 'X' } }), { outcome: 'aborted', classification: 'aborted' })
})

test('outcome builders produce discriminated frozen results', () => {
  const handle = Object.freeze({ id: 'op1', ownerId: 'o1' })
  const accepted = buildAcceptedOutcome({ operation: handle, activity: { activityId: null, executionId: 'ex1', confidence: 'unknown' } })
  assert.equal(accepted.ok, true)
  assert.equal(accepted.code, 'accepted')
  assert.ok(Object.isFrozen(accepted))
  assert.equal(buildDuplicateOutcome({ id: 'op1' }).code, 'duplicate')
  assert.equal(buildAlreadyRunningOutcome({ id: 'op1' }).code, 'already-running')
  const rej = buildRejectedOutcome({ reason: 'bad input', domainCode: 'invalid-input' })
  assert.equal(rej.ok, false)
  assert.equal(rej.domainCode, 'invalid-input')
  assert.equal(buildDeniedOutcome({ reason: 'gate', domainCode: 'model-route' }).code, 'denied')
  assert.equal(buildUnavailableOutcome('no boundary').code, 'unavailable')
})

test('slice admission rejection maps onto facade outcome codes', () => {
  assert.equal(mapSliceAdmissionRejection('busy').domainCode, 'loop-busy')
  assert.equal(mapSliceAdmissionRejection('no-agent').domainCode, 'no-agent')
  assert.equal(mapSliceAdmissionRejection('invalid-input').domainCode, 'invalid-input')
  assert.equal(mapSliceAdmissionRejection('exploded').code, 'unavailable')
})

test('operation status shape and identity minting', () => {
  const status = buildOperationStatus({ phase: 'accepted', terminal: null, attempt: null, activity: { activityId: null, executionId: 'ex1', confidence: 'unknown' }, observedAt: 't' })
  assert.equal(status.phase, 'accepted')
  assert.ok(Object.isFrozen(status))
  const a = mintId('op')
  const b = mintId('op')
  assert.ok(a.startsWith('op_') && a !== b)
})