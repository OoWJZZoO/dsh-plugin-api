import test from 'node:test'
import assert from 'node:assert/strict'
import { createCaptureAuthority } from '../lib/checkpoint-capture.js'
import { createTestStore, createIdFactory, stubOwnerOf, createBranchAuthorityFixture, createTransactionsAuthorityFixture, createSnapshotSliceFixture, createAuditFixture } from './checkpoint-test-kit.mjs'

function createHarness(options = {}) {
  const store = options.store ?? createTestStore()
  const branch = options.branch ?? createBranchAuthorityFixture()
  const journal = options.journal ?? createTransactionsAuthorityFixture()
  const snapshot = options.snapshot ?? createSnapshotSliceFixture()
  const audit = options.audit ?? createAuditFixture()
  const capture = createCaptureAuthority({
    store,
    authorities: options.authorities ?? { branch: branch.face, journal: journal.face, snapshot: snapshot.face },
    ownerOf: stubOwnerOf,
    idFactory: createIdFactory('cp'),
    audit: options.audit ? options.audit.face : audit.face,
  })
  return { store, branch, journal, snapshot, audit, capture }
}

const sessionSpec = (overrides = {}) => ({
  scope: { sessionId: 'session-1' },
  source: { kind: 'branch' },
  reason: 'rescue point',
  ...overrides,
})

test('create: branch capture routes through the branch authority and commits a record', async () => {
  const { capture, store, branch } = createHarness()
  const outcome = await capture.create(sessionSpec(), { owner: 'plugin-a' })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.code, 'created')
  assert.equal(outcome.commitState, 'committed')
  assert.equal(outcome.summary.overall, 'captured')
  assert.equal(outcome.summary.source, 'branch')
  assert.ok(outcome.summary.anchor.branchId)
  assert.equal(branch.branches().length, 1)
  const record = await store.get(outcome.summary.checkpointId)
  assert.equal(record.ok, true)
  assert.equal(record.record.owner, 'plugin-a')
  assert.equal(record.record.data.capture.overall, 'captured')
  assert.equal(record.record.data.provenance.autoTrigger, null)
  assert.ok(Object.isFrozen(outcome))
})

test('create: unregistered source yields typed unsupported and writes no record', async () => {
  const { capture, store } = createHarness()
  const outcome = await capture.create({ scope: { sessionId: 'session-1' }, source: { kind: 'time-machine' } }, { owner: 'plugin-a' })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'unsupported')
  const listed = await store.list({})
  assert.equal(listed.items.length, 0)
})

test('create: unavailable owning authority yields typed unavailable, no fake record', async () => {
  const { capture, store, branch } = createHarness()
  branch.setActive(false, 'fixture branch authority down')
  const outcome = await capture.create(sessionSpec(), { owner: 'plugin-a' })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'unavailable')
  assert.match(outcome.reason, /down|inactive/)
  const listed = await store.list({})
  assert.equal(listed.items.length, 0)
})

test('create: profile-scope capture is typed unavailable and produces no record', async () => {
  const { capture, store } = createHarness()
  const outcome = await capture.create({ scope: { profileId: 'profile-1' }, source: { kind: 'branch' } }, { owner: 'plugin-a' })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'unavailable')
  const listed = await store.list({})
  assert.equal(listed.items.length, 0)
})

test('create: capture-key dedupe returns the existing record; a new key creates a new record with lineage', async () => {
  const { capture, store } = createHarness()
  const first = await capture.create(sessionSpec({ captureKey: 'key-1' }), { owner: 'plugin-a' })
  assert.equal(first.code, 'created')
  const retry = await capture.create(sessionSpec({ captureKey: 'key-1' }), { owner: 'plugin-a' })
  assert.equal(retry.ok, true)
  assert.equal(retry.code, 'deduplicated')
  assert.equal(retry.idempotent, true)
  assert.equal(retry.record.id, first.summary.checkpointId)
  const retrigger = await capture.create(sessionSpec({ captureKey: 'key-2' }), { owner: 'plugin-a' })
  assert.equal(retrigger.code, 'created')
  const record = await store.get(retrigger.summary.checkpointId)
  assert.equal(record.record.data.lineage.previousCheckpointId, first.summary.checkpointId)
})

test('create: capture-key dedupe is owner-isolated', async () => {
  const { capture } = createHarness()
  const first = await capture.create(sessionSpec({ captureKey: 'key-1' }), { owner: 'plugin-a' })
  assert.equal(first.code, 'created')
  const other = await capture.create(sessionSpec({ captureKey: 'key-1' }), { owner: 'plugin-b' })
  assert.equal(other.code, 'created')
  assert.notEqual(other.summary.checkpointId, first.summary.checkpointId)
})

test('create: honest partial capture commits the record with partial statuses exposed', async () => {
  const partialBranch = {
    availability: () => ({ status: 'active' }),
    create: async () => ({
      ok: true,
      handle: { id: 'branch-p' },
      anchor: { branchId: 'branch-p' },
      components: [
        { name: 'branch', status: 'captured' },
        { name: 'external-state', status: 'missing', detail: 'not captured' },
      ],
    }),
  }
  const store = createTestStore()
  const capture = createCaptureAuthority({
    store,
    authorities: { branch: partialBranch },
    ownerOf: stubOwnerOf,
    idFactory: createIdFactory('cp'),
  })
  const partial = await capture.create(sessionSpec(), { owner: 'plugin-a' })
  assert.equal(partial.ok, true)
  assert.equal(partial.summary.overall, 'partial')
  assert.equal(partial.summary.components[1].status, 'missing')
  const stored = await store.get(partial.summary.checkpointId)
  assert.equal(stored.record.data.capture.overall, 'partial')
  assert.equal(stored.record.data.capture.components[1].status, 'missing')
})

test('create: journal capture routes through prepare + record and commits a workspace record', async () => {
  const { capture, store, journal } = createHarness()
  const outcome = await capture.create({ scope: { workspaceId: 'workspace-1' }, source: { kind: 'workspace-journal' } }, { owner: 'plugin-a' })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.code, 'created')
  assert.equal(outcome.summary.source, 'workspace-journal')
  assert.ok(outcome.summary.anchor.transactionId)
  assert.equal(journal.transactions().length, 1)
  assert.equal(journal.transactions()[0].entries[0].kind, 'checkpoint-marker')
  const record = await store.get(outcome.summary.checkpointId)
  assert.equal(record.ok, true)
  assert.equal(record.record.data.source.anchor.transactionId, outcome.summary.anchor.transactionId)
})

test('create: workspace-snapshot capture routes through the slice when active', async () => {
  const { capture, store, snapshot } = createHarness()
  const outcome = await capture.create({ scope: { workspaceId: 'workspace-1' }, source: { kind: 'workspace-snapshot' } }, { owner: 'plugin-a' })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.code, 'created')
  assert.ok(outcome.summary.anchor.snapshotId)
  assert.equal(snapshot.snapshots().size, 1)
  const record = await store.get(outcome.summary.checkpointId)
  assert.equal(record.record.data.source.anchor.snapshotId, outcome.summary.anchor.snapshotId)
})

test('create: workspace-snapshot is unavailable when the slice is inactive (no fake capability)', async () => {
  const { capture, store, snapshot } = createHarness()
  snapshot.setActive(false, 'slice probe failed')
  const outcome = await capture.create({ scope: { workspaceId: 'workspace-1' }, source: { kind: 'workspace-snapshot' } }, { owner: 'plugin-a' })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'unavailable')
  assert.match(outcome.reason, /inactive|probe|slice/)
  const listed = await store.list({})
  assert.equal(listed.items.length, 0)
})

test('create: failed anchor capture writes no record and releases the capture key', async () => {
  const { capture, store, journal } = createHarness()
  journal.setActive(false, 'journal down')
  const outcome = await capture.create({ scope: { workspaceId: 'workspace-1' }, source: { kind: 'workspace-journal' }, captureKey: 'key-j' }, { owner: 'plugin-a' })
  assert.equal(outcome.ok, false)
  const listed = await store.list({})
  assert.equal(listed.items.length, 0)
  const key = await store.keyGet('plugin-a', 'key-j', 'workspace')
  assert.equal(key.row.phase, 'released')
})

test('create: audit failure keeps the declared effect and exposes a bounded gap marker', async () => {
  const audit = createAuditFixture({ fail: true })
  const { capture, store, branch } = createHarness({ audit })
  const outcome = await capture.create(sessionSpec(), { owner: 'plugin-a' })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.code, 'created')
  assert.equal(outcome.summary.auditGap, true)
  assert.equal(branch.branches().length, 1) // the anchor effect is retained
  const record = await store.get(outcome.summary.checkpointId)
  assert.equal(record.ok, true)
})

test('create: caller owner derivation failure is typed unavailable, nothing captured', async () => {
  const store = createTestStore()
  const capture = createCaptureAuthority({ store, authorities: {}, ownerOf: () => undefined, idFactory: createIdFactory('cp') })
  const outcome = await capture.create(sessionSpec(), { owner: 'someone-spoofing' })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'unavailable')
  const listed = await store.list({})
  assert.equal(listed.items.length, 0)
})

test('create: external effects are classified; invalid kinds are dropped and no rollback is promised', async () => {
  const { capture, store } = createHarness()
  const outcome = await capture.create(sessionSpec({
    externalEffects: [
      { name: 'git push', kind: 'external' },
      { name: 'local hook', kind: 'unknown' },
      { name: 'bad', kind: 'explode' },
    ],
  }), { owner: 'plugin-a' })
  assert.equal(outcome.ok, true)
  const record = await store.get(outcome.summary.checkpointId)
  assert.deepEqual(record.record.data.externalEffects, [
    { name: 'git push', kind: 'external' },
    { name: 'local hook', kind: 'unknown' },
  ])
  assert.ok(record.record.data.externalEffects.every((effect) => effect.kind === 'external' || effect.kind === 'unknown'))
})

test('create: committed mutability — records are append-only, no update path exists', async () => {
  const { capture, store } = createHarness()
  const first = await capture.create(sessionSpec(), { owner: 'plugin-a' })
  assert.equal(first.code, 'created')
  const second = await capture.create(sessionSpec(), { owner: 'plugin-a' })
  assert.equal(second.code, 'created')
  assert.notEqual(first.summary.checkpointId, second.summary.checkpointId)
  const listed = await store.list({})
  assert.equal(listed.items.length, 2)
})