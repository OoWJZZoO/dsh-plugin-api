import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, mountContextFeature, resolveMarkedEvidenceSlice } from '../lib/index.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from '../lib/errors.js'
import { COMPACTION_EVENTS_CONTRACT_SYMBOL } from '../lib/compaction-events-catalog.js'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'

const EVIDENCE_ACTIVE_MARKER = Symbol.for('dsh-plugin-api.agent-loop.assembled-evidence')
const ROUTE_POLICY_COMPONENT_MARKER = Symbol.for('dsh-plugin-api.agent-loop.contract')

function createServicePlatform(host) {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({
    apiVersion: '0.1',
    registry,
    coreActive: () => true,
  })
  new ServiceClass(host.ctx)
  return { service: host.state.pluginApi, registry }
}

function createHost(options = {}) {
  const sections = []
  const systemPrompt = {
    section(section) {
      if (!Number.isFinite(section.order)) throw new TypeError(`prompt section "${section.name}" order must be a finite number`)
      sections.push(section)
      return () => {
        const index = sections.indexOf(section)
        if (index >= 0) sections.splice(index, 1)
      }
    },
    context() { return () => {} },
    variable() { return () => {} },
    tools() { return () => {} },
    suppressRuntimeContext() { return () => {} },
    assemble(context) {
      const assembledSections = [...sections].sort((a, b) => a.order - b.order)
        .map((section) => ({ name: section.name, text: typeof section.text === 'function' ? section.text(context) : section.text }))
      return { sections: assembledSections, contexts: [], tools: [], variables: {} }
    },
  }
  const services = {
    llm: {
      resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {},
      registerConfigurableProviders() {}, registerModelDiscovery() {},
    },
    agents: { get() {}, list() {}, roots() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    sessions: { get() {}, list() {}, fork() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    systemPrompt,
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
    jobs: {
      start() {}, list() {}, get() {}, read() {}, kill() {}, wait() {},
      onJobDone() {}, onJobsChanged() {}, attachController() {},
    },
    shellEnv: { register() {}, collect() {}, list() {} },
    ...options.services,
  }
  const state = { pluginApi: undefined, effects: [], listeners: [] }
  const ctx = {
    logger: options.logger ?? { error() {}, warn() {} },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') state.pluginApi = value
      },
    },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      if (options.throwGet === name) throw new Error(`${name} lookup failed`)
      return services[name]
    },
    plugin(Class) {
      new Class(ctx)
    },
    effect(fn, label) {
      state.effects.push({ fn, label })
    },
    on(name, listener) {
      state.listeners.push({ name, listener })
      let disposed = false
      return () => {
        if (disposed) return false
        disposed = true
        const index = state.listeners.findIndex((entry) => entry.listener === listener)
        if (index >= 0) state.listeners.splice(index, 1)
        return index >= 0
      }
    },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  if (options.evidenceComposition) {
    ctx.root = ctx
    ctx.loader = { entries: () => options.loaderEntries ?? [] }
  }
  return { ctx, services, state }
}

const EVIDENCE_PAYLOAD = (overrides = {}) => ({
  sessionId: 'session-1',
  generation: 1,
  systemSections: [{ sectionKey: 'deployment:persona', sourceTags: [] }],
  messageRanges: [],
  dropped: [],
  observedAt: '2026-08-26T10:00:00.000Z',
  ...overrides,
})

function spec(overrides = {}) {
  return {
    id: 'node-1',
    owner: 'plugin-a',
    scope: { kind: 'session', key: 'session-1' },
    phase: 'default',
    priority: 'normal',
    source: { kind: 'systemPrompt', owner: 'plugin-a' },
    sectionKey: 'deployment:persona',
    audience: { model: true, ui: false, diagnostic: true },
    ...overrides,
  }
}

test('context feature mounts through apply and serves the full lifecycle', () => {
  const host = createHost()
  apply(host.ctx)
  const context = host.ctx.get('pluginApi').prompts.provenance
  assert.ok(context, 'pluginApi.prompts.provenance exists')
  const registered = context.contribute(spec())
  assert.equal(registered.ok, true)
  const graph = context.compose({ sessionId: 'session-1' })
  assert.equal(graph.nodes.length, 1)
  assert.equal(graph.nodes[0].state, 'served')
  const availability = context.availability()
  assert.equal(availability.active, true)
  assert.equal(availability.sentReachable, false, 'no evidence slice in this composition')
  assert.equal(availability.skillExposure, 'unavailable', 'the sibling skill feature is not integrated')
  // feature appears active in the registry snapshot
  const features = host.ctx.get('pluginApi')._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough')
  const contextState = features.find((feature) => feature.name === 'context')
  assert.ok(contextState)
  assert.equal(contextState.isActive, true)
})

test('evidence resolver gates: marker, loader composition, and version contract must all match', () => {
  const marker = {
    package: '@deepseek-ai/dsh-plugin-api-agent-loop',
    rowId: 'plugin-api-agent-loop',
    runtime: '0.1.0-rc.6',
    api: '0.1',
  }
  const fakeReader = (name) => ({
    version: '0.1.0-rc.6-0.1.0',
    api: '0.1',
  })
  const baseCtx = () => {
    const ctx = {
      loader: { entries: () => [
        { options: { id: 'agent-loop', disabled: true } },
        { options: { id: 'plugin-api-agent-loop', disabled: false } },
      ] },
      get(name) { return name === 'agentLoop' ? { [EVIDENCE_ACTIVE_MARKER]: true } : undefined },
    }
    ctx.root = ctx
    ctx[ROUTE_POLICY_COMPONENT_MARKER] = marker
    return ctx
  }
  const resolve = (overrides = {}) => resolveMarkedEvidenceSlice({ ...baseCtx(), ...overrides }, { readManifest: fakeReader })
  assert.notEqual(resolve(), null, 'all gates pass')
  const noMarker = baseCtx()
  delete noMarker[ROUTE_POLICY_COMPONENT_MARKER]
  assert.equal(resolveMarkedEvidenceSlice(noMarker, { readManifest: fakeReader }), null)
  const officialEnabled = baseCtx()
  officialEnabled.loader = { entries: () => [
    { options: { id: 'agent-loop', disabled: false } },
    { options: { id: 'plugin-api-agent-loop', disabled: false } },
  ] }
  assert.equal(resolveMarkedEvidenceSlice(officialEnabled, { readManifest: fakeReader }), null)
  const duplicated = baseCtx()
  duplicated.loader = { entries: () => [
    { options: { id: 'agent-loop', disabled: true } },
    { options: { id: 'plugin-api-agent-loop', disabled: false } },
    { options: { id: 'plugin-api-agent-loop', disabled: false } },
  ] }
  assert.equal(resolveMarkedEvidenceSlice(duplicated, { readManifest: fakeReader }), null)
  const mismatched = baseCtx()
  mismatched[ROUTE_POLICY_COMPONENT_MARKER] = { ...marker, api: '0.5' }
  assert.equal(resolveMarkedEvidenceSlice(mismatched, { readManifest: fakeReader }), null)
  const noAgentMarker = baseCtx()
  noAgentMarker.get = (name) => name === 'agentLoop' ? { [EVIDENCE_ACTIVE_MARKER]: false } : undefined
  assert.equal(resolveMarkedEvidenceSlice(noAgentMarker, { readManifest: fakeReader }), null)
})

test('evidence intake end-to-end via direct mount: emitted payloads transition nodes to sent', () => {
  const host = createHost({
    services: { agentLoop: { [EVIDENCE_ACTIVE_MARKER]: true } },
  })
  const platform = createServicePlatform(host)
  const owner = mountContextFeature({
    ctx: host.ctx,
    service: platform.service,
    featureRegistry: platform.registry,
    logger: { error() {}, warn() {} },
    evidenceResolver: () => ({ slice: 'active' }),
  })
  assert.ok(owner)
  owner.prepared.commit()
  const context = platform.service.prompts.provenance
  assert.equal(context.availability().sentReachable, true)
  context.contribute(spec())
  context.compose({ sessionId: 'session-1' })
  const listener = host.state.listeners.find((entry) => entry.name === 'agent-loop/assembled-context')
  assert.ok(listener, 'evidence subscription installed')
  listener.listener(EVIDENCE_PAYLOAD())
  const graph = context.compose({ sessionId: 'session-1' })
  assert.equal(graph.nodes[0].state, 'sent')
  assert.equal(graph.nodes[0].sentBy.evidenceId, '1')
  owner.disposer()
})

test('compaction completed events become replacement mappings end-to-end', () => {
  const host = createHost({
    services: {
      compaction: { [COMPACTION_EVENTS_CONTRACT_SYMBOL]: true },
    },
  })
  apply(host.ctx)
  const context = host.ctx.get('pluginApi').prompts.provenance
  const surface = context.contribute(spec({
    id: 'surface-node',
    source: { kind: 'sessionSurface', owner: 'plugin-a' },
    sourceEventSeqs: [10, 11, 12],
  }))
  assert.equal(surface.ok, true)
  const listener = host.state.listeners.find((entry) => entry.name === 'compaction/completed')
  assert.ok(listener, 'compaction intake subscription installed')
  listener.listener({
    session: { id: 'session-1' },
    agent: { session: { id: 'session-1' } },
    trigger: 'pressure',
    result: { compactionId: 'c-1', shadowedSeqs: [10, 11, 12], summarySeq: 13 },
  })
  const entries = context.mapping({ sessionId: 'session-1' })
  assert.equal(entries.ok, true)
  assert.equal(entries.entries.length, 1)
  assert.equal(entries.entries[0].newNodeId, 'compaction:c-1')
  assert.deepEqual(entries.entries[0].oldNodeIds, ['surface-node'])
  const inspect = context.inspect('session-1')
  assert.equal(inspect.archived[0].node.state, 'archived')
  assert.equal(context.mapping({ sessionId: 'other' }).entries.length, 0)
})

test('soft sources degrade per-source without disabling the feature', () => {
  const host = createHost()
  apply(host.ctx)
  const availability = host.ctx.get('pluginApi').prompts.provenance.availability()
  assert.equal(availability.systemPrompt, 'available', 'official systemPrompt service and helpers present')
  assert.equal(availability.skillExposure, 'unavailable', 'the sibling skills feature is not integrated')
  assert.equal(availability.toolExposure, 'available', 'toolDiscovery is mounted in this composition')
  assert.equal(availability.compaction, 'unavailable', 'no compaction replacement marker in this composition')
})

test('context guard failure disables only the context face and keeps boot alive', () => {
  const host = createHost({ services: { systemPrompt: undefined } })
  apply(host.ctx)
  const service = host.ctx.get('pluginApi')
  assert.throws(() => service.prompts.provenance.contribute({}), (error) => {
    assert.ok(error instanceof PluginApiFeatureDisabledError)
    assert.equal(error.feature, 'prompts.provenance')
    return true
  })
  const features = service._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough')
  const contextState = features.find((feature) => feature.name === 'context')
  assert.ok(contextState, 'feature appears in the registry snapshot')
  assert.equal(contextState.isActive, false)
  assert.equal(typeof service.tools.register, 'function', 'unrelated faces stay alive')
})

test('inactive core keeps the context face typed-inactive', () => {
  const host = createHost()
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({
    apiVersion: '0.1',
    registry,
    coreActive: () => false,
  })
  new ServiceClass(host.ctx)
  const service = host.state.pluginApi
  assert.equal(service.isActive, false)
  assert.throws(() => service.prompts.provenance.compose({ sessionId: 'x' }), (error) => {
    assert.ok(error instanceof PluginApiInactiveError)
    return true
  })
})