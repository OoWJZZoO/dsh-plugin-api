/**
 * Normalization and pure vocabulary for the session request operation facade.
 *
 * This module is pure: no harness dependency, no service access, no state.
 * It owns the frozen shapes of the request/cancel outcomes, operation status,
 * terminal adjudication, bounded redaction, and validation of the public
 * inputs. The authority module composes these into the single request
 * authority.
 */
/** Browser-safe identity source (host and client bundles share this module). */
function randomId() {
  try {
    if (typeof globalThis?.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  } catch {
    // fall through to the deterministic-unique local source
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/** Source-audited message kinds accepted by the durable append contract (v1). */
export const REQUEST_MESSAGE_KINDS = Object.freeze(['user-message'])

/** Operation phases of the handle status (frozen; `settled` et al never enter). */
export const OPERATION_PHASES = Object.freeze(['pending', 'accepted', 'running', 'waiting', 'terminal'])

/** Terminal outcomes (frozen shared vocabulary; timeout maps to error). */
export const TERMINAL_OUTCOMES = Object.freeze(['success', 'error', 'aborted', 'denied', 'superseded'])

/** Request primary outcome codes. */
export const REQUEST_OUTCOME_CODES = Object.freeze(['accepted', 'duplicate', 'already-running', 'rejected', 'denied', 'unavailable'])

/** Cancel result codes. */
export const CANCEL_OUTCOME_CODES = Object.freeze(['accepted', 'conflict', 'stale', 'invalid-input', 'unavailable'])

/** Cancel `by` vocabulary (design Data Models §3). */
export const CANCEL_BY_VALUES = Object.freeze(['user', 'owner', 'system'])

/** Activity correlation confidence vocabulary (shared; never mutually substituted). */
export const CORRELATION_CONFIDENCE = Object.freeze(['unknown', 'unavailable'])

const REASON_LIMIT = 160

export function boundedText(value, limit = REASON_LIMIT) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit)}...`
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Mint a facade-generated identity. */
export function mintId(prefix) {
  return `${prefix}_${randomId()}`
}

/**
 * Validate a request spec against the frozen public contract.
 * @returns {{ok: true, value: {sessionId, message, idempotencyKey?, parent?, cause?}} | {ok: false, code: 'invalid-input', reason: string}}
 */
export function validateRequestSpec(input) {
  if (!isPlainObject(input)) {
    return { ok: false, code: 'invalid-input', reason: 'request spec is required' }
  }
  const sessionId = input.sessionId
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return { ok: false, code: 'invalid-input', reason: 'sessionId is required' }
  }
  let message
  if (input.message !== undefined) {
    if (!isPlainObject(input.message)) {
      return { ok: false, code: 'invalid-input', reason: 'message must be an object' }
    }
    const kind = input.message.kind
    if (!REQUEST_MESSAGE_KINDS.includes(kind)) {
      return { ok: false, code: 'invalid-input', reason: `unsupported message kind "${kind}"` }
    }
    const text = input.message.text
    if (typeof text !== 'string' || text.length === 0) {
      return { ok: false, code: 'invalid-input', reason: 'message text is required' }
    }
    let attachmentRefs = input.message.attachmentRefs
    if (attachmentRefs !== undefined) {
      if (!Array.isArray(attachmentRefs) || !attachmentRefs.every((ref) => typeof ref === 'string')) {
        return { ok: false, code: 'invalid-input', reason: 'attachmentRefs must be an array of strings' }
      }
      attachmentRefs = [...attachmentRefs]
    }
    message = Object.freeze({ kind, text, attachmentRefs: attachmentRefs ?? [] })
  }
  let idempotencyKey = input.idempotencyKey
  if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0)) {
    return { ok: false, code: 'invalid-input', reason: 'idempotencyKey must be a non-empty string' }
  }
  const parent = typeof input.parent === 'string' ? input.parent : input.parent
  const cause = typeof input.cause === 'string' ? input.cause : input.cause
  if (parent !== undefined && typeof parent !== 'string') {
    return { ok: false, code: 'invalid-input', reason: 'parent must be a string' }
  }
  if (cause !== undefined && typeof cause !== 'string') {
    return { ok: false, code: 'invalid-input', reason: 'cause must be a string' }
  }
  const signal = input.signal
  if (signal !== undefined && (typeof signal?.aborted !== 'boolean' || typeof signal?.addEventListener !== 'function')) {
    return { ok: false, code: 'invalid-input', reason: 'signal must be an AbortSignal' }
  }
  return { ok: true, value: Object.freeze({ sessionId, message: message ?? null, idempotencyKey, parent, cause, signal }) }
}

/**
 * Validate a cancel call against the frozen public contract.
 * @returns {{ok: true, value: {sessionId?, operationId?, reason?, by?}} | {ok: false, code: 'invalid-input', reason: string}}
 */
export function validateCancelInput(input) {
  if (!isPlainObject(input)) {
    return { ok: false, code: 'invalid-input', reason: 'cancel input is required' }
  }
  if (input.sessionId !== undefined && (typeof input.sessionId !== 'string' || input.sessionId.length === 0)) {
    return { ok: false, code: 'invalid-input', reason: 'sessionId must be a non-empty string' }
  }
  if (input.operationId !== undefined && (typeof input.operationId !== 'string' || input.operationId.length === 0)) {
    return { ok: false, code: 'invalid-input', reason: 'operationId must be a non-empty string' }
  }
  if (input.sessionId === undefined && input.operationId === undefined) {
    return { ok: false, code: 'invalid-input', reason: 'at least sessionId or operationId is required' }
  }
  const reason = input.reason === undefined ? undefined : boundedText(formatReasonValue(input.reason))
  const by = input.by ?? 'owner'
  if (typeof by !== 'string' || !CANCEL_BY_VALUES.includes(by)) {
    return { ok: false, code: 'invalid-input', reason: 'by must be user, owner or system' }
  }
  return { ok: true, value: Object.freeze({ sessionId: input.sessionId, operationId: input.operationId, reason, by }) }
}

function formatReasonValue(value) {
  if (typeof value === 'string') return value
  if (typeof value?.message === 'string') return value.message
  return ''
}

/** Adjudicate one terminal from still-valid competing signals (frozen priority). */
export function adjudicateTerminal({ cancelRequested = false, superseded = false, timeoutRequested = false, fact = null } = {}) {
  if (cancelRequested) {
    return superseded
      ? { outcome: 'superseded', classification: 'superseded' }
      : { outcome: 'aborted', classification: 'aborted' }
  }
  if (fact !== null && TERMINAL_OUTCOMES.includes(fact.outcome)) {
    return { outcome: fact.outcome, classification: fact.classification ?? fact.outcome }
  }
  if (timeoutRequested) {
    return { outcome: 'error', classification: 'timeout' }
  }
  return null
}

/** Build the operation's declared retry capability (default: no automatic retry). */
export function buildDeclaredCapability({ idempotencyKey }) {
  return Object.freeze({
    idempotent: idempotencyKey !== undefined,
    autoRetry: false,
    failClosed: true,
  })
}

/** Build the frozen operation status shape. */
export function buildOperationStatus({ phase, terminal, attempt, activity, observedAt }) {
  return Object.freeze({
    phase,
    terminal: terminal ?? null,
    attempt: attempt ?? null,
    activity: activity ?? Object.freeze({ activityId: null, executionId: null, confidence: 'unknown' }),
    observedAt,
  })
}

function freezeStatus(value) {
  const terminal = value.terminal === null ? null : Object.freeze({ ...value.terminal })
  const attempt = value.attempt === null ? null : Object.freeze({ ...value.attempt })
  const activity = Object.freeze({ ...value.activity })
  return Object.freeze({ phase: value.phase, terminal, attempt, activity, observedAt: value.observedAt })
}

/** Build the accepted outcome (discriminated result). */
export function buildAcceptedOutcome({ operation, activity }) {
  return Object.freeze({
    ok: true,
    code: 'accepted',
    operation,
    activity: Object.freeze(activity),
  })
}

export function buildDuplicateOutcome(operationRef) {
  return Object.freeze({ ok: true, code: 'duplicate', operationRef: Object.freeze({ ...operationRef }) })
}

export function buildAlreadyRunningOutcome(operationRef) {
  return Object.freeze({ ok: true, code: 'already-running', operationRef: Object.freeze({ ...operationRef }) })
}

export function buildRejectedOutcome({ reason, domainCode }) {
  const result = { ok: false, code: 'rejected', reason: boundedText(reason) }
  if (domainCode !== undefined) result.domainCode = domainCode
  return Object.freeze(result)
}

export function buildDeniedOutcome({ reason, domainCode }) {
  const result = { ok: false, code: 'denied', reason: boundedText(reason) }
  if (domainCode !== undefined) result.domainCode = domainCode
  return Object.freeze(result)
}

export function buildUnavailableOutcome(reason) {
  return Object.freeze({ ok: false, code: 'unavailable', reason: boundedText(reason) })
}

/** Map a slice admission rejection code onto the facade outcome code. */
export function mapSliceAdmissionRejection(code) {
  switch (code) {
    case 'busy':
      return { code: 'rejected', domainCode: 'loop-busy' }
    case 'no-agent':
      return { code: 'rejected', domainCode: 'no-agent' }
    case 'pending':
      return { code: 'duplicate', domainCode: 'slice-pending' }
    case 'invalid-input':
      return { code: 'rejected', domainCode: 'invalid-input' }
    default:
      return { code: 'unavailable', domainCode: 'slice-admission' }
  }
}

export { freezeStatus }