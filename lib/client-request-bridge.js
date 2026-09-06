/**
 * Client-request bridge for the session interaction operation and attention
 * faces (integration wave).
 *
 * Fixed wire entry (integration wave): the browser faces send typed
 * client→host requests over the connection RPC carrier under the dedicated
 * routes `/plugin-api/sessions` (session request/cancel) and
 * `/plugin-api/attention` (attention contribution requests), mirroring the
 * established `/channel` carrier pattern of the session-channel gateway.
 * The routes are registered by the host mounters on the connection service;
 * absent carriers degrade to typed unavailable and calls are never queued.
 *
 * Wire shape (revision 1, frozen at the integration wave):
 *   request event  -> connection.rpc.call(route, 'request', { args }, signal)
 *   response shape -> the facade typed outcome as-is; transport failures
 *                     become typed unavailable, never fabricated results.
 */
function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

/** Host side: register one RPC request route on the connection service. */
export function installClientRequestRoute({ ctx, path, handler, logger } = {}) {
  let disposer = null
  let active = false
  try {
    const connection = typeof ctx?.get === 'function' ? ctx.get('connection') : undefined
    if (connection && typeof connection.rpc?.handle === 'function') {
      const handled = connection.rpc.handle(path, async (endpoint, payload, signal) => {
        if (endpoint !== 'request') {
          return { ok: false, code: 'unsupported', reason: `unsupported client request endpoint '${String(endpoint)}'` }
        }
        try {
          return await handler(payload?.args ?? {}, signal)
        } catch (error) {
          return { ok: false, code: 'unavailable', reason: `client request failed: ${String(error?.message ?? error)}` }
        }
      }, { authority: 'trusted-host' })
      if (typeof handled === 'function') disposer = handled
      active = true
    }
  } catch (error) {
    try {
      logger?.warn?.(`dsh-plugin-api client request route registration failed: ${error?.name ?? 'Error'}`)
    } catch {
      // diagnostics never change outcomes
    }
  }
  return {
    active,
    dispose: () => {
      if (typeof disposer === 'function') {
        try {
          disposer()
        } catch {
          // disposal is best-effort
        }
        disposer = null
      }
    },
  }
}

/** Client side: build the typed caller transport over one RPC route. */
export function createClientRequestTransport({ ctx, path, epoch = () => 0 }) {
  let connection = null
  try {
    connection = typeof ctx?.get === 'function' ? ctx.get('connection') : undefined
  } catch {
    connection = undefined
  }
  if (!connection || typeof connection.rpc?.call !== 'function') {
    return { request: () => Promise.resolve({ ok: false, code: 'unavailable', reason: 'client request carrier is not wired' }), active: false }
  }
  const epochAt = () => {
    try {
      return epoch()
    } catch {
      return 0
    }
  }
  return {
    active: true,
    request: async (method, payload, opts = {}) => {
      const atCall = epochAt()
      try {
        // Wire shape (frozen at the integration wave): the method token rides
        // beside the payload fields so the host route handler can dispatch
        // without a second lookup (never caller-reported owners).
        const raw = await connection.rpc.call(path, 'request', { args: { method, payload } }, opts.signal)
        if (epochAt() !== atCall) {
          return { ok: false, code: 'unavailable', reason: 'connection generation changed during the request' }
        }
        return isObject(raw) ? raw : { ok: false, code: 'unavailable', reason: 'host returned a malformed client request outcome' }
      } catch (error) {
        return { ok: false, code: 'unavailable', reason: `client request failed: ${String(error?.message ?? error)}` }
      }
    },
  }
}