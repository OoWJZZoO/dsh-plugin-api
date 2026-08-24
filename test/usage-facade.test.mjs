import test from 'node:test'
import assert from 'node:assert/strict'
import { createUsage } from '../lib/usage.js'

const opts = { ownerId: 'owner-1', generation: 'g-1', operationId: 'op-1', scope: 'session' }

function sample(overrides = {}) {
  const executionId = Object.prototype.hasOwnProperty.call(overrides, 'executionId')
    ? overrides.executionId
    : 'exec-1'
  return {
    sampleId: overrides.sampleId ?? 's-1',
    operationId: 'op-1',
    executionId,
    attempt: overrides.attempt ?? 1,
    provider: 'deepseek',
    model: 'deepseek-chat',
    metrics: { input: overrides.input ?? 5, output: 10 },
    source: 'provider-confirmed',
    observedAt: '2026-08-24T00:00:00.000Z',
    ...(overrides.late !== undefined ? { late: overrides.late } : {}),
  }
}

test('api surface exposes the design members with frozen availability', () => {
  const usage = createUsage()
  assert.equal(typeof usage.api.record, 'function')
  assert.equal(typeof usage.api.settle, 'function')
  assert.equal(typeof usage.api.pricing.register, 'function')
  assert.equal(typeof usage.api.query, 'function')
  assert.equal(typeof usage.api.budget.observe, 'function')
  const avail = usage.api.availability
  assert.ok(Object.isFrozen(avail))
  assert.ok(Object.isFrozen(avail.sources))
  assert.equal(avail.owners.ledger, 'available')
})

test('record + settle commit a one-scope record; query returns a redacted UI item', () => {
  const usage = createUsage()
  usage.api.pricing.register({ provider: 'deepseek', model: 'deepseek-chat', revision: 'v1', currency: 'USD', rates: { input: 1 } })
  assert.equal(usage.api.record(sample(), opts).status, 'committed')
  const settled = usage.api.settle('exec-1', { attempts: [1], ...opts })
  assert.equal(settled.status, 'settled')
  const result = usage.api.query({ sessionId: 'sess-1' })
  assert.equal(result.items.length, 1)
  const item = result.items[0]
  assert.equal(item.scope, 'session')
  assert.equal(item.ownerId, undefined) // redacted: no owner identity leaks to UI
  assert.ok(Object.isFrozen(item))
  assert.ok(Object.isFrozen(result))
})

test('malformed input is rejected without throwing (fail-safe)', () => {
  const usage = createUsage()
  assert.equal(usage.api.record(sample(), { ...opts, scope: 'project' }).status, 'rejected')
  assert.equal(usage.api.record(sample(), { scope: 'session' }).status, 'rejected')
  assert.equal(usage.api.record({}, opts).status, 'rejected')
  assert.equal(usage.api.settle('', opts).status, 'rejected')
})

test('boundary requests (deny/route/retry/approval) are rejected as outside the contract', () => {
  const usage = createUsage()
  const boundary = usage.api.record(sample(), { ...opts, deny: true })
  assert.equal(boundary.status, 'rejected')
  assert.match(boundary.detail, /outside this feature's contract/)
  const routed = usage.api.settle('exec-1', { ...opts, route: 'anthropic' })
  assert.equal(routed.status, 'rejected')
})

test('provider-confirmed chunk intake normalizes and records via the normalizer', () => {
  const usage = createUsage()
  const result = usage.ingestChunk(
    { type: 'usage', usage: { inputTokens: 7, outputTokens: 3 } },
    { ...opts, executionId: 'exec-1', attempt: 1 },
  )
  assert.equal(result.status, 'committed')
  const item = usage.api.query({ sessionId: 'sess-1' }).items[0]
  assert.equal(item.samples[0].metrics.input, 7)
  assert.equal(item.samples[0].source, 'provider-confirmed')
})

test('tokenMeter estimate intake is estimated with estimator provenance, never confirmed', () => {
  const usage = createUsage()
  const result = usage.ingestEstimate(
    { input: 100 },
    { estimator: 'tokenMeter', ...opts, executionId: 'exec-1', attempt: 1 },
  )
  assert.equal(result.status, 'committed')
  const item = usage.api.query({ sessionId: 'sess-1' }).items[0]
  assert.equal(item.samples[0].source, 'estimated')
  assert.equal(item.samples[0].estimator, 'tokenMeter')
  assert.notEqual(item.samples[0].source, 'provider-confirmed')
})

test('an aborted collection stops intake without committing a ledger outcome', () => {
  const usage = createUsage()
  const signal = { aborted: true }
  const result = usage.ingestChunk({ type: 'usage', usage: { inputTokens: 1 } }, { ...opts, signal })
  assert.equal(result.status, 'stopped')
  assert.equal(usage.api.query({ sessionId: 'sess-1' }).items.length, 0)
})

test('pricing + settle: budget.observe emits one crossing on a committed scope projection', () => {
  const usage = createUsage()
  usage.api.pricing.register({ provider: 'deepseek', model: 'deepseek-chat', revision: 'v1', currency: 'CNY', rates: { input: 1 } })
  const seen = []
  usage.api.budget.observe({ scope: 'session', thresholdId: 'budget-A', limit: 100, unit: 'CNY', generation: 'g-1' }, (n) => saw(seen, n))
  assert.equal(usage.api.record(sample({ input: 200 }), opts).status, 'committed')
  usage.api.settle('exec-1', { attempts: [1], ...opts })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].thresholdId, 'budget-A')
  assert.equal(seen[0].observedTotal, 200)
  assert.equal(seen[0].currency, 'CNY')
  // duplicate values do not re-emit
  usage.api.settle('exec-1', opts)
  assert.equal(seen.length, 1)
})

function saw(list, notification) {
  list.push(notification)
}

test('finalizeExecution classifies abort/timeout without inventing a timeout terminal', () => {
  const usage = createUsage()
  usage.api.record(sample(), opts)
  const finalize = usage.finalizeExecution('exec-1', { attempts: [1], ...opts, state: 'error', reason: { category: 'timeout' } })
  assert.equal(finalize.status, 'settled')
  const rec = usage.ledger.getExecutionRecord('exec-1', 'session', 'owner-1')
  assert.equal(rec.commitState, 'error')
  assert.deepEqual(rec.outcomeReason, { category: 'timeout' })
  // late usage after terminal is accepted only as late/provisional, no new attempt
  const late = usage.api.record(sample({ sampleId: 's-late', attempt: 2, late: true }), opts)
  assert.equal(late.status, 'late-accepted')
  assert.equal(usage.ledger.getExecutionRecord('exec-1', 'session', 'owner-1').commitState, 'error')
})

test('correlation is never invented: a sample without executionId records with unknown correlation', () => {
  const usage = createUsage()
  const noExec = { ...sample({ executionId: undefined }), sampleId: 's-noexec' }
  const result = usage.api.record(noExec, opts)
  assert.equal(result.status, 'committed')
  const rec = usage.ledger.all()[0]
  assert.equal(rec.executionId, undefined)
  assert.equal(usage.api.query({ sessionId: 'sess-1' }).items.length, 1)
})

test('failure isolation: a disposed/rejected telemetry op never throws and never interrupts state', () => {
  const usage = createUsage()
  // dispose teardown then attempt is fail-safe
  usage.dispose()
  assert.doesNotThrow(() => {
    const res = usage.api.record(sample(), opts)
    assert.equal(res.status, 'rejected')
  })
})

test('query items are redacted: internal owners and raw content never leak', () => {
  const usage = createUsage()
  usage.api.record(sample(), opts)
  usage.api.settle('exec-1', opts)
  const item = usage.api.query({ sessionId: 'sess-1' }).items[0]
  assert.equal(item.ownerId, undefined)
  assert.equal(item.generation, undefined)
  assert.equal(item.operationId, undefined)
  assert.ok(!('providerAuth' in item))
})

test('setSourceAvailability reflects front-door source state in availability', () => {
  const usage = createUsage()
  usage.setSourceAvailability('llmStream', 'available')
  usage.setSourceAvailability('tokenMeter', 'degraded')
  const avail = usage.api.availability
  assert.equal(avail.sources.llmStream, 'available')
  assert.equal(avail.sources.tokenMeter, 'degraded')
})
