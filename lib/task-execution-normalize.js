/**
 * Pure, dependency-free normalization and validation for the task execution
 * observation facade.
 *
 * This module owns the bounded identity vocabulary (task identity, scope,
 * owner, intent, creation provenance), the frozen task/attempt state
 * vocabularies with the legal-transition table, run/attempt lineage
 * normalization (distinct attempt/run ids, links with certainty), settlement
 * evidence normalization (unified terminal outcomes, recovery safety
 * classification, bounded late events), the availability projection builder,
 * and the bounded redaction/clone helpers. It never touches a service, a
 * clock, or a backend: every function returns `{ ok: true, value }` or
 * `{ ok: false, reason }` and never throws.
 */
import { deepFreeze } from './deep-freeze.js'

export const TASK_SCOPES = Object.freeze(['session', 'workspace', 'profile', 'process'])
export const TASK_STATES = Object.freeze([
  'registered',
  'active',
  'reassigning',
  'settling',
  'settled',
  'failed',
  'unknown',
])
export const ATTEMPT_STATES = Object.freeze([
  'registered',
  'active',
  'settling',
  'settled',
  'superseded',
  'unknown',
])
export const TASK_STATUSES = Object.freeze(['available', 'unavailable', 'unsupported', 'unknown'])
export const TASK_OPERATIONS = Object.freeze([
  'register',
  'start',
  'claim',
  'reassign',
  'settle',
  'attach',
  'get',
  'observe',
  'history',
])
export const TASK_DURABILITY = Object.freeze(['durable', 'memory', 'unknown'])
export const TASK_CERTAINTY = Object.freeze(['observed', 'served', 'stale', 'unavailable', 'unknown'])
export const TASK_OUTCOMES = Object.freeze(['success', 'error', 'aborted', 'denied', 'superseded'])

/** Terminal task states reject later transitions that would rewrite them. */
export const TASK_TERMINAL = Object.freeze(['settled', 'failed', 'unknown'])

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

export function normalizeTaskId(value) {
  const taskId = boundedString(value, MAX_ID)
  return taskId ? okValue(taskId) : badValue('task identity must be a non-empty string')
}

export function normalizeScope(input) {
  if (!isObject(input)) return badValue('scope must be an object')
  const kind = boundedString(read(input, 'kind'), 40)
  if (!kind || !TASK_SCOPES.includes(kind)) return badValue('scope kind is invalid')
  const key = boundedString(read(input, 'key'), MAX_ID)
  if (!key) return badValue('scope key must be a non-empty string')
  const label = boundedString(read(input, 'label'), MAX_STRING)
  const scope = { kind, key }
  if (label !== undefined) scope.label = label
  return okValue(deepFreeze(scope))
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

/** A source link carries the source's own identity, generation, and certainty. */
export function normalizeLink(input, linkName) {
  if (!isObject(input)) return badValue(`${linkName} link must be an object`)
  const id = boundedString(read(input, 'id'), MAX_ID)
  if (!id) return badValue(`${linkName} link id must be a non-empty string`)
  const generation = boundedString(read(input, 'generation'), MAX_ID)
  const certainty = boundedString(read(input, 'certainty'), 40)
  const link = {
    id,
    certainty: certainty && TASK_CERTAINTY.includes(certainty) ? certainty : 'observed',
  }
  if (generation !== undefined) link.generation = generation
  return okValue(deepFreeze(link))
}

/**
 * Normalize a run link set. Every link preserved is one the corresponding
 * public source confirmed; unavailable or uncertain identities stay
 * unavailable/unknown and are never synthesized from an event sequence.
 */
export function normalizeRunLinks(input) {
  if (input === undefined || input === null) return okValue(deepFreeze({}))
  if (!isObject(input)) return badValue('run links must be an object')
  const links = {}
  for (const name of ['workflow', 'agent', 'execution', 'session', 'job', 'transaction']) {
    const raw = read(input, name)
    if (raw === undefined || raw === null) continue
    const normalized = normalizeLink(raw, name)
    if (!normalized.ok) return normalized
    links[name] = normalized.value
  }
  return okValue(deepFreeze(links))
}

export function normalizeAttemptOutcome(value) {
  const outcome = boundedString(value, 40)
  return outcome && TASK_OUTCOMES.includes(outcome)
    ? okValue(outcome)
    : badValue('outcome must be one of success, error, aborted, denied, or superseded')
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
      certainty: certainty && TASK_CERTAINTY.includes(certainty) ? certainty : 'observed',
    })
  }
  return okValue(deepFreeze(entries))
}

/** Normalize a caller-supplied coordination lease handle (fencing evidence). */
export function normalizeLeaseHandle(input) {
  if (!isObject(input)) return badValue('lease handle must be an object')
  const resource = read(input, 'resource')
  if (!isObject(resource)) return badValue('lease resource must be an object')
  const scope = boundedString(read(resource, 'scope'), 40)
  const key = boundedString(read(resource, 'key'), MAX_ID)
  if (!scope || !TASK_SCOPES.includes(scope) || !key) return badValue('lease resource is invalid')
  const ownerId = boundedString(read(input, 'ownerId'), MAX_ID)
  if (!ownerId) return badValue('lease owner identity must be a non-empty string')
  const generation = boundedString(read(input, 'generation'), MAX_ID)
  if (!generation) return badValue('lease generation must be a non-empty string')
  const fencingToken = boundedString(read(input, 'fencingToken'), MAX_ID)
  if (!fencingToken) return badValue('lease fencing token must be a non-empty string')
  const expiresAt = boundedString(read(input, 'expiresAt'), MAX_STRING)
  if (!expiresAt || Number.isNaN(Date.parse(expiresAt))) return badValue('lease expiresAt must be a valid time')
  return okValue(deepFreeze({
    resource,
    ownerId,
    generation,
    fencingToken,
    expiresAt,
  }))
}

/**
 * The frozen task state vocabulary with the legal-transition table. Terminal
 * task states are immutable; a prior attempt may become `superseded` or
 * retain its confirmed outcome while the task identity and immutable
 * registration metadata remain unchanged.
 */
export function canTransition(from, to) {
  if (!TASK_STATES.includes(from) || !TASK_STATES.includes(to)) return false
  // The registered -> registered edge is the design's start transition: a run
  // is created with an attempt link while the task stays registered.
  if (from === to && from !== 'registered') return false
  if (TASK_TERMINAL.includes(from)) return false
  switch (from) {
    case 'registered':
      // start keeps the task registered with a new attempt link; claim
      // publishes the active attempt; reassign goes through the reassigning
      // gate.
      return ['registered', 'active', 'reassigning'].includes(to)
    case 'active':
      return ['settling', 'reassigning', 'failed', 'unknown'].includes(to)
    case 'reassigning':
      return ['active'].includes(to)
    case 'settling':
      return ['settled', 'failed', 'unknown'].includes(to)
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
 * Build the frozen availability projection. The durability vocabulary is a
 * deliberate truth-subset: a process-memory registry is always labeled
 * `memory` and can never satisfy a reconnect-after-process-loss claim; a
 * session-/workspace-tier durable report merges to `durable` (tier carried by
 * the scope field). Unknown/invalid members degrade to explicit
 * `unknown`/safe defaults rather than inventing capability.
 */
export function buildAvailability({ status, scope, durability, operations, sources, backend, epoch } = {}) {
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
  for (const op of TASK_OPERATIONS) {
    const value = boundedString(read(operations, op), 40)
    normalizedOperations[op] = value && TASK_STATUSES.includes(value) ? value : 'unknown'
  }
  const normalizedSources = {}
  for (const name of ['execution', 'recovery', 'coordination', 'diagnostics', 'workspaceTransactions', 'jobs', 'workflow', 'subagent', 'session']) {
    const value = boundedString(read(sources, name), 40)
    normalizedSources[name] = value && TASK_STATUSES.includes(value) ? value : 'unknown'
  }
  const backendId = boundedString(read(backend, 'id'), MAX_ID) ?? 'unknown'
  const reason = boundedString(read(backend, 'reason'), MAX_STRING)
  const normalizedBackend = { id: backendId }
  if (reason) normalizedBackend.reason = reason
  return deepFreeze({
    status: statusValue && TASK_STATUSES.includes(statusValue) ? statusValue : 'unknown',
    scope: scopeValue && TASK_SCOPES.includes(scopeValue) ? scopeValue : 'process',
    durability: normalizedDurability,
    operations: normalizedOperations,
    sources: normalizedSources,
    backend: normalizedBackend,
    epoch: boundedString(epoch, 60) ?? 'none',
  })
}

/**
 * Redacted projection of a run/attempt link for public boundaries: link
 * identity, generation when known, and the explicit certainty vocabulary.
 */
function redactLink(link) {
  if (!isObject(link)) return undefined
  const id = boundedString(read(link, 'id'), MAX_ID)
  if (!id) return undefined
  const certainty = boundedString(read(link, 'certainty'), 40)
  const redacted = {
    id,
    certainty: certainty && TASK_CERTAINTY.includes(certainty) ? certainty : 'unknown',
  }
  const generation = boundedString(read(link, 'generation'), MAX_ID)
  if (generation) redacted.generation = generation
  return deepFreeze(redacted)
}

/**
 * Redacted projection of an attempt summary: attempt identity, state, links
 * with certainty, outcome, reason, and bounded provenance. Fencing token,
 * credentials, and private contents never leave the host.
 */
export function redactAttempt(attempt, options = {}) {
  const state = boundedString(read(attempt, 'state'), 40)
  const rawLinks = read(attempt, 'links')
  const links = {}
  if (isObject(rawLinks)) {
    for (const name of ['workflow', 'agent', 'execution', 'session', 'job', 'transaction']) {
      const link = redactLink(read(rawLinks, name))
      if (link) links[name] = link
    }
  }
  const redacted = {
    attemptId: boundedString(read(attempt, 'attemptId'), MAX_ID) ?? 'unknown',
    runId: boundedString(read(attempt, 'runId'), MAX_ID) ?? 'unknown',
    ownerId: boundedString(read(attempt, 'ownerId'), MAX_ID) ?? 'unknown',
    state: state && ATTEMPT_STATES.includes(state) ? state : 'unknown',
    links,
    startedAt: boundedString(read(attempt, 'startedAt'), MAX_STRING) ?? 'unknown',
  }
  const outcome = boundedString(read(attempt, 'outcome'), 40)
  if (outcome && TASK_OUTCOMES.includes(outcome)) redacted.outcome = outcome
  const reason = boundedString(read(attempt, 'reason'), MAX_STRING)
  if (reason) redacted.reason = reason
  const settledAt = boundedString(read(attempt, 'settledAt'), MAX_STRING)
  if (settledAt) redacted.settledAt = settledAt
  const provenance = cloneBoundedPublic(read(attempt, 'provenance'))
  if (provenance !== undefined && safeKeys(provenance).length > 0) redacted.provenance = provenance
  return deepFreeze(redacted)
}

/**
 * Redacted projection of an internal task record: task identity, owner,
 * scope, intent, state, revision, attempt summaries, terminal outcome,
 * provenance, and availability. Secret values, credentials, prompts, raw tool
 * output, and unbounded transcript content never appear.
 */
export function redactTaskRecord(record, options = {}) {
  const audience = options.audience ?? 'ui'
  const scope = normalizeScope(read(record, 'scope'))
  const state = boundedString(read(record, 'state'), 40)
  const rawAttempts = read(record, 'attempts')
  const attempts = Array.isArray(rawAttempts)
    ? rawAttempts.slice(-MAX_COLLECTION).map((attempt) => redactAttempt(attempt, options))
    : []
  const intent = cloneBoundedPublic(read(record, 'intent'))
  const provenance = cloneBoundedPublic(read(record, 'provenance')) ?? []
  const availability = cloneBoundedPublic(read(record, 'availability'))
  const redacted = {
    taskId: boundedString(read(record, 'taskId'), MAX_ID) ?? 'unknown',
    ownerId: boundedString(read(record, 'ownerId'), MAX_ID) ?? 'unknown',
    scope: scope.ok ? scope.value : { kind: 'process', key: 'unknown' },
    state: state && TASK_STATES.includes(state) ? state : 'unknown',
    revision: Number.isInteger(read(record, 'revision')) ? read(record, 'revision') : 0,
    attempts,
    provenance,
    audience,
  }
  if (intent !== undefined && safeKeys(intent).length > 0) redacted.intent = intent
  const activeAttemptId = boundedString(read(record, 'activeAttemptId'), MAX_ID)
  if (activeAttemptId) redacted.activeAttemptId = activeAttemptId
  const terminalOutcome = boundedString(read(record, 'terminalOutcome'), 40)
  if (terminalOutcome && TASK_OUTCOMES.includes(terminalOutcome)) redacted.terminalOutcome = terminalOutcome
  return deepFreeze(redacted)
}