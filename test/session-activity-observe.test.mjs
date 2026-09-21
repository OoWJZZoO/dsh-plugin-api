import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionActivityProjection } from '../lib/session-activity.js'

function makeProjection() {
  return createSessionActivityProjection({ ctx: { on: () => () => {} }, observe: true })
}

function startAttempt(projection, sessionId = 's1', seq = 1) {
  projection.ingestAttemptFact('agent/attempt/start', {
    attemptId: `att-${seq}`, executionId: `exec-${seq}`, sessionId, seq: seq * 2 - 1,
    observedAt: '2026-09-06T00:00:00.000Z',
  })
}

test('observe: handle shape is { current, subscribe, dispose, epoch }', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  const handle = projection.api.observe({ sessionId: 's1' })
  assert.deepEqual(Object.keys(handle).sort(), ['current', 'dispose', 'epoch', 'subscribe'])
  assert.ok(Object.isFrozen(handle), 'the public handle is frozen')
  assert.equal('listeners' in handle, false, 'the internal listener set never escapes')
  assert.equal('disposed' in handle, false, 'the internal liveness flag never escapes')
  assert.equal('stale' in handle, false, 'the internal epoch flag never escapes')
  assert.equal('signal' in handle, false, 'the internal abort signal never escapes')
  assert.equal('abortHandler' in handle, false, 'the internal abort handler never escapes')
  assert.equal(typeof handle.current, 'function')
  assert.equal(typeof handle.subscribe, 'function')
  assert.equal(typeof handle.dispose, 'function')
  assert.equal(typeof handle.epoch, 'string')
  assert.match(handle.epoch, /^epoch:\d+$/)
  assert.ok(handle.epoch)
  startAttempt(projection)
  const current = handle.current()
  assert.ok(Object.isFrozen(current))
  assert.equal(current.snapshot.status.phase, 'running')
  handle.dispose()
})

test('observe: listeners receive the frozen view and listener exceptions are contained', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  const handle = projection.api.observe({ sessionId: 's1' })
  const received = []
  const throwing = () => {
    throw new Error('listener boom')
  }
  const good = (payload) => received.push(payload)
  handle.subscribe(throwing)
  handle.subscribe(good)
  startAttempt(projection)
  assert.equal(received.length, 1)
  assert.ok(Object.isFrozen(received[0]))
  assert.equal(received[0].snapshot.status.phase, 'running')
})

test('observe: dispose is idempotent and stops invocation', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  const handle = projection.api.observe({ sessionId: 's1' })
  const received = []
  handle.subscribe((payload) => received.push(payload))
  const released = handle.dispose()
  assert.equal(released.ok, true)
  assert.equal(released.code, 'revoked')
  const stale = handle.dispose()
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'stale')
  startAttempt(projection)
  assert.equal(received.length, 0)
})

test('observe: a subscription from a released handle is a no-op', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  const handle = projection.api.observe({ sessionId: 's1' })
  handle.dispose()
  const received = []
  const unsubscribe = handle.subscribe((payload) => received.push(payload))
  assert.equal(typeof unsubscribe, 'function')
  assert.doesNotThrow(() => unsubscribe())
  assert.doesNotThrow(() => handle.subscribe(null))
  startAttempt(projection)
  assert.equal(received.length, 0)
})

test('observe: a stale disposer never removes another observer', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  const first = projection.api.observe({ sessionId: 's1' })
  const second = projection.api.observe({ sessionId: 's1' })
  const firstCalls = []
  const secondCalls = []
  first.subscribe((p) => firstCalls.push(p))
  second.subscribe((p) => secondCalls.push(p))
  // dispose one: the other keeps receiving
  first.dispose()
  startAttempt(projection)
  assert.equal(firstCalls.length, 0)
  assert.equal(secondCalls.length, 1)
  second.dispose()
})

test('observe: epoch rollover isolates old handles — old callbacks never delivered', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  const old = projection.api.observe({ sessionId: 's1' })
  const oldCalls = []
  old.subscribe((p) => oldCalls.push(p))
  const oldEpoch = old.epoch
  projection.rollEpoch()
  const fresh = projection.api.observe({ sessionId: 's1' })
  const freshCalls = []
  fresh.subscribe((p) => freshCalls.push(p))
  assert.notEqual(fresh.epoch, oldEpoch)
  startAttempt(projection)
  assert.equal(oldCalls.length, 0)
  assert.equal(freshCalls.length, 1)
  // epoch rollover releases every old handle: subscribing is a no-op and the
  // stale disposer answers the stale no-op code
  assert.equal(typeof old.subscribe(() => {}), 'function')
  assert.equal(old.dispose().code, 'stale')
  assert.equal(old.dispose().code, 'stale')
})

test('observe: subscriptions are additive and independent; order encodes no semantics', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  const first = projection.api.observe({ sessionId: 's1' })
  const second = projection.api.observe({ sessionId: 's1' })
  const a = []
  const b = []
  const c = []
  first.subscribe((p) => a.push(p))
  second.subscribe((p) => b.push(p))
  second.subscribe((p) => c.push(p))
  startAttempt(projection)
  assert.equal(a.length, 1)
  assert.equal(b.length, 1)
  assert.equal(c.length, 1)
})

test('observe: delivery follows the projection seq order', () => {
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
  const projection = createSessionActivityProjection({ ctx, observe: true })
  projection.setSliceState({ active: true, versionMatched: true })
  sessions.s1 = { id: 's1', header: { id: 's1' }, events: [] }
  const handle = projection.api.observe({ sessionId: 's1' })
  const seqs = []
  handle.subscribe((payload) => seqs.push(payload.snapshot.seq))
  projection.ingestAttemptFact('agent/attempt/start', {
    attemptId: 'att-1', executionId: 'exec-1', sessionId: 's1', seq: 0,
    observedAt: '2026-09-06T00:00:00.000Z',
  })
  assert.deepEqual(seqs, [1])
  // further evidence on the SAME activity advances the record seq in order
  const fire = (name, ...args) => {
    for (const fn of [...(listeners.get(name) ?? [])]) fn(...args)
  }
  fire('session/event', sessions.s1, {
    type: 'approval/asked', seq: 1, time: Date.now(), data: { id: 'ap-1', toolName: 'bash' },
  })
  fire('session/event', sessions.s1, {
    type: 'approval/decided', seq: 2, time: Date.now(), data: { id: 'ap-1', outcome: 'allowed-once' },
  })
  assert.deepEqual(seqs, [1, 2, 3])
})

test('observe: invalid inputs are typed and never corrupt other subscriptions', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  const handle = projection.api.observe({ sessionId: 's1' })
  const received = []
  handle.subscribe((p) => received.push(p))
  // a non-function listener is a contained no-op subscription, never a throw
  assert.equal(typeof handle.subscribe('not-a-function'), 'function')
  assert.equal(typeof handle.subscribe(null), 'function')
  startAttempt(projection)
  assert.equal(received.length, 1)
  // observe without a session is refused with a typed invalid-input error and
  // never corrupts other subscriptions
  const invalidInput = (error) => error?.code === 'PLUGIN_API_SESSION_ACTIVITY_INVALID_INPUT'
  assert.throws(() => projection.api.observe({}), invalidInput)
  assert.throws(() => projection.api.observe({ sessionId: '' }), invalidInput)
  assert.throws(() => projection.api.observe(undefined), invalidInput)
  const after = projection.api.observe({ sessionId: 's1' })
  const stillReceived = []
  after.subscribe((p) => stillReceived.push(p))
  startAttempt(projection)
  assert.equal(stillReceived.length, 1)
})

test('observe: cleanupOwner removes only that owner\'s observers', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  const p1 = projection.api.observe({ sessionId: 's1', owner: 'plugin-a' })
  const p2 = projection.api.observe({ sessionId: 's1', owner: 'plugin-b' })
  const callsA = []
  const callsB = []
  p1.subscribe((payload) => callsA.push(payload))
  p2.subscribe((payload) => callsB.push(payload))
  assert.equal(projection.cleanupOwner('plugin-a'), 1)
  startAttempt(projection)
  assert.equal(callsA.length, 0)
  assert.equal(callsB.length, 1)
  // unrelated owner id is a no-op
  assert.equal(projection.cleanupOwner('plugin-c'), 0)
})

test('observe: AbortSignal disposes the observer', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  const controller = new AbortController()
  const handle = projection.api.observe({ sessionId: 's1', signal: controller.signal })
  const received = []
  handle.subscribe((p) => received.push(p))
  controller.abort()
  startAttempt(projection)
  assert.equal(received.length, 0)
})