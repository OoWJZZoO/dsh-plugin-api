import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { apply, buildToolDiscoveryScopeConstraint } from '../lib/index.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

/**
 * Mock host for the full apply() flow. The systemPrompt stub captures tool
 * providers and sections and reassembles them following the official
 * semantics (per-provider evaluation with structuredClone of parameters,
 * ordered sections, function-valued section text), so index-level tests can
 * drive the real "activation visible at the next assemble" boundary.
 */
function createHost(options = {}) {
  const toolProviders = []
  const sections = []
  let toolsCalls = 0
  const systemPrompt = {
    tools(provider) {
      if (options.throwToolsRegistration) throw new Error('tools registration exploded')
      toolsCalls += 1
      toolProviders.push(provider)
      return () => {
        const index = toolProviders.indexOf(provider)
        if (index >= 0) toolProviders.splice(index, 1)
      }
    },
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
    suppressRuntimeContext() { return () => {} },
  }
  systemPrompt.assemble = (context) => {
    const assembledSections = [...sections].sort((a, b) => a.order - b.order)
      .map((section) => ({ name: section.name, text: typeof section.text === 'function' ? section.text(context) : section.text }))
    const tools = []
    for (const provider of toolProviders) {
      const result = provider(context)
      const schemas = (result?.schemas ?? []).map(({ name, description, parameters }) => ({
        name,
        description,
        parameters: structuredClone(parameters),
      }))
      for (const schema of schemas) tools.push(schema)
    }
    tools.sort((a, b) => (String(a.name) < String(b.name) ? -1 : 1))
    return { sections: assembledSections, contexts: [], tools, variables: {} }
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
  if (options.rootMarker) {
    ctx.root = ctx
    ctx.loader = { entries: () => options.loaderEntries ?? [] }
  }
  return { ctx, services, state, systemPrompt, toolProviders, sections }
}

const DESCRIPTOR = {
  id: 'alpha',
  owner: 'owner-a',
  summary: 'Alpha vision tool',
  capabilities: ['vision'],
  activate: () => [{ name: 'alpha_run', description: 'Runs alpha', parameters: { type: 'object', properties: {} } }],
}

test('full discovery lifecycle through the facade apply', async () => {
  const host = createHost()
  apply(host.ctx)
  const discovery = host.ctx.get('pluginApi').tools.discovery

  const registered = discovery.catalog.register(DESCRIPTOR)
  assert.equal(typeof registered.generation, 'string')

  const before = host.systemPrompt.assemble({ scope: { session: { id: 's1' } } })
  assert.deepEqual(before.tools, [], 'no leakage before activation')

  const handle = await discovery.activate('alpha', { session: { id: 's1' }, reason: 'vision task' })
  const after = host.systemPrompt.assemble({ scope: { session: { id: 's1' } } })
  assert.deepEqual(after.tools.map((tool) => tool.name), ['alpha_run'], 'activation visible at the next assemble')
  const hint = after.sections.find((section) => section.name === 'discovery:hints')
  assert.ok(hint.text.includes('Alpha vision tool'))

  const search = discovery.list('vision', { scope: 's1' })
  assert.equal(search.descriptors.length, 1)
  assert.equal(search.descriptors[0].sourceKind, 'plugin')
  assert.equal(search.constraint.status, 'none', 'no route-policy replacement in this composition')

  const audit = discovery.audit.list({ kind: 'activate' })
  assert.equal(audit.items.length, 1)
  assert.equal(audit.items[0].owner, 'owner-a')

  assert.equal(discovery.deactivate('alpha', { reason: 'retired' }).ok, true)
  await assert.rejects(discovery.activate('alpha', { session: { id: 's1' } }), (error) => error.code === 'DISCOVERY_ENTRY_DEACTIVATED')
  handle.dispose()
  assert.deepEqual(host.systemPrompt.assemble({ scope: { session: { id: 's1' } } }).tools, [])
})

test('feature guard failure disables only the discovery face and keeps boot alive', () => {
  const host = createHost({ services: { systemPrompt: undefined } })
  apply(host.ctx)
  const service = host.ctx.get('pluginApi')
  assert.throws(() => service.tools.discovery.list('x'), (error) => {
    assert.ok(error instanceof PluginApiFeatureDisabledError)
    assert.equal(error.feature, 'tools.discovery')
    return true
  })
  const features = service._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough')
  const discoveryState = features.find((feature) => feature.name === 'toolDiscovery')
  assert.ok(discoveryState, 'feature appears in the registry snapshot')
  assert.equal(discoveryState.isActive, false)
  assert.equal(typeof service.tools.register, 'function', 'unrelated faces stay alive')
})

test('repeated apply is idempotent: the exposure provider and hint register exactly once', () => {
  const host = createHost()
  apply(host.ctx)
  apply(host.ctx)
  assert.equal(host.toolProviders.length, 1, 'provider registered once')
  assert.equal(host.sections.filter((section) => section.name === 'discovery:hints').length, 1, 'hint section registered once')
  const discovery = host.ctx.get('pluginApi').tools.discovery
  discovery.catalog.register(DESCRIPTOR)
  assert.equal(typeof discovery.activate, 'function')
})

test('exposure registration failure degrades only the exposure planes', async () => {
  const host = createHost({ throwToolsRegistration: true })
  apply(host.ctx)
  const discovery = host.ctx.get('pluginApi').tools.discovery
  const availability = discovery.availability()
  assert.equal(availability.status, 'active')
  const registered = discovery.catalog.register(DESCRIPTOR)
  const handle = await discovery.activate('alpha', { session: { id: 's1' } })
  assert.equal(host.systemPrompt.assemble({ scope: { session: { id: 's1' } } }).tools.length, 0, 'no exposure without a provider')
  assert.equal(discovery.list('', { scope: 's1' }).descriptors.length, 1, 'catalog stays usable')
  handle.dispose()
  registered.dispose()
})

test('scope-constraint builder maps route decisions truthfully and never throws', () => {
  const decisions = {
    's1': [{ decisionId: 'd1', commitState: 'denied', reason: { code: 'NO_ELIGIBLE_ROUTE' } }],
    's2': [{ decisionId: 'd2', commitState: 'success', reason: { code: 'POLICY_SELECTED' } }],
  }
  const routePolicy = {
    decisions: {
      history(filters) {
        return { items: decisions[filters.sessionId] ?? [], truncated: false }
      },
    },
  }
  const seam = buildToolDiscoveryScopeConstraint({}, () => routePolicy)
  assert.deepEqual(seam('s1'), { status: 'applied', source: 'route-policy', reason: 'NO_ELIGIBLE_ROUTE', forbidden: [] })
  assert.deepEqual(seam('s2'), { status: 'applied', source: 'route-policy', reason: 'POLICY_SELECTED', forbidden: [] })
  assert.deepEqual(seam('s3'), { status: 'unknown', source: 'route-policy', detail: 'no-route-decision', forbidden: [] })

  const throwing = buildToolDiscoveryScopeConstraint({}, () => ({
    decisions: { history() { throw new Error('history down') } },
  }))
  assert.deepEqual(throwing('s1'), { status: 'unknown', source: 'route-policy', detail: 'route-decision-read-failed', forbidden: [] })

  assert.equal(buildToolDiscoveryScopeConstraint({}, () => null), null)
  assert.equal(buildToolDiscoveryScopeConstraint({}, () => { throw new Error('resolver down') }), null)
  assert.equal(buildToolDiscoveryScopeConstraint({}, () => ({ decisions: {} })), null)
})

test('no client face exists for discovery (read-only host projection boundary)', () => {
  const libDir = new URL('../lib/', import.meta.url)
  const clientFiles = readdirSync(libDir).filter((name) => name.startsWith('client'))
  assert.ok(clientFiles.length > 0)
  for (const name of clientFiles) {
    const source = readFileSync(join(libDir.pathname, name), 'utf8')
    assert.equal(/tools\.discovery|tool-discovery|ToolDiscovery|DISCOVERY_/i.test(source), false, `${name} must not carry a discovery face`)
  }
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const inject = manifest?.dsh?.client?.inject ?? []
  assert.equal(inject.some((entry) => /discovery/i.test(entry)), false, 'client manifest unchanged')
})