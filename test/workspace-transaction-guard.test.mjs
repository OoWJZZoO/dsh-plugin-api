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

test('healthy apply mounts the workspaceTransactions facade after coordination and exposes the frozen surface', async () => {
  const { ctx, state } = createContext()
  assert.doesNotThrow(() => apply(ctx))
  const names = state.pluginApi.features.map((entry) => entry.name)
  assert.ok(names.includes('workspaceTransactions'))
  assert.ok(names.indexOf('coordination') < names.indexOf('workspaceTransactions'))
  const wt = state.pluginApi.workspaceTransactions
  assert.equal(typeof wt.prepare, 'function')
  assert.equal(typeof wt.record, 'function')
  assert.equal(typeof wt.preview, 'function')
  assert.equal(typeof wt.commit, 'function')
  assert.equal(typeof wt.rollback, 'function')
  assert.equal(typeof wt.recover, 'function')
  assert.equal(typeof wt.get, 'function')
  assert.equal(typeof wt.observe, 'function')
  assert.equal(Object.isFrozen(wt), true)

  // end-to-end prepare over the mounted surface works with the memory
  // registry and the coordination lease acquired through the facade
  const handle = await acquireLease(state.pluginApi)
  const prepared = await wt.prepare({
    transactionId: 'mounted-tx',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'mounted' },
    resources: [{ kind: 'config', key: 'dsh.json', scope: 'workspace' }],
    lease: handle,
  })
  assert.equal(prepared.ok, true)
  assert.equal(prepared.transaction.state, 'prepared')
  const got = await wt.get('mounted-tx')
  assert.equal(got.found, true)
  // memory registry is labeled non-durable on the availability projection
  assert.equal(got.transaction.availability.durability, 'memory')
})

test('workspaceTransactions typed results keep other facade surfaces intact', async () => {
  const { ctx, state } = createContext()
  apply(ctx)
  const wt = state.pluginApi.workspaceTransactions
  const invalid = await wt.prepare({})
  assert.equal(invalid.ok, false)
  assert.equal(invalid.code, 'invalid-input')
  const recorded = await wt.record('missing-tx', {})
  assert.equal(recorded.ok, false)
  assert.equal(typeof state.pluginApi.coordination.acquire, 'function')
  assert.equal(typeof state.pluginApi.recovery.evaluate, 'function')
  assert.equal(typeof state.pluginApi.tasks.register, 'function')
})

test('stale workspaceTransactions facade is typed unavailable after its owner slot is unmounted', async () => {
  const { ctx, state } = createContext()
  apply(ctx)
  const old = state.pluginApi.workspaceTransactions
  const token = state.pluginApi._readSlot('workspaceTransactions')
  assert.ok(token)
  const removed = state.pluginApi.unmountFeature('workspaceTransactions', state.pluginApi._workspaceTransactionsSlot)
  assert.equal(removed, true)
  assert.throws(() => old.prepare({}), PluginApiFeatureDisabledError)
  assert.throws(() => state.pluginApi.workspaceTransactions.commit('tx-1'), PluginApiFeatureDisabledError)
})

test('repeated apply is idempotent and keeps the live workspaceTransactions surface', async () => {
  const { ctx, state } = createContext()
  apply(ctx)
  apply(ctx)
  const wt = state.pluginApi.workspaceTransactions
  const handle = await acquireLease(state.pluginApi)
  const prepared = await wt.prepare({
    transactionId: 'mounted-tx-2',
    workspace,
    ownerId: 'owner-1',
    intent: { kind: 'edit', summary: 'mounted' },
    resources: [{ kind: 'config', key: 'dsh.json', scope: 'workspace' }],
    lease: handle,
  })
  assert.equal(prepared.ok, true)
})

test('workspaceTransactions guard uses only the public substrate and fails safe with missing ctx.on', async () => {
  const { ctx, state } = createContext()
  const on = ctx.on
  ctx.on = undefined
  assert.doesNotThrow(() => apply(ctx))
  const feature = state.pluginApi.features.find((entry) => entry.name === 'workspaceTransactions')
  assert.equal(feature?.isActive, false)
  assert.throws(() => state.pluginApi.workspaceTransactions.prepare({}), PluginApiFeatureDisabledError)
  // unrelated features stay active
  assert.equal(state.pluginApi.features.find((entry) => entry.name === 'coordination')?.isActive, true)
  assert.equal(state.pluginApi.features.find((entry) => entry.name === 'tasks')?.isActive, false)
  ctx.on = on
})

test('workspaceTransactions mount survives broken optional seams and keeps isolation from coordination/recovery', async () => {
  const { ctx, state } = createContext({
    services: {
      storage: {
        transactionCapability() { throw new Error('broken probe') },
        domainUnit: null,
      },
      workspaces: {
        capabilitiesFor() { throw new Error('broken authority probe') },
      },
    },
  })
  assert.doesNotThrow(() => apply(ctx))
  const feature = state.pluginApi.features.find((entry) => entry.name === 'workspaceTransactions')
  assert.equal(feature?.isActive, true)
  // isolation: coordination, recovery, and the rest stay active
  assert.equal(state.pluginApi.features.find((entry) => entry.name === 'coordination')?.isActive, true)
  assert.equal(state.pluginApi.features.find((entry) => entry.name === 'recovery')?.isActive, true)
})