/**
 * Turn-stopping decision participation slice — additive capability of the
 * agent-loop replacement (decision participation contract).
 *
 * The official loop dispatches `agent/turn-stopping` serially and then ends
 * the turn when no next-step inbox entries remain; the dispatch has no return
 * channel, so third parties cannot continue a turn from the event alone. This
 * slice routes the same dispatch point into the facade's decision
 * participation chain through the contract marker the main facade installs on
 * its `pluginApi` service (global symbol key; this module never imports the
 * facade):
 *
 *   1. after the official serial dispatch and its abort re-check, the slice
 *      invokes the participation chain once with `{ agent, turn, signal }`;
 *   2. a converged `{ kind: 'continue', message }` decision is applied
 *      through the loop's own official inbox splice (`inject`), so
 *      continuation stays governed by the loop's existing next-step re-check
 *      (no new loop semantics);
 *   3. the chain owns priority order, payload freezing, per-participant fault
 *      containment and convergence; the slice adds only a bounded shape check
 *      and containment — a slice failure never changes the loop's official
 *      event timing or decisions.
 */

/** Contract marker installed on the facade `pluginApi` service (main side). */
export const TURN_STOPPING_PARTICIPATION_SYMBOL = Symbol.for('dsh-plugin-api.agents.decisions.turn-stopping')
export const TURN_STOPPING_PARTICIPATION_CONTRACT_VERSION = 1

/**
 * Resolve the turn-stopping participation contract from the facade service.
 * Returns undefined when the facade is absent, the feature did not mount, or
 * the contract version does not match.
 */
export function probeTurnStoppingParticipation(pluginApi) {
  try {
    const contract = pluginApi?.[TURN_STOPPING_PARTICIPATION_SYMBOL]
    if (contract?.contractVersion === TURN_STOPPING_PARTICIPATION_CONTRACT_VERSION && typeof contract?.invoke === 'function') {
      return contract
    }
  } catch {
    // Probing never throws into the loop constructor.
  }
  return undefined
}

/**
 * Turn-stopping dispatch-point slice: consult the participation chain and
 * apply a converged continue decision through the loop's official inbox
 * splice. Aborts propagate with the loop's official semantics (the caller's
 * `throwIfAborted` contract); every other failure is contained.
 */
export async function applyTurnStoppingParticipation(loop, { turn, signal }) {
  const contract = loop?.turnStoppingParticipation
  if (!contract || signal?.aborted) return
  let decision
  try {
    decision = await contract.invoke({ agent: loop, turn, signal })
  } catch (error) {
    if (signal?.aborted) {
      // Mirror the official abort re-check: the signal reason is what the
      // loop's own abort path expects.
      if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted()
      throw error
    }
    return
  }
  signal?.throwIfAborted?.()
  if (decision?.kind !== 'continue') return
  const message = decision.message
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return
  try {
    loop.inject(message)
  } catch {
    // A failed splice leaves the official stop semantics untouched.
  }
}
