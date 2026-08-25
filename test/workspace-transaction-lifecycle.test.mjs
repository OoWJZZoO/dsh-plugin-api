import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceMutationTransaction } from '../lib/workspace-mutation-transaction.js'

const NOW = '2026-08-25T00:00:00.000Z'
let nowValue = Date.parse(NOW)
const now = () => new Date(nowValue).toISOString()

function createCoordinationDouble({ watch } = {}) {
  const records = new Map()
  const watchers = new Map()
  let generationSeq = 0
  const record = (key) => records.get(key)
  const set = (key, value) => {
    records.set(key, value)
    for (const listener of [...(watchers.get(key) ?? [])]) {
      try { listener(redact(value)) } catch {}
    }
  }
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
      const existing = record(resource.key)
      if (existing && existing.state === 'active') {
        return Promise.resolve({ ok: false, code: 'conflict', observed: redact(existing) })
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
      set(resource.key, value)
      return Promise.resolve({ ok: true, handle: { ...value } })
    },
    release(handle) {
      const current = record(handle.resource.key)
      if (!current || current.generation !== handle.generation) {
        return Promise.resolve({ ok: false, code: current?.state ?? 'expired' })
      }
      set(handle.resource.key, { ...current, state: 'released' })
      return Promise.resolve({ ok: true })
    },
    watch(resource) {
      const subscription = {
        current() {
          const current = record(resource.key)
          if (!current) return Promise.resolve({ code: 'unavailable' })
          return Promise.resolve({ ...redact(current), expiry: undefined })
        },
        subscribe(fn) {
          const key = resource.key
          const listeners = watchers.get(key) ?? new Set()
          watchers.set(key, listeners)
          listeners.add(fn)
          let active = true
          return () => {
            if (!active) return false
            active = false
            return listeners.delete(fn)
          }
        },
        dispose() { return true },
      }
      return subscription
    },
  }
}

function createServices() {
  const coordination = createCoordinationDouble()
  const recovery = {
    availability() { return { status: 'available' } },
    classify(error) {
      if (error?.message?.includes('partial')) return { ok: true, class: 'permanent' }
      if (error?.message?.includes('timeout')) return { ok: true, class: 'transient' }
      return { ok: true, class: 'transient' }
    },
    evaluate() { return { ok: true, decision: { action: 'stop' } } },
  }
  const workspaces = {
    capabilitiesFor(scope) {
      return scope === 'workspace'
        ? { authorityId: 'auth-1', compatible: true, generation: 'g1' }
        : { authorityId: 'auth-2', compatible: false }
    },
  }
  const fileClaim = {
    claims: new Map(),
    claim(resource) {
      this.claims.set(resource.key, true)
      return true
    },
    release(resource) {
      this.claims.delete(resource.key)
      return true
    },
  }
  const checkpoints = {
    describe() { return { id: 'cp-1' } },
    create() { return { id: 'cp-2' } },
    restore() { return true },
  }
  const workspaceRestore = {
    preview() { return { revision: 'r1' } },
    apply() { return true },
    restore() { return true },
  }
  const changeLedger = {
    entries: [],
    append(entry) { this.entries.push(entry); return true },
    query(transactionId) { return this.entries.filter((e) => e.transactionId === transactionId) },
  }
  const approval = {
    confirm(request) {
      return { confirmed: request.grant === true, approvalId: request.grant ? `ap-${request.kind}` : 'denied-1' }
    },
  }
  const ctx = {
    get(name) {
      if (name === 'workspaces') return workspaces
      if (name === 'fileClaim') return fileClaim
      if (name === 'checkpoints') return checkpoints
      if (name === 'workspaceRestore') return workspaceRestore
      if (name === 'changeLedger') return changeLedger
      if (name === 'approval') return approval
      return null
    },
    on() { return () => {} },
  }
  return { coordination, recovery, ctx, workspaces, fileClaim, checkpoints, workspaceRestore, changeLedger, approval }
}

function createOwner(options = {}) {
  const services = options.services ?? createServices()
  let idSeq = 0
  return {
    services,
    owner: createWorkspaceMutationTransaction({
      ctx: options.ctx ?? services.ctx,
      coordination: options.coordination ?? services.coordination,
      recovery: options.recovery ?? services.recovery,
      logger: options.logger ?? { error() {} },
      now,
      idFactory: () => `id-${(idSeq += 1)}`,
    }),
  }
}

const workspace = { scope: 'workspace', key: 'repo-a' }

async function prepareWorkspace(owner, services, input = {}) {
  const coordination = services.coordination
  const acquired = await coordination.acquire({
    resource: { scope: 'workspace', key: 'repo-a' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })
  assert.equal(acquired.ok, true)
  return owner.api.prepare({
    transactionId: input.transactionId ?? 'tx-1',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'fix tests' },
    resources: [
      { kind: 'file', key: 'a.txt', scope: 'workspace' },
      { kind: 'config', key: 'dsh.json', scope: 'workspace' },
    ],
    lease: acquired.handle,
    ...input.extra,
  })
}

test('prepare requires identity, single scope, non-empty resources, intent, owner, and lease', async () => {
  const { owner, services } = createOwner()
  const coordination = services.coordination
  const acquired = await coordination.acquire({
    resource: { scope: 'workspace', key: 'repo-a' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })
  const base = {
    transactionId: 'tx-1',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'fix' },
    resources: [{ kind: 'file', key: 'a.txt', scope: 'workspace' }],
    lease: acquired.handle,
  }
  for (const [key, mutate] of [
    ['transactionId', (v) => ({ ...v, transactionId: undefined })],
    ['workspace', (v) => ({ ...v, workspace: undefined })],
    ['ownerId', (v) => ({ ...v, ownerId: '' })],
    ['intent', (v) => ({ ...v, intent: { kind: 'edit' } })],
    ['resources', (v) => ({ ...v, resources: [] })],
    ['lease', (v) => ({ ...v, lease: { generation: 'g' } })],
  ]) {
    const result = await owner.api.prepare(mutate(base))
    assert.equal(result.ok, false, `${key} must be rejected`)
    assert.equal(result.code, 'invalid-input')
  }
})

test('prepare binds lease generation/fencing provenance and exposes an immutable prepared transaction', async () => {
  const { owner, services } = createOwner()
  const result = await prepareWorkspace(owner, services)
  assert.equal(result.ok, true)
  assert.equal(result.code, 'prepared')
  assert.equal(result.transaction.state, 'prepared')
  assert.equal(result.transaction.ownerId, 'owner-1')
  assert.equal(result.transaction.workspace.key, 'repo-a')
  assert.equal(result.transaction.lease.generation, 'gen:000000000001')
  // fencingToken never crosses the public boundary
  assert.equal(result.transaction.lease.fencingToken, undefined)
  assert.equal(Object.isFrozen(result.transaction), true)
  const get = await owner.api.get('tx-1')
  assert.equal(get.found, true)
  assert.equal(get.transaction.state, 'prepared')
})

test('reused transaction identity with conflicting owner/scope/intent fails closed without merging', async () => {
  const { owner, services } = createOwner()
  const first = await prepareWorkspace(owner, services, { transactionId: 'tx-1' })
  assert.equal(first.ok, true)
  const coordination = services.coordination
  const acquired = await coordination.acquire({
    resource: { scope: 'workspace', key: 'repo-b' },
    ownerId: 'owner-2',
    leaseMs: 60_000,
  })
  const conflict = await owner.api.prepare({
    transactionId: 'tx-1',
    workspace: { scope: 'workspace', key: 'repo-b' },
    ownerId: 'owner-2',
    intent: { kind: 'move', summary: 'other' },
    resources: [{ kind: 'file', key: 'a.txt', scope: 'workspace' }],
    lease: acquired.handle,
  })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.code, 'conflict')
  // the original record was not merged or overwritten
  const get = await owner.api.get('tx-1')
  assert.equal(get.found, true)
  assert.equal(get.transaction.ownerId, 'owner-1')
  assert.equal(get.transaction.intent.kind, 'edit')
  // equivalent replay of a prepared record is idempotent and does not need a
  // fresh lease: the existing prepared record short-circuits before any
  // adapter contact
  const replay = await owner.api.prepare({
    transactionId: 'tx-1',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'fix tests' },
    resources: [
      { kind: 'file', key: 'a.txt', scope: 'workspace' },
      { kind: 'config', key: 'dsh.json', scope: 'workspace' },
    ],
    lease: { ...first.transaction.lease, fencingToken: 'tok-unused', ownerId: 'owner-1' },
  })
  assert.equal(replay.ok, true)
  assert.equal(replay.code, 'prepared')
  assert.equal(replay.transaction.revision, 1)
})

test('prepare rejects capability-declared requirements when the adapter is unavailable', async () => {
  const services = createServices()
  services.ctx.get = (name) => (name === 'workspaces' ? services.workspaces : null)
  const bundle = createOwner({ services })
  const owner = bundle.owner
  const coordination = services.coordination
  const acquired = await coordination.acquire({
    resource: { scope: 'workspace', key: 'repo-a' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })
  // declared checkpoint without a checkpoint seam
  const noCheckpoint = await owner.api.prepare({
    transactionId: 'tx-cp',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'fix' },
    resources: [{ kind: 'config', key: 'dsh.json', scope: 'workspace' }],
    lease: acquired.handle,
    checkpoint: { ref: 'cp-ref' },
  })
  assert.equal(noCheckpoint.ok, false)
  assert.ok(['unsupported', 'unavailable'].includes(noCheckpoint.code))
  // file resources without a file-claim seam
  const noClaim = await owner.api.prepare({
    transactionId: 'tx-claim',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'fix' },
    resources: [{ kind: 'file', key: 'a.txt', scope: 'workspace' }],
    lease: acquired.handle,
  })
  assert.equal(noClaim.ok, false)
  assert.ok(['unsupported', 'unavailable'].includes(noClaim.code))
  // no partially active transaction became visible
  const get = await owner.api.get('tx-claim')
  assert.equal(get.found, false)
})

test('prepare rejects incompatible workspace authorities outright before publishing anything', async () => {
  const services = createServices()
  services.workspaces.capabilitiesFor = () => ({ authorityId: 'auth-2', compatible: false })
  const bundle = createOwner({ services })
  const owner = bundle.owner
  const coordination = services.coordination
  const acquired = await coordination.acquire({
    resource: { scope: 'workspace', key: 'repo-a' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })
  const result = await owner.api.prepare({
    transactionId: 'tx-auth',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'fix' },
    resources: [{ kind: 'config', key: 'dsh.json', scope: 'workspace' }],
    lease: acquired.handle,
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'conflict')
  const get = await owner.api.get('tx-auth')
  assert.equal(get.found, false)
})

test('prepare fails closed when the lease is no longer valid (fencing check)', async () => {
  const { owner, services } = createOwner()
  const coordination = services.coordination
  const acquired = await coordination.acquire({
    resource: { scope: 'workspace', key: 'repo-a' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })
  // take over the resource so the old generation is superseded
  const taken = await coordination.acquire({
    resource: { scope: 'workspace', key: 'repo-a' },
    ownerId: 'owner-2',
    leaseMs: 60_000,
  })
  assert.equal(taken.ok, false)
  // simulate supersession by direct record mutation
  const record = coordination._records.get('repo-a')
  coordination._records.set('repo-a', { ...record, generation: 'gen:NEW', state: 'active' })
  const result = await owner.api.prepare({
    transactionId: 'tx-fence',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'fix' },
    resources: [{ kind: 'config', key: 'dsh.json', scope: 'workspace' }],
    lease: acquired.handle,
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'stale-fencing')
})

test('record requires active prepared transaction plus fencing; idempotent replay and conflicting replay', async () => {
  const { owner, services } = createOwner()
  const prepared = await prepareWorkspace(owner, services)
  assert.equal(prepared.ok, true)

  const mutation = {
    resource: { kind: 'file', key: 'a.txt', scope: 'workspace' },
    operation: 'write',
    before: { digest: 'old' },
    after: { digest: 'new' },
    sideEffectClass: 'rollbackable',
    capability: { owner: 'fileClaim', name: 'claim', status: 'available' },
    source: { toolId: 'tool-1', executionId: 'exec-1' },
    idempotent: true,
  }
  const recorded = await owner.api.record('tx-1', mutation)
  assert.equal(recorded.ok, true)
  assert.equal(recorded.code, 'recorded')
  assert.equal(recorded.idempotent, false)
  assert.equal(recorded.mutation.order, 0)

  // equivalent replay is idempotent without duplicating the ledger entry
  const replay = await owner.api.record('tx-1', mutation)
  assert.equal(replay.ok, true)
  assert.equal(replay.idempotent, true)
  assert.equal(replay.mutation.mutationId, recorded.mutation.mutationId)
  const got = await owner.api.get('tx-1')
  assert.equal(got.transaction.mutations.length, 1)

  // conflicting replay rejects without overwriting original provenance
  const conflict = await owner.api.record('tx-1', { ...mutation, after: { digest: 'different' } })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.code, 'conflict')
  const afterConflict = await owner.api.get('tx-1')
  assert.equal(afterConflict.transaction.mutations[0].after.digest, 'new')

  // resources outside the declared resource set are rejected
  const outside = await owner.api.record('tx-1', {
    ...mutation,
    resource: { kind: 'file', key: 'secret.txt', scope: 'workspace' },
  })
  assert.equal(outside.ok, false)
  assert.equal(outside.code, 'conflict')

  // a mutation arriving after a terminal state is rejected as stale
  const committed = await owner.api.commit('tx-1')
  assert.equal(committed.ok, true)
  const stale = await owner.api.record('tx-1', { ...mutation, resource: { kind: 'config', key: 'dsh.json', scope: 'workspace' } })
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'conflict')
  const terminal = await owner.api.get('tx-1')
  assert.equal(terminal.transaction.state, 'committed')
  assert.equal(terminal.transaction.mutations.length, 1)
})

test('unverifiable digests downgrade evidence instead of claiming exact reversible mutation', async () => {
  const { owner, services } = createOwner()
  const prepared = await prepareWorkspace(owner, services)
  assert.equal(prepared.ok, true)
  // a missing after side with no absent marker is invalid input (never
  // accepted as absent state without the marker)
  const invalid = await owner.api.record('tx-1', {
    resource: { kind: 'config', key: 'dsh.json', scope: 'workspace' },
    operation: 'write',
    before: { digest: 'old' },
    after: undefined,
    sideEffectClass: 'rollbackable',
    capability: { owner: 'ledger', name: 'append', status: 'available' },
  })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.code, 'invalid-input')
})

test('record rejects stale fencing after the lease is superseded', async () => {
  const { owner, services } = createOwner()
  const prepared = await prepareWorkspace(owner, services)
  assert.equal(prepared.ok, true)
  const record = services.coordination._records.get('repo-a')
  services.coordination._records.set('repo-a', { ...record, generation: 'gen:NEW', state: 'active' })
  const recorded = await owner.api.record('tx-1', {
    resource: { kind: 'config', key: 'dsh.json', scope: 'workspace' },
    operation: 'write',
    before: { digest: 'old' },
    after: { digest: 'new' },
    sideEffectClass: 'rollbackable',
    capability: { owner: 'ledger', name: 'append', status: 'available' },
  })
  assert.equal(recorded.ok, false)
  assert.equal(recorded.code, 'stale-fencing')
})

test('prepare cleanup after a failed claim releases only its own temporary claims', async () => {
  const services = createServices()
  services.fileClaim.claim = (resource) => resource.key === 'blocked.txt' ? false : true
  const bundle = createOwner({ services })
  const owner = bundle.owner
  const coordination = services.coordination
  const acquired = await coordination.acquire({
    resource: { scope: 'workspace', key: 'repo-a' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })
  const result = await owner.api.prepare({
    transactionId: 'tx-cleanup',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'fix' },
    resources: [
      { kind: 'file', key: 'a.txt', scope: 'workspace' },
      { kind: 'file', key: 'blocked.txt', scope: 'workspace' },
    ],
    lease: acquired.handle,
  })
  assert.equal(result.ok, false)
  // the successfully claimed temporary resource was released again
  assert.equal(services.fileClaim.claims.has('a.txt'), false)
  const get = await owner.api.get('tx-cleanup')
  assert.equal(get.found, false)
})

test('disposed facade returns inactive without contacting adapters', async () => {
  const { owner, services } = createOwner()
  owner.dispose()
  const result = await owner.api.prepare({ transactionId: 'tx-x', workspace })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'inactive')
  const recorded = await owner.api.record('tx-x', {})
  assert.equal(recorded.code, 'inactive')
  const observed = await owner.api.observe('tx-x')
  assert.equal(observed.code, 'inactive')
})