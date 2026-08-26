import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginApiService } from '../lib/plugin-api-service.js'
import { apply, mountSkillsActivationFeature } from '../lib/index.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

const TOOL_SKILL_MARKER = Symbol.for('dsh-plugin-api.tool-skill.contract')

/**
 * Facade-surface tests for the skill activation add-on under
 * `pluginApi.skills.activation`.
 *
 * Three states are exercised:
 *   1. replacement active (marker + version match): operations forward to the
 *      replacement's `ctx.skillActivation` service; availability reports
 *      active (typed disabled surfaces).
 *   2. version mismatch / absent auxiliary: the facade feature is disabled and
 *      never forwards; availability reports versionMatch false.
 *   3. no replacement marker: mount succeeds but every operation is a typed
 *      disabled rejection.
 *
 * The full replacement behavior (three-path gating, engine, notifications) is
 * covered by the auxiliary bundle's own suites against the real official row;
 * this file keeps the facade wiring harnessed.
 */

function markedService(calls = []) {
  const service = {
    registerDescriptor(...args) { calls.push(['registerDescriptor', args]); return { ok: true } },
    registerSkill(...args) { calls.push(['registerSkill', args]); return { ok: true } },
    async activate(...args) { calls.push(['activate', args]); return { ok: true, generation: 'g-1' } },
    deactivate(...args) { calls.push(['deactivate', args]); return { ok: true } },
    exposure(...args) { calls.push(['exposure', args]); return { ok: true, exposure: { skillId: args[0] } } },
    audit(...args) { calls.push(['audit', args]); return { ok: true, items: [] } },
    availability() { return Object.freeze({ active: true, versionMatch: true, officialRowDisabled: true, replacementActive: true, seams: { skillTool: true } }) },
    policy: {
      registerMinimalCatalogUpdate(...args) { calls.push(['policy.registerMinimalCatalogUpdate', args]); return { ok: true, dispose: () => {} } },
    },
  }
  Object.defineProperty(service, TOOL_SKILL_MARKER, { value: true })
  return service
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
    get(name) { if (name === 'pluginApi') return state.pluginApi; return services.get(name) },
  }
  if (marker) services.set('skillActivation', marker)
  const service = new Service(ctx)
  const featureRegistry = {
    isActive: () => false,
    mount(name) { this.active = name },
  }
  const logger = { warn() {} }
  const auxiliaryManifests = { toolSkill: manifest }
  return { ctx, service, featureRegistry, logger, auxiliaryManifests, facadeContract }
}

function activationSurface(service) {
  return service.skills.activation
}

test('replacement active: pluginApi.skills.activation forwards operations and availability', () => {
  const calls = []
  const { service, featureRegistry, logger, auxiliaryManifests, facadeContract } = createMountHarness({
    marker: markedService(calls),
    manifest: { version: '0.1.0-rc.6-0.7', api: '0.7' },
  })
  const mounted = mountSkillsActivationFeature({
    ctx: service.ctx, service, featureRegistry, logger, auxiliaryManifests, facadeContract,
  })
  assert.ok(mounted, 'mount must succeed')
  assert.equal(typeof mounted.prepared.commit, 'function')
  assert.equal(mounted.prepared.commit(), true, 'prepared transaction must publish')
  featureRegistry.mount('skillsActivation')

  const activation = activationSurface(service)
  assert.deepEqual(activation.availability(), {
    active: true,
    versionMatch: true,
    contract: true,
    officialRowDisabled: true,
    replacementActive: true,
    seams: { skillTool: true },
  })
  activation.activate('demo-skill', { scope: { kind: 'session', key: 's-1' } })
  assert.deepEqual(calls.at(-1), ['activate', ['demo-skill', { scope: { kind: 'session', key: 's-1' } }]])
  const exposure = activation.exposure('demo-skill', 'g-9')
  assert.equal(exposure.exposure.skillId, 'demo-skill')
  assert.deepEqual(calls.at(-1)[0], 'exposure')
  activation.policy.registerMinimalCatalogUpdate({ kind: 'session', key: 's-1' })
  assert.deepEqual(calls.at(-1), ['policy.registerMinimalCatalogUpdate', [{ kind: 'session', key: 's-1' }]])
})

test('no replacement marker: mount succeeds but operations reject with the typed disabled error', () => {
  const { service, featureRegistry, logger, auxiliaryManifests, facadeContract } = createMountHarness({
    manifest: { version: '0.1.0-rc.6-0.7', api: '0.7' },
  })
  const mounted = mountSkillsActivationFeature({
    ctx: service.ctx, service, featureRegistry, logger, auxiliaryManifests, facadeContract,
  })
  assert.ok(mounted)
  mounted.prepared.commit()
  featureRegistry.mount('skillsActivation')

  const activation = activationSurface(service)
  assert.throws(() => activation.registerDescriptor({}), (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'skillsActivation')
  assert.throws(() => activation.policy.registerMinimalCatalogUpdate({ kind: 'session', key: 's-1' }), PluginApiFeatureDisabledError)
  assert.deepEqual(activation.availability(), { active: false, contract: false, versionMatch: true })
})

test('version mismatch or absent auxiliary: the facade feature is disabled and never forwards', () => {
  for (const manifest of [
    { version: '0.1.0-rc.6-9.9', api: '9.9' },
    null,
  ]) {
    const calls = []
    const { service, featureRegistry, logger, auxiliaryManifests, facadeContract } = createMountHarness({
      marker: markedService(calls),
      manifest,
    })
    const mounted = mountSkillsActivationFeature({
      ctx: service.ctx, service, featureRegistry, logger, auxiliaryManifests, facadeContract,
    })
    assert.equal(mounted, null, 'mount must fail closed so the apply disables the feature')
    assert.equal(calls.length, 0, 'never forwards under version mismatch')
    assert.deepEqual(activationSurface(service).availability(), Object.freeze({ active: false, contract: false }))
    assert.throws(() => activationSurface(service).activate('demo-skill', {}), PluginApiFeatureDisabledError)
  }
})

test('full apply: absent auxiliary keeps the typed disabled surface and leaves other features intact', () => {
  // The mock context keeps the facade core alive; the tool-skill auxiliary is
  // not resolvable from node_modules, so the projection is disabled-only.
  const services = new Map()
  services.set('loader', { entries() { return [['plugin-api-main']] } })
  services.set('llm', { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} })
  services.set('agents', { get() {}, list() {}, roots() {} })
  services.set('tools', { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} })
  services.set('sessions', { get() {}, list() {}, fork() {} })
  services.set('settings', { register() {}, describe() { return [] }, get() {}, mutate() {} })
  const state = {}
  const ctx = {
    logger: { warn() {} },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') state.pluginApi = value
      },
    },
    get(name) { if (name === 'pluginApi') return state.pluginApi; return services.get(name) },
    plugin(Class) { new Class(ctx) },
    effect() {},
    on() { return () => {} },
  }
  assert.doesNotThrow(() => apply(ctx))
  assert.ok(state.pluginApi)
  const activation = state.pluginApi.skills.activation
  assert.deepEqual(activation.availability(), { active: false, contract: false })
  assert.throws(() => activation.activate('demo', {}), (error) => {
    assert.ok(error instanceof PluginApiFeatureDisabledError)
    assert.equal(error.feature, 'skillsActivation')
    return true
  })
  // The rest of the facade stays fully usable (typed disabled projection only
  // stops this feature).
  assert.equal(typeof state.pluginApi.events.on, 'function')
  assert.equal(typeof state.pluginApi.tools.get, 'function')
})