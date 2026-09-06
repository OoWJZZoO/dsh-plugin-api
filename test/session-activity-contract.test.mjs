import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTIVITY_OBSERVATION_CONTRACT,
  ACTIVITY_OBSERVATION_CONTRACT_VERSION,
  activityObservationContract,
  EVIDENCE_LEVELS,
  TERMINAL_OUTCOMES,
  FOLLOW_UP_VALUES,
  STATUS_PHASES,
  WAITING_KINDS,
  ADJUDICATION_PRIORITY,
  ATTEMPT_START_FIELDS,
  ATTEMPT_END_FIELDS,
} from '../lib/session-activity-contract.js'

test('contract: the global marker slot starts empty and is not pre-claimed', () => {
  const contract = globalThis[String(ACTIVITY_OBSERVATION_CONTRACT)]
  assert.equal(contract, undefined)
})

test('contract: activityObservationContract() is frozen and versioned', () => {
  const contract = activityObservationContract()
  assert.equal(contract.version, ACTIVITY_OBSERVATION_CONTRACT_VERSION)
  assert.equal(contract.version, 1)
  assert.equal(Object.isFrozen(contract), true)
  assert.deepEqual(contract.events, ['agent/attempt/start', 'agent/attempt/end'])
  assert.deepEqual(contract.outcomes, TERMINAL_OUTCOMES)
  assert.deepEqual(contract.followUp, FOLLOW_UP_VALUES)
  assert.throws(() => {
    contract.version = 99
  }, TypeError)
})

test('contract: frozen payload field lists match the approved attempt-facts contract', () => {
  assert.deepEqual(ATTEMPT_START_FIELDS, [
    'attemptId', 'operationId', 'executionId', 'sessionId', 'seq', 'observedAt',
  ])
  assert.deepEqual(ATTEMPT_END_FIELDS, [
    'attemptId', 'operationId', 'executionId', 'sessionId',
    'outcome', 'reason', 'classification', 'followUp', 'seq', 'observedAt',
  ])
})

test('contract: closed vocabularies are frozen and non-collapsing', () => {
  assert.deepEqual(EVIDENCE_LEVELS, ['observed', 'reconstructed', 'unknown', 'unavailable'])
  assert.deepEqual(TERMINAL_OUTCOMES, ['success', 'error', 'aborted', 'denied', 'superseded'])
  assert.deepEqual(FOLLOW_UP_VALUES, ['none', 'queued'])
  assert.deepEqual(STATUS_PHASES, ['preparing', 'running', 'waiting', 'interrupted'])
  assert.deepEqual(WAITING_KINDS, ['approval', 'question', 'user-message', 'tool', 'queued'])
  assert.deepEqual(ADJUDICATION_PRIORITY, ['aborted', 'superseded', 'error', 'timeout-error'])
  for (const list of [EVIDENCE_LEVELS, TERMINAL_OUTCOMES, FOLLOW_UP_VALUES, STATUS_PHASES, WAITING_KINDS, ADJUDICATION_PRIORITY]) {
    assert.equal(Object.isFrozen(list), true)
  }
})

test('contract: attempt start validator accepts a valid payload and rejects malformed ones', () => {
  const contract = activityObservationContract()
  const valid = {
    attemptId: 'att-1',
    operationId: 'op-1',
    executionId: 'exec-1',
    sessionId: 's1',
    seq: 0,
    observedAt: '2026-09-06T00:00:00.000Z',
  }
  assert.equal(contract.attemptStart.validate(valid), true)
  assert.equal(contract.attemptStart.validate({ ...valid, attemptId: undefined }), false)
  assert.equal(contract.attemptStart.validate({ ...valid, sessionId: '' }), false)
  assert.equal(contract.attemptStart.validate({ ...valid, seq: 'nope' }), false)
  assert.equal(contract.attemptStart.validate({ ...valid, executionId: 7 }), false)
  assert.equal(contract.attemptStart.validate(null), false)
})

test('contract: attempt end validator enforces the five-terminal vocabulary and followUp', () => {
  const contract = activityObservationContract()
  const base = {
    attemptId: 'att-1',
    sessionId: 's1',
    outcome: 'success',
    followUp: 'none',
    seq: 1,
    observedAt: '2026-09-06T00:00:00.000Z',
  }
  assert.equal(contract.attemptEnd.validate(base), true)
  assert.equal(contract.attemptEnd.validate({ ...base, outcome: 'settled' }), false)
  assert.equal(contract.attemptEnd.validate({ ...base, outcome: 'denied', followUp: 'queued' }), true)
  assert.equal(contract.attemptEnd.validate({ ...base, followUp: 'maybe' }), false)
  assert.equal(contract.attemptEnd.validate({ ...base, outcome: 42 }), false)
  assert.equal(contract.attemptEnd.validate({ ...base, followUp: undefined }), false)
  assert.equal(contract.attemptEnd.validate('nope'), false)
})

test('contract: field lists and validators agree on the approved payload contract', () => {
  const contract = activityObservationContract()
  for (const field of ATTEMPT_START_FIELDS) {
    assert.notEqual(contract.attemptStart.fields.indexOf(field), -1)
  }
  for (const field of ATTEMPT_END_FIELDS) {
    assert.notEqual(contract.attemptEnd.fields.indexOf(field), -1)
  }
})