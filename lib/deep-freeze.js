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
 * Deep-freeze every own property of `value` except the top-level `signal`
 * property, which stays writable.
 *
 * This is the `tools/execute` payload policy: the official `tools/execute`
 * contract allows wrappers to replace `exec.signal` in place while every other
 * field is read-only. The object itself is made non-extensible, nested values
 * are deep-frozen, and non-signal own properties are hardened to
 * non-writable/non-configurable when possible.
 *
 * Like `deepFreeze`, this function is total: any failure (exotic object,
 * already-non-configurable descriptor, etc.) is swallowed and the original
 * value is returned, so payload freezing never breaks a dispatch.
 *
 * @template T
 * @param {T} value - any value
 * @param {WeakSet<object>} seen - cycle guard shared across the recursion
 * @returns {T} the same value, selectively frozen when possible
 */
export function deepFreezeExceptSignal(value, seen = new WeakSet()) {
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
