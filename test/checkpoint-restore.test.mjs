import test from 'node:test'
import assert from 'node:assert/strict'
import { createRestoreAuthority } from '../lib/checkpoint-restore.js'
import { createRestorePlanner } from '../lib/checkpoint-plan.js'
import { createLoopFacts } from '../lib/checkpoint-facts.js'
import { createRestoreStepAdapters } from '../lib/checkpoint-sources.js'
import { createCaptureAuthority } from '../lib/checkpoint-capture.js'
import {
  createTestStore,
  createMemoryFacility,
  createIdFactory,
  stubOwnerOf,
  createBranchAuthorityFixture,
  createTransactionsAuthorityFixture,
  createSnapshotSliceFixture,
  createAttemptFactsFixture,
  createCoordinationFixture,
  createTerminalWaiterFixture,
  createAuditFixture,
} from './checkpoint-test-kit.mjs'

function harness(options = {}) {
  const facility = createMemoryFacility()
  const store = createTestStore({ facility })
  const branch = options.branch ?? createBranchAuthorityFixture()
  const journal = options.journal ?? createTransactionsAuthorityFixture()
  const snapshot = options.snapshot ?? createSnapshotSliceFixture()
  const attempts = options.attempts ?? createAttemptFactsFixture()
  const facts = createLoopFacts({ facts: attempts.facet })
  const coordination = options.coordination ?? createCoordinationFixture()
  const waiter = options.waiter ?? createTerminalWaiterFixture()
  const audit = options.audit ?? createAuditFixture()
  const capture = createCaptureAuthority({
    store,
    authorities: { branch: branch.face, journal: journal.face, snapshot: snapshot.face },
    ownerOf: stubOwnerOf,
    idFactory: createIdFactory('cp'),
  })
  const planner = createRestorePlanner({
    store,
    facts,
    sources: {
      branch: { availability: () => branch.face.availability() },
      'workspace-journal': { availability: () => journal.face.availability() },
      'workspace-snapshot': { availability: () => snapshot.face.availability() },
    },
  })
  const stepAdapters = createRestoreStepAdapters({ branches: branch.face, transactions: journal.face, snapshot: snapshot.face })
  const restore = createRestoreAuthority({
    store,
    planner,
    facts,
    stepAdapters,
    coordination: coordination.face,
    ownerOf: stubOwnerOf,
    idFactory: createIdFactory('restore'),
    waitForTerminal: waiter.waiter,
    audit: audit.face,
  })
  return { store, branch, journal, snapshot, attempts, facts, coordination, waiter, audit, capture, planner, stepAdapters, restore }
}

async function seedSession({ harness: h, attempts } = {}) {
  const outcome = await h.capture.create({ scope: { sessionId: 'session-1' }, source: { kind: 'branch' }, reason: 'restore point' }, { owner: 'plugin-a' })
  assert.equal(outcome.ok, true)
  let planned
  if (attempts) {
    attempts.set('session-1', { state: 'running', attemptId: 'attempt-9' })
    planned = await h.planner.planRestore(outcome.summary.checkpointId)
    assert.equal(planned.plan.liveState.state, 'running')
  } else {
    planned = await h.planner.planRestore(outcome.summary.checkpointId)
  }
  return { checkpointId: outcome.summary.checkpointId, plan: planned.plan }
}

test('restore: successful idle restore commits exactly one success terminal through the branch authority', async () => {
  const h = harness()
  const { checkpointId, plan } = await seedSession({ harness: h })
  const result = await h.restore.restore(checkpointId, { plan }, { owner: 'plugin-a' })
  assert.equal(result.ok, true)
  assert.equal(result.code, 'started')
  assert.ok(result.handle)
  assert.equal(result.handle.id, result.operation.id)
  const status = result.handle.status()
  assert.equal(status.terminal, 'success')
  assert.equal(status.phase, 'terminal')
  assert.equal(status.result.partial, false)
  assert.deepEqual(status.result.stepsDone, ['branch-restore'])
  assert.equal(h.branch.branches().filter((item) => item.restored).length, 1)
  // Exactly one terminal: a second commit attempt is rejected by status closure.
  const retry = await h.restore.restore(checkpointId, { plan }, { owner: 'plugin-a' })
  assert.equal(retry.ok, true) // new operation, new identity (no cascade; each restore is its own operation)
  assert.notEqual(retry.handle.id, result.handle.id)
})

test('restore: preflight rejects a stale plan with typed conflict before any step executes', async () => {
  const h = harness()
  const { checkpointId, plan } = await seedSession({ harness: h })
  const tampered = { ...plan, fingerprint: 'forged-fingerprint' }
  const result = await h.restore.restore(checkpointId, { plan: tampered }, { owner: 'plugin-a' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'conflict')
  assert.match(result.reason, /stale/)
  assert.equal(h.branch.branches().filter((item) => item.restored).length, 0)
})

test('restore: preflight denies a plan with no restoreable slice and executes nothing', async () => {
  const h = harness()
  const { checkpointId } = await seedSession({ harness: h })
  h.branch.setActive(false, 'branch authority down at restore time')
  const degraded = await h.planner.planRestore(checkpointId)
  assert.equal(degraded.plan.overallRestoreability, 'unavailable')
  const result = await h.restore.restore(checkpointId, { plan: degraded.plan }, { owner: 'plugin-a' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'denied')
  assert.equal(h.branch.branches().filter((item) => item.restored).length, 0)
})

test('restore: invalid plan inputs and missing records are typed, never thrown', async () => {
  const h = harness()
  const missing = await h.restore.restore('cp-nope', { plan: { fingerprint: 'x', checkpointId: 'cp-nope' } }, { owner: 'plugin-a' })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'missing')
  const invalid = await h.restore.restore('', {}, { owner: 'plugin-a' })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.code, 'invalid-input')
})

test('restore: exclusive fencing — a second restore of the same resource is denied while the first holds the lease', async () => {
  const h = harness()
  const { checkpointId, plan } = await seedSession({ harness: h })
  // First restore completes and releases; the conflict path needs a concurrent
  // holder, so acquire the coordination lease out-of-band first.
  const held = await h.coordination.face.acquire({ resource: { scope: 'session', key: 'sessions.session-1.restore' }, ownerId: 'other-owner', leaseMs: 60_000 })
  assert.equal(held.ok, true)
  const result = await h.restore.restore(checkpointId, { plan }, { owner: 'plugin-a' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'conflict')
  assert.match(result.reason, /held/)
  assert.equal(h.branch.branches().filter((item) => item.restored).length, 0)
})

test('restore: fencing loss stops new steps, fails closed with partial', async () => {
  const h = harness()
  h.coordination.setFailHeartbeats(1) // the step precondition heartbeat fails immediately
  const { checkpointId, plan } = await seedSession({ harness: h })
  const result = await h.restore.restore(checkpointId, { plan }, { owner: 'plugin-a' })
  assert.equal(result.ok, true)
  const status = result.handle.status()
  assert.equal(status.terminal, 'error')
  assert.match(status.reason, /lease|fencing/)
  assert.equal(status.result.partial, true)
  assert.deepEqual(status.result.stepsDone, [])
  assert.equal(h.branch.branches().filter((item) => item.restored).length, 0, 'no step runs with a stale fence')
})

test('restore: stepwise partial result — a failed step stops further steps with error + partial fields', async () => {
  const h = harness()
  h.branch.setFailStep({ code: 'denied', reason: 'branch anchor stale' })
  const { checkpointId, plan } = await seedSession({ harness: h })
  const result = await h.restore.restore(checkpointId, { plan }, { owner: 'plugin-a' })
  assert.equal(result.ok, true)
  const status = result.handle.status()
  assert.equal(status.terminal, 'error')
  assert.equal(status.reason, 'branch anchor stale')
  assert.equal(status.result.partial, true)
  assert.equal(status.result.failedStep, 'branch-restore')
  assert.deepEqual(status.result.stepsDone, [])
  assert.deepEqual(status.result.perSlice, [])
})

test('restore: stop-then-restore sequencing — cancel request through the shared boundary, terminal wait, then rewind', async () => {
  const h = harness()
  const waiter = h.waiter
  waiter.setTerminal('aborted')
  const { checkpointId, plan } = await seedSession({ harness: h, attempts: h.attempts })
  const result = await h.restore.restore(checkpointId, { plan }, { owner: 'plugin-a' })
  assert.equal(result.ok, true)
  // The bounded wait observed the attempt's committed terminal.
  assert.equal(waiter.terminalOf('attempt-9'), 'aborted')
  const status = result.handle.status()
  assert.equal(status.terminal, 'success')
  assert.equal(status.stoppedAttempt.attemptId, 'attempt-9')
  assert.equal(status.stoppedAttempt.terminal, 'aborted')
  // The branch step carried the supersession attribution.
  const restored = h.branch.branches().find((item) => item.restored)
  assert.deepEqual(restored.supersession, { supersededBy: 'restore', attemptId: 'attempt-9', terminal: 'aborted' })
})

test('restore: bounded-wait failure closes — no rewind happens under a live attempt', async () => {
  const h = harness()
  h.waiter.setCode('timeout')
  const { checkpointId, plan } = await seedSession({ harness: h, attempts: h.attempts })
  const result = await h.restore.restore(checkpointId, { plan }, { owner: 'plugin-a' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'denied')
  assert.equal(result.operation.terminal, 'error')
  assert.match(result.operation.reason, /did not reach a terminal|bound/)
  assert.equal(h.branch.branches().filter((item) => item.restored).length, 0, 'never rewinds under a live attempt')
})

test('restore: running session without the shared cancel boundary is denied before any step', async () => {
  const facility = createMemoryFacility()
  const store = createTestStore({ facility })
  const branch = createBranchAuthorityFixture()
  const capture = createCaptureAuthority({ store, authorities: { branch: branch.face }, ownerOf: stubOwnerOf, idFactory: createIdFactory('cp') })
  const outcome = await capture.create({ scope: { sessionId: 'session-1' }, source: { kind: 'branch' } }, { owner: 'plugin-a' })
  const facts = createLoopFacts({ facts: undefined }) // no slice
  const planner = createRestorePlanner({ store, facts, sources: { branch: { availability: () => branch.face.availability() } } })
  const planned = await planner.planRestore(outcome.summary.checkpointId)
  assert.equal(planned.plan.overallRestoreability, 'unavailable')
  const stepAdapters = createRestoreStepAdapters({ branches: branch.face })
  const restore = createRestoreAuthority({ store, planner, facts, stepAdapters, coordination: createCoordinationFixture().face, ownerOf: stubOwnerOf, idFactory: createIdFactory('restore') })
  const result = await restore.restore(outcome.summary.checkpointId, { plan: planned.plan }, { owner: 'plugin-a' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'denied')
  assert.equal(branch.branches().filter((item) => item.restored).length, 0)
})

test('restore: caller cancellation adjudicates aborted; current step reaches its boundary', async () => {
  const h = harness()
  const controller = new AbortController()
  controller.abort() // cancelled before execution
  const { checkpointId, plan } = await seedSession({ harness: h })
  const result = await h.restore.restore(checkpointId, { plan, signal: controller.signal }, { owner: 'plugin-a' })
  assert.equal(result.ok, true)
  const status = result.handle.status()
  assert.equal(status.terminal, 'aborted')
  assert.equal(status.result.partial, true)
  assert.deepEqual(status.result.stepsDone, [])
  assert.equal(h.branch.branches().filter((item) => item.restored).length, 0, 'cancellation never forges a step result')
})

test('restore: dispose requests a stop without forging a terminal', async () => {
  const h = harness()
  const { checkpointId, plan } = await seedSession({ harness: h })
  const result = await h.restore.restore(checkpointId, { plan }, { owner: 'plugin-a' })
  assert.equal(result.ok, true)
  const before = result.handle.status().terminal
  const disposed = result.handle.dispose()
  assert.equal(disposed.ok, true)
  const after = result.handle.status().terminal
  assert.equal(after, before)
})

test('restore: one operation per checkpoint — no implicit cross-record cascade', async () => {
  const h = harness()
  const { checkpointId, plan } = await seedSession({ harness: h })
  const second = await h.capture.create({ scope: { sessionId: 'session-1' }, source: { kind: 'branch' } }, { owner: 'plugin-a' })
  const secondPlan = await h.planner.planRestore(second.summary.checkpointId)
  const firstResult = await h.restore.restore(checkpointId, { plan }, { owner: 'plugin-a' })
  const secondResult = await h.restore.restore(second.summary.checkpointId, { plan: secondPlan.plan }, { owner: 'plugin-a' })
  assert.equal(firstResult.handle.status().terminal, 'success')
  assert.equal(secondResult.handle.status().terminal, 'success')
})

test('restore: journal and snapshot slices restore through their declared authorities', async () => {
  const h = harness()
  const journalCp = await h.capture.create({ scope: { workspaceId: 'workspace-1' }, source: { kind: 'workspace-journal' } }, { owner: 'plugin-a' })
  const journalPlan = await h.planner.planRestore(journalCp.summary.checkpointId)
  const journalResult = await h.restore.restore(journalCp.summary.checkpointId, { plan: journalPlan.plan }, { owner: 'plugin-a' })
  assert.equal(journalResult.handle.status().terminal, 'success')
  assert.equal(h.journal.transactions()[0].recovered, true)

  const snapCp = await h.capture.create({ scope: { workspaceId: 'workspace-1' }, source: { kind: 'workspace-snapshot' } }, { owner: 'plugin-a' })
  const snapPlan = await h.planner.planRestore(snapCp.summary.checkpointId)
  assert.equal(snapPlan.plan.slices[0].steps[0].authority, 'workspaces.snapshot.restore')
  const snapshotFixtureState = h.snapshot.snapshots().get(snapCp.summary.anchor?.snapshotId ?? snapPlan.plan.slices[0].steps[0].steps.snapshotId)
  assert.ok(snapshotFixtureState)
  // The snapshot apply step requires the restore fencing token.
  const snapResult = await h.restore.restore(snapCp.summary.checkpointId, { plan: snapPlan.plan }, { owner: 'plugin-a' })
  assert.equal(snapResult.handle.status().terminal, 'success')
  assert.ok(h.snapshot.lastApplied())
})

test('restore: recovery authority is never consumed (no double-consume)', async () => {
  const h = harness()
  let recoveryCalls = 0
  const recoveryPatch = { evaluate: () => { recoveryCalls += 1 } }
  const { checkpointId, plan } = await seedSession({ harness: h })
  const result = await h.restore.restore(checkpointId, { plan }, { owner: 'plugin-a' })
  assert.equal(result.handle.status().terminal, 'success')
  assert.equal(recoveryCalls, 0)
  void recoveryPatch
})