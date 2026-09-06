/**
 * Read-only consumption of the shared loop boundary slice (`agent/attempt`
 * facts + the shared cancel boundary), plus the degraded evidence fallback to
 * the session activity projection.
 *
 * Ownership: the shared slice lives in `packages/agent-loop` and is
 * implemented by the session-interaction-operation line; this module ONLY
 * consumes it (Requirement 9 AC4: never dispatch, transform, veto or produce
 * those facts). A slice that is absent or version-mismatched degrades
 * honestly: evidence becomes `unknown`, the cancel boundary reports
 * unavailable, and the attempt-end subscription reports unavailable.
 *
 * Production faces are wired at the integration wave through the facade
 * internal contract; every consumer here tolerates absence.
 */

import { deepFreeze } from './deep-freeze.js'

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function boundedString(value, max = 160) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  return text ? text.slice(0, max) : undefined
}

const LIVE_STATES = ['running', 'idle', 'queued']

function normalizeGuestFacet(value) {
  return isObject(value) ? value : undefined
}

/**
 * Build the loop-facts consumer.
 * @param {{
 *   facts?: object,          // shared slice facet: { observed(sessionId), cancel: { request(spec) }, onEnd(listener) }
 *   activity?: object,       // degraded evidence facet: { observed(sessionId) } (sessions.activity projection)
 *   logger?: object,
 * }} options
 */
export function createLoopFacts({ facts, activity, logger } = {}) {
  const guest = normalizeGuestFacet(facts)
  const activityGuest = normalizeGuestFacet(activity)

  const captureFacts = () => {
    if (!guest) return undefined
    if (typeof guest.observed !== 'function') return undefined
    return guest
  }
  const captureCancel = () => {
    if (!guest || !isObject(guest.cancel) || typeof guest.cancel.request !== 'function') return undefined
    return guest.cancel
  }
  const captureOnEnd = () => {
    if (!guest || typeof guest.onEnd !== 'function') return undefined
    return guest
  }
  const captureActivity = () => {
    if (!activityGuest || typeof activityGuest.observed !== 'function') return undefined
    return activityGuest
  }

  const api = {
    /** The attempted slice is present and observable. */
    active: () => captureFacts() !== undefined,

    /**
     * Live-attempt status of a session (Requirement 5 AC2). Evidence levels:
     * `observed` (shared slice), `reconstructed` (activity fallback),
     * `unknown` (neither).
     */
    observed: (sessionId) => {
      if (typeof sessionId !== 'string' || !sessionId) {
        return deepFreeze({ evidence: 'unknown', reason: 'session id is required' })
      }
      const facts = captureFacts()
      if (facts) {
        try {
          const observed = facts.observed(sessionId)
          if (isObject(observed) && (observed.state === 'running' || observed.state === 'idle' || observed.state === 'queued')) {
            return deepFreeze({
              evidence: 'observed',
              state: observed.state,
              ...(typeof observed.attemptId === 'string' && observed.attemptId ? { attemptId: observed.attemptId } : {}),
              ...(observed.state === 'running' && !observed.attemptId ? { reason: 'live attempt observed without attempt identity' } : {}),
            })
          }
        } catch {
          return deepFreeze({ evidence: 'unknown', reason: 'shared loop slice read failed' })
        }
        return deepFreeze({ evidence: 'observed', state: 'idle' })
      }
      const activity = captureActivity()
      if (activity) {
        try {
          const observed = activity.observed(sessionId)
          if (isObject(observed) && LIVE_STATES.includes(observed.state)) {
            return deepFreeze({
              evidence: 'reconstructed',
              state: observed.state,
              ...(typeof observed.attemptId === 'string' && observed.attemptId ? { attemptId: observed.attemptId } : {}),
            })
          }
          if (isObject(observed) && observed.state === 'idle') {
            return deepFreeze({ evidence: 'reconstructed', state: 'idle' })
          }
        } catch {
          return deepFreeze({ evidence: 'unknown', reason: 'activity evidence read failed' })
        }
        return deepFreeze({ evidence: 'reconstructed', state: 'idle' })
      }
      return deepFreeze({ evidence: 'unknown', reason: 'no live-attempt evidence source is active' })
    },

    /**
     * Shared cancel boundary availability (the single stop path for
     * stop-then-restore; `by: 'system'` + restore cause is passed by the
     * restore caller, never a second cancel path).
     */
    cancelState: () => {
      const cancel = captureCancel()
      if (!cancel) return deepFreeze({ status: 'unavailable', reason: 'shared cancel boundary is inactive' })
      return deepFreeze({ status: 'active' })
    },

    /** Request a stop through the shared request authority's cancel boundary. */
    requestStop: async ({ sessionId, attemptId, cause, signal } = {}) => {
      const cancel = captureCancel()
      if (!cancel) return { ok: false, code: 'unavailable', reason: 'shared cancel boundary is inactive' }
      try {
        const outcome = await cancel.request({
          sessionId,
          ...(attemptId ? { attemptId } : {}),
          by: 'system',
          cause,
          ...(signal ? { signal } : {}),
        })
        if (!isObject(outcome) || outcome.ok !== true) {
          return {
            ok: false,
            code: isObject(outcome) && typeof outcome.code === 'string' ? outcome.code : 'denied',
            reason: isObject(outcome) && outcome.reason !== undefined ? boundedString(outcome.reason) : 'shared cancel boundary rejected the stop request',
          }
        }
        return { ok: true, code: 'requested' }
      } catch (error) {
        return { ok: false, code: 'unavailable', reason: `shared cancel boundary failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    },

    /**
     * Subscribe to attempt-end facts (auto-capture trigger). Returns an
     * unsubscribe disposer; absence yields a typed unavailable result.
     */
    onAttemptEnd: (listener) => {
      if (typeof listener !== 'function') {
        return { ok: false, code: 'invalid-input', reason: 'attempt-end listener must be a function' }
      }
      const facts = captureOnEnd()
      if (!facts) return { ok: false, code: 'unavailable', reason: 'shared loop slice is inactive' }
      let disposed = false
      let disposeInner
      try {
        const result = facts.onEnd((fact) => {
          if (disposed) return undefined
          try {
            // Propagate the listener's promise so the slice/event loop can
            // await asynchronous consumers (auto-capture dispatch).
            return listener(fact)
          } catch {
            // listener containment: a consumer callback never breaks the slice
            return undefined
          }
        })
        disposeInner = typeof result === 'function' ? result : typeof result?.dispose === 'function' ? result.dispose : undefined
      } catch {
        return { ok: false, code: 'unavailable', reason: 'shared loop slice subscription failed' }
      }
      return {
        ok: true,
        dispose: () => {
          disposed = true
          try {
            disposeInner?.()
          } catch {
            // disposal is best-effort
          }
        },
      }
    },
  }
  return api
}