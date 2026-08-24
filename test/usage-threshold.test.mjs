import test from 'node:test'
import assert from 'node:assert/strict'
import { createUsageThreshold } from '../lib/usage-threshold.js'

test('observe emits a deterministic crossing notification with all required fields', () => {
  const threshold = createUsageThreshold()
  const seen = []
  const dispose = threshold.observe(
    { scope: 'session', thresholdId: 'budget-A', limit: 100, unit: 'CNY', generation: 'g-1' },
    (n) => seen.push(n),
  )
  const emitted = threshold.reconcile({ scope: 'session', total: 120, currency: 'CNY', certainty: 'confirmed', provisional: false })
  assert.equal(emitted, 1)
  assert.equal(seen.length, 1)
  const n = seen[0]
  assert.equal(n.scope, 'session')
  assert.equal(n.thresholdId, 'budget-A')
  assert.equal(n.observedTotal, 120)
  assert.equal(n.currency, 'CNY')
  assert.equal(n.sourceCertainty, 'confirmed')
  assert.equal(n.generation, 'g-1')
  assert.equal(n.provisional, false)
  assert.ok(Object.isFrozen(n))
  assert.equal(typeof dispose, 'function')
})

test('a threshold not crossed emits nothing', () => {
  const threshold = createUsageThreshold()
  const seen = []
  threshold.observe({ scope: 'session', thresholdId: 't', limit: 100, unit: 'CNY', generation: 'g-1' }, (n) => seen.push(n))
  assert.equal(threshold.reconcile({ scope: 'session', total: 50 }), 0)
  assert.equal(seen.length, 0)
})

test('the same threshold remaining crossed does not emit duplicates', () => {
  const threshold = createUsageThreshold()
  const seen = []
  threshold.observe({ scope: 'session', thresholdId: 't', limit: 100, unit: 'CNY', generation: 'g-1' }, (n) => seen.push(n))
  threshold.reconcile({ scope: 'session', total: 120 })
  threshold.reconcile({ scope: 'session', total: 200 })
  threshold.reconcile({ scope: 'session', total: 999 })
  assert.equal(seen.length, 1)
})

test('a new generation may emit a new crossing', () => {
  const threshold = createUsageThreshold()
  const seen = []
  const maybe = (gen) => threshold.observe({ scope: 'session', thresholdId: 't', limit: 100, unit: 'CNY', generation: gen }, (n) => seen.push(n))
  maybe('g-1')
  threshold.reconcile({ scope: 'session', total: 120 })
  maybe('g-2')
  threshold.reconcile({ scope: 'session', total: 130 })
  assert.equal(seen.length, 2)
  assert.deepEqual(seen.map((n) => n.generation), ['g-1', 'g-2'])
})

test('an explicit reset allows a new crossing for the same generation', () => {
  const threshold = createUsageThreshold()
  const seen = []
  threshold.observe({ scope: 'session', thresholdId: 't', limit: 100, unit: 'CNY', generation: 'g-1' }, (n) => seen.push(n))
  threshold.reconcile({ scope: 'session', total: 120 })
  assert.equal(threshold.reset('session'), true)
  threshold.reconcile({ scope: 'session', total: 130 })
  assert.equal(seen.length, 2)
})

test('provisional totals state uncertainty and never claim a confirmed bill', () => {
  const threshold = createUsageThreshold()
  const seen = []
  threshold.observe({ scope: 'session', thresholdId: 't', limit: 100, unit: 'CNY', generation: 'g-1' }, (n) => seen.push(n))
  threshold.reconcile({ scope: 'session', total: 120, certainty: 'estimated', provisional: true })
  const n = seen[0]
  assert.equal(n.provisional, true)
  assert.equal(n.sourceCertainty, 'estimated')
  assert.notEqual(n.sourceCertainty, 'confirmed')
})

test('observational only: the owner has no deny/route/retry surface', () => {
  const threshold = createUsageThreshold()
  assert.equal(typeof threshold.observe, 'function')
  assert.equal(typeof threshold.reconcile, 'function')
  assert.equal(typeof threshold.reset, 'function')
  assert.equal(typeof threshold.deny, 'undefined')
  assert.equal(typeof threshold.route, 'undefined')
  assert.equal(typeof threshold.retry, 'undefined')
})

test('a throwing listener degrades only itself; other watchers still emit', () => {
  const threshold = createUsageThreshold()
  const seen = []
  threshold.observe({ scope: 'session', thresholdId: 'bad', limit: 10, unit: 'CNY', generation: 'g-1' }, () => {
    throw new Error('listener boom')
  })
  threshold.observe({ scope: 'session', thresholdId: 'good', limit: 10, unit: 'CNY', generation: 'g-1' }, (n) => seen.push(n))
  assert.doesNotThrow(() => threshold.reconcile({ scope: 'session', total: 20 }))
  assert.equal(seen.length, 1)
})

test('disposer is idempotent and identity-bound', () => {
  const threshold = createUsageThreshold()
  const seen = []
  const dispose = threshold.observe({ scope: 'session', thresholdId: 't', limit: 10, unit: 'CNY', generation: 'g-1' }, (n) => seen.push(n))
  assert.equal(dispose(), true)
  assert.equal(dispose(), false)
  threshold.reconcile({ scope: 'session', total: 20 })
  assert.equal(seen.length, 0)
})

test('observe validates its inputs', () => {
  const threshold = createUsageThreshold()
  assert.throws(
    () => threshold.observe({ scope: 'project', thresholdId: 't', limit: 1, unit: 'u', generation: 'g' }, () => {}),
    /scope/,
  )
  assert.throws(
    () => threshold.observe({ scope: 'session', thresholdId: '', limit: 1, unit: 'u', generation: 'g' }, () => {}),
    /thresholdId/,
  )
  assert.throws(
    () => threshold.observe({ scope: 'session', thresholdId: 't', limit: -1, unit: 'u', generation: 'g' }, () => {}),
    /finite/,
  )
  assert.throws(
    () => threshold.observe({ scope: 'session', thresholdId: 't', limit: 1, unit: 'u', generation: 'g' }, 'not-a-fn'),
    /listener/,
  )
})
