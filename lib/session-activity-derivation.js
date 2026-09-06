/**
 * Derivation engine for the session activity projection.
 *
 * Reconstruction rules: every candidate the engine produces is marked
 * `reconstructed` together with its rule name, and is only ever applied when
 * no observed (slice) evidence owns the decision. Strictly no overclaim:
 * silence is never turned into success, and a slice-observed outcome is never
 * overridden by a heuristic.
 *
 * The shared adjudication priority folds competing candidates for one
 * uncommitted terminal window into a single candidate; the store commits
 * exactly one terminal per record, so the priority is applied at most once
 * and the result is frozen.
 */
import { ADJUDICATION_PRIORITY } from './session-activity-contract.js'

export const DERIVATION_RULES = Object.freeze([
  'superseded-by-boundary',
  'turn-completed-idle',
  'agent-error',
  'denied-by-approval',
  'timeout',
])

function priorityOf(candidate) {
  const key = candidate.outcome === 'error' && candidate.classification === 'timeout'
    ? 'timeout-error'
    : candidate.outcome
  const index = ADJUDICATION_PRIORITY.indexOf(key)
  return index === -1 ? ADJUDICATION_PRIORITY.length : index
}

/**
 * Fold a list of competing terminal candidates into one (or none).
 * Applied once: callers feed a single window; the store freezes the result.
 *
 * @param {Array<object>} candidates
 * @returns {object | null}
 */
export function adjudicateTerminals(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null
  const sorted = [...candidates].sort((a, b) => priorityOf(a) - priorityOf(b))
  return sorted[0]
}

/**
 * Evaluate reconstruction candidates for one open record given the latest
 * derivation evidence. Returns candidates before adjudication.
 *
 * @param {object} record - an open record snapshot (store.get / current)
 * @param {{ turnCompleted?: boolean, agentError?: boolean, approvalRejected?: boolean,
 *           timeout?: string, openApprovals?: number, openTools?: number }} evidence
 * @returns {Array<object>} candidate terminal facts (confidence 'reconstructed')
 */
export function deriveTerminalCandidates(record, evidence = {}) {
  if (!record || record.terminal) return []
  if (record.fidelity?.sliceObserved) {
    // A slice-observed outcome owns the decision; heuristics never override it.
    return []
  }
  const candidates = []
  const bump = (candidate) => {
    if (!candidates.some((entry) => entry.ruleName === candidate.ruleName)) candidates.push(candidate)
  }
  if (evidence.turnCompleted === true && (evidence.openApprovals ?? 0) === 0 && (evidence.openTools ?? 0) === 0) {
    bump({
      outcome: 'success',
      confidence: 'reconstructed',
      ruleName: 'turn-completed-idle',
      classification: 'turn-completed-idle',
    })
  }
  if (evidence.agentError === true) {
    bump({
      outcome: 'error',
      confidence: 'reconstructed',
      ruleName: 'agent-error',
      classification: 'agent-error',
    })
  }
  if (evidence.approvalRejected === true) {
    bump({
      outcome: 'denied',
      confidence: 'reconstructed',
      ruleName: 'denied-by-approval',
      classification: 'denied-by-approval',
    })
  }
  if (typeof evidence.timeout === 'string' && evidence.timeout !== '') {
    bump({
      outcome: 'error',
      confidence: 'reconstructed',
      ruleName: 'timeout',
      classification: 'timeout',
      reason: evidence.timeout,
    })
  }
  return candidates
}

/**
 * Convenience wrapper: derive and adjudicate in one step.
 *
 * @param {object} record
 * @param {object} evidence
 * @returns {object | null}
 */
export function deriveTerminal(record, evidence) {
  return adjudicateTerminals(deriveTerminalCandidates(record, evidence))
}