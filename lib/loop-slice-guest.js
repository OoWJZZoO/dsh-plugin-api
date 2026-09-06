/**
 * Integration-wave guest facet over the shared loop boundary slice.
 *
 * The shared loop boundary slice lives in the agent-loop replacement package
 * (implemented by the session-interaction-operation line) and is consumed
 * read-only by the session-activity-projection and checkpoint-restore-contract
 * lines. This module is the integration-wave adapter that presents the slice
 * boundary as the neutral guest facet consumed by those consumers:
 *
 * - `observed(sessionId)` — live-attempt state derived from the boundary slots
 *   (`running` with attempt identity / `queued` / `idle`);
 * - `cancel.request({ sessionId, attemptId?, by, cause, signal })` — the
 *   shared single stop path (`by: 'system'` + restore cause for
 *   stop-then-restore; never a second cancel channel);
 * - `onEnd(listener)` — attempt-end fact subscription (auto-capture trigger);
 * - `active()` / `versionOk()` — slice liveness and contract-version match.
 *
 * Every member is fail-safe: an absent or version-mismatched boundary reports
 * typed unavailable/degraded and never throws through assembly callers.
 */
import { resolveAgentLoopBoundary } from './session-interaction-operation-authority.js'
import { ACTIVITY_OBSERVATION_CONTRACT } from './session-activity-contract.js'

/** Shared attempt-fact event names (frozen vocabulary of the slice). */
export const ATTEMPT_START_EVENT = 'agent/attempt/start'
export const ATTEMPT_END_EVENT = 'agent/attempt/end'

/** Shared slice contract version (numeric comparison; see r-slice-record). */
export const ATTEMPT_FACTS_CONTRACT_VERSION = 1

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

/**
 * Resolve the boundary plus its version-qualified status.
 * @param {object} ctx
 * @returns {{ boundary: object|null, versionOk: boolean }}
 */
export function resolveLoopSliceState(ctx) {
  let boundary = null
  let versionOk = false
  try {
    boundary = resolveAgentLoopBoundary(ctx)
  } catch {
    boundary = null
  }
  if (boundary !== null) {
    try {
      const probe = boundary.availability?.()
      versionOk = Number(probe?.contractVersion) === Number(ATTEMPT_FACTS_CONTRACT_VERSION)
    } catch {
      versionOk = false
    }
  }
  return { boundary, versionOk }
}

/**
 * Build the read-only guest facet over the shared loop boundary slice.
 *
 * @param {{ ctx: object, logger?: object }} options
 * @returns {{
 *   active: () => boolean,
 *   versionOk: () => boolean,
 *   observed: (sessionId: string) => object|undefined,
 *   cancel: { request: (input: object) => Promise<object> },
 *   onEnd: (listener: Function) => object,
 * }}
 */
export function createLoopSliceGuestFacet({ ctx, logger } = {}) {
  const state = () => resolveLoopSliceState(ctx)

  const observed = (sessionId) => {
    const { boundary } = state()
    if (boundary === null || typeof sessionId !== 'string' || !sessionId) return undefined
    try {
      const slot = boundary.slots?.get?.(sessionId)
      if (slot === undefined || slot === null) return { state: 'idle' }
      if (slot.current !== null && slot.current !== undefined) {
        return {
          state: 'running',
          ...(typeof slot.current.attemptId === 'string' && slot.current.attemptId ? { attemptId: slot.current.attemptId } : {}),
        }
      }
      if (Array.isArray(slot.pending) && slot.pending.length > 0) return { state: 'queued' }
      return { state: 'idle' }
    } catch {
      return undefined
    }
  }

  const requestStop = async ({ sessionId, attemptId, by, cause, signal } = {}) => {
    const { boundary, versionOk } = state()
    if (boundary === null) {
      return { ok: false, code: 'unavailable', reason: 'shared loop boundary is inactive' }
    }
    if (!versionOk) {
      return { ok: false, code: 'unavailable', reason: 'shared loop boundary contract version mismatch' }
    }
    if (typeof sessionId !== 'string' || !sessionId) {
      return { ok: false, code: 'invalid-input', reason: 'session id is required' }
    }
    try {
      const reason = {
        message: typeof cause === 'string' && cause.length > 0 ? cause : 'system stop',
        ...(by === 'system' ? { classification: 'system' } : {}),
      }
      const outcome = boundary.cancelAttempt?.(
        { sessionId, ...(typeof attemptId === 'string' && attemptId ? { operationId: attemptId } : {}) },
        { reason, ...(signal ? { signal } : {}) },
      )
      if (isObject(outcome) && outcome.ok === true) return { ok: true, code: 'requested' }
      return {
        ok: false,
        code: isObject(outcome) && typeof outcome.code === 'string' ? outcome.code : 'denied',
        reason: isObject(outcome) && typeof outcome.reason === 'string' ? outcome.reason : 'shared cancel boundary rejected the stop request',
      }
    } catch (error) {
      return { ok: false, code: 'unavailable', reason: `shared cancel boundary failed: ${String(error?.message ?? error)}` }
    }
  }

  const onEnd = (listener) => {
    if (typeof listener !== 'function') return { ok: false, code: 'invalid-input', reason: 'listener must be a function' }
    if (typeof ctx?.on !== 'function') return { ok: false, code: 'unavailable', reason: 'shared event substrate is unavailable' }
    try {
      let inner = () => {}
      const disposer = ctx.on(ATTEMPT_END_EVENT, (payload) => {
        try {
          inner = listener(payload) ?? inner
        } catch {
          // consumer containment: a faulty listener never breaks the slice
        }
      })
      const dispose = () => {
        try {
          disposer?.()
          inner?.()
        } catch {
          // disposal is best-effort
        }
      }
      return { ok: true, dispose }
    } catch {
      return { ok: false, code: 'unavailable', reason: 'attempt-end subscription failed' }
    }
  }

  return {
    active: () => state().boundary !== null,
    versionOk: () => state().versionOk,
    observed,
    cancel: { request: requestStop },
    onEnd,
  }
}

/**
 * Wait for one attempt terminal through the shared attempt-end facts.
 * Used by the checkpoint restore authority as its terminal waiter
 * (`waitForTerminal(attemptId, { timeoutMs, signal })`).
 *
 * @param {{ ctx: object }} options
 * @returns {(attemptId: string, opts?: object) => Promise<object>}
 */
export function createAttemptEndWaiter({ ctx }) {
  return (attemptId, { timeoutMs = 30_000, signal } = {}) => new Promise((resolve) => {
    let finished = false
    const finish = (value) => {
      if (finished) return
      finished = true
      try {
        off?.()
      } catch {
        // best-effort
      }
      if (typeof timer !== 'undefined') clearTimeout(timer)
      resolve(value)
    }
    const timeout = () => finish({ ok: false, code: 'timeout', reason: 'attempt did not reach a terminal within the wait window' })
    const timer = setTimeout(timeout, Math.max(1, Math.floor(timeoutMs)))
    if (typeof timer?.unref === 'function') timer.unref()
    const onAbort = () => finish({ ok: false, code: 'aborted', reason: 'wait cancelled' })
    signal?.addEventListener?.('abort', onAbort, { once: true })
    let off = () => {}
    try {
      const disposer = ctx?.on?.(ATTEMPT_END_EVENT, (payload) => {
        if (finished) return
        if (payload?.attemptId !== attemptId) return
        if (payload?.attemptId === attemptId) {
          // The terminal waiter contract reports the terminal outcome value
          // (the authority consumes it against its frozen terminal table);
          // classification and timing remain available on the attempt facts.
          finish({ ok: true, terminal: payload.outcome })
        }
      })
      off = typeof disposer === 'function' ? disposer : () => {}
    } catch {
      finish({ ok: false, code: 'unavailable', reason: 'attempt-end subscription failed' })
    }
  })
}

/** Marker readers shared by the assembly (observation contract probe). */
export { ACTIVITY_OBSERVATION_CONTRACT }