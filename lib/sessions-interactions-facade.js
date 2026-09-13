/**
 * Pending-interaction facade (host face): restricted views plus a last-resort
 * approval answerer.
 *
 * The view is derived from the durable session log, so a decision made anywhere
 * removes the item on the next read and the facade never keeps a second
 * lifecycle state machine. The answerer registers as an *append* listener on
 * the official `approval/request` waterfall: it is only ever reached when no
 * earlier answerer (the official mux answerer in a web deployment) claimed the
 * request, so it cannot shadow one. Even then it holds the request only while
 * an interactive watcher is known to be looking at that session, and it only
 * ever releases with the caller's explicit choice, an abort, or a bounded
 * lease expiry — never with an answer of its own.
 */
import { createInteractionsRouteHandler, installClientRequestRoute } from './client-request-bridge.js'
import { callerIdentityOf } from './profile-mutation.js'
import {
  buildApprovalView,
  buildInteractionsAvailability,
  buildRespondOutcome,
  createInteractionRegistry,
  foldPendingApprovals,
  INTERACTION_KINDS,
  redactSummary,
  RESPOND_ACTIONS,
  validateRespondInput,
} from './sessions-interactions.js'

/** How long a read keeps the session's approval answerer armed (ms). */
const DEFAULT_WATCH_LEASE_MS = 60_000

/** How many pending items one page carries. */
const DEFAULT_PAGE_SIZE = 50

/** Bounded audit ring for respond actions (no answer payload, no secrets). */
const DEFAULT_AUDIT_LIMIT = 200

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isoNow(now) {
  try {
    const value = now()
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
  } catch {
    return new Date().toISOString()
  }
}

/**
 * Derive the official approval id an incoming waterfall request refers to.
 *
 * The waterfall request carries the agent, tool name and call id but not the
 * durable id, so the id is resolved from the same evidence the official
 * answerer uses: walk the session log from the tail, skip anything already
 * decided or claimed, and take the newest ask whose call id matches.
 */
export function deriveApprovalId(events, { callId, claimed } = {}) {
  const list = Array.isArray(events) ? events : []
  const decided = new Set()
  const claimedIds = claimed ?? new Set()
  const wanted = callId ?? null
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const event = list[index]
    if (event?.type === 'approval/decided') {
      const id = event?.data?.id
      if (typeof id === 'string') decided.add(id)
      continue
    }
    if (event?.type !== 'approval/asked') continue
    const data = event?.data
    const id = data?.id
    if (typeof id !== 'string' || id === '') continue
    if (decided.has(id) || claimedIds.has(id)) continue
    if ((data?.callId ?? null) !== wanted) continue
    return id
  }
  return undefined
}

/**
 * Create the interactions authority.
 *
 * @param {object} options
 * @param {object} [options.ctx] host context (service lookups happen here)
 * @param {() => object | undefined} [options.resolveApprovalService] official
 *   approval service (the answerer listener is registered on its waterfall)
 * @param {() => object | undefined} [options.sessionLookup]
 * @param {() => ReadonlyArray<object> | undefined} [options.sessionList]
 * @param {() => Date} [options.now]
 * @param {{setTimeout: Function, clearTimeout: Function}} [options.timer]
 * @param {number} [options.watchLeaseMs]
 * @param {number} [options.auditLimit]
 */
export function createInteractionsAuthority(options = {}) {
  const ctx = options.ctx
  const sessionLookup = options.sessionLookup ?? (() => undefined)
  const sessionList = options.sessionList ?? (() => undefined)
  const now = options.now ?? (() => new Date())
  const timer = options.timer ?? { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) }
  const watchLeaseMs = options.watchLeaseMs ?? DEFAULT_WATCH_LEASE_MS
  const auditLimit = options.auditLimit ?? DEFAULT_AUDIT_LIMIT
  const registry = createInteractionRegistry({ limit: options.registryLimit ?? 256 })

  const log = (message) => {
    try {
      ctx?.logger?.warn?.(`dsh-plugin-api sessions.interactions: ${message}`)
    } catch {
      // diagnostics are best-effort
    }
  }

  /** Held requests: facade id → { sessionId, officialId, resolve, released }. */
  const held = new Map()
  /** Interactive watch leases: sessionId → expiry timestamp. */
  const watches = new Map()
  const auditRing = []
  let gapCount = 0
  let disposed = false

  const recordAudit = (entry) => {
    try {
      auditRing.push(Object.freeze({ at: isoNow(now), ...entry }))
      if (auditRing.length > auditLimit) auditRing.shift()
      return true
    } catch {
      gapCount += 1
      return false
    }
  }

  /** The lease clock is the injected one, so a caller's clock drives expiry. */
  const nowMs = () => {
    try {
      const value = now()
      const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
      return Number.isFinite(ms) ? ms : Date.now()
    } catch {
      return Date.now()
    }
  }

  const watch = (sessionId) => {
    if (typeof sessionId !== 'string' || sessionId === '') return
    watches.set(sessionId, nowMs() + watchLeaseMs)
  }

  const watched = (sessionId) => {
    const expiry = watches.get(sessionId)
    if (expiry === undefined) return false
    if (nowMs() > expiry) {
      watches.delete(sessionId)
      return false
    }
    return true
  }

  const claimedIds = () => new Set([...held.values()].map((entry) => entry.officialId))

  const sourceStateFor = () => {
    try {
      const reachable = typeof sessionLookup === 'function'
      return reachable ? 'active' : 'degraded'
    } catch {
      return 'unavailable'
    }
  }

  const sourcesOf = () => Object.freeze({
    approval: disposed ? 'unavailable' : sourceStateFor(),
    // A question view would need a pending/answer seam the official chain does
    // not expose to a non-mux facade; the source is honestly unavailable.
    question: 'unavailable',
  })

  const availability = () => {
    try {
      if (disposed) return buildInteractionsAvailability({ status: 'unavailable', reason: 'the interactions authority is disposed', sources: sourcesOf() })
      const sources = sourcesOf()
      if (sources.approval === 'unavailable') {
        return buildInteractionsAvailability({ status: 'unavailable', reason: 'the session log is unreachable', sources })
      }
      if (sources.question === 'unavailable') {
        return buildInteractionsAvailability({ status: 'degraded', reason: 'the question source is unavailable on this runtime', sources })
      }
      return buildInteractionsAvailability({ status: 'active', sources })
    } catch {
      return buildInteractionsAvailability({ status: 'unavailable', reason: 'availability probe failed' })
    }
  }

  /**
   * Pending approvals for one session.
   *
   * The fold is pure asked-minus-decided: an interaction this facade holds is
   * still pending (that is exactly what the client must see in order to
   * answer it), so the facade's own holds are never filtered out. The
   * claimed set is used only when resolving which ask an incoming waterfall
   * request refers to.
   */
  const pendingOf = (session) => {
    try {
      return foldPendingApprovals({ events: session?.events })
    } catch (error) {
      log(`pending fold failed: ${error?.name ?? 'Error'}`)
      return null
    }
  }

  const viewsOf = (sessionId, session) => {
    const pending = pendingOf(session)
    if (pending === null) return null
    const views = []
    for (const item of pending) {
      const id = registry.idFor(sessionId, item.officialId)
      views.push(buildApprovalView({ id, sessionId, pending: item }))
    }
    return views
  }

  const list = (input) => {
    if (disposed) return buildRespondOutcome('unavailable', 'the interactions authority is disposed')
    const request = isPlainObject(input) ? input : {}
    const sessionId = request.sessionId
    if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId === '')) {
      return buildRespondOutcome('rejected', 'sessionId must be a non-empty string when present')
    }
    const offset = Number.isSafeInteger(request.cursor) && request.cursor > 0 ? request.cursor : 0
    let sessions
    try {
      if (sessionId !== undefined) {
        const session = sessionLookup(sessionId)
        sessions = session === undefined || session === null ? [] : [[sessionId, session]]
        if (sessionId !== undefined && sessions.length === 0) {
          return Object.freeze({ ok: true, items: Object.freeze([]), nextCursor: null, sources: sourcesOf() })
        }
      } else {
        const all = sessionList()
        if (!Array.isArray(all)) {
          return Object.freeze({ ok: false, code: 'unavailable', reason: 'the session list is unreachable', sources: sourcesOf() })
        }
        sessions = []
        for (const session of all) {
          const id = session?.id
          if (typeof id === 'string' && id !== '') sessions.push([id, session])
        }
      }
    } catch (error) {
      log(`session resolution failed: ${error?.name ?? 'Error'}`)
      return Object.freeze({ ok: false, code: 'unavailable', reason: 'the session source is unreachable', sources: sourcesOf() })
    }

    const items = []
    for (const [id, session] of sessions) {
      watch(id)
      const views = viewsOf(id, session)
      if (views === null) {
        return Object.freeze({ ok: false, code: 'degraded', reason: `the pending source for session "${id}" could not be read`, sources: sourcesOf() })
      }
      items.push(...views)
    }
    const page = items.slice(offset, offset + DEFAULT_PAGE_SIZE)
    const nextCursor = offset + DEFAULT_PAGE_SIZE < items.length ? offset + DEFAULT_PAGE_SIZE : null
    return Object.freeze({ ok: true, items: Object.freeze(page), nextCursor, sources: sourcesOf() })
  }

  const get = (input) => {
    if (disposed) return buildRespondOutcome('unavailable', 'the interactions authority is disposed')
    const id = isPlainObject(input) ? input.id : undefined
    if (typeof id !== 'string' || id === '') {
      return buildRespondOutcome('rejected', 'id must be a non-empty string')
    }
    const known = registry.lookup(id)
    if (known === undefined) {
      return Object.freeze({ ok: false, code: 'missing', reason: 'unknown interaction id' })
    }
    let session
    try {
      session = sessionLookup(known.sessionId)
    } catch {
      return Object.freeze({ ok: false, code: 'unavailable', reason: 'the session source is unreachable' })
    }
    if (session === undefined || session === null) {
      return Object.freeze({ ok: false, code: 'missing', reason: 'the interaction is no longer pending' })
    }
    watch(known.sessionId)
    const pending = pendingOf(session)
    if (pending === null) {
      return Object.freeze({ ok: false, code: 'unavailable', reason: 'the pending source could not be read' })
    }
    const match = pending.find((item) => item.officialId === known.officialId)
    if (match === undefined) {
      registry.clear(known.sessionId, known.officialId)
      return Object.freeze({ ok: false, code: 'missing', reason: 'the interaction is no longer pending' })
    }
    return Object.freeze({ ok: true, view: buildApprovalView({ id, sessionId: known.sessionId, pending: match }) })
  }

  /**
   * Release one held request exactly once.
   *
   * The release is the only path that resolves the official waterfall: an
   * explicit caller action forwards its decision, an abort and a lease expiry
   * release with the official vocabulary's own no-decision values (`cancelled`
   * and `unavailable`), and nothing else can settle a hold.
   */
  const release = (entry, outcome, detail) => {
    if (entry.released) return false
    entry.released = true
    held.delete(entry.id)
    registry.clear(entry.sessionId, entry.officialId)
    if (entry.timer !== undefined) {
      timer.clearTimeout(entry.timer)
      entry.timer = undefined
    }
    if (entry.signal !== undefined && typeof entry.onAbort === 'function') {
      try {
        entry.signal.removeEventListener('abort', entry.onAbort)
      } catch {
        // a broken signal never blocks the release
      }
    }
    recordAudit({ owner: entry.owner ?? null, interactionId: entry.id, sessionId: entry.sessionId, action: entry.action ?? null, outcome: outcome, detail: detail ?? null })
    try {
      entry.resolve(outcome)
    } catch (error) {
      log(`release failed: ${error?.name ?? 'Error'}`)
    }
    return true
  }

  const respond = (input, callerCtx) => {
    if (disposed) return buildRespondOutcome('unavailable', 'the interactions authority is disposed')
    const validation = validateRespondInput(input)
    if (validation.ok !== true) return buildRespondOutcome('rejected', validation.reason)
    const value = validation.value
    const owner = callerIdentityOf(callerCtx)
    // An already-aborted signal means the caller is gone: refuse before any
    // state is touched, the same discipline the selection mutation uses.
    if (value.signal?.aborted === true) {
      return buildRespondOutcome('unavailable', 'the submission was aborted before it started')
    }
    const entry = held.get(value.id)
    if (entry === undefined) {
      // A known-but-unheld interaction is pending in the log yet answered by
      // someone else (or by no one): unavailable, never a fabricated stale.
      const known = registry.lookup(value.id)
      recordAudit({ owner, interactionId: value.id, sessionId: known?.sessionId ?? null, action: value.action, outcome: 'unavailable', detail: 'not held by this facade' })
      return buildRespondOutcome(
        known === undefined ? 'stale' : 'unavailable',
        known === undefined ? 'unknown or already settled interaction' : 'the pending interaction is answered through another answerer on this runtime',
      )
    }
    if (entry.kind !== 'approval') {
      return buildRespondOutcome('unavailable', 'question interactions are unavailable on this runtime')
    }
    if (value.action === 'answer') {
      recordAudit({ owner, interactionId: value.id, sessionId: entry.sessionId, action: 'answer', outcome: 'rejected', detail: 'approvals answer with approve/reject/cancel' })
      return buildRespondOutcome('rejected', 'an approval is answered with approve, reject or cancel')
    }
    const outcome = value.action === 'approve' ? 'allowed-once' : value.action === 'reject' ? 'rejected' : 'cancelled'
    entry.owner = owner
    entry.action = value.action
    if (release(entry, outcome, 'caller action') !== true) {
      return buildRespondOutcome('stale', 'the interaction was already settled')
    }
    return buildRespondOutcome('accepted', undefined)
  }

  /**
   * The last-resort answerer.
   *
   * Registered by the mount as an *append* listener, so an earlier answerer
   * always wins and this one is reached only when nothing else claimed the
   * request. It holds only for a watched session, only when the official id can
   * be derived from the same log evidence the official answerer uses, and only
   * until an explicit answer, an abort or the lease expiry.
   */
  const answerer = (request, next) => {
    if (disposed) return next()
    const sessionId = request?.agent?.session?.id
    if (typeof sessionId !== 'string' || sessionId === '') return next()
    if (!watched(sessionId)) return next()
    if (request?.signal?.aborted === true) return 'cancelled'
    const events = request?.agent?.session?.events
    const officialId = deriveApprovalId(events, { callId: request?.callId ?? null, claimed: claimedIds() })
    if (officialId === undefined) return next()
    const id = registry.idFor(sessionId, officialId)
    if (held.has(id)) return next()
    const agent = request.agent
    void agent
    return new Promise((resolve) => {
      const entry = { id, kind: 'approval', sessionId, officialId, resolve, released: false, action: null, signal: request?.signal, timer: undefined, onAbort: undefined }
      held.set(id, entry)
      const releaseLease = () => {
        if (entry.released) return
        release(entry, 'unavailable', 'watch lease expired without an answer')
      }
      try {
        entry.timer = timer.setTimeout(releaseLease, watchLeaseMs)
      } catch {
        entry.timer = undefined
      }
      if (entry.signal !== undefined && typeof entry.signal.addEventListener === 'function') {
        entry.onAbort = () => {
          if (entry.released) return
          release(entry, 'cancelled', 'the request signal aborted')
        }
        entry.signal.addEventListener('abort', entry.onAbort, { once: true })
      }
      entry.action = 'awaiting-caller'
      recordAudit({ interactionId: id, sessionId, action: 'held', outcome: 'pending', detail: 'last-resort answerer' })
    })
  }

  const internalAudit = () => Object.freeze({ records: Object.freeze([...auditRing]), gapCount, truncated: auditRing.length >= auditLimit })

  /** Mark one approval as decided (drops the mapping immediately). */
  const forget = (sessionId, officialId) => registry.clear(sessionId, officialId)

  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const entry of [...held.values()]) release(entry, 'unavailable', 'the feature was unmounted')
    held.clear()
    watches.clear()
  }

  return Object.freeze({
    list,
    get,
    respond,
    availability,
    answerer,
    deriveApprovalId,
    forget,
    watch,
    watched,
    registry,
    internalAudit,
    dispose,
    /** Test/diagnostic view of what this facade currently holds. */
    heldIds: () => Object.freeze([...held.keys()]),
    sourcesOf,
  })
}

/**
 * Mount the interactions members over the caller-bound `sessions` sub-surface.
 *
 * @returns {{surface: object, dispose: () => void} | null} `null` when the
 *   answerer could not be registered (the feature degrades to the disabled
 *   face, never to a silently view-only member).
 */
export function mountInteractionsFeature({ ctx, authority } = {}) {
  if (ctx === undefined || authority === undefined) return null
  let disposer = null
  try {
    if (typeof ctx.on === 'function') {
      const off = ctx.on('approval/request', authority.answerer)
      if (typeof off === 'function') disposer = off
    }
  } catch (error) {
    try {
      ctx?.logger?.warn?.(`dsh-plugin-api sessions.interactions: the approval answerer could not be registered: ${error?.name ?? 'Error'}`)
    } catch {
      // diagnostics are best-effort
    }
    return null
  }
  const surface = Object.freeze({
    list: (input) => authority.list(input),
    get: (input) => authority.get(input),
    respond: (input, callerCtx) => authority.respond(input, callerCtx),
    availability: () => authority.availability(),
  })
  void callerIdentityOf
  const dispose = () => {
    try {
      disposer?.()
    } catch {
      // unregistering is best-effort
    }
    authority.dispose()
  }
  return { surface, dispose }
}

/** Kinds this feature can report (published for registration/tests). */
export { INTERACTION_KINDS, RESPOND_ACTIONS }

/**
 * Mount the interactions feature onto the main facade.
 *
 * @returns {{disposer: Function, prepared: object} | null} `null` when the
 *   answerer could not be registered, so the feature stays disabled instead of
 *   shipping a view that could never answer.
 */
export function mountSessionsInteractionsFeature({ ctx, service, featureRegistry, logger } = {}) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('sessionInteractions')) {
    return { disposer: () => {}, prepared: null }
  }
  const lookupSession = (sessionId) => {
    try {
      const sessions = ctx?.get?.('sessions')
      return typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined
    } catch {
      return undefined
    }
  }
  const listSessions = () => {
    try {
      const sessions = ctx?.get?.('sessions')
      if (typeof sessions?.list !== 'function') return undefined
      const listed = sessions.list()
      return Array.isArray(listed) ? listed : undefined
    } catch {
      return undefined
    }
  }
  const authority = createInteractionsAuthority({ ctx, sessionLookup: lookupSession, sessionList: listSessions })
  const mounted = mountInteractionsFeature({ ctx, authority })
  if (mounted === null) {
    try {
      logger?.warn?.('dsh-plugin-api: sessions.interactions could not register its approval answerer and stays disabled')
    } catch {
      // diagnostics must never escape the fail-safe mount path
    }
    return null
  }
  const ownerApi = {
    surfaceFor: () => mounted.surface,
    availability: () => {
      try {
        return authority.availability()
      } catch {
        return buildInteractionsAvailability({ status: 'unavailable', reason: 'the interactions availability probe failed' })
      }
    },
  }
  // Client→host typed route: the browser list/get/respond face rides the
  // connection RPC carrier; absence degrades the client face to typed
  // unavailable (never queued, never fabricated).
  const route = installClientRequestRoute({
    ctx,
    path: '/plugin-api/sessions/interactions',
    handler: createInteractionsRouteHandler({ interactions: mounted.surface, ctx }),
    logger,
  })
  let prepared
  try {
    prepared = service.prepareFeature('sessionInteractions', ownerApi)
  } catch (error) {
    try {
      logger?.warn?.(`dsh-plugin-api: sessions.interactions could not be prepared: ${error?.message ?? error}`)
    } catch {
      // diagnostics must never escape the fail-safe mount path
    }
    route.dispose()
    mounted.dispose()
    return null
  }
  return {
    disposer: () => {
      route.dispose()
      mounted.dispose()
    },
    prepared,
  }
}
