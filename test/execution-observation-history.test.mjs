import test from 'node:test'
import assert from 'node:assert/strict'
import { createExecutionReducer } from '../lib/execution-observation-reducer.js'
import { createExecutionHistory } from '../lib/execution-observation-history.js'

const at = '2026-01-01T00:00:00.000Z'

function seed(reducer, sessionId, count) {
  const ids = []
  for (let i = 0; i < count; i += 1) {
    const key = { marker: i }
    const { executionId } = reducer.ingest({
      key,
      sourceKind: 'tools',
      observedAt: at,
      kind: 'start',
      sessionId,
      phase: 'started',
    })
    reducer.ingest({ executionId, sourceKind: 'tools', observedAt: at, kind: 'terminal', outcome: 'success' })
    ids.push(executionId)
  }
  return ids
}

test('history is session-scoped and bounded with truncated/nextCursor metadata', () => {
  const reducer = createExecutionReducer({ now: () => at })
  seed(reducer, 's1', 5)
  seed(reducer, 's2', 2)
  const history = createExecutionHistory({ reducer })

  const page = history.query('s1', { limit: 2 })
  assert.equal(page.items.length, 2)
  assert.equal(page.truncated, true)
  assert.ok(page.nextCursor)
  assert.deepEqual(page.unavailable, [])

  const next = history.query('s1', { limit: 2, cursor: page.nextCursor })
  assert.equal(next.items.length, 2)
  assert.equal(next.truncated, true)
  assert.ok(next.nextCursor)

  const last = history.query('s1', { limit: 2, cursor: next.nextCursor })
  assert.equal(last.items.length, 1)
  assert.equal(last.truncated, false)
  assert.equal(last.nextCursor, undefined)
  // Session isolation.
  assert.equal(history.query('s2').items.length, 2)
})

test('history never synthesizes events and identifies only what exists', () => {
  const reducer = createExecutionReducer({ now: () => at })
  seed(reducer, 's1', 1)
  const history = createExecutionHistory({ reducer })
  const empty = history.query('nope')
  assert.deepEqual(empty.items, [])
  assert.equal(empty.truncated, false)
  assert.deepEqual(empty.unavailable, [])
})

test('returned items are frozen read-only', () => {
  const reducer = createExecutionReducer({ now: () => at })
  seed(reducer, 's1', 1)
  const history = createExecutionHistory({ reducer })
  const { items } = history.query('s1')
  assert.ok(Object.isFrozen(items[0]))
  assert.throws(() => { items[0].outcome = 'error' }, TypeError)
})
