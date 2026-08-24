/**
 * Pure execution-projection reducer for the read-only execution observation
 * surface.
 *
 * The reducer owns execution identity, attempt numbering, lifecycle and the
 * exactly-once terminal commit. It is host-lifetime state with zero harness
 * dependencies: deterministic given its inputs, never performs I/O, never
 * mutates objects outside its own state, and always returns fresh deep-frozen
 * snapshots.
 *
 * Event sequence numbers, timestamps and array positions are never used as
 * identity. Missing parent/cause stays absent (unavailable semantics) instead
 * of being invented from event order.
 */
import { randomUUID } from 'node:crypto'
import { deepFreeze } from './deep-freeze.js'

export const TERMINAL_OUTCOMES = Object.freeze([
  'success',
  'error',
  'aborted',
  'denied',
  'superseded',
])

const MAX_PROVENANCE = 100

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function validTerminalOutcome(outcome) {
  return TERMINAL_OUTCOMES.includes(outcome)
}

function bounded(arr, limit) {
  return arr.length <= limit ? arr : arr.slice(arr.length - limit)
}

function attemptSnapshot(attempt) {
  return Object.freeze({
    attempt: attempt.attempt,
    ...(attempt.attemptId !== undefined ? { attemptId: attempt.attemptId } : {}),
    owner: attempt.owner,
    generation: attempt.generation,
    state: attempt.state,
    ...(attempt.startedAt !== undefined ? { startedAt: attempt.startedAt } : {}),
    ...(attempt.endedAt !== undefined ? { endedAt: attempt.endedAt } : {}),
  })
}

function provenanceSnapshot(entry) {
  return Object.freeze({
    sourceKind: entry.sourceKind,
    ...(entry.seq !== undefined ? { seq: entry.seq } : {}),
    observedAt: entry.observedAt,
    certainty: entry.certainty,
  })
}

function buildSnapshot(record, observerEpoch = 'host') {
  const projection = {
    executionId: record.executionId,
    ...(record.sessionId !== undefined ? { sessionId: record.sessionId } : {}),
    ...(record.agentId !== undefined ? { agentId: record.agentId } : {}),
    ...(record.parentExecutionId !== undefined ? { parentExecutionId: record.parentExecutionId } : {}),
    ...(record.cause !== undefined ? { cause: Object.freeze({ ...record.cause }) } : {}),
    start: Object.freeze({ observedAt: record.start.observedAt, sourceKind: record.start.sourceKind }),
    ...(record.phase !== undefined ? { phase: record.phase } : {}),
    attempt: Object.freeze(record.attempts.map(attemptSnapshot)),
    ...(record.outcome !== undefined ? { outcome: record.outcome } : {}),
    ...(record.outcomeReason !== undefined
      ? { outcomeReason: Object.freeze({ ...record.outcomeReason }) }
      : {}),
    settled: Boolean(record.outcome),
    closed: Boolean(record.closed),
    disposed: Boolean(record.disposed),
    sourceAvailability: Object.freeze({ ...record.sourceAvailability }),
    provenance: Object.freeze(record.provenance.map(provenanceSnapshot)),
    observerEpoch,
  }
  return deepFreeze(projection)
}

/**
 * Create the host reducer.
 *
 * @param {{ now?: () => string }} [options]
 */
export function createExecutionReducer({ now = () => new Date().toISOString() } = {}) {
  const executions = new Map() // executionId -> record
  const bySession = new Map() // sessionId -> Set<executionId>
  const stringKeys = new Map() // provable string key -> executionId
  const objectKeys = new WeakMap() // live object key -> executionId
  let order = 0

  function linkSession(record) {
    if (record.sessionId === undefined) return
    let set = bySession.get(record.sessionId)
    if (!set) bySession.set(record.sessionId, set = new Set())
    set.add(record.executionId)
  }

  function createRecord(fragment) {
    const record = {
      executionId: randomUUID(),
      sessionId: fragment.sessionId !== undefined ? fragment.sessionId : undefined,
      agentId: isNonEmptyString(fragment.agentId) ? fragment.agentId : undefined,
      parentExecutionId: isNonEmptyString(fragment.parentExecutionId)
        ? fragment.parentExecutionId
        : undefined,
      cause: isObject(fragment.cause) ? fragment.cause : undefined,
      start: {
        observedAt: isNonEmptyString(fragment.observedAt) ? fragment.observedAt : now(),
        sourceKind: isNonEmptyString(fragment.sourceKind) ? fragment.sourceKind : 'unknown',
      },
      phase: isNonEmptyString(fragment.phase) ? fragment.phase : undefined,
      attempts: [],
      outcome: undefined,
      outcomeReason: undefined,
      closed: false,
      disposed: false,
      sourceAvailability: {},
      provenance: [],
      _order: ++order,
    }
    record.sourceAvailability[record.start.sourceKind] = 'available'
    executions.set(record.executionId, record)
    linkSession(record)
    return record
  }

  function recordFor(fragment) {
    if (isNonEmptyString(fragment.executionId)) {
      return executions.get(fragment.executionId) || null
    }
    if (fragment.key !== undefined) {
      if (isObject(fragment.key)) {
        const existing = objectKeys.get(fragment.key)
        if (existing) return executions.get(existing) || null
        const record = createRecord(fragment)
        objectKeys.set(fragment.key, record.executionId)
        return record
      }
      if (typeof fragment.key === 'string' && fragment.key !== '') {
        const existing = stringKeys.get(fragment.key)
        if (existing) return executions.get(existing) || null
        const record = createRecord(fragment)
        stringKeys.set(fragment.key, record.executionId)
        return record
      }
    }
    return null
  }

  function appendProvenance(record, fragment) {
    record.provenance.push({
      sourceKind: isNonEmptyString(fragment.sourceKind) ? fragment.sourceKind : 'unknown',
      seq: Number.isInteger(fragment.seq) ? fragment.seq : undefined,
      observedAt: isNonEmptyString(fragment.observedAt) ? fragment.observedAt : now(),
      certainty: isNonEmptyString(fragment.certainty) && ['observed', 'inferred', 'unavailable'].includes(fragment.certainty)
        ? fragment.certainty
        : 'observed',
    })
    record.provenance = bounded(record.provenance, MAX_PROVENANCE)
  }

  function commitTerminal(record, fragment) {
    const outcome = fragment.outcome
    if (!validTerminalOutcome(outcome)) return false
    if (record.outcome !== undefined) {
      // A committed terminal is final: later fragments are provenance only.
      appendProvenance(record, fragment)
      return false
    }
    record.outcome = outcome
    record.outcomeReason = isObject(fragment.outcomeReason) && fragment.outcomeReason !== null
      ? { ...fragment.outcomeReason }
      : undefined
    record.phase = 'ended'
    // Child/default semantics: a child terminal never affects the parent unless
    // the source explicitly marks the child as required for the parent.
    if (fragment.requiredForParent === true && record.parentExecutionId !== undefined) {
      const parent = executions.get(record.parentExecutionId)
      if (parent && parent.outcome === undefined) {
        parent.outcome = outcome
        parent.outcomeReason = record.outcomeReason ? { ...record.outcomeReason } : undefined
        parent.phase = 'ended'
        appendProvenance(parent, {
          ...fragment,
          sourceKind: `${record.start.sourceKind}->parent`,
        })
      }
    }
    appendProvenance(record, fragment)
    return true
  }

  function applyAttempt(record, fragment) {
    if (fragment.kind === 'attempt-start') {
      const attempt = {
        attempt: record.attempts.length + 1,
        ...(isNonEmptyString(fragment.attemptId) ? { attemptId: fragment.attemptId } : {}),
        owner: isNonEmptyString(fragment.owner) ? fragment.owner : record.start.sourceKind,
        generation: isNonEmptyString(fragment.generation) ? fragment.generation : '1',
        state: 'active',
        ...(isNonEmptyString(fragment.startedAt) ? { startedAt: fragment.startedAt } : {}),
      }
      record.attempts.push(attempt)
      return true
    }
    if (fragment.kind === 'attempt-end') {
      const target = isNonEmptyString(fragment.attemptId)
        ? record.attempts.find((entry) => entry.attemptId === fragment.attemptId)
        : record.attempts[record.attempts.length - 1]
      if (!target || target.state === 'settled' || target.state === 'stale') return false
      target.state = fragment.state === 'stale' ? 'stale' : 'settled'
      if (isNonEmptyString(fragment.endedAt)) target.endedAt = fragment.endedAt
      return true
    }
    return false
  }

  function ingest(fragment) {
    if (!isObject(fragment)) return null
    let record = recordFor(fragment)
    if (!record) return null

    switch (fragment.kind) {
      case 'start':
        record.phase = isNonEmptyString(fragment.phase) ? fragment.phase : record.phase ?? 'started'
        if (!isNonEmptyString(record.start.sourceKind) || record.start.sourceKind === 'unknown') {
          record.start.sourceKind = isNonEmptyString(fragment.sourceKind) ? fragment.sourceKind : 'unknown'
        }
        break
      case 'phase':
        if (record.outcome === undefined && isNonEmptyString(fragment.phase)) {
          record.phase = fragment.phase
        }
        break
      case 'attempt-start':
        if (record.outcome !== undefined) return { executionId: record.executionId, committed: false }
        applyAttempt(record, fragment)
        break
      case 'attempt-end':
        applyAttempt(record, fragment)
        break
      case 'terminal':
        return { executionId: record.executionId, committed: commitTerminal(record, fragment) }
      case 'session-link':
        if (isNonEmptyString(fragment.sessionId)) {
          record.sessionId = fragment.sessionId
          linkSession(record)
        }
        break
      default:
        return { executionId: record.executionId, committed: false }
    }
    appendProvenance(record, fragment)
    return { executionId: record.executionId, committed: true }
  }

  function get(executionId) {
    const record = executions.get(executionId)
    return record ? buildSnapshot(record) : undefined
  }

  function sessionHistory(sessionId) {
    const set = bySession.get(sessionId)
    if (!set) return []
    return [...set]
      .map((id) => executions.get(id))
      .filter(Boolean)
      .sort((a, b) => a._order - b._order)
      .map((record) => buildSnapshot(record))
  }

  function allHistory() {
    return [...executions.values()]
      .sort((a, b) => a._order - b._order)
      .map((record) => buildSnapshot(record))
  }

  return {
    ingest,
    get,
    sessionHistory,
    allHistory,
    get size() {
      return executions.size
    },
  }
}
