/**
 * Per-session activity store for the session activity projection.
 *
 * The store is the single state owner of the projection facade (host-side).
 * It is lifetime state with zero harness dependencies: deterministic given its
 * inputs, never performs I/O, never mutates objects outside its own state, and
 * never writes any durable record (the projection is read-only by boundary).
 *
 * Identity rules:
 * - `activityId` is deterministic per evidence key within the facade lifetime
 *   (same evidence source yields the same record); when a key is reused for a
 *   new record (a second lifecycle of the same execution), a deterministically
 *   different id is derived, so identity stays unique within the lifetime.
 *   Continuity across facade lifetimes is never implied.
 * - event seqs / cursors are never used as activity identity.
 *
 * Activity lifecycle:
 * - a record opens on a `start` fact (attempt-facts slice start, or a durable
 *   turn boundary) and stays open until one terminal is committed.
 * - the terminal is final and unique; later signals become bounded audit facts
 *   only.
 * - the shared adjudication priority is applied by committing exactly one
 *   terminal per record (single-point commit), then freezing it.
 *
 * Fidelity:
 * - attempt-facts (slice) evidence marks the record `fidelity.sliceObserved`;
 *   a session whose activity is attempt-tracked never falls back to
 *   boundary-based supersede heuristics (a slice-observed outcome is never
 *   overridden by a heuristic).
 * - turn-boundary supersede detection runs only for records without attempt
 *   evidence (reconstruction path).
 *
 * Wait/queue semantics:
 * - in-progress `waiting.kind` markers carry their own confidence; a strictly
 *   stronger marker survives, equal-or-weaker markers follow latest evidence.
 * - a post-attempt `followUp: queued` on a terminal record sets a
 *   session-level current-queue marker, distinct from the in-progress
 *   waiting.kind=queued, and never rewrites the terminal back to waiting; a
 *   new start (work resumed) clears the marker.
 */
import { createHash } from 'node:crypto'
import { TERMINAL_OUTCOMES, FOLLOW_UP_VALUES } from './session-activity-contract.js'

const MAX_FACTS = 100

/** Evidence strength order: only upgrades are allowed, never downgrades. */
const STRENGTH = Object.freeze({
  observed: 3,
  reconstructed: 2,
  unknown: 1,
  unavailable: 0,
})

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function stronger(current, next) {
  if (!current) return next
  return STRENGTH[next] >= STRENGTH[current] ? next : current
}

function deriveActivityId(key) {
  return createHash('sha256').update(String(key)).digest('hex').slice(0, 16)
}

/** Deterministic per-lifetime identity generator (see module header). */
function makeActivityIdGenerator() {
  const keyGen = new Map() // evidence key -> number of records produced
  return function nextActivityId(key) {
    const gen = keyGen.get(key) ?? 1
    keyGen.set(key, gen + 1)
    return deriveActivityId(gen === 1 ? key : `${key}#${gen}`)
  }
}

function pushFact(record, fact) {
  record.facts.push({
    fact: fact.fact,
    source: fact.source,
    ...(fact.seq !== undefined ? { seq: fact.seq } : {}),
    observedAt: fact.observedAt,
    confidence: fact.confidence,
  })
  if (record.facts.length > MAX_FACTS) {
    record.facts.splice(0, record.facts.length - MAX_FACTS)
  }
}

/**
 * Apply a status update to an open record.
 * `update.waiting` is a waiting marker object `{kind, confidence}` or `null`
 * (explicitly clears the marker) or `undefined` (leaves the marker alone).
 */
function setStatus(record, update) {
  if (record.terminal) return false
  const currentConfidence = record.status?.confidence
  const nextConfidence = stronger(currentConfidence, update.confidence)
  let waiting = record.status?.waiting ?? null
  if (update.waiting !== undefined) {
    if (update.waiting === null) {
      waiting = null
    } else if (update.waiting.kind !== waiting?.kind || stronger(waiting?.confidence, update.waiting.confidence) !== waiting?.confidence) {
      waiting = { kind: update.waiting.kind, confidence: update.waiting.confidence }
    }
  }
  const phase = update.phase ?? record.status?.phase ?? 'preparing'
  if (
    nextConfidence === currentConfidence
    && phase === record.status?.phase
    && JSON.stringify(waiting) === JSON.stringify(record.status?.waiting ?? null)
  ) {
    return false
  }
  record.status = {
    phase,
    confidence: nextConfidence,
    ...(waiting ? { waiting } : {}),
  }
  return true
}

function setWaiting(record, kind, confidence) {
  if (record.terminal) return false
  const existing = record.status?.waiting ?? null
  if (existing && existing.kind === kind && stronger(existing.confidence, confidence) === existing.confidence) {
    // Same kind and the existing marker is at least as strong: keep it.
    return false
  }
  const nextConfidence = stronger(record.status?.confidence, confidence)
  record.status = {
    phase: 'waiting',
    confidence: nextConfidence,
    waiting: { kind, confidence: stronger(existing?.confidence, confidence) },
  }
  return true
}

function clearWaiting(record, phase, confidence) {
  if (record.terminal || !record.status?.waiting) return false
  if (STRENGTH[record.status.waiting.confidence] > STRENGTH[confidence]) {
    // Only a strictly stronger waiting marker survives pending evidence.
    return false
  }
  const nextConfidence = stronger(record.status.confidence, confidence)
  record.status = { phase, confidence: nextConfidence }
  return true
}

/**
 * Create the activity store.
 *
 * @param {{ now?: () => string }} [options]
 */
export function createActivityStore({ now = () => new Date().toISOString() } = {}) {
  const records = new Map() // activityId -> record
  const bySession = new Map() // sessionId -> { opened: [], open: activityId|null, sliceTracked: boolean }
  const keyIndex = new Map() // evidence key -> activityId (deterministic within the lifetime)
  const sessionGaps = new Map() // sessionId -> { fromSeq, toSeq, source, observedAt }
  const sessionQueues = new Map() // sessionId -> { kind, fromActivityId, observedAt, confidence }
  const nextActivityId = makeActivityIdGenerator()
  let order = 0
  let epochSeq = 0

  function sessionState(sessionId) {
    let state = bySession.get(sessionId)
    if (!state) {
      state = { opened: [], open: null, sliceTracked: false }
      bySession.set(sessionId, state)
    }
    return state
  }

  function createRecord(fact, key) {
    const record = {
      activityId: nextActivityId(key),
      sessionId: fact.sessionId,
      key,
      kind: fact.source === 'attempt' ? 'execution' : 'turn',
      correlation: null,
      status: null,
      terminal: null,
      facts: [],
      seq: 0,
      updatedCursor: Number.isInteger(fact.seq) ? fact.seq : undefined,
      observedAt: fact.observedAt,
      epoch: epochSeq,
      fidelity: { sliceObserved: fact.source === 'attempt', note: undefined },
      turnEnded: false,
      lastTurn: undefined,
      openApprovals: 0,
      openTools: 0,
      _order: ++order,
    }
    records.set(record.activityId, record)
    keyIndex.set(key, record.activityId)
    const state = sessionState(fact.sessionId)
    state.opened.push(record.activityId)
    state.open = record.activityId
    return record
  }

  function openRecord(sessionId) {
    const state = bySession.get(sessionId)
    if (!state || !state.open) return null
    const record = records.get(state.open)
    return record && record.terminal === null ? record : null
  }

  /** Resolve the target record for a fact: by evidence key, then by slice
   * correlation identifiers, then by the session's current open record. */
  function resolveTarget(fact) {
    if (isNonEmptyString(fact.key)) {
      const id = keyIndex.get(fact.key)
      if (id) return records.get(id) || null
      return null
    }
    if (fact.source === 'attempt') {
      if (isNonEmptyString(fact.executionId)) {
        const id = keyIndex.get(`execution:${fact.executionId}`)
        if (id) return records.get(id) || null
      }
      if (isNonEmptyString(fact.attemptId)) {
        const id = keyIndex.get(`attempt:${fact.attemptId}`)
        if (id) return records.get(id) || null
      }
    }
    return openRecord(fact.sessionId)
  }

  function commitTerminal(record, fact) {
    if (record.terminal) {
      // A committed terminal is final: later signals become audit facts only.
      pushFact(record, fact)
      return { changed: false, committed: false }
    }
    const confidence = fact.confidence === 'reconstructed' ? 'reconstructed' : 'observed'
    record.terminal = {
      outcome: fact.outcome,
      confidence,
      ...(fact.reason !== undefined ? { reason: fact.reason } : {}),
      ...(fact.classification !== undefined ? { classification: fact.classification } : {}),
      ...(fact.byActivityId !== undefined ? { byActivityId: fact.byActivityId } : {}),
      ...(fact.followUp !== undefined ? { followUp: fact.followUp } : {}),
      ...(fact.ruleName !== undefined ? { ruleName: fact.ruleName } : {}),
    }
    record.status = null
    const state = sessionState(record.sessionId)
    if (state.open === record.activityId) state.open = null
    pushFact(record, fact)
    if (fact.followUp === 'queued') {
      sessionQueues.set(record.sessionId, {
        kind: 'queued',
        fromActivityId: record.activityId,
        observedAt: record.observedAt,
        confidence: confidence === 'observed' ? 'observed' : 'unknown',
      })
    } else if (fact.followUp === 'none' && sessionQueues.get(record.sessionId)?.fromActivityId === record.activityId) {
      // The queue marker is owned by this record: a definitive none clears it.
      sessionQueues.delete(record.sessionId)
    }
    return { changed: true, committed: true }
  }

  function markSliceTracked(sessionId) {
    sessionState(sessionId).sliceTracked = true
  }

  function ingest(fact) {
    if (fact === null || typeof fact !== 'object' || Array.isArray(fact)) return null
    if (!isNonEmptyString(fact.sessionId)) return null
    if (!isNonEmptyString(fact.source) || !isNonEmptyString(fact.kind)) return null
    const observedAt = isNonEmptyString(fact.observedAt) ? fact.observedAt : now()

    switch (fact.kind) {
      case 'start': {
        // --- attempt-facts slice start -------------------------------------
        if (fact.source === 'attempt') {
          const key = isNonEmptyString(fact.executionId)
            ? `execution:${fact.executionId}`
            : isNonEmptyString(fact.attemptId)
              ? `attempt:${fact.attemptId}`
              : null
          let record = key ? (records.get(keyIndex.get(key)) || null) : null
          if (record && record.terminal !== null) record = null
          if (!record) {
            const cur = openRecord(fact.sessionId)
            if (cur && cur.terminal === null) {
              if (cur.kind === 'execution') {
                // Reuse only when this start belongs to the same execution
                // (internal retry/escalation) or carries no distinct identity;
                // a different execution is a different activity.
                const sameExecution = isNonEmptyString(fact.executionId)
                  && cur.correlation?.executionId === fact.executionId
                const identityFree = !isNonEmptyString(fact.executionId) && !isNonEmptyString(fact.attemptId)
                if (sameExecution || identityFree) record = cur
              } else {
                // A turn-boundary activity is upgraded by attempt evidence:
                // the observed slice now owns this activity's terminal decision.
                cur.kind = 'execution'
                cur.fidelity.sliceObserved = true
                cur.correlation = {
                  ...(isNonEmptyString(fact.attemptId) ? { attemptId: fact.attemptId } : {}),
                  ...(isNonEmptyString(fact.executionId) ? { executionId: fact.executionId } : {}),
                  confidence: 'observed',
                }
                if (key) keyIndex.set(key, cur.activityId)
                record = cur
              }
            }
          }
          if (!record) {
            if (!key) return null
            record = createRecord(fact, key)
            record.correlation = {
              ...(isNonEmptyString(fact.attemptId) ? { attemptId: fact.attemptId } : {}),
              ...(isNonEmptyString(fact.executionId) ? { executionId: fact.executionId } : {}),
              confidence: 'observed',
            }
            record.turnEnded = true
          } else {
            // Same execution, new attempt (internal retry): same activity,
            // never a new activity identity.
            if (isNonEmptyString(fact.attemptId)) {
              if (!record.correlation) record.correlation = {}
              record.correlation.attemptId = fact.attemptId
              record.correlation.confidence = stronger(record.correlation.confidence, 'observed')
              if (isNonEmptyString(fact.executionId)) {
                record.correlation.executionId = fact.executionId
                keyIndex.set(`execution:${fact.executionId}`, record.activityId)
              }
            }
            record.fidelity.sliceObserved = true
            markSliceTracked(fact.sessionId)
            setStatus(record, { phase: 'running', confidence: 'observed' })
          }
          markSliceTracked(fact.sessionId)
          setStatus(record, { phase: 'running', confidence: 'observed', waiting: null })
          // a new attempt start means queued work resumed: clear the marker
          sessionQueues.delete(fact.sessionId)
          record.seq += 1
          record.updatedCursor = Number.isInteger(fact.seq) ? fact.seq : record.updatedCursor
          pushFact(record, { fact: 'attempt-start', source: fact.source, seq: fact.seq, observedAt, confidence: 'observed' })
          return { activityId: record.activityId, sessionId: fact.sessionId, changed: true }
        }

        // --- durable turn boundary start -----------------------------------
        if (fact.source === 'durable') {
          const turn = Number.isInteger(fact.turn) ? fact.turn : undefined
          const key = turn !== undefined
            ? `turn:${fact.sessionId}:${turn}`
            : `durable:${fact.sessionId}:${fact.seq}`
          const existing = keyIndex.get(key)
          if (existing) {
            const record = records.get(existing)
            if (record && record.terminal === null) {
              if (turn !== undefined) record.lastTurn = turn
              record.turnEnded = false
              setStatus(record, { phase: 'running', confidence: 'observed', waiting: null })
              sessionQueues.delete(fact.sessionId)
              record.seq += 1
              record.updatedCursor = Number.isInteger(fact.seq) ? fact.seq : record.updatedCursor
              pushFact(record, { fact: 'turn-start', source: fact.source, seq: fact.seq, observedAt, confidence: 'observed' })
              return { activityId: record.activityId, sessionId: fact.sessionId, changed: true }
            }
            // A closed record revisited by the same turn key: audit only.
            return null
          }
          const cur = openRecord(fact.sessionId)
          if (cur && cur.terminal === null) {
            if (cur.kind === 'execution' || cur.turnEnded || (turn !== undefined && cur.lastTurn === turn)) {
              // Contiguous work or an attempt-tracked record: reuse; the new
              // turn continues the same open activity.
              cur.turnEnded = false
              if (turn !== undefined) cur.lastTurn = turn
              keyIndex.set(key, cur.activityId)
              setStatus(cur, { phase: 'running', confidence: 'observed', waiting: null })
              sessionQueues.delete(fact.sessionId)
              cur.seq += 1
              cur.updatedCursor = Number.isInteger(fact.seq) ? fact.seq : cur.updatedCursor
              pushFact(cur, { fact: 'turn-start', source: fact.source, seq: fact.seq, observedAt, confidence: 'observed' })
              return { activityId: cur.activityId, sessionId: fact.sessionId, changed: true }
            }
            // New turn while the previous turn never ended on a non-execution
            // record: supersede-by-boundary (reconstructed), once and frozen.
            const superseded = commitTerminal(cur, {
              fact: 'terminal',
              source: 'durable',
              seq: fact.seq,
              observedAt,
              confidence: 'reconstructed',
              outcome: 'superseded',
              ruleName: 'superseded-by-boundary',
            })
            if (!superseded.committed) return null
          }
          const record = createRecord(fact, key)
          record.turnEnded = false
          if (turn !== undefined) record.lastTurn = turn
          setStatus(record, { phase: 'running', confidence: 'observed', waiting: null })
          // a new turn boundary means queued work resumed: clear the marker
          sessionQueues.delete(fact.sessionId)
          record.seq += 1
          record.updatedCursor = Number.isInteger(fact.seq) ? fact.seq : record.updatedCursor
          pushFact(record, { fact: 'turn-start', source: fact.source, seq: fact.seq, observedAt, confidence: 'observed' })
          return { activityId: record.activityId, sessionId: fact.sessionId, changed: true }
        }
        return null
      }

      case 'turn-end': {
        const target = resolveTarget(fact)
        if (!target || target.terminal) {
          // A boundary signal without an open record is silence evidence:
          // it is not turned into success.
          return null
        }
        // The turn ended; waiting markers are only cleared by their own
        // closing evidence (approval decided / tool result), never by the
        // boundary itself.
        target.turnEnded = true
        target.seq += 1
        target.updatedCursor = Number.isInteger(fact.seq) ? fact.seq : target.updatedCursor
        pushFact(target, { fact: 'turn-end', source: fact.source, seq: fact.seq, observedAt, confidence: 'observed' })
        return { activityId: target.activityId, sessionId: fact.sessionId, changed: true }
      }

      case 'phase': {
        const target = resolveTarget(fact)
        if (!target || target.terminal) return null
        let changed = false
        if (fact.waiting !== undefined) {
          if (fact.waiting === null) {
            changed = clearWaiting(target, fact.phase ?? 'running', fact.confidence ?? 'observed') || changed
          } else {
            changed = setWaiting(target, fact.waiting, fact.confidence ?? 'observed') || changed
          }
        } else if (fact.phase !== undefined) {
          changed = setStatus(target, { phase: fact.phase, confidence: fact.confidence ?? 'observed' }) || changed
        }
        if (fact.approvalOpen !== undefined) target.openApprovals = Math.max(0, (target.openApprovals ?? 0) + (fact.approvalOpen ? 1 : -1))
        if (fact.toolOpen !== undefined) target.openTools = Math.max(0, (target.openTools ?? 0) + (fact.toolOpen ? 1 : -1))
        if (changed || fact.approvalOpen !== undefined || fact.toolOpen !== undefined) {
          target.seq += 1
          pushFact(target, { fact: 'phase', source: fact.source, seq: fact.seq, observedAt, confidence: fact.confidence ?? 'observed' })
        }
        return {
          activityId: target.activityId,
          sessionId: fact.sessionId,
          changed: changed || fact.approvalOpen !== undefined || fact.toolOpen !== undefined,
        }
      }

      case 'correlation': {
        const target = resolveTarget(fact)
        if (!target || target.terminal) return null
        const nextConfidence = stronger(target.correlation?.confidence, fact.confidence ?? 'observed')
        const correlation = target.correlation ?? {}
        let touched = false
        if (isNonEmptyString(fact.executionId) && correlation.executionId !== fact.executionId) {
          correlation.executionId = fact.executionId
          keyIndex.set(`execution:${fact.executionId}`, target.activityId)
          touched = true
        }
        if (isNonEmptyString(fact.attemptId) && correlation.attemptId !== fact.attemptId) {
          correlation.attemptId = fact.attemptId
          touched = true
        }
        if (isNonEmptyString(fact.parentExecutionId) && correlation.parentExecutionId !== fact.parentExecutionId) {
          correlation.parentExecutionId = fact.parentExecutionId
          touched = true
        }
        if (touched) {
          correlation.confidence = nextConfidence
          target.correlation = correlation
          target.seq += 1
          pushFact(target, { fact: 'correlation', source: fact.source, seq: fact.seq, observedAt, confidence: nextConfidence })
        }
        return { activityId: target.activityId, sessionId: fact.sessionId, changed: touched }
      }

      case 'terminal': {
        const target = resolveTarget(fact)
        if (!target) return null
        const result = commitTerminal(target, {
          fact: 'terminal',
          source: fact.source,
          seq: fact.seq,
          observedAt,
          confidence: fact.confidence ?? 'observed',
          outcome: TERMINAL_OUTCOMES.includes(fact.outcome) ? fact.outcome : undefined,
          ...(isNonEmptyString(fact.reason) ? { reason: fact.reason } : {}),
          ...(isNonEmptyString(fact.classification) ? { classification: fact.classification } : {}),
          ...(isNonEmptyString(fact.byActivityId) ? { byActivityId: fact.byActivityId } : {}),
          ...(FOLLOW_UP_VALUES.includes(fact.followUp) ? { followUp: fact.followUp } : {}),
          ...(isNonEmptyString(fact.ruleName) ? { ruleName: fact.ruleName } : {}),
        })
        if (result.committed) target.seq += 1
        return { activityId: target.activityId, sessionId: fact.sessionId, changed: result.changed }
      }

      case 'gap': {
        if (!Number.isInteger(fact.fromSeq) || !Number.isInteger(fact.toSeq)) return null
        sessionGaps.set(fact.sessionId, {
          fromSeq: fact.fromSeq,
          toSeq: fact.toSeq,
          source: fact.source,
          observedAt,
        })
        return { sessionId: fact.sessionId, changed: false }
      }

      default:
        return null
    }
  }

  function recordSnapshot(record) {
    return {
      activityId: record.activityId,
      sessionId: record.sessionId,
      kind: record.kind,
      key: record.key,
      correlation: record.correlation ? { ...record.correlation } : null,
      status: record.status
        ? { ...record.status, ...(record.status.waiting ? { waiting: { ...record.status.waiting } } : {}) }
        : null,
      terminal: record.terminal ? { ...record.terminal } : null,
      facts: record.facts.map((f) => ({ ...f })),
      seq: record.seq,
      updatedCursor: record.updatedCursor,
      observedAt: record.observedAt,
      epoch: record.epoch,
      fidelity: { ...record.fidelity },
      openApprovals: record.openApprovals ?? 0,
      openTools: record.openTools ?? 0,
      turnEnded: record.turnEnded,
      lastTurn: record.lastTurn,
    }
  }

  function get(activityId) {
    const record = records.get(activityId)
    return record ? recordSnapshot(record) : undefined
  }

  function current(sessionId) {
    const record = openRecord(sessionId)
    return record ? recordSnapshot(record) : undefined
  }

  function sessionHistory(sessionId) {
    const state = bySession.get(sessionId)
    if (!state) return []
    return state.opened
      .map((id) => records.get(id))
      .filter(Boolean)
      .map(recordSnapshot)
  }

  function sessionQueue(sessionId) {
    const marker = sessionQueues.get(sessionId)
    return marker ? { ...marker } : null
  }

  function sessionGap(sessionId) {
    const gap = sessionGaps.get(sessionId)
    return gap ? { ...gap } : null
  }

  function isSliceTrackedSession(sessionId) {
    return Boolean(bySession.get(sessionId)?.sliceTracked)
  }

  function rollEpoch() {
    epochSeq += 1
    return epochSeq
  }

  return {
    ingest,
    get,
    current,
    sessionHistory,
    sessionQueue,
    sessionGap,
    isSliceTrackedSession,
    rollEpoch,
    get size() {
      return records.size
    },
  }
}