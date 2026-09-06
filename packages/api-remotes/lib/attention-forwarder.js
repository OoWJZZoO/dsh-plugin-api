/**
 * Attention forwarding slice for `@deepseek-ai/dsh-plugin-api-api-remotes`.
 *
 * The hub (host facade) is the single item authority and emits attention
 * updates: `attention.snapshot` / `attention.delta` messages (frozen,
 * redacted, with item id/seq/epoch). This slice subscribes to that source and
 * pushes frames onto the official host→browser event stream. The wire frame
 * shape matches the official forwarding loop
 * (`{ type: 'host/remote-event', event, args }` used by the host api proxy),
 * so the attention route rides the same pipeline instead of a parallel
 * private channel. The extension never enters the consumer-side
 * `ctx.remote.$on` legal key set (kept at the reproduced official allowlist);
 * the browser runtime receives it through the replaced module's own receiver
 * channel and third-party consumers reach it via `ctx.pluginApi.attention`.
 *
 * Pure module with dependency-injection seams; zero harness dependencies.
 *
 * @module
 */

import {
  ATTENTION_UPDATE_EVENT,
  ATTENTION_KINDS,
  keepAttentionOutOfAllowlist,
} from './shared-vocab.js'

/**
 * Shape-check an inbound attention update message (shape-only validation;
 * the host enforces redaction before this slice ever sees the payload).
 * @param {unknown} message
 * @returns {boolean}
 */
export function isValidAttentionUpdate(message) {
  if (message === null || typeof message !== 'object') return false
  const kind = message.kind
  if (!ATTENTION_KINDS.includes(kind)) return false
  if (typeof message.epoch !== 'number' || typeof message.seq !== 'number') return false
  if (kind === 'attention.snapshot') return Array.isArray(message.items)
  if (!Array.isArray(message.changes)) return false
  return message.changes.every((entry) => entry !== null
    && typeof entry === 'object'
    && typeof entry.id === 'string'
    && typeof entry.op === 'string')
}

/**
 * Build the forwarded frame exactly like the official forwarding loop.
 * @param {object} message - validated attention update message.
 * @returns {object} frozen `host/remote-event` frame for `attention/update`.
 */
export function buildAttentionFrame(message) {
  const frame = {
    type: 'host/remote-event',
    event: ATTENTION_UPDATE_EVENT,
    args: [cloneJsonSafe(message)],
  }
  return deepFreezeObject(frame)
}

/** Clone a JSON-safe message so the shared hub payload cannot be mutated. */
function cloneJsonSafe(message) {
  try {
    const json = JSON.stringify(message)
    return json === undefined ? null : JSON.parse(json)
  } catch {
    return null
  }
}

/** Best-effort deep freeze that never throws. */
function deepFreezeObject(value, seen = new WeakSet()) {
  try {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
    if (seen.has(value)) return value
    if (Object.isFrozen(value)) return value
    seen.add(value)
    for (const key of Object.keys(value)) deepFreezeObject(value[key], seen)
    return Object.freeze(value)
  } catch {
    return value
  }
}

/**
 * Create the attention forwarder.
 *
 * @param {object} [options]
 * @param {object} [options.logger] - cordis-style logger with bounded methods.
 * @param {number} [options.maxInFlight] - bounded push counter guard.
 * @returns {object} forwarder surface.
 */
export function createAttentionForwarder(options = {}) {
  const logger = options.logger
  const maxInFlight = options.maxInFlight ?? 1000
  const allowlist = options.allowlist ?? []
  let attached = false
  let unsubscribe = null
  let pushed = 0

  function log(message) {
    try {
      logger?.debug?.(`api-remotes: ${message}`)
    } catch {
      // diagnostics must never change outcome
    }
  }

  /**
   * Attach the forwarder to a hub update source and a browser event stream.
   * @param {object} wiring
   * @param {{ subscribe: (listener: (message: object) => void) => () => void }} wiring.source
   * @param {{ push: (frame: object) => void }} wiring.stream
   * @returns {{ ok: boolean, code: string, reason?: string }}
   */
  function attach({ source, stream, snapshot }) {
    if (attached) return { ok: false, code: 'conflict', reason: 'already attached' }
    if (source === null || source === undefined || typeof source.subscribe !== 'function') {
      return { ok: false, code: 'unavailable', reason: 'attention update source is not reachable' }
    }
    if (stream === null || stream === undefined || typeof stream.push !== 'function') {
      return { ok: false, code: 'unavailable', reason: 'browser event stream is not reachable' }
    }
    if (!keepAttentionOutOfAllowlist({ forwardedEvents: allowlist, attentionEvent: ATTENTION_UPDATE_EVENT })) {
      return { ok: false, code: 'conflict', reason: 'attention event is inside the consumer allowlist' }
    }
    unsubscribe = source.subscribe((message) => {
      if (!isValidAttentionUpdate(message)) {
        log('dropping malformed attention update')
        return
      }
      if (pushed >= maxInFlight) {
        log('forwarding bound reached; dropping frame')
        return
      }
      const frame = buildAttentionFrame(message)
      if (frame.args[0] === null) {
        log('dropping attention update that could not be copied')
        return
      }
      try {
        stream.push(frame)
        pushed += 1
      } catch {
        log('browser event stream push failed')
      }
    })
    // On attach, seed the stream with a fresh host snapshot so the browser
    // runtime can rebuild its projection after a rebind (Requirements R6 AC1).
    if (snapshot !== undefined && typeof snapshot === 'function') {
      try {
        const current = snapshot()
        if (current !== null && current !== undefined && Array.isArray(current.items)) {
          const snapshotMessage = {
            kind: 'attention.snapshot',
            epoch: current.epoch ?? 0,
            seq: current.seq ?? 0,
            items: current.items.map((item) => ({ ...item })),
          }
          if (isValidAttentionUpdate(snapshotMessage)) {
            stream.push(buildAttentionFrame(snapshotMessage))
          }
        }
      } catch {
        log('initial host snapshot could not be produced; deltas will still flow')
      }
    }
    attached = true
    return { ok: true, code: 'attached' }
  }

  function detached() {
    return !attached
  }

  function dispose() {
    if (unsubscribe !== null) {
      try {
        unsubscribe()
      } catch {
        // idempotent teardown
      }
      unsubscribe = null
    }
    attached = false
  }

  function stats() {
    return { attached, pushed }
  }

  return { attach, detached, dispose, stats, name: 'attention-forwarder' }
}