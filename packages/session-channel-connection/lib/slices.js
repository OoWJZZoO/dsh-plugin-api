/**
 * Incremental slices for the connection replacement bundle
 * `@deepseek-ai/dsh-plugin-api-session-channel-connection`.
 *
 * Three additions over the forked official host half:
 * - transport negotiation: only negotiate advertised AND authorized transports
 *   (transport selection is not authorization; authorization must precede
 *   opening a sensitive channel);
 * - connection-layer channel generation fencing: the connection layer keeps
 *   channel-bound generations; revoke/supersede makes old connection
 *   generations lose submission qualification (the channel-level generation
 *   authority stays with the B facade — this table is a transport-local
 *   opaque binding only);
 * - carrier-level resume re-attachment: a transport-layer re-attach primitive
 *   (channel/session semantics are owned by the B facade).
 *
 * Pure modules (zero harness dependencies); the fencing table takes injected
 * seams so tests can drive it without a harness.
 */
import {
  ADVERTISED_TRANSPORTS,
  CODE_ABORTED,
  CODE_INVALID_INPUT,
  CODE_STALE_GENERATION,
  CODE_TRANSPORT_UNAVAILABLE,
  CONTRACT_SYMBOL,
  TERMINAL_SUCCESS,
  typedError,
} from './shared-vocab.js'

const isTransport = (value) => ADVERTISED_TRANSPORTS.includes(value)

/**
 * Transport negotiation: advertised ∩ authorized.
 * Loopback is a transport like any other; nothing is authorized by default.
 *
 * @param {{ advertised?: string[], authorized?: string[] }} [options]
 */
export function createTransportNegotiation({ advertised = ADVERTISED_TRANSPORTS, authorized = [] } = {}) {
  const advertisedSet = new Set(advertised.filter(isTransport))
  const authorizedSet = new Set(authorized.filter(isTransport))
  const negotiated = () => ADVERTISED_TRANSPORTS.filter((name) => advertisedSet.has(name) && authorizedSet.has(name))
  return Object.freeze({
    advertised: () => [...advertisedSet],
    authorized: () => [...authorizedSet],
    negotiated: () => negotiated(),
    canNegotiate: (transport) => isTransport(transport) && negotiated().includes(transport),
    /** Typed result: negotiated transports, or a bounded transport-unavailable error. */
    result() {
      const list = negotiated()
      return list.length > 0
        ? { ok: true, transports: list }
        : typedError(CODE_TRANSPORT_UNAVAILABLE, 'no authorized transport is advertised')
    },
  })
}

/**
 * Connection-layer channel generation fencing table.
 *
 * `channelGeneration` here is a transport-local opaque binding: the table
 * only compares its own bindings and never makes channel lifecycle decisions
 * (the B facade is the single authority owner of channel generations).
 * When the B facade is absent or inert, the table stays inert and publishes
 * no channel capability.
 *
 * @param {{ facade?: Function, logger?: object }} [options]
 *   `facade` returns the B facade surface (or undefined); `logger` is optional.
 */
export function createFencingTable({ facade = () => undefined, logger } = {}) {
  const bindings = new Map() // channelId -> { generation, attachedAt }
  let facadeDisposer = undefined
  let attached = false

  const log = (message) => {
    try {
      logger?.warn?.(message)
    } catch {
      // diagnostics must never change outcomes
    }
  }

  const facadeSurface = () => {
    try {
      const surface = facade()
      if (surface == null || surface[CONTRACT_SYMBOL] !== true) return undefined
      return surface
    } catch {
      return undefined
    }
  }

  const attach = () => {
    const surface = facadeSurface()
    if (surface === undefined || attached) return false
    attached = true
    try {
      const disposer = surface.onChange?.((/* snapshot */) => {
        // Generation changes flow through bindings on read; the table is
        // transport-local and only compares its own bindings.
        prune()
      })
      facadeDisposer = typeof disposer === 'function' ? disposer : undefined
    } catch (error) {
      log(`session-channel: connection fencing could not subscribe to the channel facade: ${error?.name ?? 'Error'}`)
      attached = false
      return false
    }
    return true
  }

  const detach = () => {
    const disposer = facadeDisposer
    facadeDisposer = undefined
    attached = false
    bindings.clear()
    if (typeof disposer === 'function') {
      try {
        disposer()
      } catch {
        // dispose must never throw
      }
    }
  }

  const prune = () => {
    const surface = facadeSurface()
    if (surface === undefined) {
      bindings.clear()
      return
    }
    let generationOf
    try {
      generationOf = surface.channelGenerationOf
    } catch {
      generationOf = undefined
    }
    if (typeof generationOf !== 'function') return
    for (const [channelId, binding] of bindings) {
      let current
      try {
        current = generationOf(channelId)
      } catch {
        continue
      }
      if (current !== undefined && current !== binding.generation) bindings.delete(channelId)
    }
  }

  return Object.freeze({
    /** Whether channel fencing capability is published (B facade attached). */
    get active() {
      return attached && facadeSurface() !== undefined
    },
    /** Bind a channel to a connection-layer generation. */
    bind(channelId, generation) {
      if (typeof channelId !== 'string' || channelId.length === 0) return false
      if (typeof generation !== 'string' || generation.length === 0) return false
      bindings.set(channelId, { generation, attachedAt: Date.now() })
      return true
    },
    /** Whether a callback's generation still qualifies for submission. */
    isCurrent(channelId, generation) {
      if (typeof generation !== 'string') return false
      const binding = bindings.get(channelId)
      if (binding === undefined) return false
      return binding.generation === generation
    },
    /** Drop bindings for a channel (revoke/supersede path). */
    drop(channelId) {
      return bindings.delete(channelId)
    },
    /** Bounded snapshot for diagnostics/projection. */
    snapshot() {
      return Object.fromEntries(
        [...bindings.entries()].slice(0, 1000).map(([channelId, binding]) => [channelId, binding.generation]),
      )
    },
    attach,
    detach,
    prune,
  })
}

/**
 * Carrier-level resume re-attachment primitive.
 *
 * Provides a transport-layer re-attach seam: validates the connection
 * generation is still current and the caller signal is live, then returns a
 * bounded carrier handle. Channel/session resume semantics (token, window,
 * replay) are owned by the B facade; this primitive only re-attaches the
 * carrier.
 *
 * @param {{ isCurrentGeneration?: Function, logger?: object }} [options]
 *   `isCurrentGeneration(generation)` decides carrier currency (default: all
 *   generations accepted).
 */
export function createResumePrimitive({ isCurrentGeneration = () => true, logger } = {}) {
  const log = (message) => {
    try {
      logger?.warn?.(message)
    } catch {
      // diagnostics must never change outcomes
    }
  }
  return Object.freeze({
    /**
     * Re-attach the carrier for a connection generation.
     * @param {string} connectionGeneration
     * @param {AbortSignal} [signal]
     * @returns {Promise<object>} typed result
     */
    async reattach(connectionGeneration, signal) {
      if (typeof connectionGeneration !== 'string' || connectionGeneration.length === 0) {
        return typedError(CODE_INVALID_INPUT, 'connection generation must be a non-empty string')
      }
      if (signal?.aborted === true) return typedError(CODE_ABORTED, 'reattach aborted by caller')
      let current
      try {
        current = isCurrentGeneration(connectionGeneration)
      } catch (error) {
        log(`session-channel: carrier currency check failed: ${error?.name ?? 'Error'}`)
        current = false
      }
      if (current !== true) return typedError(CODE_STALE_GENERATION, 'connection generation is stale')
      return { ok: true, terminal: TERMINAL_SUCCESS, carrier: { connectionGeneration } }
    },
  })
}

/**
 * Attach all three slices to the live `connection` service.
 * Returns a disposer that detaches the fencing subscription.
 *
 * @param {object} connection - the registered `connection` service.
 * @param {{ transport?: object, fencing?: object, resume?: object }} [slices]
 */
export function attachConnectionSlices(connection, { transport, fencing, resume } = {}) {
  const transportSlice = transport ?? createTransportNegotiation()
  const fencingSlice = fencing ?? createFencingTable()
  const resumeSlice = resume ?? createResumePrimitive()
  for (const [key, value] of [['transport', transportSlice], ['fencing', fencingSlice], ['resume', resumeSlice]]) {
    Object.defineProperty(connection, key, {
      value,
      enumerable: false,
      configurable: false,
      writable: false,
    })
  }
  return Object.freeze({
    transport: transportSlice,
    fencing: fencingSlice,
    resume: resumeSlice,
    dispose: () => {
      try {
        fencingSlice.detach()
      } catch {
        // dispose must never throw
      }
      return true
    },
  })
}