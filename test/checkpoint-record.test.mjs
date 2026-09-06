import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCheckpointRecord,
  validateStoredRecord,
  redactRecord,
  CAPTURE_STATUSES,
  CHECKPOINT_SCHEMAS,
  RECORD_VERSION,
} from '../lib/checkpoint-record.js'
import { createTestStore, createMemoryFacility, createIdFactory } from './checkpoint-test-kit.mjs'

const baseInput = () => ({
  checkpointId: 'cp-1',
  scopeKind: 'session',
  scopeId: 'session-1',
  source: { kind: 'branch', anchor: { branchId: 'branch-1', sessionId: 'session-1' } },
  capture: { overall: 'captured', components: [{ name: 'branch', status: 'captured' }] },
  provenance: { owner: 'plugin-a', reason: 'rescue point', createdAt: '2026-01-01T00:00:00.000Z' },
  restoreability: { summary: 'captured' },
  externalEffects: [{ name: 'git push', kind: 'external' }],
  lineage: { previousCheckpointId: 'cp-0', captureKey: 'key-1' },
})

test('record envelope: valid record builds frozen with single scope and vocabulary', () => {
  const built = buildCheckpointRecord(baseInput())
  assert.equal(built.ok, true)
  const record = built.record
  assert.ok(Object.isFrozen(record))
  assert.equal(record.schema, CHECKPOINT_SCHEMAS.session)
  assert.equal(record.version, RECORD_VERSION)
  assert.equal(record.owner, 'plugin-a')
  assert.deepEqual(record.scope, { session: 'session-1' })
  assert.equal(record.id, 'cp-1')
  assert.equal(record.data.capture.overall, 'captured')
  assert.deepEqual(record.data.lineage, { previousCheckpointId: 'cp-0', captureKey: 'key-1' })
  assert.ok(Object.isFrozen(record.data))
  assert.ok(Object.isFrozen(record.data.capture.components[0]))
})

test('record envelope: rejects unknown scope kinds and unknown capture statuses', () => {
  const badScope = buildCheckpointRecord({ ...baseInput(), scopeKind: 'galaxy' })
  assert.equal(badScope.ok, false)
  const badStatus = buildCheckpointRecord({ ...baseInput(), capture: { overall: 'captured-everything' } })
  assert.equal(badStatus.ok, false)
  const badSource = buildCheckpointRecord({ ...baseInput(), source: { kind: 'time-machine' } })
  assert.equal(badSource.ok, false)
})

test('stored record: unknown schema or version reads as unsupported-schema, never guessed', () => {
  const stored = buildCheckpointRecord(baseInput()).record
  const futureSchema = validateStoredRecord({ ...stored, schema: 'future.schema.v9' })
  assert.equal(futureSchema.ok, false)
  assert.equal(futureSchema.code, 'unsupported-schema')
  const futureVersion = validateStoredRecord({ ...stored, version: 99 })
  assert.equal(futureVersion.code, 'unsupported-schema')
  const fine = validateStoredRecord(stored)
  assert.equal(fine.ok, true)
  assert.deepEqual(fine.record, stored)
})

test('record envelope: profile scope is a valid declared scope, capture authorities gate it', () => {
  const built = buildCheckpointRecord({ ...baseInput(), scopeKind: 'profile', scopeId: 'profile-1' })
  assert.equal(built.ok, true)
  assert.deepEqual(built.record.scope, { profile: 'profile-1' })
})

test('store: append-only write-once keys and typed absence', async () => {
  const store = createTestStore()
  const record = buildCheckpointRecord(baseInput()).record
  const written = await store.put(record)
  assert.equal(written.ok, true)
  const duplicate = await store.put(record)
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.code, 'conflict')
  const missing = await store.get('cp-nope')
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'missing')
  const found = await store.get('cp-1')
  assert.equal(found.ok, true)
  assert.deepEqual(found.record, record)
})

test('store: list orders deterministically, filters single scope, pages by cursor', async () => {
  const store = createTestStore()
  const ids = createIdFactory('cp')
  for (const [scopeKind, scopeId] of [['session', 'session-1'], ['session', 'session-1'], ['workspace', 'workspace-1']]) {
    const built = buildCheckpointRecord({
      ...baseInput(),
      checkpointId: ids(),
      scopeKind,
      scopeId,
      source: { kind: scopeKind === 'session' ? 'branch' : 'workspace-journal', anchor: { id: scopeId } },
    })
    await store.put(built.record)
  }
  const all = await store.list({})
  assert.equal(all.items.length, 3)
  const sessionOnly = await store.list({ scopeKind: 'session' })
  assert.equal(sessionOnly.items.length, 2)
  for (const item of sessionOnly.items) assert.deepEqual(Object.keys(item.scope), ['session'])
  const filtered = await store.list({ scopeKind: 'workspace' })
  assert.equal(filtered.items.length, 1)
  assert.equal(filtered.items[0].scope.workspace, 'workspace-1')
  const firstPage = await store.list({ limit: 2 })
  assert.equal(firstPage.items.length, 2)
  assert.ok(firstPage.cursor)
  const secondPage = await store.list({ cursor: firstPage.cursor, limit: 2 })
  assert.equal(secondPage.items.length, 1)
})

test('store: capture-key dedupe rows round-trip per owner and scope', async () => {
  const store = createTestStore()
  const reserved = await store.keyPut('plugin-a', 'key-1', 'session', { recordId: 'cp-1', phase: 'pending', createdAt: 't' })
  assert.equal(reserved.ok, true)
  const row = await store.keyGet('plugin-a', 'key-1', 'session')
  assert.equal(row.ok, true)
  assert.equal(row.row.recordId, 'cp-1')
  const otherOwner = await store.keyGet('plugin-b', 'key-1', 'session')
  assert.equal(otherOwner.ok, false)
  assert.equal(otherOwner.code, 'missing')
})

test('store: lastFor returns the previous record of the same scope resource (lineage)', async () => {
  const store = createTestStore()
  const built = buildCheckpointRecord({ ...baseInput(), checkpointId: 'cp-1' })
  await store.put(built.record)
  await store.put(buildCheckpointRecord({ ...baseInput(), checkpointId: 'cp-2' }).record)
  const last = await store.lastFor('session', 'session-1')
  assert.equal(last.id, 'cp-2')
  const unreferenced = await store.lastFor('workspace', 'workspace-9')
  assert.equal(unreferenced, undefined)
})

test('store: backend absence yields typed unavailable, never throws', async () => {
  const store = createTestStore({ facility: { open: async () => ({ ok: false, code: 'backend-unavailable', reason: 'no backend' }) } })
  const written = await store.put(buildCheckpointRecord(baseInput()).record)
  assert.equal(written.ok, false)
  assert.equal(written.code, 'unavailable')
  const read = await store.get('cp-1')
  assert.equal(read.ok, false)
  assert.equal(read.code, 'unavailable')
  assert.equal(store.availability('session').status, 'unavailable')
})

test('redaction: projection views strip free-form detail and keep statuses', () => {
  const built = buildCheckpointRecord({
    ...baseInput(),
    capture: { overall: 'partial', components: [{ name: 'branch', status: 'captured' }, { name: 'external-state', status: 'missing', detail: 'secret payload detail' }] },
    externalEffects: [{ name: 'git push', kind: 'external', detail: 'secret detail' }],
  })
  const redacted = redactRecord(built.record)
  assert.equal(redacted.data.capture.components.length, 2)
  assert.deepEqual(Object.keys(redacted.data.capture.components[1]), ['name', 'status'])
  assert.equal(redacted.data.externalEffects[0].detail, undefined)
  assert.equal(redacted.data.capture.components[0].status, 'captured')
  assert.ok(Object.isFrozen(redacted))
  assert.equal(CAPTURE_STATUSES.includes('partial'), true)
})

test('store: memory facility rejects double-open of the same unit (conflict)', async () => {
  const facility = createMemoryFacility()
  const store = createTestStore({ facility })
  const first = await store.open('session')
  assert.equal(first.ok, true)
  const second = await store.open('session')
  assert.equal(second.ok, true) // idempotent within the store
  const other = createTestStore({ facility })
  const third = await other.open('session')
  assert.equal(third.ok, false)
  assert.equal(third.code, 'conflict')
})