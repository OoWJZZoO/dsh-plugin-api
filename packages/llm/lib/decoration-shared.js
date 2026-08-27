/**
 * Shared primitives for the adapter decoration lifecycle.
 *
 * The recursion fence and the chain executor must share one
 * `AsyncLocalStorage` instance: `chainFor` reads the store to decide which
 * decorations are already in flight for a binding, and the chain executor
 * writes that store while a decorated stream runs. Both modules import this
 * singleton.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

/** Shared async context used by the decoration recursion fence. */
export const DECORATION_ALS = new AsyncLocalStorage()

/** Declared priority tiers, lowest to highest. */
export const PRIORITY_TIERS = Object.freeze(['lowest', 'low', 'normal', 'high', 'highest'])
/** Deterministic tier ordering index (lowest first). */
export const PRIORITY_ORDER = Object.freeze({
  lowest: 0,
  low: 1,
  normal: 2,
  high: 3,
  highest: 4,
})

/** The official stream chunk type union the chain must preserve. */
export const STREAM_CHUNK_TYPES = Object.freeze([
  'block-start',
  'text-delta',
  'reasoning-delta',
  'tool-call-delta',
  'block-end',
  'usage',
  'finish',
])

/** Decoration lifecycle states. */
export const LIFECYCLE = Object.freeze({
  ACTIVE: 'active',
  DEGRADED: 'degraded',
  REVOKED: 'revoked',
  DISPOSED: 'disposed',
})

/** Binding lifecycle states. */
export const BINDING_LIFECYCLE = Object.freeze({
  ACTIVE: 'active',
  SUPERSEDED: 'superseded',
  REVOKED: 'revoked',
})

/** Bounded terminal vocabulary for decoration operations. */
export const TERMINAL = Object.freeze({
  SUCCESS: 'success',
  ERROR: 'error',
  ABORTED: 'aborted',
  SUPERSEDED: 'superseded',
})

/** Capability vocabulary v1 (requirement-anchored; unknown words are rejected). */
export const CAPABILITY_METADATA_KEYS = Object.freeze(['labels'])
export const CAPABILITY_EXECUTION_KEYS = Object.freeze(['phases', 'requestTransform', 'chunkTransform', 'retry'])
export const RETRY_MODES = Object.freeze(['none', 'evidence-only'])
export const EXECUTION_PHASES = Object.freeze(['stream'])

/**
 * Validate one stream chunk shape the chain may pass to a consumer.
 * @param {unknown} chunk
 * @returns {boolean} true for a plain object whose `type` is in the official union.
 */
export function isValidStreamChunk(chunk) {
  return (
    chunk !== null &&
    typeof chunk === 'object' &&
    STREAM_CHUNK_TYPES.includes(chunk.type)
  )
}

/**
 * Stable comparison of two priority tiers.
 * @param {string} a
 * @param {string} b
 * @returns {number} negative when a is lower, zero when equal, positive when higher.
 */
export function comparePriority(a, b) {
  return PRIORITY_ORDER[b] - PRIORITY_ORDER[a]
}
