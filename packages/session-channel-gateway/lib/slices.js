/**
 * Incremental slices for the gateway replacement bundle
 * `@deepseek-ai/dsh-plugin-api-session-channel-gateway`.
 *
 * Two additions over the forked official host half:
 * - channel method RPC dispatch: expose `sessionChannel/{open,subscribe,ack,
 *   resume,revoke}` over a dedicated RPC channel (`/channel`) with the same
 *   trust fence as the official `/api` carrier; route to the B facade when
 *   available, otherwise return `unavailable`.
 * - remote namespace extension: register a `sessionChannel` remote namespace
 *   exposing bounded channel state projection (host-side registration).
 *
 * Pure modules; the slices take injected seams so tests can drive them
 * without a harness.
 */
import {
  CODE_INTERNAL,
  CODE_INVALID_INPUT,
  CONTRACT_SYMBOL,
  typedError,
  typedUnavailable,
} from './shared-vocab.js'

/**
 * Create a channel method RPC dispatch slice.
 *
 * Registers a `/channel` RPC route on the `connection` service (same carrier
 * pattern as the official `/api` route) that dispatches recognized channel
 * methods to the B facade when available.
 *
 * @param {{ connection: object, facade?: Function, logger?: object }} options
 *   `facade()` returns the B facade surface (or undefined).
 */
export function createChannelRpcDispatch({ connection, facade = () => undefined, logger } = {}) {
  const log = (message) => {
    try { logger?.warn?.(message) } catch { /* never throw */ }
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

  /**
   * Wire endpoint → published channel member.
   *
   * The facade publishes capabilities, not its internal dispatcher (the
   * dispatcher was internalized when the public surface was cut), so each
   * endpoint is served by the member that carries it — the same controlled
   * wrappers the dispatcher used, with the auth gate, rate limiting, audit and
   * redaction intact.
   */
  const CHANNEL_MEMBER = Object.freeze({
    'sessionChannel/open': 'acquire',
    'sessionChannel/subscribe': 'subscribe',
    'sessionChannel/fetchEvents': 'history',
    'sessionChannel/heartbeat': 'heartbeat',
    'sessionChannel/ack': 'ack',
    'sessionChannel/resume': 'resume',
    'sessionChannel/revoke': 'release',
  })

  /** Check if an endpoint is a channel method. */
  const isChannelMethod = (endpoint) => Object.hasOwn(CHANNEL_MEMBER, endpoint)

  /** Handle a channel method RPC call. */
  const handle = async (endpoint, payload, signal) => {
    const member = CHANNEL_MEMBER[endpoint]
    if (member === undefined) return typedError(CODE_INVALID_INPUT, 'unknown channel method')
    const surface = facadeSurface()
    if (surface === undefined) return typedUnavailable()
    const entry = surface[member]
    if (typeof entry !== 'function') {
      // A facade that does not publish the capability answers typed; the route
      // stays registered so the official gateway face is untouched.
      return typedUnavailable()
    }
    try {
      return await entry(payload?.args, signal)
    } catch (error) {
      return typedError(CODE_INTERNAL, error?.message ?? 'channel method dispatch failed')
    }
  }

  // Register the /channel route on the connection service.
  let disposer
  if (connection && typeof connection.rpc?.handle === 'function') {
    try {
      disposer = connection.rpc.handle('/channel', handle, { authority: 'trusted-host' })
    } catch (error) {
      log(`session-channel: channel RPC route registration failed: ${error?.name ?? 'Error'}`)
    }
  }

  return Object.freeze({
    isChannelMethod,
    handle,
    facadeSurface: facadeSurface,
    /**
     * Whether channel dispatch is active: the facade is present *and* it
     * publishes the capability members the endpoints are served by. A facade
     * without them is reported inactive rather than active-but-refusing, so
     * the boot self-check cannot claim a capability the facade does not have.
     */
    get active() {
      const surface = facadeSurface()
      if (surface === undefined) return false
      return Object.values(CHANNEL_MEMBER).every((member) => typeof surface[member] === 'function')
    },
    dispose: () => {
      if (typeof disposer === 'function') {
        try { disposer() } catch { /* never throw */ }
        disposer = undefined
      }
      return true
    },
  })
}

/**
 * Create a remote namespace extension for channel state projection.
 *
 * Publishes a `sessionChannel` remote namespace exposing bounded channel
 * state projection. The publication is best-effort (the facade may be absent
 * or the publish mechanism may not be available).
 *
 * @param {{ publish?: Function, facade?: Function, logger?: object }} options
 *   `publish(key, service)` — the host-side remote publication function
 *   (e.g., `ctx.pluginApi?.remotes?.publish`).
 */
export function createChannelRemoteNamespace({ publish, facade = () => undefined, logger } = {}) {
  const log = (message) => {
    try { logger?.warn?.(message) } catch { /* never throw */ }
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

  // Build a projection service over the facade's one-shot snapshot reader
  // (`current`); the published member keeps its own remote name.
  let disposer
  if (typeof publish === 'function') {
    const projectionService = {
      observe: (params) => {
        const surface = facadeSurface()
        if (surface === undefined) return { ok: false, error: { code: 'unavailable', message: 'channel facade is not available', details: {} } }
        if (typeof surface.current !== 'function') return { ok: false, error: { code: 'unavailable', message: 'channel snapshot is not available', details: {} } }
        try {
          return surface.current(params)
        } catch (error) {
          return { ok: false, error: { code: 'internal', message: error?.message ?? 'snapshot read failed', details: {} } }
        }
      },
    }
    try {
      disposer = publish('sessionChannel', projectionService)
    } catch (error) {
      log(`session-channel: remote namespace publish failed: ${error?.name ?? 'Error'}`)
    }
  }

  return Object.freeze({
    get active() { return typeof disposer === 'function' },
    dispose: () => {
      if (typeof disposer === 'function') {
        try { disposer() } catch { /* never throw */ }
        disposer = undefined
      }
      return true
    },
  })
}

/**
 * Attach both slices to the gateway context.
 * Returns a combined disposer.
 */
export function attachGatewaySlices({ connection, facade, publish, logger }) {
  const rpc = createChannelRpcDispatch({ connection, facade, logger })
  const remote = createChannelRemoteNamespace({ publish, facade, logger })
  return Object.freeze({
    channelRpc: rpc,
    channelRemote: remote,
    dispose: () => {
      rpc.dispose()
      remote.dispose()
      return true
    },
  })
}