import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceMutationTransaction } from '../lib/workspace-mutation-transaction.js'

const NOW = '2026-08-25T00:00:00.000Z'
let nowValue = Date.parse(NOW)
const now = () => new Date(nowValue).toISOString()

function createCoordinationDouble() {
  const records = new Map()
  const watchers = new Map()
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
      const existing = records.get(resource.key)
      if (existing?.state === 'active') {
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
      records.set(resource.key, value)
      return Promise.resolve({ ok: true, handle: { ...value } })
    },
    watch(resource) {
      const subscription = {
        current() {
          const current = records.get(resource.key)
          if (!current) return Promise.resolve({ code: 'unavailable' })
          return Promise.resolve(redact(current))
        },
        subscribe() { return () => false },
        dispose() { return true },
      }
      return subscription
    },
  }
}

function createServices(overrides = {}) {
  const coordination = createCoordinationDouble()
  const recovery = {
    availability() { return { status: 'available' } },
    classify(error) {
      if (error?.message?.includes('partial')) return { ok: true, class: 'permanent' }
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
    claim(resource) { this.claims.set(resource.key, true); return true },
    release(resource, lease) { this.claims.delete(resource.key); return true },
  }
  const workspacesRestore = {
    preview() { return { revision: 'r1' } },
    apply() { return true },
    restore() { return true },
  }
  const ledger = {
    entries: [],
    append(entry) { this.entries.push(entry); return true },
    query(transactionId) { return this.entries.filter((e) => e.transactionId === transactionId) },
  }
  const approval = {
    confirm(request) {
      return { confirmed: request.grant === true, approvalId: request.grant ? 'ap-1' : 'denied-1' }
    },
  }
  const services = {
    coordination,
    recovery,
    ctx: {
      get(name) {
        if (name === 'workspaces') return workspaces
        if (name === 'fileClaim') return fileClaim
        if (name === 'workspaceRestore') return workspacesRestore
        if (name === 'changeLedger') return ledger
        if (name === 'approval') return approval
        return null
      },
      on() { return () => {} },
    },
    workspaces,
    fileClaim,
    workspacesRestore,
    ledger,
    approval,
  }
  return { ...services, ...overrides }
}

function createOwner(options = {}) {
  const services = options.services ?? createServices()
  let idSeq = 0
  return {
    services,
    owner: createWorkspaceMutationTransaction({
      ctx: services.ctx,
      coordination: services.coordination,
      recovery: services.recovery,
      logger: { error() {} },
      now,
      idFactory: () => `id-${(idSeq += 1)}`,
    }),
  }
}

const workspace = { scope: 'workspace', key: 'repo-a' }

async function acquireAndPrepare(bundle, { transactionId = 'tx-1', leaseMs = 60_000, extra = {} } = {}) {
  const { services } = bundle
  const coordination = services.coordination
  // a fresh lease per transaction so parallel tests never collide
  const resource = { scope: 'workspace', key: transactionId }
  const acquired = await coordination.acquire({ resource, ownerId: 'owner-1', leaseMs })
  assert.equal(acquired.ok, true)
  return bundle.owner.api.prepare({
    transactionId,
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'fix tests' },
    resources: [
      { kind: 'file', key: 'a.txt', scope: 'workspace' },
      { kind: 'config', key: 'dsh.json', scope: 'workspace' },
    ],
    lease: acquired.handle,
    ...extra,
  })
}

const fileMutation = {
  resource: { kind: 'file', key: 'a.txt', scope: 'workspace' },
  operation: 'write',
  before: { digest: 'old' },
  after: { digest: 'new' },
  sideEffectClass: 'rollbackable',
  capability: { owner: 'git', name: 'restore', status: 'available' },
  source: { toolId: 'tool-1', executionId: 'exec-1' },
}

const configMutation = {
  resource: { kind: 'config', key: 'dsh.json', scope: 'workspace' },
  operation: 'write',
  before: { digest: 'old-cfg' },
  after: { digest: 'new-cfg' },
  sideEffectClass: 'rollbackable',
  capability: { owner: 'ledger', name: 'append', status: 'available' },
  source: { toolId: 'tool-1', executionId: 'exec-1' },
}

const externalMutation = {
  resource: { kind: 'config', key: 'dsh.json', scope: 'workspace' },
  operation: 'publish',
  before: { absent: true },
  after: { digest: 'published' },
  sideEffectClass: 'external',
  capability: { owner: 'approval', name: 'confirm', status: 'available' },
  source: { toolId: 'tool-1', executionId: 'exec-1' },
}

test('preview returns a frozen projection with rollback boundary and external warnings', async () => {
  const bundle = createOwner()
  const owner = bundle.owner
  const prepared = await acquireAndPrepare(bundle)
  assert.equal(prepared.ok, true)
  await owner.api.record('tx-1', fileMutation)
  const preview = await owner.api.preview('tx-1')
  assert.equal(preview.ok, true)
  assert.equal(preview.code, 'preview')
  assert.equal(preview.projection.previewable, true)
  assert.equal(preview.projection.state, 'prepared')
  assert.equal(preview.projection.resourceChanges.length, 1)
  assert.equal(preview.projection.resourceChanges[0].resource.key, 'a.txt')
  assert.equal(preview.projection.rollbackBoundary.covered, 1)
  assert.equal(preview.projection.rollbackBoundary.external, 0)
  assert.equal(Object.isFrozen(preview.projection), true)
  assert.equal(Object.isFrozen(preview.projection.resourceChanges[0]), true)

  // external effects are labeled as not covered by automatic rollback
  await owner.api.record('tx-1', externalMutation)
  const previewExternal = await owner.api.preview('tx-1', { includeExternal: true })
  assert.equal(previewExternal.projection.requiredApprovals.length, 1)
  assert.equal(previewExternal.projection.rollbackBoundary.notCoveredByAutomaticRollback.length, 1)
  const previewDefault = await owner.api.preview('tx-1')
  assert.equal(previewDefault.projection.externalEffectsWarning, 'external or unknown effects are not covered by automatic rollback')
})

test('preview reports stale/conflict evidence without silently refreshing', async () => {
  const services = createServices()
  const bundle = createOwner({ services })
  const owner = bundle.owner
  const prepared = await acquireAndPrepare(bundle)
  assert.equal(prepared.ok, true)
  // the authority becomes incompatible after prepare
  services.workspaces.capabilitiesFor = () => ({ authorityId: 'auth-2', compatible: false })
  const preview = await owner.api.preview('tx-1')
  assert.equal(preview.ok, true)
  assert.equal(preview.projection.stale.code, 'conflict')
  // the transaction was not silently refreshed into a different state
  const get = await owner.api.get('tx-1')
  assert.equal(get.transaction.state, 'prepared')
})

test('commit publishes committed only after ownership, approvals, and preconditions; failure leaves non-committed', async () => {
  const bundle = createOwner()
  const { owner, services } = bundle
  const prepared = await acquireAndPrepare(bundle)
  assert.equal(prepared.ok, true)
  await owner.api.record('tx-1', fileMutation)

  // a caller-declared expectedRevision precondition must match; a mismatch
  // leaves the transaction non-committed and identifies the boundary
  const wrongRevision = await owner.api.commit('tx-1', { expectedRevision: 99 })
  assert.equal(wrongRevision.ok, false)
  assert.equal(wrongRevision.code, 'conflict')
  const stillPrepared = await owner.api.get('tx-1')
  assert.equal(stillPrepared.transaction.state, 'prepared')
  const matchingRevision = await owner.api.commit('tx-1', { expectedRevision: stillPrepared.transaction.revision })
  assert.equal(matchingRevision.ok, true)

  // commit succeeds for internally safe mutations
  const committed = matchingRevision
  assert.equal(committed.code, 'committed')
  assert.equal(committed.mutationSummary.total, 1)
  assert.equal(committed.leaseGeneration, 'gen:000000000001')
  assert.equal(Object.isFrozen(committed), true)
  const get = await owner.api.get('tx-1')
  assert.equal(get.transaction.state, 'committed')
  assert.equal(get.transaction.revision, 4) // prepared(1) + record(2) + committing(3) + committed(4)

  // terminal retry is idempotent and never duplicates effects
  const retry = await owner.api.commit('tx-1')
  assert.equal(retry.ok, true)
  assert.equal(retry.idempotent, true)
  assert.equal(services.ledger.entries.length, 1)

  // a partial adapter success leaves the transaction failed or recovering,
  // never committed
  const bundle2 = createOwner()
  const owner2 = bundle2.owner
  const prepared2 = await acquireAndPrepare(bundle2, { transactionId: 'tx-2' })
  assert.equal(prepared2.ok, true)
  await owner2.api.record('tx-2', fileMutation)
  bundle2.services.ledger.append = () => false
  const partial = await owner2.api.commit('tx-2')
  assert.equal(partial.ok, false)
  const get2 = await owner2.api.get('tx-2')
  assert.equal(get2.transaction.state, 'failed')
})

test('external side effects commit only with declared approval/confirmation', async () => {
  const bundle = createOwner()
  const owner = bundle.owner
  const prepared = await acquireAndPrepare(bundle)
  assert.equal(prepared.ok, true)
  await owner.api.record('tx-1', externalMutation)

  // without approval the commit refuses and identifies the boundary
  const refused = await owner.api.commit('tx-1')
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'conflict')
  const get = await owner.api.get('tx-1')
  assert.equal(get.transaction.state, 'prepared')

  // with confirmation the commit succeeds and records the side effect as not
  // covered by automatic rollback
  const confirmed = await owner.api.commit('tx-1', { confirmation: { grant: true, kind: 'publish' } })
  assert.equal(confirmed.ok, true)
  assert.equal(confirmed.code, 'committed')
  assert.equal(confirmed.mutationSummary.notCoveredByAutomaticRollback, true)
  const getConfirmed = await owner.api.get('tx-1')
  assert.equal(getConfirmed.transaction.approvals.length, 1)
})

test('commit validation checks fencing and fails on stale leases', async () => {
  const bundle = createOwner()
  const { owner, services } = bundle
  const prepared = await acquireAndPrepare(bundle)
  assert.equal(prepared.ok, true)
  const record = services.coordination._records.get('tx-1')
  services.coordination._records.set('tx-1', { ...record, generation: 'gen:NEW', state: 'active' })
  const committed = await owner.api.commit('tx-1')
  assert.equal(committed.ok, false)
  assert.equal(committed.code, 'stale-fencing')
  const get = await owner.api.get('tx-1')
  assert.equal(get.transaction.state, 'prepared')
})

test('commit precondition failure on incompatible authority leaves non-committed state', async () => {
  const services = createServices()
  const bundle = createOwner({ services })
  const owner = bundle.owner
  const prepared = await acquireAndPrepare(bundle)
  assert.equal(prepared.ok, true)
  await owner.api.record('tx-1', fileMutation)
  services.workspaces.capabilitiesFor = () => ({ authorityId: 'auth-2', compatible: false })
  const committed = await owner.api.commit('tx-1')
  assert.equal(committed.ok, false)
  assert.equal(committed.code, 'conflict')
  const get = await owner.api.get('tx-1')
  assert.equal(get.transaction.state, 'prepared')
})

test('rollback restores only adapter-confirmed rollbackable resources and preserves external classification', async () => {
  const bundle = createOwner()
  const owner = bundle.owner
  const prepared = await acquireAndPrepare(bundle)
  assert.equal(prepared.ok, true)
  await owner.api.record('tx-1', fileMutation)
  await owner.api.record('tx-1', externalMutation)
  const rolled = await owner.api.rollback('tx-1')
  assert.equal(rolled.ok, true)
  assert.equal(rolled.code, 'rolled-back')
  assert.equal(rolled.restored.length, 1)
  assert.equal(rolled.restored[0].resource.key, 'a.txt')
  assert.equal(rolled.externalPreserved.length, 1)
  assert.equal(rolled.externalPreserved[0].sideEffectClass, 'external')
  const get = await owner.api.get('tx-1')
  assert.equal(get.transaction.state, 'rolled-back')

  // repeated rollback on the settled record is idempotent
  const retry = await owner.api.rollback('tx-1')
  assert.equal(retry.ok, true)
  assert.equal(retry.idempotent, true)
})

test('rollback never publishes rolled-back for a partial restore; it fails or recovers', async () => {
  const services = createServices()
  services.workspacesRestore.restore = () => false
  const bundle = createOwner({ services })
  const owner = bundle.owner
  const prepared = await acquireAndPrepare(bundle)
  assert.equal(prepared.ok, true)
  // file resource capability owner is git; force the git restore to fail
  services.ctx.get = (name) => {
    if (name === 'workspaces') return services.workspaces
    if (name === 'fileClaim') return services.fileClaim
    if (name === 'workspaceRestore') return { preview() { return {} }, apply() { return true }, restore() { return false } }
    if (name === 'changeLedger') return services.ledger
    if (name === 'approval') return services.approval
    return null
  }
  await owner.api.record('tx-1', fileMutation)
  const rolled = await owner.api.rollback('tx-1')
  assert.equal(rolled.ok, false)
  assert.equal(rolled.code, 'unavailable')
  const get = await owner.api.get('tx-1')
  // memory registry cannot continue the rollback after process loss: failed
  assert.equal(get.transaction.state, 'failed')
})

test('rollback rejects a stale owner unless an explicit fenced takeover is provided', async () => {
  const bundle = createOwner()
  const { owner, services } = bundle
  const prepared = await acquireAndPrepare(bundle)
  assert.equal(prepared.ok, true)
  const record = services.coordination._records.get('tx-1')
  services.coordination._records.set('tx-1', { ...record, generation: 'gen:NEW', state: 'active' })
  const refused = await owner.api.rollback('tx-1')
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'stale-fencing')

  // a fenced takeover handle validated against the newer generation is
  // accepted as the explicit takeover recovery path
  const takeoverHandle = {
    resource: { scope: 'workspace', key: 'tx-1' },
    ownerId: 'owner-2',
    generation: 'gen:NEW',
    fencingToken: 'tok-new',
    expiresAt: new Date(nowValue + 60_000).toISOString(),
  }
  const taken = await owner.api.rollback('tx-1', { takeover: takeoverHandle })
  assert.equal(taken.ok, true)
})

test('recover reconstructs only from durable evidence; memory registry reports unsupported', async () => {
  const bundle = createOwner()
  const owner = bundle.owner
  const prepared = await acquireAndPrepare(bundle)
  assert.equal(prepared.ok, true)
  await owner.api.record('tx-1', fileMutation)
  const recovered = await owner.api.recover('tx-1')
  assert.equal(recovered.ok, false)
  assert.equal(recovered.code, 'unsupported')
  // memory registry can never satisfy a reconnect-after-process-loss claim
  const get = await owner.api.get('tx-1')
  assert.equal(get.transaction.state, 'prepared')
})

test('recover over a durable bridge continues an interrupted commit from ledger evidence', async () => {
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
  const services = createServices()
  services.storage = {
    transactionCapability() {
      return { durability: 'workspace', atomicCas: true, scope: 'workspace' }
    },
    domainUnit: unit,
  }
  services.ctx.get = (name) => {
    if (name === 'storage') return services.storage
    if (name === 'workspaces') return services.workspaces
    if (name === 'fileClaim') return services.fileClaim
    if (name === 'changeLedger') return services.ledger
    if (name === 'approval') return services.approval
    return null
  }
  const bundle = createOwner({ services })
  const owner = bundle.owner
  const prepared = await acquireAndPrepare(bundle)
  assert.equal(prepared.ok, true)
  assert.equal(bundle.owner.availability.durability, 'durable')
  await owner.api.record('tx-1', fileMutation)
  // simulate an interrupted commit: write the committing record directly into
  // the durable domain, then let recover() settle it from ledger evidence
  const current = await owner.api.get('tx-1')
  const record = { ...current.transaction, state: 'committing', revision: current.transaction.revision }
  const key = 'workspace-transaction:tx-1'
  const existing = domain.get(key)
  domain.set(key, { ...existing, ...record, transactionId: 'tx-1' })
  // ledger already confirms the commit
  services.ledger.append({ transactionId: 'tx-1', kind: 'mutation' })
  const recovered = await owner.api.recover('tx-1')
  assert.equal(recovered.ok, true)
  assert.equal(recovered.code, 'recovered')
  assert.equal(recovered.found.state, 'committing')
  const get = await owner.api.get('tx-1')
  assert.equal(get.transaction.state, 'committed')
})

test('recover reports unavailable when durable evidence is insufficient', async () => {
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
  const services = createServices()
  services.storage = {
    transactionCapability() { return { durability: 'workspace', atomicCas: true, scope: 'workspace' } },
    domainUnit: unit,
  }
  services.ledger.query = () => []
  services.ctx.get = (name) => {
    if (name === 'storage') return services.storage
    if (name === 'workspaces') return services.workspaces
    if (name === 'fileClaim') return services.fileClaim
    if (name === 'changeLedger') return services.ledger
    if (name === 'approval') return services.approval
    return null
  }
  const bundle = createOwner({ services })
  const owner = bundle.owner
  const prepared = await acquireAndPrepare(bundle)
  assert.equal(prepared.ok, true)
  await owner.api.record('tx-1', fileMutation)
  // interrupt at committing with no ledger confirmation
  const current = await owner.api.get('tx-1')
  const existing = domain.get('workspace-transaction:tx-1')
  domain.set('workspace-transaction:tx-1', { ...existing, state: 'committing', transactionId: 'tx-1', revision: current.transaction.revision })
  const recovered = await owner.api.recover('tx-1')
  assert.equal(recovered.ok, false)
  assert.equal(recovered.code, 'unavailable')
  assert.equal(recovered.observed.state, 'unknown')
  const get = await owner.api.get('tx-1')
  assert.equal(get.transaction.state, 'unknown')
})

test('transition ordering: prepared -> committing -> committed publishes ordered immutable events', async () => {
  const bundle = createOwner()
  const owner = bundle.owner
  const prepared = await acquireAndPrepare(bundle)
  assert.equal(prepared.ok, true)
  const events = []
  const subscription = await owner.api.observe('tx-1')
  subscription.subscribe((event) => events.push(event))
  await owner.api.record('tx-1', fileMutation)
  await owner.api.commit('tx-1')
  subscription.dispose()
  const states = events.map((event) => `${event.previousState ?? 'none'}->${event.nextState}`)
  assert.deepEqual(states, ['prepared->committing', 'committing->committed'])
  // prepare(rev 1) + record(rev 2, no event) + committing(rev 3) + committed(rev 4)
  assert.equal(events[0].revision, 3)
  assert.equal(events[1].revision, 4)
  assert.equal(events[0].leaseGeneration, 'gen:000000000001')
  assert.equal(Object.isFrozen(events[0]), true)
})