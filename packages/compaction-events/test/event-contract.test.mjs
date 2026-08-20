import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRedactedFailure,
  COMPACTION_TRIGGER_VALUES,
  COMPACTION_TRIGGERS,
  decideCompactionRequest,
  DECISION,
  freezeCompactionPayload,
  isCompactionTrigger,
} from '../lib/event-contract.js'

test('compaction triggers expose the canonical four values', () => {
  assert.deepEqual(COMPACTION_TRIGGER_VALUES, ['pressure', 'context-overflow', 'manual', 'direct'])
  assert.equal(COMPACTION_TRIGGERS.pressure, 'pressure')
  assert.equal(COMPACTION_TRIGGERS['context-overflow'], 'context-overflow')
  assert.equal(COMPACTION_TRIGGERS.manual, 'manual')
  assert.equal(COMPACTION_TRIGGERS.direct, 'direct')
  assert.ok(isCompactionTrigger('pressure'))
  assert.ok(isCompactionTrigger('context-overflow'))
  assert.ok(isCompactionTrigger('manual'))
  assert.ok(isCompactionTrigger('direct'))
  assert.ok(!isCompactionTrigger('other'))
  assert.ok(!isCompactionTrigger(undefined))
  assert.ok(!isCompactionTrigger(null))
})

test('decideCompactionRequest treats no-decision (undefined) as proceed', () => {
  assert.deepEqual(decideCompactionRequest(undefined), { kind: DECISION.proceed })
})

test('decideCompactionRequest accepts reject with and without reason', () => {
  assert.deepEqual(decideCompactionRequest({ kind: 'reject', reason: 'stale indexes' }), {
    kind: DECISION.reject,
    reason: 'stale indexes',
  })
  assert.deepEqual(decideCompactionRequest({ kind: 'reject' }), { kind: DECISION.reject })
})

test('decideCompactionRequest rejects malformed reject decisions', () => {
  assert.deepEqual(decideCompactionRequest({ kind: 'reject', reason: 42 }), { kind: DECISION.malformed })
  assert.deepEqual(decideCompactionRequest('reject'), { kind: DECISION.malformed })
})

test('decideCompactionRequest accepts valid replace-range decisions', () => {
  assert.deepEqual(decideCompactionRequest({ kind: 'replace-range', start: 10, end: 20 }), {
    kind: DECISION.replaceRange,
    start: 10,
    end: 20,
  })
})

test('decideCompactionRequest rejects malformed replace-range boundaries', () => {
  assert.deepEqual(decideCompactionRequest({ kind: 'replace-range', start: 10.5, end: 20 }), { kind: DECISION.malformed })
  assert.deepEqual(decideCompactionRequest({ kind: 'replace-range', start: 30, end: 20 }), { kind: DECISION.malformed })
  assert.deepEqual(decideCompactionRequest({ kind: 'replace-range', start: '10', end: 20 }), { kind: DECISION.malformed })
  assert.deepEqual(decideCompactionRequest({ kind: 'replace-range', start: 10 }), { kind: DECISION.malformed })
})

test('decideCompactionRequest treats any other shape as malformed', () => {
  assert.deepEqual(decideCompactionRequest({ kind: 'veto' }), { kind: DECISION.malformed })
  assert.deepEqual(decideCompactionRequest({}), { kind: DECISION.malformed })
  assert.deepEqual(decideCompactionRequest(null), { kind: DECISION.malformed })
  assert.deepEqual(decideCompactionRequest(['replace-range']), { kind: DECISION.malformed })
})

test('freezeCompactionPayload freezes the snapshot and deep-freezes static keys only', () => {
  const agent = { id: 'agent-1' }
  const session = { id: 'session-1' }
  const payload = {
    agent,
    session,
    trigger: 'pressure',
    range: { start: 1, end: 5 },
    sourceCommandId: 'cmd-9',
  }
  const frozen = freezeCompactionPayload(payload, ['range'])

  assert.ok(Object.isFrozen(frozen))
  assert.ok(Object.isFrozen(frozen.range))
  assert.equal(frozen.range.start, 1)
  assert.equal(frozen.range.end, 5)
  // live references stay unfrozen and identical
  assert.equal(Object.isFrozen(frozen.agent), false)
  assert.equal(Object.isFrozen(frozen.session), false)
  assert.equal(frozen.agent, agent)
  assert.equal(frozen.session, session)

  // a listener cannot mutate the static payload through the snapshot
  assert.throws(() => { frozen.range.start = 999 }, TypeError)
  assert.throws(() => { frozen.sourceCommandId = 'mutated' }, TypeError)
})

test('freezeCompactionPayload deep-freezes nested result arrays and ignores live keys', () => {
  const agent = { id: 'agent-2' }
  const session = { id: 'session-2' }
  const payload = {
    agent,
    session,
    trigger: 'manual',
    range: { start: 0, end: 2 },
    result: {
      compactionId: 'id-1',
      shadowedRange: { start: 0, end: 2 },
      shadowedSeqs: [0, 1, 2],
      startSeq: 3,
      summarySeq: 4,
      endSeq: 5,
      sourceCommandId: 'cmd-1',
    },
  }
  const frozen = freezeCompactionPayload(payload, ['range', 'result'])
  assert.ok(Object.isFrozen(frozen.result.shadowedRange))
  assert.ok(Object.isFrozen(frozen.result.shadowedSeqs))
  assert.ok(Object.isFrozen(frozen.result))
  assert.equal(Object.isFrozen(frozen.agent), false)
})

test('freezeCompactionPayload rejects non-plain payloads', () => {
  assert.throws(() => freezeCompactionPayload(null), TypeError)
  assert.throws(() => freezeCompactionPayload([]), TypeError)
  assert.throws(() => freezeCompactionPayload('x'), TypeError)
})

test('buildRedactedFailure produces name/code without message or stack', () => {
  const error = new Error('secret summary detail')
  error.code = 'LLM_FAILED'
  const failure = buildRedactedFailure({ stage: 'summary', error })
  assert.deepEqual(failure, { stage: 'summary', name: 'Error', code: 'LLM_FAILED' })
  assert.ok(Object.isFrozen(failure))
  assert.ok(!('message' in failure))
  assert.ok(!('stack' in failure))
})

test('buildRedactedFailure treats missing code as absent and validates stage', () => {
  const failure = buildRedactedFailure({ stage: 'commit', error: new TypeError('hidden') })
  assert.deepEqual(failure, { stage: 'commit', name: 'TypeError' })
  assert.throws(() => buildRedactedFailure({ stage: 'other', error: new Error('x') }), TypeError)
})
