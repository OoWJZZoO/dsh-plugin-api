import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCoordinationLease } from '../lib/coordination-lease.js'
import { redactLeaseRecord } from '../lib/coordination-normalize.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const START_MS = Date.parse('2026-01-01T00:00:00.000Z')

function createOwner() {
  let current = START_MS
  const now = () => new Date(current)
  const ctx = { get: () => undefined }
  return { owner: createCoordinationLease({ ctx, logger: { error() {} }, now }), advance: (ms) => { current += ms } }
}

const resource = { scope: 'workspace', key: 'visible-resource' }

test('watch events and current() projections never expose fencing tokens or private contents', async () => {
  const { owner, advance } = createOwner()
  const acquired = await owner.api.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  await owner.api.compareAndSet({ resource, handle: acquired.handle, expectedVersion: 0, value: { content: 'private', credentials: { password: 'hunter2' }, publicField: 'ok' } })
  const subscription = await owner.api.watch(resource)
  const events = []
  subscription.subscribe((event) => events.push(event))
  advance(61_000)
  const reacquired = await owner.api.acquire({ resource, ownerId: 'owner-2', leaseMs: 60_000 })
  await settle(events)
  assert.equal(events.length, 1)
  const event = events[0]
  assert.equal(event.fencingToken, undefined)
  assert.equal(event.fencingValid, true)
  assert.equal(event.current.fencingToken, undefined)
  assert.equal(event.current.value, undefined)
  // the record value contents never appear in observations
  assert.equal(JSON.stringify(event).includes('hunter2'), false)
  assert.equal(JSON.stringify(event).includes('private'), false)
  assert.equal(event.current.publicField, undefined)
  const current = await subscription.current()
  assert.equal(current.fencingToken, undefined)
  assert.equal(current.ownerId, 'owner-2')
  // the acquired handle still carries the fencing token for its holder
  assert.ok(acquired.handle.fencingToken)
  assert.ok(reacquired.handle.fencingToken)
})

test('conflict provenance never leaks owner identity, secrets, or value contents', async () => {
  const { owner } = createOwner()
  const first = await owner.api.acquire({ resource, ownerId: 'private-owner', leaseMs: 60_000 })
  await owner.api.compareAndSet({ resource, handle: first.handle, expectedVersion: 0, value: { credentials: { token: 'secret-xyz' } } })
  const conflict = await owner.api.acquire({ resource, ownerId: 'intruder', leaseMs: 60_000 })
  assert.equal(conflict.code, 'conflict')
  assert.equal(conflict.ok, false)
  assert.equal(conflict.observed.generation, first.handle.generation)
  assert.equal(conflict.observed.version, 1)
  assert.equal(conflict.observed.ownerId, undefined)
  assert.equal(conflict.observed.value, undefined)
  assert.equal(JSON.stringify(conflict).includes('secret-xyz'), false)
  assert.equal(JSON.stringify(conflict).includes('private-owner'), false)
})

test('invalid resource requests are rejected without revealing private resource existence', async () => {
  const { owner } = createOwner()
  const invalidScope = await owner.api.acquire({ resource: { scope: 'hidden', key: 'k' }, ownerId: 'owner', leaseMs: 1_000 })
  assert.equal(invalidScope.code, 'invalid-input')
  const missingKey = await owner.api.acquire({ resource: { scope: 'workspace', key: '' }, ownerId: 'owner', leaseMs: 1_000 })
  assert.equal(missingKey.code, 'invalid-input')
  const watch = await owner.api.watch({ scope: 'other', key: 'k' })
  assert.equal(watch.code, 'invalid-input')
})

test('redactLeaseRecord fails closed and never returns partial protected data', () => {
  const hostile = {
    get resource() { throw new Error('boom') },
    get ownerId() { throw new Error('boom') },
    get fencingToken() { return 'leak' },
    get state() { return 'active' },
    get provenance() { throw new Error('boom') },
  }
  const projection = redactLeaseRecord(hostile)
  // even a hostile record yields a bounded projection without the token
  assert.equal(projection.fencingToken, undefined)
  assert.ok(Object.isFrozen(projection))
  assert.equal(projection.state, 'active')
})

test('all observed projections are deeply immutable', async () => {
  const { owner } = createOwner()
  const acquired = await owner.api.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  const subscription = await owner.api.watch(resource)
  const current = await subscription.current()
  assert.ok(Object.isFrozen(current))
  assert.ok(Object.isFrozen(current.resource))
  assert.ok(Object.isFrozen(acquired.handle))
  assert.throws(() => { current.state = 'mutated' }, TypeError)
  assert.throws(() => { acquired.handle.ownerId = 'mutated' }, TypeError)
})

test('the feature adds no client mutation surface or client manifest entries', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const inject = manifest.dsh?.client?.inject ?? []
  assert.equal(inject.some((entry) => String(entry).includes('coordination')), false)
  // no client-* coordination module exists in the implementation tree
  for (const path of ['lib/client-coordination.js', 'lib/coordination-client.js']) {
    try {
      readFileSync(join(root, path), 'utf8')
      assert.fail(`unexpected client coordination module: ${path}`)
    } catch (error) {
      assert.equal(error.code, 'ENOENT')
    }
  }
})

async function settle(queue) {
  await new Promise((resolve) => setImmediate(resolve))
  return queue
}