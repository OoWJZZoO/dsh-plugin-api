import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { runFeatureGuard } from '../lib/guards.js'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'

test('skillsActivation guard probes ctx.get lazily and passes when present', () => {
  const ctx = { get() {} }
  const result = runFeatureGuard('skillsActivation', ctx)
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
})

test('skillsActivation guard fails closed without ctx.get', () => {
  const ctx = {}
  const result = runFeatureGuard('skillsActivation', ctx)
  assert.equal(result.ok, false)
  assert.equal(result.problems[0].name, 'ctx.get')
})

test('the skillsActivation feature key is registrable and mountable in the registry', () => {
  const registry = createFeatureRegistry()
  registry.mount('skillsActivation')
  assert.equal(registry.isActive('skillsActivation'), true)
  assert.deepEqual(registry.snapshot().find((entry) => entry.name === 'skillsActivation'), { name: 'skillsActivation', isActive: true })
})

function makeMockCtx() {
  const services = new Map()
  services.set('loader', { entries() { return [] } })
  services.set('llm', { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} })
  services.set('agents', { get() {}, list() {}, roots() {} })
  services.set('apiProxy', { sessions: { prompt() {}, selectModel() {} } })
  services.set('tools', { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} })
  services.set('sessions', { get() {}, list() {}, fork() {} })
  services.set('settings', { register() {}, describe() { return [] }, get() {}, mutate() {} })
  services.set('systemPrompt', { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} })
  services.set('typert', {
    register() {}, get() {}, resolve() {}, list() {}, getPackage() {}, listPackages() {}, toJSONSchema() {},
    local: { get() {}, hasSeen() {}, list() {}, subscribe() {} },
    remotes: { register() {}, get() {}, list() {}, subscribe() {} },
    lookups: { register() {}, configure() {}, get() {}, definitions() {}, keys() {}, subscribe() {} },
    contexts: { registerHost() {}, configureHost() {}, registerClient() {}, getHost() {}, getClient() {}, subscribe() {} },
  })
  services.set('web', { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} })
  const state = { pluginApi: undefined }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') state.pluginApi = value
      },
    },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      return services.get(name)
    },
    plugin(Class) { new Class(ctx) },
    effect() {},
    on() { return () => {} },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  return { ctx, state }
}

test('feature snapshot order pins skillsActivation after toolDiscovery and before profile', () => {
  const { ctx, state } = makeMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const names = state.pluginApi.features.map((entry) => entry.name)
  assert.ok(names.includes('skillsActivation'), `snapshot includes the feature: ${names.join(',')}`)
  assert.ok(names.indexOf('skillsActivation') > names.indexOf('toolDiscovery'))
  assert.ok(names.indexOf('skillsActivation') < names.indexOf('profile'))
})

test('KNOWN_FEATURES accepts the skillsActivation feature key with prepared transaction semantics', () => {
  const registry = {
    snapshot: () => [],
    isActive: () => false,
    disable() {},
    mount() {},
  }
  const Service = createPluginApiService({ apiVersion: '0.6', registry, coreActive: true })
  const ctx = {
    fiber: { uid: 1, state: 2 },
    reflect: { provide() { return () => {} } },
    effect() {},
    plugin() {},
    on() { return () => {} },
    get() { return undefined },
  }
  const service = new Service(ctx)
  const owner = {
    registerDescriptor() {}, registerSkill() {}, activate() {}, deactivate() {}, exposure() {}, audit() {},
    availability() { return { active: true } },
    policy: { registerMinimalCatalogUpdate() {} },
  }
  // Before any mount the projection is the typed disabled surface.
  assert.deepEqual(service.skills.activation.availability(), Object.freeze({ active: false, contract: false }))
  const prepared = service.prepareFeature('skillsActivation', owner)
  assert.equal(prepared.commit(), true)
  assert.deepEqual(service.skills.activation.availability(), { active: true })
  // A rollback of a later transaction restores the disabled surface.
  const second = service.prepareFeature('skillsActivation', owner)
  assert.equal(second.commit(), true)
  assert.equal(second.rollback(), true)
  assert.deepEqual(service.skills.activation.availability(), Object.freeze({ active: false, contract: false }))
  // The full apply path with the disabled auxiliary keeps the surface typed.
  const { ctx: mockCtx, state } = makeMockCtx()
  assert.doesNotThrow(() => apply(mockCtx))
  assert.deepEqual(state.pluginApi.skills.activation.availability(), Object.freeze({ active: false, contract: false }))
})
