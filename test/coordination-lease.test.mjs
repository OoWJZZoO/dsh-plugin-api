import test from 'node:test'
import assert from 'node:assert/strict'
import { createCoordinationLease } from '../lib/coordination-lease.js'
import { MAX_LEASE_MS } from '../lib/coordination-normalize.js'

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

const resource = { scope: 'workspace', key: 'shared-resource' }

test('facade acquire returns a handle with owner, generation, expiry, fencing and backend provenance', async () => {
  const { owner } = createOwner()
  const outcome = await owner.api.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.code, 'acquired')
  assert.equal(outcome.operation, 'acquire')
  assert.equal(outcome.handle.ownerId, 'owner')
  assert.ok(outcome.handle.generation)
  assert.ok(outcome.handle.fencingToken)
  assert.ok(Date.parse(outcome.handle.expiresAt) > START_MS)
  assert.equal(outcome.handle.backend.id, 'memory')
  assert.equal(outcome.handle.backend.durability, 'memory')
  assert.equal(outcome.availability.status, 'available')
  assert.ok(Object.isFrozen(outcome.handle))
  const second = await owner.api.acquire({ resource, ownerId: 'other', leaseMs: 60_000 })
  assert.equal(second.ok, false)
  assert.equal(second.code, 'conflict')
  assert.deepEqual(second.observed, { generation: outcome.handle.generation, version: 0, state: 'active' })
})

test('facade validates input before contacting the backend and never throws typed outcomes', async () => {
  const { owner } = createOwner()
  const invalidDuration = await owner.api.acquire({ resource, ownerId: 'owner', leaseMs: Number.POSITIVE_INFINITY })
  assert.equal(invalidDuration.ok, false)
  assert.equal(invalidDuration.code, 'invalid-input')
  const badResource = await owner.api.acquire({ resource: { scope: 'galaxy', key: 'k' }, ownerId: 'owner', leaseMs: 1000 })
  assert.equal(badResource.code, 'invalid-input')
  const badOwner = await owner.api.acquire({ resource, ownerId: '', leaseMs: 1000 })
  assert.equal(badOwner.code, 'invalid-input')
  const overlong = await owner.api.acquire({ resource, ownerId: 'owner', leaseMs: MAX_LEASE_MS + 1 })
  assert.equal(overlong.code, 'invalid-input')
  const badHeartbeat = await owner.api.heartbeat({ resource, ownerId: 'x' })
  assert.equal(badHeartbeat.ok, false)
  assert.equal(badHeartbeat.code, 'invalid-input')
  const badProvenance = await owner.api.acquire({ resource, ownerId: 'owner', leaseMs: 1_000, provenance: 'not-an-array' })
  assert.equal(badProvenance.code, 'invalid-input')
  const badTakeoverProvenance = await owner.api.takeover({
    resource, ownerId: 'owner', leaseMs: 1_000,
    expectedProof: { generation: 'gen:1' },
    provenance: 42,
  })
  assert.equal(badTakeoverProvenance.code, 'invalid-input')
})

test('facade heartbeat and release follow the typed outcome vocabulary', async () => {
  const { owner, clock } = createOwner()
  const acquired = await owner.api.acquire({ resource, ownerId: 'owner', leaseMs: 10_000 })
  clock.advance(5_000)
  const beat = await owner.api.heartbeat(acquired.handle, { leaseMs: 30_000 })
  assert.equal(beat.ok, true)
  assert.equal(beat.code, 'heartbeated')
  assert.equal(beat.handle.generation, acquired.handle.generation)
  const released = await owner.api.release(beat.handle)
  assert.equal(released.ok, true)
  assert.equal(released.code, 'released')
  const repeat = await owner.api.release(beat.handle)
  assert.equal(repeat.ok, true)
  assert.equal(repeat.code, 'released')
  const after = await owner.api.heartbeat(beat.handle)
  assert.equal(after.ok, false)
  assert.equal(after.code, 'released')
})

test('facade takeover requires exactly one expectedProof member and preserves takeover provenance', async () => {
  const { owner } = createOwner()
  const acquired = await owner.api.acquire({ resource, ownerId: 'owner-a', leaseMs: 60_000 })
  const noProof = await owner.api.takeover({ resource, ownerId: 'owner-b', leaseMs: 60_000 })
  assert.equal(noProof.code, 'invalid-input')
  const twoProofs = await owner.api.takeover({
    resource, ownerId: 'owner-b', leaseMs: 60_000,
    expectedProof: { generation: acquired.handle.generation, expiresAt: acquired.handle.expiresAt },
  })
  assert.equal(twoProofs.code, 'invalid-input')
  const wrong = await owner.api.takeover({
    resource, ownerId: 'owner-b', leaseMs: 60_000,
    expectedProof: { generation: 'gen:forged' },
    reason: 'coordinator decided',
  })
  assert.equal(wrong.ok, false)
  assert.equal(wrong.code, 'conflict')
  const taken = await owner.api.takeover({
    resource, ownerId: 'owner-b', leaseMs: 60_000,
    expectedProof: { generation: acquired.handle.generation },
    reason: 'coordinator decided',
  })
  assert.equal(taken.ok, true)
  assert.equal(taken.handle.ownerId, 'owner-b')
  assert.ok(taken.handle.provenance.some((entry) => entry.kind === 'reason'))
  assert.ok(taken.handle.provenance.some((entry) => entry.kind === 'takeover'))
})

test('facade compareAndSet publishes only with the active fencing token and expected version', async () => {
  const { owner } = createOwner()
  const acquired = await owner.api.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  const forged = await owner.api.compareAndSet({
    resource,
    handle: { ...acquired.handle, fencingToken: 'forged' },
    expectedVersion: 0,
    value: { v: 1 },
  })
  assert.equal(forged.code, 'stale-holder')
  const conflict = await owner.api.compareAndSet({ resource, handle: acquired.handle, expectedVersion: 5, value: { v: 1 } })
  assert.equal(conflict.code, 'compare-conflict')
  assert.equal(conflict.ok, false)
  const ok = await owner.api.compareAndSet({ resource, handle: acquired.handle, expectedVersion: 0, value: { v: 1 } })
  assert.equal(ok.ok, true)
  assert.equal(ok.code, 'cas-ok')
  assert.equal(ok.version, 1)
})

test('facade availability is truthful: memory scope serves process and rejects wider scopes', async () => {
  const { owner } = createOwner()
  const process = await owner.api.availability('process')
  assert.equal(process.status, 'available')
  assert.equal(process.durability, 'memory')
  const wide = await owner.api.availability('workspace')
  assert.equal(wide.status, 'unsupported')
  const invalid = await owner.api.availability('galaxy')
  assert.equal(invalid.status, 'unknown')
  const mountSnapshot = owner.availability
  assert.equal(mountSnapshot.status, 'available')
  assert.equal(mountSnapshot.epoch, process.epoch)
  assert.ok(Object.isFrozen(mountSnapshot))
})

test('facade returns inactive after dispose without contacting the backend', async () => {
  const { owner } = createOwner()
  owner.dispose()
  const outcome = await owner.api.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'inactive')
  const watch = await owner.api.watch(resource)
  assert.equal(watch.code, 'inactive')
  assert.equal(owner.dispose(), false)
})

test('facade selects the durable bridge only when the host explicitly reports the capability', async () => {
  const clock = fakeClock()
  const storage = new Map()
  const unit = {
    read(key) { return storage.get(key) ?? null },
    write(key, record) { storage.set(key, record); return true },
    compareAndSwap(key, expectedVersion, record) {
      if (storage.get(key)?.version !== expectedVersion) return false
      storage.set(key, record)
      return true
    },
  }
  const ctx = {
    get(name) {
      if (name === 'storage') {
        return {
          coordinationCapability() {
            return { scope: 'workspace', durability: 'durable', atomicCas: true, atomicTakeover: true, status: 'available' }
          },
          domainUnit: unit,
        }
      }
      return undefined
    },
  }
  const owner = createCoordinationLease({ ctx, now: clock.now })
  const outcome = await owner.api.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.handle.backend.id, 'storage-domain')
  assert.equal(outcome.handle.backend.durability, 'durable')
  assert.ok(storage.has('coordination:workspace:shared-resource'))
  const availability = await owner.api.availability()
  assert.equal(availability.status, 'available')
  assert.equal(availability.durability, 'durable')
})

test('facade degrades to the memory backend when the host report is broken', async () => {
  const clock = fakeClock()
  const ctx = {
    get(name) {
      if (name === 'storage') {
        return {
          coordinationCapability() { throw new Error('boom') },
          domainUnit: null,
        }
      }
      return undefined
    },
  }
  const owner = createCoordinationLease({ ctx, now: clock.now })
  const outcome = await owner.api.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.handle.backend.id, 'memory')
})

test('facade backend failures surface as typed unavailable and never escape', async () => {
  const clock = fakeClock()
  const ctx = {
    get(name) {
      if (name === 'storage') {
        return {
          coordinationCapability() {
            return { scope: 'workspace', durability: 'durable', atomicCas: true, atomicTakeover: true, status: 'available' }
          },
          domainUnit: {
            read() { throw new Error('backend exploded') },
            write() { throw new Error('backend exploded') },
            compareAndSwap() { throw new Error('backend exploded') },
          },
        }
      }
      return undefined
    },
  }
  const owner = createCoordinationLease({ ctx, now: clock.now })
  const outcome = await owner.api.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'unavailable')
  assert.equal(outcome.availability.status, 'available')
})

test('facade provenance from sibling surfaces is preserved and never minted', async () => {
  const { owner } = createOwner()
  const outcome = await owner.api.acquire({
    resource,
    ownerId: 'owner',
    leaseMs: 60_000,
    provenance: [
      { kind: 'execution', id: 'e-1', certainty: 'observed' },
      { kind: 'task', id: 't-2', certainty: 'observed' },
    ],
  })
  assert.equal(outcome.ok, true)
  const ids = outcome.handle.provenance.map((entry) => entry.id)
  assert.ok(ids.includes('e-1'))
  assert.ok(ids.includes('t-2'))
})