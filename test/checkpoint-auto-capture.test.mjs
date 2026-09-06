import test from 'node:test'
import assert from 'node:assert/strict'
import { createAutoCapturePolicy } from '../lib/checkpoint-auto-capture.js'
import { createCaptureAuthority } from '../lib/checkpoint-capture.js'
import { createLoopFacts } from '../lib/checkpoint-facts.js'
import { createAttemptFactsFixture, createBranchAuthorityFixture, createTestStore, createIdFactory, stubOwnerOf } from './checkpoint-test-kit.mjs'

function realCapture({ store, branch }) {
  return createCaptureAuthority({
    store,
    authorities: { branch: branch.face },
    ownerOf: stubOwnerOf,
    idFactory: createIdFactory('cp'),
  })
}

function harness(options = {}) {
  const attempts = options.attempts ?? createAttemptFactsFixture()
  const facts = createLoopFacts({ facts: attempts.facet })
  const store = options.store ?? createTestStore()
  const branch = options.branch ?? createBranchAuthorityFixture()
  return { attempts, facts, store, branch }
}

test('auto-capture: default off; status observable and bounded', async () => {
  const { facts, store, branch } = harness()
  const capture = realCapture({ store, branch })
  const policy = createAutoCapturePolicy({ facts, capture, ownerOf: stubOwnerOf })
  const status = policy.status()
  assert.equal(status.enabled, false)
  assert.equal(status.sliceActive, true)
  assert.deepEqual(status.attempts, {})
})

test('auto-capture: enable requires an owner and an explicit cadence', async () => {
  const { facts, store, branch } = harness()
  const capture = realCapture({ store, branch })
  const policy = createAutoCapturePolicy({ facts, capture, ownerOf: stubOwnerOf })
  const noOwner = policy.enable({ cadence: { kind: 'every-attempt' } })
  assert.equal(noOwner.ok, false)
  assert.equal(noOwner.code, 'invalid-input')
  const badCadence = policy.enable({ owner: 'plugin-a', cadence: { kind: 'sometimes' } })
  assert.equal(badCadence.ok, false)
  const enabled = policy.enable({ owner: 'plugin-a', cadence: { kind: 'every-attempt' }, reason: 'rescue cadence' })
  assert.equal(enabled.ok, true)
  assert.equal(enabled.code, 'enabled')
  assert.equal(policy.status().enabled, true)
})

test('auto-capture: attempt-end triggers a branch-anchored checkpoint with autoTrigger provenance', async () => {
  const { attempts, facts, store, branch } = harness()
  const capture = realCapture({ store, branch })
  const policy = createAutoCapturePolicy({ facts, capture, ownerOf: stubOwnerOf })
  await policy.enable({ owner: 'plugin-a', cadence: { kind: 'every-attempt' } })
  await attempts.emitEnd({ sessionId: 'session-1', attemptId: 'attempt-1' })
  const status = policy.status()
  assert.equal(status.attempts['session-1'].attempts, 1)
  assert.equal(status.attempts['session-1'].created, 1)
  assert.ok(status.attempts['session-1'].last)
  const record = await store.get(status.attempts['session-1'].last)
  assert.equal(record.ok, true)
  assert.equal(record.record.data.provenance.autoTrigger, 'attempt-end')
  assert.ok(record.record.data.provenance.correlation.attemptId)
})

test('auto-capture: every-n cadence only captures at the declared boundary', async () => {
  const { attempts, facts, store, branch } = harness()
  const capture = realCapture({ store, branch })
  const policy = createAutoCapturePolicy({ facts, capture, ownerOf: stubOwnerOf })
  await policy.enable({ owner: 'plugin-a', cadence: { kind: 'every-n', n: 2 } })
  await attempts.emitEnd({ sessionId: 'session-1', attemptId: 'attempt-1' })
  assert.equal(policy.status().attempts['session-1'].created, 0)
  await attempts.emitEnd({ sessionId: 'session-1', attemptId: 'attempt-2' })
  const status = policy.status()
  assert.equal(status.attempts['session-1'].attempts, 2)
  assert.equal(status.attempts['session-1'].created, 1)
  const listed = await store.list({ scopeKind: 'session' })
  assert.equal(listed.items.length, 1)
})

test('auto-capture: disable is idempotent and stops further captures', async () => {
  const { attempts, facts, store, branch } = harness()
  const capture = realCapture({ store, branch })
  const policy = createAutoCapturePolicy({ facts, capture, ownerOf: stubOwnerOf })
  await policy.enable({ owner: 'plugin-a', cadence: { kind: 'every-attempt' } })
  await policy.disable()
  await attempts.emitEnd({ sessionId: 'session-1', attemptId: 'attempt-1' })
  assert.equal(policy.status().attempts['session-1'], undefined)
  const again = await policy.disable()
  assert.equal(again.ok, true)
})

test('auto-capture: without the shared slice the policy is unavailable and never fires', async () => {
  const facts = createLoopFacts({ facts: undefined })
  const store = createTestStore()
  const branch = createBranchAuthorityFixture()
  const capture = realCapture({ store, branch })
  const policy = createAutoCapturePolicy({ facts, capture, ownerOf: stubOwnerOf })
  const availability = policy.availability()
  assert.equal(availability.status, 'unavailable')
  const enabled = policy.enable({ owner: 'plugin-a', cadence: { kind: 'every-attempt' } })
  assert.equal(enabled.ok, false)
  assert.equal(enabled.code, 'unavailable')
  assert.equal(policy.status().enabled, false)
})

test('auto-capture: owner-scoped — a second owner cannot take over the active policy', async () => {
  const { attempts, facts, store, branch } = harness()
  const capture = realCapture({ store, branch })
  const policy = createAutoCapturePolicy({ facts, capture, ownerOf: stubOwnerOf })
  await policy.enable({ owner: 'plugin-a', cadence: { kind: 'every-attempt' } })
  const takeover = policy.enable({ owner: 'plugin-b', cadence: { kind: 'every-attempt' } })
  assert.equal(takeover.ok, false)
  assert.equal(takeover.code, 'conflict')
})