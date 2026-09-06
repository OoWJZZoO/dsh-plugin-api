import test from 'node:test'
import assert from 'node:assert/strict'
import { createActivityStore } from '../lib/session-activity-store.js'

function makeStore() {
  return createActivityStore({ now: () => '2026-09-06T00:00:00.000Z' })
}

function attemptStart(store, sessionId, { executionId, attemptId, seq = 0 } = {}) {
  return store.ingest({
    source: 'attempt',
    sessionId,
    kind: 'start',
    executionId,
    attemptId,
    seq,
    observedAt: '2026-09-06T00:00:00.000Z',
  })
}

function attemptEnd(store, sessionId, { executionId, attemptId, outcome = 'success', followUp = 'none', seq = 1 } = {}) {
  return store.ingest({
    source: 'attempt',
    sessionId,
    kind: 'terminal',
    executionId,
    attemptId,
    outcome,
    followUp,
    seq,
    observedAt: '2026-09-06T00:00:00.000Z',
  })
}

function turnStart(store, sessionId, turn, seq = 0) {
  return store.ingest({
    source: 'durable',
    sessionId,
    kind: 'start',
    turn,
    seq,
    observedAt: '2026-09-06T00:00:00.000Z',
  })
}

function turnEnd(store, sessionId, seq = 1) {
  return store.ingest({
    source: 'durable',
    sessionId,
    kind: 'turn-end',
    seq,
    observedAt: '2026-09-06T00:00:00.000Z',
  })
}

test('store: identity is deterministic within the facade lifetime', () => {
  const store = makeStore()
  const first = attemptStart(store, 's1', { executionId: 'e1', attemptId: 'a1' })
  const second = attemptStart(store, 's1', { executionId: 'e1', attemptId: 'a1' })
  assert.equal(typeof first.activityId, 'string')
  assert.match(first.activityId, /^[0-9a-f]{16}$/)
  assert.equal(first.activityId, second.activityId)
  // internal attempt escalation (no end between) is the same execution and the
  // same activity: a new attempt, never a new activity identity
  const escalated = attemptStart(store, 's1', { executionId: 'e1', attemptId: 'a2', seq: 2 })
  assert.equal(escalated.activityId, first.activityId)
  attemptEnd(store, 's1', { executionId: 'e1', attemptId: 'a2', outcome: 'success', seq: 3 })
  const record = store.get(first.activityId)
  assert.equal(record.correlation.attemptId, 'a2')
  assert.equal(record.terminal.outcome, 'success')
})

test('store: a subsequent start of the same execution after a committed terminal is a fresh activity record', () => {
  const store = makeStore()
  const a = attemptStart(store, 's1', { executionId: 'e1', attemptId: 'a1' })
  attemptEnd(store, 's1', { executionId: 'e1', attemptId: 'a1', outcome: 'success', seq: 1 })
  const b = attemptStart(store, 's1', { executionId: 'e1', attemptId: 'a1', seq: 2 })
  assert.notEqual(a.activityId, b.activityId)
  assert.equal(store.get(a.activityId).terminal.outcome, 'success')
  assert.equal(store.sessionHistory('s1').length, 2)
})

test('store: a new execution is a new activity record', () => {
  const store = makeStore()
  const a = attemptStart(store, 's1', { executionId: 'e1', attemptId: 'a1' })
  attemptEnd(store, 's1', { executionId: 'e1', attemptId: 'a1', outcome: 'success' })
  const b = attemptStart(store, 's1', { executionId: 'e2', attemptId: 'a1' })
  assert.notEqual(a.activityId, b.activityId)
})

test('store: records are session-scoped', () => {
  const store = makeStore()
  const a = attemptStart(store, 's1', { executionId: 'e1', attemptId: 'a1' })
  attemptStart(store, 's2', { executionId: 'e2', attemptId: 'a1' })
  const history = store.sessionHistory('s1')
  assert.equal(history.length, 1)
  assert.equal(history[0].sessionId, 's1')
  assert.equal(history[0].activityId, a.activityId)
  assert.ok(!store.sessionHistory('s2').some((r) => r.activityId === a.activityId))
})

test('store: terminal is final, unique and never rewritten', () => {
  const store = makeStore()
  const start = attemptStart(store, 's1', { executionId: 'e1', attemptId: 'a1' })
  const end = attemptEnd(store, 's1', { executionId: 'e1', attemptId: 'a1', outcome: 'aborted' })
  assert.equal(end.changed, true)
  // late signals are audit facts only
  const late = attemptEnd(store, 's1', { executionId: 'e1', attemptId: 'a1', outcome: 'success', seq: 3 })
  const record = store.get(start.activityId)
  assert.equal(late.changed, false)
  assert.equal(record.terminal.outcome, 'aborted')
  assert.equal(store.current('s1'), undefined)
})

test('store: supersede-by-boundary fires on a new turn whose previous turn never ended', () => {
  const store = makeStore()
  const t1 = turnStart(store, 's1', 1)
  const supersede = turnStart(store, 's1', 2, 5)
  const old = store.get(t1.activityId)
  const next = store.current('s1')
  assert.equal(old.terminal.outcome, 'superseded')
  assert.equal(old.terminal.confidence, 'reconstructed')
  assert.equal(old.terminal.ruleName, 'superseded-by-boundary')
  assert.notEqual(next.activityId, t1.activityId)
  // the boundary commit happened exactly once
  assert.equal(supersede.changed, true)
  turnStart(store, 's1', 3, 9)
  const oldAgain = store.get(t1.activityId)
  assert.equal(oldAgain.terminal.outcome, 'superseded')
})

test('store: contiguous turns after turn-end reuse the same open record', () => {
  const store = makeStore()
  const t1 = turnStart(store, 's1', 1)
  turnEnd(store, 's1', 2)
  const t2 = turnStart(store, 's1', 2, 3)
  assert.equal(t2.activityId, t1.activityId)
  const record = store.get(t1.activityId)
  assert.equal(record.lastTurn, 2)
  assert.equal(record.terminal, null)
})

test('store: slice start upgrades a turn-boundary record to execution fidelity', () => {
  const store = makeStore()
  const t1 = turnStart(store, 's1', 1)
  const slice = attemptStart(store, 's1', { executionId: 'e1', attemptId: 'a1', seq: 4 })
  assert.equal(slice.activityId, t1.activityId)
  const record = store.get(t1.activityId)
  assert.equal(record.kind, 'execution')
  assert.equal(record.fidelity.sliceObserved, true)
  assert.equal(record.correlation.executionId, 'e1')
  assert.equal(record.correlation.confidence, 'observed')
  // execution-tracked records never take boundary supersede
  turnStart(store, 's1', 2, 5)
  const after = store.get(t1.activityId)
  assert.equal(after.terminal, null)
  assert.equal(after.lastTurn, 2)
})

test('store: followUp queued sets a session queue marker distinct from waiting', () => {
  const store = makeStore()
  attemptStart(store, 's1', { executionId: 'e1', attemptId: 'a1' })
  attemptEnd(store, 's1', { executionId: 'e1', attemptId: 'a1', outcome: 'success', followUp: 'queued' })
  const record = store.sessionHistory('s1')[0]
  const marker = store.sessionQueue('s1')
  assert.equal(marker.kind, 'queued')
  assert.equal(marker.fromActivityId, record.activityId)
  assert.equal(marker.observedAt, '2026-09-06T00:00:00.000Z')
  assert.equal(marker.confidence, 'observed')
  assert.equal(record.terminal.outcome, 'success')
  assert.equal(record.terminal.followUp, 'queued')
  assert.equal(record.status, null)
  // a new start clears the marker (work resumed)
  attemptStart(store, 's1', { executionId: 'e2', attemptId: 'a2', seq: 2 })
  assert.equal(store.sessionQueue('s1'), null)
})

test('store: waiting approval and tool markers are per-evidence and confident', () => {
  const store = makeStore()
  const start = attemptStart(store, 's1', { executionId: 'e1', attemptId: 'a1' })
  store.ingest({ source: 'durable', sessionId: 's1', kind: 'phase', phase: 'waiting', waiting: 'approval', approvalOpen: true, seq: 1 })
  const record = store.get(start.activityId)
  assert.equal(record.status.phase, 'waiting')
  assert.equal(record.status.waiting.kind, 'approval')
  assert.equal(record.status.waiting.confidence, 'observed')
  // the waiting closed on official durable evidence (observed grade)
  store.ingest({ source: 'durable', sessionId: 's1', kind: 'phase', phase: 'running', waiting: null, approvalOpen: false, seq: 2 })
  const cleared = store.get(start.activityId)
  assert.equal(cleared.status.waiting, undefined)
  assert.equal(cleared.status.phase, 'running')
  assert.equal(cleared.status.confidence, 'observed')
})

test('store: ambiguous evidence keeps distinct records without heuristic merge', () => {
  const store = makeStore()
  const a = attemptStart(store, 's1', { executionId: 'e1', attemptId: 'a1' })
  const b = attemptStart(store, 's1', { executionId: 'e2', attemptId: 'a2', seq: 2 })
  assert.notEqual(a.activityId, b.activityId)
  assert.equal(store.sessionHistory('s1').length, 2)
})

test('store: correlation is updated only from new evidence and frozen with its confidence', () => {
  const store = makeStore()
  const start = attemptStart(store, 's1', { executionId: 'e1', attemptId: 'a1' })
  store.ingest({
    source: 'durable', sessionId: 's1', kind: 'correlation',
    executionId: 'e1', attemptId: 'a1', parentExecutionId: 'p1', confidence: 'observed',
  })
  const record = store.get(start.activityId)
  assert.equal(record.correlation.executionId, 'e1')
  assert.equal(record.correlation.attemptId, 'a1')
  assert.equal(record.correlation.parentExecutionId, 'p1')
  assert.equal(record.correlation.confidence, 'observed')
})

test('store: gap facts are recorded per session', () => {
  const store = makeStore()
  store.ingest({ kind: 'gap', source: 'durable', sessionId: 's1', fromSeq: 3, toSeq: 7 })
  assert.deepEqual(store.sessionGap('s1'), {
    fromSeq: 3, toSeq: 7, source: 'durable', observedAt: '2026-09-06T00:00:00.000Z',
  })
  assert.equal(store.sessionGap('s2'), null)
})

test('store: lifecycle words are never status values', () => {
  const store = makeStore()
  const start = attemptStart(store, 's1', { executionId: 'e1', attemptId: 'a1' })
  const record = store.get(start.activityId)
  assert.equal(record.status.phase, 'running')
  assert.ok(!['settled', 'committed', 'closed', 'disposed'].includes(record.status.phase))
})

test('store: invalid facts are ignored without corrupting state', () => {
  const store = makeStore()
  assert.equal(store.ingest(null), null)
  assert.equal(store.ingest({}), null)
  assert.equal(store.ingest({ sessionId: '', kind: 'start', source: 'attempt' }), null)
  assert.equal(store.ingest({ sessionId: 's1', kind: 'mystery', source: 'attempt' }), null)
  assert.equal(store.size, 0)
})

test('store: identity determinism holds within one lifetime; cross-lifetime continuity is not promised', () => {
  // Within one facade lifetime the same evidence always yields the same record.
  const storeA = makeStore()
  const a1 = attemptStart(storeA, 's1', { executionId: 'e1', attemptId: 'a1' })
  const a2 = attemptStart(storeA, 's1', { executionId: 'e1', attemptId: 'a1' })
  assert.equal(a1.activityId, a2.activityId)
  // Distinct evidence keys are distinct identities.
  const b0 = attemptStart(storeA, 's1', { executionId: 'e9', attemptId: 'a9' })
  assert.notEqual(b0.activityId, a1.activityId)
  // A fresh facade lifetime is a fresh identity domain: continuity across
  // lifetimes is never implied, so consumers cannot rely on activityId
  // stability across reloads — the contract promises neither stability nor
  // instability, only within-lifetime determinism.
  const storeB = makeStore()
  const b1 = attemptStart(storeB, 's1', { executionId: 'e1', attemptId: 'a1' })
  assert.equal(typeof b1.activityId, 'string')
})

test('store: silence is never success — a lone turn/end without completion evidence stays open', () => {
  const store = makeStore()
  turnStart(store, 's1', 1)
  turnEnd(store, 's1', 1)
  const record = store.current('s1')
  assert.equal(record.terminal, null)
  assert.equal(record.status.phase, 'running')
})