/**
 * Pure usage-sample normalizer for the pluginApi.usage ledger.
 *
 * Normalizes raw provider usage chunks and local estimates into canonical
 * UsageSample objects without changing the provider's raw value semantics
 * (missing fields stay absent; they are never zero-ed or invented). The module
 * is a pure function of its inputs: zero DSH harness dependencies, never
 * performs I/O, never mutates objects outside its own state, and always
 * returns fresh deep-frozen snapshots.
 *
 * Identity discipline: this module only carries a caller-provided
 * executionId/attempt and never generates, infers or rewrites execution
 * identity; a missing executionId stays absent (correlation unknown). The
 * idempotency key is derived deterministically from the owner operation tuple
 * + sampleId and never from event sequence, timestamp or array position.
 */

import { randomUUID } from 'node:crypto'
import { deepFreeze } from './deep-freeze.js'

/** Canonical metric keys kept in preference order for aggregation. */
export const METRIC_KEYS = Object.freeze(['input', 'output', 'cache', 'reasoning', 'total'])

/** Unified source-certainty vocabulary for usage samples. */
export const SAMPLE_SOURCES = Object.freeze(['provider-confirmed', 'estimated', 'mixed'])

/** Aggregation basis used when confirmed and estimated values coexist. */
export const AGGREGATION_BASIS = Object.freeze(['precedence', 'per-source'])

function isFiniteNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function readMetric(raw, aliases) {
  if (raw === null || typeof raw !== 'object') return undefined
  for (const key of aliases) {
    if (isFiniteNonNegativeNumber(raw[key])) return raw[key]
  }
  return undefined
}

/**
 * Extract the canonical metrics from an official provider usage object.
 * Maps both the official `TokenUsage` field names (`inputTokens`,
 * `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`)
 * and loose canonical aliases. `cache` is only present when cache accounting
 * exists; `total` is only present when the raw payload explicitly provides it
 * (a derived total is never invented here).
 */
export function metricsFromRaw(raw) {
  const out = {}
  const input = readMetric(raw, ['input', 'inputTokens', 'promptTokens'])
  const output = readMetric(raw, ['output', 'outputTokens', 'completionTokens'])
  const reasoning = readMetric(raw, ['reasoning', 'reasoningTokens'])
  const cacheRead = readMetric(raw, ['cacheReadTokens'])
  const cacheWrite = readMetric(raw, ['cacheWriteTokens'])
  const cache = (() => {
    const canonical = readMetric(raw, ['cache'])
    if (canonical !== undefined) return canonical
    if (cacheRead !== undefined && cacheWrite !== undefined) return cacheRead + cacheWrite
    return cacheRead !== undefined ? cacheRead : cacheWrite
  })()
  const total = readMetric(raw, ['total', 'totalTokens'])
  if (input !== undefined) out.input = input
  if (output !== undefined) out.output = output
  if (cache !== undefined) out.cache = cache
  if (reasoning !== undefined) out.reasoning = reasoning
  if (total !== undefined) out.total = total
  return Object.freeze(out)
}

/**
 * Deterministic idempotency key for one sample. Keyed by the owner operation
 * tuple + sampleId. Sequence/time/array-position is never part of identity.
 */
export function idempotencyKeyOf({ ownerId, generation, operationId, sampleId }) {
  return [ownerId, generation, operationId, sampleId].join('::')
}

function sampleSnapshot(input) {
  const metrics = metricsFromRaw(input.metrics ?? {})
  const sample = {
    sampleId: input.sampleId,
    operationId: input.operationId,
    metrics,
    source: input.source,
    observedAt: input.observedAt,
  }
  if (input.executionId !== undefined) sample.executionId = input.executionId
  if (input.attempt !== undefined) sample.attempt = input.attempt
  if (input.provider !== undefined) sample.provider = input.provider
  if (input.model !== undefined) sample.model = input.model
  if (input.estimator !== undefined) sample.estimator = input.estimator
  if (input.late === true) sample.late = true
  if (input.replay === true) sample.replay = true
  return Object.freeze(sample)
}

function tooLargeId(value, name) {
  if (typeof value !== 'string') return { error: `${name} is required` }
  if (value.length > 512) return { error: `${name} exceeds the maximum length` }
  return {}
}

/**
 * Normalize an official provider-confirmed usage chunk into a UsageSample.
 *
 * @param {object} [options]
 * @param {object} [options.chunk] - the official `llm/stream` `usage` chunk
 *   (`{ type: 'usage', usage: TokenUsage, ... }`) or any object carrying
 *   `usage`/metrics fields.
 * @param {string} options.operationId - the caller/source-supplied operation identity.
 * @param {string} [options.sampleId] - optional deterministic sample identity
 *   supplied by the source; a random id is generated when absent (not
 *   replay-dedupeable at the ledger level).
 * @param {string} [options.executionId] - carried verbatim from EO, never invented.
 * @param {number|string} [options.attempt]
 * @param {string} [options.provider]
 * @param {string} [options.model]
 * @param {string} [options.observedAt]
 * @param {boolean} [options.late]
 * @param {boolean} [options.replay]
 * @returns {Readonly<UsageSample>}
 */
export function normalizeProviderChunk({
  chunk,
  operationId,
  sampleId,
  executionId,
  attempt,
  provider,
  model,
  observedAt,
  late,
  replay,
}) {
  const op = tooLargeId(operationId, 'operationId')
  if (op.error) throw new TypeError(op.error)
  const raw = chunk?.usage ?? chunk?.metrics ?? chunk
  return sampleSnapshot({
    sampleId: sampleId ?? randomUUID(),
    operationId,
    executionId,
    attempt,
    provider,
    model,
    metrics: metricsFromRaw(raw),
    source: 'provider-confirmed',
    observedAt: observedAt ?? new Date().toISOString(),
    late,
    replay,
  })
}

/**
 * Normalize a local estimate into a UsageSample. The value is marked
 * `estimated` with `estimator` provenance and is never reported as
 * provider-confirmed.
 */
export function normalizeEstimate({
  metrics,
  estimator,
  operationId,
  sampleId,
  executionId,
  attempt,
  provider,
  model,
  observedAt,
  late,
  replay,
}) {
  const op = tooLargeId(operationId, 'operationId')
  if (op.error) throw new TypeError(op.error)
  if (typeof estimator !== 'string' || estimator.length === 0) {
    throw new TypeError('estimator is required for an estimated sample')
  }
  return sampleSnapshot({
    sampleId: sampleId ?? randomUUID(),
    operationId,
    executionId,
    attempt,
    provider,
    model,
    metrics: metricsFromRaw(metrics ?? {}),
    // An estimate is never reported as provider-confirmed. The 'mixed' label
    // is only produced by an aggregate owner, never by this intake path.
    source: 'estimated',
    estimator,
    observedAt: observedAt ?? new Date().toISOString(),
    late,
    replay,
  })
}

/**
 * Aggregate a set of samples for one execution/attempt set into canonical
 * totals using an explicit precedence or per-source rule (design §Component
 * 1). Under `precedence` a metric that any provider-confirmed sample provides
 * is counted from confirmed values only; estimated values supply metrics the
 * confirmed samples do not provide — they are never summed into a silent
 * double-count. Each sample keeps its own source/certainty in the stored
 * samples array.
 *
 * @param {ReadonlyArray<UsageSample>} samples
 * @param {{ basis?: ('precedence'|'per-source') }} [options]
 */
export function aggregateMetrics(samples, { basis = 'precedence' } = {}) {
  if (!AGGREGATION_BASIS.includes(basis)) {
    throw new TypeError(`unknown aggregation basis ${JSON.stringify(basis)}`)
  }
  const confirmed = samples.filter((s) => s.source === 'provider-confirmed')
  const estimated = samples.filter((s) => s.source !== 'provider-confirmed')

  const of = (list) => {
    const out = {}
    for (const key of METRIC_KEYS) {
      let sum = 0
      let has = false
      for (const s of list) {
        const v = s.metrics?.[key]
        if (isFiniteNonNegativeNumber(v)) {
          sum += v
          has = true
        }
      }
      if (has) out[key] = sum
    }
    return Object.freeze(out)
  }

  if (basis === 'per-source') {
    return deepFreeze({ confirmed: of(confirmed), estimated: of(estimated), basis: 'per-source' })
  }

  // precedence: confirmed first, estimated only where confirmed is silent.
  const confirmedMetrics = of(confirmed)
  const fallbackMetrics = of(estimated)
  const merged = {}
  for (const key of METRIC_KEYS) {
    if (confirmedMetrics[key] !== undefined) merged[key] = confirmedMetrics[key]
    else if (fallbackMetrics[key] !== undefined) merged[key] = fallbackMetrics[key]
  }
  return deepFreeze({
    metrics: Object.freeze(merged),
    confirmed: confirmedMetrics,
    estimated: fallbackMetrics,
    basis: 'precedence',
  })
}
