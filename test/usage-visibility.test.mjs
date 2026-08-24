import test from 'node:test'
import assert from 'node:assert/strict'
import { createUsageVisibility } from '../lib/usage-visibility.js'

function record(overrides = {}) {
  return {
    recordId: 'rec-1',
    scope: 'session',
    ownerId: 'owner-1',
    generation: 'g-1',
    executionId: 'exec-1',
    operationId: 'op-1',
    commitState: 'success',
    samples: [
      { sampleId: 's-1', operationId: 'op-1', executionId: 'exec-1', metrics: { input: 5 }, source: 'provider-confirmed', observedAt: '2026-08-24T00:00:00.000Z' },
    ],
    totals: { metrics: { input: 5 }, confirmed: { input: 5 }, estimated: {}, basis: 'precedence' },
    source: 'provider-confirmed',
    pricing: { revision: 'v1', currency: 'USD', basis: 'rate·disjoint-units', certainty: 'confirmed' },
    provisional: false,
    createdAt: '2026-08-24T00:00:00.000Z',
    settledAt: '2026-08-24T00:00:01.000Z',
    outcomeReason: { category: 'timeout' },
    hasLate: true,
    ...overrides,
  }
}

test('model/tool audience omits internal usage diagnostics', () => {
  const visibility = createUsageVisibility()
  const view = visibility.redact(record(), { audience: 'model' })
  assert.equal(view.scope, 'session')
  assert.equal(view.source, 'provider-confirmed')
  assert.equal(view.totals.metrics.input, 5)
  assert.equal(view.pricing.revision, 'v1')
  assert.equal(view.executionId, undefined)
  assert.equal(view.samples, undefined)
  assert.equal(view.outcomeReason, undefined)
  assert.equal(view.ownerId, undefined)
})

test('UI audience exposes bounded samples and execution id but no secrets', () => {
  const visibility = createUsageVisibility()
  const view = visibility.redact(record(), { audience: 'ui' })
  assert.equal(view.executionId, 'exec-1')
  assert.equal(view.samples.length, 1)
  assert.equal(view.samples[0].metrics.input, 5)
  assert.ok(Object.isFrozen(view))
  assert.ok(Object.isFrozen(view.samples))
  assert.equal(view.outcomeReason, undefined) // internal diagnostics omitted from UI too
})

test('log audience returns only a bounded usage/cost summary', () => {
  const visibility = createUsageVisibility()
  const view = visibility.redact(record(), { audience: 'log' })
  assert.deepEqual(Object.keys(view).sort(), ['pricing', 'provisional', 'scope', 'source', 'totals'])
  assert.equal(view.pricing.revision, 'v1')
})

test('non-secret exposure retains source, timestamp, certainty, pricing revision and scope', () => {
  const visibility = createUsageVisibility()
  const view = visibility.redact(record(), { audience: 'ui' })
  assert.equal(view.source, 'provider-confirmed')
  assert.equal(view.createdAt, '2026-08-24T00:00:00.000Z')
  assert.equal(view.pricing.certainty, 'confirmed')
  assert.equal(view.pricing.revision, 'v1')
  assert.equal(view.scope, 'session')
})

test('secret-bearing nested provider metadata is redacted, not leaked', () => {
  const visibility = createUsageVisibility()
  const withAuth = record({
    samples: [
      { sampleId: 's-1', operationId: 'op-1', executionId: 'exec-1', metrics: { input: 5 }, source: 'provider-confirmed', observedAt: '2026-08-24T00:00:00.000Z' },
    ],
    providerAuth: { apiKey: 'sk-secret' },
  })
  const view = visibility.redact(withAuth, { audience: 'ui' })
  // providerAuth is not in the ui allowlist at all; the serialized output never carries the value.
  assert.ok(!('providerAuth' in view))
  assert.ok(!JSON.stringify(view).includes('sk-secret'))
})

test('blatant secret field is replaced with a redacted marker, never the value', () => {
  const visibility = createUsageVisibility()
  const withSecret = record({ authorization: 'Bearer super-secret' })
  const view = visibility.redact(withSecret, { audience: 'ui' })
  assert.equal(view.authorization, undefined) // not in allowlist
  const nested = { ...record(), totals: { metrics: { input: 1 }, auth: { token: 'x' } } }
  const nestedView = visibility.redact(nested, { audience: 'ui' })
  assert.equal(nestedView.totals.auth, undefined)
})

test('register applies a pure non-secret policy; a throwing policy degrades to default', () => {
  const visibility = createUsageVisibility()
  const dispose = visibility.register(
    (view) => ({ ...view, exposedField: 'yes' }),
    { ownerId: 'owner-1' },
  )
  const view = visibility.redact(record(), { audience: 'ui' })
  assert.equal(view.exposedField, 'yes')

  const badDispose = visibility.register(() => {
    throw new Error('policy boom')
  }, { ownerId: 'owner-2' })
  const afterBad = visibility.redact(record(), { audience: 'ui' })
  assert.equal(afterBad.unavailable, true) // fail-closed, never leaks

  assert.equal(dispose(), true)
  assert.equal(badDispose(), true)
  const afterDispose = visibility.redact(record(), { audience: 'ui' })
  assert.equal(afterDispose.exposedField, undefined)
})

test('a policy attempting to expose secret material fails closed', () => {
  const visibility = createUsageVisibility()
  visibility.register((view) => ({ ...view, credentials: 'hunter2' }), { ownerId: 'owner-1' })
  const view = visibility.redact(record(), { audience: 'ui' })
  assert.equal(view.unavailable, true)
  assert.ok(!('credentials' in view))
})

test('redact of an undefined record returns an explicit unavailable marker', () => {
  const visibility = createUsageVisibility()
  const view = visibility.redact(undefined, { audience: 'ui' })
  assert.equal(view.unavailable, true)
})
