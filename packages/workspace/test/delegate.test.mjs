import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWorkspaceDelegate,
  createSnapshotStateStore,
  stateFingerprint,
  WORKSPACE_SLICE_MARKER,
} from '../lib/delegate.js'
import { createOfficialRegistryFixture, createSnapshotStateFacilityFixture } from './workspace-fixture.mjs'

function harness(options = {}) {
  const official = options.official ?? createOfficialRegistryFixture()
  const facility = options.facility ?? createSnapshotStateFacilityFixture()
  const store = createSnapshotStateStore({ facility })
  let seq = 0
  const delegate = buildWorkspaceDelegate({
    ctx: {},
    official,
    store,
    idFactory: () => `snapshot-${++seq}`,
  })
  return { official, facility, store, delegate, makeId: () => `snapshot-${++seq}` }
}

test('delegate: reproduces the official service face 1:1 with identity preserved', async () => {
  const { official, delegate } = harness()
  assert.equal(delegate[WORKSPACE_SLICE_MARKER], true)
  const created = await delegate.create('/tmp/ws-a', 'Workspace A')
  assert.ok(created.id)
  assert.equal(created.path, '/tmp/ws-a')
  // get/list return the official entity objects unchanged
  const viaDelegate = delegate.get(created.id)
  assert.equal(viaDelegate, official.get(created.id))
  assert.equal(delegate.list().length, 1)
  const same = await delegate.create('/tmp/ws-a', 'Renamed Title')
  assert.equal(same.id, created.id, 'same canonical path is idempotent')
  const moved = await delegate.insertBefore(created.id)
  assert.ok(moved.includes(created.id))
  const removed = await delegate.delete(created.id)
  assert.equal(removed, true)
  assert.equal(delegate.list().length, 0)
  const removedAgain = await delegate.delete(created.id)
  assert.equal(removedAgain, false, 'unknown ids are an idempotent no-op')
})

test('delegate: entity face forwards (title/session membership) through the official objects', async () => {
  const { official, delegate } = harness()
  official.liveSessions.push('session-1')
  const entity = await delegate.create('/tmp/ws-e', 'Title')
  await entity.attachSession('session-1')
  assert.deepEqual(entity.sessionIds, ['session-1'])
  await entity.attachSession('session-2')
  await entity.insertSessionBefore('session-1', 'session-2')
  assert.deepEqual(entity.sessionIds, ['session-1', 'session-2'])
  await entity.detachSession('session-1')
  assert.deepEqual(entity.sessionIds, ['session-2'])
  await entity.setTitle('New Title')
  assert.equal(entity.title, 'New Title')
  assert.equal(await entity.status(), 'ok')
  assert.equal(await delegate.sessionKnown('session-2'), true, 'attached sessions stay known')
  assert.equal(await delegate.sessionKnown('session-unknown'), false)
})

test('snapshot: capture records authoritative state with per-component statuses and persists it', async () => {
  const { official, delegate, store } = harness()
  const a = await delegate.create('/tmp/ws-a', 'A')
  const b = await delegate.create('/tmp/ws-b', 'B')
  official.liveSessions.push('session-1')
  await a.attachSession('session-1')
  await delegate.archiveSession('session-1')
  const outcome = await delegate.snapshot.capture({})
  assert.equal(outcome.ok, true)
  assert.ok(outcome.anchor.snapshotId)
  assert.deepEqual(outcome.components.map(({ name, status }) => [name, status]), [
    ['registry-order', 'captured'],
    ['records', 'captured'],
    ['archived', 'captured'],
  ])
  const state = (await store.get(outcome.anchor.snapshotId)).state
  assert.deepEqual(state.workspaceIds, [b.id, a.id])
  assert.equal(state.records[a.id].title, 'A')
  assert.deepEqual(state.archivedSessionIds, ['session-1'])
  assert.ok(stateFingerprint(state))
  const fetched = await delegate.snapshot.get(outcome.anchor.snapshotId)
  assert.equal(fetched.ok, true)
  assert.deepEqual(fetched.state, state)
})

test('snapshot: capture writes once per snapshot id (append-only) and availability reflects registry start', async () => {
  const { delegate, store } = harness()
  const first = await delegate.snapshot.capture({})
  assert.equal(first.ok, true)
  const second = await delegate.snapshot.capture({})
  assert.notEqual(second.anchor.snapshotId, first.anchor.snapshotId)
  const dup = await store.put(first.anchor.snapshotId, {})
  assert.equal(dup.ok, false)
  assert.equal(dup.code, 'conflict')
  assert.equal(delegate.snapshot.availability().status, 'active')
})

test('snapshot: apply requires the restore operation fencing', async () => {
  const { delegate } = harness()
  const outcome = await delegate.snapshot.apply({ state: { workspaceIds: [], records: {}, archivedSessionIds: [] } })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'denied')
  assert.match(outcome.reason, /fencing/)
})

test('snapshot: apply reconstructs the captured state through the official API queue', async () => {
  const { official, delegate, facility } = harness()
  const a = await delegate.create('/tmp/ws-a', 'A')
  const b = await delegate.create('/tmp/ws-b', 'B')
  official.liveSessions.push('session-1')
  await a.attachSession('session-1')
  const captured = await delegate.snapshot.capture({})
  // Mutate after capture: reorder, retitle, move membership, delete one.
  await delegate.insertBefore(b.id, a.id)
  await delegate.get(b.id).setTitle('B-Changed')
  await delegate.get(a.id).detachSession('session-1')
  const extra = await delegate.create('/tmp/ws-extra', 'Extra')
  assert.equal(delegate.list().length, 3)
  const state = (await delegate.snapshot.get(captured.anchor.snapshotId)).state
  const applied = await delegate.snapshot.apply({ state, fence: { fencingToken: 'fence-1', generation: 'g-1' } })
  assert.equal(applied.ok, true)
  for (const component of applied.components) {
    assert.equal(component.status, 'captured', component.name)
  }
  assert.equal(delegate.list().length, 2)
  const ids = delegate.list().map((entity) => entity.id)
  assert.deepEqual(ids, [b.id, a.id], 'registry order restored')
  const bAfter = delegate.get(b.id)
  assert.equal(bAfter.title, 'B')
  assert.deepEqual(aAfterMembership(delegate, a.id), ['session-1'])
  const removed = delegate.get(extra.id)
  assert.equal(removed, undefined, 'workspaces registered after capture are removed')
  assert.equal(delegate.get(a.id).title, 'A')
})

function aAfterMembership(delegate, id) {
  return delegate.get(id).sessionIds
}

test('snapshot: apply is fail-closed — deleted identities are never recreated', async () => {
  const { delegate } = harness()
  await delegate.create('/tmp/ws-a', 'A')
  await delegate.create('/tmp/ws-b', 'B')
  const captured = await delegate.snapshot.capture({})
  const state = (await delegate.snapshot.get(captured.anchor.snapshotId)).state
  // A snapshot referencing a workspace identity that no longer exists: the
  // identity is never recreated; the records component is typed partial.
  const stateWithDeleted = {
    ...state,
    workspaceIds: [...state.workspaceIds, 'workspace-ghost'],
    records: { ...state.records, 'workspace-ghost': { path: '/tmp/ghost', title: 'Ghost', sessionIds: [], createdAt: 't', updatedAt: 't' } },
  }
  const applied = await delegate.snapshot.apply({ state: stateWithDeleted, fence: { fencingToken: 'fence-1', generation: 'g-1' } })
  assert.equal(applied.ok, true)
  assert.equal(applied.code, 'partial')
  const recordsComponent = applied.components.find((component) => component.name === 'records')
  assert.equal(recordsComponent.status, 'partial')
  assert.match(recordsComponent.detail, /not recreated/)
  assert.equal(delegate.get('workspace-ghost'), undefined, 'identity is never invented')
})

test('snapshot: unarchive unavailability is an honest partial component', async () => {
  const { official, delegate } = harness()
  await delegate.create('/tmp/ws-a', 'A')
  const captured = await delegate.snapshot.capture({})
  const state = (await delegate.snapshot.get(captured.anchor.snapshotId)).state
  // Archive a session AFTER the capture: the snapshot archive set is empty
  // while the current set is not — the official API cannot unarchive, so the
  // archived component is typed partial with the concrete extra ids.
  official.liveSessions.push('session-post')
  await delegate.archiveSession('session-post')
  const applied = await delegate.snapshot.apply({ state, fence: { fencingToken: 'fence-1', generation: 'g-1' } })
  assert.equal(applied.code, 'partial')
  const archivedComponent = applied.components.find((component) => component.name === 'archived')
  assert.equal(archivedComponent.status, 'partial')
  assert.match(archivedComponent.detail, /unarchive is unavailable/)
})

test('snapshot: invalid state shapes are rejected before any mutation', async () => {
  const { delegate } = harness()
  const bad = await delegate.snapshot.apply({ state: { workspaceIds: 'nope' }, fence: { fencingToken: 'f' } })
  assert.equal(bad.ok, false)
  assert.equal(bad.code, 'invalid-input')
})