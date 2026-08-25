import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEvidenceReference,
  createApprovalAdapter,
  createCheckpointAdapter,
  createFileClaimAdapter,
  createGitRestoreAdapter,
  createLedgerAdapter,
  createMemoryWorkspaceRegistry,
  createMutationEvidenceIntake,
  createSessionBranchAdapter,
  createStorageDomainWorkspaceRegistry,
  createWorkspaceCapabilityAdapter,
} from '../lib/workspace-transaction-adapters.js'

const NOW = '2026-08-25T00:00:00.000Z'
const now = () => NOW
const fileResource = { kind: 'file', key: 'a.txt', scope: 'workspace' }
const lease = { generation: 'gen:1', fencingToken: 'tok-1', ownerId: 'owner-1', expiresAt: '2026-08-25T00:10:00.000Z' }

function createCtx(services = {}) {
  return { get(name) { return services[name] ?? null } }
}

test('memory registry is labeled non-durable, serializes lanes per identity, and CAS-rejects stale writers', async () => {
  const registry = createMemoryWorkspaceRegistry({ now })
  const caps = registry.capabilities()
  assert.equal(caps.durability, 'memory')
  assert.equal(caps.status, 'available')
  assert.equal(caps.backendId, 'memory')

  const record = { transactionId: 'tx-1', state: 'prepared', revision: 0 }
  const written = await registry.writeCas('tx-1', 0, record)
  assert.equal(written.ok, true)
  assert.equal(written.record.revision, 1)

  // stale writer with the old revision is rejected
  const stale = await registry.writeCas('tx-1', 0, { ...record, state: 'committing' })
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'compare-conflict')

  const found = await registry.read('tx-1')
  assert.equal(found.ok, true)
  assert.equal(found.record.state, 'prepared')
  assert.equal(found.record.revision, 1)

  // duplicate create on an existing identity fails closed
  const dup = await registry.writeCas('tx-1', 0, { ...record })
  assert.equal(dup.ok, false)
  assert.equal(dup.code, 'compare-conflict')

  const missing = await registry.read('tx-missing')
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'unavailable')

  // concurrent writes over one lane stay ordered and revision-safe: both
  // expect the fresh revision 0, the lane serializes them, and only the first
  // writer wins while the second is a stale-writer CAS conflict.
  const parallel = await Promise.all([
    registry.writeCas('lane-id', 0, { v: 1 }),
    registry.writeCas('lane-id', 0, { v: 2 }),
  ])
  assert.equal(parallel[0].ok, true)
  assert.equal(parallel[1].ok, false)
  assert.equal(parallel[1].code, 'compare-conflict')

  // late-event provenance retention
  registry.prependEvent('tx-1', { kind: 'transition', nextState: 'committing', revision: 2 })
  const events = await registry.queryEvents('tx-1')
  assert.equal(events.ok, true)
  assert.equal(events.events.length, 1)

  registry.dispose()
  const afterDispose = await registry.read('tx-1')
  assert.equal(afterDispose.ok, false)
  assert.equal(afterDispose.code, 'unavailable')
})

test('storage-domain registry bridge is selected only on explicit durable+atomic evidence', async () => {
  const unit = {
    read() { return null },
    write() { return true },
    compareAndSwap() { return true },
  }
  const durable = createStorageDomainWorkspaceRegistry({
    unit,
    capabilityReport: { durability: 'workspace', atomicCas: true, scope: 'workspace' },
    now,
  })
  const caps = durable.capabilities()
  assert.equal(caps.durability, 'durable')
  assert.equal(caps.atomicCas, true)
  assert.equal(caps.status, 'available')

  const written = await durable.writeCas('tx-1', 0, { transactionId: 'tx-1', state: 'prepared' })
  assert.equal(written.ok, true)
  assert.equal(written.record.revision, 1)

  // without the atomic primitive the bridge reports unsupported, never
  // emulating durability
  const noAtomic = createStorageDomainWorkspaceRegistry({
    unit,
    capabilityReport: { durability: 'workspace', atomicCas: false, scope: 'workspace' },
    now,
  })
  const noAtomicCaps = noAtomic.capabilities()
  assert.equal(noAtomicCaps.atomicCas, false)
  assert.equal(noAtomicCaps.status, 'unknown')
  const cas = await noAtomic.writeCas('tx-1', 0, { transactionId: 'tx-1' })
  assert.equal(cas.ok, false)
  assert.equal(cas.code, 'unsupported')

  // a durable claim is never inferred from a domain name alone
  const nameOnly = createStorageDomainWorkspaceRegistry({
    unit,
    capabilityReport: { durability: 'unknown', atomicCas: false, scope: 'process' },
    now,
  })
  assert.equal(nameOnly.capabilities().durability, 'unknown')
  assert.equal(nameOnly.capabilities().status, 'unknown')
})

test('workspace capability adapter feeds authority rejection and per-scope capability evidence', () => {
  const workspaces = {
    capabilitiesFor(scope) {
      return scope === 'workspace'
        ? { authorityId: 'auth-1', compatible: true, generation: 'g1' }
        : { authorityId: 'auth-2', compatible: false }
    },
  }
  const adapter = createWorkspaceCapabilityAdapter({ ctx: createCtx({ workspaces }), now })
  const compatible = adapter.capabilities('workspace')
  assert.equal(compatible.ok, true)
  assert.equal(compatible.code, 'compatible')
  assert.equal(compatible.authority, 'auth-1')
  const incompatible = adapter.capabilities('profile')
  assert.equal(incompatible.ok, false)
  assert.equal(incompatible.code, 'incompatible')

  // missing seam degrades to unavailable, never fabricates authority
  const missing = createWorkspaceCapabilityAdapter({ ctx: createCtx({}), now })
  const degraded = missing.capabilities('workspace')
  assert.equal(degraded.ok, false)
  assert.equal(degraded.code, 'unavailable')
  assert.equal(degraded.authority, 'none')
})

test('file claim adapter refuses operations it cannot prove and never upgrades on local completion', async () => {
  const claims = new Set()
  const fileClaim = {
    claim(resource) {
      if (resource.key === 'locked.txt') return false
      claims.add(resource.key)
      return true
    },
    release(resource) {
      claims.delete(resource.key)
      return true
    },
  }
  const adapter = createFileClaimAdapter({ ctx: createCtx({ fileClaim }), now })
  assert.equal(adapter.capability().status, 'available')
  const claimed = await adapter.claim(fileResource, lease)
  assert.equal(claimed.ok, true)
  assert.equal(claimed.code, 'claimed')
  const refused = await adapter.claim({ ...fileResource, key: 'locked.txt' }, lease)
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'conflict')
  const released = await adapter.release(fileResource, lease)
  assert.equal(released.ok, true)

  // missing seam: unsupported for that adapter only
  const missing = createFileClaimAdapter({ ctx: createCtx({}), now })
  assert.equal(missing.capability().status, 'unavailable')
  const unsupported = await missing.claim(fileResource, lease)
  assert.equal(unsupported.ok, false)
  assert.equal(unsupported.code, 'unsupported')
})

test('checkpoint adapter binds describe/create/restore with capability provenance', async () => {
  const checkpoints = {
    describe(ref) { return { id: 'cp-1' } },
    create() { return { id: 'cp-2' } },
    restore() { return true },
  }
  const adapter = createCheckpointAdapter({ ctx: createCtx({ checkpoints }), now })
  const described = await adapter.describe('cp-ref')
  assert.equal(described.ok, true)
  assert.equal(described.checkpoint.id, 'cp-1')
  const created = await adapter.create({ scope: 'workspace' })
  assert.equal(created.ok, true)
  assert.equal(created.checkpoint.id, 'cp-2')
  const restored = await adapter.restore('cp-1', { kind: 'file', key: 'a.txt', scope: 'workspace' })
  assert.equal(restored.ok, true)
  assert.equal(restored.code, 'restored')
  // missing seam degrades only this adapter
  const missing = createCheckpointAdapter({ ctx: createCtx({}), now })
  assert.equal(missing.capability().status, 'unavailable')
  const unsupported = await missing.describe('cp-ref')
  assert.equal(unsupported.ok, false)
  assert.equal(unsupported.code, 'unsupported')
})

test('git/workspace restore adapter previews, applies, and restores only with a confirmed seam', async () => {
  const git = {
    preview() { return { revision: 'r1' } },
    apply() { return true },
    restore() { return false },
  }
  const adapter = createGitRestoreAdapter({ ctx: createCtx({ workspaceRestore: git }), now })
  assert.equal(adapter.capability().status, 'available')
  const previewed = await adapter.preview('boundary')
  assert.equal(previewed.ok, true)
  const applied = await adapter.apply('boundary')
  assert.equal(applied.ok, true)
  const failed = await adapter.restore('boundary')
  assert.equal(failed.ok, false)
  assert.equal(failed.code, 'conflict')
  const missing = createGitRestoreAdapter({ ctx: createCtx({}), now })
  assert.equal(missing.capability().status, 'unavailable')
  const unsupported = await missing.restore('b')
  assert.equal(unsupported.ok, false)
  assert.equal(unsupported.code, 'unsupported')
})

test('ledger adapter appends and queries per transaction identity with bounded entries', async () => {
  const entries = []
  const ledger = {
    append(entry) { entries.push(entry); return true },
    query(transactionId) { return entries.filter((e) => e.transactionId === transactionId) },
  }
  const adapter = createLedgerAdapter({ ctx: createCtx({ changeLedger: ledger }), now })
  const appended = await adapter.append({ transactionId: 'tx-1', kind: 'mutation' })
  assert.equal(appended.ok, true)
  const queried = await adapter.query('tx-1')
  assert.equal(queried.ok, true)
  assert.equal(queried.entries.length, 1)
  const missing = createLedgerAdapter({ ctx: createCtx({}), now })
  assert.equal(missing.capability().status, 'unavailable')
  assert.equal((await missing.append({ transactionId: 'tx-1' })).code, 'unsupported')
})

test('approval adapter confirms only with a bounded approval identity', async () => {
  const approval = {
    confirm(request) {
      return request.kind === 'dangerous'
        ? { confirmed: false, approvalId: 'denied-1' }
        : { confirmed: true, approvalId: 'ap-1' }
    },
  }
  const adapter = createApprovalAdapter({ ctx: createCtx({ approval }), now })
  const confirmed = await adapter.confirm({ kind: 'file' })
  assert.equal(confirmed.ok, true)
  assert.equal(confirmed.approval.approvalId, 'ap-1')
  const denied = await adapter.confirm({ kind: 'dangerous' })
  assert.equal(denied.ok, false)
  assert.equal(denied.code, 'denied')
  const missing = createApprovalAdapter({ ctx: createCtx({}), now })
  assert.equal(missing.capability().status, 'unavailable')
})

test('conditional sessionBranch adapter is enabled only by a confirmed public capability and degrades explicitly', async () => {
  const missing = createSessionBranchAdapter({ ctx: createCtx({}), now })
  assert.equal(missing.capability().status, 'unsupported')
  assert.equal(missing.capability().certainty, 'unavailable')
  const unsupported = await missing.restore('boundary')
  assert.equal(unsupported.ok, false)
  assert.equal(unsupported.code, 'unsupported')

  const sessionBranch = {
    preview() { return { boundary: 'b1' } },
    apply() { return true },
    restore() { return true },
  }
  const present = createSessionBranchAdapter({ ctx: createCtx({ sessionBranch }), now })
  assert.equal(present.capability().status, 'available')
  const restored = await present.restore('boundary')
  assert.equal(restored.ok, true)
  assert.equal(restored.code, 'restored')
})

test('mutation evidence intake passes waterfall next() through unchanged and records bounded observations', async () => {
  const listeners = new Map()
  const ctx = {
    on(name, listener) {
      listeners.set(name, listener)
      return () => listeners.delete(name)
    },
    get() { return null },
  }
  const intake = createMutationEvidenceIntake({ ctx, now })
  assert.equal(intake.size, 0)
  assert.equal(listeners.has('fs/write-intent'), true)
  assert.equal(listeners.has('fs/edit-intent'), true)
  assert.equal(listeners.has('tools/pre-execute'), true)

  // waterfall passthrough fidelity: next() is called and its result returned
  const next = () => 'next-result'
  const listener = listeners.get('fs/write-intent')
  const payload = { resource: 'a.txt', before: { digest: 'old' }, after: { digest: 'new' }, source: { executionId: 'exec-1' } }
  const result = listener(payload, next)
  assert.equal(result, 'next-result')
  assert.equal(intake.size, 1)
  const observed = intake.latest('fs/write-intent')
  assert.equal(observed.resource, 'a.txt')
  assert.equal(observed.before.digest, 'old')
  assert.equal(observed.source.executionId, 'exec-1')

  // tools/pre-execute records source tool/execution provenance
  listeners.get('tools/pre-execute')({ toolId: 'tool-1', executionId: 'exec-2', sessionId: 'session-1' })
  const toolEvidence = intake.latest('tool-execution')
  assert.equal(toolEvidence.source.toolId, 'tool-1')
  assert.equal(toolEvidence.source.executionId, 'exec-2')

  // a throwing listener observer never interferes with next()
  const boomPayload = {}
  Object.defineProperty(boomPayload, 'resource', {
    enumerable: true,
    get() { throw new Error('boom') },
  })
  assert.equal(listener(boomPayload, next), 'next-result')

  // missing hooks degrade without pretending observation
  const bareIntake = createMutationEvidenceIntake({ ctx: { on: undefined }, now })
  assert.equal(bareIntake.size, 0)

  // idempotent disposer ownership
  assert.equal(intake.dispose(), true)
  assert.equal(intake.dispose(), false)
  assert.equal(listeners.has('fs/write-intent'), false)
})

test('evidence references are bounded and carry the certainty vocabulary', () => {
  const ref = buildEvidenceReference({ kind: 'file-claim', id: 'resource-key', certainty: 'observed', observedAt: NOW })
  assert.equal(ref.kind, 'file-claim')
  assert.equal(ref.id, 'resource-key')
  assert.equal(ref.certainty, 'observed')
  const degraded = buildEvidenceReference({ kind: 'x', id: 'y', certainty: 'bogus', observedAt: NOW })
  assert.equal(degraded.certainty, 'unknown')
})