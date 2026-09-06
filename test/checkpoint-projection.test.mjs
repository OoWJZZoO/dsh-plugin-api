import test from 'node:test'
import assert from 'node:assert/strict'
import { createCheckpointProjection } from '../lib/checkpoint-projection.js'
import { createCaptureAuthority } from '../lib/checkpoint-capture.js'
import { createTestStore, createMemoryFacility, createIdFactory, stubOwnerOf, createBranchAuthorityFixture } from './checkpoint-test-kit.mjs'

async function seed(store, count = 2) {
  const branch = createBranchAuthorityFixture()
  const capture = createCaptureAuthority({
    store,
    authorities: { branch: branch.face },
    ownerOf: stubOwnerOf,
    idFactory: createIdFactory('cp'),
  })
  const ids = []
  for (let i = 0; i < count; i += 1) {
    const outcome = await capture.create({ scope: { sessionId: 'session-1' }, source: { kind: 'branch' }, reason: `point ${i}` }, { owner: 'plugin-a' })
    ids.push(outcome.summary.checkpointId)
  }
  return { ids, capture }
}

test('projection: list returns a frozen ordered page with cursor continuation', async () => {
  const store = createTestStore()
  const projection = createCheckpointProjection({ store })
  await seed(store, 3)
  const page = await projection.list({})
  assert.equal(page.ok, true)
  assert.equal(page.code, 'listed')
  assert.equal(page.items.length, 3)
  assert.ok(Object.isFrozen(page))
  const filtered = await projection.list({ scope: 'session', resourceId: 'session-1' })
  assert.equal(filtered.items.length, 3)
  const paged = await projection.list({ limit: 2 })
  assert.equal(paged.items.length, 2)
  assert.ok(paged.cursor)
  const next = await projection.list({ cursor: paged.cursor, limit: 2 })
  assert.equal(next.items.length, 1)
})

test('projection: inspect returns the full frozen record view', async () => {
  const store = createTestStore()
  const projection = createCheckpointProjection({ store })
  const { ids } = await seed(store, 1)
  const inspected = await projection.inspect(ids[0])
  assert.equal(inspected.ok, true)
  assert.equal(inspected.code, 'inspected')
  assert.equal(inspected.record.id, ids[0])
  assert.equal(inspected.record.data.capture.overall, 'captured')
  assert.equal(inspected.record.data.provenance.reason, 'point 0')
  assert.ok(Object.isFrozen(inspected.record))
})

test('projection: missing and invalid inputs return typed results, never throw', async () => {
  const store = createTestStore()
  const projection = createCheckpointProjection({ store })
  const missing = await projection.inspect('cp-nope')
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'missing')
  const invalid = await projection.inspect('')
  assert.equal(invalid.ok, false)
  assert.equal(invalid.code, 'invalid-input')
  const badScope = await projection.list({ scope: 'galaxy' })
  assert.equal(badScope.ok, false)
  assert.equal(badScope.code, 'invalid-input')
  const empty = await projection.list({ scope: 'profile' })
  assert.equal(empty.ok, true)
  assert.equal(empty.items.length, 0)
})

test('projection: unknown stored schema surfaces as unsupported-schema, never fabricated', async () => {
  const facility = createMemoryFacility()
  const store = createTestStore({ facility })
  const { ids } = await seed(store, 1)
  const future = { ...(await store.get(ids[0])).record, schema: 'future.schema.v9' }
  // Tamper the durable unit directly through the fixture domain handle.
  const domain = facility.domainOf('session__checkpoints__records')
  assert.ok(domain, 'fixture domain is open')
  await domain.table('records').put(ids[0], future)
  const projection = createCheckpointProjection({ store })
  const inspected = await projection.inspect(ids[0])
  assert.equal(inspected.ok, false)
  assert.equal(inspected.code, 'unsupported-schema')
})

test('projection: host-side redaction strips anchor free-form fields in list items', async () => {
  const store = createTestStore()
  const projection = createCheckpointProjection({ store })
  await seed(store, 1)
  const page = await projection.list({})
  for (const item of page.items) {
    assert.equal(item.data.source.anchor.detail, undefined)
    assert.ok(!('owner' in item.data))
  }
})

test('projection: a gone scope resource keeps the record inspectable and marks the scope unavailable', async () => {
  const store = createTestStore()
  const branch = createBranchAuthorityFixture()
  branch.addSession('session-1')
  const confirmScopeResource = async (record) => {
    const sessionId = record?.scope?.session
    if (!sessionId) return { status: 'unknown' }
    const known = await branch.face.sessionKnown(sessionId)
    return known ? { status: 'reachable' } : { status: 'unavailable', reason: `session '${sessionId}' no longer exists or is unreachable` }
  }
  const projection = createCheckpointProjection({ store, confirmScopeResource })
  const { ids } = await seed(store, 1)
  const before = await projection.inspect(ids[0])
  assert.equal(before.record.scope.resourceStatus, 'reachable')
  const storedBefore = await store.get(ids[0])
  branch.removeSession('session-1')
  const inspected = await projection.inspect(ids[0])
  assert.equal(inspected.ok, true)
  assert.equal(inspected.code, 'inspected')
  assert.equal(inspected.record.scope.resourceStatus, 'unavailable')
  assert.match(inspected.record.scope.resourceReason, /no longer exists or is unreachable/)
  // The record itself is never rewritten or deleted.
  const storedAfter = await store.get(ids[0])
  assert.equal(storedAfter.ok, true)
  assert.deepEqual(storedAfter.record.data, storedBefore.record.data)
  const page = await projection.list({ scope: 'session' })
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].scope.resourceStatus, 'unavailable')
})