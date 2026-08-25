import test from 'node:test'
import assert from 'node:assert/strict'
import {
  boundedString,
  buildAvailability,
  cloneBoundedPublic,
  DEFAULT_LEASE_MS,
  MAX_LEASE_MS,
  normalizeExpectedProof,
  normalizeExpectedVersion,
  normalizeHandle,
  normalizeLeaseMs,
  normalizeOwnerId,
  normalizeProvenance,
  normalizeResource,
  redactLeaseRecord,
  resourceKey,
} from '../lib/coordination-normalize.js'

test('normalizeResource accepts valid scoped resources and canonical keys', () => {
  const resource = normalizeResource({ scope: 'workspace', key: 'build-cache', label: 'Build cache' })
  assert.equal(resource.ok, true)
  assert.equal(resource.value.scope, 'workspace')
  assert.equal(resource.value.key, 'build-cache')
  assert.equal(resource.value.label, 'Build cache')
  assert.ok(Object.isFrozen(resource.value))
})

test('normalizeResource rejects missing/invalid scope and key', () => {
  assert.equal(normalizeResource({ scope: 'galaxy', key: 'x' }).ok, false)
  assert.equal(normalizeResource({ scope: 'workspace', key: '' }).ok, false)
  assert.equal(normalizeResource({ scope: 'workspace', key: '   ' }).ok, false)
  assert.equal(normalizeResource(null).ok, false)
  assert.equal(normalizeResource({ scope: 'workspace' }).ok, false)
})

test('resources are distinct by scope and canonical key even when labels match', () => {
  const a = normalizeResource({ scope: 'session', key: 'k', label: 'same label' }).value
  const b = normalizeResource({ scope: 'workspace', key: 'k', label: 'same label' }).value
  const c = normalizeResource({ scope: 'session', key: 'other', label: 'same label' }).value
  assert.notEqual(resourceKey(a), resourceKey(b))
  assert.notEqual(resourceKey(a), resourceKey(c))
  assert.equal(resourceKey(a), resourceKey(a))
})

test('identity fields are bounded and trimmed', () => {
  const resource = normalizeResource({ scope: 'profile', key: '  padded-key  ' }).value
  assert.equal(resource.key, 'padded-key')
  assert.equal(resource.label, undefined)
  const huge = normalizeResource({ scope: 'workspace', key: 'k'.repeat(500), label: 'l'.repeat(500) }).value
  assert.equal(huge.key.length, 120)
  assert.equal(huge.label.length, 160)
})

test('provenance is normalized, bounded, and certainty-defaulted', () => {
  const resource = normalizeResource({
    scope: 'workspace',
    key: 'k',
    provenance: [
      { kind: 'execution', id: 'e-1', certainty: 'observed' },
      { kind: 'task', id: 't-1' },
      { kind: 'session', id: 's-1', certainty: 'stale' },
      { kind: 'workspace', id: 'w-1', certainty: 'unknown' },
      null,
      { kind: 'no-id' },
    ],
  })
  assert.equal(resource.ok, true)
  const provenance = resource.value.provenance
  assert.equal(provenance.length, 4)
  assert.equal(provenance[1].certainty, 'observed')
  assert.equal(provenance[3].certainty, 'unknown')
})

test('normalizeOwnerId rejects empty and accepts bounded identities', () => {
  assert.equal(normalizeOwnerId('owner-a').value, 'owner-a')
  assert.equal(normalizeOwnerId('').ok, false)
  assert.equal(normalizeOwnerId(undefined).ok, false)
  assert.equal(normalizeOwnerId('   ').ok, false)
})

test('normalizeLeaseMs rejects invalid, negative, zero, and unbounded durations', () => {
  assert.ok(normalizeLeaseMs(5000).ok)
  assert.equal(normalizeLeaseMs(0).ok, false)
  assert.equal(normalizeLeaseMs(-1).ok, false)
  assert.equal(normalizeLeaseMs(Number.POSITIVE_INFINITY).ok, false)
  assert.equal(normalizeLeaseMs(Number.NaN).ok, false)
  assert.equal(normalizeLeaseMs('5000').ok, false)
  assert.equal(normalizeLeaseMs(MAX_LEASE_MS + 1).ok, false)
  assert.equal(normalizeLeaseMs(MAX_LEASE_MS).ok, true)
  assert.equal(normalizeLeaseMs(undefined, { allowUndefined: true }).ok, true)
  assert.equal(normalizeLeaseMs(undefined, { allowUndefined: true }).value, undefined)
  assert.ok(DEFAULT_LEASE_MS > 0)
})

test('normalizeExpectedProof requires exactly one staleness proof', () => {
  assert.equal(normalizeExpectedProof({ generation: 'gen:1' }).value.kind, 'generation')
  assert.equal(normalizeExpectedProof({ expiresAt: '2026-01-01T00:00:00.000Z' }).value.kind, 'expiresAt')
  assert.equal(normalizeExpectedProof({ proof: { token: 'p-1', seq: 3 } }).value.kind, 'proof')
  assert.equal(normalizeExpectedProof({}).ok, false)
  assert.equal(normalizeExpectedProof({ generation: 'gen:1', expiresAt: '2026-01-01T00:00:00.000Z' }).ok, false)
  assert.equal(normalizeExpectedProof({ generation: '' }).ok, false)
  assert.equal(normalizeExpectedProof({ expiresAt: 'not-a-date' }).ok, false)
  assert.equal(normalizeExpectedProof({ proof: {} }).ok, false)
  assert.equal(normalizeExpectedProof(null).ok, false)
})

test('normalizeHandle validates the exact identity fields of an acquisition handle', () => {
  const resource = normalizeResource({ scope: 'workspace', key: 'k' }).value
  const handle = normalizeHandle({
    resource,
    ownerId: 'owner',
    generation: 'gen:1',
    fencingToken: 'token-1',
    expiresAt: '2026-01-02T00:00:00.000Z',
  })
  assert.equal(handle.ok, true)
  assert.ok(Object.isFrozen(handle.value))
  assert.equal(normalizeHandle({}).ok, false)
  assert.equal(normalizeHandle({ ...handle.value, fencingToken: '' }).ok, false)
  assert.equal(normalizeHandle({ ...handle.value, expiresAt: 'bad' }).ok, false)
})

test('normalizeExpectedVersion requires a non-negative integer', () => {
  assert.equal(normalizeExpectedVersion(0).ok, true)
  assert.equal(normalizeExpectedVersion(3).ok, true)
  assert.equal(normalizeExpectedVersion(-1).ok, false)
  assert.equal(normalizeExpectedVersion(1.5).ok, false)
  assert.equal(normalizeExpectedVersion(Number.NaN).ok, false)
})

test('cloneBoundedPublic bounds content and drops secret-like keys', () => {
  const cloned = cloneBoundedPublic({
    name: 'record',
    credentials: { password: 'hunter2' },
    nested: { keep: 'yes', deeper: { deepest: { value: 1 } } },
    tooDeep: { l1: { l2: { l3: { l4: { l5: { l6: 'beyond the cap' } } } } } },
    list: [1, 2, 3],
    secretToken: 'abc',
    when: new Date('2026-01-01T00:00:00.000Z'),
    hostile: {
      get key() { throw new Error('boom') },
    },
  })
  assert.equal(cloned.name, 'record')
  assert.equal(cloned.credentials, undefined)
  assert.equal(cloned.secretToken, undefined)
  assert.deepEqual(cloned.hostile, {}) // hostile getter yields an empty bounded shell, never throws
  assert.equal(cloned.list.length, 3)
  assert.equal(cloned.when, '2026-01-01T00:00:00.000Z')
  assert.equal(cloned.nested.keep, 'yes')
  assert.equal(cloned.nested.deeper.deepest.value, 1)
  assert.equal(cloned.tooDeep.l1.l2.l3.l4.l5, undefined) // depth cap drops deeper content
  assert.equal(typeof cloned.tooDeep.l1.l2.l3.l4, 'object') // bounded shell remains
  assert.ok(Object.isFrozen(cloned))
})

test('buildAvailability projects truthful capability with safe defaults', () => {
  const projection = buildAvailability({
    status: 'available',
    scope: 'process',
    durability: 'memory',
    operations: { acquire: 'available', heartbeat: 'available', release: 'available', takeover: 'available', compareAndSet: 'available', watch: 'available' },
    backend: { id: 'memory' },
    epoch: 'epoch:1',
  })
  assert.equal(projection.status, 'available')
  assert.equal(projection.durability, 'memory')
  assert.equal(projection.operations.takeover, 'available')
  assert.equal(projection.epoch, 'epoch:1')
  const degraded = buildAvailability({ operations: { acquire: 'weird' }, backend: {} })
  assert.equal(degraded.operations.acquire, 'unknown')
  assert.equal(degraded.status, 'unknown')
  assert.equal(degraded.backend.id, 'unknown')
  assert.ok(Object.isFrozen(projection))
})

test('redactLeaseRecord omits fencing tokens and private contents', () => {
  const record = {
    resource: normalizeResource({ scope: 'workspace', key: 'k' }).value,
    ownerId: 'owner',
    generation: 'gen:1',
    fencingToken: 'secret-token',
    expiresAt: '2026-01-02T00:00:00.000Z',
    state: 'active',
    version: 2,
    value: { content: 'private', credentials: { password: 'x' } },
    backend: { id: 'memory', scope: 'process', durability: 'memory', status: 'available' },
    provenance: [{ kind: 'execution', id: 'e-1', certainty: 'observed' }],
  }
  const projection = redactLeaseRecord(record)
  assert.equal(projection.fencingToken, undefined)
  assert.equal(projection.value, undefined)
  assert.equal(projection.credentials, undefined)
  assert.equal(projection.generation, 'gen:1')
  assert.equal(projection.state, 'active')
  assert.equal(projection.version, 2)
  assert.equal(projection.provenance[0].id, 'e-1')
  assert.ok(Object.isFrozen(projection))
})

test('boundedString trims and bounds values', () => {
  assert.equal(boundedString('  hello  '), 'hello')
  assert.equal(boundedString('x'.repeat(300)).length, 160)
  assert.equal(boundedString(undefined), undefined)
  assert.equal(boundedString(null), undefined)
  assert.equal(boundedString(42), '42')
})