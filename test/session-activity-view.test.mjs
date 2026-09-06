import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionActivityProjection } from '../lib/session-activity.js'

function makeProjection({ observe = false } = {}) {
  return createSessionActivityProjection({ ctx: { on: () => () => {} }, observe })
}

function seed(projection) {
  projection.setSliceState({ active: true, versionMatched: true })
  projection.ingestAttemptFact('agent/attempt/start', {
    attemptId: 'att-1', executionId: 'exec-1', sessionId: 's1', seq: 1,
    observedAt: '2026-09-06T00:00:00.000Z',
  })
  projection.ingestAttemptFact('agent/attempt/end', {
    attemptId: 'att-1', executionId: 'exec-1', sessionId: 's1',
    outcome: 'success', followUp: 'none', seq: 2,
    observedAt: '2026-09-06T00:00:00.000Z',
  })
}

test('view: public members are exactly the projection verbs, no action verbs', () => {
  const projection = makeProjection()
  assert.deepEqual(Object.keys(projection.api).sort(), ['availability', 'current', 'get', 'history', 'list', 'observe'])
  for (const forbidden of ['request', 'cancel', 'retry', 'notify', 'append', 'mutate']) {
    assert.equal(forbidden in projection.api, false)
  }
})

test('view: current returns a frozen snapshot for an open activity and typed absence otherwise', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  projection.ingestAttemptFact('agent/attempt/start', {
    attemptId: 'att-1', executionId: 'exec-1', sessionId: 's1', seq: 1,
    observedAt: '2026-09-06T00:00:00.000Z',
  })
  const view = projection.api.current('s1')
  assert.equal(view.ok, undefined) // snapshot present
  assert.ok(view.snapshot)
  assert.ok(Object.isFrozen(view))
  assert.ok(Object.isFrozen(view.snapshot))
  assert.equal(view.snapshot.terminal, null)
  assert.equal(view.snapshot.status.phase, 'running')
  // unknown session => typed absence
  assert.deepEqual(projection.api.current('nope'), { ok: false, code: 'absent' })
  // invalid session id => typed absence, never an exception
  assert.deepEqual(projection.api.current(''), { ok: false, code: 'absent' })
  assert.deepEqual(projection.api.current(undefined), { ok: false, code: 'absent' })
})

test('view: get returns the frozen record with full classification or typed absence', () => {
  const projection = makeProjection()
  seed(projection)
  const history = projection.api.history('s1')
  const first = history.items[0]
  const fetched = projection.api.get(first.activityId)
  assert.equal(fetched.snapshot.activityId, first.activityId)
  assert.equal(fetched.snapshot.terminal.outcome, 'success')
  assert.equal(fetched.snapshot.terminal.confidence, 'observed')
  assert.equal(fetched.snapshot.execution.correlationConfidence, 'observed')
  assert.deepEqual(projection.api.get('unknown-activity'), { ok: false, code: 'absent' })
  assert.deepEqual(projection.api.get(''), { ok: false, code: 'absent' })
})

test('view: list pages by stable order with cursor continuation', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  for (let i = 1; i <= 5; i += 1) {
    projection.ingestAttemptFact('agent/attempt/start', {
      attemptId: `att-${i}`, executionId: `exec-${i}`, sessionId: 's1', seq: i * 2 - 1,
      observedAt: '2026-09-06T00:00:00.000Z',
    })
    projection.ingestAttemptFact('agent/attempt/end', {
      attemptId: `att-${i}`, executionId: `exec-${i}`, sessionId: 's1',
      outcome: 'success', followUp: 'none', seq: i * 2,
      observedAt: '2026-09-06T00:00:00.000Z',
    })
  }
  const page1 = projection.api.list({ sessionId: 's1', limit: 2 })
  assert.equal(page1.items.length, 2)
  assert.equal(page1.truncated, true)
  assert.ok(page1.nextCursor)
  assert.ok(Object.isFrozen(page1.items[0]))
  const page2 = projection.api.list({ sessionId: 's1', limit: 2, cursor: page1.nextCursor })
  assert.equal(page2.items.length, 2)
  assert.notEqual(page2.items[0].activityId, page1.items[0].activityId)
  const page3 = projection.api.list({ sessionId: 's1', limit: 10, cursor: page2.nextCursor })
  assert.equal(page3.items.length, 1)
  assert.equal(page3.truncated, false)
  // no duplicates across pages
  const ids = [...page1.items, ...page2.items, ...page3.items].map((item) => item.activityId)
  assert.equal(new Set(ids).size, 5)
  assert.deepEqual(projection.api.list({ sessionId: 'nope' }), { items: [], nextCursor: undefined, truncated: false, gap: null })
})

test('view: history is frozen, bounded by the facade lifetime and states its boundary', () => {
  const projection = makeProjection()
  seed(projection)
  const history = projection.api.history('s1')
  assert.equal(history.items.length, 1)
  assert.equal(history.boundary, 'facade-lifetime')
  assert.equal(history.truncated, false)
  assert.deepEqual(history.unavailable, [])
  assert.ok(Object.isFrozen(history))
  assert.ok(Object.isFrozen(history.items[0]))
})

test('view: snapshots never leak store-internal fields', () => {
  const projection = makeProjection()
  seed(projection)
  const fetched = projection.api.get(projection.api.history('s1').items[0].activityId)
  const snapshot = fetched.snapshot
  for (const internal of ['key', 'kind', 'openApprovals', 'openTools', 'turnEnded', 'lastTurn']) {
    assert.equal(internal in snapshot, false)
  }
  // public projection fields, including the facts digest
  for (const member of ['activityId', 'sessionId', 'execution', 'status', 'terminal', 'facts', 'seq', 'observedAt', 'epoch', 'fidelity']) {
    assert.ok(member in snapshot, member)
  }
})

test('view: querying is side-effect free (repeated reads are stable)', () => {
  const projection = makeProjection()
  seed(projection)
  const a = projection.api.history('s1')
  const b = projection.api.history('s1')
  assert.deepEqual(a, b)
})