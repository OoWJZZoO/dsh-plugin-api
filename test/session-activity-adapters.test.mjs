import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionActivityProjection } from '../lib/session-activity.js'

function makeHarness() {
  const listeners = new Map()
  const sessions = {}
  const ctx = {
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name).push(listener)
      return () => {
        const arr = listeners.get(name)
        if (arr) {
          const idx = arr.indexOf(listener)
          if (idx !== -1) arr.splice(idx, 1)
        }
      }
    },
    get(service) {
      if (service === 'sessions') return { get: (id) => sessions[id] }
      return undefined
    },
  }
  const projection = createSessionActivityProjection({ ctx, observe: true })
  function fire(name, ...args) {
    for (const fn of [...(listeners.get(name) ?? [])]) fn(...args)
  }
  return { projection, listeners, fire, sessions }
}

function durableEvent(type, seq, data = {}) {
  return { type, seq, time: Date.now(), data }
}

function sessionObject(id, events) {
  return { id, header: { id }, events: events ?? [] }
}

test('adapters: durable joiner replays a session log with cursor dedupe', () => {
  const { projection, sessions } = makeHarness()
  sessions.s1 = sessionObject('s1', [
    durableEvent('turn/start', 0, { turn: 1 }),
    durableEvent('turn/end', 1, { turn: 1, reason: { kind: 'completed' } }),
  ])
  const first = projection.joinDurable(sessions.s1)
  assert.equal(first.replayed, 2)
  assert.equal(first.skipped, 0)
  const history = projection.api.history('s1')
  assert.equal(history.items.length, 1)
  assert.equal(history.items[0].terminal.outcome, 'success')
  assert.equal(history.items[0].terminal.confidence, 'reconstructed')
  assert.equal(history.items[0].terminal.ruleName, 'turn-completed-idle')
  // replaying the same log again applies nothing twice
  const second = projection.joinDurable(sessions.s1)
  assert.equal(second.replayed, 0)
  assert.equal(second.skipped, 2)
  assert.equal(projection.api.history('s1').items.length, 1)
})

test('adapters: live firehose dedupes duplicate seqs and marks gaps', () => {
  const { projection, fire, sessions } = makeHarness()
  sessions.s1 = sessionObject('s1', [])
  fire('session/event', sessions.s1, durableEvent('turn/start', 0, { turn: 1 }))
  // duplicate of seq 0
  fire('session/event', sessions.s1, durableEvent('turn/start', 0, { turn: 1 }))
  // jump from 0 to 2 -> gap at 1
  fire('session/event', sessions.s1, durableEvent('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }))
  const history = projection.api.history('s1')
  assert.equal(history.items.length, 1)
  assert.equal(history.items[0].terminal.outcome, 'success')
  // the gap marker is exposed on the view: the missing seq 1 is surfaced,
  // never guessed as success
  const gap = history.gap
  assert.ok(gap)
  assert.equal(gap.fromSeq, 1)
  assert.equal(gap.toSeq, 1)
  assert.equal(gap.source, 'durable')
})

test('adapters: turn-completed with a pending approval never claims success', () => {
  const { projection, fire, sessions } = makeHarness()
  sessions.s1 = sessionObject('s1', [])
  fire('session/event', sessions.s1, durableEvent('turn/start', 0, { turn: 1 }))
  fire('session/event', sessions.s1, durableEvent('approval/asked', 1, { id: 'ap-1', toolName: 'bash' }))
  fire('session/event', sessions.s1, durableEvent('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }))
  const view = projection.api.current('s1')
  // still waiting on approval; silence is not success
  assert.equal(view.snapshot.terminal, null)
  assert.equal(view.snapshot.status.phase, 'waiting')
  assert.equal(view.snapshot.status.waiting.kind, 'approval')
})

test('adapters: approval/rejected maps to reconstructed denied when correlation is provable', () => {
  const { projection, fire, sessions } = makeHarness()
  sessions.s1 = sessionObject('s1', [])
  fire('session/event', sessions.s1, durableEvent('turn/start', 0, { turn: 1 }))
  fire('session/event', sessions.s1, durableEvent('approval/asked', 1, { id: 'ap-1', toolName: 'bash' }))
  fire('session/event', sessions.s1, durableEvent('approval/decided', 2, { id: 'ap-1', outcome: 'rejected' }))
  const history = projection.api.history('s1')
  assert.equal(history.items.length, 1)
  assert.equal(history.items[0].terminal.outcome, 'denied')
  assert.equal(history.items[0].terminal.confidence, 'reconstructed')
  assert.equal(history.items[0].terminal.ruleName, 'denied-by-approval')
})

test('adapters: tools waiting is per evidence and clears when the tool result lands', () => {
  const { projection, fire, sessions } = makeHarness()
  sessions.s1 = sessionObject('s1', [])
  fire('session/event', sessions.s1, durableEvent('turn/start', 0, { turn: 1 }))
  fire('session/event', sessions.s1, durableEvent('tool/call', 1, { callId: 'c1', toolName: 'fs' }))
  let view = projection.api.current('s1')
  assert.equal(view.snapshot.status.waiting.kind, 'tool')
  fire('session/event', sessions.s1, durableEvent('tool/result', 2, { callId: 'c1' }))
  view = projection.api.current('s1')
  assert.equal(view.snapshot.status.waiting, undefined)
})

test('adapters: agent/error maps to reconstructed error for the owning session', () => {
  const { projection, fire, sessions } = makeHarness()
  sessions.s1 = sessionObject('s1', [])
  fire('session/event', sessions.s1, durableEvent('turn/start', 0, { turn: 1 }))
  fire('agent/error', { agent: { session: { id: 's1' } }, message: 'boom' })
  const history = projection.api.history('s1')
  assert.equal(history.items.length, 1)
  assert.equal(history.items[0].terminal.outcome, 'error')
  assert.equal(history.items[0].terminal.confidence, 'reconstructed')
  assert.equal(history.items[0].terminal.ruleName, 'agent-error')
})

test('adapters: un-ownable signals never create fabricated facts', () => {
  const { projection, fire, sessions } = makeHarness()
  sessions.s1 = sessionObject('s1', [])
  // agent/error without any session identity must not invent an activity
  fire('agent/error', { message: 'no owner' })
  assert.equal(projection.api.history('s1').items.length, 0)
  fire('session/event', sessions.s1, durableEvent('user/message', 0, { content: 'hello' }))
  assert.equal(projection.api.history('s1').items.length, 0)
})

test('adapters: observation never mutates official event payloads', () => {
  const { projection, fire, sessions } = makeHarness()
  sessions.s1 = sessionObject('s1', [])
  const event = durableEvent('turn/start', 0, { turn: 1 })
  const snapshot = { ...event, data: { ...event.data } }
  fire('session/event', sessions.s1, event)
  assert.deepEqual(event, snapshot)
  projection.dispose()
})

test('adapters: without ctx.on no evidence source is reachable and availability reports unavailable', () => {
  const projection = createSessionActivityProjection({ ctx: {}, observe: true })
  const availability = projection.api.availability()
  assert.equal(availability.status, 'unavailable')
  assert.equal(availability.reason, 'evidence-sources-unavailable')
})

test('adapters: dispose is idempotent and stops consumption', () => {
  const { projection, fire, sessions } = makeHarness()
  sessions.s1 = sessionObject('s1', [])
  assert.equal(projection.dispose(), true)
  assert.equal(projection.dispose(), false)
  fire('session/event', sessions.s1, durableEvent('turn/start', 0, { turn: 1 }))
  assert.equal(projection.api.history('s1').items.length, 0)
})