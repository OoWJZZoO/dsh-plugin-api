/**
 * Pure, dependency-free normalization and validation for the workspace
 * mutation transaction facade.
 *
 * This module owns the bounded identity vocabulary (transaction identity,
 * workspace scope/key, owner, intent, resource set), the frozen state
 * vocabulary with the legal-transition table, mutation-record
 * normalization (before/after evidence with the explicit absent marker,
 * source provenance, side-effect classification), the availability
 * projection builder, and the bounded redaction/clone helpers. It never
 * touches a service, a clock, or a backend: every function returns
 * `{ ok: true, value }` or `{ ok: false, reason }` and never throws.
 */
import { deepFreeze } from './deep-freeze.js'

export const WS_TX_SCOPES = Object.freeze(['session', 'workspace', 'profile', 'process'])
export const WS_TX_STATES = Object.freeze([
  'prepared',
  'committing',
  'committed',
  'rolling-back',
  'rolled-back',
  'recovering',
  'failed',
  'unknown',
  'superseded',
])
export const WS_TX_STATUSES = Object.freeze(['available', 'unavailable', 'unsupported', 'unknown'])
export const WS_TX_OPERATIONS = Object.freeze([
  'prepare',
  'record',
  'preview',
  'commit',
  'rollback',
  'recover',
  'get',
  'observe',
])
export const WS_TX_DURABILITY = Object.freeze(['durable', 'memory', 'unknown'])
export const WS_TX_SIDE_EFFECTS = Object.freeze(['none', 'read-only', 'rollbackable', 'external', 'unknown'])
export const WS_TX_CERTAINTY = Object.freeze(['observed', 'served', 'stale', 'unavailable', 'unknown'])

/** Terminal states reject later transitions that would rewrite them. */
export const WS_TX_TERMINAL = Object.freeze(['committed', 'rolled-back', 'failed', 'superseded', 'unknown'])

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

export function normalizeTransactionId(value) {
  const transactionId = boundedString(value, MAX_ID)
  return transactionId ? okValue(transactionId) : badValue('transaction identity must be a non-empty string')
}

/**
 * A transaction declares exactly one workspace scope with a canonical bounded
 * key; a display label is never used for lookup and never participates in
 * equality.
 */
export function normalizeWorkspace(input) {
  if (!isObject(input)) return badValue('workspace must be an object')
  const scope = boundedString(read(input, 'scope'), 40)
  if (!scope || !WS_TX_SCOPES.includes(scope)) return badValue('workspace scope is invalid')
  const key = boundedString(read(input, 'key'), MAX_ID)
  if (!key) return badValue('workspace key must be a non-empty string')
  const label = boundedString(read(input, 'label'), MAX_STRING)
  const workspace = { scope, key }
  if (label !== undefined) workspace.label = label
  return okValue(deepFreeze(workspace))
}

export function normalizeOwnerId(value) {
  const ownerId = boundedString(value, MAX_ID)
  return ownerId ? okValue(ownerId) : badValue('owner identity must be a non-empty string')
}

export function normalizeIntent(input) {
  if (!isObject(input)) return badValue('intent must be an object')
  const kind = boundedString(read(input, 'kind'), 60)
  if (!kind) return badValue('intent kind must be a non-empty string')
  const summary = boundedString(read(input, 'summary'), MAX_STRING)
  if (!summary) return badValue('intent summary must be a non-empty string')
  return okValue(deepFreeze({ kind, summary }))
}

/**
 * A mutation resource identity: kind + canonical key + scope. The resource set
 * of a transaction must be non-empty and each member must be bounded.
 */
export function normalizeResource(input) {
  if (!isObject(input)) return badValue('resource must be an object')
  const kind = boundedString(read(input, 'kind'), 60)
  if (!kind) return badValue('resource kind must be a non-empty string')
  const key = boundedString(read(input, 'key'), MAX_ID)
  if (!key) return badValue('resource key must be a non-empty string')
  const scope = boundedString(read(input, 'scope'), 40)
  if (!scope || !WS_TX_SCOPES.includes(scope)) return badValue('resource scope is invalid')
  const label = boundedString(read(input, 'label'), MAX_STRING)
  const resource = { kind, key, scope }
  if (label !== undefined) resource.label = label
  return okValue(deepFreeze(resource))
}

/** Canonical in-process key for a normalized resource. */
export function resourceKey(resource) {
  if (!isObject(resource)) return ''
  const kind = boundedString(read(resource, 'kind'), 60)
  const key = boundedString(read(resource, 'key'), MAX_ID)
  const scope = boundedString(read(resource, 'scope'), 40)
  return kind && key && scope ? `${scope}:${kind}:${key}` : ''
}

/** Normalize a non-empty bounded resource set and reject duplicate identities. */
export function normalizeResourceSet(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return badValue('resources must be a non-empty array')
  }
  if (input.length > MAX_COLLECTION) return badValue('resource set exceeds the supported bound')
  const seen = new Set()
  const resources = []
  for (const raw of input) {
    const normalized = normalizeResource(raw)
    if (!normalized.ok) return normalized
    const key = resourceKey(normalized.value)
    if (seen.has(key)) return badValue('resource set contains a duplicate identity')
    seen.add(key)
    resources.push(normalized.value)
  }
  return okValue(deepFreeze(resources))
}

/** A caller-supplied lease/fencing context must carry the exact identity fields. */
export function normalizeFencingEvidence(input) {
  if (!isObject(input)) return badValue('lease/fencing evidence must be an object')
  const generation = boundedString(read(input, 'generation'), MAX_ID)
  if (!generation) return badValue('lease generation must be a non-empty string')
  const fencingToken = boundedString(read(input, 'fencingToken'), MAX_ID)
  if (!fencingToken) return badValue('lease fencing token must be a non-empty string')
  const ownerId = boundedString(read(input, 'ownerId'), MAX_ID)
  if (!ownerId) return badValue('lease owner identity must be a non-empty string')
  const expiresAt = boundedString(read(input, 'expiresAt'), MAX_STRING)
  if (!expiresAt || Number.isNaN(Date.parse(expiresAt))) return badValue('lease expiresAt must be a valid time')
  const rawResource = read(input, 'resource')
  const resource = isObject(rawResource)
    ? normalizeLeaseResource(rawResource)
    : { ok: false, reason: 'lease resource is absent' }
  const evidence = { generation, fencingToken, ownerId, expiresAt }
  if (resource.ok) evidence.resource = resource.value
  return okValue(deepFreeze(evidence))
}

/**
 * A lease resource carries the coordination identity shape (scope + canonical
 * key, display-only label), not a mutation kind.
 */
export function normalizeLeaseResource(input) {
  if (!isObject(input)) return badValue('lease resource must be an object')
  const scope = boundedString(read(input, 'scope'), 40)
  if (!scope || !WS_TX_SCOPES.includes(scope)) return badValue('lease resource scope is invalid')
  const key = boundedString(read(input, 'key'), MAX_ID)
  if (!key) return badValue('lease resource key must be a non-empty string')
  const label = boundedString(read(input, 'label'), MAX_STRING)
  const resource = { scope, key }
  if (label !== undefined) resource.label = label
  return okValue(deepFreeze(resource))
}

/**
 * One side of a before/after evidence pair. Either an object with bounded
 * digest/version/evidence members, or the explicit `absent: true` marker; a
 * missing field is never accepted as absent state.
 */
export function normalizeEvidenceSide(input, sideName) {
  if (!isObject(input)) return badValue(`${sideName} evidence must be an object or an explicit absent marker`)
  if (read(input, 'absent') === true) return okValue(deepFreeze({ absent: true }))
  const digest = boundedString(read(input, 'digest'), 200)
  const version = read(input, 'version')
  const evidence = cloneBoundedPublic(read(input, 'evidence'))
  const side = {}
  if (digest !== undefined) side.digest = digest
  if (Number.isInteger(version) && version >= 0) side.version = version
  if (evidence !== undefined) side.evidence = evidence
  if (safeKeys(side).length === 0) {
    return badValue(`${sideName} evidence must carry a digest, version, or bounded evidence reference`)
  }
  return okValue(deepFreeze(side))
}

export function normalizeSideEffectClass(value) {
  const sideEffectClass = boundedString(value, 40)
  return sideEffectClass && WS_TX_SIDE_EFFECTS.includes(sideEffectClass)
    ? okValue(sideEffectClass)
    : badValue('side effect class must be one of none, read-only, rollbackable, external, or unknown')
}

export function normalizeCapability(input) {
  if (!isObject(input)) return badValue('capability must be an object')
  const owner = boundedString(read(input, 'owner'), MAX_ID)
  if (!owner) return badValue('capability owner must be a non-empty string')
  const name = boundedString(read(input, 'name'), MAX_ID)
  if (!name) return badValue('capability name must be a non-empty string')
  const version = boundedString(read(input, 'version'), 60)
  const status = boundedString(read(input, 'status'), 40)
  if (!status || !WS_TX_STATUSES.includes(status)) {
    return badValue('capability status must be one of available, unavailable, unsupported, or unknown')
  }
  const capability = { owner, name, status }
  if (version !== undefined) capability.version = version
  return okValue(deepFreeze(capability))
}

export function normalizeMutationSource(input) {
  if (input === undefined || input === null) return okValue(deepFreeze({}))
  if (!isObject(input)) return badValue('source must be an object')
  const toolId = boundedString(read(input, 'toolId'), MAX_ID)
  const executionId = boundedString(read(input, 'executionId'), MAX_ID)
  const sessionId = boundedString(read(input, 'sessionId'), MAX_ID)
  const eventSeq = read(input, 'eventSeq')
  const source = {}
  if (toolId !== undefined) source.toolId = toolId
  if (executionId !== undefined) source.executionId = executionId
  if (sessionId !== undefined) source.sessionId = sessionId
  if (Number.isInteger(eventSeq) && eventSeq >= 0) source.eventSeq = eventSeq
  return okValue(deepFreeze(source))
}

/**
 * Normalize a mutation record: resource identity, operation, before/after
 * evidence, source provenance, side-effect classification, capability
 * evidence, idempotent flag, order, and observed time. Unverifiable digests
 * are marked `unknown`/`unavailable` evidence rather than exact reversible
 * claims.
 */
export function normalizeMutationRecord(input) {
  if (!isObject(input)) return badValue('mutation record must be an object')
  const resource = normalizeResource(read(input, 'resource'))
  if (!resource.ok) return resource
  const operation = boundedString(read(input, 'operation'), 60)
  if (!operation) return badValue('mutation operation must be a non-empty string')
  const before = normalizeEvidenceSide(read(input, 'before'), 'before')
  if (!before.ok) return before
  const after = normalizeEvidenceSide(read(input, 'after'), 'after')
  if (!after.ok) return after
  const sideEffectClass = normalizeSideEffectClass(read(input, 'sideEffectClass'))
  if (!sideEffectClass.ok) return sideEffectClass
  const capability = normalizeCapability(read(input, 'capability'))
  if (!capability.ok) return capability
  const source = normalizeMutationSource(read(input, 'source'))
  if (!source.ok) return source
  const idempotent = read(input, 'idempotent') === true
  return okValue(deepFreeze({
    resource: resource.value,
    operation,
    before: before.value,
    after: after.value,
    sideEffectClass: sideEffectClass.value,
    capability: capability.value,
    source: source.value,
    idempotent,
  }))
}

/**
 * The frozen state vocabulary with the legal-transition table. Terminal
 * states are immutable with exactly one encoded exception: `unknown` may be
 * reclassified only by a new explicit `recover()` with sufficient durable
 * evidence (encoded as the `unknown -> recovering` continuation edge).
 */
export function canTransition(from, to) {
  if (!WS_TX_STATES.includes(from) || !WS_TX_STATES.includes(to)) return false
  if (from === to) return false
  // Terminal protection: committed/rolled-back/failed/superseded are
  // immutable. `unknown` is a terminal observation state: only a new explicit
  // recover() may reclassify it, encoded as the single continuation edge into
  // `recovering`.
  if (WS_TX_TERMINAL.includes(from) && from !== 'unknown') return false
  // Encoding of the unknown-continuation exception: the state machine accepts
  // `unknown -> recovering`; whether the evidence is sufficient is enforced by
  // the owner's recover() path, not by the table.
  if (from === 'unknown') return to === 'recovering'
  switch (from) {
    case 'prepared':
      return ['committing', 'rolling-back', 'recovering', 'failed', 'superseded'].includes(to)
    case 'committing':
      return ['committed', 'recovering', 'failed', 'superseded'].includes(to)
    case 'rolling-back':
      return ['rolled-back', 'recovering', 'failed', 'superseded'].includes(to)
    case 'recovering':
      return ['committed', 'rolled-back', 'failed', 'unknown', 'superseded'].includes(to)
    default:
      return false
  }
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
 * Build the frozen availability projection shared with the coordination
 * projection shape. The durability vocabulary is a deliberate truth-subset:
 * session-/workspace-tier durable reports merge to `durable` (the tier is
 * carried by the scope field); memory stays `memory`; anything else is
 * `unknown`. Unknown/invalid members degrade to explicit `unknown`/safe
 * defaults rather than inventing capability.
 */
export function buildAvailability({ status, scope, durability, operations, backend, epoch } = {}) {
  const statusValue = boundedString(status, 40)
  const scopeValue = boundedString(scope, 40)
  const durabilityValue = boundedString(durability, 40)
  let normalizedDurability = 'unknown'
  if (durabilityValue === 'durable' || durabilityValue === 'session' || durabilityValue === 'workspace') {
    normalizedDurability = 'durable'
  } else if (durabilityValue === 'memory') {
    normalizedDurability = 'memory'
  }
  const normalizedOperations = {}
  for (const op of WS_TX_OPERATIONS) {
    const value = boundedString(read(operations, op), 40)
    normalizedOperations[op] = value && WS_TX_STATUSES.includes(value) ? value : 'unknown'
  }
  const backendId = boundedString(read(backend, 'id'), MAX_ID) ?? 'unknown'
  const reason = boundedString(read(backend, 'reason'), MAX_STRING)
  const normalizedBackend = { id: backendId }
  if (reason) normalizedBackend.reason = reason
  return deepFreeze({
    status: statusValue && WS_TX_STATUSES.includes(statusValue) ? statusValue : 'unknown',
    scope: scopeValue && WS_TX_SCOPES.includes(scopeValue) ? scopeValue : 'process',
    durability: normalizedDurability,
    operations: normalizedOperations,
    backend: normalizedBackend,
    epoch: boundedString(epoch, 60) ?? 'none',
  })
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
      certainty: certainty && WS_TX_CERTAINTY.includes(certainty) ? certainty : 'observed',
    })
  }
  return okValue(deepFreeze(entries))
}

/**
 * Redacted projection of a mutation record for public boundaries: resource,
 * operation, side-effect class, idempotency, order, observed time, and bounded
 * evidence references only. Raw contents, credentials, prompts, and unbounded
 * tool output never leave the host.
 */
export function redactMutationRecord(record, options = {}) {
  const resource = normalizeResource(read(record, 'resource'))
  const sideEffectClass = boundedString(read(record, 'sideEffectClass'), 40)
  const before = cloneBoundedPublic(read(record, 'before'))
  const after = cloneBoundedPublic(read(record, 'after'))
  const source = cloneBoundedPublic(read(record, 'source'))
  const capability = cloneBoundedPublic(read(record, 'capability'))
  const redacted = {
    resource: resource.ok ? resource.value : { kind: 'unknown', key: 'unknown', scope: 'process' },
    operation: boundedString(read(record, 'operation'), 60) ?? 'unknown',
    sideEffectClass: sideEffectClass && WS_TX_SIDE_EFFECTS.includes(sideEffectClass) ? sideEffectClass : 'unknown',
    idempotent: read(record, 'idempotent') === true,
    order: Number.isInteger(read(record, 'order')) ? read(record, 'order') : 0,
    observedAt: boundedString(read(record, 'observedAt'), MAX_STRING) ?? 'unknown',
  }
  if (before !== undefined) redacted.before = before
  if (after !== undefined) redacted.after = after
  if (source !== undefined && safeKeys(source).length > 0) redacted.source = source
  if (capability !== undefined && safeKeys(capability).length > 0) redacted.capability = capability
  return deepFreeze(redacted)
}

/**
 * Redacted projection of an internal transaction record for observers and
 * lookups: identity, workspace, owner, state, revision, bounded mutation
 * summaries, bounded approvals, provenance, and availability. Secret values,
 * raw file contents, and credentials never appear.
 */
export function redactTransactionRecord(record, options = {}) {
  const audience = options.audience ?? 'ui'
  const workspace = normalizeWorkspace(read(record, 'workspace'))
  const state = boundedString(read(record, 'state'), 40)
  const rawMutations = read(record, 'mutations')
  const mutations = Array.isArray(rawMutations)
    ? rawMutations.slice(-MAX_COLLECTION).map((mutation) => redactMutationRecord(mutation, options))
    : []
  const intent = cloneBoundedPublic(read(record, 'intent'))
  const rawLease = read(record, 'lease')
  const lease = isObject(rawLease)
    ? deepFreeze({
      generation: boundedString(read(rawLease, 'generation'), MAX_ID) ?? 'unknown',
      ownerId: boundedString(read(rawLease, 'ownerId'), MAX_ID) ?? 'unknown',
      expiresAt: boundedString(read(rawLease, 'expiresAt'), MAX_STRING) ?? 'unknown',
    })
    : undefined
  const checkpoint = cloneBoundedPublic(read(record, 'checkpoint'))
  const approvals = cloneBoundedPublic(read(record, 'approvals')) ?? []
  const provenance = cloneBoundedPublic(read(record, 'provenance')) ?? []
  const availability = cloneBoundedPublic(read(record, 'availability'))
  const redacted = {
    transactionId: boundedString(read(record, 'transactionId'), MAX_ID) ?? 'unknown',
    workspace: workspace.ok ? workspace.value : { scope: 'process', key: 'unknown' },
    ownerId: boundedString(read(record, 'ownerId'), MAX_ID) ?? 'unknown',
    state: state && WS_TX_STATES.includes(state) ? state : 'unknown',
    revision: Number.isInteger(read(record, 'revision')) ? read(record, 'revision') : 0,
    mutations,
    approvals,
    provenance,
    audience,
  }
  if (intent !== undefined && safeKeys(intent).length > 0) redacted.intent = intent
  if (lease !== undefined && safeKeys(lease).length > 0) redacted.lease = lease
  if (checkpoint !== undefined && safeKeys(checkpoint).length > 0) redacted.checkpoint = checkpoint
  return deepFreeze(redacted)
}