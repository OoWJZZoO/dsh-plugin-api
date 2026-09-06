import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionActivityProjection } from '../lib/session-activity.js'
import { createActivityStore } from '../lib/session-activity-store.js'
import { deriveTerminal } from '../lib/session-activity-derivation.js'

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

const AT = Object.freeze({
  start(seq = 1) {
    return {
      attemptId: `att-${seq}`, executionId: `exec-${seq}`, sessionId: 's1', seq,
      observedAt: '2026-09-06T00:00:00.000Z',
    }
  },
  end(seq = 2, over = {}) {
    return {
      attemptId: `att-${seq - 1}`, executionId: `exec-${seq - 1}`, sessionId: 's1', seq,
      outcome: 'success', followUp: 'none', observedAt: '2026-09-06T00:00:00.000Z', ...over,
    }
  },
})

test('fidelity: slice-active runs produce observed-grade terminal facts', () => {
  const projection = createSessionActivityProjection({ ctx: { on: () => () => {} }, observe: false })
  projection.setSliceState({ active: true, versionMatched: true })
  projection.ingestAttemptFact('agent/attempt/start', AT.start(1))
  projection.ingestAttemptFact('agent/attempt/end', AT.end(2))
  const history = projection.api.history('s1')
  assert.equal(history.items[0].terminal.confidence, 'observed')
  assert.equal(history.items[0].terminal.outcome, 'success')
  assert.equal(history.items[0].fidelity.sliceObserved, true)
})

test('fidelity: slice-inactive runs reconstruct terminal facts and never mark them observed', () => {
  const { ctx, fire, sessions } = durableFixtures()
  const projection = createSessionActivityProjection({ ctx, observe: true })
  sessions.s1 = sessionObject('s1', [])
  fire('session/event', sessions.s1, ev('turn/start', 0, { turn: 1 }))
  fire('session/event', sessions.s1, ev('turn/end', 1, { turn: 1, reason: { kind: 'completed' } }))
  const history = projection.api.history('s1')
  assert.equal(history.items[0].terminal.confidence, 'reconstructed')
  assert.equal(history.items[0].terminal.ruleName, 'turn-completed-idle')
  assert.equal(history.items[0].fidelity.sliceObserved, false)
  const availability = projection.api.availability()
  assert.equal(availability.status, 'degraded')
  assert.match(availability.reason, /terminal-evidence=reconstructed/)
})

test('fidelity: silence is never success — a session with only a turn start stays open/unknown', () => {
  const { ctx, fire, sessions } = durableFixtures()
  const projection = createSessionActivityProjection({ ctx, observe: true })
  sessions.s1 = sessionObject('s1', [])
  fire('session/event', sessions.s1, ev('turn/start', 0, { turn: 1 }))
  const current = projection.api.current('s1')
  assert.equal(current.snapshot.terminal, null)
  const history = projection.api.history('s1')
  assert.equal(history.items[0].terminal, null)
})

test('fidelity: heuristic results can never be re-labelled observed', () => {
  const store = createActivityStore({ now: () => '2026-09-06T00:00:00.000Z' })
  store.ingest({ source: 'durable', sessionId: 's1', kind: 'start', turn: 1, seq: 0, observedAt: '2026-09-06T00:00:00.000Z' })
  const record = store.current('s1')
  const candidate = deriveTerminal(record, { turnCompleted: true, openApprovals: 0, openTools: 0 })
  assert.equal(candidate.confidence, 'reconstructed')
  // committing the reconstructed candidate keeps the reconstructed grade —
  // no code path upgrades a heuristic to observed
  store.ingest({
    source: 'durable', sessionId: 's1', kind: 'terminal', seq: 1,
    outcome: 'success', confidence: 'reconstructed', ruleName: 'turn-completed-idle',
    observedAt: '2026-09-06T00:00:00.000Z',
  })
  const closed = store.sessionHistory('s1')[0]
  assert.equal(closed.terminal.confidence, 'reconstructed')
  assert.equal(closed.terminal.ruleName, 'turn-completed-idle')
})

test('fidelity: denied has its three grades — observed via slice, reconstructed via approval, unknown without evidence', () => {
  // observed grade
  const sliceProj = createSessionActivityProjection({ ctx: { on: () => () => {} }, observe: false })
  sliceProj.setSliceState({ active: true, versionMatched: true })
  sliceProj.ingestAttemptFact('agent/attempt/start', AT.start(1))
  sliceProj.ingestAttemptFact('agent/attempt/end', AT.end(2, { outcome: 'denied' }))
  assert.equal(sliceProj.api.history('s1').items[0].terminal.outcome, 'denied')
  assert.equal(sliceProj.api.history('s1').items[0].terminal.confidence, 'observed')

  // reconstructed grade via durable approval rejection
  const { ctx, fire, sessions } = durableFixtures()
  const reconProj = createSessionActivityProjection({ ctx, observe: true })
  sessions.s1 = sessionObject('s1', [])
  fire('session/event', sessions.s1, ev('turn/start', 0, { turn: 1 }))
  fire('session/event', sessions.s1, ev('approval/asked', 1, { id: 'ap-1', toolName: 'bash' }))
  fire('session/event', sessions.s1, ev('approval/decided', 2, { id: 'ap-1', outcome: 'rejected' }))
  assert.equal(reconProj.api.history('s1').items[0].terminal.confidence, 'reconstructed')

  // unknown grade: no evidence at all
  const store = createActivityStore({ now: () => '2026-09-06T00:00:00.000Z' })
  store.ingest({ source: 'durable', sessionId: 's1', kind: 'start', turn: 1, seq: 0, observedAt: '2026-09-06T00:00:00.000Z' })
  const record = store.current('s1')
  assert.equal(record.terminal, null)
})

test('fidelity: overclaim is impossible — success requires real outcome evidence', () => {
  const { ctx, fire, sessions } = durableFixtures()
  const projection = createSessionActivityProjection({ ctx, observe: true })
  sessions.s1 = sessionObject('s1', [])
  // turn starts and ends with a non-completed reason: no success claim
  fire('session/event', sessions.s1, ev('turn/start', 0, { turn: 1 }))
  fire('session/event', sessions.s1, ev('turn/end', 1, { turn: 1, reason: { kind: 'aborted' } }))
  const current = projection.api.current('s1')
  assert.equal(current.snapshot.terminal, null)
  // a later user turn with data (silence afterwards) must not invent failure
  fire('session/event', sessions.s1, ev('user/message', 2, { content: 'continue please' }))
  const after = projection.api.current('s1')
  assert.equal(after.snapshot.terminal, null)
})