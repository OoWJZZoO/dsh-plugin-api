/**
 * Single request authority for the session interaction operation facade.
 *
 * The authority is the ONLY owner of acceptance / dedupe / cancellation
 * propagation and terminal adjudication for external session requests. The
 * loop-side slice only reports attempt facts and its admission/cancel boundary;
 * it never commits an operation terminal.
 *
 * Contract anchors: the frozen outcome and status shapes the operation face
 * publishes; see `docs/specs/session-interaction-operation/`. This is an owner module: it is self-contained, never imports the
 * auxiliary agent-loop package (it reads the shared `Symbol.for(...)`
 * boundary marker with a duck-type shape check), and does not touch the shared
 * mounter/guard/service files.
 */
import {
  PluginApiFeatureDisabledError,
  PluginApiInactiveError,
} from './errors.js'
import { createOperationHandle } from './contract-kernel.js'
import { resolveAttachmentRefs, toSurfaceMessage } from './session-message-mapping.js'
import {
  adjudicateTerminal,
  buildAcceptedOutcome,
  buildActivityCorrelation,
  buildAlreadyRunningOutcome,
  buildDeclaredCapability,
  buildDeniedOutcome,
  buildDuplicateOutcome,
  buildOperationStatus,
  buildRejectedOutcome,
  buildQueueAcceptedOutcome,
  buildQueuedCancelOutcome,
  buildSteerAcceptedOutcome,
  buildUnavailableOutcome,
  freezeStatus,
  mapSliceAdmissionRejection,
  mintId,
  validateCancelInput,
  validateRequestSpec,
} from './session-interaction-operation-normalize.js'

/** Facade-side copy of the shared boundary marker literal (never imports the aux package). */
export const INTERACTION_BOUNDARY_SYMBOL = Symbol.for('dsh-plugin-api.agent-loop.interaction')

function duckBoundary(value) {
  return Boolean(
    value &&
    typeof value.admit === 'function' &&
    typeof value.cancelAttempt === 'function' &&
    typeof value.availability === 'function',
  )
}

/** Resolve the loop boundary from a mounted context (integration wiring default). */
export function resolveAgentLoopBoundary(ctx) {
  try {
    const agentLoop = ctx?.get?.('agentLoop')
    const boundary = agentLoop?.[INTERACTION_BOUNDARY_SYMBOL]
    return duckBoundary(boundary) ? boundary : null
  } catch {
    return null
  }
}

function defaultTimer() {
  return { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) }
}

/** Accept a waiting marker only in the projection's own graded shape. */
function waitingEvidenceOf(value) {
  if (value === null || typeof value !== 'object') return null
  const kind = value.kind
  const confidence = value.confidence
  if (typeof kind !== 'string' || kind === '' || typeof confidence !== 'string' || confidence === '') return null
  return Object.freeze({ kind, confidence })
}

/** Waiting markers compare by kind and grade: they are evidence, not identity. */
function sameWaitingEvidence(a, b) {
  if (a === null || b === null) return a === b
  return a.kind === b.kind && a.confidence === b.confidence
}

function isoNow(now) {
  try {
    const value = now()
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
  } catch {
    return new Date().toISOString()
  }
}

const DEFAULT_AUDIT_LIMIT = 200

/**
 * Create the single request authority.
 *
 * @param {object} [options]
 * @param {() => boolean} [options.coreActive]
 * @param {() => boolean} [options.featureDisabled]
 * @param {(sessionId: string) => boolean} [options.sessionExists]
 * @param {() => ({boundary: object, versionOk: boolean} | null)} [options.resolveBoundary]
 *   Resolves the loop boundary plus its version-qualified status. `null` means
 *   the boundary is unavailable (slice inactive or unmounted); `{boundary,
 *   versionOk: false}` means present but version-mismatched.
 * @param {(sessionId: string, kind: string, payload: object) => Promise<{ok: boolean, reason?: string, seq?: number}>} [options.durableAppend]
 * @param {() => ((ref: object, signal?: AbortSignal) => Promise<object>) | undefined} [options.readAttachment]
 *   Reader for the attachments authority's verified read; injected into both
 *   the durable mapping and the inbox delivery so one mapping serves both.
 * @param {(sessionId: string) => object | undefined} [options.resolveLiveAgent]
 *   Resolves the live agent of a session so `delivery` can reach the official
 *   `agent.steer`/`agent.followup`/`agent.inbox` seams. A missing agent refuses
 *   the delivery typed instead of appending and guessing.
 * @param {(callerCtx?: unknown) => string} [options.ownerOf]
 * @param {() => boolean} [options.durableAvailable]
 * @param {(input: {sessionId: string, executionId: string, activityId?: string|null}) => {confidence?: string, activityId?: string, waiting?: {kind?: string, confidence?: string} | null}} [options.readActivityCorrelation]
 *   Read-only consultation of the shared activity projection.
 *   It answers with the projection's own evidence grade plus, when the
 *   projection publishes one, the waiting marker that drives the operation's
 *   waiting status; an absent reader or a throwing/malformed reader is treated
 *   as `unavailable` (the projection is the answer's owner, never this
 *   authority).
 * @param {object} [options.logger]
 * @param {() => Date} [options.now]
 * @param {{setTimeout, clearTimeout}} [options.timer]
 * @param {number} [options.cancelConfirmTimeoutMs]
 * @param {number} [options.auditLimit]
 */
export function createRequestAuthority(options = {}) {
  const coreActive = options.coreActive ?? (() => true)
  const featureDisabled = options.featureDisabled ?? (() => false)
  const sessionExists = options.sessionExists ?? (() => true)
  const resolveBoundary = options.resolveBoundary ?? (() => null)
  const durableAppend = options.durableAppend ?? (async () => ({ ok: false, reason: 'durable append unavailable' }))
  const readAttachment = options.readAttachment ?? (() => undefined)
  const resolveLiveAgent = options.resolveLiveAgent ?? (() => undefined)
  const durableAvailable = options.durableAvailable ?? (() => true)
  const ownerOf = options.ownerOf ?? (() => 'root')
  const readActivityCorrelation = options.readActivityCorrelation ?? (() => ({ confidence: 'unavailable' }))
  const logger = options.logger
  const now = options.now ?? (() => new Date())
  const timer = options.timer ?? defaultTimer()
  const cancelConfirmTimeoutMs = options.cancelConfirmTimeoutMs ?? 60_000
  const auditLimit = options.auditLimit ?? DEFAULT_AUDIT_LIMIT

  const operations = new Map()
  const sessionLive = new Map()
  const dedupe = new Map()
  const children = new Map()
  const auditRing = []
  let gapCount = 0
  let disposed = false

  const log = (message) => {
    try {
      logger?.warn?.(`dsh-plugin-api attempt-facts: ${message}`)
    } catch {
      // diagnostics are best-effort
    }
  }

  const assertActive = () => {
    if (disposed || !coreActive()) throw new PluginApiInactiveError()
    if (featureDisabled()) throw new PluginApiFeatureDisabledError('sessions.request', 'session request operation feature is disabled')
  }

  const recordAudit = (entry) => {
    const record = Object.freeze({ at: isoNow(now), ...entry, cause: entry.cause ?? null })
    try {
      auditRing.push(record)
      if (auditRing.length > auditLimit) auditRing.shift()
      return true
    } catch {
      gapCount += 1
      return false
    }
  }

  /**
   * Consult the shared activity projection for one execution identity.
   *
   * The authority consumes the projection's public read surface only; it never
   * mints an activity identity from event sequences and never upgrades the
   * projection's own evidence grade. Reader failures degrade
   * to `unavailable` instead of guessing.
   */
  const resolveCorrelation = (sessionId, executionId, knownActivityId) => {
    try {
      const answer = readActivityCorrelation({ sessionId, executionId, activityId: knownActivityId })
      return {
        correlation: buildActivityCorrelation({
          executionId,
          confidence: answer?.confidence,
          activityId: answer?.activityId,
        }),
        waiting: waitingEvidenceOf(answer?.waiting),
      }
    } catch (error) {
      log(`activity correlation read failed: ${error?.name ?? 'Error'}`)
      return {
        correlation: buildActivityCorrelation({ executionId, confidence: 'unavailable' }),
        waiting: null,
      }
    }
  }

  /**
   * Non-terminal phase for one operation: waiting evidence the projection
   * published wins over the attempt-derived phase, so approval/question/tool
   * waits are reported from the shared evidence instead of a second state
   * machine.
   */
  const derivedPhase = (op) => {
    if (op.waiting !== null) return 'waiting'
    return op.attempt === null ? 'accepted' : 'running'
  }

  /**
   * Refresh one operation's activity correlation from the shared projection.
   *
   * Called on every status read (handle and client wire route) and after each
   * status-changing attempt fact, so the correlation and the waiting status
   * are exposed as soon as the projection evidences them. A known correlation
   * is re-read by activity id (cheap, and its waiting marker may still
   * change); `unknown` answers keep being searched because evidence may still
   * arrive.
   */
  const refreshProjection = (op, { silent = false } = {}) => {
    const current = op.status.activity
    const { correlation, waiting } = resolveCorrelation(op.sessionId, op.executionId, current.activityId)
    const activityChanged = correlation.activityId !== current.activityId || correlation.confidence !== current.confidence
    const waitingChanged = !sameWaitingEvidence(waiting, op.waiting)
    if (!activityChanged && !waitingChanged) return false
    op.waiting = waiting
    const patch = {}
    if (activityChanged) patch.activity = correlation
    if (op.status.phase !== 'terminal') {
      const phase = derivedPhase(op)
      if (phase !== op.status.phase) patch.phase = phase
    }
    setStatus(op, patch)
    if (silent !== true) notify(op)
    return true
  }

  const statusOf = (op) => {
    refreshProjection(op)
    return op._frozenStatus
  }

  const notify = (op) => {
    const frozen = op._frozenStatus
    for (const listener of op.observers) {
      try {
        listener(frozen)
      } catch (error) {
        log(`observer threw: ${error?.name ?? 'Error'}`)
      }
    }
  }

  const setStatus = (op, patch) => {
    op.status = { ...op.status, ...patch, observedAt: isoNow(now) }
    op._frozenStatus = freezeStatus(op.status)
  }

  /** Commit exactly one frozen terminal; later signals are diagnostic only. */
  const commitTerminal = (op, outcome, classification, reason, observedAt) => {
    if (op.status.phase === 'terminal') {
      recordAudit({ owner: op.ownerId, operationId: op.id, sessionId: op.sessionId, outcomeCode: 'late-signal', detail: `${outcome}/${classification}` })
      return false
    }
    const at = observedAt ?? isoNow(now)
    setStatus(op, { phase: 'terminal', terminal: { outcome, reason: reason ?? undefined, classification: classification ?? outcome } })
    // A terminal commit is the last status the observers are guaranteed to
    // see: fold in an activity correlation the projection already evidences
    // instead of leaving the terminal carrying a stale `unknown`.
    refreshProjection(op, { silent: true })
    if (sessionLive.get(op.sessionId) === op.id) sessionLive.delete(op.sessionId)
    if (op.dedupeKey !== undefined && dedupe.get(op.dedupeKey) === op.id) dedupe.delete(op.dedupeKey)
    if (op.confirmTimer !== undefined) {
      timer.clearTimeout(op.confirmTimer)
      op.confirmTimer = undefined
    }
    const parentSet = op.parent === undefined ? undefined : children.get(op.parent)
    if (parentSet !== undefined && parentSet.delete(op.id) && parentSet.size === 0) children.delete(op.parent)
    recordAudit({ owner: op.ownerId, operationId: op.id, sessionId: op.sessionId, outcomeCode: outcome, attemptCount: op.attempts, by: op.lastBy ?? null })
    notify(op)
    return true
  }

  /**
   * Public control handle for one live operation.
   *
   * The handle carries the operation identity, its declared capability and the
   * status projection; `dispose()` is the operation-class disposer — it asks
   * the authority to stop the operation and answers `requested`, or `stale`
   * when nothing could change (already requested, already terminal, or the
   * authority is gone). It never adjudicates the terminal: the stop
   * propagation path and the attempt facts stay the only terminal sources.
   */
  const createHandle = (op) =>
    createOperationHandle({
      id: op.id,
      ownerId: op.ownerId,
      extensions: {
        capability: op.declared,
        status: () => statusOf(op),
        observe: (listener) => {
          if (typeof listener !== 'function') return () => false
          op.observers.add(listener)
          try {
            listener(statusOf(op))
          } catch {
            // immediate delivery containment
          }
          return () => op.observers.delete(listener)
        },
      },
      requestStop: () => requestCancel(op, { by: 'owner', reason: 'disposed' }).ok === true,
    })

  /** Shared cancellation-propagation path used by cancel(), dispose(), signal abort and parent cascade. */
  const requestCancel = (op, input) => {
    if (disposed) return { ok: false, code: 'unavailable', reason: 'authority disposed' }
    if (op.status.phase === 'terminal') return { ok: false, code: 'stale', reason: 'operation already terminal' }
    const by = input.by ?? 'owner'
    const reason = input.reason
    op.cancelRequested = true
    op.lastBy = by
    if (input.supersede === true) op.supersededRequested = true
    const resolved = resolveBoundary()
    let propagated = false
    let boundaryPresent = false
    if (resolved !== null && resolved.boundary !== null) {
      boundaryPresent = true
      try {
        const result = resolved.boundary.cancelAttempt(op.attemptRef, {
          reason: { message: reason ?? `cancelled (${by})`, by, superseded: op.supersededRequested === true },
          signal: op.localSignal,
        })
        propagated = result?.ok === true
      } catch (error) {
        log(`cancel propagation failed: ${error?.name ?? 'Error'}`)
      }
    } else {
      log('cancel cannot propagate: loop boundary unavailable')
    }
    if (op.attempt === null) {
      // Nothing live to await. The pending admission was removed (or the loop
      // never picked the work up); the authority adjudicates now.
      commitTerminal(op, op.supersededRequested === true ? 'superseded' : 'aborted', op.supersededRequested === true ? 'superseded' : 'aborted', reason, isoNow(now))
    } else if (!boundaryPresent) {
      // Live attempt but no boundary to confirm: adjudicate from the still
      // valid cancel signal without waiting for an unreachable confirmation.
      commitTerminal(op, op.supersededRequested === true ? 'superseded' : 'aborted', op.supersededRequested === true ? 'superseded' : 'aborted', reason, isoNow(now))
    } else {
      // Live attempt: await the attempt-end fact or the confirmation bound.
      if (op.confirmTimer === undefined && typeof cancelConfirmTimeoutMs === 'number' && cancelConfirmTimeoutMs > 0) {
        op.confirmTimer = timer.setTimeout(() => {
          if (op.status.phase === 'terminal') return
          commitTerminal(op, op.supersededRequested === true ? 'superseded' : 'aborted', op.supersededRequested === true ? 'superseded' : 'aborted', reason ?? 'cancel confirmation bound', isoNow(now))
        }, cancelConfirmTimeoutMs)
      }
    }
    recordAudit({ owner: op.ownerId, operationId: op.id, sessionId: op.sessionId, outcomeCode: 'cancel-requested', by, cause: reason ?? null })
    // Parent-to-child propagation: a cancelled parent cascades the same stop
    // request to every still-live child operation (and their attempts). A
    // child's own cancellation or failure never reverse-cancels the parent.
    const kidSet = children.get(op.id)
    if (kidSet !== undefined) {
      for (const childId of [...kidSet]) {
        const child = operations.get(childId)
        if (child !== undefined && child.status.phase !== 'terminal') {
          requestCancel(child, { by, reason: 'parent cancelled', supersede: input.supersede === true })
        }
      }
    }
    return { ok: true, code: 'accepted' }
  }

  const awaitDurableAppend = (sessionId, message) => {
    try {
      const result = durableAppend(sessionId, message.kind, { text: message.text, attachmentRefs: message.attachmentRefs }, { sourceEventSeqs: undefined })
      return result && typeof result.then === 'function' ? result : Promise.resolve(result ?? { ok: false, reason: 'unavailable' })
    } catch (error) {
      log(`durable append threw: ${error?.name ?? 'Error'}`)
      return Promise.resolve({ ok: false, reason: 'append threw' })
    }
  }

  const resolverOf = (callerCtx) => {
    try {
      const owner = ownerOf(callerCtx)
      return typeof owner === 'string' && owner.length > 0 ? owner : 'root'
    } catch {
      return 'root'
    }
  }

  /**
   * Route one external request through the single authority (async: content is
   * durably appended before acceptance is observable).
   * @returns {Promise<object>} discriminated outcome per the frozen contract.
   */
  /**
   * Deliver a message beside the live operation of the same session.
   *
   * `steer` splices into the live attempt and `queue` parks the message in the
   * official next-turn inbox. Both go through the official agent seams and
   * neither mints a second operation: the live operation keeps its identity,
   * and a queued delivery is addressed by the message identity the official
   * inbox itself removes by. Every failure path is typed and, crucially,
   * nothing is written when the seam is unreachable — there is no
   * append-and-guess fallback.
   */
  const deliverToLiveOperation = async (live, value, owner) => {
    const message = value.message
    if (message === null || message === undefined) {
      recordAudit({ owner, operationId: live.id, sessionId: value.sessionId, outcomeCode: 'rejected', detail: 'delivery without a message' })
      return buildRejectedOutcome({ reason: 'delivery requires a message', domainCode: 'invalid-input' })
    }
    const agent = resolveLiveAgent(value.sessionId)
    const deliveryName = value.delivery === 'steer' ? 'steer' : 'followup'
    if (agent === null || agent === undefined || typeof agent[deliveryName] !== 'function'
      || agent.inbox === null || agent.inbox === undefined || typeof agent.inbox.remove !== 'function') {
      recordAudit({ owner, operationId: live.id, sessionId: value.sessionId, outcomeCode: 'unavailable', detail: `delivery seam unavailable (${value.delivery})` })
      return buildUnavailableOutcome(`the official ${value.delivery} delivery seam is unavailable; nothing was queued`)
    }
    const attachments = await resolveAttachmentRefs(message.attachmentRefs, readAttachment(), value.signal)
    if (attachments.ok !== true) {
      recordAudit({ owner, operationId: live.id, sessionId: value.sessionId, outcomeCode: 'unavailable', detail: 'delivery attachment resolution failed' })
      return buildUnavailableOutcome(`delivery attachments could not be resolved: ${attachments.reason}; nothing was queued`)
    }
    const surface = toSurfaceMessage(message.kind, message, attachments.refs)
    if (surface.ok !== true) {
      recordAudit({ owner, operationId: live.id, sessionId: value.sessionId, outcomeCode: 'rejected', detail: 'delivery message is not mappable' })
      return buildRejectedOutcome({ reason: surface.reason, domainCode: 'invalid-input' })
    }
    try {
      agent[deliveryName](surface.message)
    } catch (error) {
      log(`delivery (${value.delivery}) failed: ${error?.name ?? 'Error'}`)
      recordAudit({ owner, operationId: live.id, sessionId: value.sessionId, outcomeCode: 'unavailable', detail: `delivery seam threw (${value.delivery})` })
      return buildUnavailableOutcome(`the official ${value.delivery} delivery seam refused the message; nothing was queued`)
    }
    if (value.delivery === 'steer') {
      recordAudit({ owner, operationId: live.id, sessionId: value.sessionId, outcomeCode: 'accepted', detail: 'steered into the live attempt' })
      return buildSteerAcceptedOutcome(live.id)
    }
    recordAudit({ owner, operationId: live.id, sessionId: value.sessionId, outcomeCode: 'accepted', detail: 'queued in the official next-turn inbox' })
    return buildQueueAcceptedOutcome(surface.message.id, live.id)
  }

  /**
   * Cancel a queued delivery: the official inbox removal answers whether the
   * message was still pending. A claimed message only falls through to the
   * live-cancel path when the caller's recorded operation is still the live
   * one — otherwise the queued work already ran and cancelling "the session"
   * would hit an unrelated later operation.
   */
  const cancelQueuedDelivery = (value) => {
    const { queuedRef } = value
    const agent = resolveLiveAgent(value.sessionId)
    if (agent === null || agent === undefined || agent.inbox === null || agent.inbox === undefined
      || typeof agent.inbox.remove !== 'function') {
      recordAudit({ owner: value.by, operationId: null, sessionId: value.sessionId, outcomeCode: 'unavailable', detail: 'queued cancel seam unavailable' })
      return buildUnavailableOutcome('the official inbox seam is unavailable; the queued message was not cancelled')
    }
    let removed = false
    try {
      removed = agent.inbox.remove(queuedRef.id) === true
    } catch (error) {
      log(`queued cancel failed: ${error?.name ?? 'Error'}`)
      return buildUnavailableOutcome('the official inbox refused the removal; the queued message was not cancelled')
    }
    if (removed) {
      recordAudit({ owner: value.by, operationId: queuedRef.operationId, sessionId: value.sessionId, outcomeCode: 'accepted', detail: 'queued delivery discarded before claim' })
      return buildQueuedCancelOutcome()
    }
    const liveId = sessionLive.get(value.sessionId)
    const live = liveId === undefined ? undefined : operations.get(liveId)
    if (queuedRef.operationId === null || live === undefined || live.id !== queuedRef.operationId || live.status.phase === 'terminal') {
      recordAudit({ owner: value.by, operationId: queuedRef.operationId, sessionId: value.sessionId, outcomeCode: 'stale', detail: 'queued delivery was already claimed' })
      return { ok: false, code: 'stale', reason: 'the queued message was already claimed and its operation is no longer live' }
    }
    return requestCancel(live, { by: value.by, reason: value.reason ?? 'queued delivery claimed; cancelled through the live operation' })
  }

  const request = async (spec, callerCtx) => {
    assertActive()
    const validation = validateRequestSpec(spec)
    if (!validation.ok) {
      return buildRejectedOutcome({ reason: validation.reason, domainCode: 'invalid-input' })
    }
    const value = validation.value
    const owner = resolverOf(callerCtx)
    if (!sessionExists(value.sessionId)) {
      return buildRejectedOutcome({ reason: 'session not found', domainCode: 'invalid-input' })
    }
    const dedupeKey = value.idempotencyKey === undefined ? undefined : `${owner}\u0000${value.idempotencyKey}`
    if (dedupeKey !== undefined) {
      const existingId = dedupe.get(dedupeKey)
      const existing = existingId === undefined ? undefined : operations.get(existingId)
      if (existing !== undefined && existing.status.phase !== 'terminal') {
        return buildDuplicateOutcome({ id: existing.id })
      }
    }
    const liveId = sessionLive.get(value.sessionId)
    if (liveId !== undefined) {
      const live = operations.get(liveId)
      if (live !== undefined && live.status.phase !== 'terminal') {
        if (value.delivery === undefined) return buildAlreadyRunningOutcome({ id: live.id })
        return await deliverToLiveOperation(live, value, owner)
      }
    }
    const resolved = resolveBoundary()
    if (resolved === null || resolved.boundary === null) {
      recordAudit({ owner, operationId: null, sessionId: value.sessionId, outcomeCode: 'unavailable', detail: 'loop boundary unavailable' })
      return buildUnavailableOutcome('session request loop boundary is unavailable')
    }
    if (resolved.versionOk === false) {
      recordAudit({ owner, operationId: null, sessionId: value.sessionId, outcomeCode: 'unavailable', detail: 'loop boundary version mismatch' })
      return buildUnavailableOutcome('session request loop boundary version mismatch')
    }
    const operationId = mintId('op')
    const executionId = mintId('ex')
    let admit
    try {
      admit = resolved.boundary.admit({ sessionId: value.sessionId, operationId, executionId, idempotencyKey: value.idempotencyKey })
    } catch (error) {
      log(`admit failed: ${error?.name ?? 'Error'}`)
      recordAudit({ owner, operationId, sessionId: value.sessionId, outcomeCode: 'unavailable', detail: 'admit threw' })
      return buildUnavailableOutcome('session request admission failed')
    }
    if (admit?.accepted !== true) {
      const mapped = mapSliceAdmissionRejection(admit?.code)
      recordAudit({ owner, operationId, sessionId: value.sessionId, outcomeCode: mapped.code, detail: admit?.code })
      if (mapped.code === 'denied') return buildDeniedOutcome({ reason: 'loop gate denied the request', domainCode: mapped.domainCode })
      if (mapped.code === 'duplicate') return buildDuplicateOutcome({ id: operationId })
      if (mapped.code === 'unavailable') return buildUnavailableOutcome('session request admission rejected with ambiguity')
      return buildRejectedOutcome({ reason: 'request not admissible at the loop boundary', domainCode: mapped.domainCode })
    }
    // Content write through the audited durable mutation contract (source
    // provenance recorded by the durable layer). Failure means the request is
    // not started: the pending admission is rolled back best-effort and a typed
    // unavailable outcome is returned without any observable operation.
    if (value.message !== null) {
      const append = await awaitDurableAppend(value.sessionId, value.message)
      if (append.ok !== true) {
        try {
          resolved.boundary.cancelAttempt({ sessionId: value.sessionId, operationId }, { reason: { message: 'durable append failed' } })
        } catch {
          // pending admission removal is best-effort
        }
        recordAudit({ owner, operationId, sessionId: value.sessionId, outcomeCode: 'unavailable', detail: 'durable append failed' })
        // Surface the durable layer's own reason (bounded): "content write
        // failed" alone hides whether the write was rejected, unmapped or
        // unavailable, which the caller must be able to tell apart.
        return buildUnavailableOutcome(
          typeof append?.reason === 'string' && append.reason.length > 0
            ? `durable content write failed: ${append.reason}; request not started`
            : 'durable content write failed; request not started',
        )
      }
    }
    const localController = new AbortController()
    const { correlation, waiting } = resolveCorrelation(value.sessionId, executionId, null)
    const op = {
      id: operationId,
      ownerId: owner,
      sessionId: value.sessionId,
      executionId,
      idempotencyKey: value.idempotencyKey,
      parent: value.parent,
      cause: value.cause,
      declared: buildDeclaredCapability({ idempotencyKey: value.idempotencyKey }),
      attemptRef: admit.attemptRef,
      attempt: null,
      waiting,
      status: { phase: 'accepted', terminal: null, attempt: null, activity: correlation, observedAt: isoNow(now) },
      _frozenStatus: undefined,
      observers: new Set(),
      cancelRequested: false,
      supersededRequested: false,
      confirmTimer: undefined,
      attempts: 0,
      lastBy: null,
      dedupeKey,
      localController,
      localSignal: localController.signal,
      releaseCallerSignal: undefined,
    }
    // Waiting evidence the projection already publishes governs the opening
    // phase too (never a fabricated `accepted` while the source says waiting).
    op.status = { ...op.status, phase: derivedPhase(op) }
    op._frozenStatus = freezeStatus(op.status)
    operations.set(operationId, op)
    sessionLive.set(value.sessionId, operationId)
    if (dedupeKey !== undefined) dedupe.set(dedupeKey, operationId)
    if (value.parent !== undefined) {
      children.set(value.parent, (children.get(value.parent) ?? new Set()).add(operationId))
    }
    if (value.signal !== undefined) {
      const onAbort = () => requestCancel(op, { by: 'owner', reason: 'caller signal aborted' })
      value.signal.addEventListener('abort', onAbort, { once: true })
      op.releaseCallerSignal = () => value.signal.removeEventListener('abort', onAbort)
      if (value.signal.aborted === true) {
        // The caller aborted while the request was still in flight: an aborted
        // signal never fires again, so the authority cancels the operation it
        // just created instead of starting work for a caller that is gone.
        requestCancel(op, { by: 'owner', reason: 'caller signal aborted' })
      }
    }
    recordAudit({ owner, operationId, sessionId: value.sessionId, outcomeCode: 'accepted', attemptCount: 0 })
    return buildAcceptedOutcome({
      operation: createHandle(op),
      activity: correlation,
    })
  }

  const cancel = (input, callerCtx) => {
    assertActive()
    const validation = validateCancelInput(input)
    if (!validation.ok) return { ok: false, code: 'invalid-input', reason: validation.reason }
    const value = validation.value
    if (value.queuedRef !== undefined) return cancelQueuedDelivery(value)
    let op = undefined
    if (value.operationId !== undefined) {
      op = operations.get(value.operationId)
    } else if (value.sessionId !== undefined) {
      const liveId = sessionLive.get(value.sessionId)
      op = liveId === undefined ? undefined : operations.get(liveId)
    }
    if (op === undefined) {
      return { ok: false, code: 'stale', reason: 'no matching operation' }
    }
    if (op.status.phase === 'terminal') {
      return { ok: false, code: 'stale', reason: 'operation already terminal' }
    }
    return requestCancel(op, { by: value.by, reason: value.reason })
  }

  const inferFactName = (fact) => (fact !== null && typeof fact === 'object' && typeof fact.outcome === 'string' ? 'agent/attempt/end' : 'agent/attempt/start')

  /** Ingest one attempt fact (wired at mount to the slice events). */
  const ingestAttemptFact = (fact) => {
    if (disposed || fact === null || typeof fact !== 'object') return
    if (typeof fact.operationId !== 'string') return
    const op = operations.get(fact.operationId)
    if (op === undefined) return
    const name = typeof fact.name === 'string' ? fact.name : inferFactName(fact)
    if (name === 'agent/attempt/start') {
      if (op.status.phase === 'terminal') {
        recordAudit({ owner: op.ownerId, operationId: op.id, sessionId: op.sessionId, outcomeCode: 'late-fact', detail: 'attempt/start after terminal' })
        return
      }
      op.attempts += 1
      op.attempt = { attemptId: fact.attemptId ?? null, attemptSeq: op.attempts, startedAt: fact.observedAt ?? null, endedAt: null }
      setStatus(op, { attempt: op.attempt, phase: derivedPhase(op) })
      refreshProjection(op, { silent: true })
      notify(op)
      return
    }
    if (name === 'agent/attempt/end') {
      if (op.status.phase === 'terminal') {
        recordAudit({ owner: op.ownerId, operationId: op.id, sessionId: op.sessionId, outcomeCode: 'late-fact', detail: 'attempt/end after terminal' })
        return
      }
      if (op.attempt !== null) {
        op.attempt = { ...op.attempt, endedAt: fact.observedAt ?? null }
      }
      const verdict = adjudicateTerminal({
        cancelRequested: op.cancelRequested,
        superseded: op.supersededRequested,
        fact: { outcome: fact.outcome, classification: fact.classification },
      })
      if (verdict !== null) {
        commitTerminal(op, verdict.outcome, verdict.classification, fact.reason ?? undefined, fact.observedAt ?? isoNow(now))
      }
      return
    }
    // unknown fact name is ignored (never a partial commit)
  }

  const availability = () => {
    if (disposed) return Object.freeze({ status: 'unavailable', reason: 'authority disposed' })
    if (!coreActive()) return Object.freeze({ status: 'unavailable', reason: 'facade core inactive' })
    if (featureDisabled()) return Object.freeze({ status: 'unavailable', reason: 'session request operation feature disabled' })
    const resolved = resolveBoundary()
    if (resolved === null || resolved.boundary === null) {
      return Object.freeze({ status: 'degraded', reason: 'loop admission boundary inactive; request/cancel execute return typed unavailable' })
    }
    if (resolved.versionOk === false) {
      return Object.freeze({ status: 'degraded', reason: 'loop admission boundary version mismatch' })
    }
    if (!durableAvailable()) {
      return Object.freeze({ status: 'degraded', reason: 'durable append unavailable; request content write returns typed unavailable' })
    }
    return Object.freeze({ status: 'active' })
  }

  /** Bounded internal diagnostics (not a public projection; v1 in-memory only). */
  const internalAudit = () => Object.freeze({ records: [...auditRing], gapCount, truncated: auditRing.length === auditLimit })

  /**
   * Read-only status projection for one operation.
   *
   * Returns the same frozen value-only status the host handle exposes (no
   * methods, no private objects), or `null` for an unknown/disposed id. It
   * powers the client→host status route: an unknown id is reported as `null`
   * so the wire layer answers with a typed outcome instead of fabricating a
   * terminal. Terminal adjudication stays exclusively in `commitTerminal`.
   */
  const operationStatus = (operationId) => {
    if (typeof operationId !== 'string' || operationId.length === 0) return null
    const op = operations.get(operationId)
    if (op === undefined) return null
    return statusOf(op)
  }

  const dispose = () => {
    disposed = true
    for (const op of operations.values()) {
      if (op.confirmTimer !== undefined) timer.clearTimeout(op.confirmTimer)
      try {
        op.releaseCallerSignal?.()
      } catch {
        // best-effort cleanup
      }
      try {
        op.localController.abort()
      } catch {
        // best-effort cleanup
      }
    }
    operations.clear()
    sessionLive.clear()
    dedupe.clear()
    children.clear()
  }

  return Object.freeze({
    request,
    cancel,
    ingestAttemptFact,
    availability,
    operationStatus,
    internalAudit,
    dispose,
  })
}
