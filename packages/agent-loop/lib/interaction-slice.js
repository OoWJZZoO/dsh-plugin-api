/**
 * Interaction boundary slice — additive capability of the agent-loop
 * replacement (shared loop boundary slice).
 *
 * The slice extends the official `agent-loop` loader-row contract with three
 * additive pieces (facts-only, never framework semantics):
 *
 *   1. `admit(operationSpec)` — the loop boundary accepts one external session
 *      request exactly once (dedupe of the same key before terminal is owned by
 *      the facade request authority; the slice double-guards with a pending
 *      admission per session).
 *   2. `cancelAttempt(attemptRef, { reason, signal })` — best-effort
 *      cancellation propagation to the live attempt (and only through the
 *      agent-loop's own phase abort); never writes a terminal itself.
 *   3. attempt lifecycle facts `agent/attempt/start|end` emitted at the loop's
 *      real commit points (turn open / turn close), payloads frozen, semantic
 *      `fact`, producer authority = this owner package.
 *
 * The attempt-fact vocabulary is defined once here and consumed read-only by
 * `session-activity-projection` (observed terminal/queue evidence) and
 * `checkpoint-restore-contract` (live-attempt preconditions, stop coordination
 * trigger, auto-capture trigger). Iron rule: a fact build/emission failure is
 * contained and can never change the loop's official event timing, payloads, or
 * decisions.
 */
import { randomUUID } from 'node:crypto'
import { deepFreeze } from '@deepseek-ai/dsh-llm'

/** Capability marker installed on the forked agent-loop service instance. */
export const INTERACTION_ACTIVE_SYMBOL = Symbol.for('dsh-plugin-api.agent-loop.interaction')

/** Neutral contract version of the emitted attempt-fact payloads. */
export const ATTEMPT_FACTS_CONTRACT_VERSION = '1'

/** Marker the activity projection line publishes when its observation contract is installed. */
export const ACTIVITY_OBSERVATION_CONTRACT_SYMBOL = Symbol.for('dsh-plugin-api.session-activity.observation-contract')

/** Canonical fact events (catalog entries are provided by the main facade slice). */
export const ATTEMPT_START_EVENT = 'agent/attempt/start'
export const ATTEMPT_END_EVENT = 'agent/attempt/end'

/** Abort-cause marker a supersede cancel carries (maps the attempt end to superseded). */
export const ATTEMPT_SUPERSEDED_CAUSE = Symbol.for('dsh-plugin-api.agent-loop.attempt-superseded')

/** Closed vocabulary of the attempt-end outcome (loop-side fact). */
export const ATTEMPT_OUTCOMES = Object.freeze(['success', 'error', 'aborted', 'denied', 'superseded'])

/** Closed vocabulary of the loop-side post-attempt queue fact. */
export const ATTEMPT_FOLLOW_UP = Object.freeze(['none', 'queued'])

const REASON_LIMIT = 120

function isoNow(now) {
  try {
    const value = now()
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
  } catch {
    return new Date().toISOString()
  }
}

function boundedText(value, limit = REASON_LIMIT) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit)}...`
}

function failureMessage(entry) {
  if (!entry || typeof entry !== 'object') return ''
  if (typeof entry.message === 'string') return entry.message
  if (entry.error && typeof entry.error.message === 'string') return entry.error.message
  return ''
}

/**
 * Map one official `turn/end` reason to the operation vocabulary's loop-side
 * attempt outcome plus a bounded classification. `superseded` is only reported
 * when the aborting cause carried the supersede marker (authority-driven).
 */
export function mapTurnEndOutcome(turnEnds, { superseded = false } = {}) {
  if (turnEnds === null || typeof turnEnds !== 'object') {
    return { outcome: 'error', classification: 'no-turn-end' }
  }
  switch (turnEnds.kind) {
    case 'completed':
      return { outcome: 'success', classification: 'completed' }
    case 'blocked':
      // A pre-step waterfall veto closed the turn without work.
      return { outcome: 'denied', classification: 'blocked' }
    case 'aborted': {
      if (superseded || isSupersededCause(turnEnds.reason)) {
        return { outcome: 'superseded', classification: 'superseded' }
      }
      return { outcome: 'aborted', classification: 'aborted' }
    }
    case 'max-tokens':
      // An output-token ceiling limit: not a clean completion in the operation
      // vocabulary; surfaced as error with a classification.
      return { outcome: 'error', classification: 'max-tokens' }
    case 'interrupted':
      return { outcome: 'error', classification: 'interrupted' }
    case 'error': {
      const code = turnEnds.error?.code ?? (turnEnds.error?.kind === 'error' ? 'error' : 'UNKNOWN')
      return { outcome: 'error', classification: typeof code === 'string' && code.length > 0 ? code : 'UNKNOWN' }
    }
    default:
      return { outcome: 'error', classification: 'error' }
  }
}

function isSupersededCause(reason) {
  if (reason && typeof reason === 'object' && reason[ATTEMPT_SUPERSEDED_CAUSE] === true) return true
  return reason === ATTEMPT_SUPERSEDED_CAUSE
}

/** Bounded, redacted reason derived from the loop-side turn end. */
export function redactTurnEndReason(turnEnds) {
  if (turnEnds === null || typeof turnEnds !== 'object') return undefined
  switch (turnEnds.kind) {
    case 'completed':
    case 'blocked':
    case 'max-tokens':
    case 'interrupted':
      return undefined
    case 'aborted':
      return boundedText(typeof turnEnds.reason?.message === 'string' ? turnEnds.reason.message : '')
    case 'error':
      return boundedText(failureMessage(turnEnds.error))
    default:
      return undefined
  }
}

/** Frozen attempt-start fact payload (fields are part of the shared contract). */
export function buildAttemptStartPayload({ attemptId, operationId, executionId, sessionId, seq, observedAt }) {
  return deepFreeze({
    attemptId,
    operationId: operationId ?? null,
    executionId: executionId ?? null,
    sessionId,
    seq,
    observedAt,
  })
}

/** Frozen attempt-end fact payload (fields are part of the shared contract). */
export function buildAttemptEndPayload({ attemptId, operationId, executionId, sessionId, seq, observedAt, outcome, reason, classification, followUp }) {
  return deepFreeze({
    attemptId,
    operationId: operationId ?? null,
    executionId: executionId ?? null,
    sessionId,
    seq,
    observedAt,
    outcome,
    reason: typeof reason === 'string' ? boundedText(reason) : null,
    classification,
    followUp,
  })
}

function emitContained(loopCtx, event, payload, log) {
  try {
    if (typeof loopCtx?.emit === 'function') loopCtx.emit(event, payload)
    return true
  } catch (error) {
    try {
      log?.(`plugin-api-agent-loop: attempt fact emission failed (${event}); skipped: ${error?.name ?? 'Error'}`)
    } catch {
      // diagnostics never change loop behavior
    }
    return false
  }
}

/**
 * Per-session interaction slot. Holds the FIFO of pending admissions (external
 * requests not yet assigned to an attempt) and the currently-attributed
 * attempt. `lastFollowUp` lets a `queued` attempt inherit its operation
 * attribution to the following turn (the loop's continuation of the same work).
 */
class InteractionSlot {
  constructor(sessionId, agent) {
    this.sessionId = sessionId
    this.agent = agent
    this.pending = []
    this.current = null
    this.lastFollowUp = 'none'
    // Attribution of the most recent attempt that ended with followUp
    // queued; the following turn inherits it (continuation of the same work).
    this.lastQueuedAttribution = null
  }
}

/** Well-known rejection codes of the slice's `admit`. */
export const ADMIT_REJECT_REASONS = Object.freeze(['busy', 'pending', 'no-agent', 'invalid-input'])

/**
 * Create the service-level interaction boundary. Attached to the forked
 * agent-loop service as `service[INTERACTION_ACTIVE_SYMBOL]`.
 *
 * @param {object} options
 * @param {object} [options.logger]
 * @param {() => Date} [options.now]
 * @returns {object} interaction boundary surface
 */
export function createInteractionBoundary({ logger, now = () => new Date() } = {}) {
  const slots = new Map()
  let disposed = false

  const log = (message) => {
    try {
      logger?.warn?.(`plugin-api-agent-loop: interaction: ${message}`)
    } catch {
      // diagnostics are best-effort
    }
  }

  const slotOf = (sessionId) => slots.get(sessionId)

  const dispose = () => {
    disposed = true
    slots.clear()
  }

  const attachAgent = (agent) => {
    if (disposed) return null
    const sessionId = agent?.session?.id
    if (typeof sessionId !== 'string') return null
    let slot = slots.get(sessionId)
    if (slot === undefined) {
      slot = new InteractionSlot(sessionId, agent)
      slots.set(sessionId, slot)
    } else {
      slot.agent = agent
    }
    return slot
  }

  const detachAgent = (agent) => {
    const sessionId = agent?.session?.id
    if (typeof sessionId !== 'string') return
    const slot = slots.get(sessionId)
    if (slot === undefined || slot.agent !== agent) return
    if (slot.pending.length === 0 && slot.current === null) slots.delete(sessionId)
  }

  /**
   * Admit one external request on the loop boundary exactly once.
   * @param {object} spec
   * @param {string} spec.sessionId
   * @param {string} spec.operationId
   * @param {string|undefined} spec.executionId
   * @param {string|undefined} spec.idempotencyKey
   * @returns {{accepted: true, attemptRef: {sessionId, operationId}} | {accepted: false, code, reason?}}
   */
  const admit = ({ sessionId, operationId, executionId, idempotencyKey }) => {
    if (disposed) return { accepted: false, code: 'unavailable', reason: 'interaction boundary disposed' }
    if (typeof sessionId !== 'string' || typeof operationId !== 'string') {
      return { accepted: false, code: 'invalid-input', reason: 'sessionId and operationId are required' }
    }
    const slot = slots.get(sessionId)
    if (slot === undefined) {
      return { accepted: false, code: 'no-agent', reason: 'no running agent for the session' }
    }
    if (slot.current !== null) {
      return { accepted: false, code: 'busy', reason: 'an attempt is already live on this session' }
    }
    if (slot.pending.some((entry) => entry.operationId === operationId || (idempotencyKey !== undefined && entry.idempotencyKey === idempotencyKey))) {
      return { accepted: false, code: 'pending', reason: 'the request is already pending admission' }
    }
    slot.pending.push({ operationId, executionId: executionId ?? null, idempotencyKey: idempotencyKey ?? null })
    return { accepted: true, attemptRef: { sessionId, operationId } }
  }

  /**
   * Best-effort cancellation propagation. Never writes a terminal.
   * @returns {{ok: boolean, code: string}}
   */
  const cancelAttempt = (attemptRef, { reason, signal } = {}) => {
    if (disposed || attemptRef === null || typeof attemptRef !== 'object') {
      return { ok: false, code: 'invalid-input' }
    }
    const slot = slots.get(attemptRef.sessionId)
    if (slot === undefined) return { ok: false, code: 'stale' }
    if (slot.current !== null && slot.current.operationId === attemptRef.operationId) {
      const cause = makeCancelCause(reason, signal)
      try {
        slot.agent?.cancel?.(cause, { keepInbox: true })
      } catch (error) {
        log(`cancel propagation failed: ${error?.name ?? 'Error'}`)
      }
      return { ok: true, code: 'accepted' }
    }
    const pendingIndex = slot.pending.findIndex((entry) => entry.operationId === attemptRef.operationId)
    if (pendingIndex >= 0) {
      slot.pending.splice(pendingIndex, 1)
      return { ok: true, code: 'accepted' }
    }
    return { ok: false, code: 'stale' }
  }

  const makeCancelCause = (reason, signal) => {
    const raw = reason?.message ?? (typeof reason === 'string' ? reason : undefined)
    const text = boundedText(raw)
    const cause = { kind: 'aborted', message: text.length > 0 ? text : 'cancelled' }
    if (reason?.classification === 'superseded' || reason?.superseded === true) cause[ATTEMPT_SUPERSEDED_CAUSE] = true
    return cause
  }

  /**
   * Attempt-start hook, called by the forked loop at its turn-open commit
   * point. Attributes the oldest pending admission (FIFO) or inherits the
   * previous queued attempt's attribution.
   */
  const beginAttempt = (agent, { turn, observedAt }) => {
    if (disposed) return null
    const sessionId = agent?.session?.id
    if (typeof sessionId !== 'string') return null
    const slot = attachAgent(agent)
    if (slot === null) return null
    let attribution = null
    if (slot.pending.length > 0) {
      attribution = slot.pending.shift()
    } else if (slot.lastFollowUp === 'queued' && slot.lastQueuedAttribution !== null) {
      attribution = { operationId: slot.lastQueuedAttribution.operationId, executionId: slot.lastQueuedAttribution.executionId }
    }
    const attemptId = randomUUID()
    slot.current = {
      attemptId,
      operationId: attribution?.operationId ?? null,
      executionId: attribution?.executionId ?? null,
      turn,
    }
    const payload = buildAttemptStartPayload({
      attemptId,
      operationId: slot.current.operationId,
      executionId: slot.current.executionId,
      sessionId,
      seq: turn,
      observedAt,
    })
    const emitted = emitContained(agent.loopCtx, ATTEMPT_START_EVENT, payload, log)
    return { attemptId, operationId: slot.current.operationId, executionId: slot.current.executionId, emitted, payload }
  }

  /**
   * Attempt-end hook, called by the forked loop at its turn-close commit
   * point, after the durable `turn/end` is committed.
   */
  const endAttempt = (agent, { turnEnds, superseded = false, turn, observedAt }) => {
    if (disposed) return null
    const sessionId = agent?.session?.id
    if (typeof sessionId !== 'string') return null
    const slot = slots.get(sessionId)
    if (slot === undefined || slot.current === null) return null
    const { attemptId, operationId, executionId } = slot.current
    const mapped = mapTurnEndOutcome(turnEnds, { superseded })
    const followUp = agent.inbox?.hasPending === true ? 'queued' : 'none'
    slot.lastFollowUp = followUp
    if (followUp === 'queued' && operationId !== null) {
      slot.lastQueuedAttribution = { operationId, executionId }
    } else {
      slot.lastQueuedAttribution = null
    }
    slot.current = null
    const payload = buildAttemptEndPayload({
      attemptId,
      operationId,
      executionId,
      sessionId,
      seq: turn,
      observedAt,
      outcome: mapped.outcome,
      reason: redactTurnEndReason(turnEnds),
      classification: mapped.classification,
      followUp,
    })
    const emitted = emitContained(agent.loopCtx, ATTEMPT_END_EVENT, payload, log)
    return { attemptId, operationId, executionId, outcome: mapped.outcome, followUp, emitted }
  }

  const availability = () => {
    if (disposed) return { status: 'unavailable', reason: 'interaction boundary disposed' }
    return { status: 'active', contractVersion: ATTEMPT_FACTS_CONTRACT_VERSION }
  }

  return {
    admit,
    cancelAttempt,
    beginAttempt,
    endAttempt,
    attachAgent,
    detachAgent,
    availability,
    dispose,
    slots,
  }
}

/** Shape-check a boundary (used by the main facade to probe the slice). */
export function interactionBoundaryShape(value) {
  return Boolean(
    value &&
    typeof value.admit === 'function' &&
    typeof value.cancelAttempt === 'function' &&
    typeof value.availability === 'function' &&
    typeof value.beginAttempt === 'function' &&
    typeof value.endAttempt === 'function',
  )
}

/** Resolve the interaction boundary from a forked agent-loop service instance. */
export function interactionBoundaryOf(agentLoopService) {
  const boundary = agentLoopService?.[INTERACTION_ACTIVE_SYMBOL]
  return interactionBoundaryShape(boundary) ? boundary : null
}