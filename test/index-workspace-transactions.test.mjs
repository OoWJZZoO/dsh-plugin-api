import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

function createContext(options = {}) {
  const services = {
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
    ...(options.services ?? {}),
  }
  const state = { pluginApi: undefined, effects: [], listeners: [], errors: [] }
  const ctx = {
    logger: { error(message) { state.errors.push(message) }, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect(fn, label) { state.effects.push({ fn, label }) },
    on(name, listener) { state.listeners.push({ name, listener }); return () => {} },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  return { ctx, state, services }
}

const workspace = { scope: 'workspace', key: 'mounted-repo' }

async function acquireLease(pluginApi) {
  const outcome = await pluginApi.coordination.acquire({
    resource: { scope: 'workspace', key: 'mounted-lease' },
    ownerId: 'owner-1',
    leaseMs: 60_000,
  })
  assert.equal(outcome.ok, true)
  return outcome.handle
}

test('mounted facade: full prepare -> record -> preview -> commit flow over the memory registry', async () => {
  const { ctx, state } = createContext()
  apply(ctx)
  const wt = state.pluginApi.workspaceTransactions
  const handle = await acquireLease(state.pluginApi)
  const prepared = await wt.prepare({
    transactionId: 'flow-tx',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'flow' },
    resources: [
      { kind: 'config', key: 'dsh.json', scope: 'workspace' },
      { kind: 'config', key: 'dsh.local.json', scope: 'workspace' },
    ],
    lease: handle,
  })
  assert.equal(prepared.ok, true)
  const withClaim = await wt.prepare({
    transactionId: 'flow-tx',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'flow' },
    resources: [
      { kind: 'config', key: 'dsh.json', scope: 'workspace' },
      { kind: 'config', key: 'dsh.local.json', scope: 'workspace' },
    ],
    lease: handle,
  })
  // idempotent replay of an identical prepare returns the existing record
  assert.equal(withClaim.ok, true)
  const recorded = await wt.record('flow-tx', {
    resource: { kind: 'config', key: 'dsh.json', scope: 'workspace' },
    operation: 'write',
    before: { digest: 'old' },
    after: { digest: 'new' },
    sideEffectClass: 'rollbackable',
    capability: { owner: 'ledger', name: 'append', status: 'available' },
    source: { toolId: 'tool-1', executionId: 'exec-1' },
  })
  assert.equal(recorded.ok, true)
  const preview = await wt.preview('flow-tx')
  assert.equal(preview.ok, true)
  assert.equal(preview.projection.resourceChanges.length, 1)
  const committed = await wt.commit('flow-tx')
  assert.equal(committed.ok, true)
  assert.equal(committed.code, 'committed')
  const got = await wt.get('flow-tx')
  assert.equal(got.transaction.state, 'committed')
  assert.equal(got.transaction.availability.durability, 'memory')
})

test('mounted facade: rollback over the memory registry restores only confirmed rollbackable resources', async () => {
  const { ctx, state } = createContext()
  apply(ctx)
  const wt = state.pluginApi.workspaceTransactions
  const handle = await acquireLease(state.pluginApi)
  const prepared = await wt.prepare({
    transactionId: 'rollback-tx',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'rollback' },
    resources: [
      { kind: 'config', key: 'dsh.json', scope: 'workspace' },
      { kind: 'config', key: 'dsh.local.json', scope: 'workspace' },
    ],
    lease: handle,
  })
  assert.equal(prepared.ok, true)
  // Without any adapter-confirmed rollbackable seam on the host, a
  // `rollbackable` mutation cannot be restored: rollback must fail truthfully
  // instead of claiming a restore that no adapter proved (rollback truthfulness).
  const recorded = await wt.record('rollback-tx', {
    resource: { kind: 'config', key: 'dsh.json', scope: 'workspace' },
    operation: 'write',
    before: { digest: 'old' },
    after: { digest: 'new' },
    sideEffectClass: 'rollbackable',
    capability: { owner: 'git', name: 'restore', status: 'available' },
    source: { toolId: 'tool-1' },
  })
  assert.equal(recorded.ok, true)
  const rolled = await wt.rollback('rollback-tx')
  assert.equal(rolled.ok, false)
  const got = await wt.get('rollback-tx')
  assert.equal(got.transaction.state, 'failed')
})

test('mounted facade: recovery over the memory registry returns typed unsupported, never a fake success', async () => {
  const { ctx, state } = createContext()
  apply(ctx)
  const wt = state.pluginApi.workspaceTransactions
  const handle = await acquireLease(state.pluginApi)
  const prepared = await wt.prepare({
    transactionId: 'recover-tx',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'recover' },
    resources: [{ kind: 'config', key: 'dsh.json', scope: 'workspace' }],
    lease: handle,
  })
  assert.equal(prepared.ok, true)
  const recovered = await wt.recover('recover-tx')
  assert.equal(recovered.ok, false)
  assert.equal(recovered.code, 'unsupported')
})

test('mounted observer surface delivers transitions with epoch metadata', async () => {
  const { ctx, state } = createContext()
  apply(ctx)
  const wt = state.pluginApi.workspaceTransactions
  const handle = await acquireLease(state.pluginApi)
  await wt.prepare({
    transactionId: 'observe-tx',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'observe' },
    resources: [{ kind: 'config', key: 'dsh.json', scope: 'workspace' }],
    lease: handle,
  })
  const seen = []
  const subscription = await wt.observe('observe-tx')
  subscription.subscribe((event) => seen.push(event.nextState))
  await wt.commit('observe-tx')
  subscription.dispose()
  assert.ok(seen.includes('committing'))
  assert.ok(seen.includes('committed'))
})

test('disabled surface throws typed errors and keeps unrelated features active', async () => {
  const { ctx, state } = createContext()
  const on = ctx.on
  ctx.on = undefined
  assert.doesNotThrow(() => apply(ctx))
  assert.throws(() => state.pluginApi.workspaceTransactions.prepare({}), PluginApiFeatureDisabledError)
  assert.throws(() => state.pluginApi.workspaceTransactions.observe('tx'), PluginApiFeatureDisabledError)
  assert.equal(typeof state.pluginApi.coordination.acquire, 'function')
  ctx.on = on
})