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

/**
 * Strip functions and non-portable values from a host outcome before it rides
 * the carrier.
 *
 * An accepted outcome carries a method-shaped operation handle (`status()` /
 * `observe()` / `dispose()`); the client rebuilds an equivalent handle from the
 * value-only projection. Nothing callable or private ever crosses the wire, so
 * a same-process object fixture can never mask a wire gap.
 */
function toWireValue(value, depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 6) {
    return typeof value === 'function' ? undefined : value
  }
  if (Array.isArray(value)) return value.map((item) => toWireValue(item, depth + 1))
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'function' || item === undefined) continue
    out[key] = toWireValue(item, depth + 1)
  }
  return out
}

/** Value-only projection of one host outcome (wire boundary). */
export function projectWireOutcome(outcome) {
  return toWireValue(outcome)
}

/** Client→host method tokens carried by the session request route. */
export const SESSION_CLIENT_METHODS = Object.freeze([
  'sessions.request',
  'sessions.cancel',
  'sessions.operation.status',
])

/**
 * Build the host route handler for the session request route.
 *
 * The caller owner is always derived host-side from the serving context, never
 * from caller-supplied strings in the wire frame (owner reporting is the
 * host's privilege). The client-provided abort `signal` is forwarded into the
 * request spec so a client disconnect actually reaches the authority.
 *
 * @param {object} options
 * @param {{request: Function, cancel: Function, operationStatus?: Function}} options.owner
 * @param {unknown} [options.ctx] serving context used for owner attribution
 */
export function createSessionInteractionRouteHandler({ owner, ctx } = {}) {
  return async (args, signal) => {
    const method = typeof args?.method === 'string' ? args.method : ''
    const payload = isObject(args?.payload) ? args.payload : {}
    if (method === 'sessions.request') {
      const spec = signal === undefined ? payload : { ...payload, signal }
      return projectWireOutcome(await owner.request(spec, ctx))
    }
    if (method === 'sessions.cancel') {
      return projectWireOutcome(await owner.cancel(payload, ctx))
    }
    if (method === 'sessions.operation.status') {
      const status = owner.operationStatus?.(payload?.operationId)
      if (status === null || status === undefined) {
        return { ok: false, code: 'stale', reason: 'unknown operation' }
      }
      return { ok: true, code: 'status', status: projectWireOutcome(status) }
    }
    return { ok: false, code: 'unsupported', reason: `unsupported client method '${method}'` }
  }
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

/** Polling cadence for operation progress over the unary carrier. */
const DEFAULT_POLL_INTERVAL_MS = 250

/**
 * "Not observed yet" placeholder. It is deliberately not a terminal: an
 * unreachable status is reported as pending with `terminal: null`, never as a
 * fabricated outcome.
 */
const PENDING_STATUS = Object.freeze({ phase: 'pending', terminal: null, attempt: null, activity: null, observedAt: null })

function defaultIntervalTimer() {
  return {
    setInterval: typeof globalThis?.setInterval === 'function' ? globalThis.setInterval.bind(globalThis) : () => 0,
    clearInterval: typeof globalThis?.clearInterval === 'function' ? globalThis.clearInterval.bind(globalThis) : () => {},
  }
}

/** Client side: build the typed caller transport over one RPC route. */
export function createClientRequestTransport({ ctx, path, epoch = () => 0, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, timer = defaultIntervalTimer() } = {}) {
  let connection = null
  try {
    connection = typeof ctx?.get === 'function' ? ctx.get('connection') : undefined
  } catch {
    connection = undefined
  }
  if (!connection || typeof connection.rpc?.call !== 'function') {
    // Unwired carrier: no operation face at all, so the client half degrades
    // to typed unavailable instead of serving invented progress.
    return { request: () => Promise.resolve({ ok: false, code: 'unavailable', reason: 'client request carrier is not wired' }), active: false }
  }
  const epochAt = () => {
    try {
      return epoch()
    } catch {
      return 0
    }
  }
  const call = async (method, payload, opts = {}) => {
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
  }

  // Operation progress over the unary carrier: one snapshot cache per
  // operation id, refreshed on demand and while at least one observer is
  // attached. A rebind (epoch change) stops the watch so a stale generation
  // can neither poll nor deliver into the new one.
  const snapshots = new Map()
  const watches = new Map()
  const inflight = new Map()

  const stopWatch = (operationId) => {
    const watch = watches.get(operationId)
    if (watch === undefined) return
    if (watch.timer !== null && watch.timer !== undefined) {
      try {
        timer.clearInterval(watch.timer)
      } catch {
        // timer cleanup is best-effort
      }
    }
    watches.delete(operationId)
  }

  const refresh = (operationId) => {
    const running = inflight.get(operationId)
    if (running !== undefined) return running
    const atCall = epochAt()
    const task = (async () => {
      try {
        const raw = await call('sessions.operation.status', { operationId }, {})
        if (!isObject(raw) || raw.ok !== true || !isObject(raw.status)) return
        if (epochAt() !== atCall) {
          stopWatch(operationId)
          return
        }
        const snapshot = Object.freeze({ ...raw.status })
        snapshots.set(operationId, snapshot)
        const watch = watches.get(operationId)
        if (watch === undefined) return
        for (const listener of [...watch.listeners]) {
          try {
            listener(snapshot)
          } catch {
            // one throwing observer never stops the others
          }
        }
        if (snapshot.phase === 'terminal') stopWatch(operationId)
      } catch {
        // a failed poll keeps the last known snapshot; never a fabricated terminal
      } finally {
        inflight.delete(operationId)
      }
    })()
    inflight.set(operationId, task)
    return task
  }

  const operation = {
    /** Last observed status (value-only); `pending` until the first answer. */
    status: (operationId) => {
      const cached = snapshots.get(operationId)
      if (cached === undefined && typeof operationId === 'string') void refresh(operationId)
      return cached ?? PENDING_STATUS
    },
    observe: (operationId, listener) => {
      if (typeof operationId !== 'string' || typeof listener !== 'function') return () => false
      let watch = watches.get(operationId)
      if (watch === undefined) {
        watch = { listeners: new Set(), timer: null }
        watches.set(operationId, watch)
      }
      watch.listeners.add(listener)
      const cached = snapshots.get(operationId)
      if (cached !== undefined) {
        try {
          listener(cached)
        } catch {
          // immediate delivery containment
        }
      }
      void refresh(operationId)
      if (watch.timer === null && typeof timer?.setInterval === 'function' && pollIntervalMs > 0) {
        watch.timer = timer.setInterval(() => {
          void refresh(operationId)
        }, pollIntervalMs)
      }
      let disposed = false
      return () => {
        if (disposed) return false
        disposed = true
        watch.listeners.delete(listener)
        if (watch.listeners.size === 0) stopWatch(operationId)
        return true
      }
    },
  }

  return { active: true, request: call, operation }
}