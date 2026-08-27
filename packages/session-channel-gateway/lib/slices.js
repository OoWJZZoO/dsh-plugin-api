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
  CONTRACT_SYMBOL,
  typedError,
  typedUnavailable,
} from './shared-vocab.js'

/** Channel method endpoints. */
const CHANNEL_METHODS = Object.freeze([
  'sessionChannel/open',
  'sessionChannel/subscribe',
  'sessionChannel/fetchEvents',
  'sessionChannel/heartbeat',
  'sessionChannel/ack',
  'sessionChannel/resume',
  'sessionChannel/revoke',
])

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

  /** Check if an endpoint is a channel method. */
  const isChannelMethod = (endpoint) => CHANNEL_METHODS.includes(endpoint)

  /** Handle a channel method RPC call. */
  const handle = async (endpoint, payload, signal) => {
    const surface = facadeSurface()
    if (surface === undefined || typeof surface.dispatchChannelMethod !== 'function') {
      return typedUnavailable()
    }
    try {
      return await surface.dispatchChannelMethod(endpoint, payload, signal)
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
    /** Whether channel dispatch is active (facade present). */
    get active() { return facadeSurface() !== undefined },
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
 *   (e.g., `ctx.pluginApi?.remote?.publish`).
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

  // Build a projection service that reflects the facade's observe/onChange.
  let disposer
  if (typeof publish === 'function') {
    const projectionService = {
      observe: (params) => {
        const surface = facadeSurface()
        if (surface === undefined) return { ok: false, error: { code: 'unavailable', message: 'channel facade is not available', details: {} } }
        if (typeof surface.observe !== 'function') return { ok: false, error: { code: 'unavailable', message: 'channel observe is not available', details: {} } }
        try {
          return surface.observe(params)
        } catch (error) {
          return { ok: false, error: { code: 'internal', message: error?.message ?? 'observe failed', details: {} } }
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