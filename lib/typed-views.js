/**
 * Typed read-view helpers for projection members.
 *
 * Read paths return frozen read-only views or typed unavailable results; a
 * missing backing never throws through the caller. The unavailable result
 * follows the uniform discriminated shape `{ ok, code, reason }` with the
 * stable code `unavailable`.
 */
export const UNSUPPORTED_RESULT = Object.freeze({ ok: false, code: 'unsupported', reason: 'the backing member is unavailable' })

export function frozenView(value) {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => (item && typeof item === 'object' ? Object.freeze(item) : item)))
  if (value && typeof value === 'object') return Object.freeze(value)
  return value
}

export function unavailableResult(reason = 'the backing member is unavailable') {
  return Object.freeze({ ok: false, code: 'unavailable', reason })
}

/**
 * Invoke a backing member and normalize its result into a frozen read view.
 * Returns a typed unavailable result when the backing member is missing or
 * fails; the failure is never allowed to propagate to the caller.
 *
 * @param {object|undefined} owner
 * @param {string} method
 * @param {unknown[]} args
 * @param {string} reason  unavailable wording
 */
export function callReadMember(owner, method, args, reason) {
  if (!owner || typeof owner[method] !== 'function') return unavailableResult(reason)
  try {
    const result = Reflect.apply(owner[method], owner, args)
    if (result && typeof result.then === 'function') {
      return result.then(frozenView, (error) => {
        const message = error?.message ? `: ${error.message}` : ''
        return unavailableResult(`${reason}${message}`)
      })
    }
    return frozenView(result)
  } catch (error) {
    const message = error?.message ? `: ${error.message}` : ''
    return unavailableResult(`${reason}${message}`)
  }
}