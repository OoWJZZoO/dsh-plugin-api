/**
 * B facade mount: `pluginApi.sessionChannel`.
 *
 * Assembles the auth abstraction, per-method rate limiting, channel lifecycle
 * engine, and projection into a single facade surface marked with the
 * cross-package coordination symbol. Mounts fail-safe: when required hooks
 * (session observation) are unavailable the feature returns `null` and stays
 * inert (never throws through boot).
 *
 * @module
 */
import { CONTRACT_SYMBOL, CODE_INVALID_INPUT, typedError } from './session-channel-shared.js'
import { createAuthRegistry } from './session-channel-auth.js'
import { createRateLimiter } from './session-channel-rate-limit.js'
import { createChannelEngine } from './session-channel-core.js'
import { createChannelProjection } from './session-channel-project.js'
import { createAuditLog } from './session-channel-audit.js'
import { redactForAudience, redactError } from './session-channel-redact.js'

const CONTROLLED_METHODS = Object.freeze(['open', 'subscribe', 'ack', 'resume', 'revoke'])

/**
 * Mount the sessionChannel feature on the pluginApi service.
 *
 * @param {object} options
 * @param {object} options.ctx
 * @param {object} options.service - pluginApi service instance
 * @param {{ warn?: (message: string) => void, error?: (message: string, error?: unknown) => void }} [options.logger]
 * @param {object} [options.featureRegistry]
 * @returns {object | null} `{ disposer, prepared }` or `null` to disable.
 */
export function mountSessionChannelFeature({ ctx, service, logger, featureRegistry } = {}) {
  // Unified idempotent re-apply signal.
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('sessionChannel')) {
    return { disposer: () => {}, prepared: null }
  }

  // Required session observation hooks: the session feature must be active
  // and provide event subscription + event-log access for the cursor engine.
  const sessionApi = service?.session
  const eventsApi = service?.events
  if (
    !sessionApi
    || typeof sessionApi.on !== 'function'
    || typeof sessionApi.events !== 'function'
    || !eventsApi
    || typeof eventsApi.on !== 'function'
  ) {
    return null
  }

  const auth = createAuthRegistry()
  const limiter = createRateLimiter()
  const engine = createChannelEngine()
  const projection = createChannelProjection(engine)
  const audit = createAuditLog()

  // Wire session observation into the channel engine: session lifecycle
  // events feed the per-channel event log (bounded cursor/replay window).
  const sessionEventDisposer = subscribeSessionEvents({ sessionApi, engine, logger })
  if (!sessionEventDisposer) {
    auth.dispose()
    engine.dispose()
    return null
  }

  // Wrap the engine control methods with rate limiting, auth enforcement,
  // and redaction.
  const controlled = {}
  for (const method of CONTROLLED_METHODS) {
    controlled[method] = (args, signal) => {
      const rate = limiter.check(method)
      if (!rate.ok) return rate
      const gate = enforceAuthGate(auth, method, args)
      if (gate && !gate.ok) return gate
      let result
      try {
        result = engine[method](args, signal)
        if (result && typeof result.then === 'function') {
          return result.then((value) => redactResult(method, value, audit, args))
        }
        return redactResult(method, result, audit, args)
      } catch (error) {
        return { ok: false, error: { code: 'internal', message: error?.message ?? 'channel method failed', details: {} } }
      }
    }
  }

  // Cross-package dispatch: route through the controlled wrappers so the
  // RPC path (via gateway R package) enforces auth, rate limits, and redaction.
  const dispatchChannelMethod = (endpoint, payload, signal) => {
    const method = typeof endpoint === 'string' ? endpoint.split('/').pop() : undefined
    if (!method || !CONTROLLED_METHODS.includes(method)) {
      return typedError(CODE_INVALID_INPUT, `unknown channel method: ${method}`)
    }
    const args = payload?.args
    return controlled[method](args, signal)
  }

  const api = Object.defineProperties({
    // Control face
    open: controlled.open,
    subscribe: controlled.subscribe,
    ack: controlled.ack,
    resume: controlled.resume,
    revoke: controlled.revoke,
    // Projection face (read-only, rate-limited)
    observe: (params) => {
      const rate = limiter.check('observe')
      if (!rate.ok) return rate
      return projection.observe(params)
    },
    onChange: (listener) => projection.onChange(listener),
    // Auth abstraction
    auth: Object.freeze({
      registerVerifier: auth.registerVerifier,
      registerPairingProvider: auth.registerPairingProvider,
      registerAuthorizer: auth.registerAuthorizer,
      initiatePairing: auth.initiatePairing,
      approvePairing: auth.approvePairing,
      rejectPairing: auth.rejectPairing,
    }),
  }, {
    [CONTRACT_SYMBOL]: { value: true, enumerable: false },
    dispatchChannelMethod: { value: dispatchChannelMethod, enumerable: false },
    channelGenerationOf: { value: (channelId) => engine.channelGenerationOf(channelId), enumerable: false },
  })
  Object.freeze(api)

  let prepared
  try {
    prepared = service.prepareFeature('sessionChannel', api)
  } catch {
    try { sessionEventDisposer() } catch {}
    auth.dispose()
    engine.dispose()
    return null
  }

  return {
    disposer() {
      try { sessionEventDisposer() } catch {}
      try { auth.dispose() } catch {}
      try { engine.dispose() } catch {}
      try { audit.clear() } catch {}
    },
    prepared,
  }
}

/**
 * Enforce the auth chain for a channel method.
 *
 * fail-closed AND: `open` and `resume` first run the verifier chain on the
 * device identity; every controlled method then runs the authorizer chain for
 * the specific method. Missing verifier on `open` returns `unavailable`.
 *
 * The verifier result (`{ deviceId, scope }`) is passed to the authorizer
 * so scope-based authorization is available.
 *
 * @returns {object | null} typed denial/unavailable result, or `null` when the
 *   gate passes.
 */
function enforceAuthGate(auth, method, args) {
  const device = typeof args?.device === 'string' ? args.device : undefined
  let verifiedDeviceId = device
  let verifiedScope = undefined

  // open/resume re-verify the device through the registered chain.
  if (method === 'open') {
    if (!auth.hasVerifier()) return { ok: false, error: { code: 'unavailable', message: 'no verifier is registered; channel authentication unavailable', details: {} } }
    const verified = auth.verifyDevice(device, { method, session: args?.session })
    if (verified.denied === true) {
      return { ok: false, error: { code: verified.code ?? 'device-denied', message: verified.reason ?? 'device verification denied', details: {} } }
    }
    if (verified.deviceId) verifiedDeviceId = verified.deviceId
    if (verified.scope) verifiedScope = verified.scope
  }
  if (method === 'resume') {
    if (!auth.hasVerifier()) return { ok: false, error: { code: 'unavailable', message: 'no verifier is registered; channel authentication unavailable', details: {} } }
    const credential = args?.resumeToken ?? device
    const verified = auth.verifyDevice(credential, { method, session: args?.session })
    if (verified.denied === true) {
      return { ok: false, error: { code: verified.code ?? 'resume-rejected', message: verified.reason ?? 'resume verification denied', details: {} } }
    }
    if (verified.deviceId) verifiedDeviceId = verified.deviceId
    if (verified.scope) verifiedScope = verified.scope
  }

  // Every controlled method passes the authorizer chain with the verified identity.
  const authorized = auth.authorize({ deviceId: verifiedDeviceId, scope: verifiedScope, method, session: args?.session, channel: args?.channelId })
  if (authorized.deny === true) {
    return { ok: false, error: { code: authorized.code ?? 'session-denied', message: authorized.reason ?? 'authorization denied', details: {} } }
  }
  return null
}

/**
 * Subscribe to the official session lifecycle event stream and feed the
 * channel engine's bounded event logs.
 * @returns {(() => void) | null}
 */
function subscribeSessionEvents({ sessionApi, engine, logger }) {
  let disposer
  try {
    disposer = sessionApi.on('session/event', (payload) => {
      try {
        const sessionId = payload?.session?.id ?? payload?.sessionId
        if (!sessionId) return
        const record = {
          sessionId,
          eventId: payload?.event?.id ?? payload?.eventId ?? String(Date.now()),
          dedupeKey: payload?.event?.id ?? payload?.eventId ?? String(Date.now()),
          cursor: String(payload?.seq ?? payload?.event?.seq ?? Date.now()),
          kind: payload?.kind ?? payload?.event?.type ?? 'session/event',
          payload: redactForAudience(payload),
          emittedAt: Date.now(),
        }
        engine._observeEvent?.(record)
      } catch {
        // observation must never throw into the events bus
      }
    }, { scope: true })
  } catch (error) {
    logger?.warn?.(`session-channel: session/event subscription failed: ${error?.name ?? 'Error'}`)
    return null
  }
  return typeof disposer === 'function' ? disposer : () => true
}

/** Redact a channel method result before returning it to the caller. */
function redactResult(method, result, audit, args) {
  if (result && typeof result.then === 'function') return result
  if (!result || typeof result !== 'object') return result
  const who = typeof args?.device === 'string' ? args.device : 'unknown'
  const what = method
  const generation = result.channelGeneration ?? result.channelId
  if (result.ok === true) {
    audit.append({ who, what, generation })
    return { ...result }
  }
  if (result.error) {
    audit.append({ who, what: `${what}:${result.error.code}`, generation })
    return { ok: false, error: redactError(result.error) }
  }
  return result
}