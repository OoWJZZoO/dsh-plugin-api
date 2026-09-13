/**
 * Pending-interaction core: folding, restricted views and the shared identity
 * registry (host face).
 *
 * The pending approval set is *derived* from the durable session log — the same
 * evidence the official answerer matches against: an `approval/asked` record is
 * pending until an `approval/decided` record with the same id appears. This
 * module owns no lifecycle state of its own, so a decision made anywhere (the
 * official mux answerer, a later facade generation, the official policy)
 * removes the item on the next read.
 *
 * The module is pure: no harness dependency, no service access, no I/O. The
 * only state it can hold is the bounded identity registry, which is created
 * per mount and never persists anything.
 */
import { mintId } from './session-interaction-operation-normalize.js'

/** Interaction kinds this facade can report (question has no reachable seam). */
export const INTERACTION_KINDS = Object.freeze(['approval', 'question'])

/** Per-kind source states published on every view. */
export const SOURCE_STATES = Object.freeze(['active', 'degraded', 'unavailable'])

/** Respond actions (the vocabulary the caller may submit). */
export const RESPOND_ACTIONS = Object.freeze(['approve', 'reject', 'answer', 'cancel'])

/** Respond outcome codes. */
export const RESPOND_OUTCOME_CODES = Object.freeze(['accepted', 'stale', 'rejected', 'denied', 'unavailable'])

/** Approval actions → official outcome vocabulary (`allowed-once` is the only grant). */
export const APPROVAL_OUTCOMES = Object.freeze({
  approve: 'allowed-once',
  reject: 'rejected',
  cancel: 'cancelled',
})

/** Bounded summary length (one line, no payload bulk). */
const SUMMARY_LIMIT = 240

export function boundedSummary(value, limit = SUMMARY_LIMIT) {
  if (typeof value !== 'string') return ''
  const flattened = value.replace(/\s+/g, ' ').trim()
  return flattened.length > limit ? `${flattened.slice(0, limit - 1)}…` : flattened
}

/**
 * Redact one summary line at the outlet.
 *
 * Summaries are bounded and stripped of anything that looks like a credential
 * or a host path before they leave the facade; the raw reason never rides
 * along, so a redaction miss degrades the text rather than leaking it.
 */
export function redactSummary(value) {
  return boundedSummary(
    String(value ?? '')
      .replace(/(?:[A-Za-z]:)?(?:[\\/][^\s'"]+){2,}/g, '<path>')
      .replace(/\b(?:sk|pk|ghp|gho|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/g, '<redacted>')
      .replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, '<redacted>'),
  )
}

/**
 * The public answer shape of a pending interaction.
 *
 * Approval is a decision with a closed action vocabulary; a question would
 * carry its own answer shape, but no question seam is reachable on this
 * runtime, so only the approval shape is ever published.
 */
export function answerShapeOf(kind) {
  if (kind === 'approval') return Object.freeze({ kind: 'approval', actions: Object.freeze(['approve', 'reject', 'cancel']) })
  return null
}

/**
 * Fold the durable session event list into the currently pending approvals.
 *
 * Matching mirrors the official answerer: scan from the tail, collect every
 * `approval/decided` id first, then take the newest `approval/asked` whose id
 * is neither decided nor already claimed. `claimed` carries ids already held
 * by this facade's answerer or by another one, so a request that is pending in
 * the log but answered elsewhere is not reported twice.
 *
 * @param {object} input
 * @param {readonly object[]} input.events session events (official shape)
 * @param {ReadonlySet<string>} [input.claimed] official ids currently held elsewhere
 * @returns {ReadonlyArray<{officialId: string, callId: string|null, toolName: string|null, reason: string|null, createdAt: string|null}>}
 */
export function foldPendingApprovals({ events, claimed } = {}) {
  const list = Array.isArray(events) ? events : []
  const decided = new Set()
  const claimedIds = claimed ?? new Set()
  const pending = []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const event = list[index]
    const type = event?.type
    if (type === 'approval/decided') {
      const id = event?.data?.id
      if (typeof id === 'string') decided.add(id)
      continue
    }
    if (type !== 'approval/asked') continue
    const data = event?.data
    const id = data?.id
    if (typeof id !== 'string' || id === '') continue
    if (decided.has(id) || claimedIds.has(id)) continue
    pending.push(Object.freeze({
      officialId: id,
      callId: typeof data?.callId === 'string' ? data.callId : null,
      toolName: typeof data?.toolName === 'string' ? data.toolName : null,
      reason: typeof data?.reason === 'string' ? data.reason : null,
      createdAt: typeof event?.time === 'string' ? event.time : (typeof event?.at === 'string' ? event.at : null),
    }))
  }
  return Object.freeze(pending)
}

/**
 * Build one frozen restricted view for a pending approval.
 *
 * The public identity is facade-minted (never the official registry id, never
 * an event sequence); the summary is bounded and redacted at this outlet.
 */
export function buildApprovalView({ id, sessionId, pending }) {
  const parts = []
  if (typeof pending?.toolName === 'string' && pending.toolName !== '') parts.push(`tool "${pending.toolName}"`)
  if (typeof pending?.reason === 'string' && pending.reason !== '') parts.push(pending.reason)
  const summary = redactSummary(parts.length > 0 ? `Approval requested for ${parts.join(': ')}` : 'Approval requested')
  return Object.freeze({
    id,
    kind: 'approval',
    sessionId,
    summary,
    createdAt: pending?.createdAt ?? null,
    answerShape: answerShapeOf('approval'),
  })
}

/**
 * The bounded shared identity registry.
 *
 * One registry serves both sides: the view mints (and reuses) a public id for
 * an official approval, and the answerer resolves that same id back to the
 * official one. Entries are dropped as soon as the underlying approval is
 * decided or a hold settles, and the store is capped so a long-lived process
 * cannot accumulate identities.
 */
export function createInteractionRegistry({ limit = 256 } = {}) {
  const byKey = new Map()
  const byId = new Map()

  const keyOf = (sessionId, officialId) => `${sessionId}\u0000${officialId}`

  const idFor = (sessionId, officialId) => {
    const key = keyOf(sessionId, officialId)
    const existing = byKey.get(key)
    if (existing !== undefined) return existing
    const id = mintId('ix')
    byKey.set(key, id)
    byId.set(id, Object.freeze({ id, sessionId, officialId }))
    while (byId.size > limit) {
      const oldest = byId.keys().next().value
      const entry = byId.get(oldest)
      byId.delete(oldest)
      byKey.delete(keyOf(entry.sessionId, entry.officialId))
    }
    return id
  }

  const clear = (sessionId, officialId) => {
    const key = keyOf(sessionId, officialId)
    const id = byKey.get(key)
    if (id === undefined) return false
    byKey.delete(key)
    byId.delete(id)
    return true
  }

  const lookup = (id) => byId.get(id)

  return Object.freeze({ idFor, clear, lookup, size: () => byId.size })
}

/** Validate one respond call. */
export function validateRespondInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'invalid-input', reason: 'respond input must be an object' }
  }
  if (typeof input.id !== 'string' || input.id === '') {
    return { ok: false, code: 'invalid-input', reason: 'id must be a non-empty string' }
  }
  if (!RESPOND_ACTIONS.includes(input.action)) {
    return { ok: false, code: 'invalid-input', reason: 'action must be approve, reject, answer or cancel' }
  }
  if (input.answer !== undefined && input.answer !== null && typeof input.answer !== 'object') {
    return { ok: false, code: 'invalid-input', reason: 'answer must be an object when present' }
  }
  const signal = input.signal
  if (signal !== undefined && (typeof signal?.aborted !== 'boolean' || typeof signal?.addEventListener !== 'function')) {
    return { ok: false, code: 'invalid-input', reason: 'signal must be an AbortSignal' }
  }
  return {
    ok: true,
    value: Object.freeze({
      id: input.id,
      action: input.action,
      answer: input.answer ?? null,
      reason: input.reason === undefined ? undefined : boundedSummary(String(input.reason)),
      signal,
    }),
  }
}

/** Discriminated respond outcomes (frozen). */
export function buildRespondOutcome(code, reason) {
  const frozen = { ok: code === 'accepted', code: RESPOND_OUTCOME_CODES.includes(code) ? code : 'unavailable' }
  if (typeof reason === 'string' && reason !== '') frozen.reason = boundedSummary(reason, 160)
  return Object.freeze(frozen)
}

/** Frozen availability/self-description status. */
export function buildInteractionsAvailability({ status, reason, sources } = {}) {
  const state = SOURCE_STATES.includes(status) ? status : 'unavailable'
  const frozen = { status: state }
  if (typeof reason === 'string' && reason !== '') frozen.reason = boundedSummary(reason, 160)
  if (sources !== undefined && sources !== null) frozen.sources = sources
  return Object.freeze(frozen)
}
