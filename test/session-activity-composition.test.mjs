import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionActivityProjection } from '../lib/session-activity.js'

function makeProjection() {
  return createSessionActivityProjection({ ctx: { on: () => () => {} }, observe: true })
}

function startAttempt(projection, sessionId = 's1', seq = 1, outcome = undefined) {
  projection.ingestAttemptFact('agent/attempt/start', {
    attemptId: `att-${seq}`, executionId: `exec-${seq}`, sessionId, seq: seq * 2 - 1,
    observedAt: '2026-09-06T00:00:00.000Z',
  })
  if (outcome) {
    projection.ingestAttemptFact('agent/attempt/end', {
      attemptId: `att-${seq}`, executionId: `exec-${seq}`, sessionId,
      outcome, followUp: 'none', seq: seq * 2,
      observedAt: '2026-09-06T00:00:00.000Z',
    })
  }
}

test('composition: two synthetic plugins in reverse registration order share one frozen view', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  // plugin B registers first, plugin A second (reverse order)
  const b = projection.api.observe({ sessionId: 's1', owner: 'plugin-b' })
  const a = projection.api.observe({ sessionId: 's1', owner: 'plugin-a' })
  const seenA = []
  const seenB = []
  a.subscribe((payload) => seenA.push(payload))
  b.subscribe((payload) => seenB.push(payload))
  startAttempt(projection, 's1', 1)
  assert.equal(seenA.length, 1)
  assert.equal(seenB.length, 1)
  // identical frozen view semantics from the single projection owner
  assert.deepEqual(seenA[0].snapshot, seenB[0].snapshot)
})

test('composition: owner cleanup of one plugin never affects another', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  const a = projection.api.observe({ sessionId: 's1', owner: 'plugin-a' })
  const b = projection.api.observe({ sessionId: 's1', owner: 'plugin-b' })
  const seenA = []
  const seenB = []
  a.subscribe((payload) => seenA.push(payload))
  b.subscribe((payload) => seenB.push(payload))
  projection.cleanupOwner('plugin-a')
  startAttempt(projection, 's1', 1)
  assert.equal(seenA.length, 0)
  assert.equal(seenB.length, 1)
  startAttempt(projection, 's1', 2)
  assert.equal(seenB.length, 2)
})

test('composition: duplicate subscriptions and callback containment are isolated per plugin', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  const a = projection.api.observe({ sessionId: 's1', owner: 'plugin-a' })
  const b = projection.api.observe({ sessionId: 's1', owner: 'plugin-b' })
  const seenB = []
  const seenA = []
  a.subscribe((payload) => seenA.push(payload))
  a.subscribe(() => {
    throw new Error('a explosions')
  })
  b.subscribe((payload) => seenB.push(payload))
  startAttempt(projection, 's1', 1)
  assert.equal(seenA.length, 1)
  assert.equal(seenB.length, 1)
  // observers never observe each other's private state
  assert.equal('listeners' in seenA[0], false)
})

test('composition: concurrent queries and observations never corrupt each other', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  const handle = projection.api.observe({ sessionId: 's1' })
  const seen = []
  handle.subscribe((payload) => seen.push(payload))
  startAttempt(projection, 's1', 1)
  const queryBefore = projection.api.history('s1')
  startAttempt(projection, 's1', 2)
  const queryAfter = projection.api.history('s1')
  assert.equal(queryBefore.items.length, 1)
  assert.equal(queryAfter.items.length, 2)
  assert.equal(seen.length, 2)
})