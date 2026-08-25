/**
 * Backend adapters for the coordination lease facade.
 *
 * The internal adapter contract is capability-oriented and is not exported as
 * a public API: `capabilities / read / acquire / heartbeat / release /
 * takeover / compareAndSet / watch / dispose`. The default adapter is
 * memory-scoped: one serialized operation lane per canonical resource key
 * makes in-process operations atomic for that lane, but the projection always
 * labels it memory-scoped and non-durable and never presents the lane as
 * cross-process locking.
 *
 * A storage-domain bridge is provided for hosts that explicitly report
 * durable scope and atomic operation support; capability is taken only from
 * that report, never inferred from a domain name.
 */
import { randomUUID } from 'node:crypto'
import { deepFreeze } from './deep-freeze.js'
import {
  cloneBoundedPublic,
  COORDINATION_DURABILITY,
  COORDINATION_SCOPES,
  COORDINATION_STATES,
  DEFAULT_LEASE_MS,
  redactLeaseRecord,
  resourceKey,
} from './coordination-normalize.js'

export const MEMORY_BACKEND_ID = 'memory'

const GENERATION_PREFIX = 'gen:'

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function read(value, key) {
  try {
    return value?.[key]
  } catch {
    return undefined
  }
}

function isThenable(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    && typeof value.then === 'function'
}

export function createUuidFactory() {
  return () => randomUUID()
}

function createSerialLane() {
  let tail = Promise.resolve()
  return {
    run(fn) {
      const next = tail.then(() => fn())
      tail = next.then(() => undefined, () => undefined)
      return next
    },
  }
}

function nowIso(now) {
  try {
    const value = typeof now === 'function' ? now() : now
    const date = value instanceof Date ? value : new Date(value)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  } catch {
    // Fall through to a local timestamp.
  }
  return new Date().toISOString()
}

function nowMs(now) {
  const text = nowIso(now)
  const parsed = Date.parse(text)
  return Number.isNaN(parsed) ? Date.now() : parsed
}

function expiresFrom(now, leaseMs) {
  return new Date(nowMs(now) + leaseMs).toISOString()
}

function buildBackend(id, scope, durability, status) {
  return { id, scope, durability, status }
}

function buildHandle(record) {
  return deepFreeze({
    resource: record.resource,
    ownerId: record.ownerId,
    generation: record.generation,
    fencingToken: record.fencingToken,
    expiresAt: record.expiresAt,
    state: record.state,
    backend: cloneBoundedPublic(record.backend),
    provenance: cloneBoundedPublic(record.provenance) ?? [],
  })
}

/**
 * Compare a caller-supplied handle with the current record. Returns the
 * typed mismatch code, or undefined when the handle is the exact active
 * identity of the record. An old-generation handle is always `superseded`
 * before identity fields are compared; a same-generation mismatch is a
 * `stale-holder`.
 */
function matchHandle(record, handle, nowMsValue) {
  if (record.state !== 'active') return record.state
  if (Date.parse(record.expiresAt) <= nowMsValue) return 'expired'
  if (record.generation !== handle.generation) return 'superseded'
  if (record.ownerId !== handle.ownerId || record.fencingToken !== handle.fencingToken) return 'stale-holder'
  return undefined
}

function settledRecord(record, nowMsValue) {
  if (record.state === 'active' && Date.parse(record.expiresAt) <= nowMsValue) {
    return { ...record, state: 'expired' }
  }
  return record
}

function observedOf(record) {
  return { generation: record.generation, version: record.version, state: record.state }
}

function emitChange(watchers, key, { previous, current, reason, epoch, observedAt }) {
  const listeners = watchers.get(key)
  if (!listeners || listeners.size === 0) return
  const event = deepFreeze({
    previous: previous === undefined ? undefined : redactLeaseRecord(previous),
    current: redactLeaseRecord(current),
    generation: current.generation,
    version: current.version,
    expiresAt: current.expiresAt,
    fencingValid: current.state === 'active',
    reason,
    observedAt,
    epoch,
    provenance: cloneBoundedPublic(current.provenance) ?? [],
  })
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch {
      // observer failures are contained per subscription
    }
  }
}

/**
 * Normalize a takeover staleness proof at the adapter boundary: the facade
 * already passes the normalized `{ kind, value }` shape, and callers of the
 * internal adapter may pass the raw `{ generation }` / `{ expiresAt }` /
 * `{ proof }` shape.
 */
function proofOf(expectedProof) {
  if (!isObject(expectedProof)) return { kind: 'proof', value: undefined }
  if (expectedProof.kind === 'generation' || expectedProof.kind === 'expiresAt' || expectedProof.kind === 'proof') {
    return { kind: expectedProof.kind, value: expectedProof.value }
  }
  if (read(expectedProof, 'generation') !== undefined) return { kind: 'generation', value: read(expectedProof, 'generation') }
  if (read(expectedProof, 'expiresAt') !== undefined) return { kind: 'expiresAt', value: read(expectedProof, 'expiresAt') }
  return { kind: 'proof', value: read(expectedProof, 'proof') }
}

/**
 * memory-scoped default adapter. Operations on one canonical resource key are
 * serialized through an in-process lane; the projection never claims durable
 * or cross-process guarantees.
 */
export function createMemoryCoordinationAdapter({ now, idFactory } = {}) {
  const currently = () => nowIso(now)
  const nextId = typeof idFactory === 'function' ? idFactory : createUuidFactory()
  const records = new Map()
  const lanes = new Map()
  const watchers = new Map()
  let epochSeq = 0
  let disposed = false

  const laneFor = (key) => {
    let lane = lanes.get(key)
    if (!lane) {
      lane = createSerialLane()
      lanes.set(key, lane)
    }
    return lane
  }

  const epoch = () => `epoch:${epochSeq}`

  /**
   * Generation is a resource-local monotonic sequence: strictly increasing
   * within the same canonical resource (via the internal `seq` carried on the
   * previous record), never comparable across resources, and opaque to
   * callers.
   */
  const buildRecord = (resource, ownerId, leaseMs, provenance, previous) => {
    const sequence = previous && Number.isInteger(previous.seq) ? previous.seq + 1 : 1
    return {
      resource,
      ownerId,
      generation: `${GENERATION_PREFIX}${String(sequence).padStart(12, '0')}`,
      seq: sequence,
      fencingToken: nextId(),
      expiresAt: expiresFrom(currently(), leaseMs),
      state: 'active',
      version: 0,
      value: undefined,
      provenance: provenance ?? [],
      backend: buildBackend(MEMORY_BACKEND_ID, 'process', 'memory', 'available'),
      updatedAt: currently(),
    }
  }

  const failSafe = (error) => ({ ok: false, code: 'unavailable', reason: 'backend error' })

  const acquire = ({ resource, ownerId, leaseMs, provenance }) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const key = resourceKey(resource)
    return laneFor(key).run(() => {
      const existing = records.get(key)
      if (existing) {
        const current = settledRecord(existing, nowMs(now))
        if (current.state === 'active') {
          return { ok: false, code: 'conflict', observed: observedOf(current) }
        }
      }
      const record = buildRecord(resource, ownerId, leaseMs, provenance, existing)
      records.set(key, record)
      ++epochSeq
      emitChange(watchers, key, {
        previous: existing,
        current: record,
        reason: 'acquired',
        epoch: epoch(),
        observedAt: currently(),
      })
      return { ok: true, handle: buildHandle(record) }
    }).catch(failSafe)
  }

  const heartbeat = ({ resource, handle, leaseMs }) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const key = resourceKey(resource)
    return laneFor(key).run(() => {
      const existing = records.get(key)
      if (!existing) return { ok: false, code: 'expired' }
      const current = settledRecord(existing, nowMs(now))
      const mismatch = matchHandle(current, handle, nowMs(now))
      if (mismatch) return { ok: false, code: mismatch, observed: observedOf(current) }
      const before = { ...current }
      current.expiresAt = expiresFrom(currently(), leaseMs ?? DEFAULT_LEASE_MS)
      current.updatedAt = currently()
      ++epochSeq
      emitChange(watchers, key, {
        previous: before,
        current,
        reason: 'heartbeated',
        epoch: epoch(),
        observedAt: currently(),
      })
      return { ok: true, handle: buildHandle(current) }
    }).catch(failSafe)
  }

  const release = ({ resource, handle }) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const key = resourceKey(resource)
    return laneFor(key).run(() => {
      const existing = records.get(key)
      if (!existing) return { ok: false, code: 'released' }
      const current = settledRecord(existing, nowMs(now))
      if (current.state === 'released') {
        // Idempotent no-op for a repeat disposer of the same generation; an
        // unrelated handle cannot affect the released record.
        if (current.ownerId === handle.ownerId
          && current.generation === handle.generation
          && current.fencingToken === handle.fencingToken) {
          return { ok: true, code: 'released' }
        }
        return { ok: false, code: 'released' }
      }
      const mismatch = matchHandle(current, handle, nowMs(now))
      if (mismatch) return { ok: false, code: mismatch, observed: observedOf(current) }
      const before = { ...current }
      current.state = 'released'
      current.updatedAt = currently()
      ++epochSeq
      emitChange(watchers, key, {
        previous: before,
        current,
        reason: 'released',
        epoch: epoch(),
        observedAt: currently(),
      })
      return { ok: true, code: 'released', record: current }
    }).catch(failSafe)
  }

  const takeover = ({ resource, ownerId, leaseMs, expectedProof, reason, provenance }) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const key = resourceKey(resource)
    return laneFor(key).run(() => {
      const existing = records.get(key)
      // A resource with no record has nothing to take over; the same stable
      // code as every other unverifiable state.
      if (!existing) return { ok: false, code: 'unavailable' }
      const current = settledRecord(existing, nowMs(now))
      const proof = proofOf(expectedProof)
      if (proof.kind === 'proof') {
        // The memory backend issues no staleness proofs.
        return { ok: false, code: 'unsupported', observed: observedOf(current) }
      }
      const proofMatches = proof.kind === 'generation'
        ? current.generation === proof.value
        : current.expiresAt === proof.value
      if (!proofMatches) return { ok: false, code: 'conflict', observed: observedOf(current) }
      const takeoverProvenance = []
      if (reason) takeoverProvenance.push({ kind: 'reason', id: reason, certainty: 'observed' })
      takeoverProvenance.push({ kind: 'takeover', id: current.generation, certainty: 'observed' })
      const record = buildRecord(
        resource,
        ownerId,
        leaseMs,
        [...(provenance ?? []), ...takeoverProvenance],
        current,
      )
      records.set(key, record)
      ++epochSeq
      emitChange(watchers, key, {
        previous: current,
        current: record,
        reason: 'taken-over',
        epoch: epoch(),
        observedAt: currently(),
      })
      return { ok: true, handle: buildHandle(record) }
    }).catch(failSafe)
  }

  const compareAndSet = ({ resource, handle, expectedVersion, value }) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const key = resourceKey(resource)
    return laneFor(key).run(() => {
      const existing = records.get(key)
      if (!existing) return { ok: false, code: 'expired' }
      const current = settledRecord(existing, nowMs(now))
      const mismatch = matchHandle(current, handle, nowMs(now))
      if (mismatch) return { ok: false, code: mismatch, observed: observedOf(current) }
      if (current.version !== expectedVersion) {
        return { ok: false, code: 'compare-conflict', observed: observedOf(current) }
      }
      const before = { ...current }
      current.value = cloneBoundedPublic(value)
      current.version += 1
      current.updatedAt = currently()
      ++epochSeq
      emitChange(watchers, key, {
        previous: before,
        current,
        reason: 'value-updated',
        epoch: epoch(),
        observedAt: currently(),
      })
      return { ok: true, version: current.version, handle: buildHandle(current) }
    }).catch(failSafe)
  }

  const watch = ({ resource }) => {
    if (disposed) return { code: 'unsupported' }
    const key = resourceKey(resource)
    return {
      subscribe(fn) {
        if (typeof fn !== 'function') return () => false
        const listeners = watchers.get(key) ?? new Set()
        watchers.set(key, listeners)
        listeners.add(fn)
        let active = true
        return () => {
          if (!active) return false
          active = false
          return listeners.delete(fn)
        }
      },
    }
  }

  const read = (resource) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const existing = records.get(resourceKey(resource))
    if (!existing) return Promise.resolve({ ok: false, code: 'unavailable' })
    return Promise.resolve({ ok: true, record: settledRecord(existing, nowMs(now)) })
  }

  const dispose = () => {
    if (disposed) return false
    disposed = true
    records.clear()
    lanes.clear()
    watchers.clear()
    return true
  }

  return {
    capabilities() {
      return {
        scope: 'process',
        durability: 'memory',
        atomicCas: true,
        atomicTakeover: true,
        watch: true,
        status: 'available',
        backendId: MEMORY_BACKEND_ID,
      }
    },
    read,
    acquire,
    heartbeat,
    release,
    takeover,
    compareAndSet,
    watch,
    dispose,
  }
}

function normalizeBridgeCapabilities(capabilityReport) {
  if (!isObject(capabilityReport)) {
    return { scope: 'process', durability: 'unknown', atomicCas: false, atomicTakeover: false, watch: false, status: 'unknown' }
  }
  const scope = read(capabilityReport, 'scope')
  const durability = read(capabilityReport, 'durability')
  return {
    scope: COORDINATION_SCOPES.includes(scope) ? scope : 'process',
    durability: COORDINATION_DURABILITY.includes(durability) ? durability : 'unknown',
    atomicCas: read(capabilityReport, 'atomicCas') === true,
    atomicTakeover: read(capabilityReport, 'atomicTakeover') === true,
    watch: false,
    status: read(capabilityReport, 'status') === 'available' ? 'available' : 'unknown',
  }
}

/**
 * Storage-domain bridge adapter. It persists records through a domain unit
 * only when the host explicitly reported the capability: durability comes
 * from the report, atomic takeover/CAS come from a reported
 * compare-and-swap primitive, and an unconfirmed capability is returned as
 * explicit `unsupported`/`unavailable`/`unknown` — never emulated.
 */
export function createStorageDomainCoordinationAdapter({ unit, capabilityReport, now, idFactory } = {}) {
  if (!isObject(unit) || typeof unit.read !== 'function' || typeof unit.write !== 'function') {
    throw new TypeError('storage-domain coordination adapter requires a domain unit with read/write')
  }
  const caps = normalizeBridgeCapabilities(capabilityReport)
  const nextId = typeof idFactory === 'function' ? idFactory : createUuidFactory()
  const lanes = new Map()
  let epochSeq = 0
  let disposed = false

  const laneFor = (key) => {
    let lane = lanes.get(key)
    if (!lane) {
      lane = createSerialLane()
      lanes.set(key, lane)
    }
    return lane
  }
  const domainKey = (resource) => `coordination:${resourceKey(resource)}`
  const epoch = () => `epoch:${epochSeq}`
  const failSafe = () => ({ ok: false, code: 'unavailable', reason: 'backend error' })

  const unitRead = (key) => {
    const result = unit.read(key)
    if (isThenable(result)) return { ok: false, code: 'unknown' }
    const record = isObject(result) ? result : null
    if (!record) return { ok: false, code: 'unavailable' }
    if (!COORDINATION_STATES.includes(record.state) || typeof record.version !== 'number') {
      return { ok: false, code: 'unknown' }
    }
    return { ok: true, record: { ...record, backend: buildBackend('storage-domain', caps.scope, caps.durability, caps.status) } }
  }

  const unitWrite = (key, record) => {
    try {
      const result = unit.write(key, record)
      if (isThenable(result)) return { ok: false, code: 'unknown' }
      return { ok: true }
    } catch {
      return { ok: false, code: 'unavailable' }
    }
  }

  const unitCompareAndSwap = (key, expectedVersion, record) => {
    if (typeof unit.compareAndSwap !== 'function') return { ok: false, code: 'unsupported' }
    try {
      const result = unit.compareAndSwap(key, expectedVersion, record)
      if (isThenable(result)) return { ok: false, code: 'unknown' }
      return result === true ? { ok: true } : { ok: false, code: 'compare-conflict' }
    } catch {
      return { ok: false, code: 'unavailable' }
    }
  }

  /**
   * Generation is a resource-local monotonic sequence. The internal `seq`
   * counter is persisted with the record, so a restarted adapter continues
   * the sequence from the persisted record and never re-mints a generation
   * value that already exists in the durable domain — an old era's proof or
   * heartbeat stays invalid against a newer era record.
   */
  const buildRecord = (resource, ownerId, leaseMs, provenance, previous, state = 'active') => {
    const sequence = previous && Number.isInteger(previous.seq) ? previous.seq + 1 : 1
    return {
      resource,
      ownerId,
      generation: `${GENERATION_PREFIX}${String(sequence).padStart(12, '0')}`,
      seq: sequence,
      fencingToken: nextId(),
      expiresAt: expiresFrom(now, leaseMs),
      state,
      version: 0,
      provenance: provenance ?? [],
      backend: buildBackend('storage-domain', caps.scope, caps.durability, caps.status),
      updatedAt: nowIso(now),
    }
  }

  const acquire = ({ resource, ownerId, leaseMs, provenance }) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const key = domainKey(resource)
    return laneFor(key).run(() => {
      const found = unitRead(key)
      if (found.ok) {
        const current = settledRecord(found.record, nowMs(now))
        if (current.state === 'active') return { ok: false, code: 'conflict', observed: observedOf(current) }
      } else if (found.code !== 'unavailable') {
        return found
      }
      const record = buildRecord(resource, ownerId, leaseMs, provenance, found.ok ? found.record : undefined)
      const written = unitWrite(key, record)
      if (!written.ok) return written
      ++epochSeq
      return { ok: true, handle: buildHandle(record), epoch: epoch() }
    }).catch(failSafe)
  }

  const heartbeat = ({ resource, handle, leaseMs }) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const key = domainKey(resource)
    return laneFor(key).run(() => {
      const found = unitRead(key)
      if (!found.ok) return found
      const current = settledRecord(found.record, nowMs(now))
      const mismatch = matchHandle(current, handle, nowMs(now))
      if (mismatch) return { ok: false, code: mismatch, observed: observedOf(current) }
      current.expiresAt = expiresFrom(now, leaseMs ?? DEFAULT_LEASE_MS)
      const written = unitWrite(key, current)
      if (!written.ok) return written
      ++epochSeq
      return { ok: true, handle: buildHandle(current), epoch: epoch() }
    }).catch(failSafe)
  }

  const release = ({ resource, handle }) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const key = domainKey(resource)
    return laneFor(key).run(() => {
      const found = unitRead(key)
      if (!found.ok) return { ok: false, code: found.code === 'unavailable' ? 'released' : found.code }
      const current = settledRecord(found.record, nowMs(now))
      const mismatch = matchHandle(current, handle, nowMs(now))
      if (mismatch) return { ok: false, code: mismatch, observed: observedOf(current) }
      current.state = 'released'
      const written = unitWrite(key, current)
      if (!written.ok) return written
      ++epochSeq
      return { ok: true, code: 'released', epoch: epoch() }
    }).catch(failSafe)
  }

  const takeover = ({ resource, ownerId, leaseMs, expectedProof, reason, provenance }) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const key = domainKey(resource)
    return laneFor(key).run(() => {
      if (!caps.atomicTakeover) return { ok: false, code: 'unsupported' }
      const found = unitRead(key)
      if (!found.ok) return found
      const current = settledRecord(found.record, nowMs(now))
      const proof = proofOf(expectedProof)
      if (proof.kind === 'proof') {
        const verified = typeof unit.verify === 'function' && unit.verify(proof.value) === true
        if (!verified) return { ok: false, code: 'conflict', observed: observedOf(current) }
      } else {
        const proofMatches = proof.kind === 'generation'
          ? current.generation === proof.value
          : current.expiresAt === proof.value
        if (!proofMatches) return { ok: false, code: 'conflict', observed: observedOf(current) }
      }
      const takeoverProvenance = []
      if (reason) takeoverProvenance.push({ kind: 'reason', id: reason, certainty: 'observed' })
      takeoverProvenance.push({ kind: 'takeover', id: current.generation, certainty: 'observed' })
      const record = buildRecord(resource, ownerId, leaseMs, [...(provenance ?? []), ...takeoverProvenance], current)
      const swapped = unitCompareAndSwap(key, current.version, record)
      if (!swapped.ok) return swapped
      ++epochSeq
      return { ok: true, handle: buildHandle(record), epoch: epoch() }
    }).catch(failSafe)
  }

  const compareAndSet = ({ resource, handle, expectedVersion, value }) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const key = domainKey(resource)
    return laneFor(key).run(() => {
      if (!caps.atomicCas) return { ok: false, code: 'unsupported' }
      const found = unitRead(key)
      if (!found.ok) return found
      const current = settledRecord(found.record, nowMs(now))
      const mismatch = matchHandle(current, handle, nowMs(now))
      if (mismatch) return { ok: false, code: mismatch, observed: observedOf(current) }
      if (current.version !== expectedVersion) {
        return { ok: false, code: 'compare-conflict', observed: observedOf(current) }
      }
      const next = { ...current, value: cloneBoundedPublic(value), version: current.version + 1, updatedAt: nowIso(now) }
      const swapped = unitCompareAndSwap(key, expectedVersion, next)
      if (!swapped.ok) return { ok: false, code: 'compare-conflict', observed: observedOf(current) }
      ++epochSeq
      return { ok: true, version: next.version, handle: buildHandle(next), epoch: epoch() }
    }).catch(failSafe)
  }

  const watch = () => ({ code: 'unsupported' })

  const read = (resource) => {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable' })
    const found = unitRead(domainKey(resource))
    return Promise.resolve(found.ok ? { ok: true, record: settledRecord(found.record, nowMs(now)) } : found)
  }

  const dispose = () => {
    if (disposed) return false
    disposed = true
    lanes.clear()
    return true
  }

  return {
    capabilities() {
      return { ...caps, backendId: 'storage-domain' }
    },
    read,
    acquire,
    heartbeat,
    release,
    takeover,
    compareAndSet,
    watch,
    dispose,
  }
}