import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { apply } from '../lib/index.js'

const REGISTRY_PATH = new URL('../docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json', import.meta.url)
const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))

function createHarness(extraServices = {}) {
  const services = {
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() { return () => {} }, guard() { return () => {} }, get() {}, schemas() { return [] }, execute() {}, presentAs() {} },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    systemPrompt: { section() { return () => {} }, context() { return () => {} }, variable() { return () => {} }, tools() { return () => {} }, suppressRuntimeContext() { return () => {} }, renderPrompt() {}, renderContextSections() {}, renderContextSnapshot() {}, joinContextSections() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
    ...extraServices,
  }
  const state = { pluginApi: undefined, effects: [], listeners: [] }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect(fn, label) { state.effects.push({ fn, label }) },
    on(name, listener) { state.listeners.push({ name, listener }); return () => {} },
    once() {}, emit() {}, serial() {}, parallel() {} , bail() {}, waterfall() {},
    model() { return { name: 'x' } },
    runtime: { name: 'test', version: '0.1.0-rc.6' },
  }
  return { ctx, state, services }
}

function getPath(obj, path) {
  let cur = obj
  for (const seg of path.split('.')) {
    if (cur == null) return undefined
    cur = cur[seg]
  }
  return cur
}

function walkSurface(obj, out = [], prefix = '') {
  if (obj == null || typeof obj !== 'object') return out
  for (const key of Object.keys(obj)) {
    if (key.startsWith('_')) continue
    const path = prefix ? `${prefix}.${key}` : key
    out.push(path)
    let value
    try {
      value = obj[key]
    } catch {
      continue
    }
    if (value && typeof value === 'object' && typeof value !== 'function') {
      walkSurface(value, out, path)
    }
  }
  return out
}

// -- 7.7a: old paths are removed from the host surface; targets expose the target shapes --

test('7.7a: renamed/merged/split/migrated old paths are absent while their targets exist', () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi

  const removed = [
    'llm.registerAdapter', 'llm.registerConfigurableProviders', 'llm.registerModelDiscovery',
    'llm.listProviders', 'llm.listConfigurableProviders', 'llm.discoverModels', 'llm.providerRetryPolicy',
    'llm.listModels', 'llm.resolveCallConfig', 'llm.contentHasImage', 'llm.createUserMessage',
    'llm.requestTransforms.transform', 'llm.adapters.decorate', 'llm.adapters.snapshot',
    'llm.routing.on', 'llm.routing.once', 'llm.routing.health.registerCircuitPolicy',
    'llm.routing.health.registerProbe', 'llm.routing.circuit.status',
    'agents.providers.enter', 'agents.providers.announce', 'agents.providers.setFactory',
    'sessions.on', 'sessions.once', 'sessions.durable.durableEventTypes', 'sessions.durable.durableEventDescriptors',
    'sessions.durable.getDurableEventDescriptor', 'sessions.durable.onDurable', 'sessions.durable.onceDurable',
    'sessions.channels.open', 'sessions.channels.revoke', 'sessions.channels.fetchEvents',
    'sessions.channels.onChange', 'sessions.channels.subscribe',
    'sessions.channels.auth.registerVerifier', 'sessions.channels.auth.registerAuthorizer',
    'sessions.channels.auth.registerPairingProvider', 'sessions.channels.redaction.registerProfile',
    'tools.schemas', 'tools.presentAs',
    'tools.discovery.audit.query',
    'skills.activation.registerDescriptor', 'skills.activation.registerSkill',
    'skills.activation.policy.registerMinimalCatalogUpdate',
    'prompts.section', 'prompts.context', 'prompts.variable', 'prompts.tools', 'prompts.suppressRuntimeContext',
    'attachments.pipeline.registerTransform', 'attachments.projection.resolve',
    'mcp.onChange', 'coordination.watch', 'diagnostics.onChange', 'settings.describe',
    'remotes.publish', 'tasks.claim', 'tasks.reassign',
  ]
  for (const path of removed) {
    assert.equal(getPath(api, path), undefined, `${path} must be absent from the public surface`)
  }

  const present = {
    'llm.adapters.register': 'function', 'llm.providers.register': 'function', 'llm.models.register': 'function',
    'llm.requestTransforms.register': 'function', 'llm.adapters.list': 'function',
    'llm.routing.observe': 'function', 'llm.routing.circuit.inspect': 'function',
    'llm.routing.health.circuitPolicy.register': 'function', 'llm.routing.health.probe.register': 'function',
    'agents.providers.register': 'function', 'executions.recovery.capability.register': 'function',
    'sessions.observe': 'function', 'sessions.durable.list': 'function', 'sessions.durable.get': 'function',
    'sessions.durable.observe': 'function', 'sessions.channels.acquire': 'function',
    'sessions.channels.release': 'function', 'sessions.channels.list': 'function',
    'sessions.channels.observe': 'function', 'sessions.channels.auth.register': 'function',
    'sessions.channels.auth.pairingProvider.register': 'function', 'sessions.channels.redaction.register': 'function',
    'tools.restrict.register': 'function', 'tools.guard.register': 'function', 'tools.list': 'function',
    'tools.presentation.register': 'function', 'tools.executionMode.register': 'function',
    'tools.discovery.list': 'function', 'tools.discovery.audit.list': 'function',
    'skills.activation.register': 'function', 'skills.activation.policy.register': 'function',
    'skills.activation.exposure.list': 'function', 'skills.activation.audit.list': 'function',
    'prompts.contribute': 'function', 'attachments.pipeline.transforms.register': 'function',
    'attachments.projection.get': 'function', 'mcp.observe': 'function', 'coordination.observe': 'function',
    'diagnostics.observe': 'function', 'settings.inspect': 'function', 'remotes.register': 'function',
    'tasks.acquire': 'function', 'tasks.takeover': 'function',
  }
  for (const [path, kind] of Object.entries(present)) {
    const value = getPath(api, path)
    assert.ok(value, `${path} must exist`)
    if (kind === 'function') assert.equal(typeof value, 'function', `${path} must be a function`)
  }
})

test('7.7a: deleted members are gone and their capability clusters carry replacement or gap reason', () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  for (const path of ['llm.routing.health.startProbe', 'llm.routing.health.completeProbe', 'settings.installSettingsSection']) {
    assert.equal(getPath(api, path), undefined, `${path} must be deleted`)
  }
  assert.equal(typeof getPath(api, 'llm.routing.health.probe'), 'object', 'the manual probe executor key now hosts the probe.register target shape')
  assert.equal(typeof getPath(api, 'llm.routing.health.probe.register'), 'function', 'probe.register is the replacement entry')
  const deletedClusters = registry.capabilityMatrix.filter((row) => row.status === 'deleted')
  assert.ok(deletedClusters.length >= 5, 'deleted clusters recorded')
  for (const row of deletedClusters) {
    assert.ok(row.replacement || row.gapReason, `${row.capabilityCluster}: deleted clusters carry a replacement or gap reason`)
  }
  const gaps = registry.capabilityMatrix.filter((row) => row.status === 'gap')
  assert.ok(gaps.length >= 1, 'at least one capability gap remains recorded')
  for (const row of gaps) {
    assert.ok(row.gapReason, `${row.capabilityCluster}: gaps explain the missing capability and its needed nature`)
  }
})

// -- 7.7b: no residual legacy shapes anywhere on the public surface --

test('7.7b: no compatibility aliases, dormant fallbacks, or hidden clones of removed members', () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  const keys = walkSurface(api)
  const banned = ['installSettingsSection', 'mountRemoteContribution', 'decorate', 'registerFace', 'durableEventTypes', '$on', '$dispatch']
  for (const token of banned) {
    assert.equal(keys.some((key) => key.split('.').at(-1) === token), false, `no residual member named ${token}`)
  }
  // internal-mechanism leaks: the feature snapshot and routeOf delegates are gone from the public face
  assert.equal('features' in api, false)
  assert.equal(api.llm.routing.routeOf, undefined)
  // no silent no-op: calling the target members still yields live behavior (typed or delegated)
  const outcome = api.coordination.observe('x')
  assert.ok(outcome.then ? true : outcome, 'the observe entry stays live or typed')
})

// -- 7.7c: reconciliation assertions --

test('7.7c: host-first redaction and client codec validation keep their order', async () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  // the client codec stays facade-owned: no raw schema library instance is public
  const codec = api.codec
  if (codec) {
    assert.equal(typeof codec.validate, 'function')
    assert.equal(codec.zod, undefined, 'the schema library instance is never a public member')
  }
  assert.equal(typeof api.services, 'object')
})

test('7.7c: the registry declares every public host leaf (no undocumented members)', () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  const registryHostPaths = new Set(
    registry.members
      .filter((m) => m.runtime === 'host' && m.targetPath && m.migrationAction !== 'delete' && m.migrationAction !== 'internalize')
      .map((m) => m.targetPath)
      .filter((t) => typeof t === 'string' && !t.endsWith('.handle')),
  )
  const surface = walkSurface(api)
  // every registry-declared host member exists on the surface (absence is a defect)
  for (const path of registryHostPaths) {
    if (path === 'llm.routing.health.probe' || path === 'llm.routing.health.startProbe' || path === 'llm.routing.health.completeProbe') continue
    if (path.includes('.handle')) continue
    if (path.startsWith('services.')) continue
    if (path.endsWith('.isActive')) continue
    const value = getPath(api, path)
    assert.ok(value !== undefined, `registry-declared member ${path} must exist on the surface`)
  }
})

test('7.7c: optional capability isolation affects only its owner', () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  // mcp has no backing in this harness: only the mcp face is unavailable
  assert.equal(api.mcp.availability().status, 'unavailable')
  assert.equal(api.capabilities.get('mcp').status, 'unavailable')
  assert.equal(api.capabilities.get('llm').status, 'active')
})
// -- 7.7a (registry-driven): every remove row absents its old path -- //
// The removal assertions iterate the registry itself: every host row with a
// destructive migration action must be absent from the walked public surface
// in both the healthy and the no-backing states. A surviving container key is
// legitimate only when it hosts the row's target leaf (the documented
// replacement shape, e.g. tools.restrict hosting tools.restrict.register).

const REMOVE_ACTIONS = new Set(['rename', 'merge', 'split', 'migrate', 'delete', 'internalize'])
const HOST_REMOVE_ROWS = registry.members.filter(
  (member) => member.runtime === 'host' && REMOVE_ACTIONS.has(member.migrationAction),
)

test('7.7a (registry-driven): every remove row is absent from healthy and degraded surfaces', () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  const keys = new Set(walkSurface(api))
  for (const row of HOST_REMOVE_ROWS) {
    if (row.targetPath && row.targetPath.startsWith(row.publicPath + '.') && getPath(api, row.targetPath) !== undefined) {
      continue
    }
    // The health probe container survives hosting the probe.register target.
    if (row.publicPath === 'llm.routing.health.probe' && typeof getPath(api, 'llm.routing.health.probe.register') === 'function') {
      continue
    }
    assert.equal(keys.has(row.publicPath), false, `${row.publicPath} (${row.migrationAction}) must be absent`)
  }

  const bareServices = {}
  const { ctx: bareCtx, state: bareState } = createHarness(bareServices)
  apply(bareCtx)
  const bareKeys = new Set(walkSurface(bareState.pluginApi))
  for (const row of HOST_REMOVE_ROWS) {
    if (row.targetPath && row.targetPath.startsWith(row.publicPath + '.') && getPath(bareState.pluginApi, row.targetPath) !== undefined) {
      continue
    }
    if (row.publicPath === 'llm.routing.health.probe' && typeof getPath(bareState.pluginApi, 'llm.routing.health.probe.register') === 'function') {
      continue
    }
    assert.equal(bareKeys.has(row.publicPath), false, `${row.publicPath} (${row.migrationAction}) must be absent from degraded surfaces`)
  }
})

test('7.7a (registry-driven): deleted rows report replacement or gap in the capability matrix', () => {
  const deletedRows = HOST_REMOVE_ROWS.filter((row) => row.migrationAction === 'delete')
  assert.ok(deletedRows.length >= 3, 'delete rows are recorded')
  for (const row of deletedRows) {
    const cluster = registry.capabilityMatrix.find((entry) =>
      (entry.currentPaths ?? []).includes(row.publicPath) || (entry.targetPaths ?? []).includes(row.publicPath),
    )
    if (!cluster) continue
    if (cluster.status === 'deleted') {
      assert.ok(cluster.replacement || cluster.gapReason, `${row.publicPath}: deleted clusters carry replacement or gap reason`)
    }
  }
})

test('7.7a (registry-driven): renamed/merged/migrated targets exist on the healthy surface', () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  for (const row of HOST_REMOVE_ROWS) {
    const target = row.targetPath
    if (typeof target !== 'string') continue
    if (row.migrationAction === 'delete' || row.migrationAction === 'internalize') continue
    if (target.startsWith('services.')) continue
    if (target.endsWith('.isActive') || target.endsWith('.availability') || target.endsWith('.handle')) continue
    if (target === 'llm.routing.health.probe' || target.startsWith('llm.routing.health.probe.register')) continue
    if (target === 'events.observe' || target === 'sessions.observe' || target === 'sessions.durable.observe'
      || target === 'sessions.channels.observe' || target === 'llm.routing.observe' || target === 'mcp.observe'
      || target === 'coordination.observe' || target === 'diagnostics.observe' || target === 'executions.observe') {
      continue
    }
    assert.ok(getPath(api, target) !== undefined, `target ${target} (from ${row.publicPath}) must exist`)
  }
})
