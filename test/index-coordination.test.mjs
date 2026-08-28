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
  return { ctx, state }
}

const resource = { scope: 'workspace', key: 'mounted-resource' }

test('healthy apply mounts the host coordination surface after recovery and before diagnostics', async () => {
  const { ctx, state } = createContext()
  assert.doesNotThrow(() => apply(ctx))
  const names = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').map((entry) => entry.name)
  assert.ok(names.includes('coordination'))
  assert.ok(names.indexOf('recovery') < names.indexOf('coordination'))
  assert.ok(names.indexOf('coordination') < names.indexOf('diagnostics'))
  const coordination = state.pluginApi.coordination
  assert.equal(typeof coordination.acquire, 'function')
  assert.equal(typeof coordination.heartbeat, 'function')
  assert.equal(typeof coordination.release, 'function')
  assert.equal(typeof coordination.takeover, 'function')
  assert.equal(typeof coordination.compareAndSet, 'function')
  assert.equal(typeof coordination.watch, 'function')
  assert.equal(typeof coordination.availability, 'function')
  const acquired = await coordination.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  assert.equal(acquired.ok, true)
  assert.equal(acquired.handle.backend.id, 'memory')
  const released = await coordination.release(acquired.handle)
  assert.equal(released.ok, true)
})

test('coordination typed results keep other facade surfaces intact', async () => {
  const { ctx, state } = createContext()
  apply(ctx)
  const coordination = state.pluginApi.coordination
  const conflict = await coordination.takeover({ resource, ownerId: 'owner', leaseMs: 60_000 })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.code, 'invalid-input')
  assert.equal(typeof state.pluginApi.executions.recovery.evaluate, 'function')
  assert.equal(typeof state.pluginApi.executions.observe, 'function')
})

test('unresolvable optional services keep coordination active on the memory backend and apply fail-safe', async () => {
  const { ctx, state } = createContext()
  const resolve = ctx.get
  ctx.get = (name) => (name === 'pluginApi' ? resolve(name) : undefined)
  assert.doesNotThrow(() => apply(ctx))
  const feature = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((entry) => entry.name === 'coordination')
  assert.equal(feature?.isActive, true)
  const outcome = await state.pluginApi.coordination.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.handle.backend.id, 'memory')
  // unrelated features stay active
  assert.equal(state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((entry) => entry.name === 'recovery')?.isActive, true)
})

test('stale coordination facade is typed unavailable after its owner slot is unmounted', async () => {
  const { ctx, state } = createContext()
  apply(ctx)
  const old = state.pluginApi.coordination
  const token = state.pluginApi._readSlot('coordination')
  assert.ok(token)
  const removed = state.pluginApi.unmountFeature('coordination', state.pluginApi._coordinationSlot)
  assert.equal(removed, true)
  assert.throws(() => old.acquire({ resource, ownerId: 'owner', leaseMs: 1_000 }), PluginApiFeatureDisabledError)
  // the disabled surface reports the feature as unavailable through typed errors
  assert.throws(() => state.pluginApi.coordination.heartbeat({}), PluginApiFeatureDisabledError)
})

test('repeated apply is idempotent and keeps the live coordination surface', async () => {
  const { ctx, state } = createContext()
  apply(ctx)
  apply(ctx)
  const acquire = await state.pluginApi.coordination.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  assert.equal(acquire.ok, true)
  await state.pluginApi.coordination.release(acquire.handle)
})

test('coordination mount survives a broken storage host report (fail-safe selection)', async () => {
  const { ctx, state } = createContext({
    services: {
      storage: {
        coordinationCapability() { throw new Error('broken probe') },
        domainUnit: null,
      },
    },
  })
  assert.doesNotThrow(() => apply(ctx))
  const outcome = await state.pluginApi.coordination.acquire({ resource, ownerId: 'owner', leaseMs: 60_000 })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.handle.backend.id, 'memory')
})