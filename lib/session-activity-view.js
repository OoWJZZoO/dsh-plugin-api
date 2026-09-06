/**
 * Frozen query surface for the session activity projection.
 *
 * Every public query returns a deep-frozen projection snapshot or a typed
 * absence/unavailable result; queries have no side effects and never leak
 * writable state. Host-side redaction is applied by audience before freezing:
 * the 'ui' audience never receives free-text `reason` material; only closed
 * vocabulary classification survives. Content text never enters snapshots.
 *
 * Store-internal fields (kind, evidence keys, turn bookkeeping) are never
 * projected.
 */
import { deepFreeze } from './deep-freeze.js'

const ABSENT = deepFreeze({ ok: false, code: 'absent' })

const AUDIENCES = Object.freeze(['ui', 'diagnostics'])

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function normalizeAudience(options) {
  const requested = isObject(options) ? options?.audience : undefined
  return AUDIENCES.includes(requested) ? requested : 'ui'
}

/** Build the public projection of one store record (frozen). */
export function buildProjection(record, { audience = 'ui' } = {}) {
  if (!record) return undefined
  const publicAudience = normalizeAudience({ audience })
  const projection = {
    activityId: record.activityId,
    sessionId: record.sessionId,
    execution: record.correlation
      ? {
          ...(isNonEmptyString(record.correlation.executionId) ? { executionId: record.correlation.executionId } : {}),
          ...(isNonEmptyString(record.correlation.attemptId) ? { attemptId: record.correlation.attemptId } : {}),
          ...(isNonEmptyString(record.correlation.parentExecutionId) ? { parentExecutionId: record.correlation.parentExecutionId } : {}),
          ...(record.correlation.confidence ? { correlationConfidence: record.correlation.confidence } : {}),
        }
      : null,
    status: record.status
      ? {
          phase: record.status.phase,
          confidence: record.status.confidence,
          ...(record.status.waiting ? { waiting: { kind: record.status.waiting.kind, confidence: record.status.waiting.confidence } } : {}),
        }
      : null,
    terminal: record.terminal
      ? {
          outcome: record.terminal.outcome,
          confidence: record.terminal.confidence,
          ...(record.terminal.classification ? { classification: record.terminal.classification } : {}),
          // free-text reason material is audience-gated (host-side redaction)
          ...(publicAudience === 'diagnostics' && record.terminal.reason ? { reason: record.terminal.reason } : {}),
          ...(record.terminal.byActivityId ? { byActivityId: record.terminal.byActivityId } : {}),
          ...(record.terminal.followUp ? { followUp: record.terminal.followUp } : {}),
          ...(record.terminal.ruleName ? { ruleName: record.terminal.ruleName } : {}),
        }
      : null,
    facts: record.facts.map((entry) => deepFreeze({
      fact: entry.fact,
      source: entry.source,
      ...(entry.seq !== undefined ? { seq: entry.seq } : {}),
      observedAt: entry.observedAt,
      confidence: entry.confidence,
    })),
    seq: record.seq,
    ...(record.updatedCursor !== undefined ? { updatedCursor: record.updatedCursor } : {}),
    observedAt: record.observedAt,
    epoch: record.epoch,
    fidelity: { sliceObserved: record.fidelity.sliceObserved, ...(record.fidelity.note ? { note: record.fidelity.note } : {}) },
  }
  return deepFreeze(projection)
}

/**
 * Create the view over one activity store.
 *
 * @param {{ store: object, unavailableSources?: () => string[] }} options
 * `unavailableSources` returns the per-view single-value source markers for
 * evidence that is not reachable in this installation (per-source
 * unavailable/degraded listing); every query result carries it, mirroring
 * the projection's availability view at the payload level.
 */
export function createSessionActivityView({ store, unavailableSources } = {}) {
  function sourceMarkers() {
    try {
      return typeof unavailableSources === 'function' ? unavailableSources() : []
    } catch {
      return []
    }
  }

  function current(sessionId, options = {}) {
    if (!isNonEmptyString(sessionId)) return ABSENT
    const record = store.current(sessionId)
    if (!record) return ABSENT
    return deepFreeze({
      snapshot: buildProjection(record, options),
      sessionQueue: store.sessionQueue(sessionId),
      gap: store.sessionGap(sessionId),
      unavailable: sourceMarkers(),
    })
  }

  function get(activityId, options = {}) {
    if (!isNonEmptyString(activityId)) return ABSENT
    const record = store.get(activityId)
    if (!record) return ABSENT
    return deepFreeze({
      snapshot: buildProjection(record, options),
      sessionQueue: store.sessionQueue(record.sessionId),
      gap: store.sessionGap(record.sessionId),
      unavailable: sourceMarkers(),
    })
  }

  function list(options = {}) {
    const opts = isObject(options) ? options : {}
    if (!isNonEmptyString(opts.sessionId)) return deepFreeze({ items: [], nextCursor: undefined, truncated: false, gap: null, unavailable: [] })
    const records = store.sessionHistory(opts.sessionId)
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? Math.min(opts.limit, 500) : 50
    const cursor = isNonEmptyString(opts.cursor) ? opts.cursor : undefined
    let page = records
    if (cursor) {
      const index = records.findIndex((entry) => entry.activityId === cursor)
      page = index === -1 ? [] : records.slice(index + 1)
    }
    const items = page.slice(0, limit).map((record) => buildProjection(record, opts))
    const more = page.length > limit
    return deepFreeze({
      items,
      nextCursor: more ? page[limit - 1]?.activityId : undefined,
      truncated: more,
      gap: store.sessionGap(opts.sessionId),
      unavailable: sourceMarkers(),
    })
  }

  function history(sessionId, options = {}) {
    if (!isNonEmptyString(sessionId)) return deepFreeze({ items: [], truncated: false, unavailable: [], gap: null, boundary: 'facade-lifetime' })
    const records = store.sessionHistory(sessionId)
    return deepFreeze({
      items: records.map((record) => buildProjection(record, options)),
      truncated: false,
      unavailable: sourceMarkers(),
      gap: store.sessionGap(sessionId),
      boundary: 'facade-lifetime',
    })
  }

  return {
    current,
    get,
    list,
    history,
    build: buildProjection,
  }
}