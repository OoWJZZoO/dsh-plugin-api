/**
 * Host-side redaction helpers for the attention domain.
 *
 * Fail-closed rules:
 * - secret-typed keys in the submitted payload are rejected at the host
 *   boundary (never stored, never projected, never forwarded, never logged);
 * - free-text fields carrying high-entropy credential material are rejected
 *   before registration (the item must be clean before it enters any
 *   projection or forwarded payload);
 * - log exits only ever carry a bounded, key-free summary;
 * - when the payload builder cannot produce a clean message it signals
 *   `null` so the caller can omit the payload rather than leak material.
 *
 * Pure functions; zero harness dependencies.
 *
 * @module
 */

// ── Secret detection ─────────────────────────────────────────────────────────

/** Key names that mark credential/secret material (checked case-insensitively). */
const SECRET_KEY_PATTERN =
  /(^|[._-])(secret|token|passwd|password|passphrase|apikey|api[-_]?key|authorization|auth|credential|private[-_]?key|bearer)([._-]|$)/i

/** High-entropy credential value patterns caught in free text. */
const SECRET_VALUE_PATTERNS = [
  /\bsk-[a-zA-Z0-9_-]{16,}\b/,          // openai-style secret keys
  /\bAKIA[A-Z0-9]{16}\b/,               // aws access keys
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\./, // jwt material
  /\bgh[pousr]_[a-zA-Z0-9]{20,}\b/,     // github tokens
]

/**
 * Whether a key name marks credential material.
 * @param {string} key
 * @returns {boolean}
 */
export function isSecretKey(key) {
  if (typeof key !== 'string') return false
  return SECRET_KEY_PATTERN.test(key)
}

/**
 * Whether a string value carries high-entropy credential material.
 * @param {string} value
 * @returns {boolean}
 */
export function containsSecretPattern(value) {
  if (typeof value !== 'string') return false
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))
}

/**
 * Scan a module-level payload for secret key names (any nesting depth).
 * @param {object} payload
 * @param {WeakSet<object>} [seen]
 * @returns {string | null} the offending key path, or null when clean.
 */
export function findSecretKeyPath(payload, seen = new WeakSet()) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  if (seen.has(payload)) return null
  seen.add(payload)
  for (const [key, value] of Object.entries(payload)) {
    if (isSecretKey(key)) return key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const nested = findSecretKeyPath(value, seen)
      if (nested !== null) return `${key}.${nested}`
    }
  }
  return null
}

/**
 * Assert the submitted content is clean for the host boundary.
 * Rejects secret-typed keys and high-entropy credential text in the bounded
 * free-text fields. Returns the invalid-input reason, or null when clean.
 * @param {object} spec - the contribution spec (public content fields only).
 * @returns {string | null}
 */
export function redactionViolation(spec) {
  if (spec === null || typeof spec !== 'object') {
    return 'invalid input: expected an object'
  }
  const secretKey = findSecretKeyPath(spec)
  if (secretKey !== null) {
    return `invalid input: payload carries secret-typed field "${secretKey}"`
  }
  for (const field of ['title', 'body']) {
    const value = spec[field]
    if (typeof value === 'string' && containsSecretPattern(value)) {
      return `invalid input: "${field}" carries credential material`
    }
  }
  const meta = spec.meta
  if (meta !== null && typeof meta === 'object') {
    for (const [key, value] of Object.entries(meta)) {
      if (typeof value === 'string' && containsSecretPattern(value)) {
        return `invalid input: "meta.${key}" carries credential material`
      }
    }
  }
  return null
}

// ── Bounded payloads ─────────────────────────────────────────────────────────

const DEFAULT_MAX_TITLE_LENGTH = 200
const DEFAULT_MAX_BODY_LENGTH = 2000
const DEFAULT_MAX_META_BYTES = 2000
const DEFAULT_MAX_ACTIONS = 5

const META_AVAILABLE_KINDS = new Set(['string', 'number', 'boolean'])

/**
 * Bound-check the content contract fields. Returns an invalid-input reason or
 * null when every bounded field is within its bound.
 * @param {object} spec
 * @param {{ maxTitleLength?: number, maxBodyLength?: number, maxMetaBytes?: number, maxActions?: number }} [bounds]
 * @returns {string | null}
 */
export function contentBoundsViolation(spec, bounds = {}) {
  const maxTitle = bounds.maxTitleLength ?? DEFAULT_MAX_TITLE_LENGTH
  const maxBody = bounds.maxBodyLength ?? DEFAULT_MAX_BODY_LENGTH
  const maxMeta = bounds.maxMetaBytes ?? DEFAULT_MAX_META_BYTES
  const maxActions = bounds.maxActions ?? DEFAULT_MAX_ACTIONS
  if (typeof spec.title === 'string' && spec.title.length > maxTitle) {
    return `invalid input: title exceeds ${maxTitle} characters`
  }
  if (typeof spec.body === 'string' && spec.body.length > maxBody) {
    return `invalid input: body exceeds ${maxBody} characters`
  }
  if (Array.isArray(spec.actions) && spec.actions.length > maxActions) {
    return `invalid input: actions exceed ${maxActions} entries`
  }
  if (spec.meta !== null && typeof spec.meta === 'object') {
    let bytes = 0
    for (const [key, value] of Object.entries(spec.meta)) {
      if (key.length === 0) return 'invalid input: meta keys must be non-empty'
      if (value === null) return `invalid input: meta.${key} must not be null`
      if (value !== null && typeof value === 'object' && typeof value !== 'function') {
        return `invalid input: meta.${key} must be a bounded scalar`
      }
      if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return `invalid input: meta.${key} must be a bounded scalar`
      }
      if (!META_AVAILABLE_KINDS.has(typeof value)) {
        return `invalid input: meta.${key} must be a bounded scalar`
      }
      bytes += typeof value === 'string' ? value.length : JSON.stringify(value).length
    }
    if (bytes > maxMeta) return `invalid input: meta exceeds ${maxMeta} bytes`
  }
  return null
}

/**
 * Build a bounded log summary of an item. Never carries content fields.
 * @param {object} item - the live registered item.
 * @returns {string} `attention(id=..., level=..., seq=...)`-shaped line.
 */
export function attentionLogSummary(item) {
  const scope = item.scope && (item.scope.sessionId !== undefined || item.scope.workspaceId !== undefined)
    ? ` scope=${JSON.stringify(item.scope)}`
    : ''
  return `attention(id=${String(item.id)}, level=${String(item.level)}, seq=${String(item.seq)})${scope}`
}

/**
 * Produce a bounded, redacted message payload. Returns null when the payload
 * cannot be produced cleanly (fail-closed).
 * @param {object} item
 * @param {object} [opts]
 * @param {string[]} [opts.kind] - client kinds the payload is trimmed for.
 * @returns {object | null} frozen public item payload, or null on failure.
 */
export function buildRedactedItemPayload(item, opts = {}) {
  try {
    const audience = item.audience === 'all' ? 'all' : [...item.audience]
    const payload = {
      id: String(item.id),
      ownerId: String(item.ownerId),
      seq: Number(item.seq),
      level: item.level,
      title: typeof item.title === 'string' ? item.title.slice(0, DEFAULT_MAX_TITLE_LENGTH) : '',
      body: typeof item.body === 'string' ? item.body.slice(0, DEFAULT_MAX_BODY_LENGTH) : '',
      observedAt: item.observedAt,
      audience,
    }
    if (item.scope && item.scope.sessionId !== undefined) payload.scope = { sessionId: item.scope.sessionId }
    else if (item.scope && item.scope.workspaceId !== undefined) payload.scope = { workspaceId: item.scope.workspaceId }
    if (item.dedupeKey !== undefined) payload.dedupeKey = item.dedupeKey
    if (item.expiresAt !== undefined) payload.expiresAt = item.expiresAt
    if (item.actions !== undefined && item.actions.length > 0) {
      payload.actions = item.actions.map(({ id, label }) => ({ id, label }))
    }
    if (item.correlation !== null && item.correlation !== undefined) {
      const correlation = {}
      if (item.correlation.activityId !== undefined) correlation.activityId = item.correlation.activityId
      if (item.correlation.executionId !== undefined) correlation.executionId = item.correlation.executionId
      if (item.correlation.verification !== undefined) correlation.verification = item.correlation.verification
      if (Object.keys(correlation).length > 0) payload.correlation = correlation
    }
    if (item.meta !== null && item.meta !== undefined) payload.meta = { ...item.meta }
    // The public payload never carries the internal state, handlers, or the
    // notion of removal — those stay hub-private.
    const json = JSON.stringify(payload)
    if (typeof json !== 'string' || json.includes('sk-') ) {
      return null
    }
    return deepFreezePayload(payload)
  } catch {
    return null
  }
}

/**
 * Best-effort deep freeze that never throws (mirrors the facade freeze
 * contract without importing the frozen shared module).
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepFreezePayload(value, seen = new WeakSet()) {
  try {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
    if (seen.has(value)) return value
    if (Object.isFrozen(value)) return value
    seen.add(value)
    for (const key of Object.keys(value)) deepFreezePayload(value[key], seen)
    return Object.freeze(value)
  } catch {
    return value
  }
}