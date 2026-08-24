/**
 * Facade assembly for the pluginApi.usage surface.
 *
 * Wires the pure sample normalizer, durable ledger mutation owner, evidence-only
 * pricing registry, read-only query projection, budget threshold projection and
 * usage visibility owner into the public `pluginApi.usage` surface:
 *
 *   record(sample, { scope, ownerId, generation, operationId })
 *   settle(executionId, { attempts, scope, ownerId, generation, operationId })
 *   pricing.register({ provider, model, revision, currency, units })
 *   query({ executionId?, sessionId?, workspaceId?, profileId?, day?, provider?, model? })
 *   budget.observe({ scope, thresholdId, limit, unit, generation }, listener)
 *
 * The facade enforces the feature boundary (no deny/route/retry/approval/
 * degradation, one scope per write, no client writes), wires provider-confirmed
 * llm/stream intake and tokenMeter-estimated intake through the normalizer,
 * performs fail-safe containment so telemetry failure never throws through
 * apply or interrupts the operation being measured, and feeds committed scope
 * projections back into budget threshold evaluation. It never creates
 * execution identity — executionId/attempt are read from the execution
 * correlation handle (EO face) verbatim and degrade to unknown when absent.
 */

import { createUsageLedger } from './usage-ledger.js'
import { createUsagePricing } from './usage-pricing.js'
import { createUsageQuery } from './usage-query.js'
import { createUsageThreshold } from './usage-threshold.js'
import { createUsageVisibility } from './usage-visibility.js'
import { normalizeProviderChunk, normalizeEstimate } from './usage-sample-normalizer.js'
import { deepFreeze } from './deep-freeze.js'

const SCOPES = Object.freeze(['session', 'workspace', 'profile'])
const SOURCE_KEYS = Object.freeze(['provider-confirmed', 'estimated', 'mixed'])
// Policy / billing actions that are outside this feature's contract.
const BOUNDARY_KEYS = Object.freeze([
  'deny',
  'route',
  'retry',
  'approval',
  'degrade',
  'invoice',
  'payment',
  'reconcile',
  'refund',
])

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 512
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function metricsTotalOf(metrics) {
  let total = 0
  let has = false
  for (const key of ['input', 'output', 'cache', 'reasoning']) {
    if (safeNumber(metrics?.[key])) {
      total += metrics[key]
      has = true
    }
  }
  return has ? total : undefined
}

function assertNoBoundaryRequest(opts) {
  for (const key of BOUNDARY_KEYS) {
    if (opts?.[key] !== undefined) {
      return { rejected: true, detail: `usage surface rejects ${key} requests (outside this feature's contract)` }
    }
  }
  return {}
}

function validateMutationContext(opts) {
  if (!SCOPES.includes(opts?.scope)) {
    return { rejected: true, detail: 'scope must be one of session, workspace, profile' }
  }
  for (const key of ['ownerId', 'generation', 'operationId']) {
    if (!isNonEmptyString(opts?.[key])) {
      return { rejected: true, detail: `usage mutation requires ${key}` }
    }
  }
  return {}
}

export function createUsage({ ctx, logger } = {}) {
  const ledger = createUsageLedger({ logger })
  const pricing = createUsagePricing({ logger })
  const query = createUsageQuery({ ledger })
  const threshold = createUsageThreshold({ logger })
  const visibility = createUsageVisibility()

  const sources = { llmStream: 'missing', tokenMeter: 'missing', correlation: 'missing' }
  const unavailable = (owner) => (owner.disposed ? 'unavailable' : 'available')

  function setSourceAvailability(name, status) {
    try {
      if (name in sources) sources[name] = ['available', 'degraded', 'missing'].includes(status) ? status : 'degraded'
    } catch {
      // best-effort availability bookkeeping
    }
  }

  function reconcileThresholds(scope, { cost, metricsTotal, currency, source, provisional }) {
    try {
      const observedTotal = safeNumber(cost) ? cost : metricsTotal
      if (!safeNumber(observedTotal)) return
      threshold.reconcile({
        scope,
        total: observedTotal,
        currency: currency ?? (safeNumber(cost) ? 'cost-unit' : 'tokens'),
        certainty: source === 'provider-confirmed' ? 'confirmed' : 'estimated',
        provisional: provisional === true,
      })
    } catch {
      // a threshold evaluation failure never interrupts the caller
    }
  }

  function scopeCommittedProjection(scope) {
    const settled = ledger.byScope(scope).filter((r) => !r.provisional)
    let cost = 0
    let hasCost = false
    let metricsTotal = 0
    let hasMetrics = false
    let source = 'estimated'
    for (const rec of settled) {
      const info = pricing.costFor({ metrics: rec.totals?.metrics, source: rec.source }, { provider: rec.samples?.[0]?.provider, model: rec.samples?.[0]?.model })
      if (safeNumber(info.cost)) {
        cost += info.cost
        hasCost = true
      }
      const t = metricsTotalOf(rec.totals?.metrics)
      if (safeNumber(t)) {
        metricsTotal += t
        hasMetrics = true
      }
      if (rec.source === 'provider-confirmed' && source !== 'provider-confirmed') source = 'provider-confirmed'
      else if (rec.source !== 'provider-confirmed') source = 'estimated'
    }
    return { cost: hasCost ? cost : undefined, metricsTotal: hasMetrics ? metricsTotal : undefined, source }
  }

  function scopeCommittedCurrency(scope) {
    for (const rec of ledger.byScope(scope).reverse()) {
      if (!rec.provisional && typeof rec.pricing?.currency === 'string') return rec.pricing.currency
    }
    return undefined
  }

  /** Attach evidence-only pricing metadata to a freshly settled record (immutable afterwards). */
  function attachRecordPricing(recordId, { ownerId, generation }) {
    try {
      if (recordId === undefined) return
      const rec = ledger.get(recordId)
      if (!rec || rec.pricing !== undefined) return
      const info = pricing.costFor(
        { metrics: rec.totals?.metrics, source: rec.source },
        { provider: rec.samples?.[0]?.provider, model: rec.samples?.[0]?.model },
      )
      if (info.pricing) {
        ledger.attachPricing(recordId, info.pricing, { ownerId, generation })
      }
    } catch {
      // pricing is evidence-only; a failed lookup never fails the settle
    }
  }

  function record(sample, opts = {}) {
    try {
      const boundary = assertNoBoundaryRequest(opts)
      if (boundary.rejected) return { status: 'rejected', detail: boundary.detail }
      const context = validateMutationContext(opts)
      if (context.rejected) return { status: 'rejected', detail: context.detail }
      if (!isPlainObject(sample) || !isNonEmptyString(sample.sampleId)) {
        return { status: 'rejected', detail: 'a normalized sample with a sampleId is required' }
      }
      if (!isNonEmptyString(sample.operationId ?? opts.operationId)) {
        return { status: 'rejected', detail: 'operationId is required' }
      }
      if (sample.operationId !== undefined && sample.operationId !== opts.operationId) {
        return { status: 'rejected', detail: 'sample.operationId must match the mutation operationId' }
      }
      if (!SOURCE_KEYS.includes(sample.source)) {
        return { status: 'rejected', detail: `unknown sample source ${JSON.stringify(sample.source)}` }
      }
      return ledger.record(sample, opts)
    } catch {
      return { status: 'error', detail: 'usage record failed' }
    }
  }

  function settle(executionId, opts = {}) {
    try {
      const boundary = assertNoBoundaryRequest(opts)
      if (boundary.rejected) return { status: 'rejected', detail: boundary.detail }
      const context = validateMutationContext(opts)
      if (context.rejected) return { status: 'rejected', detail: context.detail }
      if (!isNonEmptyString(executionId ?? '')) return { status: 'rejected', detail: 'a settle requires an executionId' }
      const result = ledger.settle(executionId, { ...opts })
      if (result.status === 'settled' || result.status === 'already-settled') {
        attachRecordPricing(result.recordId, opts)
        const projection = scopeCommittedProjection(opts.scope)
        reconcileThresholds(opts.scope, { ...projection, provisional: false, currency: scopeCommittedCurrency(opts.scope) })
      }
      return result
    } catch {
      return { status: 'error', detail: 'usage settle failed' }
    }
  }

  /** Internal terminal classification for the intake (abort/timeout); public settle defaults to success. */
  function finalizeExecution(executionId, opts = {}) {
    try {
      const result = ledger.settle(executionId, { ...opts, state: opts.state ?? 'success' })
      if (result.status === 'settled' || result.status === 'already-settled') {
        attachRecordPricing(result.recordId, opts)
        const projection = scopeCommittedProjection(opts.scope)
        reconcileThresholds(opts.scope, { ...projection, provisional: opts.state === 'aborted' || opts.state === 'error', currency: scopeCommittedCurrency(opts.scope) })
      }
      return result
    } catch {
      return { status: 'error', detail: 'usage finalize failed' }
    }
  }

  /** Provider-confirmed chunk intake (llm/stream). AbortSignal stops collection without committing. */
  function ingestChunk(chunk, opts = {}) {
    try {
      if (opts.signal?.aborted) return { status: 'stopped', detail: 'collection aborted without a ledger commit' }
      const sample = normalizeProviderChunk({ chunk, ...opts })
      return record(sample, opts)
    } catch {
      return { status: 'error', detail: 'usage chunk intake failed' }
    }
  }

  /** tokenMeter-estimated intake; never reported as provider-confirmed. */
  function ingestEstimate(metrics, opts = {}) {
    try {
      if (opts.signal?.aborted) return { status: 'stopped', detail: 'collection aborted without a ledger commit' }
      const sample = normalizeEstimate({ metrics, ...opts })
      return record(sample, opts)
    } catch {
      return { status: 'error', detail: 'usage estimate intake failed' }
    }
  }

  function registerPricing(entry) {
    try {
      return pricing.register(entry)
    } catch {
      return { status: 'error', detail: 'usage pricing registration failed' }
    }
  }

  function queryRecords(params = {}) {
    try {
      const result = query.query(params)
      const items = result.unavailable
        ? []
        : result.items.map((rec) => visibility.redact(rec, { audience: 'ui' }))
      return deepFreeze({
        items,
        scopes: result.scopes,
        truncated: result.truncated,
        provisional: result.provisional,
        unavailable: result.unavailable,
      })
    } catch {
      return deepFreeze({ items: [], scopes: [], truncated: false, provisional: false, unavailable: true })
    }
  }

  function observeBudget(params, listener) {
    try {
      if (typeof listener !== 'function') {
        return { status: 'rejected', detail: 'budget listener must be a function' }
      }
      const disposer = threshold.observe(params, listener)
      return { status: 'observed', disposer }
    } catch {
      return { status: 'rejected', detail: 'budget observation rejected' }
    }
  }

  const api = Object.freeze({
    record,
    settle,
    pricing: Object.freeze({ register: registerPricing }),
    query: queryRecords,
    budget: Object.freeze({ observe: observeBudget }),
    get availability() {
      return Object.freeze({
        sources: Object.freeze({ ...sources }),
        owners: Object.freeze({
          ledger: unavailable(ledger),
          pricing: unavailable(pricing),
          query: 'available',
          threshold: unavailable(threshold),
          visibility: unavailable(visibility),
        }),
      })
    },
  })

  function dispose() {
    let removed = false
    for (const owner of [ledger, pricing, threshold, visibility]) {
      try {
        removed = owner.dispose() || removed
      } catch {
        // best-effort teardown
      }
    }
    return removed
  }

  return {
    api,
    ledger,
    pricing,
    query,
    threshold,
    visibility,
    ingestChunk,
    ingestEstimate,
    finalizeExecution,
    setSourceAvailability,
    reconcileThresholds,
    dispose,
  }
}
