import test from 'node:test'
import assert from 'node:assert/strict'
import { createCoordinationLease } from '../lib/coordination-lease.js'

const START_MS = Date.parse('2026-01-01T00:00:00.000Z')

function fakeClock(start = START_MS) {
  let current = start
  const now = () => new Date(current)
  const advance = (ms) => { current += ms }
  return { now, advance }
}

function createOwner(options = {}) {
  const clock = options.clock ?? fakeClock()
  const ctx = { get: options.get ?? (() => undefined) }
  return { owner: createCoordinationLease({ ctx, logger: { error() {} }, now: clock.now }), clock }
}

const resource = { scope: 'workspace', key: 'watched-resource' }

async function settle(queue) {
  await new Promise((resolve) => setImmediate(resolve))
  return queue
}

test('watch delivers immutable transitions with generation, version, expiry, fencing and provenance metadata', async () => {
  const { owner, clock } = createOwner()
  const subscription = await owner.api.watch(resource)
  const events = []
  subscription.subscribe((event) => events.push(event))
  const acquired = await owner.api.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  clock.advance(10_000)
  await owner.api.heartbeat(acquired.handle, { leaseMs: 60_000 })
  await settle(events)
  assert.equal(events.length, 2)
  const first = events[0]
  assert.equal(first.reason, 'acquired')
  assert.equal(first.generation, acquired.handle.generation)
  assert.equal(first.version, 0)
  assert.equal(first.fencingValid, true)
  assert.equal(first.fencingToken, undefined)
  assert.equal(first.current.ownerId, 'owner')
  assert.equal(first.previous, undefined)
  assert.ok(first.observedAt)
  assert.ok(first.epoch)
  assert.ok(Object.isFrozen(first))
  assert.ok(Object.isFrozen(first.current))
  const second = events[1]
  assert.equal(second.reason, 'heartbeated')
  assert.equal(second.generation, acquired.handle.generation)
  // heartbeat extends expiry beyond the original window
  assert.ok(Date.parse(second.expiresAt) > Date.parse(first.expiresAt))
})

test('watch transitions carry a true previous image before the mutation', async () => {
  const { owner, clock } = createOwner()
  const subscription = await owner.api.watch(resource)
  const events = []
  subscription.subscribe((event) => events.push(event))
  const acquired = await owner.api.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  clock.advance(5_000)
  await owner.api.heartbeat(acquired.handle, { leaseMs: 60_000 })
  await owner.api.compareAndSet({ resource, handle: acquired.handle, expectedVersion: 0, value: { v: 1 } })
  await owner.api.release(acquired.handle)
  await settle(events)
  assert.equal(events.length, 4)
  // heartbeat: previous is the pre-mutation active image
  assert.equal(events[1].previous.state, 'active')
  assert.ok(Date.parse(events[1].previous.expiresAt) < Date.parse(events[1].expiresAt))
  // CAS: previous version precedes the committed version
  assert.equal(events[2].reason, 'value-updated')
  assert.equal(events[2].previous.version, 0)
  assert.equal(events[2].version, 1)
  assert.equal(events[2].current.version, 1)
  // release: previous is the active record, current is released
  assert.equal(events[3].reason, 'released')
  assert.equal(events[3].previous.state, 'active')
  assert.equal(events[3].current.state, 'released')
  assert.equal(events[3].fencingValid, false)
})

test('disposing a watch stops delivery for that subscription only', async () => {
  const { owner, clock } = createOwner()
  const first = await owner.api.watch(resource)
  const second = await owner.api.watch(resource)
  const firstEvents = []
  const secondEvents = []
  first.subscribe((event) => firstEvents.push(event))
  second.subscribe((event) => secondEvents.push(event))
  const ownedA = await owner.api.acquire({ resource, ownerId: 'owner-a', leaseMs: 1_000 })
  assert.equal(ownedA.ok, true)
  assert.equal(first.dispose(), true)
  assert.equal(first.dispose(), false)
  clock.advance(2_000)
  const ownedB = await owner.api.acquire({ resource, ownerId: 'owner-b', leaseMs: 60_000 })
  assert.equal(ownedB.ok, true)
  await owner.api.release(ownedB.handle)
  await settle([firstEvents, secondEvents])
  assert.equal(firstEvents.length, 1)
  assert.equal(secondEvents.length, 3)
  assert.equal(first.dispose(), false)
})

test('watch reports explicit resync when sinceGeneration cannot be reconstructed', async () => {
  const { owner } = createOwner()
  const acquired = await owner.api.acquire({ resource, ownerId: 'owner-a', leaseMs: 60_000 })
  // a watcher that claims to have observed everything up to the pre-history
  // era cannot be replayed by a no-history memory backend: the first
  // delivered transition reports resync instead of silently skipping
  const subscription = await owner.api.watch(resource, { sinceGeneration: 'gen:000000000000' })
  const events = []
  subscription.subscribe((event) => events.push(event))
  await owner.api.release(acquired.handle)
  await settle(events)
  assert.ok(events.length >= 1)
  assert.equal(events[0].resync, true)
  assert.equal(events[0].generation, acquired.handle.generation)
  assert.equal(events[0].reason, 'released')
  // aligned watchers never report resync: the next transition carries the
  // exact generation the watcher started at
  const ownedB = await owner.api.acquire({ resource, ownerId: 'owner-b', leaseMs: 60_000 })
  assert.equal(ownedB.ok, true)
  const aligned = await owner.api.watch(resource, { sinceGeneration: ownedB.handle.generation })
  const alignedEvents = []
  aligned.subscribe((event) => alignedEvents.push(event))
  await owner.api.heartbeat(ownedB.handle, { leaseMs: 60_000 })
  await settle(alignedEvents)
  assert.equal(alignedEvents[0].resync, false)
})

test('watch current() reports the redacted record or an explicit unavailable state', async () => {
  const { owner } = createOwner()
  const missing = await owner.api.watch(resource)
  const absent = await missing.current()
  assert.equal(absent.code, 'unavailable')
  const acquired = await owner.api.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  const watching = await owner.api.watch(resource)
  const current = await watching.current()
  assert.equal(current.generation, acquired.handle.generation)
  assert.equal(current.fencingValid, true)
  assert.equal(current.fencingToken, undefined)
  assert.equal(current.state, 'active')
  await owner.api.release(acquired.handle)
  const after = await watching.current()
  assert.equal(after.state, 'released')
  assert.equal(after.fencingValid, false)
})

test('observer throws and rejected thenables are contained and never stop the service', async () => {
  const { owner } = createOwner()
  const subscription = await owner.api.watch(resource)
  const kept = []
  subscription.subscribe(() => { throw new Error('listener exploded') })
  subscription.subscribe(() => Promise.reject(new Error('listener rejected')))
  subscription.subscribe((event) => kept.push(event))
  const outcome = await owner.api.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  await settle(kept)
  assert.equal(outcome.ok, true)
  assert.equal(kept.length, 1)
  // the facade itself stays fully operational
  const beat = await owner.api.heartbeat(outcome.handle, { leaseMs: 30_000 })
  assert.equal(beat.ok, true)
})

test('stale callbacks from a disposed subscription cannot publish into a newer observer', async () => {
  const { owner } = createOwner()
  const first = await owner.api.watch(resource)
  const firstEvents = []
  first.subscribe((event) => firstEvents.push(event))
  first.dispose()
  const second = await owner.api.watch(resource)
  const secondEvents = []
  second.subscribe((event) => secondEvents.push(event))
  await owner.api.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  await settle([firstEvents, secondEvents])
  assert.equal(firstEvents.length, 0)
  assert.equal(secondEvents.length, 1)
})

test('watch on an unsupported backend reports the limitation explicitly, never silence-as-healthy', async () => {
  const clock = fakeClock()
  const ctx = {
    get(name) {
      if (name === 'storage') {
        return {
          coordinationCapability() {
            return { scope: 'workspace', durability: 'durable', atomicCas: true, atomicTakeover: true, status: 'available' }
          },
          domainUnit: {
            read() { return null },
            write() { return true },
            compareAndSwap() { return false },
          },
        }
      }
      return undefined
    },
  }
  const owner = createCoordinationLease({ ctx, now: clock.now })
  const subscription = await owner.api.watch(resource)
  const events = []
  subscription.subscribe((event) => events.push(event))
  await settle(events)
  assert.equal(events.length, 1)
  assert.equal(events[0].code, 'unsupported')
  assert.equal(events[0].resync, false)
  // an explicit unavailable event, never a fabricated healthy lease
  const availability = await owner.api.availability()
  assert.equal(availability.operations.watch, 'unsupported')
})

test('watch subscription cannot be reused after dispose and is idempotently disposed', async () => {
  const { owner } = createOwner()
  const subscription = await owner.api.watch(resource)
  assert.equal(subscription.dispose(), true)
  assert.equal(subscription.dispose(), false)
  assert.throws(() => subscription.subscribe(() => {}), TypeError)
})

test('abort signal disposes the watch subscription', async () => {
  const { owner } = createOwner()
  const controller = new AbortController()
  const subscription = await owner.api.watch(resource, { signal: controller.signal })
  const events = []
  subscription.subscribe((event) => events.push(event))
  controller.abort()
  await owner.api.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  await settle(events)
  assert.equal(events.length, 0)
})