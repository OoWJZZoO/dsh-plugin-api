/**
 * Redaction helpers for the B facade.
 *
 * Fail-closed: unknown/secret fields are omitted. Pure functions, zero
 * harness dependencies.
 */

/** Field names that may contain secret material (always dropped, everywhere). */
const SECRET_FIELD_NAMES = Object.freeze([
  'token', 'credential', 'password', 'secret', 'privateKey', 'authorization',
  'bearer', 'apiKey', 'sessionKey', 'resumeToken', 'deviceCredential',
])

/** Field names that are always safe to expose. */
const SAFE_FIELD_NAMES = Object.freeze([
  'channelId', 'subscriptionId', 'sessionId', 'deviceId', 'generation',
  'cursor', 'dedupeKey', 'eventId', 'kind', 'emittedAt', 'scope',
  'capabilities', 'profileId', 'lifecycleState', 'redactionProfile',
  'pairingState', 'authorizationGeneration', 'createdAt', 'updatedAt',
  'revokedAt', 'reason', 'code', 'message', 'details', 'transport',
  'connectionGeneration', 'lastHeartbeatAt', 'reconnectAttempt',
])

/**
 * Deep-redact an object for a given audience.
 * Fail-closed: secret fields, unknown fields, or redaction errors → omitted.
 * @param {unknown} value
 * @param {object} [options]
 * @param {string[]} [options.allowlist] - additional safe field names.
 * @param {number} [options.maxDepth = 5]
 * @returns {unknown} redacted copy
 */
export function redactForAudience(value, { allowlist = [], maxDepth = 5 } = {}) {
  const safe = new Set([...SAFE_FIELD_NAMES, ...allowlist])
  const redact = (val, depth) => {
    if (depth > maxDepth) return undefined
    if (val === null || typeof val !== 'object') return val
    if (Array.isArray(val)) {
      const result = []
      for (let i = 0; i < val.length; i++) {
        if (i >= 100) break // bounded
        const item = redact(val[i], depth + 1)
        if (item !== undefined) result.push(item)
      }
      return result
    }
    const result = {}
    for (const key of Object.keys(val)) {
      if (SECRET_FIELD_NAMES.includes(key)) continue
      if (!safe.has(key)) continue
      const redacted = redact(val[key], depth + 1)
      if (redacted !== undefined) result[key] = redacted
    }
    return result
  }
  try {
    return redact(value, 0)
  } catch {
    return undefined
  }
}

/**
 * Redact a typed error payload for wire transmission.
 * Ensures no secret/exception details leak.
 * @param {object} error
 * @returns {object} { code, message, details }
 */
export function redactError(error) {
  return {
    code: typeof error?.code === 'string' ? error.code : 'internal',
    message: typeof error?.message === 'string' ? error.message.slice(0, 256) : 'an error occurred',
    details: {},
  }
}

/**
 * Registry of named audience redaction profiles.
 *
 * A profile is a bounded allowlist of extra field names that its audience may
 * see on top of the default safe set. Secret-field names always win over any
 * profile. Subscriptions reference a profile by id; unknown ids fail closed.
 */
export function createRedactionProfiles({ maxProfiles = 64, maxFieldsPerProfile = 128 } = {}) {
  const profiles = new Map() // id → Set<string>

  /** True when `id` names a registered profile. */
  const hasProfile = (id) => typeof id === 'string' && profiles.has(id)

  /**
   * Register (or replace) a named profile. Returns an idempotent disposer.
   * Invalid declarations are rejected with a disposer that does nothing —
   * never a wider default exposure.
   */
  const registerProfile = ({ id, allowlist }) => {
    if (
      typeof id !== 'string' || id.length === 0 || profiles.size >= maxProfiles && !profiles.has(id)
      || !Array.isArray(allowlist) || allowlist.length > maxFieldsPerProfile
      || allowlist.some((f) => typeof f !== 'string' || f.length === 0)
    ) {
      return () => false
    }
    profiles.set(id, new Set(allowlist))
    return () => { profiles.delete(id); return true }
  }

  /** Fields of one profile. */
  const allowlistOf = (id) => {
    const own = profiles.get(id)
    return own ? [...own] : []
  }

  /**
   * Union of every registered profile's fields — used at capture time so the
   * bounded replay log can serve any registered audience; per-subscription
   * filtering happens again at wire time.
   */
  const combinedAllowlist = () => {
    const union = new Set()
    for (const fields of profiles.values()) {
      for (const f of fields) union.add(f)
    }
    return [...union]
  }

  const dispose = () => { profiles.clear() }

  return Object.freeze({
    registerProfile, hasProfile, allowlistOf, combinedAllowlist, dispose,
  })
}
