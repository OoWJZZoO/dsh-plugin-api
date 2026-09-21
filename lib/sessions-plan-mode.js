import { PluginApiInactiveError } from './errors.js'
import { releasedResult, staleResult } from './contract-kernel.js'

/**
 * Controlled plan-mode switch face (`sessions.planMode`), core module.
 *
 * The official `planMode` service owns the state: it folds the session log
 * (`plan/mode`, last one wins) and keeps a private pending map keyed by the
 * session object. This module never keeps a second authority — it maps the
 * official outcome verbs onto a frozen discriminated result, projects the
 * official read as a frozen view, and derives the change feed from the
 * official `session/event` / `session/disposed` facts with a re-read through
 * the official `get` before every delivery.
 *
 * Official outcome mapping (frozen, complete):
 *   committed -> ok:true  code:'committed' commitState:'success' mode/appliedAt
 *   queued    -> ok:true  code:'queued'    pending:true mode (no commitState)
 *   cancelled -> ok:false code:'cancelled' reason
 *   noop      -> ok:false code:'noop'      reason (the idempotent repeat)
 *   unknown   -> ok:false code:'internal'  reason (never guessed)
 */

export const PLAN_MODE_OUTCOME_CODES = Object.freeze(['committed', 'queued', 'cancelled', 'noop'])
export const PLAN_MODE_AUDIT_CAPACITY = 512

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0

const modeOf = (active) => (active === true ? 'plan' : 'default')

/** Official outcome verb -> frozen discriminated public result. */
export function mapPlanModeOutcome(official, { requested, appliedAt } = {}) {
  const mode = modeOf(requested)
  switch (official) {
    case 'committed':
      return Object.freeze({
        ok: true,
        code: 'committed',
        commitState: 'success',
        mode,
        appliedAt,
      })
    case 'queued':
      return Object.freeze({
        ok: true,
        code: 'queued',
        pending: true,
        mode,
      })
    case 'cancelled':
      return Object.freeze({
        ok: false,
        code: 'cancelled',
        reason: 'the official seam cancelled the pending selection: the logged mode already matches the request',
      })
    case 'noop':
      return Object.freeze({
        ok: false,
        code: 'noop',
        reason: 'the target already has the requested mode',
      })
    default:
      return Object.freeze({
        ok: false,
        code: 'internal',
        reason: 'the official plan-mode seam reported an unknown outcome',
      })
  }
}

function bounded(value, max = 240) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value)
  return text ? text.slice(0, max) : undefined
}

/**
 * Bounded non-durable audit ring (authority-internal; no public query member).
 * Overflow drops the oldest record and sets `truncated`; a write failure sets
 * `gapSince` and never fabricates a record (the switch effect is retained).
 */
export function createPlanModeAuditRing({ capacity = PLAN_MODE_AUDIT_CAPACITY, clock = () => new Date() } = {}) {
  const records = []
  let sequence = 0
  let truncated = false
  let gapSince = null

  const stamp = () => {
    try {
      const value = clock()
      return value instanceof Date ? value.toISOString() : String(value)
    } catch {
      return new Date(0).toISOString()
    }
  }

  return Object.freeze({
    record(entry = {}) {
      try {
        // Payload construction is inside the guarded span: a hostile or broken
        // entry degrades to the gap marker instead of escaping the audit path.
        const payload = Object.freeze({
          seq: ++sequence,
          at: stamp(),
          ownerId: bounded(entry.ownerId) ?? 'unattributed',
          action: 'plan-mode.select',
          target: bounded(entry.target) ?? 'unknown',
          requested: entry.requested === 'enter' || entry.requested === 'exit' ? entry.requested : 'unknown',
          outcome: bounded(entry.outcome) ?? 'internal',
          ...(bounded(entry.reason) === undefined ? {} : { reason: bounded(entry.reason) }),
        })
        if (records.length >= capacity) {
          records.shift()
          truncated = true
        }
        records.push(payload)
        return { ok: true, record: payload }
      } catch (error) {
        gapSince = stamp()
        return { ok: false, reason: String(error?.message ?? error) }
      }
    },
    view() {
      return Object.freeze({
        records: Object.freeze(records.map((record) => Object.freeze({ ...record }))),
        truncated,
        gapSince,
      })
    },
    get size() {
      return records.length
    },
  })
}

function availabilityOf(official, observeAvailable) {
  const observeOk = typeof observeAvailable === 'function' ? observeAvailable() : observeAvailable
  if (!official) {
    return Object.freeze({ status: 'unavailable', reason: 'the official plan-mode service is not resolvable' })
  }
  if (typeof official.get !== 'function' || typeof official.set !== 'function') {
    return Object.freeze({ status: 'unavailable', reason: 'the official plan-mode service lacks its get/set contract' })
  }
  if (observeOk === false) {
    return Object.freeze({ status: 'degraded', reason: 'the session fact stream is unavailable; observation is inactive' })
  }
  return Object.freeze({ status: 'active' })
}

function unavailableView(reason) {
  return Object.freeze({
    target: null,
    active: null,
    observedAt: null,
    source: 'unavailable',
    reason,
  })
}

function degradedView(targetId, reason) {
  return Object.freeze({
    target: targetId,
    active: null,
    observedAt: null,
    source: 'degraded',
    reason,
  })
}

/**
 * The composed state the observation face tracks: the official `active` flag
 * plus the official pending selection when the seam reports one. Both the
 * read view and the delivery dedup go through here so a change is exactly one
 * comparison.
 */
function stateView(state) {
  if (!isPlainObject(state) || typeof state.active !== 'boolean') return null
  return Object.freeze({
    active: state.active,
    ...(typeof state.pending === 'boolean' ? { pending: state.pending } : {}),
  })
}

/**
 * The controlled plan-mode authority. `select`/`get`/`observe` never throw
 * across the caller (typed results/views only); the core-inactive gate is the
 * single typed-throw path, and it is enforced by the facade wrapper.
 */
export function createSessionsPlanModeAuthority({
  active,
  resolvePlanMode,
  resolveTargetPresence,
  resolveOwnerId,
  logger,
  clock = () => new Date(),
  observeAvailable = true,
} = {}) {
  const reportDiagnostics = (message) => {
    try {
      logger?.warn?.(`dsh-plugin-api sessions.planMode: ${bounded(message, 240) ?? ''}`)
    } catch {
      // diagnostics never escape the facade path
    }
  }
  const audit = createPlanModeAuditRing({ clock })
  /** Audit writes are best-effort: a gap is reported, the switch effect is kept. */
  const auditRecord = (entry) => {
    const outcome = audit.record(entry)
    if (outcome && outcome.ok === false) {
      reportDiagnostics(`audit record dropped; the switch effect is retained: ${outcome.reason}`)
    }
    return outcome
  }
  /** observe handleId -> handle record */
  const handles = new Map()
  /** hub epoch: a replaced hub invalidates every handle minted by the old one */
  let hubEpoch = 1
  let sequence = 0
  let current = true

  const gates = () => {
    if (typeof active === 'function' && !active()) throw new PluginApiInactiveError()
  }

  const official = () => {
    try {
      const service = resolvePlanMode?.()
      return service && typeof service === 'object' ? service : null
    } catch {
      return null
    }
  }

  const sessionIdOf = (agent) => {
    if (!isPlainObject(agent)) return null
    const session = agent.session
    if (!isPlainObject(session) || !isNonEmptyString(session.id)) return null
    return session.id
  }

  // Target liveness source: the official sessions store presence (the same
  // fact the official close path removes); no facade-local bookkeeping.
  // The seam reports three states and they are never conflated: `true` (held by
  // the official store), `false` (gone) and `null` (the store itself cannot be
  // reached, so liveness is unverifiable and nothing may be concluded).
  const targetPresence = (sessionId) => {
    if (typeof resolveTargetPresence !== 'function') return null
    try {
      const presence = resolveTargetPresence(sessionId)
      if (presence === true) return true
      if (presence === false) return false
      return null
    } catch {
      return null
    }
  }

  const preflight = (agent) => {
    if (!isPlainObject(agent)) {
      return Object.freeze({ ok: false, code: 'invalid-target', reason: 'the target must be an official agent handle' })
    }
    const sessionId = sessionIdOf(agent)
    if (sessionId === null) {
      return Object.freeze({ ok: false, code: 'invalid-target', reason: 'the target carries no resolvable session identity' })
    }
    const presence = targetPresence(sessionId)
    if (presence === false) {
      return Object.freeze({
        ok: false,
        code: 'invalid-target',
        reason: `the target session "${bounded(sessionId) ?? 'unknown'}" does not exist or is closed`,
      })
    }
    if (presence !== true) {
      return Object.freeze({
        ok: false,
        code: 'unavailable',
        reason: 'the official sessions store is unreachable; the target liveness cannot be verified',
      })
    }
    return Object.freeze({ ok: true, sessionId })
  }

  const observedAt = () => {
    try {
      const value = clock()
      return value instanceof Date ? value.toISOString() : String(value)
    } catch {
      return new Date(0).toISOString()
    }
  }

  const readView = (agent) => {
    const pre = preflight(agent)
    if (pre.ok !== true) {
      if (pre.code === 'invalid-target') {
        const sessionId = sessionIdOf(agent)
        return sessionId === null ? unavailableView(pre.reason) : degradedView(sessionId, pre.reason)
      }
      return unavailableView(pre.reason)
    }
    const service = official()
    if (!service || typeof service.get !== 'function') {
      return unavailableView('the official plan-mode service is unavailable')
    }
    try {
      const state = service.get(agent)
      const view = stateView(state)
      if (view === null) {
        return degradedView(pre.sessionId, 'the official plan-mode read returned an unexpected shape')
      }
      return Object.freeze({
        target: pre.sessionId,
        active: view.active,
        ...(view.pending === undefined ? {} : { pending: view.pending }),
        observedAt: observedAt(),
        source: 'official',
      })
    } catch (error) {
      const reason = String(error?.message ?? error)
      reportDiagnostics(`read failed for "${pre.sessionId}": ${reason}`)
      return degradedView(pre.sessionId, 'the official plan-mode read failed')
    }
  }

  // Owner derivation is best-effort and used for audit attribution only; the
  // authority decision (which refusal wins) never depends on a caller claim.
  const deriveOwner = (callerCtx) => {
    try {
      const ownerId = resolveOwnerId?.(callerCtx)
      return isNonEmptyString(ownerId) ? ownerId : undefined
    } catch {
      return undefined
    }
  }

  const select = (agent, requested, callerCtx) => {
    gates()
    const ownerId = deriveOwner(callerCtx)
    const targetId = sessionIdOf(agent)
    const auditTarget = targetId ?? 'unknown'
    const requestedLabel = requested === true ? 'enter' : requested === false ? 'exit' : 'unknown'
    // Declared order: availability, then the target, then the input, then the
    // owner, then the official write. Every refusal is recorded.
    const service = official()
    if (!service || typeof service.set !== 'function') {
      auditRecord({ ownerId, target: auditTarget, requested: requestedLabel, outcome: 'unavailable' })
      return Object.freeze({ ok: false, code: 'unavailable', reason: 'the official plan-mode service is unavailable' })
    }
    const pre = preflight(agent)
    if (pre.ok !== true) {
      auditRecord({ ownerId, target: auditTarget, requested: requestedLabel, outcome: pre.code, reason: pre.reason })
      return Object.freeze({ ok: false, code: pre.code, reason: pre.reason })
    }
    if (typeof requested !== 'boolean') {
      auditRecord({ ownerId, target: pre.sessionId, requested: 'unknown', outcome: 'invalid-input', reason: 'the requested mode must be a boolean' })
      return Object.freeze({ ok: false, code: 'invalid-input', reason: 'the requested mode must be a boolean' })
    }
    if (ownerId === undefined) {
      auditRecord({ ownerId: 'unattributed', target: pre.sessionId, requested: requestedLabel, outcome: 'denied' })
      return Object.freeze({ ok: false, code: 'denied', reason: 'the caller owner cannot be derived' })
    }
    auditRecord({ ownerId, target: pre.sessionId, requested: requestedLabel, outcome: 'attempt' })
    let outcome
    try {
      outcome = service.set(agent, requested)
    } catch (error) {
      const reason = String(error?.message ?? error)
      reportDiagnostics(`switch failed for "${pre.sessionId}": ${reason}`)
      auditRecord({ ownerId, target: pre.sessionId, requested: requestedLabel, outcome: 'internal', reason })
      return Object.freeze({ ok: false, code: 'internal', reason: 'the official plan-mode write failed' })
    }
    const result = mapPlanModeOutcome(outcome, { requested, appliedAt: observedAt() })
    auditRecord({ ownerId, target: pre.sessionId, requested: requestedLabel, outcome: result.code })
    return result
  }

  const deliver = (record, sessionId) => {
    if (record.disposed || record.closed) return
    // Liveness verification rides every delivery: a target the official store
    // no longer holds has closed, even when no `session/disposed` fact reached
    // this feature. An unverifiable presence never fabricates a delivery.
    const presence = targetPresence(sessionId)
    if (presence === false) {
      record.closed = true
      record.degraded = true
      record.listeners.clear()
      return
    }
    if (presence !== true) {
      // The store is unreachable: skip this delivery and degrade typed. The
      // handle is NOT retired — an unreachable store is not a closed target.
      record.degraded = true
      return
    }
    const service = official()
    if (!service || typeof service.get !== 'function') {
      record.degraded = true
      return
    }
    let next
    try {
      // Fact verification: every delivery re-reads the official state.
      next = stateView(service.get(record.agent))
    } catch (error) {
      reportDiagnostics(`observation re-read failed for "${sessionId}": ${String(error?.message ?? error)}`)
      record.degraded = true
      return
    }
    if (next === null) {
      record.degraded = true
      return
    }
    // The re-read is the evidence that the source is healthy again: a target
    // that recovered from a degraded source resumes delivering.
    record.degraded = false
    const previous = record.lastDelivered
    if (previous && previous.active === next.active && previous.pending === next.pending) return
    record.lastDelivered = next
    const payload = Object.freeze({
      target: sessionId,
      view: next,
      observedAt: observedAt(),
    })
    for (const listener of [...record.listeners]) {
      try {
        const returned = listener(payload)
        if (returned != null && typeof returned.then === 'function') {
          Promise.resolve(returned).catch((error) => reportDiagnostics(`observation listener rejected: ${String(error?.message ?? error)}`))
        }
      } catch (error) {
        // containment: one broken listener never affects the others or the source
        reportDiagnostics(`observation listener threw: ${String(error?.message ?? error)}`)
      }
    }
  }

  const observe = (subject) => {
    gates()
    // The canonical subject is `{ agent }` (the same field the namespace's
    // `select` verb uses); a bare agent stays accepted as the convenience form.
    const agent = subject !== null && typeof subject === 'object' && !Array.isArray(subject) && 'agent' in subject
      ? subject.agent
      : subject
    const pre = preflight(agent)
    const sessionId = pre.ok === true ? pre.sessionId : sessionIdOf(agent)
    const handleId = `plan-mode:${++sequence}`
    const record = {
      id: handleId,
      epoch: hubEpoch,
      agent,
      sessionId,
      disposed: false,
      degraded: pre.ok !== true,
      closed: false,
      listeners: new Set(),
      lastDelivered: null,
    }
    // An unresolvable target yields an unbound handle: it never enters the
    // feed, but it is not "stale" either — `current()` answers with the honest
    // read view (the same reason `get`/`select` report), and a subscription is
    // a no-op.
    const bound = sessionId !== null
    const live = () => current && !record.disposed && record.epoch === hubEpoch
      && (!bound || handles.get(handleId) === record)
    const handle = Object.freeze({
      epoch: record.epoch,
      current() {
        if (!live()) return degradedView(sessionId, 'the observation handle is stale')
        if (record.closed) return degradedView(sessionId, 'the target session is closed')
        // `current()` is the read face of the bound target (the same shape as
        // `get`), verified against the official state at call time; the change
        // feed is `subscribe`.
        return readView(agent)
      },
      subscribe(listener) {
        if (typeof listener !== 'function') return () => {}
        if (!live() || !bound || record.closed) {
          // Delivery has already stopped (stale handle or closed target): the
          // state is reported through `current()`, never as a fabricated
          // delivery on the change feed.
          return () => {}
        }
        record.listeners.add(listener)
        let subscribed = true
        return () => {
          if (!subscribed) return
          subscribed = false
          record.listeners.delete(listener)
        }
      },
      dispose() {
        if (record.disposed) return staleResult('the observation handle is already released')
        record.disposed = true
        record.listeners.clear()
        handles.delete(handleId)
        return releasedResult()
      },
    })
    // A handle is bound to a target identity as soon as one is resolvable: an
    // unverifiable presence (the sessions store is unreachable) is a temporary
    // condition, so the handle keeps its place in the feed and resumes when the
    // store returns. Only a target without any identity stays unbound.
    if (sessionId !== null) {
      handles.set(handleId, record)
      if (pre.ok === true) {
        // Prime the handle with the current official state so the first
        // delivery reports a change only when the state actually moved.
        try {
          const view = stateView(service_get(agent))
          if (view !== null) record.lastDelivered = view
        } catch {
          // priming is best-effort; deliveries re-read anyway
        }
      }
    }
    return handle
  }

  function service_get(agent) {
    const service = official()
    if (!service || typeof service.get !== 'function') return null
    return service.get(agent)
  }

  return Object.freeze({
    availability: () => availabilityOf(official(), observeAvailable),
    get: (agent) => {
      gates()
      return readView(agent)
    },
    select,
    observe,
    /** Firehose ingest: one official session event for a bound session. */
    ingestSessionEvent(session, _event) {
      if (!current) return
      const sessionId = isPlainObject(session) && isNonEmptyString(session.id) ? session.id : null
      if (sessionId === null) return
      for (const record of handles.values()) {
        if (record.sessionId !== sessionId) continue
        deliver(record, sessionId)
      }
    },
    /** Official close fact for a bound session. */
    ingestSessionDisposed(session) {
      if (!current) return
      const sessionId = isPlainObject(session) && isNonEmptyString(session.id) ? session.id : null
      if (sessionId === null) return
      for (const record of handles.values()) {
        if (record.sessionId !== sessionId) continue
        // The close fact itself retires the handle: delivery stops immediately
        // (the declared change feed carries state changes, not lifecycle
        // notices) and the read face reports the typed degradation.
        record.closed = true
        record.degraded = true
        record.listeners.clear()
      }
    },
    audit: () => audit.view(),
    dispose() {
      current = false
      hubEpoch += 1
      for (const record of handles.values()) {
        record.disposed = true
        record.listeners.clear()
      }
      handles.clear()
    },
    inspection: () => Object.freeze({ handles: handles.size, epoch: hubEpoch, audit: audit.size }),
  })
}
