/**
 * Single request authority for the session interaction operation facade.
 *
 * The authority is the ONLY owner of acceptance / dedupe / cancellation
 * propagation and terminal adjudication for external session requests. The
 * loop-side slice only reports attempt facts and its admission/cancel boundary;
 * it never commits an operation terminal.
 *
 * Contract anchors: `docs/specs/session-interaction-operation/requirements.md`
 * Requirements 1–10 and the frozen outcome/status shapes in the design Data
 * Models. This is an owner module: it is self-contained, never imports the
 * auxiliary agent-loop package (it reads the shared `Symbol.for(...)`
 * boundary marker with a duck-type shape check), and does not touch the shared
 * mounter/guard/service files.
 */
import {
  PluginApiFeatureDisabledError,
  PluginApiInactiveError,
} from './errors.js'
import {
  adjudicateTerminal,
  buildAcceptedOutcome,
  buildAlreadyRunningOutcome,
  buildDeclaredCapability,
  buildDeniedOutcome,
  buildDuplicateOutcome,
  buildOperationStatus,
  buildRejectedOutcome,
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
 * @param {(callerCtx?: unknown) => string} [options.ownerOf]
 * @param {() => boolean} [options.durableAvailable]
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
  const durableAvailable = options.durableAvailable ?? (() => true)
  const ownerOf = options.ownerOf ?? (() => 'root')
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

  const statusOf = (op) => op._frozenStatus

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

  const createHandle = (op) =>
    Object.freeze({
      id: op.id,
      ownerId: op.ownerId,
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
      dispose: () => requestCancel(op, { by: 'owner', reason: 'disposed' }),
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
        return buildAlreadyRunningOutcome({ id: live.id })
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
    const op = {
      id: operationId,
      ownerId: owner,
      sessionId: value.sessionId,
      idempotencyKey: value.idempotencyKey,
      parent: value.parent,
      cause: value.cause,
      declared: buildDeclaredCapability({ idempotencyKey: value.idempotencyKey }),
      attemptRef: admit.attemptRef,
      attempt: null,
      status: { phase: 'accepted', terminal: null, attempt: null, activity: { activityId: null, executionId, confidence: 'unknown' }, observedAt: isoNow(now) },
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
      activity: { activityId: null, executionId, confidence: 'unknown' },
    })
  }

  const cancel = (input, callerCtx) => {
    assertActive()
    const validation = validateCancelInput(input)
    if (!validation.ok) return { ok: false, code: 'invalid-input', reason: validation.reason }
    const value = validation.value
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
      setStatus(op, { phase: 'running', attempt: op.attempt })
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