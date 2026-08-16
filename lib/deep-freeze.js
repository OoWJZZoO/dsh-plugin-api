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
 * Apply a catalog freeze policy to one event argument.
 *
 * - `'all'` reproduces the original E9 behavior: deep-freeze the whole value.
 * - `{ deep: string[] }` shallow-freezes the top-level object and deep-freezes
 *   only the listed top-level fields. This is the agent/* policy shape that
 *   keeps live objects (`agent`, `signal`) untouched.
 *
 * Like `deepFreeze`, this function is total: any failure is swallowed and the
 * original value is returned, because freezing must never break a dispatch.
 *
 * @template T
 * @param {T} value - one listener argument
 * @param {'all' | { deep: string[] }} [policy] - catalog freeze policy
 * @returns {T} the same value, frozen per policy when possible
 */
export function freezeByPolicy(value, policy) {
  if (policy === 'all') return deepFreeze(value)

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

  return value
}
