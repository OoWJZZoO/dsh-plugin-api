import test from 'node:test'
import assert from 'node:assert/strict'
import { createExecutionReducer, TERMINAL_OUTCOMES } from '../lib/execution-observation-reducer.js'

const at = '2026-01-01T00:00:00.000Z'

function startFragment(key, extra = {}) {
  return {
    key,
    sourceKind: 'tools',
    observedAt: at,
    kind: 'start',
    ...extra,
  }
}

test('execution identity is independent of event sequence and repetition keyed on provable object identity', () => {
  const reducer = createExecutionReducer({ now: () => at })
  const exec = {}
  const first = reducer.ingest(startFragment(exec, { seq: 1 }))
  const repeated = reducer.ingest(startFragment(exec, { seq: 99 }))
  assert.equal(first.executionId, repeated.executionId)
  const other = {}
  const second = reducer.ingest(startFragment(other, { seq: 2 }))
  assert.notEqual(first.executionId, second.executionId)
  const snap = reducer.get(first.executionId)
  assert.equal(snap.provenance.length, 2)
})

test('internal retry reuses the executionId and adds distinct attempt records', () => {
  const reducer = createExecutionReducer({ now: () => at })
  const exec = {}
  const { executionId } = reducer.ingest(startFragment(exec))
  reducer.ingest({ executionId, sourceKind: 'tools', observedAt: at, kind: 'attempt-start', owner: 'o', generation: 'g1', attemptId: 'a1' })
  reducer.ingest({ executionId, sourceKind: 'tools', observedAt: at, kind: 'attempt-start', owner: 'o', generation: 'g2', attemptId: 'a2' })
  const snap = reducer.get(executionId)
  assert.equal(snap.executionId, executionId)
  assert.equal(snap.attempt.length, 2)
  assert.equal(snap.attempt[0].attempt, 1)
  assert.equal(snap.attempt[1].attempt, 2)
})

test('unavailable parent/cause stays absent instead of being invented', () => {
  const reducer = createExecutionReducer({ now: () => at })
  const exec = {}
  const { executionId } = reducer.ingest(startFragment(exec))
  const snap = reducer.get(executionId)
  assert.equal('parentExecutionId' in snap, false)
  assert.equal('cause' in snap, false)
})

test('terminal outcome commits exactly once and later fragments cannot rewrite it', () => {
  const reducer = createExecutionReducer({ now: () => at })
  const exec = {}
  const { executionId } = reducer.ingest(startFragment(exec))
  assert.equal(reducer.ingest({ executionId, sourceKind: 'tools', observedAt: at, kind: 'terminal', outcome: 'success' }).committed, true)
  assert.equal(reducer.ingest({ executionId, sourceKind: 'tools', observedAt: at, kind: 'terminal', outcome: 'error' }).committed, false)
  const snap = reducer.get(executionId)
  assert.equal(snap.outcome, 'success')
  assert.equal(snap.settled, true)
  assert.equal(snap.closed, false)
  assert.equal(snap.provenance.length >= 2, true)
})

test('timeout maps to error with a category and no new timeout outcome', () => {
  const reducer = createExecutionReducer({ now: () => at })
  const exec = {}
  const { executionId } = reducer.ingest(startFragment(exec))
  reducer.ingest({
    executionId,
    sourceKind: 'llm',
    observedAt: at,
    kind: 'terminal',
    outcome: 'error',
    outcomeReason: { category: 'timeout', code: 'LLM_TIMEOUT' },
  })
  const snap = reducer.get(executionId)
  assert.equal(snap.outcome, 'error')
  assert.equal(snap.outcomeReason.category, 'timeout')
  assert.equal(TERMINAL_OUTCOMES.includes('timeout'), false)
})

test('lifecycle metadata stays separate from terminal outcome vocabulary', () => {
  const reducer = createExecutionReducer({ now: () => at })
  const exec = {}
  const { executionId } = reducer.ingest(startFragment(exec))
  reducer.ingest({ executionId, sourceKind: 'agent', observedAt: at, kind: 'terminal', outcome: 'aborted' })
  const snap = reducer.get(executionId)
  assert.equal(snap.outcome, 'aborted')
  assert.equal(snap.settled, true)
  assert.notEqual(snap.outcome, 'settled')
  assert.notEqual(snap.outcome, 'closed')
  assert.notEqual(snap.outcome, 'disposed')
})

test('child terminal ends the child by default and only affects the parent when marked required', () => {
  const reducer = createExecutionReducer({ now: () => at })
  const parentKey = {}
  const parent = reducer.ingest(startFragment(parentKey, { sessionId: 's1' }))
  const childKey = {}
  const child = reducer.ingest(
    startFragment(childKey, { sessionId: 's1', parentExecutionId: parent.executionId }),
  )
  // Not required: child errors, parent untouched.
  reducer.ingest({ executionId: child.executionId, sourceKind: 'tools', observedAt: at, kind: 'terminal', outcome: 'error' })
  assert.equal(reducer.get(child.executionId).outcome, 'error')
  assert.equal(reducer.get(parent.executionId).outcome, undefined)

  // Required child: parent affected.
  const child2Key = {}
  const child2 = reducer.ingest(
    startFragment(child2Key, { sessionId: 's1', parentExecutionId: parent.executionId }),
  )
  reducer.ingest({
    executionId: child2.executionId,
    sourceKind: 'tools',
    observedAt: at,
    kind: 'terminal',
    outcome: 'error',
    requiredForParent: true,
  })
  assert.equal(reducer.get(child2.executionId).outcome, 'error')
  assert.equal(reducer.get(parent.executionId).outcome, 'error')
})

test('returned snapshots are deeply frozen and immutable to callers', () => {
  const reducer = createExecutionReducer({ now: () => at })
  const exec = {}
  const { executionId } = reducer.ingest(startFragment(exec, { sessionId: 's1' }))
  const snap = reducer.get(executionId)
  assert.ok(Object.isFrozen(snap))
  assert.ok(Object.isFrozen(snap.start))
  assert.ok(Object.isFrozen(snap.attempt))
  assert.throws(() => { snap.outcome = 'success' }, TypeError)
})
