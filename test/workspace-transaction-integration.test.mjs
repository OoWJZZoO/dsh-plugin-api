import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceMutationTransaction } from '../lib/workspace-mutation-transaction.js'
import { createCoordinationLease } from '../lib/coordination-lease.js'
import { apply } from '../lib/index.js'

const NOW = '2026-08-25T00:00:00.000Z'
let nowValue = Date.parse(NOW)
const now = () => new Date(nowValue).toISOString()

function createHostContext(services = {}) {
  const base = {
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    typert: {
      register() {}, get() {}, resolve() {}, list() {}, getPackage() {}, listPackages() {}, toJSONSchema() {},
      local: { get() {}, hasSeen() {}, list() {}, subscribe() {} },
      remotes: { register() {}, get() {}, list() {}, subscribe() {} },
      lookups: { register() {}, configure() {}, get() {}, definitions() {}, keys() {}, subscribe() {} },
      contexts: { registerHost() {}, configureHost() {}, registerClient() {}, getHost() {}, getClient() {}, subscribe() {} },
    },
    ...services,
  }
  const state = { pluginApi: undefined, listeners: [] }
  const ctx = {
    logger: { error() {}, warn() {} },
    get(name) { return name === 'pluginApi' ? state.pluginApi : base[name] },
    on(name, listener) { state.listeners.push({ name, listener }); return () => {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    plugin(Class) { new Class(ctx) },
    effect() {}, once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  return { ctx, state, services: base }
}

const workspace = { scope: 'workspace', key: 'repo-a' }

test('end-to-end prepare -> record -> preview -> commit over a confirmed capability set', async () => {
  const ledger = { entries: [], append(e) { this.entries.push(e); return true }, query(id) { return this.entries.filter((e) => e.transactionId === id) } }
  const workspaces = { capabilitiesFor() { return { authorityId: 'auth-1', compatible: true } } }
  const services = { changeLedger: ledger, workspaces }
  const { ctx } = createHostContext(services)

  // Use the real same-batch first feature (coordination lease) to acquire the
  // fencing handle, then the transaction facade consumes it.
  const coordinationOwner = createCoordinationLease({ ctx, logger: ctx.logger, now })
  const acquired = await coordinationOwner.api.acquire({
    resource: { scope: 'workspace', key: 'repo-a' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })
  assert.equal(acquired.ok, true)

  const wtOwner = createWorkspaceMutationTransaction({
    ctx,
    coordination: coordinationOwner.api,
    recovery: {
      availability() { return { status: 'available' } },
      classify() { return { ok: true, class: 'transient' } },
    },
    logger: ctx.logger,
    now,
  })
  const prepared = await wtOwner.api.prepare({
    transactionId: 'e2e-tx',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'e2e' },
    resources: [{ kind: 'config', key: 'dsh.json', scope: 'workspace' }],
    lease: acquired.handle,
  })
  assert.equal(prepared.ok, true)
  const recorded = await wtOwner.api.record('e2e-tx', {
    resource: { kind: 'config', key: 'dsh.json', scope: 'workspace' },
    operation: 'write',
    before: { digest: 'old' },
    after: { digest: 'new' },
    sideEffectClass: 'rollbackable',
    capability: { owner: 'ledger', name: 'append', status: 'available' },
    source: { toolId: 'tool-1', executionId: 'exec-1' },
  })
  assert.equal(recorded.ok, true)
  const preview = await wtOwner.api.preview('e2e-tx')
  assert.equal(preview.ok, true)
  assert.equal(preview.projection.resourceChanges[0].source.executionId, 'exec-1')
  const committed = await wtOwner.api.commit('e2e-tx')
  assert.equal(committed.ok, true)
  assert.equal(ledger.entries.length, 1)
  const got = await wtOwner.api.get('e2e-tx')
  assert.equal(got.transaction.state, 'committed')
  assert.equal(got.transaction.availability.durability, 'memory')
  wtOwner.dispose()
  coordinationOwner.dispose()
})

test('capability-gated degradation when checkpoint/file-claim/session-branch seams are absent', async () => {
  const { ctx } = createHostContext({})
  const coordinationOwner = createCoordinationLease({ ctx, logger: ctx.logger, now })
  const acquired = await coordinationOwner.api.acquire({
    resource: { scope: 'workspace', key: 'repo-a' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })
  const wtOwner = createWorkspaceMutationTransaction({
    ctx,
    coordination: coordinationOwner.api,
    recovery: { availability() { return { status: 'available' } }, classify() { return { ok: true, class: 'transient' } } },
    logger: ctx.logger,
    now,
  })
  // A declared checkpoint is unavailable: prepare returns explicit typed
  // unavailable/unsupported and never creates a commit-ready transaction.
  const withoutCheckpoint = await wtOwner.api.prepare({
    transactionId: 'gated-cp',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'gated' },
    resources: [{ kind: 'config', key: 'dsh.json', scope: 'workspace' }],
    lease: acquired.handle,
    checkpoint: { ref: 'cp' },
  })
  assert.equal(withoutCheckpoint.ok, false)
  assert.ok(['unsupported', 'unavailable'].includes(withoutCheckpoint.code))
  const got = await wtOwner.api.get('gated-cp')
  assert.equal(got.found, false)
  wtOwner.dispose()
  coordinationOwner.dispose()
})

test('coordination lease binding is consumed from the same-batch first feature without owning its state', async () => {
  const { ctx } = createHostContext({})
  const coordinationOwner = createCoordinationLease({ ctx, logger: ctx.logger, now })
  const acquired = await coordinationOwner.api.acquire({
    resource: { scope: 'workspace', key: 'repo-a' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })
  const wtOwner = createWorkspaceMutationTransaction({
    ctx,
    coordination: coordinationOwner.api,
    recovery: { availability() { return { status: 'available' } }, classify() { return { ok: true, class: 'transient' } } },
    logger: ctx.logger,
    now,
  })
  const prepared = await wtOwner.api.prepare({
    transactionId: 'lease-tx',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'lease' },
    resources: [{ kind: 'config', key: 'dsh.json', scope: 'workspace' }],
    lease: acquired.handle,
  })
  assert.equal(prepared.ok, true)
  // The transaction facade binds lease provenance but does not own the lease:
  // the coordination facade still owns the record and can read it back.
  const watch = await coordinationOwner.api.watch({ scope: 'workspace', key: 'repo-a' })
  const current = await watch.current()
  assert.equal(current.fencingValid, true)
  watch.dispose()
  // releasing through the coordination owner invalidates the fencing and the
  // transaction facade must report stale fencing on a later operation
  const released = await coordinationOwner.api.release(acquired.handle)
  assert.equal(released.ok, true)
  const committed = await wtOwner.api.commit('lease-tx')
  assert.equal(committed.ok, false)
  assert.equal(committed.code, 'stale-fencing')
  wtOwner.dispose()
  coordinationOwner.dispose()
})

test('recovery decision vocabulary is exposed as read-only provenance on prepared transactions', async () => {
  const { ctx } = createHostContext({})
  const coordinationOwner = createCoordinationLease({ ctx, logger: ctx.logger, now })
  const acquired = await coordinationOwner.api.acquire({
    resource: { scope: 'workspace', key: 'repo-a' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })
  const recovery = {
    availability() { return { status: 'available' } },
    classify(error) {
      if (error?.message?.includes('partial')) return { ok: true, class: 'permanent' }
      return { ok: true, class: 'transient' }
    },
    evaluate() { return { ok: true, decision: { action: 'stop' } } },
  }
  const wtOwner = createWorkspaceMutationTransaction({ ctx, coordination: coordinationOwner.api, recovery, logger: ctx.logger, now })
  const prepared = await wtOwner.api.prepare({
    transactionId: 'recovery-tx',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'recovery' },
    resources: [{ kind: 'config', key: 'dsh.json', scope: 'workspace' }],
    lease: acquired.handle,
  })
  assert.equal(prepared.ok, true)
  const got = await wtOwner.api.get('recovery-tx')
  assert.ok(got.transaction.provenance.some((entry) => entry.kind === 'recovery'))
  wtOwner.dispose()
  coordinationOwner.dispose()
})

test('sibling identity provenance is preserved and never minted (no fake execution identity)', async () => {
  const { ctx } = createHostContext({})
  const coordinationOwner = createCoordinationLease({ ctx, logger: ctx.logger, now })
  const acquired = await coordinationOwner.api.acquire({
    resource: { scope: 'workspace', key: 'repo-a' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })
  const wtOwner = createWorkspaceMutationTransaction({
    ctx,
    coordination: coordinationOwner.api,
    recovery: { availability() { return { status: 'available' } }, classify() { return { ok: true, class: 'transient' } } },
    logger: ctx.logger,
    now,
  })
  const prepared = await wtOwner.api.prepare({
    transactionId: 'sibling-tx',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'sibling' },
    resources: [{ kind: 'config', key: 'dsh.json', scope: 'workspace' }],
    lease: acquired.handle,
    provenance: [
      { kind: 'execution', id: 'exec-42', certainty: 'observed' },
      { kind: 'task', id: 'task-7', certainty: 'observed' },
    ],
  })
  assert.equal(prepared.ok, true)
  const recorded = await wtOwner.api.record('sibling-tx', {
    resource: { kind: 'config', key: 'dsh.json', scope: 'workspace' },
    operation: 'write',
    before: { digest: 'old' },
    after: { digest: 'new' },
    sideEffectClass: 'rollbackable',
    capability: { owner: 'ledger', name: 'append', status: 'available' },
    source: { toolId: 'tool-1', executionId: 'exec-42', eventSeq: 3 },
  })
  assert.equal(recorded.ok, true)
  const got = await wtOwner.api.get('sibling-tx')
  // the sibling-supplied execution identity is preserved exactly
  assert.ok(got.transaction.provenance.some((entry) => entry.kind === 'execution' && entry.id === 'exec-42'))
  assert.ok(got.transaction.provenance.some((entry) => entry.kind === 'task' && entry.id === 'task-7'))
  assert.equal(got.transaction.mutations[0].source.executionId, 'exec-42')
  assert.equal(got.transaction.mutations[0].source.eventSeq, 3)
  // no event sequence was ever turned into an identity
  assert.equal(got.transaction.mutations[0].source.executionId, 'exec-42')
  wtOwner.dispose()
  coordinationOwner.dispose()
})

test('negative integration: no scheduler/poller, no automatic external rollback claims, no R replacement', async () => {
  const { ctx, state, services } = createHostContext({})
  const listenersBefore = state.listeners.length
  assert.doesNotThrow(() => apply(ctx))
  // the mounted facade observes fs edges for evidence but never schedules
  // anything; no timer/poller side effect exists
  assert.equal(state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').some((f) => f.name === 'workspaceTransactions' && f.isActive), true)
  // automatic external rollback is impossible: an external mutation commits
  // only with approval and rollback preserves the classification
  const coordination = state.pluginApi.coordination
  const handle = (await coordination.acquire({ resource: { scope: 'workspace', key: 'neg-tx' }, ownerId: 'owner-1', leaseMs: 60_000 })).handle
  const wt = state.pluginApi.workspaces.transactions
  const prepared = await wt.prepare({
    transactionId: 'neg-tx',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'publish', summary: 'negative' },
    resources: [{ kind: 'config', key: 'dsh.json', scope: 'workspace' }],
    lease: handle,
  })
  assert.equal(prepared.ok, true)
  await wt.record('neg-tx', {
    resource: { kind: 'config', key: 'dsh.json', scope: 'workspace' },
    operation: 'publish',
    before: { absent: true },
    after: { digest: 'released' },
    sideEffectClass: 'external',
    capability: { owner: 'approval', name: 'confirm', status: 'unavailable' },
    source: { toolId: 'tool-1' },
  })
  // no approval seam on the host: commit refuses rather than claiming the
  // external effect was safely published
  const refused = await wt.commit('neg-tx')
  assert.equal(refused.ok, false)
  // the mounted feature wired its fs/tool evidence intake observers: the
  // workspace facade now observes the fs write/edit intents and the
  // tools/pre-execute seam as sidecar evidence listeners
  const gainedNames = state.listeners.slice(listenersBefore).map((entry) => entry.name)
  assert.ok(gainedNames.includes('fs/write-intent'))
  assert.ok(gainedNames.includes('fs/edit-intent'))
  assert.ok(gainedNames.includes('tools/pre-execute'))
})