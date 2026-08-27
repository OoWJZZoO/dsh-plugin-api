/**
 * Shared vocabulary for the `remote-session-channel` feature.
 *
 * Pure functions, zero harness dependencies. Used by the B facade
 * (`lib/session-channel-shared.js` in the main package) and by both
 * replacement packages (local copies). An integration test asserts
 * all three copies are 1:1 consistent.
 *
 * @module
 */

// ── Terminal outcomes ────────────────────────────────────────────────────────
export const TERMINAL_SUCCESS = 'success'
export const TERMINAL_ERROR = 'error'
export const TERMINAL_ABORTED = 'aborted'
export const TERMINAL_DENIED = 'denied'
export const TERMINAL_SUPERSEDED = 'superseded'

export const TERMINAL_OUTCOMES = Object.freeze([
  TERMINAL_SUCCESS,
  TERMINAL_ERROR,
  TERMINAL_ABORTED,
  TERMINAL_DENIED,
  TERMINAL_SUPERSEDED,
])

// ── Typed codes ─────────────────────────────────────────────────────────────
export const CODE_INVALID_INPUT = 'invalid-input'
export const CODE_PAIRING_REQUIRED = 'pairing-required'
export const CODE_DEVICE_DENIED = 'device-denied'
export const CODE_SESSION_DENIED = 'session-denied'
export const CODE_CHANNEL_EXPIRED = 'channel-expired'
export const CODE_CHANNEL_REVOKED = 'channel-revoked'
export const CODE_RESUME_REJECTED = 'resume-rejected'
export const CODE_CURSOR_GAP = 'cursor-gap'
export const CODE_RESYNC_REQUIRED = 'resync-required'
export const CODE_TRANSPORT_UNAVAILABLE = 'transport-unavailable'
export const CODE_RATE_LIMITED = 'rate-limited'
export const CODE_STALE_GENERATION = 'stale-generation'
export const CODE_SUPERSEDED = 'superseded'
export const CODE_ABORTED = 'aborted'
export const CODE_TIMEOUT = 'timeout'
export const CODE_INTERNAL = 'internal'

export const TYPED_CODES = Object.freeze([
  CODE_INVALID_INPUT,
  CODE_PAIRING_REQUIRED,
  CODE_DEVICE_DENIED,
  CODE_SESSION_DENIED,
  CODE_CHANNEL_EXPIRED,
  CODE_CHANNEL_REVOKED,
  CODE_RESUME_REJECTED,
  CODE_CURSOR_GAP,
  CODE_RESYNC_REQUIRED,
  CODE_TRANSPORT_UNAVAILABLE,
  CODE_RATE_LIMITED,
  CODE_STALE_GENERATION,
  CODE_SUPERSEDED,
  CODE_ABORTED,
  CODE_TIMEOUT,
  CODE_INTERNAL,
])

/** Codes whose terminal outcome is `denied` (a.k.a. denied variants). */
export const DENIED_VARIANTS = Object.freeze([
  CODE_PAIRING_REQUIRED,
  CODE_DEVICE_DENIED,
  CODE_SESSION_DENIED,
  CODE_RESUME_REJECTED,
])

/** Codes that represent channel consumption semantics rather than terminal states. */
export const CONSUMPTION_RESULTS = Object.freeze([
  CODE_CURSOR_GAP,
  CODE_RESYNC_REQUIRED,
])

/**
 * Map a typed code to its terminal outcome.
 *
 * Typed codes map 1:1 into the terminal vocabulary without
 * introducing a second terminal category. Consumption results (cursor-gap,
 * resync-required) map to `error` when forced; they are not terminal states
 * in the channel lifecycle.
 *
 * @param {string} code
 * @returns {string} One of TERMINAL_OUTCOMES.
 */
export function terminalOutcomeFor(code) {
  if (code === CODE_SUPERSEDED) return TERMINAL_SUPERSEDED
  if (code === CODE_ABORTED) return TERMINAL_ABORTED
  if (DENIED_VARIANTS.includes(code)) return TERMINAL_DENIED
  return TERMINAL_ERROR
}

/**
 * Build a typed error result object.
 * @param {string} code
 * @param {string} [message]
 * @param {object} [details]
 * @returns {object} `{ ok: false, error: { code, message, details } }`
 */
export function typedError(code, message = '', details = {}) {
  return { ok: false, error: { code, message, details } }
}

/**
 * Build a typed denied result (shortcut for denied variants).
 * @param {string} code - One of DENIED_VARIANTS.
 * @param {string} [reason]
 * @returns {object}
 */
export function typedDenied(code, reason = '') {
  return typedError(code, reason)
}

/**
 * Build a typed unavailable result.
 * @returns {object}
 */
export function typedUnavailable() {
  return typedError('unavailable', 'feature is not available')
}

// ── Contract symbols ───────────────────────────────────────────────────────
/** Cross-package coordination symbol. Marks the B facade's coordination surface. */
export const CONTRACT_SYMBOL = Symbol.for('dsh-plugin-api.session-channel.contract')

/** Connection R package owner marker. */
export const CONNECTION_OWNER_SYMBOL = Symbol.for('dsh-plugin-api.session-channel-connection.contract')

/** Gateway R package owner marker. */
export const GATEWAY_OWNER_SYMBOL = Symbol.for('dsh-plugin-api.session-channel-gateway.contract')

// ── Default bounds ──────────────────────────────────────────────────────────
/** Per-method default rate limits (calls per window). */
export const DEFAULT_RATE_LIMITS = Object.freeze({
  open: { windowMs: 60000, maxCalls: 10 },
  subscribe: { windowMs: 60000, maxCalls: 30 },
  ack: { windowMs: 60000, maxCalls: 120 },
  resume: { windowMs: 60000, maxCalls: 10 },
  revoke: { windowMs: 60000, maxCalls: 10 },
  observe: { windowMs: 60000, maxCalls: 120 },
  fetchEvents: { windowMs: 60000, maxCalls: 240 },
  heartbeat: { windowMs: 60000, maxCalls: 300 },
})

/** Default replay retention window (number of events). */
export const DEFAULT_REPLAY_WINDOW_EVENTS = 1000

/** Default replay retention window (milliseconds). */
export const DEFAULT_REPLAY_WINDOW_MS = 30 * 60 * 1000

// ── Transport names (connection R package) ──────────────────────────────────
export const TRANSPORT_WEBSOCKET = 'websocket'
export const TRANSPORT_SSE = 'sse'
export const TRANSPORT_POLLING = 'polling'
export const TRANSPORT_LOOPBACK = 'loopback'

export const ADVERTISED_TRANSPORTS = Object.freeze([
  TRANSPORT_WEBSOCKET,
  TRANSPORT_SSE,
  TRANSPORT_POLLING,
  TRANSPORT_LOOPBACK,
])