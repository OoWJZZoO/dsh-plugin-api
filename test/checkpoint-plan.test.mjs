import test from 'node:test'
import assert from 'node:assert/strict'
import { createRestorePlanner } from '../lib/checkpoint-plan.js'
import { createCaptureAuthority } from '../lib/checkpoint-capture.js'
import { createLoopFacts } from '../lib/checkpoint-facts.js'
import { createBranchSource, createWorkspaceJournalSource, createWorkspaceSnapshotSource } from '../lib/checkpoint-sources.js'
import {
  createTestStore,
  createMemoryFacility,
  createIdFactory,
  stubOwnerOf,
  createBranchAuthorityFixture,
  createTransactionsAuthorityFixture,
  createSnapshotSliceFixture,
  createAttemptFactsFixture,
} from './checkpoint-test-kit.mjs'

function captureFixture({ branch, store }) {
  return createCaptureAuthority({
    store,
    authorities: { branch: branch.face },
    ownerOf: stubOwnerOf,
    idFactory: createIdFactory('cp'),
  })
}

async function seedSessionCheckpoint({ store, branch, reason = 'plan point', liveState } = {}) {
  const capture = captureFixture({ branch, store })
  const outcome = await capture.create({ scope: { sessionId: 'session-1' }, source: { kind: 'branch' }, reason, externalEffects: [{ name: 'git push', kind: 'external' }] }, { owner: 'plugin-a' })
  return outcome.summary.checkpointId
}

function harness(options = {}) {
  const facility = options.facility ?? createMemoryFacility()
  const store = options.store ?? createTestStore({ facility })
  const branch = options.branch ?? createBranchAuthorityFixture()
  const journal = options.journal ?? createTransactionsAuthorityFixture()
  const snapshot = options.snapshot ?? createSnapshotSliceFixture()
  const attempts = options.attempts ?? createAttemptFactsFixture()
  const facts = createLoopFacts({ facts: attempts.facet })
  const sources = options.sources ?? {
    branch: createBranchSource({ branches: branch.face }),
    'workspace-journal': createWorkspaceJournalSource({ transactions: journal.face }),
    'workspace-snapshot': createWorkspaceSnapshotSource({ snapshot: snapshot.face }),
  }
  const planner = options.planner ?? createRestorePlanner({ store, facts, sources })
  return { store, branch, journal, snapshot, facts, attempts, planner, sources }
}

test('planRestore: pure frozen plan bound to the concrete owning authority', async () => {
  const { store, branch, planner } = harness()
  const checkpointId = await seedSessionCheckpoint({ store, branch })
  const before = await store.list({})
  const planned = await planner.planRestore(checkpointId)
  assert.equal(planned.ok, true)
  assert.ok(planned.plan)
  const plan = planned.plan
  assert.ok(Object.isFrozen(plan))
  assert.equal(plan.checkpointId, checkpointId)
  assert.equal(plan.slices.length, 1)
  assert.equal(plan.slices[0].slice, 'session')
  assert.equal(plan.slices[0].steps[0].authority, 'sessions.branches.restore')
  assert.equal(plan.slices[0].steps[0].restoreability, 'restoreable')
  assert.equal(plan.overallRestoreability, 'restoreable')
  assert.deepEqual(plan.claims, [{ resource: 'sessions.session-1.restore', mode: 'exclusive' }])
  assert.deepEqual(plan.externalEffects, [{ name: 'git push', kind: 'external' }])
  assert.ok(plan.fingerprint)
  const after = await store.list({})
  assert.deepEqual(after.items, before.items, 'planRestore writes nothing')
})

test('planRestore: same state produces the same fingerprint; evidence-derived fields excluded', async () => {
  const { store, branch, planner, attempts } = harness()
  const checkpointId = await seedSessionCheckpoint({ store, branch })
  const first = await planner.planRestore(checkpointId)
  const second = await planner.planRestore(checkpointId)
  assert.equal(first.plan.fingerprint, second.plan.fingerprint)
  // liveState changes must not change the fingerprint (excluded from it)
  attempts.set('session-1', { state: 'running', attemptId: 'attempt-9' })
  const third = await planner.planRestore(checkpointId)
  assert.equal(third.plan.liveState.state, 'running')
  assert.equal(third.plan.fingerprint, second.plan.fingerprint)
})

test('planRestore: observed live attempt marks stop-then-restore available and keeps the plan restoreable', async () => {
  const { store, branch, planner, attempts } = harness()
  const checkpointId = await seedSessionCheckpoint({ store, branch })
  attempts.set('session-1', { state: 'running', attemptId: 'attempt-9' })
  const planned = await planner.planRestore(checkpointId)
  assert.equal(planned.plan.liveState.evidence, 'observed')
  assert.equal(planned.plan.liveState.state, 'running')
  assert.equal(planned.plan.liveState.attemptId, 'attempt-9')
  assert.equal(planned.plan.stopThenRestore.available, true)
  assert.equal(planned.plan.slices[0].steps[0].precondition.liveAttempt.state, 'running')
})

test('planRestore: slice-inactive degrades to unavailable with the concrete reason and no stop-then-restore', async () => {
  // No loop facts slice at all: activity evidence absent, cancel boundary absent.
  const { store, branch } = harness()
  const checkpointId = await seedSessionCheckpoint({ store, branch })
  const facts = createLoopFacts({ facts: undefined, activity: undefined })
  const planner = createRestorePlanner({
    store,
    facts,
    sources: { branch: createBranchSource({ branches: branch.face }) },
  })
  const planned = await planner.planRestore(checkpointId)
  assert.equal(planned.plan.liveState.evidence, 'unknown')
  assert.equal(planned.plan.stopThenRestore.available, false)
  assert.ok(planned.plan.stopThenRestore.reason)
})

test('planRestore: unconfirmable idle without the cancel boundary is fail-closed blocked', async () => {
  // No loop slice and no activity evidence: the session's idle state cannot be
  // confirmed, so the session slice is not restoreable (fail-closed).
  const { store, branch, attempts } = harness()
  const checkpointId = await seedSessionCheckpoint({ store, branch })
  attempts.set('session-1', { state: 'running', attemptId: 'attempt-9' })
  const facts = createLoopFacts({ facts: undefined, activity: undefined })
  const sources = { branch: createBranchSource({ branches: branch.face }) }
  const planner = createRestorePlanner({ store, facts, sources })
  const planned = await planner.planRestore(checkpointId)
  assert.equal(planned.plan.slices[0].steps[0].restoreability, 'unavailable')
  assert.equal(planned.plan.slices[0].overall, 'unavailable')
  assert.match(planned.plan.slices[0].reasons.join(' '), /running session restore is unavailable|cannot be confirmed/)
  assert.equal(planned.plan.overallRestoreability, 'unavailable')
})

test('planRestore: unknown v1 slice yields not-applicable; unavailable authority yields unavailable', async () => {
  const facility = createMemoryFacility()
  const store = createTestStore({ facility })
  const branch = createBranchAuthorityFixture()
  const capture = captureFixture({ branch, store })
  const outcome = await capture.create({ scope: { sessionId: 'session-1' }, source: { kind: 'branch' } }, { owner: 'plugin-a' })
  assert.equal(outcome.ok, true)
  branch.setActive(false, 'branch authority down at plan time')
  const plannerDown = createRestorePlanner({
    store,
    facts: createLoopFacts({}),
    sources: { branch: createBranchSource({ branches: branch.face }) },
  })
  const unavailable = await plannerDown.planRestore(outcome.summary.checkpointId)
  assert.equal(unavailable.plan.slices[0].steps[0].restoreability, 'unavailable')
  assert.equal(unavailable.plan.slices[0].overall, 'unavailable')
  assert.equal(unavailable.plan.overallRestoreability, 'unavailable')
  assert.ok(unavailable.plan.slices[0].reasons.some((reason) => String(reason).includes('unavailable')))
  // A record whose source kind lies outside the v1 table cannot occur through
  // create; simulate a future-shaped record by tampering the durable unit.
  // The planner must never guess it — it returns a typed unavailable result.
  const futureRecord = { ...(await store.get(outcome.summary.checkpointId)).record }
  futureRecord.data = { ...futureRecord.data, source: { kind: 'holodeck', anchor: {} } }
  const domain = facility.domainOf('session__checkpoints__records')
  assert.ok(domain, 'fixture domain is open')
  await domain.table('records').put(outcome.summary.checkpointId, futureRecord)
  const plannerUnknown = createRestorePlanner({ store, facts: createLoopFacts({}), sources: {} })
  const planned = await plannerUnknown.planRestore(outcome.summary.checkpointId)
  assert.equal(planned.ok, false)
  assert.equal(planned.code, 'unavailable')
  assert.match(planned.reason, /registered kind|invalid|unsupported/)
})

test('planRestore: missing and unsupported records are typed, never guessed', async () => {
  const planner = createRestorePlanner({ store: createTestStore(), facts: createLoopFacts({}), sources: {} })
  const missing = await planner.planRestore('cp-nope')
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'missing')
  const invalid = await planner.planRestore('')
  assert.equal(invalid.ok, false)
  assert.equal(invalid.code, 'invalid-input')
})

test('planRestore: an anchor deleted after capture is marked unavailable/stale with the concrete reason', async () => {
  const { store, branch, planner } = harness()
  const checkpointId = await seedSessionCheckpoint({ store, branch })
  const before = await planner.planRestore(checkpointId)
  assert.equal(before.plan.slices[0].steps[0].restoreability, 'restoreable')
  const anchorBranchId = before.plan.slices[0].steps[0].steps.branchId
  branch.removeBranch(anchorBranchId)
  const after = await planner.planRestore(checkpointId)
  assert.equal(after.plan.slices[0].steps[0].restoreability, 'unavailable')
  assert.equal(after.plan.slices[0].overall, 'unavailable')
  assert.match(after.plan.slices[0].reasons.join(' '), /anchor cannot be confirmed/)
})

test('planRestore: a gone scope resource marks the slice unavailable while the record stays intact', async () => {
  const { store, branch, planner } = harness()
  const checkpointId = await seedSessionCheckpoint({ store, branch })
  const before = await planner.planRestore(checkpointId)
  assert.equal(before.plan.slices[0].scopeResource.status, 'reachable')
  // The session disappears after capture: the record is never rewritten.
  const storedBefore = await store.get(checkpointId)
  branch.removeSession('session-1')
  const after = await planner.planRestore(checkpointId)
  assert.equal(after.plan.slices[0].scopeResource.status, 'unavailable')
  assert.equal(after.plan.slices[0].steps[0].restoreability, 'unavailable')
  assert.equal(after.plan.slices[0].overall, 'unavailable')
  assert.match(after.plan.slices[0].reasons.join(' '), /no longer exists or is unreachable/)
  const storedAfter = await store.get(checkpointId)
  assert.deepEqual(storedAfter.record, storedBefore.record, 'the record is not rewritten')
})

test('planRestore: journal and snapshot anchors are confirmed through their owning authorities', async () => {
  const store = createTestStore()
  const journal = createTransactionsAuthorityFixture()
  const snapshot = createSnapshotSliceFixture()
  const capture = createCaptureAuthority({
    store,
    authorities: { branch: undefined, journal: journal.face, snapshot: snapshot.face },
    ownerOf: stubOwnerOf,
    idFactory: createIdFactory('cp'),
  })
  const journalCp = await capture.create({ scope: { workspaceId: 'workspace-1' }, source: { kind: 'workspace-journal' } }, { owner: 'plugin-a' })
  const snapshotCp = await capture.create({ scope: { workspaceId: 'workspace-1' }, source: { kind: 'workspace-snapshot' } }, { owner: 'plugin-a' })
  const planner = createRestorePlanner({
    store,
    facts: createLoopFacts({}),
    sources: {
      'workspace-journal': createWorkspaceJournalSource({ transactions: journal.face }),
      'workspace-snapshot': createWorkspaceSnapshotSource({ snapshot: snapshot.face }),
    },
  })
  const journalPlan = await planner.planRestore(journalCp.summary.checkpointId)
  assert.equal(journalPlan.plan.slices[0].steps[0].restoreability, 'restoreable')
  assert.equal(journalPlan.plan.slices[0].scopeResource.status, 'reachable')
  journal.removeTransaction(journalPlan.plan.slices[0].steps[0].steps.transactionId)
  const journalAfter = await planner.planRestore(journalCp.summary.checkpointId)
  assert.equal(journalAfter.plan.slices[0].steps[0].restoreability, 'unavailable')
  assert.match(journalAfter.plan.slices[0].reasons.join(' '), /anchor cannot be confirmed/)
  const snapshotPlan = await planner.planRestore(snapshotCp.summary.checkpointId)
  assert.equal(snapshotPlan.plan.slices[0].steps[0].restoreability, 'restoreable')
  snapshot.removeSnapshot(snapshotPlan.plan.slices[0].steps[0].steps.snapshotId)
  const snapshotAfter = await planner.planRestore(snapshotCp.summary.checkpointId)
  assert.equal(snapshotAfter.plan.slices[0].steps[0].restoreability, 'unavailable')
})

test('planRestore: journal and snapshot checkpoints bind to their declared authorities', async () => {
  const store = createTestStore()
  const journal = createTransactionsAuthorityFixture()
  const snapshot = createSnapshotSliceFixture()
  const capture = createCaptureAuthority({
    store,
    authorities: { branch: undefined, journal: journal.face, snapshot: snapshot.face },
    ownerOf: stubOwnerOf,
    idFactory: createIdFactory('cp'),
  })
  const journalCp = await capture.create({ scope: { workspaceId: 'workspace-1' }, source: { kind: 'workspace-journal' } }, { owner: 'plugin-a' })
  const snapshotCp = await capture.create({ scope: { workspaceId: 'workspace-1' }, source: { kind: 'workspace-snapshot' } }, { owner: 'plugin-a' })
  const planner = createRestorePlanner({
    store,
    facts: createLoopFacts({}),
    sources: {
      'workspace-journal': createWorkspaceJournalSource({ transactions: journal.face }),
      'workspace-snapshot': createWorkspaceSnapshotSource({ snapshot: snapshot.face }),
    },
  })
  const journalPlan = await planner.planRestore(journalCp.summary.checkpointId)
  assert.equal(journalPlan.plan.slices[0].steps[0].authority, 'workspaces.transactions.recover')
  assert.equal(journalPlan.plan.slices[0].resourceId, 'workspace-1')
  const snapshotPlan = await planner.planRestore(snapshotCp.summary.checkpointId)
  assert.equal(snapshotPlan.plan.slices[0].steps[0].authority, 'workspaces.snapshot.restore')
})