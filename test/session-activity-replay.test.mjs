import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionActivityProjection } from '../lib/session-activity.js'

function durableFixtures() {
  const listeners = new Map()
  const sessions = {}
  const ctx = {
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name).push(listener)
      return () => {}
    },
    get(service) {
      if (service === 'sessions') return { get: (id) => sessions[id] }
      return undefined
    },
  }
  function fire(name, ...args) {
    for (const fn of [...(listeners.get(name) ?? [])]) fn(...args)
  }
  return { ctx, fire, sessions }
}

function ev(type, seq, data = {}) {
  return { type, seq, time: Date.now(), data }
}

function sessionObject(id, events) {
  return { id, header: { id }, events: events ?? [] }
}

test('replay: host reload falls back observed-grade facts to reconstructed', () => {
  const { ctx, sessions } = durableFixtures()
  sessions.s1 = sessionObject('s1', [
    ev('turn/start', 0, { turn: 1 }),
    ev('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }),
  ])
  // lifecycle one: the live owner joins the durable log (no attempt facts in
  // the log; observed-grade fidelity is not claimable)
  const live = createSessionActivityProjection({ ctx, observe: true })
  live.joinDurable(sessions.s1)
  assert.equal(live.api.history('s1').items[0].fidelity.sliceObserved, false)

  // lifecycle two (host reload): the in-memory attempt facts are gone; the
  // rebuilt view must not claim observed fidelity for the lost facts
  const reloaded = createSessionActivityProjection({ ctx, observe: true })
  reloaded.joinDurable(sessions.s1)
  const history = reloaded.api.history('s1')
  assert.equal(history.items[0].terminal.confidence, 'reconstructed')
  assert.equal(history.items[0].fidelity.sliceObserved, false)
  assert.equal(reloaded.api.availability().status, 'degraded')
})

test('replay: late events after a committed terminal are audit-only', () => {
  const { ctx, fire, sessions } = durableFixtures()
  const projection = createSessionActivityProjection({ ctx, observe: true })
  projection.setSliceState({ active: true, versionMatched: true })
  sessions.s1 = sessionObject('s1', [
    ev('turn/start', 0, { turn: 1 }),
    ev('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }),
  ])
  projection.joinDurable(sessions.s1)
  const before = projection.api.history('s1').items[0].terminal
  // a late turn/start event arrives after the terminal
  fire('session/event', sessions.s1, ev('turn/start', 5, { turn: 1 }))
  const after = projection.api.history('s1').items[0].terminal
  assert.deepEqual(after, before)
  assert.equal(projection.api.history('s1').items.length, 1)
})

test('replay: duplicate durable records from a join are applied once', () => {
  const { ctx, sessions } = durableFixtures()
  const projection = createSessionActivityProjection({ ctx, observe: true })
  sessions.s1 = sessionObject('s1', [
    ev('turn/start', 0, { turn: 1 }),
    ev('turn/start', 0, { turn: 1 }), // duplicate of the same seq
    ev('turn/end', 1, { turn: 1, reason: { kind: 'completed' } }),
  ])
  projection.joinDurable(sessions.s1)
  const history = projection.api.history('s1')
  assert.equal(history.items.length, 1)
  // the duplicate did not double-apply the turn start
  assert.equal(history.items[0].facts.filter((f) => f.fact === 'turn-start').length, 1)
  assert.equal(history.items[0].terminal.outcome, 'success')
})

test('replay: non-contiguous seqs surface a gap marker and never guess the missing facts', () => {
  const { ctx, sessions } = durableFixtures()
  const projection = createSessionActivityProjection({ ctx, observe: true })
  sessions.s1 = sessionObject('s1', [
    ev('turn/start', 0, { turn: 1 }),
    ev('turn/start', 1, { turn: 2 }),
    ev('turn/end', 4, { turn: 2, reason: { kind: 'completed' } }), // seqs 2,3 missing
  ])
  projection.joinDurable(sessions.s1)
  const history = projection.api.history('s1')
  assert.ok(history.gap)
  assert.equal(history.gap.fromSeq, 2)
  assert.equal(history.gap.toSeq, 3)
  // superseded-by-boundary for turn 1 (never ended): reconstructed, not invented success
  assert.equal(history.items[0].terminal.outcome, 'superseded')
  assert.equal(history.items[0].terminal.confidence, 'reconstructed')
})

test('replay: stale results from an old owner never update the current view', () => {
  const { ctx, fire, sessions } = durableFixtures()
  const projection = createSessionActivityProjection({ ctx, observe: true })
  sessions.s1 = sessionObject('s1', [])
  const first = projection.api.observe({ sessionId: 's1', owner: 'old-owner' })
  const seen = []
  first.subscribe((payload) => seen.push(payload))
  projection.rollEpoch()
  // a stale callback (old handle) cannot deliver on the new epoch
  fire('session/event', sessions.s1, ev('turn/start', 0, { turn: 1 }))
  assert.equal(seen.length, 0)
  const current = projection.api.current('s1')
  assert.equal(current.snapshot.status.phase, 'running')
})