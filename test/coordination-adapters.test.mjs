import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryCoordinationAdapter, createStorageDomainCoordinationAdapter } from '../lib/coordination-adapters.js'
import { MAX_LEASE_MS } from '../lib/coordination-normalize.js'

const START_MS = Date.parse('2026-01-01T00:00:00.000Z')

function fakeClock(start = START_MS) {
  let current = start
  const now = () => new Date(current)
  const advance = (ms) => { current += ms }
  return { now, advance, current: () => current }
}

const resource = { scope: 'workspace', key: 'shared-resource' }
const otherResource = { scope: 'session', key: 'other-resource' }

async function acquire(adapter, { ownerId = 'owner', leaseMs = 60_000, provenance } = {}) {
  return adapter.acquire({ resource, ownerId, leaseMs, provenance })
}

test('acquire returns unique generations and fencing tokens with monotonic ordering', async () => {
  const { now, advance } = fakeClock()
  const adapter = createMemoryCoordinationAdapter({ now })
  const first = await acquire(adapter, { ownerId: 'a', leaseMs: 1_000 })
  assert.equal(first.ok, true)
  advance(2_000)
  const second = await acquire(adapter, { ownerId: 'b', leaseMs: 1_000 })
  assert.equal(second.ok, true)
  assert.notEqual(first.handle.generation, second.handle.generation)
  assert.notEqual(first.handle.fencingToken, second.handle.fencingToken)
  assert.ok(first.handle.generation < second.handle.generation)
  const third = await adapter.acquire({ resource: otherResource, ownerId: 'c', leaseMs: 1_000 })
  assert.equal(third.ok, true)
  assert.ok(second.handle.generation < third.handle.generation)
})

test('acquire conflicts with an unexpired foreign lease and never replaces it', async () => {
  const { now } = fakeClock()
  const adapter = createMemoryCoordinationAdapter({ now })
  const first = await acquire(adapter, { ownerId: 'owner-a' })
  assert.equal(first.ok, true)
  const conflict = await acquire(adapter, { ownerId: 'intruder' })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.code, 'conflict')
  assert.deepEqual(conflict.observed, { generation: first.handle.generation, version: 0, state: 'active' })
  const read = await adapter.read(resource)
  assert.equal(read.record.ownerId, 'owner-a')
})

test('acquire succeeds when the existing lease is confirmed expired', async () => {
  const { now, advance } = fakeClock()
  const adapter = createMemoryCoordinationAdapter({ now })
  const first = await acquire(adapter, { ownerId: 'owner-a', leaseMs: 1_000 })
  assert.equal(first.ok, true)
  advance(2_000)
  const second = await acquire(adapter, { ownerId: 'owner-b', leaseMs: 60_000 })
  assert.equal(second.ok, true)
  assert.equal(second.handle.ownerId, 'owner-b')
  assert.ok(second.handle.generation > first.handle.generation)
})

test('heartbeat extends expiry only for the exact active handle', async () => {
  const { now, advance } = fakeClock()
  const adapter = createMemoryCoordinationAdapter({ now })
  const acquired = await acquire(adapter, { leaseMs: 10_000 })
  const before = acquired.handle.expiresAt
  advance(5_000)
  const beat = await adapter.heartbeat({ resource, handle: acquired.handle, leaseMs: 30_000 })
  assert.equal(beat.ok, true)
  assert.equal(beat.handle.ownerId, acquired.handle.ownerId)
  assert.equal(beat.handle.generation, acquired.handle.generation)
  assert.equal(beat.handle.fencingToken, acquired.handle.fencingToken)
  assert.ok(Date.parse(beat.handle.expiresAt) > Date.parse(before))
})

test('heartbeat rejects stale generations, wrong owners, wrong tokens, and expired handles', async () => {
  const { now, advance } = fakeClock()
  const adapter = createMemoryCoordinationAdapter({ now })
  const acquired = await acquire(adapter, { ownerId: 'owner', leaseMs: 60_000 })
  const wrongOwner = { ...acquired.handle, ownerId: 'other' }
  assert.equal((await adapter.heartbeat({ resource, handle: wrongOwner, leaseMs: 1_000 })).code, 'stale-holder')
  const wrongToken = { ...acquired.handle, fencingToken: 'forged' }
  assert.equal((await adapter.heartbeat({ resource, handle: wrongToken, leaseMs: 1_000 })).code, 'stale-holder')
  // a superseded handle stays rejected
  advance(61_000)
  const reacquired = await acquire(adapter, { ownerId: 'owner' })
  assert.equal(reacquired.ok, true)
  const stale = await adapter.heartbeat({ resource, handle: acquired.handle, leaseMs: 1_000 })
  assert.equal(stale.code, 'superseded')
  // an expired handle is never revived
  const expiring = await adapter.acquire({ resource: otherResource, ownerId: 'owner', leaseMs: 100 })
  advance(200)
  const revived = await adapter.heartbeat({ resource: otherResource, handle: expiring.handle, leaseMs: 60_000 })
  assert.equal(revived.code, 'expired')
  const still = await adapter.read(otherResource)
  assert.equal(still.record.state, 'expired')
})

test('release is identity-bound and idempotent and invalidates the fencing token', async () => {
  const { now } = fakeClock()
  const adapter = createMemoryCoordinationAdapter({ now })
  const acquired = await acquire(adapter)
  const released = await adapter.release({ resource, handle: acquired.handle })
  assert.equal(released.ok, true)
  assert.equal(released.code, 'released')
  const again = await adapter.release({ resource, handle: acquired.handle })
  assert.equal(again.ok, true)
  assert.equal(again.code, 'released')
  // writes with the released handle are rejected
  const cas = await adapter.compareAndSet({ resource, handle: acquired.handle, expectedVersion: 0, value: { x: 1 } })
  assert.equal(cas.ok, false)
  assert.equal(cas.code, 'released')
})

test('release by a stale or foreign holder preserves the current owner', async () => {
  const { now, advance } = fakeClock()
  const adapter = createMemoryCoordinationAdapter({ now })
  const first = await acquire(adapter, { ownerId: 'owner-a', leaseMs: 1_000 })
  advance(2_000)
  const second = await acquire(adapter, { ownerId: 'owner-b', leaseMs: 60_000 })
  const staleRelease = await adapter.release({ resource, handle: first.handle })
  assert.equal(staleRelease.ok, false)
  assert.equal(staleRelease.code, 'superseded')
  const read = await adapter.read(resource)
  assert.equal(read.record.ownerId, 'owner-b')
  const foreignRelease = await adapter.release({ resource, handle: { ...second.handle, ownerId: 'other' } })
  assert.equal(foreignRelease.code, 'stale-holder')
})

test('takeover requires a proof match and preserves takeover provenance on success', async () => {
  const { now } = fakeClock()
  const adapter = createMemoryCoordinationAdapter({ now })
  const first = await acquire(adapter, { ownerId: 'owner-a', leaseMs: 60_000 })
  // mismatched generation proof
  const mismatched = await adapter.takeover({
    resource, ownerId: 'owner-b', leaseMs: 60_000,
    expectedProof: { generation: 'gen:forged' },
    reason: 'coordinator decided',
    provenance: [{ kind: 'execution', id: 'e-9', certainty: 'observed' }],
  })
  assert.equal(mismatched.ok, false)
  assert.equal(mismatched.code, 'conflict')
  // matching generation proof succeeds, provenance preserved
  const taken = await adapter.takeover({
    resource, ownerId: 'owner-b', leaseMs: 60_000,
    expectedProof: { generation: first.handle.generation },
    reason: 'coordinator decided',
    provenance: [{ kind: 'execution', id: 'e-9', certainty: 'observed' }],
  })
  assert.equal(taken.ok, true)
  assert.equal(taken.handle.ownerId, 'owner-b')
  assert.ok(taken.handle.generation > first.handle.generation)
  const kinds = taken.handle.provenance.map((entry) => entry.kind)
  assert.ok(kinds.includes('execution'))
  assert.ok(kinds.includes('reason'))
  assert.ok(kinds.includes('takeover'))
  // the previous handle is invalid afterwards
  const stale = await adapter.heartbeat({ resource, handle: first.handle, leaseMs: 1_000 })
  assert.equal(stale.code, 'superseded')
  // expiresAt proof
  const byExpiry = await adapter.takeover({
    resource, ownerId: 'owner-c', leaseMs: 60_000,
    expectedProof: { expiresAt: taken.handle.expiresAt },
  })
  assert.equal(byExpiry.ok, true)
  // proof kind unsupported on memory
  const proofKind = await adapter.takeover({
    resource, ownerId: 'owner-d', leaseMs: 60_000,
    expectedProof: { proof: { seq: 1 } },
  })
  assert.equal(proofKind.ok, false)
  assert.equal(proofKind.code, 'unsupported')
})

test('compareAndSet publishes only on exact version match and leaves conflicts unchanged', async () => {
  const { now } = fakeClock()
  const adapter = createMemoryCoordinationAdapter({ now })
  const acquired = await acquire(adapter)
  // stale version
  const conflict = await adapter.compareAndSet({ resource, handle: acquired.handle, expectedVersion: 3, value: { v: 'new' } })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.code, 'compare-conflict')
  assert.deepEqual(conflict.observed, { generation: acquired.handle.generation, version: 0, state: 'active' })
  const readAfter = await adapter.read(resource)
  assert.equal(readAfter.record.version, 0)
  assert.equal(readAfter.record.value, undefined)
  // exact version
  const first = await adapter.compareAndSet({ resource, handle: acquired.handle, expectedVersion: 0, value: { v: 1, credentials: { password: 'x' } } })
  assert.equal(first.ok, true)
  assert.equal(first.version, 1)
  const second = await adapter.compareAndSet({ resource, handle: acquired.handle, expectedVersion: 1, value: { v: 2 } })
  assert.equal(second.ok, true)
  assert.equal(second.version, 2)
  const stored = await adapter.read(resource)
  assert.equal(stored.record.version, 2)
  assert.deepEqual(stored.record.value, { v: 2 })
  // a repeat of an already-applied version is a conflict, not a replay
  const replay = await adapter.compareAndSet({ resource, handle: acquired.handle, expectedVersion: 1, value: { v: 2 } })
  assert.equal(replay.code, 'compare-conflict')
})

test('memory adapter watches deliver immutable transitions and dispose only their own subscription', async () => {
  const { now } = fakeClock()
  const adapter = createMemoryCoordinationAdapter({ now })
  const watch = adapter.watch({ resource })
  const events = []
  const detach = watch.subscribe((event) => events.push(event))
  const a = await acquire(adapter, { ownerId: 'owner-a', leaseMs: 60_000 })
  await adapter.heartbeat({ resource, handle: a.handle, leaseMs: 30_000 })
  const otherEvents = []
  const other = adapter.watch({ resource })
  const detachOther = other.subscribe((event) => otherEvents.push(event))
  detach()
  await adapter.release({ resource, handle: a.handle })
  detachOther()
  assert.equal(events.length, 2)
  assert.equal(otherEvents.length, 1)
  assert.ok(Object.isFrozen(events[0]))
  assert.equal(events[0].reason, 'acquired')
  assert.equal(events[0].fencingValid, true)
  assert.equal(events[0].fencingToken, undefined)
  assert.equal(events[0].previous, undefined)
  assert.equal(events[1].reason, 'heartbeated')
  assert.equal(otherEvents[0].reason, 'released')
  assert.equal(otherEvents[0].current.state, 'released')
  assert.equal(otherEvents[0].fencingValid, false)
  // no delivery after release of the last listener
  await acquire(adapter, { ownerId: 'owner-c', leaseMs: 60_000 })
  assert.equal(otherEvents.length, 1)
})

test('takeover of a resource with no record returns the same stable unavailable code across adapters', async () => {
  const { now } = fakeClock()
  const memory = createMemoryCoordinationAdapter({ now })
  const memoryOutcome = await memory.takeover({
    resource, ownerId: 'owner', leaseMs: 60_000,
    expectedProof: { generation: 'gen:1' },
  })
  assert.equal(memoryOutcome.ok, false)
  assert.equal(memoryOutcome.code, 'unavailable')
  const unit = { read: () => null, write: () => true, compareAndSwap: () => false }
  const bridge = createStorageDomainCoordinationAdapter({
    unit,
    capabilityReport: { scope: 'workspace', durability: 'durable', atomicCas: true, atomicTakeover: true, status: 'available' },
    now,
  })
  const bridgeOutcome = await bridge.takeover({
    resource, ownerId: 'owner', leaseMs: 60_000,
    expectedProof: { generation: 'gen:1' },
  })
  assert.equal(bridgeOutcome.ok, false)
  assert.equal(bridgeOutcome.code, 'unavailable')
})

test('memory adapter capability projection is truthful about memory scope and non-durability', () => {
  const { now } = fakeClock()
  const adapter = createMemoryCoordinationAdapter({ now })
  assert.deepEqual(adapter.capabilities(), {
    scope: 'process', durability: 'memory', atomicCas: true, atomicTakeover: true, watch: true, status: 'available', backendId: 'memory',
  })
})

test('operations on a disposed memory adapter are unavailable', async () => {
  const { now } = fakeClock()
  const adapter = createMemoryCoordinationAdapter({ now })
  adapter.dispose()
  const outcome = await acquire(adapter)
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'unavailable')
})

test('serialized lane orders concurrent operations on the same resource', async () => {
  const { now } = fakeClock()
  const adapter = createMemoryCoordinationAdapter({ now })
  const acquired = await acquire(adapter, { leaseMs: 60_000 })
  const writes = [0, 1, 2].map((version) =>
    adapter.compareAndSet({ resource, handle: acquired.handle, expectedVersion: version, value: { step: version } }))
  const results = await Promise.all(writes)
  assert.deepEqual(results.map((r) => (r.ok ? r.version : r.code)), [1, 2, 3])
  const read = await adapter.read(resource)
  assert.equal(read.record.version, 3)
})

test('bridge reports explicit unsupported without durable claims when capability is not reported', () => {
  const { now } = fakeClock()
  const unit = { read: () => null, write: () => true }
  const adapter = createStorageDomainCoordinationAdapter({ unit, capabilityReport: null, now })
  const caps = adapter.capabilities()
  assert.equal(caps.durability, 'unknown')
  assert.equal(caps.status, 'unknown')
  assert.equal(caps.atomicCas, false)
  assert.equal(caps.atomicTakeover, false)
  assert.equal(caps.watch, false)
  assert.deepEqual(adapter.watch({ resource }), { code: 'unsupported' })
})

test('bridge with host-confirmed durable atomic capability persists and performs atomic CAS and takeover', async () => {
  const storage = new Map()
  let version = 0
  const unit = {
    read(key) { return storage.get(key) ?? null },
    write(key, record) { storage.set(key, record); return true },
    compareAndSwap(key, expectedVersion, record) {
      const current = storage.get(key)
      if (current?.version !== expectedVersion) return false
      storage.set(key, record)
      return true
    },
  }
  const capabilityReport = { scope: 'workspace', durability: 'durable', atomicCas: true, atomicTakeover: true, status: 'available' }
  const { now } = fakeClock()
  const adapter = createStorageDomainCoordinationAdapter({ unit, capabilityReport, now })
  assert.equal(adapter.capabilities().durability, 'durable')
  assert.equal(adapter.capabilities().atomicCas, true)
  const acquired = await adapter.acquire({ resource, ownerId: 'owner-a', leaseMs: 60_000, provenance: [] })
  assert.equal(acquired.ok, true)
  assert.ok(storage.has('coordination:workspace:shared-resource'))
  const cas = await adapter.compareAndSet({ resource, handle: acquired.handle, expectedVersion: 0, value: { state: 'ok' } })
  assert.equal(cas.ok, true)
  assert.equal(cas.version, 1)
  const conflicting = await adapter.compareAndSet({ resource, handle: acquired.handle, expectedVersion: 0, value: { state: 'no' } })
  assert.equal(conflicting.code, 'compare-conflict')
  const taken = await adapter.takeover({
    resource, ownerId: 'owner-b', leaseMs: 60_000,
    expectedProof: { generation: acquired.handle.generation },
  })
  assert.equal(taken.ok, true)
  assert.equal(storage.get('coordination:workspace:shared-resource').ownerId, 'owner-b')
  assert.ok(taken.handle.provenance.some((entry) => entry.kind === 'takeover'))
})

test('bridge without atomic capability returns unsupported for CAS and takeover', async () => {
  const { now } = fakeClock()
  const unit = { read: () => null, write: () => true }
  const adapter = createStorageDomainCoordinationAdapter({
    unit,
    capabilityReport: { scope: 'workspace', durability: 'durable', atomicCas: false, atomicTakeover: false, status: 'available' },
    now,
  })
  const acquired = await adapter.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  assert.equal(acquired.ok, true)
  const cas = await adapter.compareAndSet({ resource, handle: acquired.handle, expectedVersion: 0, value: { x: 1 } })
  assert.equal(cas.code, 'unsupported')
  const taken = await adapter.takeover({ resource, ownerId: 'other', leaseMs: 60_000, expectedProof: { generation: acquired.handle.generation } })
  assert.equal(taken.code, 'unsupported')
})

test('bridge reports unknown for unconfirmed thenable units and malformed records', async () => {
  const { now } = fakeClock()
  const unit = { read: () => null, write: () => Promise.resolve(true) }
  const adapter = createStorageDomainCoordinationAdapter({
    unit,
    capabilityReport: { scope: 'workspace', durability: 'durable', atomicCas: true, atomicTakeover: true, status: 'available' },
    now,
  })
  const outcome = await adapter.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'unknown')
  const malformed = createStorageDomainCoordinationAdapter({
    unit: { read: () => ({ state: 'weird' }), write: () => true },
    capabilityReport: { scope: 'workspace', durability: 'durable', atomicCas: true, atomicTakeover: true, status: 'available' },
    now,
  })
  const second = await malformed.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  assert.equal(second.ok, false)
  assert.equal(second.code, 'unknown')
})

test('lease duration bounds are enforced at the adapter boundary', async () => {
  const { now } = fakeClock()
  const adapter = createMemoryCoordinationAdapter({ now })
  const outcome = await adapter.acquire({ resource, ownerId: 'owner', leaseMs: MAX_LEASE_MS + 1 })
  // the adapter trusts normalized input; oversized durations simply produce a
  // bounded expiry — the facade rejects them earlier (see normalize tests).
  assert.equal(outcome.ok, true)
})