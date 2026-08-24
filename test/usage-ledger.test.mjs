import test from 'node:test'
import assert from 'node:assert/strict'
import { createUsageLedger, TERMINAL_COMMIT_STATES } from '../lib/usage-ledger.js'
import { normalizeProviderChunk, normalizeEstimate } from '../lib/usage-sample-normalizer.js'

const opts = { ownerId: 'owner-1', generation: 'g-1', operationId: 'op-1', scope: 'session' }

function sample(overrides = {}) {
  return normalizeProviderChunk({
    chunk: { usage: { inputTokens: overrides.input ?? 5, outputTokens: overrides.output ?? 10 } },
    operationId: 'op-1',
    executionId: 'exec-1',
    attempt: overrides.attempt ?? 1,
    sampleId: overrides.sampleId ?? 's-1',
    provider: 'deepseek',
    model: 'deepseek-chat',
    observedAt: '2026-08-24T00:00:00.000Z',
    late: overrides.late,
  })
}

test('record requires a full mutation context and a valid scope', () => {
  const ledger = createUsageLedger()
  assert.throws(() => ledger.record(sample(), { generation: 'g', operationId: 'op' }), /ownerId/)
  assert.throws(() => ledger.record(sample(), { ownerId: 'o', operationId: 'op' }), /generation/)
  assert.throws(() => ledger.record(sample(), { ownerId: 'o', generation: 'g' }), /operationId/)
  assert.throws(() => ledger.record(sample(), { ...opts, scope: 'project' }), /scope/)
})

test('records are one-scope: same execution in session vs workspace are separate records', () => {
  const ledger = createUsageLedger()
  const a = ledger.record(sample(), opts)
  const b = ledger.record(sample(), { ...opts, scope: 'workspace' })
  assert.equal(a.status, 'committed')
  assert.equal(b.status, 'committed')
  assert.notEqual(a.recordId, b.recordId)
  assert.equal(ledger.byScope('session').length, 1)
  assert.equal(ledger.byScope('workspace').length, 1)
})

test('equivalent replay is an idempotent no-op without a second charge', () => {
  const ledger = createUsageLedger()
  assert.equal(ledger.record(sample(), opts).status, 'committed')
  const replay = ledger.record(sample(), opts)
  assert.equal(replay.status, 'replayed')
  assert.equal(replay.recordId, ledger.byScope('session')[0].recordId)
})

test('conflicting replay is fail-closed and never picks a value silently', () => {
  const ledger = createUsageLedger()
  ledger.record(sample({ input: 5 }), opts)
  const conflict = ledger.record(sample({ input: 500 }), opts)
  assert.equal(conflict.status, 'conflict')
  // The original value is retained.
  const rec = ledger.byScope('session')[0]
  assert.equal(rec.samples[0].metrics.input, 5)
  assert.ok(ledger.diagnostics.some((d) => d.kind === 'conflict'))
})

test('settle atomically commits totals for the attempt set exactly once', () => {
  const ledger = createUsageLedger()
  ledger.record(sample({ attempt: 1, output: 10 }), opts)
  ledger.record(sample({ attempt: 2, output: 20 }), opts)
  const settled = ledger.settle('exec-1', { attempts: [1], ...opts })
  assert.equal(settled.status, 'settled')
  const rec = ledger.getExecutionRecord('exec-1', 'session', 'owner-1')
  assert.equal(rec.commitState, 'success')
  assert.equal(rec.provisional, false)
  // Only attempt 1's output contributed (10), not attempt 2 (20).
  assert.equal(rec.totals.metrics.output, 10)
  assert.equal(rec.totals.metrics.input, 5)
  assert.ok(rec.settledAt)
  // settledAt is metadata, not the outcome
  assert.equal(rec.commitState, 'success')
})

test('a repeated identical settle is a no-op; a conflicting settle never double-charges', () => {
  const ledger = createUsageLedger()
  ledger.record(sample(), opts)
  assert.equal(ledger.settle('exec-1', { attempts: [1], ...opts }).status, 'settled')
  assert.equal(ledger.settle('exec-1', { attempts: [1], ...opts }).status, 'already-settled')
  const conflict = ledger.settle('exec-1', { attempts: [1, 2], ...opts })
  assert.equal(conflict.status, 'conflict')
  assert.ok(ledger.diagnostics.some((d) => d.kind === 'conflict'))
})

test('a failed settle leaves no partially committed total visible as successful', () => {
  const ledger = createUsageLedger()
  assert.throws(() => ledger.settle('exec-1', { attempts: [1], ...opts, state: 'nonexistent' }), /unknown settle state/)
  assert.equal(ledger.getExecutionRecord('exec-1', 'session', 'owner-1'), undefined)
})

test('terminal vocabulary and timeout-as-error classification', () => {
  assert.deepEqual(TERMINAL_COMMIT_STATES, ['success', 'error', 'aborted', 'denied', 'superseded'])
  const ledger = createUsageLedger()
  ledger.record(sample(), opts)
  ledger.settle('exec-1', { attempts: [1], ...opts, state: 'error', reason: { category: 'timeout' } })
  const rec = ledger.getExecutionRecord('exec-1', 'session', 'owner-1')
  assert.equal(rec.commitState, 'error')
  assert.deepEqual(rec.outcomeReason, { category: 'timeout' })
  assert.ok(!('timeout' in rec) && rec.commitState !== 'timeout')
})

test('a partial/aborted stream keeps observed samples and does not synthesize usage', () => {
  const ledger = createUsageLedger()
  ledger.record(sample({ attempt: 1, output: 10 }), opts)
  ledger.settle('exec-1', { attempts: [1], ...opts, state: 'aborted' })
  const rec = ledger.getExecutionRecord('exec-1', 'session', 'owner-1')
  assert.equal(rec.commitState, 'aborted')
  assert.equal(rec.totals.metrics.output, 10)
  assert.equal(rec.samples.length, 1)
})

test('late usage after a terminal does not rewrite outcome and does not start a new attempt', () => {
  const ledger = createUsageLedger()
  ledger.record(sample({ attempt: 1 }), opts)
  ledger.settle('exec-1', { attempts: [1], ...opts })
  const late = ledger.record(sample({ sampleId: 's-late', attempt: 2 }), opts)
  assert.equal(late.status, 'late-accepted')
  const rec = ledger.getExecutionRecord('exec-1', 'session', 'owner-1')
  assert.equal(rec.commitState, 'success') // unchanged
  assert.equal(rec.samples.length, 1) // late sample not added to settled totals
  assert.equal(rec.hasLate, true)
})

test('reconnect replay is accepted idempotently with replay provenance', () => {
  const ledger = createUsageLedger()
  ledger.record(sample(), opts)
  const replay = ledger.record({ ...sample(), replay: true }, opts)
  assert.equal(replay.status, 'replayed')
})

test('stale generation results are rejected and cannot update totals', () => {
  const ledger = createUsageLedger()
  ledger.record(sample(), opts)
  ledger.adopt({ ownerId: 'owner-1', generation: 'g-2', operationId: 'op-1' })
  const stale = ledger.record(sample({ sampleId: 's-stale' }), opts)
  assert.equal(stale.status, 'stale')
  assert.ok(ledger.diagnostics.some((d) => d.kind === 'stale'))
  const staleSettle = ledger.settle('exec-1', { attempts: [1], ...opts })
  assert.equal(staleSettle.status, 'stale')
  // The stale write is rejected; the already-committed record is untouched.
  const rec = ledger.getExecutionRecord('exec-1', 'session', 'owner-1')
  assert.ok(rec)
  assert.equal(rec.samples.length, 1)
  assert.equal(rec.samples[0].sampleId, 's-1')
})

test('no new retry attempt from a late callback after committed aborted', () => {
  const ledger = createUsageLedger()
  ledger.record(sample(), opts)
  ledger.settle('exec-1', { attempts: [1], ...opts, state: 'aborted' })
  const res = ledger.record(sample({ sampleId: 's2' }), opts)
  assert.equal(res.status, 'late-accepted')
  const rec = ledger.getExecutionRecord('exec-1', 'session', 'owner-1')
  assert.equal(rec.commitState, 'aborted')
})

test('estimated samples aggregate into settle totals with estimated source', () => {
  const ledger = createUsageLedger()
  const est = normalizeEstimate({
    metrics: { input: 100 },
    estimator: 'tokenMeter',
    operationId: 'op-1',
    executionId: 'exec-1',
    attempt: 1,
    sampleId: 'est-1',
  })
  assert.equal(ledger.record(est, opts).status, 'committed')
  ledger.settle('exec-1', { attempts: [1], ...opts })
  const rec = ledger.getExecutionRecord('exec-1', 'session', 'owner-1')
  assert.equal(rec.source, 'estimated')
  assert.equal(rec.totals.metrics.input, 100)
})

test('mixed confirmed+estimated on the same attempt never double-counts', () => {
  const ledger = createUsageLedger()
  ledger.record(sample({ input: 5 }), opts)
  const est = normalizeEstimate({
    metrics: { input: 999, reasoning: 7 },
    estimator: 'tokenMeter',
    operationId: 'op-1',
    executionId: 'exec-1',
    attempt: 1,
    sampleId: 'est-1',
  })
  ledger.record(est, opts)
  ledger.settle('exec-1', { attempts: [1], ...opts })
  const rec = ledger.getExecutionRecord('exec-1', 'session', 'owner-1')
  assert.equal(rec.source, 'mixed')
  assert.equal(rec.totals.metrics.input, 5) // confirmed wins
  assert.equal(rec.totals.metrics.reasoning, 7) // estimated fills the gap
})

test('removeOwner is idempotent and identity-bound; cannot remove another owner', () => {
  const ledger = createUsageLedger()
  ledger.record(sample(), opts)
  assert.equal(ledger.removeOwner({ ownerId: 'owner-other' }), false)
  assert.equal(ledger.removeOwner({ ownerId: 'owner-1', generation: 'g-1' }), true)
  assert.equal(ledger.removeOwner({ ownerId: 'owner-1', generation: 'g-1' }), false)
  assert.equal(ledger.size, 0)
})

test('dispose is idempotent and rejects further mutations', () => {
  const ledger = createUsageLedger()
  ledger.record(sample(), opts)
  assert.equal(ledger.dispose(), true)
  assert.equal(ledger.dispose(), false)
  assert.equal(ledger.record(sample(), opts).status, 'rejected')
})
