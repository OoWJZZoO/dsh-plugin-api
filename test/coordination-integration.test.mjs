import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCoordinationLease } from '../lib/coordination-lease.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const START_MS = Date.parse('2026-01-01T00:00:00.000Z')

function createOwner() {
  let current = START_MS
  const now = () => new Date(current)
  const ctx = { get: () => undefined }
  const owner = createCoordinationLease({ ctx, logger: { error() {} }, now })
  return { owner, advance: (ms) => { current += ms } }
}

const resource = { scope: 'workspace', key: 'shared-resource' }

test('sibling features can consume the coordination face for fenced attempts (consumer-shaped flow)', async () => {
  const { owner, advance } = createOwner()
  // a task/workspace consumer acquires a fenced lease for its attempt
  const acquired = await owner.api.acquire({
    resource,
    ownerId: 'task-owner',
    leaseMs: 60_000,
    provenance: [
      { kind: 'task', id: 'task-1', certainty: 'observed' },
      { kind: 'execution', id: 'exec-9', certainty: 'observed' },
    ],
  })
  assert.equal(acquired.ok, true)
  // identity is preserved as provenance, never minted
  const ids = acquired.handle.provenance.map((entry) => entry.id)
  assert.ok(ids.includes('task-1'))
  assert.ok(ids.includes('exec-9'))
  // the consumer heartbeats while working and writes under the fencing token
  advance(10_000)
  const beat = await owner.api.heartbeat(acquired.handle, { leaseMs: 60_000 })
  assert.equal(beat.ok, true)
  const cas = await owner.api.compareAndSet({ resource, handle: acquired.handle, expectedVersion: 0, value: { step: 'done' } })
  assert.equal(cas.ok, true)
  // a stale attempt cannot settle a newer owner's record
  advance(61_000)
  const taken = await owner.api.takeover({
    resource,
    ownerId: 'coordinator',
    leaseMs: 60_000,
    expectedProof: { generation: acquired.handle.generation },
    reason: 'reassign',
  })
  assert.equal(taken.ok, true)
  const staleWrite = await owner.api.compareAndSet({ resource, handle: acquired.handle, expectedVersion: 1, value: { step: 'late' } })
  assert.equal(staleWrite.ok, false)
  assert.equal(staleWrite.code, 'conflict', 'a stale public write is conflict')
})

test('the memory adapter never satisfies a cross-process durability assertion', async () => {
  const { owner } = createOwner()
  const availability = await owner.api.availability()
  assert.equal(availability.durability, 'memory')
  assert.equal(availability.scope, 'process')
  assert.equal(availability.status, 'available')
  const workspace = await owner.api.availability('workspace')
  assert.equal(workspace.status, 'unsupported')
  const session = await owner.api.availability('session')
  assert.equal(session.status, 'unsupported')
})

test('the coordination face exposes exactly the host mutation surface and no scheduler vocabulary', async () => {
  const { owner } = createOwner()
  const methodNames = Object.keys(owner.api).sort()
  assert.deepEqual(methodNames, ['acquire', 'availability', 'compareAndSet', 'heartbeat', 'release', 'takeover', 'watch'])
  // no scheduler / queue / retry / route / approval / billing vocabulary
  const serialized = JSON.stringify(Object.keys(owner.api))
  for (const forbidden of ['schedule', 'queue', 'retry', 'route', 'approval', 'billing', 'provider']) {
    assert.equal(serialized.includes(forbidden), false)
  }
})

test('coordination implementation has no private official imports, R paths, or governance tokens', () => {
  for (const file of ['lib/coordination-normalize.js', 'lib/coordination-adapters.js', 'lib/coordination-lease.js']) {
    const source = readFileSync(resolve(root, file), 'utf8')
    assert.doesNotMatch(source, /@deepseek-ai\/dsh|\/usr\/lib\/node_modules\/@deepseek-ai\/dsh/)
    // neutral runtime naming only: no governance feature-name leakage
    assert.doesNotMatch(source, /coordination-lease|workspace-mutation|task-execution-observation|SPEC\d|ANY/)
  }
  const diffPaths = execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' })
  assert.doesNotMatch(diffPaths, /@deepseek-ai[\\/]dsh/)
})

test('no new events catalog slice is contributed by the coordination feature', async () => {
  const { owner } = createOwner()
  // the facade has no events registration face and the feature never mounts
  // a listener; consumers drive it through explicit method calls only
  assert.equal(typeof owner.api.events, 'undefined')
  assert.equal(typeof owner.api.catalog, 'undefined')
})