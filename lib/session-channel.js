/**
 * B facade mount: `pluginApi.sessions.channels`.
 *
 * Assembles the auth abstraction, per-caller-bucket rate limiting, channel
 * lifecycle engine, redaction profile registry, and projection into a single
 * facade surface marked with the cross-package coordination symbol.
 * Mounts fail-safe: when required hooks (session observation) are unavailable
 * the feature returns `null` and stays inert (never throws through boot).
 *
 * Trust model: authentication strength is determined by the registered
 * verifier/authorizer chain; the facade provides enforcement plumbing only
 * (fail-closed verifier gate on open/resume, random-token possession fencing
 * on every other method) and never treats carrier trust as device auth.
 */
import { CONTRACT_SYMBOL, CODE_INVALID_INPUT, typedError } from './session-channel-shared.js'
import { createAuthRegistry } from './session-channel-auth.js'
import { createRateLimiter, RATE_BUCKETS } from './session-channel-rate-limit.js'
import { createChannelEngine } from './session-channel-core.js'
import { createChannelProjection } from './session-channel-project.js'
import { createAuditLog } from './session-channel-audit.js'
import { redactForAudience, redactError, createRedactionProfiles } from './session-channel-redact.js'

const CONTROLLED_METHODS = Object.freeze(['open', 'subscribe', 'fetchEvents', 'heartbeat', 'ack', 'resume', 'revoke'])

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

  // Required session observation hooks: the sessions feature must be active
  // and provide event subscription for the cursor engine.
  const sessionApi = service?.sessions
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

  const reportDiagnostic = ({ stage, error }) => {
    try {
      logger?.warn?.(`session-channel: ${stage} callback failed: ${error?.name ?? 'Error'}`)
    } catch { /* diagnostics never change outcomes */ }
  }

  const auth = createAuthRegistry({ onError: reportDiagnostic })
  const limiter = createRateLimiter()
  const profiles = createRedactionProfiles()
  const engine = createChannelEngine()
  const projection = createChannelProjection(engine)
  const audit = createAuditLog()

  // Wire session observation into the channel engine: session lifecycle
  // events feed the per-session bounded event log (cursor/replay window).
  // Capture uses the union of all registered audience profiles (secrets are
  // always dropped first); narrower per-subscription filtering happens again
  // at wire time in fetchEvents.
  const sessionEventDisposer = subscribeSessionEvents({ sessionApi, engine, profiles, logger })
  if (!sessionEventDisposer) {
    auth.dispose()
    profiles.dispose()
    engine.dispose()
    return null
  }

  // Wrap the engine control methods with rate limiting (per caller bucket),
  // auth enforcement, and result auditing/redaction.
  const controlled = {}
  for (const method of CONTROLLED_METHODS) {
    controlled[method] = async (args, signal) => {
      // Pre-auth anonymous budget: credential-less callers share one small
      // bucket consumed before any plugin chain runs, so flooding without a
      // credential cannot burn host resources or other callers' budgets.
      const credited = args?.channelGeneration != null || args?.resumeToken != null
      if (!credited && !isLocalOnly(method)) {
        const pre = limiter.check(method, RATE_BUCKETS.ANONYMOUS)
        if (!pre.ok) return pre
      }
      let gate
      try {
        gate = await Promise.resolve(enforceAuthGate(auth, method, args))
      } catch (error) {
        reportDiagnostic({ stage: 'auth-gate', error })
        return typedError('internal', 'channel method failed')
      }
      if (!gate.ok) return gate

      // Audience profiles fail closed: an unknown redactionProfile id must
      // never widen or silently fall back to the default exposure.
      if (method === 'subscribe' && args?.redactionProfile != null && !profiles.hasProfile(args.redactionProfile)) {
        return typedError(CODE_INVALID_INPUT, 'unknown redaction profile')
      }

      // Credential present but verification failed → shared rejected bucket.
      if (credited && gate.rejected === true) {
        const penalty = limiter.check(method, RATE_BUCKETS.REJECTED)
        if (!penalty.ok) return penalty
      }

      // Per-caller fairness bucket once an identity is known.
      const callerBucket = gate.meta?.deviceId ?? (credited ? RATE_BUCKETS.POSSESSION : RATE_BUCKETS.ANONYMOUS)
      const perCaller = limiter.check(method, callerBucket)
      if (!perCaller.ok) return perCaller

      let result
      try {
        result = await Promise.resolve(engine[method](args, signal, gate.meta))
      } catch (error) {
        return { ok: false, error: { code: 'internal', message: 'channel method failed', details: {} } }
      }
      return finalizeResult(method, result, { audit, args, meta: gate.meta, profiles })
    }
  }

  // Cross-package dispatch: route through the controlled wrappers so the RPC
  // path (via gateway R package) enforces auth, buckets, and redaction too.
  const dispatchChannelMethod = (endpoint, payload, signal) => {
    const method = typeof endpoint === 'string' ? endpoint.split('/').pop() : undefined
    if (!method || !CONTROLLED_METHODS.includes(method)) {
      return Promise.resolve(typedError(CODE_INVALID_INPUT, 'unknown channel method'))
    }
    const args = payload?.args
    return controlled[method](args, signal)
  }

  const api = Object.defineProperties({
    // Control face
    open: controlled.open,
    acquire: controlled.open,
    subscribe: controlled.subscribe,
    fetchEvents: controlled.fetchEvents,
    list: controlled.fetchEvents,
    heartbeat: controlled.heartbeat,
    ack: controlled.ack,
    resume: controlled.resume,
    revoke: controlled.revoke,
    release: controlled.revoke,
    // Projection face (read-only)
    observe: (params) => {
      const rate = limiter.check('observe', RATE_BUCKETS.LOCAL)
      if (!rate.ok) return rate
      return projection.observe(params)
    },
    onChange: (listener) => projection.onChange(listener),
    // Auth abstraction (paradigm-agnostic registration)
    auth: Object.freeze({
      registerVerifier: auth.registerVerifier,
      registerPairingProvider: auth.registerPairingProvider,
      registerAuthorizer: auth.registerAuthorizer,
      initiatePairing: auth.initiatePairing,
      approvePairing: auth.approvePairing,
      rejectPairing: auth.rejectPairing,
    }),
    // Redaction profile registration (audience-specific allowlists)
    redaction: Object.freeze({
      registerProfile: profiles.registerProfile,
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
    profiles.dispose()
    engine.dispose()
    return null
  }

  return {
    disposer() {
      try { sessionEventDisposer() } catch {}
      try { auth.dispose() } catch {}
      try { profiles.dispose() } catch {}
      try { engine.dispose() } catch {}
      try { audit.clear() } catch {}
    },
    prepared,
  }
}

function isLocalOnly(method) {
  // Local projection faces never cross the RPC carrier; there is no remote
  // flooding risk to brake in the anonymous pre-auth bucket.
  return false
}

/**
 * Enforce the auth chain for a channel method.
 *
 * - `open` / `resume`: verifier chain is mandatory (fail-closed
 *   `unavailable` without one), then the authorizer chain runs with the
 *   verified identity; the canonical `{ deviceId, scope }` travels back as
 *   `meta` for record-keeping.
 * - every other method: possession gating is enforced by the engine against
 *   the presented generation tokens; the authorizer chain (when any is
 *   registered) is consulted with the method/channel context.
 *
 * Denial messages are fixed and generic — they reveal nothing about
 * unrelated devices or sessions.
 *
 * @returns {object | { ok: true, meta: object }} typed denial/unavailable
 *   result, or `{ ok: true, meta }` where meta carries verified identity.
 */
function enforceAuthGate(auth, method, args) {
  if (method === 'open') {
    if (!auth.hasVerifier()) {
      return { ok: false, error: { code: 'unavailable', message: 'no verifier is registered; channel authentication unavailable', details: {} } }
    }
    const verified = auth.verifyDevice(args?.device /* credential */, { method, session: args?.session })
    if (verified.denied === true) {
      return denied(method, verified.code ?? 'device-denied')
    }
    const deviceId = verified.deviceId
    const scope = verified.scope
    const authorized = auth.authorize({ deviceId, scope, method, session: args?.session })
    if (authorized.deny === true) {
      return denied(method, authorized.code ?? 'session-denied')
    }
    return { ok: true, meta: { deviceId, scope } }
  }

  if (method === 'resume') {
    if (!auth.hasVerifier()) {
      return { ok: false, error: { code: 'unavailable', message: 'no verifier is registered; channel authentication unavailable', details: {} } }
    }
    const credential = args?.resumeToken
    const verified = auth.verifyDevice(credential, { method, session: args?.session })
    if (verified.denied === true) {
      return { ok: false, error: { code: 'resume-rejected', message: 'resume verification failed', details: {} } }
    }
    const deviceId = verified.deviceId
    const scope = verified.scope
    const authorized = auth.authorize({ deviceId, scope, method, session: args?.session, channel: args?.channelId })
    if (authorized.deny === true) {
      return { ok: false, error: { code: 'resume-rejected', message: 'resume verification failed', details: {} } }
    }
    return { ok: true, meta: { deviceId, scope }, resumeVerified: true }
  }

  // Possession-gated methods: the authorizer chain still decides policy when
  // registered; when none is registered, possession (enforced by the engine)
  // is the boundary — documented in the trust model.
  const authorized = auth.authorize({
    method, session: args?.session, channel: args?.channelId,
  })
  if (authorized.deny === true) {
    return denied(method, authorized.code ?? 'session-denied')
  }
  return { ok: true, meta: {} }
}

/** Fixed generic denial envelope for auth decisions. */
function denied(method, code) {
  return { ok: false, error: { code: code === 'device-denied' || code === 'session-denied' ? code : 'session-denied', message: 'authorization denied', details: {} }, rejected: true }
}

/**
 * Subscribe to the official session lifecycle event stream and feed the
 * channel engine's bounded event logs.
 * @returns {(() => void) | null}
 */
function subscribeSessionEvents({ sessionApi, engine, profiles, logger }) {
  let disposer
  try {
    disposer = sessionApi.on('session/event', (payload) => {
      try {
        const sessionId = payload?.session?.id ?? payload?.sessionId
        if (!sessionId) return
        const captured = redactForAudience(payload, { allowlist: profiles.combinedAllowlist() })
        const record = {
          sessionId,
          eventId: payload?.event?.id ?? payload?.eventId,
          dedupeKey: payload?.event?.id ?? payload?.eventId,
          cursor: payload?.seq ?? payload?.event?.seq,
          kind: payload?.kind ?? payload?.event?.type ?? 'session/event',
          payload: captured,
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

/** Audit and hand back a finished engine result (frames stay capture-redacted). */
function finalizeResult(method, result, { audit, args, meta, profiles }) {
  if (!result || typeof result !== 'object') return result
  const who = meta?.deviceId ?? (typeof args?.device === 'string' ? args.device : 'anonymous')
  const what = method
  const generation = result.channelGeneration ?? result.channelId
  if (result.ok !== true) {
    if (result.error) {
      audit.append({ who, what: `${what}:${result.error.code}`, generation })
      return { ok: false, error: redactError(result.error) }
    }
    return result
  }
  audit.append({ who, what, generation })
  // Wire-time audience filter: batch payloads captured under the union of
  // registered profiles are narrowed here to the subscriber's declared
  // profile (or the default safe set when none was declared).
  if (Array.isArray(result.frames) && result.frames.length > 0) {
    const allow = profiles ? profiles.allowlistOf(result.redactionProfile ?? '') : []
    result.frames = result.frames.map((frame) => (
      frame && typeof frame === 'object'
        ? { ...frame, payload: redactForAudience(frame.payload, { allowlist: allow }) }
        : frame
    ))
  }
  return result
}
