/**
 * Pure, dependency-free normalization and validation for the coordination
 * lease facade.
 *
 * This module owns the bounded identity vocabulary (resource scope/key,
 * owner, lease duration, takeover proof, provenance), the availability
 * projection builder, and the bounded redaction/clone helpers. It never
 * touches a service, a clock, or a backend: every function returns
 * `{ ok: true, value }` or `{ ok: false, reason }` and never throws.
 */
import { deepFreeze } from './deep-freeze.js'

export const COORDINATION_SCOPES = Object.freeze(['session', 'workspace', 'profile', 'process'])
export const COORDINATION_STATES = Object.freeze(['active', 'expired', 'released', 'superseded', 'uncertain'])
export const COORDINATION_STATUSES = Object.freeze(['available', 'unavailable', 'unsupported', 'unknown'])
export const COORDINATION_OPERATIONS = Object.freeze([
  'acquire',
  'heartbeat',
  'release',
  'takeover',
  'compareAndSet',
  'watch',
])
export const COORDINATION_DURABILITY = Object.freeze(['durable', 'session', 'workspace', 'memory', 'unknown'])
export const COORDINATION_CERTAINTY = Object.freeze(['observed', 'served', 'stale', 'unavailable', 'unknown'])
export const COORDINATION_PROOF_KINDS = Object.freeze(['generation', 'expiresAt', 'proof'])

/** Maximum accepted lease duration (31 days). Unbounded durations are rejected. */
export const MAX_LEASE_MS = 31 * 24 * 60 * 60 * 1000
export const DEFAULT_LEASE_MS = 60 * 1000

export const MAX_STRING = 160
export const MAX_ID = 120
export const MAX_COLLECTION = 32
export const MAX_DEPTH = 5

/** Keys that carry credential-like content and never cross the public boundary. */
const SECRET_KEY = /(?:prompt|credential|password|secret|authorization|request.?body|private.?cause|stack|content)/i

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

function safeKeys(value) {
  try {
    return Object.keys(value)
  } catch {
    return []
  }
}

export function boundedString(value, max = MAX_STRING) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  return text ? text.slice(0, max) : undefined
}

function okValue(value) {
  return { ok: true, value }
}

function badValue(reason) {
  return { ok: false, reason }
}

/**
 * Normalize a resource identity. Scope + canonical key are the identity; a
 * display label is never used for lookup and never participates in equality.
 */
export function normalizeResource(input) {
  if (!isObject(input)) return badValue('resource must be an object')
  const scope = boundedString(read(input, 'scope'), 40)
  if (!scope || !COORDINATION_SCOPES.includes(scope)) return badValue('resource scope is invalid')
  const key = boundedString(read(input, 'key'), MAX_ID)
  if (!key) return badValue('resource key must be a non-empty string')
  const label = boundedString(read(input, 'label'), MAX_STRING)
  const provenance = normalizeProvenance(read(input, 'provenance'))
  if (!provenance.ok) return provenance
  const resource = { scope, key }
  if (label !== undefined) resource.label = label
  if (provenance.value.length > 0) resource.provenance = provenance.value
  return okValue(deepFreeze(resource))
}

/**
 * Canonical in-process key for a normalized resource. Two resources are the
 * same coordination target exactly when scope and key are equal.
 */
export function resourceKey(resource) {
  if (!isObject(resource)) return ''
  const scope = boundedString(read(resource, 'scope'), 40)
  const key = boundedString(read(resource, 'key'), MAX_ID)
  return scope && key ? `${scope}:${key}` : ''
}

export function normalizeOwnerId(value) {
  const ownerId = boundedString(value, MAX_ID)
  return ownerId ? okValue(ownerId) : badValue('owner identity must be a non-empty string')
}

/**
 * Lease duration must be finite, positive, and bounded. Negative, zero,
 * unbounded, and non-finite durations are rejected before acquisition.
 */
export function normalizeLeaseMs(value, { allowUndefined = false } = {}) {
  if (value === undefined && allowUndefined) return okValue(undefined)
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_LEASE_MS) {
    return badValue('lease duration must be a finite positive number within the supported bound')
  }
  return okValue(value)
}

/**
 * Takeover requires exactly one staleness proof: `{ generation }`,
 * `{ expiresAt }`, or a backend-supplied `{ proof }`. Omitting it or
 * supplying more than one member is invalid input.
 */
export function normalizeExpectedProof(input) {
  if (!isObject(input)) return badValue('expectedProof must be an object with exactly one staleness proof')
  const kinds = safeKeys(input).filter((key) => COORDINATION_PROOF_KINDS.includes(key))
  if (kinds.length !== 1) {
    return badValue('expectedProof must contain exactly one of generation, expiresAt, or proof')
  }
  const kind = kinds[0]
  if (kind === 'generation') {
    const generation = boundedString(read(input, 'generation'), MAX_ID)
    return generation ? okValue({ kind, value: generation }) : badValue('expectedProof.generation must be a non-empty string')
  }
  if (kind === 'expiresAt') {
    const text = boundedString(read(input, 'expiresAt'), MAX_STRING)
    if (!text || Number.isNaN(Date.parse(text))) return badValue('expectedProof.expiresAt must be a valid time')
    return okValue({ kind, value: text })
  }
  const cloned = cloneBoundedPublic(read(input, 'proof'))
  if (cloned === undefined || safeKeys(cloned).length === 0) {
    return badValue('expectedProof.proof must be a non-empty bounded object')
  }
  return okValue({ kind, value: cloned })
}

/**
 * A caller-supplied lease handle must carry the exact identity fields that
 * the facade returned on acquisition.
 */
export function normalizeHandle(input) {
  if (!isObject(input)) return badValue('handle must be an object')
  const resource = normalizeResource(read(input, 'resource'))
  if (!resource.ok) return resource
  const ownerId = boundedString(read(input, 'ownerId'), MAX_ID)
  if (!ownerId) return badValue('handle ownerId must be a non-empty string')
  const generation = boundedString(read(input, 'generation'), MAX_ID)
  if (!generation) return badValue('handle generation must be a non-empty string')
  const fencingToken = boundedString(read(input, 'fencingToken'), MAX_ID)
  if (!fencingToken) return badValue('handle fencingToken must be a non-empty string')
  const expiresAt = boundedString(read(input, 'expiresAt'), MAX_STRING)
  if (!expiresAt || Number.isNaN(Date.parse(expiresAt))) return badValue('handle expiresAt must be a valid time')
  return okValue(deepFreeze({ resource: resource.value, ownerId, generation, fencingToken, expiresAt }))
}

export function normalizeExpectedVersion(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    return badValue('expected version must be a non-negative integer')
  }
  return okValue(value)
}

/** Normalize a bounded provenance list; malformed entries are dropped. */
export function normalizeProvenance(input) {
  if (input === undefined || input === null) return okValue([])
  if (!Array.isArray(input)) return badValue('provenance must be an array')
  const entries = []
  for (const raw of input.slice(0, MAX_COLLECTION)) {
    if (!isObject(raw)) continue
    const kind = boundedString(read(raw, 'kind'), 60)
    const id = boundedString(read(raw, 'id'), MAX_ID)
    if (!kind || !id) continue
    const certainty = boundedString(read(raw, 'certainty'), 40)
    entries.push({
      kind,
      id,
      certainty: certainty && COORDINATION_CERTAINTY.includes(certainty) ? certainty : 'observed',
    })
  }
  return okValue(deepFreeze(entries))
}

/**
 * Clone only bounded, JSON-like public data. Secret-looking keys are dropped,
 * depth and collection sizes are capped, and hostile getters never escape.
 * Returns undefined when the value cannot be projected safely.
 */
export function cloneBoundedPublic(value, depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return value.slice(0, MAX_STRING)
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') return undefined
  if (depth > MAX_DEPTH || !isObject(value) || seen.has(value)) return undefined
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString()
  seen.add(value)
  if (Array.isArray(value)) {
    const array = []
    for (const item of value.slice(0, MAX_COLLECTION)) {
      const cloned = cloneBoundedPublic(item, depth + 1, seen)
      if (cloned !== undefined) array.push(cloned)
    }
    seen.delete(value)
    return deepFreeze(array)
  }
  const result = {}
  for (const key of safeKeys(value).slice(0, MAX_COLLECTION)) {
    if (SECRET_KEY.test(key)) continue
    const cloned = cloneBoundedPublic(read(value, key), depth + 1, seen)
    if (cloned !== undefined) result[key.slice(0, MAX_ID)] = cloned
  }
  seen.delete(value)
  return deepFreeze(result)
}

/**
 * Build the frozen availability projection. Unknown/invalid members degrade
 * to explicit `unknown`/safe defaults rather than inventing capability.
 */
export function buildAvailability({ status, scope, durability, operations, backend, epoch } = {}) {
  const statusValue = boundedString(status, 40)
  const scopeValue = boundedString(scope, 40)
  const durabilityValue = boundedString(durability, 40)
  const normalizedOperations = {}
  for (const op of COORDINATION_OPERATIONS) {
    const value = boundedString(read(operations, op), 40)
    normalizedOperations[op] = value && COORDINATION_STATUSES.includes(value) ? value : 'unknown'
  }
  const backendId = boundedString(read(backend, 'id'), MAX_ID) ?? 'unknown'
  const reason = boundedString(read(backend, 'reason'), MAX_STRING)
  const normalizedBackend = { id: backendId }
  if (reason) normalizedBackend.reason = reason
  return deepFreeze({
    status: statusValue && COORDINATION_STATUSES.includes(statusValue) ? statusValue : 'unknown',
    scope: scopeValue && COORDINATION_SCOPES.includes(scopeValue) ? scopeValue : 'process',
    durability: durabilityValue && COORDINATION_DURABILITY.includes(durabilityValue) ? durabilityValue : 'unknown',
    operations: normalizedOperations,
    backend: normalizedBackend,
    epoch: boundedString(epoch, 60) ?? 'none',
  })
}

/**
 * Redacted projection of an internal lease record for observers: identity,
 * state, expiry, version, and bounded provenance only. The fencing token
 * value, private value contents, and credentials never leave the host.
 */
export function redactLeaseRecord(record, options = {}) {
  const audience = options.audience ?? 'ui'
  const resource = normalizeResource(read(record, 'resource'))
  const state = boundedString(read(record, 'state'), 40)
  return deepFreeze({
    resource: resource.ok ? resource.value : { scope: 'process', key: 'unknown' },
    ownerId: boundedString(read(record, 'ownerId'), MAX_ID) ?? 'unknown',
    generation: boundedString(read(record, 'generation'), MAX_ID) ?? 'unknown',
    expiresAt: boundedString(read(record, 'expiresAt'), MAX_STRING) ?? 'unknown',
    state: state && COORDINATION_STATES.includes(state) ? state : 'unknown',
    version: Number.isInteger(read(record, 'version')) ? read(record, 'version') : 0,
    backend: cloneBoundedPublic(read(record, 'backend')),
    provenance: cloneBoundedPublic(read(record, 'provenance')) ?? [],
    audience,
  })
}