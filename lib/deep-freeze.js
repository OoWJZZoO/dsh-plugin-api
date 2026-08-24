/**
 * Deep-freeze helper for the pluginApi.events read-only payload contract.
 *
 * Recursively freezes plain objects and arrays so a listener cannot mutate the
 * shared event payload. It is deliberately total: any failure (exotic object,
 * frozen-in-progress proxy, etc.) is swallowed and the original value is
 * returned, because a payload-freezing problem must never break a dispatch.
 */

/**
 * @template T
 * @param {T} value - any value
 * @param {WeakSet<object>} seen - cycle guard shared across the recursion
 * @returns {T} the same value, deep-frozen when possible
 */
export function deepFreeze(value, seen = new WeakSet()) {
  try {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
      return value
    }
    if (typeof value === 'function') return value
    if (seen.has(value)) return value
    if (Object.isFrozen(value)) return value
    seen.add(value)
    for (const key of Object.keys(value)) {
      deepFreeze(value[key], seen)
    }
    return Object.freeze(value)
  } catch {
    return value
  }
}

/**
 * Except-signal freeze (internal): deep-freeze every own property except the
 * top-level `signal` property, which stays writable.
 *
 * This is the `tools/execute` payload policy: the official `tools/execute`
 * contract allows wrappers to replace `exec.signal` in place while every other
 * field is read-only. The object itself is made non-extensible, nested values
 * are deep-frozen, and non-signal own properties are hardened to
 * non-writable/non-configurable when possible.
 */
function freezeExceptSignal(value, seen = new WeakSet()) {
  try {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
      return value
    }
    if (typeof value === 'function') return value
    if (seen.has(value)) return value
    seen.add(value)
    for (const key of Object.keys(value)) {
      if (key === 'signal') continue
      deepFreeze(value[key], seen)
      try {
        Object.defineProperty(value, key, { writable: false, configurable: false })
      } catch {
        // descriptor hardening is best-effort; nested values are already frozen
      }
    }
    try {
      Object.preventExtensions(value)
    } catch {
      // extension hardening is best-effort
    }
    return value
  } catch {
    return value
  }
}

/**
 * Apply a catalog freeze policy to one event argument (unified vocabulary,
 * per the earlier integration decision):
 *
 * - `'all'` (and the missing-policy default) reproduces the original original deep-freeze
 *   behavior: deep-freeze the whole value.
 * - `{ deep: string[] }` shallow-freezes the top-level object and deep-freezes
 *   only the listed top-level fields. This is the agent/* policy shape that
 *   keeps live objects (`agent`, `signal`) untouched.
 * - `'except-signal'` deep-freezes everything except the top-level `signal`
 *   property (the tools/execute policy).
 * - `'waterfall'` leaves the argument graph completely unfrozen. This is the
 *   system-prompt/assemble policy: listeners own the runtime assembly and
 *   context objects and may mutate or replace them around `await next()`.
 *
 * Like `deepFreeze`, this function is total: any failure is swallowed and the
 * original value is returned, because freezing must never break a dispatch.
 *
 * @template T
 * @param {T} value - one listener argument
 * @param {'all' | 'except-signal' | 'waterfall' | { deep: string[] }} [policy] - catalog freeze policy
 * @returns {T} the same value, frozen per policy when possible
 */
export function freezeByPolicy(value, policy) {
  if (policy === 'except-signal') return freezeExceptSignal(value)

  if (policy === 'waterfall') return value

  if (policy && typeof policy === 'object' && !Array.isArray(policy)) {
    try {
      if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
        return value
      }
      if (typeof value === 'function') return value
      Object.freeze(value)
      for (const key of policy.deep ?? []) {
        if (key in value) deepFreeze(value[key])
      }
      return value
    } catch {
      return value
    }
  }

  // 'all' or absent policy: default to the original deep-freeze deep-freeze.
  return deepFreeze(value)
}
