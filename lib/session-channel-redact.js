/**
 * Redaction helpers for the B facade.
 *
 * Fail-closed: unknown/secret fields are omitted. Pure functions, zero
 * harness dependencies.
 */
import { CODE_INTERNAL } from './session-channel-shared.js'

/** Field names that may contain secret material. */
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