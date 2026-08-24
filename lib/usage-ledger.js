/**
 * Durable usage ledger mutation owner for the pluginApi.usage surface.
 *
 * The ledger owns one-scope durable records with owner identity + generation +
 * operation identity + commitState. It provides compare-and-swap style
 * idempotent `record`/`settle`, fail-closed conflict replay, atomic settle
 * with rollback-before-mutation, unified terminal vocabulary, bounded late /
 * stale diagnostics, and identity-bound disposal. It never decides policy
 * (no deny/route/retry/approval), never synthesizes missing usage, and never
 * creates execution identity — executionId/attempt are carried verbatim.
 *
 * This module is host-side state with zero DSH harness dependencies. All
 * mutations are synchronous and validation happens before any state change,
 * so a partially committed total is never visible as a successful settle.
 */

import { randomUUID } from 'node:crypto'
import { deepFreeze } from './deep-freeze.js'
import { aggregateMetrics, idempotencyKeyOf } from './usage-sample-normalizer.js'

/** Unified terminal vocabulary for mutation commitState (identity-and-lifecycle §3). */
export const TERMINAL_COMMIT_STATES = Object.freeze([
  'success',
  'error',
  'aborted',
  'denied',
  'superseded',
])

export const DEFAULT_SCOPE = Object.freeze(['session', 'workspace', 'profile'])

const MAX_DIAGNOSTICS = 100
const MAX_LATE_EVIDENCE = 100

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 512
}

function nowIso() {
  return new Date().toISOString()
}

function bounded(list, limit) {
  return list.length <= limit ? list : list.slice(list.length - limit)
}

function setsEqual(settledList, attempts) {
  if (settledList.length !== attempts.size) return false
  for (const value of attempts) {
    if (!settledList.includes(value)) return false
  }
  return true
}

function requireMutationContext({ ownerId, generation, operationId }) {
  const missing = []
  if (!isNonEmptyString(ownerId)) missing.push('ownerId')
  if (!isNonEmptyString(generation)) missing.push('generation')
  if (!isNonEmptyString(operationId)) missing.push('operationId')
  if (missing.length > 0) {
    throw new TypeError(`usage ledger mutation requires ${missing.join(', ')}`)
  }
}

function recordSnapshot(record, sampleList) {
  return deepFreeze({
    recordId: record.recordId,
    scope: record.scope,
    ownerId: record.ownerId,
    generation: record.generation,
    ...(record.executionId !== undefined ? { executionId: record.executionId } : {}),
    operationId: record.operationId,
    commitState: record.commitState,
    ...(record.outcomeReason !== undefined ? { outcomeReason: record.outcomeReason } : {}),
    ...(record.hasLate === true ? { hasLate: true } : {}),
    samples: deepFreeze(sampleList),
    totals: record.totals,
    source: record.source,
    ...(record.pricing !== undefined ? { pricing: record.pricing } : {}),
    provisional: record.provisional,
    createdAt: record.createdAt,
    ...(record.settledAt !== undefined ? { settledAt: record.settledAt } : {}),
  })
}

export function createUsageLedger({ logger } = {}) {
  // recordId -> record
  const records = new Map()
  // `${scope}::${execKey}::${ownerId}` -> recordId  (execKey = `exec::<id>` | `noexec::<operationId>`)
  const byKey = new Map()
  // `${ownerId}::${operationId}` -> { generation } latest operation generation
  const operations = new Map()
  const diagnostics = []
  let disposed = false

  function recordKeyOf({ scope, ownerId, executionId, operationId }) {
    const execKey = executionId !== undefined ? `exec::${executionId}` : `noexec::${operationId}`
    return `${scope}::${execKey}::${ownerId}`
  }

  function findOrCreateRecord({ scope, ownerId, generation, operationId, executionId }) {
    const key = recordKeyOf({ scope, ownerId, executionId, operationId })
    let recordId = byKey.get(key)
    if (recordId === undefined) {
      recordId = `rec::${randomUUID()}`
      const record = {
        recordId,
        scope,
        ownerId,
        generation,
        operationId,
        ...(executionId !== undefined ? { executionId } : {}),
        samples: new Map(),
        provisional: true,
        createdAt: nowIso(),
      }
      records.set(recordId, record)
      byKey.set(key, recordId)
      return record
    }
    return records.get(recordId)
  }

  function currentOperation(ownerId, operationId) {
    const op = operations.get(`${ownerId}::${operationId}`)
    return op
  }

  function ensureOperation(ownerId, generation, operationId) {
    const key = `${ownerId}::${operationId}`
    const existing = operations.get(key)
    if (existing !== undefined && existing.generation !== generation) {
      // A reconnect/adopt already superseded this operation's generation.
      return { stale: true, generation: existing.generation }
    }
    if (existing === undefined) {
      operations.set(key, { ownerId, generation, operationId })
    }
    return { stale: false }
  }

  function pushDiagnostic(kind, detail, at = nowIso()) {
    diagnostics.push({ kind, detail, at })
    if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.splice(0, diagnostics.length - MAX_DIAGNOSTICS)
  }

  /**
   * record() commits one normalized UsageSample into the owner's ledger.
   *
   * Statuses: `committed` (new sample), `replayed` (idempotent replay, no
   * second charge), `conflict` (fail-closed, conflicting content), `stale`
   * (operation generation superseded, diagnostic only), `late-accepted`
   * (sample arrived after terminal; exposed as late/provisional evidence,
   * never rewrites the outcome and never starts a new attempt).
   */
  function record(sample, { ownerId, generation, operationId, scope } = {}) {
    if (disposed) return { status: 'rejected', detail: 'ledger is disposed' }
    requireMutationContext({ ownerId, generation, operationId })
    if (!DEFAULT_SCOPE.includes(scope)) {
      throw new TypeError(`scope must be one of ${DEFAULT_SCOPE.join(', ')}`)
    }
    if (!sample || typeof sample !== 'object' || !isNonEmptyString(sample.sampleId)) {
      throw new TypeError('a normalized sample with a sampleId is required')
    }

    const opCheck = ensureOperation(ownerId, generation, operationId)
    if (opCheck.stale) {
      pushDiagnostic('stale', `stale generation for operation ${operationId}`)
      return { status: 'stale', detail: 'operation generation is superseded' }
    }

    const recordObj = findOrCreateRecord({ scope, ownerId, generation, operationId, executionId: sample.executionId })
    const key = idempotencyKeyOf({ ownerId, generation, operationId, sampleId: sample.sampleId })
    const existing = recordObj.samples.get(key)

    if (existing !== undefined) {
      if (JSON.stringify(existing.metrics) === JSON.stringify(sample.metrics) && existing.source === sample.source) {
        return { status: 'replayed', recordId: recordObj.recordId }
      }
      pushDiagnostic('conflict', `conflicting replay for sample ${sample.sampleId}`)
      return { status: 'conflict', detail: 'conflicting replay is rejected', recordId: recordObj.recordId }
    }

    if (recordObj.commitState !== undefined) {
      // Terminal already committed: accept only under the declared late rule.
      if (sample.late !== true) {
        // Treat arrival-after-terminal as late evidence; never rewrite.
      }
      recordObj.lateEvidence ??= []
      recordObj.lateEvidence.push(deepFreeze({ ...sample }))
      if (recordObj.lateEvidence.length > MAX_LATE_EVIDENCE) {
        recordObj.lateEvidence.splice(0, recordObj.lateEvidence.length - MAX_LATE_EVIDENCE)
      }
      recordObj.hasLate = true
      return { status: 'late-accepted', recordId: recordObj.recordId }
    }

    if (sample.late === true) recordObj.hasLate = true
    recordObj.samples.set(key, deepFreeze({ ...sample }))
    return { status: 'committed', recordId: recordObj.recordId }
  }

  /**
   * adopt() supersedes an operation's generation (reconnect/new epoch).
   * Older in-flight arrivals then fail the stale check.
   */
  function adopt({ ownerId, generation, operationId } = {}) {
    requireMutationContext({ ownerId, generation, operationId })
    operations.set(`${ownerId}::${operationId}`, { ownerId, generation, operationId })
    pushDiagnostic('supersede', `operation ${operationId} adopted generation ${generation}`)
    return { status: 'adopted' }
  }

  /**
   * settle() atomically marks the settle state and totals for an
   * execution/attempt set. `state` is a classification input the facade
   * conveys (default `success`); timeout maps to `error` with a
   * `{ category: 'timeout' }` reason. A repeated identical settle is a no-op;
   * a conflicting settle is fail-closed and never a second charge.
   */
  function settle(executionId, { attempts, scope, ownerId, generation, operationId, state = 'success', reason } = {}) {
    if (disposed) return { status: 'rejected', detail: 'ledger is disposed' }
    requireMutationContext({ ownerId, generation, operationId })
    if (!DEFAULT_SCOPE.includes(scope)) {
      throw new TypeError(`scope must be one of ${DEFAULT_SCOPE.join(', ')}`)
    }
    if (typeof executionId !== 'string' || executionId.length === 0 || executionId.length > 512) {
      throw new TypeError('a settle requires a valid executionId')
    }
    if (!TERMINAL_COMMIT_STATES.includes(state)) {
      throw new TypeError(`unknown settle state ${JSON.stringify(state)}`)
    }
    const attemptSet = Array.isArray(attempts) ? new Set(attempts.map(String)) : new Set()

    const opCheck = currentOperation(ownerId, operationId)
    if (opCheck !== undefined && opCheck.generation !== generation) {
      pushDiagnostic('stale', `stale generation settle for ${executionId}`)
      return { status: 'stale', detail: 'operation generation is superseded' }
    }

    const key = recordKeyOf({ scope, ownerId, executionId, operationId })
    let recordId = byKey.get(key)
    if (recordId === undefined) {
      // A usage-free execution may still be settled with empty totals.
      const recordObj = findOrCreateRecord({ scope, ownerId, generation, operationId, executionId })
      recordId = recordObj.recordId
    }
    const recordObj = records.get(recordId)

    if (recordObj.commitState !== undefined) {
      const attemptsMatch = setsEqual(recordObj.settledAttempts ?? [], attemptSet)
      const reasonMatch =
        reason === undefined
          ? recordObj.outcomeReason === undefined
          : JSON.stringify(recordObj.outcomeReason) === JSON.stringify(reason)
      const identical = recordObj.commitState === state && attemptsMatch && reasonMatch
      if (identical) {
        return { status: 'already-settled', recordId: recordObj.recordId }
      }
      pushDiagnostic('conflict', `conflicting settle for ${executionId}`)
      return { status: 'conflict', detail: 'conflicting settle is rejected', recordId: recordObj.recordId }
    }

    const subset = [...recordObj.samples.values()].filter((s) => {
      if (s.attempt === undefined) return true
      return attemptSet.has(String(s.attempt))
    })
    const aggregate = aggregateMetrics(subset, { basis: 'precedence' })
    const hasConfirmed = subset.some((s) => s.source === 'provider-confirmed')
    const hasEstimated = subset.some((s) => s.source !== 'provider-confirmed')
    const source = hasConfirmed && hasEstimated ? 'mixed' : hasConfirmed ? 'provider-confirmed' : hasEstimated ? 'estimated' : 'estimated'

    recordObj.commitState = state
    recordObj.settledAttempts = [...attemptSet]
    if (reason !== undefined) recordObj.outcomeReason = deepFreeze(reason)
    recordObj.totals = deepFreeze({
      metrics: aggregate.metrics,
      confirmed: aggregate.confirmed,
      estimated: aggregate.estimated,
      basis: aggregate.basis,
    })
    recordObj.source = source
    recordObj.provisional = false
    recordObj.settledAt = nowIso()
    return { status: 'settled', recordId: recordObj.recordId }
  }

  /**
   * attachPricing() binds pricing metadata to a record (called by the pricing
   * owner after a lookup). Rejects stale generation and only ever attaches to
   * records owned by the caller.
   */
  function attachPricing(recordId, pricing, { ownerId, generation } = {}) {
    if (disposed) return { status: 'rejected' }
    const recordObj = records.get(recordId)
    if (!recordObj) return { status: 'not-found' }
    if (recordObj.ownerId !== ownerId || recordObj.generation !== generation) {
      pushDiagnostic('stale', `stale pricing attach for record ${recordId}`)
      return { status: 'stale', detail: 'record owner/generation is no longer current' }
    }
    if (recordObj.commitState !== undefined && recordObj.pricing !== undefined) {
      // A pricing revision is immutable on a settled record; a revaluation is a
      // distinct operation, never an in-place rewrite.
      return { status: 'immutable', detail: 'pricing is immutable on a settled record' }
    }
    recordObj.pricing = deepFreeze(pricing)
    return { status: 'attached', recordId }
  }

  function get(recordId) {
    const recordObj = records.get(recordId)
    if (!recordObj) return undefined
    return recordSnapshot(recordObj, [...recordObj.samples.values()])
  }

  function getExecutionRecord(executionId, scope, ownerId) {
    for (const rec of records.values()) {
      if (rec.executionId === executionId && rec.scope === scope && rec.ownerId === ownerId) {
        return recordSnapshot(rec, [...rec.samples.values()])
      }
    }
    return undefined
  }

  function byScope(scope) {
    const out = []
    for (const rec of records.values()) {
      if (rec.scope !== scope) continue
      out.push(recordSnapshot(rec, [...rec.samples.values()]))
    }
    return deepFreeze(out)
  }

  function all() {
    const out = []
    for (const rec of records.values()) {
      out.push(recordSnapshot(rec, [...rec.samples.values()]))
    }
    return deepFreeze(out)
  }

  /** Idempotent, identity-bound disposal: only current-owner records are removed. */
  function removeOwner({ ownerId, generation } = {}) {
    if (disposed) return false
    let removed = 0
    for (const rec of records.values()) {
      if (rec.ownerId !== ownerId) continue
      if (generation !== undefined && rec.generation !== generation) continue
      byKey.delete(recordKeyOf({ scope: rec.scope, ownerId: rec.ownerId, executionId: rec.executionId, operationId: rec.operationId }))
      records.delete(rec.recordId)
      removed += 1
    }
    return removed > 0
  }

  function dispose() {
    if (disposed) return false
    disposed = true
    records.clear()
    byKey.clear()
    operations.clear()
    diagnostics.length = 0
    return true
  }

  return {
    record,
    adopt,
    settle,
    attachPricing,
    get,
    getExecutionRecord,
    byScope,
    all,
    removeOwner,
    dispose,
    get size() {
      return records.size
    },
    get disposed() {
      return disposed
    },
    get diagnostics() {
      return deepFreeze([...diagnostics])
    },
  }
}
