import test from 'node:test'
import assert from 'node:assert/strict'
import { createUsagePricing, computeCost, pricingKeyOf } from '../lib/usage-pricing.js'
import { createUsageLedger } from '../lib/usage-ledger.js'
import { normalizeProviderChunk } from '../lib/usage-sample-normalizer.js'

const opts = { ownerId: 'owner-1', generation: 'g-1', operationId: 'op-1', scope: 'session' }

test('pricing.register records pricing identity, currency and units', () => {
  const pricing = createUsagePricing()
  const res = pricing.register({
    provider: 'deepseek',
    model: 'deepseek-chat',
    revision: '2026-08-01',
    currency: 'CNY',
    units: 'token',
    rates: { input: 0.01, output: 0.02 },
  })
  assert.equal(res.status, 'registered')
  assert.equal(pricing.size, 1)
  const entry = pricing.resolve({ provider: 'deepseek', model: 'deepseek-chat' })
  assert.equal(entry.revision, '2026-08-01')
  assert.equal(entry.currency, 'CNY')
  assert.equal(entry.units, 'token')
  assert.deepEqual(entry.rates, { input: 0.01, output: 0.02 })
})

test('pricing.register is idempotent per (provider, model, revision)', () => {
  const pricing = createUsagePricing()
  const first = pricing.register({ revision: 'r1', currency: 'USD', provider: 'p', model: 'm', rates: { input: 1 } })
  const second = pricing.register({ revision: 'r1', currency: 'USD', provider: 'p', model: 'm', rates: { input: 1 } })
  assert.equal(first.status, 'registered')
  assert.equal(second.status, 'registered') // identical is a no-op
  const replaced = pricing.register({ revision: 'r1', currency: 'USD', provider: 'p', model: 'm', rates: { input: 2 } })
  assert.equal(replaced.status, 'replaced')
  assert.equal(pricing.resolve({ provider: 'p', model: 'm' }).rates.input, 2)
})

test('a newer revision is resolved; the older revision remains a distinct entry', () => {
  const pricing = createUsagePricing()
  pricing.register({ revision: 'v1', currency: 'USD', provider: 'p', model: 'm', rates: { input: 1 } })
  pricing.register({ revision: 'v2', currency: 'USD', provider: 'p', model: 'm', rates: { input: 3 } })
  assert.equal(pricing.resolve({ provider: 'p', model: 'm' }).revision, 'v2')
  assert.equal(pricing.resolve({ provider: 'p', model: 'm' }).rates.input, 3)
  assert.notEqual(
    pricingKeyOf({ provider: 'p', model: 'm', revision: 'v1' }),
    pricingKeyOf({ provider: 'p', model: 'm', revision: 'v2' }),
  )
})

test('registration is evidence-only and validates its entry', () => {
  const pricing = createUsagePricing()
  assert.throws(() => pricing.register({ currency: 'USD' }), /revision/)
  assert.throws(() => pricing.register({ revision: 'r1' }), /currency/)
  assert.throws(() => pricing.register({ revision: 'r1', currency: 'USD', rates: { weird: 1 } }), /unknown pricing rate key/)
  assert.throws(() => pricing.register({ revision: 'r1', currency: 'USD', rates: { input: -1 } }), /non-negative/)
})

test('missing price keeps usage intact and marks cost unknown, never zero', () => {
  const pricing = createUsagePricing()
  const { pricing: meta, cost, certainty } = pricing.costFor(
    { metrics: { input: 10 }, source: 'provider-confirmed' },
    { provider: 'p', model: 'm' },
  )
  assert.equal(meta, undefined)
  assert.equal(cost, null)
  assert.equal(certainty, 'unknown')
  assert.notEqual(cost, 0)
})

test('cost is computed from rates and carries pricing metadata with confirmed certainty', () => {
  const pricing = createUsagePricing()
  pricing.register({ revision: 'r1', currency: 'USD', provider: 'p', model: 'm', rates: { input: 2, output: 3 } })
  const { pricing: meta, cost, certainty } = pricing.costFor(
    { metrics: { input: 10, output: 5 }, source: 'provider-confirmed' },
    { provider: 'p', model: 'm' },
  )
  assert.equal(cost, 10 * 2 + 5 * 3) // 35
  assert.equal(meta.revision, 'r1')
  assert.equal(meta.currency, 'USD')
  assert.equal(meta.basis, 'rate·disjoint-units')
  assert.equal(certainty, 'confirmed')
  assert.equal(meta.certainty, 'confirmed')
})

test('estimated source leads to estimated cost certainty, not a confirmed bill', () => {
  const pricing = createUsagePricing()
  pricing.register({ revision: 'r1', currency: 'USD', provider: 'p', model: 'm', rates: { input: 1 } })
  const { certainty, pricing: meta } = pricing.costFor(
    { metrics: { input: 10 }, source: 'estimated' },
    { provider: 'p', model: 'm' },
  )
  assert.equal(certainty, 'estimated')
  assert.equal(meta.certainty, 'estimated')
})

test('computeCost returns cost:null when no metric has a rate', () => {
  const entry = { revision: 'r1', currency: 'USD', rates: { output: 1 } }
  const { cost, certainty } = computeCost({ input: 5 }, entry, 'provider-confirmed')
  assert.equal(cost, null)
  assert.equal(certainty, 'unknown')
})

test('a pricing revision is immutable on a settled ledger record', () => {
  const pricing = createUsagePricing()
  const ledger = createUsageLedger()
  pricing.register({ revision: 'v1', currency: 'USD', provider: 'p', model: 'm', rates: { input: 1 } })
  const sample = normalizeProviderChunk({
    chunk: { usage: { inputTokens: 10 } },
    operationId: 'op-1',
    executionId: 'exec-1',
    provider: 'p',
    model: 'm',
    sampleId: 's-1',
  })
  ledger.record(sample, opts)
  const { recordId } = ledger.settle('exec-1', { attempts: [1], ...opts })
  const { pricing: meta } = pricing.costFor(
    { metrics: { input: 10 }, source: 'provider-confirmed' },
    { provider: 'p', model: 'm' },
  )
  const attach = ledger.attachPricing(recordId, meta, { ownerId: 'owner-1', generation: 'g-1' })
  assert.equal(attach.status, 'attached')
  // A later attach to the same settled record is rejected as immutable.
  const second = ledger.attachPricing(recordId, { ...meta, revision: 'v2' }, { ownerId: 'owner-1', generation: 'g-1' })
  assert.equal(second.status, 'immutable')
  const rec = ledger.get(recordId)
  assert.equal(rec.pricing.revision, 'v1')
})

test('stale pricing attach (owner/generation mismatch) is rejected', () => {
  const pricing = createUsagePricing()
  const ledger = createUsageLedger()
  pricing.register({ revision: 'r1', currency: 'USD', provider: 'p', model: 'm', rates: { input: 1 } })
  const sample = normalizeProviderChunk({
    chunk: { usage: { inputTokens: 1 } },
    operationId: 'op-1',
    executionId: 'exec-1',
    provider: 'p',
    model: 'm',
    sampleId: 's-1',
  })
  ledger.record(sample, opts)
  const { recordId } = ledger.settle('exec-1', { attempts: [1], ...opts })
  const { pricing: meta } = pricing.costFor({ metrics: { input: 1 }, source: 'provider-confirmed' }, { provider: 'p', model: 'm' })
  const stale = ledger.attachPricing(recordId, meta, { ownerId: 'owner-1', generation: 'g-old' })
  assert.equal(stale.status, 'stale')
  assert.ok(ledger.diagnostics.some((d) => d.kind === 'stale'))
})
