/**
 * Per-method rate limiter for the B facade.
 */
import { DEFAULT_RATE_LIMITS, CODE_RATE_LIMITED, typedError } from './session-channel-shared.js'

/** Documented default bound for methods without an explicit limit (never fail-open). */
const DEFAULT_METHOD_BOUND = Object.freeze({ windowMs: 60000, maxCalls: 120 })

/**
 * Create a per-method rate limiter.
 * @param {object} [defaults] - per-method rate limit overrides (keyed by method name).
 * @returns {object} { check(method): { ok: boolean } | { ok: false, error } }
 */
export function createRateLimiter(defaults = {}) {
  const windows = new Map() // method → { windowStart, count }
  const limits = { ...DEFAULT_RATE_LIMITS, ...defaults }

  const check = (method) => {
    const limit = limits[method] ?? DEFAULT_METHOD_BOUND
    const now = Date.now()
    let entry = windows.get(method)
    if (!entry || now - entry.windowStart >= limit.windowMs) {
      entry = { windowStart: now, count: 0 }
      windows.set(method, entry)
    }
    entry.count += 1
    if (entry.count > limit.maxCalls) {
      return typedError(CODE_RATE_LIMITED, `rate limit exceeded for ${method}`)
    }
    return { ok: true }
  }

  const reset = (method) => {
    if (method) windows.delete(method)
    else windows.clear()
  }

  return Object.freeze({ check, reset })
}