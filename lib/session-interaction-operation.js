/**
 * Public surface of the session request/cancel operation facade (host face).
 *
 * This is the facade B operation surface that the integration wave mounts onto
 * the `sessions` namespace of `ctx.pluginApi`. The module is self-contained:
 * it composes the single request authority with context-derived defaults and
 * exposes the frozen member shapes `request`, `cancel`, `availability`. The
 * mounting itself (append slot in the shared service, guard registration,
 * `sessions.availability()` reason 口径) is owned by the integration wave per
 * the parallel development contract.
 */
import {
  createRequestAuthority,
  resolveAgentLoopBoundary,
} from './session-interaction-operation-authority.js'

/**
 * Create the host operation surface bound to a host context.
 *
 * Caller-provided options override the context defaults; anything the caller
 * omits degrades to typed unavailable rather than guessing.
 *
 * @returns {object} `{ request, cancel, availability, ingestAttemptFact,
 * internalAudit, dispose, authority }`
 */
export function createSessionInteractionOperation(options = {}) {
  const ctx = options.ctx
  const service = (name) => {
    try {
      return ctx?.get?.(name)
    } catch {
      return undefined
    }
  }
  const facade = () => {
    try {
      return ctx?.get?.('pluginApi')
    } catch {
      return undefined
    }
  }

  const authority = createRequestAuthority({
    coreActive: options.coreActive ?? (() => service('pluginApi')?.isActive === true),
    featureDisabled: options.featureDisabled,
    sessionExists: options.sessionExists ?? ((sessionId) => Boolean(service('sessions')?.get?.(sessionId))),
    resolveBoundary: options.resolveBoundary ?? (() => {
      const boundary = resolveAgentLoopBoundary(ctx)
      return boundary === null ? null : { boundary, versionOk: true }
    }),
    durableAppend: options.durableAppend ?? defaultDurableAppend(facade),
    durableAvailable: options.durableAvailable ?? (options.durableAppend !== undefined ? (() => true) : defaultDurableAvailable(facade)),
    ownerOf: options.ownerOf ?? defaultOwnerOf(ctx),
    logger: options.logger ?? ctx?.logger,
    now: options.now,
    timer: options.timer,
    cancelConfirmTimeoutMs: options.cancelConfirmTimeoutMs,
    auditLimit: options.auditLimit,
  })

  // passthrough members: the mounted service supplies the caller context via
  // the second argument; callers that omit it fall back to the root owner.
  const request = (spec, callerCtx) => authority.request(spec, callerCtx)
  const cancel = (input, callerCtx) => authority.cancel(input, callerCtx)
  const availability = () => authority.availability()
  const ingestAttemptFact = (fact) => authority.ingestAttemptFact(fact)
  // Read-only status projection for one operation id (value-only; powers the
  // client→host status route). Unknown ids answer `null`, never a fabricated
  // terminal: adjudication stays with the single authority.
  const operationStatus = (operationId) => authority.operationStatus(operationId)
  const internalAudit = () => authority.internalAudit()
  const dispose = () => authority.dispose()

  return Object.freeze({ request, cancel, availability, operationStatus, ingestAttemptFact, internalAudit, dispose, authority })
}

function defaultOwnerOf(ctx) {
  return (callerCtx) => {
    const scope = callerCtx ?? ctx
    try {
      return scope?.get?.('pluginApi')?.services?.identity?.() ?? 'root'
    } catch {
      return 'root'
    }
  }
}

function defaultDurableAppend(facade) {
  return async (sessionId, kind, payload, opts) => {
    try {
      const api = facade()
      const appendMessage = api?.sessions?.durable?.appendMessage
      if (typeof appendMessage !== 'function') return { ok: false, reason: 'durable append unavailable' }
      const result = await appendMessage(sessionId, kind, payload, opts)
      if (result === undefined || result === null || result === true) return { ok: true, seq: undefined }
      return { ok: true, ...result }
    } catch (error) {
      return { ok: false, reason: error?.message ?? 'append failed' }
    }
  }
}

function defaultDurableAvailable(facade) {
  return () => {
    try {
      const api = facade()
      return typeof api?.sessions?.durable?.appendMessage === 'function'
    } catch {
      return false
    }
  }
}