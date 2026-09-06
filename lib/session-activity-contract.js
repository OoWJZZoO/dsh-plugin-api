/**
 * Frozen consumption-side contract for the session activity projection.
 *
 * This module is the single definition of the observation contract between
 * the projection facade (this line) and the agent-loop attempt-facts slice
 * (implemented by the session-interaction-operation line inside the existing
 * agent-loop replacement package). The projection line only consumes the
 * slice's frozen attempt facts; it never implements, modifies or substitutes
 * the slice.
 *
 * The contract marker is a global symbol (Symbol.for) so the slice can probe
 * compatibility at apply time without importing this package:
 * `agent/attempt/start` and `agent/attempt/end` payload fields must stay
 * frozen exactly as declared below (additive evolution is allowed only by
 * bumping the contract version together with the consuming implementation).
 *
 * No governance letters, requirement numbers or batch ids appear in any
 * runtime-visible string here (AGENTS.md §6).
 */
import { deepFreeze } from './deep-freeze.js'

/** Global observation-contract marker probed by the attempt-facts slice at apply. */
export const ACTIVITY_OBSERVATION_CONTRACT = Symbol.for(
  'dsh-plugin-api.session-activity.observation-contract'
)

/** Contract version shared by the consuming facade and the producing slice. */
export const ACTIVITY_OBSERVATION_CONTRACT_VERSION = 1

/** Closed evidence classification vocabulary (four members never collapse). */
export const EVIDENCE_LEVELS = Object.freeze([
  'observed',
  'reconstructed',
  'unknown',
  'unavailable',
])

/** Terminal outcome vocabulary (lifecycle words are not terminal values). */
export const TERMINAL_OUTCOMES = Object.freeze([
  'success',
  'error',
  'aborted',
  'denied',
  'superseded',
])

/** Post-attempt queue follow-up vocabulary (frozen slice payload). */
export const FOLLOW_UP_VALUES = Object.freeze(['none', 'queued'])

/** Interim status phases (in-progress) — never lifecycle words. */
export const STATUS_PHASES = Object.freeze([
  'preparing',
  'running',
  'waiting',
  'interrupted',
])

/** Waiting kinds per evidence (only set when evidence is present). */
export const WAITING_KINDS = Object.freeze([
  'approval',
  'question',
  'user-message',
  'tool',
  'queued',
])

/**
 * Shared adjudication priority for one uncommitted terminal window
 * (applied exactly once, then the terminal is frozen).
 */
export const ADJUDICATION_PRIORITY = Object.freeze([
  'aborted',
  'superseded',
  'error',
  'timeout-error',
])

/** Frozen payload field lists for the attempt-facts slice events. */
export const ATTEMPT_START_FIELDS = Object.freeze([
  'attemptId',
  'operationId',
  'executionId',
  'sessionId',
  'seq',
  'observedAt',
])

export const ATTEMPT_END_FIELDS = Object.freeze([
  'attemptId',
  'operationId',
  'executionId',
  'sessionId',
  'outcome',
  'reason',
  'classification',
  'followUp',
  'seq',
  'observedAt',
])

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function validAttemptStart(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false
  if (!isNonEmptyString(payload.attemptId)) return false
  if (!isNonEmptyString(payload.sessionId)) return false
  if (!Number.isInteger(payload.seq) || payload.seq < 0) return false
  if (!isNonEmptyString(payload.observedAt)) return false
  // `null` is a serialized absent value for the optional correlation fields
  // (the producer emits null keys when the value is missing); only a
  // present-but-invalid value is rejected.
  if (payload.operationId != null && !isNonEmptyString(payload.operationId)) return false
  if (payload.executionId != null && !isNonEmptyString(payload.executionId)) return false
  return true
}

function validAttemptEnd(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false
  if (!isNonEmptyString(payload.attemptId)) return false
  if (!isNonEmptyString(payload.sessionId)) return false
  if (!TERMINAL_OUTCOMES.includes(payload.outcome)) return false
  if (!FOLLOW_UP_VALUES.includes(payload.followUp)) return false
  if (!Number.isInteger(payload.seq) || payload.seq < 0) return false
  if (!isNonEmptyString(payload.observedAt)) return false
  // same absent-value normalization as the start validator
  if (payload.operationId != null && !isNonEmptyString(payload.operationId)) return false
  if (payload.executionId != null && !isNonEmptyString(payload.executionId)) return false
  if (payload.reason != null && typeof payload.reason !== 'string') return false
  if (payload.classification != null && typeof payload.classification !== 'string') return false
  return true
}

/**
 * The frozen observation contract object installed at the global marker.
 * The slice's apply-time self-check reads this shape (version + frozen field
 * lists + validation helpers) to prove compatibility before activating.
 */
export function activityObservationContract() {
  return deepFreeze({
    version: ACTIVITY_OBSERVATION_CONTRACT_VERSION,
    events: Object.freeze(['agent/attempt/start', 'agent/attempt/end']),
    attemptStart: deepFreeze({ fields: ATTEMPT_START_FIELDS, validate: validAttemptStart }),
    attemptEnd: deepFreeze({ fields: ATTEMPT_END_FIELDS, validate: validAttemptEnd }),
    outcomes: TERMINAL_OUTCOMES,
    followUp: FOLLOW_UP_VALUES,
  })
}