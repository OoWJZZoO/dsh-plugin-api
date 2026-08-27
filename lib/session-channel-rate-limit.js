/**
 * Per-method, per-caller-bucket rate limiter for the B facade.
 *
 * Declared method bounds apply per caller bucket instead of one shared
 * global window: a single flooding caller must not be able to exhaust every
 * other caller's budget. Buckets are fixed and bounded — anonymous (no
 * credential presented), rejected (credential presented but verification
 * failed), possession (possession-only callers without a canonical device
 * id), local (local projection face), plus one bucket per verified device.
 */
import { DEFAULT_RATE_LIMITS, CODE_RATE_LIMITED, typedError } from './session-channel-shared.js'

/** Documented default bound for methods without an explicit limit (never fail-open). */
const DEFAULT_METHOD_BOUND = Object.freeze({ windowMs: 60000, maxCalls: 120 })

/** Reserved bucket names (see module doc). */
export const RATE_BUCKETS = Object.freeze({
  ANONYMOUS: 'anonymous',
  REJECTED: 'rejected',
  POSSESSION: 'possession',
  LOCAL: 'local',
})

/**
 * Create a rate limiter.
 * @param {object} [defaults] - per-method rate limit overrides (keyed by method name).
 * @returns {object} { check(method, key?) : { ok } | typed result, reset(method?) }
 */
export function createRateLimiter(defaults = {}) {
  const windows = new Map() // `${method}\u0000${bucket}` → { windowStart, count }
  const limits = { ...DEFAULT_RATE_LIMITS, ...defaults }

  const check = (method, bucket = RATE_BUCKETS.ANONYMOUS) => {
    const limit = limits[method] ?? DEFAULT_METHOD_BOUND
    const key = `${method}\u0000${bucket}`
    const now = Date.now()
    let entry = windows.get(key)
    if (!entry || now - entry.windowStart >= limit.windowMs) {
      entry = { windowStart: now, count: 0 }
      windows.set(key, entry)
    }
    entry.count += 1
    if (entry.count > limit.maxCalls) {
      return typedError(CODE_RATE_LIMITED, `rate limit exceeded for ${method}`)
    }
    return { ok: true }
  }

  const reset = (method) => {
    if (method) {
      for (const key of [...windows.keys()]) {
        if (key.startsWith(`${method}\u0000`)) windows.delete(key)
      }
    } else {
      windows.clear()
    }
  }

  return Object.freeze({ check, reset })
}
