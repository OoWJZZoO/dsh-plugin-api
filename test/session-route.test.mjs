import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionRouteOwner } from '../lib/session-route.js'

function harness(options = {}) {
  const listeners = new Map()
  const sessions = new Map()
  const eventsApi = options.eventsApi ?? {
    observe(name) {
      const set = listeners.get(name) ?? new Set()
      listeners.set(name, set)
      const feed = {
        subscribe(listener) {
          set.add(listener)
          return () => set.delete(listener)
        },
        dispose() {
          listeners.delete(name)
          return true
        },
      }
      return feed
    },
  }
  const emit = (name, ...args) => {
    // The projection entry delivers the frozen args array for multi-arg
    // events; the route owner's native adapter unpacks it.
    for (const listener of [...(listeners.get(name) ?? [])]) listener(args)
  }
  const owner = createSessionRouteOwner({ sessions: {
    get(id) { return sessions.get(id) },
    list() { return [...sessions.values()] },
  }, eventsApi, logger: options.logger })
  return { owner, sessions, emit, listeners }
}

function makeSession(id, route) {
  return {
    id,
    firstLiveSeq: 0,
    requestContext() { return route ? { ...route } : undefined },
  }
}

test('session route validates, caches identity, corroborates events, and observes future changes', () => {
  const h = harness()
  const session = makeSession('s1')
  h.sessions.set(session.id, session)
  assert.equal(h.owner.api.current(session), undefined)
  const seen = []
  const dispose = h.owner.api.on(session, (route) => seen.push(route))

  let route = { provider: 'p1', model: 'm1' }
  session.requestContext = () => ({ ...route })
  h.emit('session/event', session, { type: 'request/context', seq: 0, data: route })
  assert.equal(seen.length, 1)
  const first = seen[0]
  assert.equal(Object.isFrozen(first), true)
  assert.equal(h.owner.api.current(session), first)

  h.emit('session/event', session, { type: 'request/context', seq: 1, data: route })
  assert.equal(seen.length, 1)
  route = { provider: 'p2', model: 'm2' }
  session.requestContext = () => ({ ...route })
  h.emit('session/event', session, { type: 'request/context', seq: 2, data: route })
  assert.equal(seen.length, 2)
  assert.notEqual(seen[1], first)
  assert.equal(dispose(), true)
  assert.equal(dispose(), false)
})

test('wait resolves next route, aborts exactly, and once detaches before callback', async () => {
  const h = harness()
  const session = makeSession('s1')
  h.sessions.set(session.id, session)
  const controller = new AbortController()
  const pending = h.owner.api.wait(session, { signal: controller.signal })
  let onceDispose
  const seen = []
  onceDispose = h.owner.api.once(session, () => {
    seen.push('once')
    assert.equal(onceDispose(), false)
  })
  controller.abort('stop')
  await assert.rejects(pending, (reason) => reason === 'stop')

  const next = h.owner.api.wait(session)
  session.requestContext = () => ({ provider: 'p', model: 'm' })
  h.emit('session/event', session, { type: 'request/context', seq: 0, data: { provider: 'p', model: 'm' } })
  const route = await next
  assert.deepEqual(route, { provider: 'p', model: 'm' })
  assert.deepEqual(seen, ['once'])
})

test('malformed, stale, cross-session and replacement observations never publish', () => {
  const h = harness()
  const session = makeSession('s1', { provider: 'p', model: 'm' })
  const foreign = makeSession('s2', { provider: 'x', model: 'y' })
  h.sessions.set(session.id, session)
  h.sessions.set(foreign.id, foreign)
  const seen = []
  h.owner.api.on(session, (route) => seen.push(route))
  h.emit('session/event', session, { type: 'request/context', seq: -1, data: { provider: 'p', model: 'm' } })
  h.emit('session/event', foreign, { type: 'request/context', seq: 0, data: { provider: 'p', model: 'm' } })
  h.emit('session/event', session, { type: 'request/context', seq: 0, data: { provider: 'p', model: 'other' } })
  assert.equal(seen.length, 0)
  h.sessions.set(session.id, makeSession('s1'))
  h.emit('session/event', session, { type: 'request/context', seq: 1, data: { provider: 'p', model: 'm' } })
  assert.equal(seen.length, 0)
})

test('dispose rejects pending waits and leaves replacement identity untouched', async () => {
  const h = harness()
  const session = makeSession('s1')
  h.sessions.set(session.id, session)
  const pending = h.owner.api.wait(session)
  h.sessions.delete(session.id)
  h.emit('session/disposed', session)
  await assert.rejects(pending, (reason) => reason?.code === 'target-session-disposed')
  const replacement = makeSession('s1', { provider: 'new', model: 'model' })
  h.sessions.set(replacement.id, replacement)
  assert.deepEqual(h.owner.api.current(replacement), { provider: 'new', model: 'model' })
})

test('current seeding never replays to a later observer and preserves snapshot identity', () => {
  const h = harness()
  const session = makeSession('seed', { provider: 'seed-provider', model: 'seed-model' })
  h.sessions.set(session.id, session)
  const seeded = h.owner.api.current(session)
  const seen = []
  h.owner.api.on(session, (route) => seen.push(route))
  assert.equal(h.owner.api.current(session), seeded)
  assert.deepEqual(seen, [])
})

test('listener order is synchronous, failures are contained, and async rejection is handled', async () => {
  const diagnostics = []
  const h = harness({ logger: { error(message) { diagnostics.push(message) } } })
  const session = makeSession('order')
  h.sessions.set(session.id, session)
  const order = []
  h.owner.api.on(session, () => { order.push('throw'); throw new Error('listener throw') })
  h.owner.api.on(session, async () => { order.push('reject'); throw new Error('listener reject') })
  h.owner.api.on(session, () => { order.push('last') })
  const unhandled = []
  const onUnhandled = (reason) => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    session.requestContext = () => ({ provider: 'p', model: 'm' })
    assert.doesNotThrow(() => h.emit('session/event', session, {
      type: 'request/context', seq: 0, data: { provider: 'p', model: 'm' },
    }))
    assert.deepEqual(order, ['throw', 'reject', 'last'])
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(unhandled, [])
    assert.ok(diagnostics.some((message) => message.includes('routing-listener-failed')))
  } finally {
    process.removeListener('unhandledRejection', onUnhandled)
  }
})

test('nested replacement proof detaches old listeners, rejects waits, and quarantines old identity', async () => {
  const h = harness()
  const session = makeSession('nested')
  h.sessions.set(session.id, session)
  const order = []
  h.owner.api.on(session, () => {
    order.push('first')
    h.sessions.set(session.id, makeSession('nested', { provider: 'replacement', model: 'm' }))
  })
  h.owner.api.on(session, () => order.push('stale-second'))
  const pending = h.owner.api.wait(session)
  session.requestContext = () => ({ provider: 'p', model: 'm' })
  h.emit('session/event', session, { type: 'request/context', seq: 0, data: { provider: 'p', model: 'm' } })
  await assert.rejects(pending, (reason) => reason?.code === 'target-session-disposed')
  assert.deepEqual(order, ['first'])
  assert.throws(() => h.owner.api.on(session, () => {}), (reason) => reason?.code === 'invalid-target-session')
})

test('sessions remain isolated under concurrent waits and observations', async () => {
  const h = harness()
  const a = makeSession('a')
  const b = makeSession('b')
  h.sessions.set(a.id, a)
  h.sessions.set(b.id, b)
  const seenA = []
  const seenB = []
  h.owner.api.on(a, (route) => seenA.push(route.provider))
  h.owner.api.on(b, (route) => seenB.push(route.provider))
  const waitA = h.owner.api.wait(a)
  const waitB = h.owner.api.wait(b)
  a.requestContext = () => ({ provider: 'a-provider', model: 'm' })
  h.emit('session/event', a, { type: 'request/context', seq: 0, data: { provider: 'a-provider', model: 'm' } })
  assert.deepEqual(await waitA, { provider: 'a-provider', model: 'm' })
  assert.equal(seenA.length, 1)
  assert.deepEqual(seenB, [])
  b.requestContext = () => ({ provider: 'b-provider', model: 'm' })
  h.emit('session/event', b, { type: 'request/context', seq: 0, data: { provider: 'b-provider', model: 'm' } })
  assert.deepEqual(await waitB, { provider: 'b-provider', model: 'm' })
  assert.deepEqual(seenA, ['a-provider'])
  assert.deepEqual(seenB, ['b-provider'])
})

test('wait validates options, preserves exact abort reason, and current wins over later abort', async () => {
  const h = harness()
  const session = makeSession('wait-current', { provider: 'p', model: 'm' })
  h.sessions.set(session.id, session)
  assert.throws(() => h.owner.api.wait(session, { signal: {} }), (reason) => reason?.code === 'invalid-options')
  const reason = new Error('already aborted')
  const already = new AbortController()
  already.abort(reason)
  await assert.rejects(h.owner.api.wait(session, { signal: already.signal }), (received) => received === reason)
  const controller = new AbortController()
  const current = h.owner.api.wait(session, { signal: controller.signal })
  controller.abort(new Error('late abort'))
  assert.deepEqual(await current, { provider: 'p', model: 'm' })
})

test('native registration failure rolls back prior hook and logger failures stay contained', () => {
  const disposed = []
  const eventsApi = {
    observe(name) {
      if (name === 'session/disposed') throw new Error('registration failure')
      const feed = { subscribe() { return () => true }, dispose() { disposed.push(name); return true } }
      return feed
    },
  }
  assert.throws(() => harness({ eventsApi }))
  assert.deepEqual(disposed, ['session/event'])
  const h = harness({ logger: { error() { throw new Error('logger failure') } } })
  const session = makeSession('logger')
  h.sessions.set(session.id, session)
  h.owner.api.on(session, () => { throw new Error('contained') })
  session.requestContext = () => ({ provider: 'p', model: 'm' })
  assert.doesNotThrow(() => h.emit('session/event', session, {
    type: 'request/context', seq: 0, data: { provider: 'p', model: 'm' },
  }))
})
