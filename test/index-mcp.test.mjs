import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from '../lib/errors.js'

const MCP_COMPONENT_MARKER = Symbol.for('dsh-plugin-api.mcp.contract')

function createTypertRegistry() {
  const noOp = () => {}
  return {
    register: noOp, get: noOp, resolve: noOp, list: noOp, getPackage: noOp, listPackages: noOp, toJSONSchema: noOp,
    local: { get: noOp, hasSeen: noOp, list: noOp, subscribe: noOp },
    remotes: { register: noOp, get: noOp, list: noOp, subscribe: noOp },
    lookups: { register: noOp, configure: noOp, get: noOp, definitions: noOp, keys: noOp, subscribe: noOp },
    contexts: { registerHost: noOp, configureHost: noOp, registerClient: noOp, getHost: noOp, getClient: noOp, subscribe: noOp },
  }
}

function createMockCtx(options = {}) {
  const services = {
    llm: {
      resolveModelInfo() {}, prepareCall() {}, stream() {},
      registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {},
    },
    agents: { get() {}, list() {}, roots() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    sessions: { get() {}, list() {}, fork() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    typert: createTypertRegistry(),
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
  }
  const state = { pluginApi: undefined, effects: [], listeners: [], services }
  const ctx = {
    root: {},
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      if (name in services) return services[name]
      return undefined
    },
    plugin(Class) { new Class(ctx) },
    effect(fn, label) { state.effects.push({ fn, label }) },
    on(name, listener) {
      state.listeners.push({ name, listener })
      return () => {}
    },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  return { ctx, state }
}

function createFakeCatalog() {
  const calls = []
  return {
    calls,
    servers(options = {}) { calls.push(['servers', options]); return Object.freeze([{ serverName: 's1', lifecycleState: 'available' }]) },
    tools(options = {}) { calls.push(['tools', options]); return Object.freeze([]) },
    resolvePublicName(publicName) { calls.push(['resolvePublicName', publicName]); return Object.freeze({ identity: { serverName: 's1', rawName: 't1' }, publicName }) },
    onChange(listener) { calls.push(['onChange', listener]); return () => {} },
  }
}

function assertMcpDisabled(action) {
  assert.throws(action, (error) => (
    error instanceof PluginApiFeatureDisabledError && error.feature === 'mcp'
  ))
}

test('pluginApi.mcp is a fixed face that fails closed when no MCP replacement marker is active', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))

  const mcp = state.pluginApi.mcp
  assert.equal(typeof mcp.servers, 'function')
  assert.equal(typeof mcp.tools, 'function')
  assert.equal(typeof mcp.resolvePublicName, 'function')
  assert.equal(typeof mcp.onChange, 'function')
  assertMcpDisabled(() => mcp.servers())
  assertMcpDisabled(() => mcp.tools())
  assertMcpDisabled(() => mcp.resolvePublicName('mcp__s__t'))
  assertMcpDisabled(() => mcp.onChange(() => {}))
})

test('pluginApi.mcp fails closed when a catalog exists but the component marker is absent', () => {
  const catalog = createFakeCatalog()
  const { ctx, state } = createMockCtx()
  state.services.mcpCatalog = catalog
  assert.doesNotThrow(() => apply(ctx))
  assertMcpDisabled(() => state.pluginApi.mcp.servers())
  assert.equal(catalog.calls.length, 0, 'no delegation may happen without the marker')
})

test('pluginApi.mcp fails closed when the marker exists but no catalog service is registered', () => {
  const { ctx, state } = createMockCtx()
  ctx.root[MCP_COMPONENT_MARKER] = { package: '@deepseek-ai/dsh-plugin-api-mcp' }
  assert.doesNotThrow(() => apply(ctx))
  assertMcpDisabled(() => state.pluginApi.mcp.servers())
})

test('pluginApi.mcp delegates queries to the marked replacement catalog when active', () => {
  const catalog = createFakeCatalog()
  const { ctx, state } = createMockCtx()
  state.services.mcpCatalog = catalog
  ctx.root[MCP_COMPONENT_MARKER] = { package: '@deepseek-ai/dsh-plugin-api-mcp' }
  assert.doesNotThrow(() => apply(ctx))

  const mcp = state.pluginApi.mcp
  const servers = mcp.servers({ includeUnavailable: true })
  assert.deepEqual(servers, [{ serverName: 's1', lifecycleState: 'available' }])
  assert.equal(Object.isFrozen(servers), true)

  const resolved = mcp.resolvePublicName('mcp__s1__t1')
  assert.deepEqual(resolved, { identity: { serverName: 's1', rawName: 't1' }, publicName: 'mcp__s1__t1' })

  const disposer = mcp.onChange(() => {})
  assert.equal(typeof disposer, 'function')

  assert.deepEqual(catalog.calls.map(([method]) => method), ['servers', 'resolvePublicName', 'onChange'])
})

test('pluginApi.mcp delegation is resolved lazily per call (facade mounts before the replacement)', () => {
  const catalog = createFakeCatalog()
  const { ctx, state } = createMockCtx()
  ctx.root[MCP_COMPONENT_MARKER] = { package: '@deepseek-ai/dsh-plugin-api-mcp' }
  // Facade applies while no catalog service exists yet.
  assert.doesNotThrow(() => apply(ctx))
  assertMcpDisabled(() => state.pluginApi.mcp.servers())

  // The replacement registers its catalog after the facade applied; the face
  // must now resolve it without any re-mount.
  state.services.mcpCatalog = catalog
  const servers = state.pluginApi.mcp.servers()
  assert.deepEqual(servers, [{ serverName: 's1', lifecycleState: 'available' }])
  assert.equal(catalog.calls[0][0], 'servers')
})

test('pluginApi.mcp methods throw inactive errors when the facade core is inert', () => {
  const previous = process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
  process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = '1'
  try {
    const { ctx, state } = createMockCtx()
    ctx.root[MCP_COMPONENT_MARKER] = { package: '@deepseek-ai/dsh-plugin-api-mcp' }
    assert.doesNotThrow(() => apply(ctx))
    assert.equal(state.pluginApi.isActive, false)
    assert.throws(() => state.pluginApi.mcp.servers(), PluginApiInactiveError)
  } finally {
    if (previous === undefined) delete process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
    else process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = previous
  }
})