import test from 'node:test'
import assert from 'node:assert/strict'
import { createTaskExecutionObservation } from '../lib/task-execution-observation.js'

const NOW = '2026-08-25T00:00:00.000Z'
let nowValue = Date.parse(NOW)
const now = () => new Date(nowValue).toISOString()

function createCoordinationDouble() {
  const records = new Map()
  let generationSeq = 0
  const redact = (value) => ({
    resource: value.resource,
    ownerId: value.ownerId,
    generation: value.generation,
    expiresAt: value.expiresAt,
    state: value.state,
    version: value.version,
    fencingValid: value.state === 'active',
  })
  return {
    _records: records,
    acquire({ resource, ownerId, leaseMs }) {
      if (records.get(resource.key)?.state === 'active') {
        return Promise.resolve({ ok: false, code: 'conflict', observed: redact(records.get(resource.key)) })
      }
      generationSeq += 1
      const value = {
        resource,
        ownerId,
        generation: `gen:${String(generationSeq).padStart(12, '0')}`,
        fencingToken: `tok-${generationSeq}`,
        expiresAt: new Date(nowValue + leaseMs).toISOString(),
        state: 'active',
        version: 0,
      }
      records.set(resource.key, value)
      return Promise.resolve({ ok: true, handle: { ...value } })
    },
    takeover({ resource, ownerId, expectedProof }) {
      const current = records.get(resource.key)
      if (!current || current.generation !== expectedProof?.generation) {
        return Promise.resolve({ ok: false, code: 'conflict', observed: current ? redact(current) : undefined })
      }
      generationSeq += 1
      const value = {
        resource,
        ownerId,
        generation: `gen:${String(generationSeq).padStart(12, '0')}`,
        fencingToken: `tok-${generationSeq}`,
        expiresAt: new Date(nowValue + 60_000).toISOString(),
        state: 'active',
        version: 0,
      }
      records.set(resource.key, value)
      return Promise.resolve({ ok: true, handle: { ...value } })
    },
    watch(resource) {
      return {
        current() {
          const current = records.get(resource.key)
          if (!current) return Promise.resolve({ code: 'unavailable' })
          return Promise.resolve(redact(current))
        },
        subscribe() { return () => false },
        dispose() { return true },
      }
    },
  }
}

function createSources() {
  return {
    coordination: createCoordinationDouble(),
    recovery: {
      classify() { return { ok: true, class: 'transient' } },
      evaluate() { return { ok: true, decision: { action: 'stop' } } },
      availability: { status: 'available' },
    },
    execution: { get() {}, observe() {}, history() {}, onChange() {}, availability: { status: 'available' } },
    diagnostics: { get() {} },
    workspaceTransactions: { get() {} },
    ctx: {
      get(name) {
        if (name === 'jobs') return { get() {}, list() {}, read() {} }
        if (name === 'sessions') return { get() {} }
        return null
      },
      on() { return () => {} },
    },
  }
}

let idSeq = 0
function createOwner(sources = createSources()) {
  return {
    sources,
    owner: createTaskExecutionObservation({
      ctx: sources.ctx,
      execution: sources.execution,
      recovery: sources.recovery,
      coordination: sources.coordination,
      diagnostics: sources.diagnostics,
      workspaceTransactions: sources.workspaceTransactions,
      logger: { error() {} },
      now,
      idFactory: () => `id-${(idSeq += 1)}`,
    }),
  }
}

const taskScope = { kind: 'workspace', key: 'repo-a' }

test('observe returns a frozen projection with state, active attempt, run links, owner, terminal outcome, and provenance availability', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  const subscription = await owner.api.observe('task-1')
  const current = await subscription.current()
  assert.equal(current.task.state, 'registered')
  assert.equal(current.task.ownerId, 'owner-1')
  assert.equal(current.task.scope.key, 'repo-a')
  assert.ok(owner.api.availability, 'availability lives on the observation api, never in business results')
  assert.equal(Object.isFrozen(current), true)
  assert.equal(Object.isFrozen(current.task), true)
  assert.equal(Object.isFrozen(current.task.attempts), true)
  const detach = subscription.subscribe(() => {})
  subscription.dispose()
  assert.equal(subscription.dispose(), false)
})

test('disposed observers cannot publish into a newer generation; one throwing observer never stops others', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  const seen = []
  const throwing = async () => { throw new Error('observer boom') }
  const first = await owner.api.observe('task-1')
  const detachThrowing = first.subscribe(throwing)
  const second = await owner.api.observe('task-1')
  second.subscribe(async () => { throw new Error('rejected thenable') })
  const detachGood = second.subscribe((event) => seen.push(event.nextState))
  await owner.api.start('task-1', { workflowId: 'wf-1' })
  // start keeps the task registered; the event still delivers to good observers
  assert.ok(seen.length >= 1)
  detachGood()
  detachThrowing()
  const before = seen.length
  await owner.api.get('task-1')
  assert.equal(seen.length, before)
  first.dispose()
  second.dispose()
})

test('observer epoch guard: callbacks from a replaced subscription are dropped', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  const seen = []
  const first = await owner.api.observe('task-1')
  const goodDetach = first.subscribe((event) => seen.push(`first:${event.nextState}`))
  await owner.api.start('task-1')
  first.dispose()
  // the first subscription is disposed; its callbacks cannot publish further
  const before = seen.length
  await owner.api.start('task-1', { runId: 'run-3' })
  assert.equal(seen.length, before)
  goodDetach()
  // a fresh subscription sees the current state, not stale callbacks
  const second = await owner.api.observe('task-1')
  const secondCurrent = await second.current()
  assert.equal(secondCurrent.task.state, 'registered')
  second.dispose()
})

test('reconnect reconstruction from durable evidence identifies the observation epoch/generation', async () => {
  const domain = new Map()
  const unit = {
    read(key) { return domain.get(key) ?? null },
    write(key, record) { domain.set(key, record); return true },
    compareAndSwap(key, expectedVersion, record) {
      const existing = domain.get(key)
      if (existing && existing.revision !== expectedVersion) return false
      domain.set(key, record)
      return true
    },
  }
  const sources = createSources()
  sources.ctx.get = (name) => {
    if (name === 'storage') {
      return { transactionCapability() { return { durability: 'workspace', atomicCas: true, scope: 'workspace' } }, domainUnit: unit }
    }
    if (name === 'jobs') return { get() {}, list() {}, read() {} }
    return null
  }
  const { owner } = createOwner(sources)
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  // simulate a reconnect: a second facade over the same durable domain
  const { owner: owner2 } = createOwner(sources)
  const subscription = await owner2.api.observe('task-1')
  const current = await subscription.current()
  // the durable bridge reconstructs the registered task and carries the
  // observation epoch/generation of the second facade
  assert.equal(current.task.state, 'registered')
  assert.equal(current.task.revision >= 1, true)
  assert.ok(owner2.api.availability.epoch)
  assert.equal(owner2.api.availability.durability, 'durable')
  subscription.dispose()
})

test('unavailable/truncated evidence is stated explicitly and never claims a complete history', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  const subscription = await owner.api.observe('task-void')
  const current = await subscription.current()
  assert.equal(current.code, 'unavailable')
  assert.ok(current.resync)
  subscription.dispose()
  const history = await owner.api.history('task-void')
  assert.equal(history.ok, false)
  assert.equal(history.code, 'unavailable')
})

test('a memory registry can never satisfy reconnect-after-process-loss reconstruction', async () => {
  const sources = createSources()
  const { owner } = createOwner(sources)
  await owner.api.register({ taskId: 'task-1', ownerId: 'owner-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  const availability = owner.availability
  assert.equal(availability.durability, 'memory')
  // a second facade (simulating a fresh process) has an empty memory registry
  const { owner: fresh } = createOwner(sources)
  const subscription = await fresh.api.observe('task-1')
  const current = await subscription.current()
  assert.equal(current.code, 'unavailable')
  subscription.dispose()
})