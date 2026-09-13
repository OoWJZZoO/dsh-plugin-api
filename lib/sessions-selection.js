/**
 * Model/effort selection core (host face).
 *
 * The official per-session selection is owned by the api-proxy: it resolves the
 * effective value as memory → the session's latest logged request header →
 * the deployment default, and it persists a switch only best-effort. This
 * module therefore never keeps a second value: it *reads* the official one,
 * infers which tier it came from out of the observable evidence, and submits
 * through the single official seam with a value-level compare-and-set.
 *
 * The module is pure: no harness dependency, no service access, no I/O.
 */
import { mintId } from './session-interaction-operation-normalize.js'

/** Effect values for the source disclosure (the tier the value came from). */
export const SELECTION_SOURCES = Object.freeze([
  'committed',
  'fallback-logged-request-config',
  'fallback-deployment-default',
  'unknown',
])

/** Set outcome codes. */
export const SELECTION_OUTCOME_CODES = Object.freeze(['committed', 'conflict', 'rejected', 'unavailable'])

/** Official selection keys (provider/model/effort only). */
export const SELECTION_FIELDS = Object.freeze(['provider', 'model', 'effort'])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value !== ''
}

/**
 * Normalize one official selection into the public three-field shape.
 *
 * The official vocabulary spells the third field `reasoningEffort`; the public
 * contract spells it `effort`. One adapter, so neither vocabulary leaks.
 */
export function normalizeOfficialSelection(selection) {
  if (!isPlainObject(selection)) return null
  const provider = isNonEmptyString(selection.provider) ? selection.provider : null
  const model = isNonEmptyString(selection.model) ? selection.model : null
  if (provider === null || model === null) return null
  const effort = isNonEmptyString(selection.reasoningEffort) ? selection.reasoningEffort : null
  return Object.freeze({ provider, model, effort })
}

/** Validate the caller's selection payload (at least one field, all strings). */
export function normalizeSelection(input) {
  if (!isPlainObject(input)) return { ok: false, reason: 'selection must be an object' }
  const allowed = new Set(SELECTION_FIELDS)
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) return { ok: false, reason: `unsupported selection field "${key}"` }
  }
  const selection = {}
  for (const field of SELECTION_FIELDS) {
    const value = input[field]
    if (value === undefined) continue
    if (!isNonEmptyString(value)) return { ok: false, reason: `selection.${field} must be a non-empty string` }
    selection[field] = value
  }
  if (Object.keys(selection).length === 0) return { ok: false, reason: 'selection requires at least one field' }
  return { ok: true, value: Object.freeze(selection) }
}

/** Validate one set call. */
export function validateSelectionSet(input) {
  if (!isPlainObject(input)) return { ok: false, reason: 'set input must be an object' }
  if (!isNonEmptyString(input.sessionId)) return { ok: false, reason: 'sessionId must be a non-empty string' }
  const selection = normalizeSelection(input.selection)
  if (selection.ok !== true) return { ok: false, reason: selection.reason }
  let expected
  if (input.expected !== undefined && input.expected !== null) {
    const normalized = normalizeSelection(input.expected)
    if (normalized.ok !== true) return { ok: false, reason: `expected: ${normalized.reason}` }
    expected = normalized.value
  }
  const signal = input.signal
  if (signal !== undefined && (typeof signal?.aborted !== 'boolean' || typeof signal?.addEventListener !== 'function')) {
    return { ok: false, reason: 'signal must be an AbortSignal' }
  }
  return { ok: true, value: Object.freeze({ sessionId: input.sessionId, selection: selection.value, expected, signal }) }
}

/** Value-level equality over the fields a caller actually declared. */
export function selectionMatches(expected, current) {
  if (expected === undefined || expected === null || current === null) return false
  for (const field of SELECTION_FIELDS) {
    if (expected[field] === undefined) continue
    if (expected[field] !== current[field]) return false
  }
  return true
}

/**
 * Infer which tier the official effective value came from.
 *
 * The official precedence is memory → the session's latest logged request
 * header → the deployment default, and only the latter two are observable.
 * A value that matches neither can only have come from the memory tier, so it
 * is disclosed as `committed`; a value that coincides with a fallback tier is
 * disclosed as that fallback (the conservative direction — a committed value
 * that happens to equal the deployment default is reported as the default
 * rather than as an authoritative committed choice).
 */
export function inferSelectionSource({ current, loggedConfig, deploymentDefault } = {}) {
  if (current === null || current === undefined) return 'unknown'
  if (loggedConfig !== null && loggedConfig !== undefined && selectionMatches(loggedConfig, current)) {
    return 'fallback-logged-request-config'
  }
  if (deploymentDefault !== null && deploymentDefault !== undefined && selectionMatches(deploymentDefault, current)) {
    return 'fallback-deployment-default'
  }
  return 'committed'
}

/** Build one frozen selection view. */
export function buildSelectionView({ sessionId, current, source, revision, committedAt, observedAt }) {
  const state = SELECTION_SOURCES.includes(source) ? source : 'unknown'
  return Object.freeze({
    sessionId,
    provider: current?.provider ?? null,
    model: current?.model ?? null,
    effort: current?.effort ?? null,
    revision,
    source: state,
    // Only a submission this facade witnessed is a commit time; a value read
    // from the official tiers carries no knowable commit time, so it stays
    // null instead of echoing the read time as if it were the commit time.
    committedAt: typeof committedAt === 'string' ? committedAt : null,
    observedAt,
  })
}

/** Frozen availability/self-description status. */
export function buildSelectionAvailability({ status, reason } = {}) {
  const allowed = ['active', 'degraded', 'unavailable']
  const state = allowed.includes(status) ? status : 'unavailable'
  const frozen = { status: state }
  if (typeof reason === 'string' && reason !== '') frozen.reason = reason
  return Object.freeze(frozen)
}

/**
 * Map one official mux result onto the public outcome.
 *
 * `model-unavailable` is the official "the value cannot be used" refusal (the
 * model does not take this session's images, the provider does not serve it,
 * the resolver threw) and becomes `rejected`; a session the official resolver
 * cannot find has no selection to change and becomes `unavailable`; anything
 * else stays unavailable rather than being guessed into a rejection.
 */
export function mapSelectionFailure(error) {
  const code = typeof error?.code === 'string' ? error.code : ''
  const message = typeof error?.message === 'string' && error.message !== '' ? error.message : null
  if (code === 'model-unavailable') return Object.freeze({ ok: false, code: 'rejected', reason: message ?? 'the official selection seam rejected the value', domainCode: code })
  if (code === 'session-not-found') return Object.freeze({ ok: false, code: 'unavailable', reason: message ?? 'the session is not available to the selection seam', domainCode: code })
  return Object.freeze({ ok: false, code: 'unavailable', reason: message ?? 'the official selection seam is unavailable', domainCode: code === '' ? null : code })
}

/** Frozen conflict outcome. */
export function buildConflictOutcome(current) {
  return Object.freeze({
    ok: false,
    code: 'conflict',
    reason: 'the expected selection no longer matches the official current value',
    current: current ?? null,
  })
}

/** Mint one mux request id for an in-process call to the official seam. */
export function mintMuxRequestId() {
  return mintId('rpc')
}
