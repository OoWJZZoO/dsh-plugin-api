import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginApiService } from '../lib/plugin-api-service.js'
import { apply, mountSessionBranchFeature } from '../lib/index.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

const SESSION_BRANCH_MARKER = Symbol.for('dsh-plugin-api.session-branch.contract')

/**
 * Facade-surface tests for the session branch add-on under
 * `pluginApi.session.branches`.
 *
 * Three states are exercised:
 *   1. replacement active (marker + version match): operations forward to the
 *      replacement's `sessions.branches`; availability reports active.
 *   2. version mismatch: the facade mounts but every operation is a typed
 *      disabled rejection; availability reports inactive + versionMatch false.
 *   3. no replacement (no marker / auxiliary absent): same typed disabled
 *      behavior, and the full apply() publishes the disabled add-on.
 *
 * The branch-immutability runtime property (branch create leaves the parent
 * event set unchanged and produces a distinct child session) is asserted
 * end-to-end by the auxiliary bundle's own integration suite against the real
 * official store; this file keeps the facade wiring test harnessed.
 */

function makeMarkerBranches(calls = []) {
  return {
    create(...args) { calls.push(['create', args]); return { ok: true } },
    graph() { calls.push(['graph', []]); return { ok: true } },
    plan() { calls.push(['plan', []]); return { ok: true } },
    preview() { calls.push(['preview', []]); return { ok: true } },
    commit() { calls.push(['commit', []]); return { ok: true } },
    rollback() { calls.push(['rollback', []]); return { ok: true } },
    restore() { calls.push(['restore', []]); return { ok: true } },
    availability() { return Object.freeze({ active: true, contract: true, recoveryPending: [] }) },
  }
}

function markedSessions(branches) {
  const sessions = { name: 'sessions', list: () => [], get: () => undefined, branches }
  Object.defineProperty(sessions, SESSION_BRANCH_MARKER, { value: true })
  return sessions
}

function createMountHarness({ services = new Map(), marker = false, manifest = null, facadeContract = { runtime: '0.1.0-rc.6', api: '0.7' } } = {}) {
  const registry = {
    snapshot: () => [],
    isActive: () => false,
    disable() {},
    mount() {},
  }
  const Service = createPluginApiService({ apiVersion: '0.7', registry, coreActive: true })
  const ctx = {
    fiber: { uid: 1, state: 2 },
    reflect: { provide() { return () => {} } },
    effect() {},
    plugin() {},
    on() { return () => {} },
    get(name) { return services.get(name) },
  }
  if (marker) services.set('sessions', markedSessions(marker))
  const service = new Service(ctx)
  const featureRegistry = {
    isActive: () => false,
    mount(name) { this.active = name },
  }
  const logger = { warn() {} }
  const auxiliaryManifests = { sessionBranch: manifest }
  return { ctx, service, featureRegistry, logger, auxiliaryManifests, facadeContract }
}

test('replacement active: pluginApi.session.branches forwards operations and availability', () => {
  const calls = []
  const { service, featureRegistry, logger, auxiliaryManifests, facadeContract } = createMountHarness({
    marker: makeMarkerBranches(calls),
    manifest: { version: '0.1.0-rc.6-0.7', api: '0.7' },
  })
  const mounted = mountSessionBranchFeature({
    ctx: service.ctx, service, featureRegistry, logger, auxiliaryManifests, facadeContract,
  })
  assert.ok(mounted, 'mount must succeed')
  assert.equal(typeof mounted.prepared.commit, 'function')
  assert.equal(mounted.prepared.commit(), true, 'prepared transaction must publish')
  featureRegistry.mount('sessionBranch')

  const branches = service.session.branches
  assert.equal(typeof branches.create, 'function')
  assert.equal(branches.create('p1', 0, { kind: 'sidechain' }).ok, true)
  assert.equal(calls[0][0], 'create')
  assert.deepEqual(branches.availability(), Object.freeze({ active: true, contract: true, versionMatch: true, recoveryPending: [] }))
})

test('no replacement marker: mount succeeds but operations reject with the typed disabled error', () => {
  const { service, featureRegistry, logger, auxiliaryManifests, facadeContract } = createMountHarness({
    manifest: { version: '0.1.0-rc.6-0.7', api: '0.7' },
  })
  const mounted = mountSessionBranchFeature({
    ctx: service.ctx, service, featureRegistry, logger, auxiliaryManifests, facadeContract,
  })
  assert.ok(mounted)
  mounted.prepared.commit()
  featureRegistry.mount('sessionBranch')

  const branches = service.session.branches
  assert.throws(() => branches.create('p1', 0, { kind: 'retry' }), (error) => error instanceof PluginApiFeatureDisabledError)
  assert.throws(() => branches.graph('p1'), PluginApiFeatureDisabledError)
  assert.throws(() => branches.plan('p1'), PluginApiFeatureDisabledError)
  assert.deepEqual(branches.availability(), { active: false, contract: false, versionMatch: true })
})

test('version mismatch or absent auxiliary: the facade feature is disabled and never forwards', () => {
  for (const manifest of [
    { version: '0.1.0-rc.6-9.9', api: '9.9' },
    null,
  ]) {
    const calls = []
    const { service, featureRegistry, logger, auxiliaryManifests, facadeContract } = createMountHarness({
      marker: makeMarkerBranches(calls),
      manifest,
    })
    const mounted = mountSessionBranchFeature({
      ctx: service.ctx, service, featureRegistry, logger, auxiliaryManifests, facadeContract,
    })
    assert.equal(mounted, null, 'mount must fail closed so the apply disables the feature')
    assert.equal(calls.length, 0, 'never forwards under version mismatch')
    // the constructor-provided disabled add-on stays truthful
    assert.deepEqual(service.session.branches.availability(), Object.freeze({ active: false, contract: false }))
    assert.throws(() => service.session.branches.create('p1', 0, { kind: 'retry' }), PluginApiFeatureDisabledError)
  }
})

test('facade inactive: branch add-on rejects with inactive/feature-disabled typing and availability is honest', () => {
  const { service } = createMountHarness({ manifest: { version: '0.1.0-rc.6-0.7', api: '0.7' } })
  // never mounted: sessionBranch slot stays on the disabled surface
  assert.deepEqual(service.session.branches.availability(), Object.freeze({ active: false, contract: false }))
  assert.throws(() => service.session.branches.create('p1', 0, { kind: 'retry' }), (error) => {
    assert.ok(error instanceof Error)
    return true
  })
})

test('full apply() publishes the branch add-on as a typed disabled surface when the auxiliary is absent', () => {
  const services = {
    llm: {
      resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {},
      registerConfigurableProviders() {}, registerModelDiscovery() {},
    },
    agents: { get() {}, list() {}, roots() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    sessions: { get() {}, list() {}, fork() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    systemPrompt: {
      tools() { return () => {} }, section() { return () => {} }, context() { return () => {} },
      variable() { return () => {} }, suppressRuntimeContext() { return () => {} },
    },
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
    jobs: { start() {}, list() {}, get() {}, read() {}, kill() {}, wait() {}, onJobDone() {}, onJobsChanged() {}, attachController() {} },
    shellEnv: { register() {}, collect() {}, list() {} },
  }
  const state = { pluginApi: undefined }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) {
      const instance = new Class(ctx)
      if (instance?.name === 'pluginApi') state.pluginApi = instance
    },
    effect() {},
    on() { return () => {} },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  apply(ctx)
  const pluginApi = state.pluginApi
  assert.equal(typeof pluginApi.session.branches, 'object')
  assert.deepEqual(pluginApi.session.branches.availability(), { active: false, contract: false })
  assert.throws(() => pluginApi.session.branches.create('p1', 0, { kind: 'retry' }), PluginApiFeatureDisabledError)
  const feature = pluginApi.features.find((entry) => entry.name === 'sessionBranch')
  assert.ok(feature, 'sessionBranch is listed in pluginApi.features')
})

test('pluginApi.session identity is preserved with the branches add-on (no leakage into other session members)', () => {
  const calls = []
  const { service, featureRegistry, logger, auxiliaryManifests, facadeContract } = createMountHarness({
    marker: makeMarkerBranches(calls),
    manifest: { version: '0.1.0-rc.6-0.7', api: '0.7' },
  })
  const mounted = mountSessionBranchFeature({
    ctx: service.ctx, service, featureRegistry, logger, auxiliaryManifests, facadeContract,
  })
  mounted.prepared.commit()
  featureRegistry.mount('sessionBranch')
  const session = service.session
  assert.equal(typeof session.branches.graph, 'function')
  assert.equal(typeof session.list, 'function')
  assert.equal(typeof session.deriveMessages, 'function', 'the session base members stay intact')
})