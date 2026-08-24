import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeProviderChunk,
  normalizeEstimate,
  aggregateMetrics,
  idempotencyKeyOf,
  metricsFromRaw,
} from '../lib/usage-sample-normalizer.js'

test('normalizeProviderChunk preserves every provided raw metric and leaves the rest absent', () => {
  const chunk = {
    type: 'usage',
    usage: { inputTokens: 12, outputTokens: 34, cacheReadTokens: 5, reasoningTokens: 6 },
  }
  const sample = normalizeProviderChunk({
    chunk,
    operationId: 'op-1',
    executionId: 'exec-1',
    attempt: 1,
    provider: 'deepseek',
    model: 'deepseek-chat',
    observedAt: '2026-08-24T00:00:00.000Z',
  })
  assert.equal(sample.source, 'provider-confirmed')
  assert.equal(sample.metrics.input, 12)
  assert.equal(sample.metrics.output, 34)
  assert.equal(sample.metrics.cache, 5) // cacheRead only
  assert.equal(sample.metrics.reasoning, 6)
  assert.equal(sample.metrics.total, undefined) // never invented
  assert.equal(sample.executionId, 'exec-1')
  assert.equal(sample.attempt, 1)
  assert.equal(sample.provider, 'deepseek')
  assert.equal(sample.model, 'deepseek-chat')
  assert.equal(sample.operationId, 'op-1')
  assert.ok(sample.sampleId)
  assert.equal(typeof sample.observedAt, 'string')
})

test('normalizeProviderChunk sums disjoint cache buckets without inventing total', () => {
  const sample = normalizeProviderChunk({
    chunk: { usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 3, cacheWriteTokens: 4 } },
    operationId: 'op-1',
  })
  assert.equal(sample.metrics.cache, 7)
  assert.equal(sample.metrics.total, undefined)
})

test('an empty usage object yields an empty metrics object, not zeros', () => {
  const sample = normalizeProviderChunk({ chunk: { usage: {} }, operationId: 'op-1' })
  assert.deepEqual(sample.metrics, {})
})

test('normalizeEstimate is marked estimated with estimator and never provider-confirmed', () => {
  const sample = normalizeEstimate({
    metrics: { input: 100, output: 200 },
    estimator: 'tokenMeter',
    operationId: 'op-2',
  })
  assert.equal(sample.source, 'estimated')
  assert.equal(sample.estimator, 'tokenMeter')
  assert.notEqual(sample.source, 'provider-confirmed')
  assert.equal(sample.executionId, undefined)
})

test('normalizeEstimate requires an estimator', () => {
  assert.throws(
    () => normalizeEstimate({ metrics: {}, operationId: 'op-1' }),
    /estimator is required/,
  )
})

test('precedence aggregation counts confirmed first and never double-counts', () => {
  const confirmed = {
    sampleId: 's1', operationId: 'op', source: 'provider-confirmed', observedAt: '2026-08-24T00:00:00.000Z',
    metrics: { input: 5, output: 10 },
  }
  const estimatedInput = {
    sampleId: 's2', operationId: 'op', source: 'estimated', estimator: 'tokenMeter', observedAt: '2026-08-24T00:00:00.000Z',
    metrics: { input: 999, reasoning: 7 },
  }
  const agg = aggregateMetrics([confirmed, estimatedInput])
  assert.equal(agg.basis, 'precedence')
  // input comes from confirmed (5), not the estimated 999; reasoning only from estimated.
  assert.equal(agg.metrics.input, 5)
  assert.equal(agg.metrics.output, 10)
  assert.equal(agg.metrics.reasoning, 7)
  assert.equal(agg.confirmed.input, 5)
  assert.equal(agg.estimated.input, 999)
  assert.equal(agg.estimated.reasoning, 7)
})

test('precedence aggregation falls back to estimated for metrics confirmed does not provide', () => {
  const confirmed = {
    sampleId: 'c1', operationId: 'op', source: 'provider-confirmed', observedAt: '2026-08-24T00:00:00.000Z',
    metrics: { output: 3 },
  }
  const estimated = {
    sampleId: 'e1', operationId: 'op', source: 'estimated', estimator: 'tokenMeter', observedAt: '2026-08-24T00:00:00.000Z',
    metrics: { input: 50 },
  }
  const agg = aggregateMetrics([confirmed, estimated])
  assert.equal(agg.metrics.output, 3)
  assert.equal(agg.metrics.input, 50)
})

test('per-source basis keeps confirmed and estimated buckets separate', () => {
  const confirmed = {
    sampleId: 'c1', operationId: 'op', source: 'provider-confirmed', observedAt: '2026-08-24T00:00:00.000Z',
    metrics: { input: 1 },
  }
  const estimated = {
    sampleId: 'e1', operationId: 'op', source: 'estimated', estimator: 'm', observedAt: '2026-08-24T00:00:00.000Z',
    metrics: { input: 2 },
  }
  const agg = aggregateMetrics([confirmed, estimated], { basis: 'per-source' })
  assert.equal(agg.basis, 'per-source')
  assert.equal(agg.metrics, undefined)
  assert.deepEqual(agg.confirmed, { input: 1 })
  assert.deepEqual(agg.estimated, { input: 2 })
})

test('idempotency key is deterministic and independent of sequence/time/position', () => {
  const base = { ownerId: 'owner-1', generation: 'g-1', operationId: 'op-1', sampleId: 's-1' }
  const a = idempotencyKeyOf(base)
  const b = idempotencyKeyOf({ ...base, observedAt: 'different' }) // extra fields ignored
  assert.equal(a, b)
  const c = idempotencyKeyOf({ ...base, sampleId: 's-2' })
  assert.notEqual(a, c)
  assert.equal(a, 'owner-1::g-1::op-1::s-1')
})

test('returned samples are deeply immutable', () => {
  const sample = normalizeProviderChunk({
    chunk: { usage: { inputTokens: 3 } },
    operationId: 'op',
    executionId: 'exec',
  })
  assert.ok(Object.isFrozen(sample))
  assert.ok(Object.isFrozen(sample.metrics))
  assert.throws(() => {
    sample.metrics.input = 99
  }, TypeError)
})

test('missing provider/model stay explicit unknown and are never guessed', () => {
  const sample = normalizeProviderChunk({ chunk: { usage: { inputTokens: 1 } }, operationId: 'op' })
  assert.equal(sample.provider, undefined)
  assert.equal(sample.model, undefined)
})

test('metricsFromRaw maps official TokenUsage disjoint fields', () => {
  const m = metricsFromRaw({
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 3,
    cacheWriteTokens: 4,
    reasoningTokens: 5,
  })
  assert.deepEqual(m, { input: 1, output: 2, cache: 7, reasoning: 5 })
})
