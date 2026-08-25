/**
 * Branch record encoding and graph folding (pure, zero harness).
 *
 * Branch records live on the PARENT session's append-only log as custom
 * metadata events (`branch/created`, `branch/failed`) that round-trip through
 * the official storage path unchanged. Folding the log rebuilds the frozen
 * branch graph after restarts without any sidecar state.
 *
 * Verified against the locked owner package (see delegate.js header): custom
 * event types are accepted by `Session.append` (JSON-serializable data, no
 * surface marker) and by the seed/restore envelope validation.
 *
 * # Existing client cursor positions (bundle verification conclusion, locked
 * # owner 0.1.0-rc.6): client surfaces observe the parent's event stream and
 * # re-fold official `surfaceOp` rewrites, so the operations of this bundle
 * # never silently strand a cursor — branch creation is a pure append
 * # (positions stay valid), and edit commits/rollbacks are official surface
 * # replacements the standard client fold handles. A rollback whose commit
 * # node was itself shadowed by a later rewrite is a typed no-op, never a
 * # silent teardown of a newer state (see branches.integration test
 * # "rollback never reverts newer legitimate commits").
 */

import { BRANCH_KINDS } from './branch-kinds.js'
import { validationFailure } from './errors.js'

/** Default audience visibility for branch records (diagnostic/UI, not model context). */
export const DEFAULT_BRANCH_VISIBILITY = 'diagnostic'

/** Documented minimal inheritance default: nothing carries over silently. */
export const DEFAULT_INHERITANCE = Object.freeze({
  route: false,
  memory: false,
  attachments: false,
  toolState: false,
})

const MAX_BRANCH_ID_BYTES = 128
const MAX_VISIBILITY_BYTES = 32
const MAX_RETENTION_BYTES = 512
const MAX_OPTIONS_ENTRIES = 16

function clampBytes(value, limit, field) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > limit) {
    return validationFailure('BRANCH_OPTION_INVALID', `${field} must be a non-empty string within ${limit} bytes`)
  }
  return { ok: true }
}

/**
 * Validate one branch kind against the four fixed kinds.
 * @param {unknown} kind
 * @returns {{ ok: true, kind: string } | { ok: false, code: string, detail: string }}
 */
export function validateBranchKind(kind) {
  if (typeof kind !== 'string' || !BRANCH_KINDS.includes(kind)) {
    return validationFailure('BRANCH_KIND_INVALID', `branch kind must be one of ${BRANCH_KINDS.join('|')}`)
  }
  return { ok: true, kind }
}

/**
 * Validate branch creation options and normalize them to a frozen option set.
 * Unknown option keys are ignored (audit-friendly tolerance); malformed known
 * keys fail closed.
 * @param {{ kind?: unknown, childSessionId?: unknown, visibility?: unknown, retention?: unknown, inheritance?: unknown }} options
 * @returns {{ ok: true, options: Readonly<Record<string, unknown>> } | { ok: false, code: string, detail: string }}
 */
export function normalizeBranchOptions(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    return validationFailure('BRANCH_OPTION_INVALID', 'branch options must be a plain object')
  }
  const keys = Object.keys(options)
  if (keys.length > MAX_OPTIONS_ENTRIES) {
    return validationFailure('BRANCH_OPTION_INVALID', `branch options exceed ${MAX_OPTIONS_ENTRIES} entries`)
  }
  const kindResult = validateBranchKind(options.kind)
  if (!kindResult.ok) return kindResult
  if (options.childSessionId !== undefined
    && (typeof options.childSessionId !== 'string' || options.childSessionId.length === 0)) {
    return validationFailure('BRANCH_OPTION_INVALID', 'childSessionId must be a non-empty string when provided')
  }
  if (options.visibility !== undefined) {
    const visibility = clampBytes(options.visibility, MAX_VISIBILITY_BYTES, 'visibility')
    if (!visibility.ok) return visibility
  }
  if (options.retention !== undefined) {
    if (typeof options.retention !== 'string' || Buffer.byteLength(options.retention, 'utf8') > MAX_RETENTION_BYTES) {
      return validationFailure('BRANCH_OPTION_INVALID', `retention must be a string within ${MAX_RETENTION_BYTES} bytes`)
    }
  }
  const inheritance = normalizeInheritance(options.inheritance)
  if (!inheritance.ok) return inheritance
  return {
    ok: true,
    options: Object.freeze({
      kind: kindResult.kind,
      ...(options.childSessionId === undefined ? {} : { childSessionId: options.childSessionId }),
      visibility: options.visibility ?? DEFAULT_BRANCH_VISIBILITY,
      ...(options.retention === undefined ? {} : { retention: options.retention }),
      inheritance: inheritance.effective,
    }),
  }
}

/**
 * Validate inheritance choices; the documented minimal default is applied when
 * nothing is declared. Members declared true that this bundle cannot wire are
 * reported as gaps (child starts degraded, never fabricated).
 * @param {unknown} input
 * @returns {{ ok: true, effective: Readonly<Record<string, boolean>>, gaps: readonly string[] } | { ok: false, code: string, detail: string }}
 */
export function normalizeInheritance(input) {
  if (input === undefined) {
    return { ok: true, effective: DEFAULT_INHERITANCE, gaps: [] }
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return validationFailure('BRANCH_OPTION_INVALID', 'inheritance must be an object of boolean choices')
  }
  const effective = {}
  const gaps = []
  for (const member of Object.keys(DEFAULT_INHERITANCE)) {
    const declared = input[member]
    if (declared !== undefined && typeof declared !== 'boolean') {
      return validationFailure('BRANCH_OPTION_INVALID', `inheritance.${member} must be a boolean`)
    }
    const value = declared ?? false
    effective[member] = value
    // This bundle never wires ambient resources into the child; a declared
    // inheritance is intent recorded on the branch record, and the child
    // starts degraded for every declared member (never fabricated).
    if (value) gaps.push(member)
  }
  return { ok: true, effective: Object.freeze(effective), gaps: Object.freeze(gaps) }
}

/**
 * Encode the `branch/created` event payload for the parent session log.
 * Plain JSON, no surface marker; round-trips through the official store.
 * @param {{ branchId: string, kind: string, parentSessionId: string, boundarySeq: number,
 *           childSessionId: string, causalSourceSeqs: readonly number[],
 *           visibility: string, retention?: string, inheritance?: Readonly<Record<string, boolean>>,
 *           state?: string }} input
 * @returns {Readonly<Record<string, unknown>>} frozen plain data
 */
export function encodeBranchCreated(input) {
  return Object.freeze({
    branchId: input.branchId,
    kind: input.kind,
    parentSessionId: input.parentSessionId,
    boundarySeq: input.boundarySeq,
    childSessionId: input.childSessionId,
    causalSourceSeqs: Object.freeze([...input.causalSourceSeqs]),
    visibility: input.visibility,
    ...(input.retention === undefined ? {} : { retention: input.retention }),
    ...(input.inheritance === undefined ? {} : { inheritance: Object.freeze({ ...input.inheritance }) }),
    state: input.state ?? 'active',
  })
}

/**
 * Encode the `branch/failed` compensation payload.
 * @param {{ branchId: string, kind: string, parentSessionId: string, boundarySeq: number,
 *           reason: string, childSessionId?: string, at: number }} input
 * @returns {Readonly<Record<string, unknown>>} frozen plain data
 */
export function encodeBranchFailed(input) {
  return Object.freeze({
    branchId: input.branchId,
    kind: input.kind,
    parentSessionId: input.parentSessionId,
    boundarySeq: input.boundarySeq,
    reason: input.reason,
    ...(input.childSessionId === undefined ? {} : { childSessionId: input.childSessionId }),
    at: input.at,
  })
}

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Decode one `branch/created` payload into a frozen branch record. Unknown
 * fields are tolerated (audit-friendly), malformed required fields reject.
 * @param {unknown} data
 * @returns {Readonly<Record<string, unknown>> | null}
 */
export function decodeBranchCreated(data) {
  if (!isPlainRecord(data)) return null
  const {
    branchId, kind, parentSessionId, boundarySeq, childSessionId, causalSourceSeqs,
    visibility, inheritance, state,
  } = data
  if (typeof branchId !== 'string' || branchId.length === 0 || branchId.length > MAX_BRANCH_ID_BYTES) return null
  if (typeof kind !== 'string' || !BRANCH_KINDS.includes(kind)) return null
  if (typeof parentSessionId !== 'string' || parentSessionId.length === 0) return null
  if (typeof childSessionId !== 'string' || childSessionId.length === 0) return null
  if (!Number.isSafeInteger(boundarySeq) || boundarySeq < 0) return null
  if (!Array.isArray(causalSourceSeqs)
    || causalSourceSeqs.some((seq) => !Number.isSafeInteger(seq) || seq < 0)) return null
  if (typeof visibility !== 'string' || visibility.length === 0) return null
  if (inheritance !== undefined && (!isPlainRecord(inheritance)
    || Object.values(inheritance).some((member) => typeof member !== 'boolean'))) return null
  if (state !== undefined && state !== 'active') return null
  return Object.freeze({
    branchId,
    kind,
    parentSessionId,
    boundarySeq,
    childSessionId,
    causalSourceSeqs: Object.freeze([...causalSourceSeqs]),
    visibility,
    ...(typeof data.retention === 'string' ? { retention: data.retention } : {}),
    ...(inheritance === undefined ? {} : { inheritance: Object.freeze({ ...inheritance }) }),
    ...(typeof data.gaps === 'object' && data.gaps !== null && !Array.isArray(data.gaps)
      ? { gaps: Object.freeze({ ...data.gaps }) }
      : {}),
    state: 'active',
  })
}

/**
 * Decode one `branch/failed` payload into a frozen failure record.
 * @param {unknown} data
 * @returns {Readonly<Record<string, unknown>> | null}
 */
export function decodeBranchFailed(data) {
  if (!isPlainRecord(data)) return null
  const { branchId, reason } = data
  if (typeof branchId !== 'string' || branchId.length === 0) return null
  if (typeof reason !== 'string' || reason.length === 0) return null
  return Object.freeze({
    branchId,
    ...(typeof data.kind === 'string' ? { kind: data.kind } : {}),
    ...(typeof data.parentSessionId === 'string' ? { parentSessionId: data.parentSessionId } : {}),
    ...(Number.isSafeInteger(data.boundarySeq) ? { boundarySeq: data.boundarySeq } : {}),
    ...(typeof data.childSessionId === 'string' ? { childSessionId: data.childSessionId } : {}),
    reason,
    ...(Number.isSafeInteger(data.at) ? { at: data.at } : {}),
    state: 'failed',
  })
}

/**
 * Fold one session log's branch events into a frozen branch graph for that
 * session as parent. Never fabricates links: records come only from committed
 * `branch/created` events; `branch/failed` compensations flip the matching
 * record's state (or surface as a standalone failed entry when the created
 * event was itself rolled back in an earlier window).
 * @param {readonly { type?: string, data?: unknown }[]} events
 * @returns {Readonly<{ branches: readonly Readonly<Record<string, unknown>>[], current: Readonly<Record<string, unknown>> | null }>}
 */
export function foldBranchGraph(events) {
  const branches = []
  const byId = new Map()
  for (const event of events ?? []) {
    if (event?.type === 'branch/created') {
      const record = decodeBranchCreated(event.data)
      if (record !== null) {
        branches.push(record)
        byId.set(record.branchId, record)
      }
    } else if (event?.type === 'branch/failed') {
      const failure = decodeBranchFailed(event.data)
      if (failure === null) continue
      const existing = byId.get(failure.branchId)
      if (existing !== undefined && existing.state === 'active') {
        const merged = Object.freeze({ ...existing, state: 'failed', reason: failure.reason })
        const index = branches.indexOf(existing)
        branches[index] = merged
        byId.set(failure.branchId, merged)
      } else if (existing === undefined) {
        branches.push(failure)
        byId.set(failure.branchId, failure)
      }
    }
  }
  const current = [...branches].reverse().find((record) => record.state === 'active') ?? null
  return Object.freeze({
    branches: Object.freeze(branches),
    current,
  })
}

/**
 * Enumerate the declared-but-undelivered inheritance gaps of one branch
 * record (frozen list of member names).
 * @param {Readonly<Record<string, unknown>> | undefined} inheritance
 * @returns {readonly string[]}
 */
export function inheritanceGapsOf(inheritance) {
  if (!isPlainRecord(inheritance)) return Object.freeze([])
  return Object.freeze(
    Object.keys(DEFAULT_INHERITANCE).filter((member) => inheritance[member] === true),
  )
}