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
import { mintId } from './session-interaction-operation-normalize.js'
import { callerIdentityOf } from './profile-mutation.js'

/**
 * Public request message kind → durable surface message kind.
 *
 * The public contract speaks source-audited request kinds (`user-message`);
 * the durable layer only accepts surface message kinds carrying a complete
 * message shape (`{ id, role, content, source }`). The facade adapts between
 * the two vocabularies here so neither leaks into the other.
 */
const SURFACE_KIND_BY_REQUEST_KIND = new Map([['user-message', 'user/message']])

function toSurfaceMessage(kind, payload) {
  const surfaceKind = SURFACE_KIND_BY_REQUEST_KIND.get(kind)
  if (surfaceKind === undefined) return { ok: false, reason: `unsupported durable message kind "${kind}"` }
  const text = payload?.text
  if (typeof text !== 'string' || text.length === 0) return { ok: false, reason: 'message text is required' }
  if (Array.isArray(payload?.attachmentRefs) && payload.attachmentRefs.length > 0) {
    // Attachment content blocks have no mapped durable representation yet:
    // fail closed instead of dropping the payload or forging a text-only write.
    return { ok: false, reason: 'attachment content blocks are not mapped to a durable message yet' }
  }
  return {
    ok: true,
    kind: surfaceKind,
    message: Object.freeze({
      id: mintId('msg'),
      role: 'user',
      source: Object.freeze({ kind: 'user' }),
      content: Object.freeze([Object.freeze({ type: 'text', text })]),
    }),
  }
}

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
    durableAppend: options.durableAppend ?? defaultDurableAppend(facade, (sessionId) => service('sessions')?.get?.(sessionId)),
    durableAvailable: options.durableAvailable ?? (options.durableAppend !== undefined ? (() => true) : defaultDurableAvailable(facade)),
    ownerOf: options.ownerOf ?? defaultOwnerOf(ctx),
    readActivityCorrelation: options.readActivityCorrelation ?? defaultActivityCorrelation(facade),
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
    try {
      // Same derivation as the other host-mounted owners (checkpoints,
      // profile mutation): the plugin name comes from the caller's Cordis
      // fiber via the loader, host-side — never from a caller-reported
      // string, and never from a facade service member that does not exist.
      return callerIdentityOf(callerCtx ?? ctx) ?? 'root'
    } catch {
      return 'root'
    }
  }
}

function defaultDurableAppend(facade, sessionLookup) {
  return async (sessionId, kind, payload, opts) => {
    try {
      const api = facade()
      const appendMessage = api?.sessions?.durable?.appendMessage
      if (typeof appendMessage !== 'function') return { ok: false, reason: 'durable append unavailable' }
      const surface = toSurfaceMessage(kind, payload)
      if (surface.ok !== true) return { ok: false, reason: surface.reason }
      // The durable layer appends onto the live official session object, never
      // onto an id: resolve it host-side (the id is public, the object is not).
      const session = sessionLookup?.(sessionId)
      if (session === undefined || session === null) return { ok: false, reason: 'session is not available for durable append' }
      const result = await appendMessage(session, surface.kind, surface.message, opts)
      if (result === undefined || result === null || result === true) return { ok: true, seq: undefined }
      return { ok: true, ...result }
    } catch (error) {
      return { ok: false, reason: error?.message ?? 'append failed' }
    }
  }
}

/**
 * Default activity-correlation reader: consult the shared activity projection
 * through its public frozen read surface (`pluginApi.sessions.activity`).
 *
 * The projection owns activity identity, so the authority only reads what the
 * projection already graded: a record whose execution correlation the
 * projection evidences yields `observed`/`reconstructed` plus that activity
 * id, and its waiting marker (`approval` / `question` / `user-message` /
 * `tool` / `queued`) rides along so the operation can report a waiting phase
 * from the same evidence the projection publishes (Requirement 6 and the
 * operation's waiting status). A missing or disabled projection, a
 * non-`active` availability probe and a malformed answer all degrade to
 * `unavailable`; a healthy projection that has not evidenced the execution
 * stays `unknown` and is retried on the next read. The authority never derives
 * an activity identity from event sequences of its own.
 */
function defaultActivityCorrelation(facade) {
  return ({ sessionId, executionId, activityId }) => {
    try {
      const activity = facade()?.sessions?.activity
      if (activity === undefined || activity === null) return { confidence: 'unavailable' }
      const probe = typeof activity.availability === 'function' ? activity.availability() : undefined
      if (probe?.status !== 'active') return { confidence: 'unavailable' }
      if (typeof executionId !== 'string' || executionId === '') return { confidence: 'unknown' }
      // An already correlated activity is read by id (cheap, and its waiting
      // evidence may still change); the open record is next; history covers an
      // activity that already terminated or was replaced by a newer one.
      if (typeof activityId === 'string' && activityId !== '' && typeof activity.get === 'function') {
        const known = evidencedCorrelationOf(activity.get(activityId)?.snapshot, executionId)
        if (known !== null) return known
      }
      const current = typeof activity.current === 'function' ? activity.current(sessionId) : undefined
      const fromCurrent = evidencedCorrelationOf(current?.snapshot, executionId)
      if (fromCurrent !== null) return fromCurrent
      const history = typeof activity.history === 'function' ? activity.history(sessionId) : undefined
      const items = Array.isArray(history?.items) ? history.items : []
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const hit = evidencedCorrelationOf(items[index], executionId)
        if (hit !== null) return hit
      }
      return { confidence: 'unknown' }
    } catch {
      return { confidence: 'unavailable' }
    }
  }
}

/**
 * Read the correlation (and any waiting evidence) one projection snapshot
 * carries for an execution. Returns `null` when the snapshot is not the
 * matching evidenced record, so the caller keeps looking instead of returning
 * a guessed identity; a waiting marker is mirrored only when the projection
 * actually graded it.
 */
function evidencedCorrelationOf(snapshot, executionId) {
  if (snapshot === undefined || snapshot === null || typeof snapshot !== 'object') return null
  const execution = snapshot.execution
  if (execution?.executionId !== executionId) return null
  const confidence = execution.correlationConfidence
  if (confidence !== 'observed' && confidence !== 'reconstructed') return null
  const activityId = typeof snapshot.activityId === 'string' ? snapshot.activityId : ''
  if (activityId === '') return null
  const waiting = snapshot.status?.waiting
  const waitingKind = waiting?.kind
  const waitingGrade = waiting?.confidence
  const waitingEvidence = typeof waitingKind === 'string' && waitingKind !== ''
    && typeof waitingGrade === 'string' && waitingGrade !== ''
    ? { kind: waitingKind, confidence: waitingGrade }
    : null
  return { confidence, activityId, waiting: waitingEvidence }
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
