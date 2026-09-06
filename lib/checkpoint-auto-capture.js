/**
 * Auto-capture policy (Requirement 9): owner-scoped, default off, bounded and
 * observable. Subscribes read-only to the shared loop boundary slice's
 * attempt-end facts and, at the declared cadence, triggers a branch-anchored
 * capture through the capture authority. Auto-captured checkpoints are normal
 * records carrying `autoTrigger: 'attempt-end'` provenance. Without the slice
 * the policy is unavailable (never fires, never fabricates).
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

/**
 * Build the auto-capture policy.
 * @param {{
 *   facts: object,        // createLoopFacts
 *   capture: object,      // capture authority { create(spec, caller) }
 *   ownerOf?: Function,
 *   store?: object,       // optional durable counter base (absent = session-lifetime state)
 *   logger?: object,
 * }} options
 */
export function createAutoCapturePolicy({ facts, capture, ownerOf, store, logger } = {}) {
  let enabled = false
  let cadence = { kind: 'every-attempt' }
  let reason
  let subscription = undefined
  const counters = new Map() // `resourceId` -> { attempts, created, last }
  let policyOwner

  const availability = () => {
    if (!facts || typeof facts.onAttemptEnd !== 'function' || facts.active?.() !== true) {
      return deepFreeze({ status: 'unavailable', reason: 'shared loop boundary slice is inactive' })
    }
    if (!capture || typeof capture.create !== 'function') {
      return deepFreeze({ status: 'unavailable', reason: 'capture authority is not active' })
    }
    return deepFreeze({ status: 'active' })
  }

  const pullState = () => {
    const out = {}
    for (const [resourceId, counter] of counters) {
      out[resourceId] = deepFreeze({ ...counter })
    }
    return out
  }

  const handleAttemptEnd = async (fact) => {
    if (!enabled) return
    if (!isObject(fact)) return
    const sessionId = fact.sessionId ?? fact.scope?.sessionId
    if (typeof sessionId !== 'string' || !sessionId) return
    const counter = counters.get(sessionId) ?? { attempts: 0, created: 0 }
    counter.attempts += 1
    const shouldCapture = cadence.kind === 'every-attempt'
      ? true
      : cadence.kind === 'every-n' && cadence.n >= 1 && counter.attempts % cadence.n === 0
    if (!shouldCapture) {
      counters.set(sessionId, counter)
      return
    }
    const owner = policyOwner
    const result = await capture.create({
      scope: { sessionId },
      source: { kind: 'branch' },
      reason: boundedString(reason) ?? 'automatic checkpoint at attempt boundary',
      correlation: isObject(fact) && typeof fact.attemptId === 'string' ? { attemptId: fact.attemptId } : undefined,
      autoTrigger: 'attempt-end',
    }, { owner })
    if (isObject(result) && result.ok === true) {
      counter.created += 1
      counter.last = result.summary?.checkpointId
    }
    counters.set(sessionId, counter)
    return result
  }

  const api = {
    availability,

    /** Policy state — observable and bounded. */
    status: () => deepFreeze({
      enabled,
      cadence: deepFreeze({ ...cadence }),
      ...(policyOwner ? { owner: policyOwner } : {}),
      ...(reason ? { reason: boundedString(reason) } : {}),
      attempts: Object.fromEntries([...counters.entries()].map(([id, counter]) => [id, deepFreeze({ ...counter })])),
      sliceActive: availability().status === 'active',
    }),

    /**
     * Enable the policy with an explicit cadence (Requirement 9 AC2: never
     * auto-captures beyond the declared cadence without explicit enablement).
     */
    enable: ({ owner, cadence: declared = { kind: 'every-attempt' }, reason: why } = {}) => {
      if (!owner) return deepFreeze({ ok: false, code: 'invalid-input', reason: 'owner is required to enable the auto-capture policy' })
      const kind = declared?.kind
      if (kind !== 'every-attempt' && kind !== 'every-n') {
        return deepFreeze({ ok: false, code: 'invalid-input', reason: 'cadence must be every-attempt or every-n' })
      }
      if (kind === 'every-n' && (!Number.isInteger(declared.n) || declared.n < 1 || declared.n > 1000)) {
        return deepFreeze({ ok: false, code: 'invalid-input', reason: 'every-n cadence requires n in 1..1000' })
      }
      if (availability().status !== 'active') {
        return deepFreeze({ ok: false, code: 'unavailable', reason: availability().reason ?? 'auto-capture is unavailable' })
      }
      if (enabled && policyOwner !== undefined && policyOwner !== owner) {
        return deepFreeze({ ok: false, code: 'conflict', reason: 'the auto-capture policy is already owned by another plugin' })
      }
      enabled = true
      policyOwner = owner
      cadence = { kind, ...(kind === 'every-n' ? { n: declared.n } : {}) }
      reason = boundedString(why)
      if (!subscription) {
        const subscribed = facts.onAttemptEnd(handleAttemptEnd)
        if (subscribed.ok === true) subscription = subscribed
        else {
          enabled = false
          return deepFreeze({ ok: false, code: 'unavailable', reason: subscribed.reason ?? 'attempt-end subscription failed' })
        }
      }
      return deepFreeze({ ok: true, code: 'enabled', policy: api.status() })
    },

    /** Disable the policy (idempotent). */
    disable: () => {
      enabled = false
      if (subscription) {
        try {
          subscription.dispose?.()
        } catch {
          // disposal is best-effort
        }
        subscription = undefined
      }
      return deepFreeze({ ok: true, code: 'disabled' })
    },

    /** Direct dispatch hook used by tests and the slice wiring hook. */
    onAttemptEnd: handleAttemptEnd,

    state: pullState,
  }
  return api
}