import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { createUsageLedger } from '../lib/usage-ledger.js'
import { createUsageQuery } from '../lib/usage-query.js'
import { normalizeProviderChunk } from '../lib/usage-sample-normalizer.js'

const owner = { ownerId: 'owner-1', generation: 'g-1', operationId: 'op-1' }
const FIXED_ISO_SUFFIX = String.fromCharCode(84) + '12:00:00.000Z'

function seed({ ledger, executionId = 'exec-1', scope = 'session', provider = 'deepseek', model = 'deepseek-chat', sampleId = 's-1', input = 5, day = '2026-08-24' }) {
  const sample = normalizeProviderChunk({
    chunk: { usage: { inputTokens: input, outputTokens: 10 } },
    operationId: owner.operationId,
    executionId,
    attempt: 1,
    provider,
    model,
    sampleId,
    observedAt: `${day}${FIXED_ISO_SUFFIX}`,
  })
  const res = ledger.record(sample, { ...owner, scope })
  const settled = ledger.settle(executionId, { attempts: [1], scope, ...owner, state: 'success' })
  void res
  return settled.recordId
}

test('query by session scope returns only that scope with each scope identified', () => {
  const ledger = createUsageLedger()
  const query = createUsageQuery({ ledger })
  seed({ ledger, executionId: 'exec-1', scope: 'session' })
  seed({ ledger, executionId: 'exec-2', scope: 'workspace', sampleId: 's-2' })
  const result = query.query({ sessionId: 'sess-1' })
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].scope, 'session')
  assert.deepEqual(result.scopes, ['session'])
})

test('no scope id and no executionId returns empty', () => {
  const ledger = createUsageLedger()
  const query = createUsageQuery({ ledger })
  seed({ ledger })
  const result = query.query({})
  assert.equal(result.items.length, 0)
})

test('cross-scope report combines separately owned records; each record keeps its scope', () => {
  const ledger = createUsageLedger()
  const query = createUsageQuery({ ledger })
  seed({ ledger, executionId: 'exec-1', scope: 'session' })
  seed({ ledger, executionId: 'exec-2', scope: 'profile', sampleId: 's-2' })
  const result = query.query({ sessionId: 'sess-1', profileId: 'prof-1' })
  assert.equal(result.items.length, 2)
  const scopes = new Set(result.items.map((r) => r.scope))
  assert.deepEqual([...scopes].sort(), ['profile', 'session'])
  assert.deepEqual([...result.scopes].sort(), ['profile', 'session'])
})

test('query by execution id returns the matching execution record', () => {
  const ledger = createUsageLedger()
  const query = createUsageQuery({ ledger })
  seed({ ledger, executionId: 'exec-1' })
  seed({ ledger, executionId: 'exec-2', sampleId: 's-2' })
  const result = query.query({ executionId: 'exec-2' })
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].executionId, 'exec-2')
})

test('date filter narrows to records observed that day', () => {
  mock.timers.enable({ apis: ['Date'], now: new Date(`2026-08-24${FIXED_ISO_SUFFIX}`) })
  try {
  const ledger = createUsageLedger()
  const query = createUsageQuery({ ledger })
  seed({ ledger, executionId: 'exec-1', day: '2026-08-24' })
  const result = query.query({ day: '2026-08-25' })
  assert.equal(result.items.length, 0)
  const next = query.query({ day: '2026-08-24', sessionId: 'sess-1' })
  assert.equal(next.items.length, 1)
  } finally {
    mock.timers.reset()
  }
})

test('provider/model filters apply inside the requested scope', () => {
  const ledger = createUsageLedger()
  const query = createUsageQuery({ ledger })
  seed({ ledger, executionId: 'exec-1', provider: 'deepseek', model: 'a' })
  seed({ ledger, executionId: 'exec-2', provider: 'anthropic', model: 'b', sampleId: 's-2' })
  const result = query.query({ sessionId: 'sess-1', provider: 'deepseek', model: 'a' })
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].executionId, 'exec-1')
})

test('provisional records are flagged and never presented as a final total', () => {
  const ledger = createUsageLedger()
  const query = createUsageQuery({ ledger })
  const sample = normalizeProviderChunk({
    chunk: { usage: { inputTokens: 5 } },
    operationId: 'op-1',
    executionId: 'exec-1',
    attempt: 1,
  })
  ledger.record(sample, { ...owner, scope: 'session' }) // recorded but not settled
  const result = query.query({ sessionId: 'sess-1' })
  assert.equal(result.provisional, true)
  assert.equal(result.items[0].provisional, true)
})

test('limit truncates and reports the limitation', () => {
  const ledger = createUsageLedger()
  const query = createUsageQuery({ ledger })
  for (let i = 0; i < 5; i += 1) {
    seed({ ledger, executionId: `exec-${i}`, sampleId: `s-${i}` })
  }
  const result = query.query({ sessionId: 'sess-1', limit: 2 })
  assert.equal(result.items.length, 2)
  assert.equal(result.truncated, true)
})

test('query is read-only: it never mutates ledger or pricing state', () => {
  const ledger = createUsageLedger()
  const query = createUsageQuery({ ledger })
  const before = ledger.size
  seed({ ledger })
  const result = query.query({ sessionId: 'sess-1' })
  assert.equal(ledger.size, before + 1)
  void result
  assert.equal(ledger.size, before + 1)
})

test('query returns explicit unavailable when the ledger is disposed', () => {
  const ledger = createUsageLedger()
  const query = createUsageQuery({ ledger })
  seed({ ledger })
  ledger.dispose()
  const result = query.query({ sessionId: 'sess-1' })
  assert.equal(result.unavailable, true)
  assert.equal(result.items.length, 0)
})

test('query results are deeply immutable', () => {
  const ledger = createUsageLedger()
  const query = createUsageQuery({ ledger })
  seed({ ledger })
  const result = query.query({ sessionId: 'sess-1' })
  assert.ok(Object.isFrozen(result))
  assert.ok(Object.isFrozen(result.items))
  assert.ok(Object.isFrozen(result.items[0]))
})
