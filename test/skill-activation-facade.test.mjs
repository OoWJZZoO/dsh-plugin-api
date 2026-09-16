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
  const policyOwners = new Map()
  const service = {
    registerDescriptor(...args) { calls.push(['registerDescriptor', args]); return { ok: true, generation: 'g-1', replaced: false } },
    unregisterDescriptor(...args) { calls.push(['unregisterDescriptor', args]); return { ok: true, generation: 'g-1' } },
    registerSkill(...args) { calls.push(['registerSkill', args]); return { ok: true, generation: 'g-1' } },
    async activate(...args) { calls.push(['activate', args]); return { ok: true, generation: 'g-1' } },
    deactivate(...args) { calls.push(['deactivate', args]); return { ok: true } },
    exposure(...args) { calls.push(['exposure', args]); return { ok: true, exposure: { skillId: args[0] } } },
    audit(...args) { calls.push(['audit', args]); return { ok: true, items: [] } },
    availability() { return Object.freeze({ active: true, versionMatch: true, officialRowDisabled: true, replacementActive: true, seams: { skillTool: true } }) },
    policy: {
      // Owner-scoped like the engine: one holder per scope key, a foreign
      // owner is refused typed, and the holder's release frees the scope.
      registerMinimalCatalogUpdate(...args) {
        calls.push(['policy.register', args])
        const input = args[0] ?? {}
        const key = `${input.kind}:${input.key}`
        const held = policyOwners.get(key)
        if (held !== undefined && held !== input.ownerId) {
          return { ok: false, code: 'SKILL_ENTRY_CONFLICT', reason: `minimal update policy for "${key}" is owned by "${held}"` }
        }
        policyOwners.set(key, input.ownerId)
        return { ok: true, dispose: () => { policyOwners.delete(key); return { ok: true, revoked: true } } }
      },
    },
  }
  Object.defineProperty(service, TOOL_SKILL_MARKER, { value: true })
  return service
}

function createMountHarness({ services = new Map(), marker = false, manifest = null, facadeContract = { runtime: '0.1.0-rc.6', api: '0.1' } } = {}) {
  const registry = {
    snapshot: () => [],
    isActive: () => false,
    disable() {},
    mount() {},
  }
  const Service = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
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
    manifest: { version: '0.1.0-rc.6-0.1.0', api: '0.1' },
  })
  const mounted = mountSkillsActivationFeature({
    ctx: service.ctx, service, featureRegistry, logger, auxiliaryManifests, facadeContract,
  })
  assert.ok(mounted, 'mount must succeed')
  assert.equal(typeof mounted.prepared.commit, 'function')
  assert.equal(mounted.prepared.commit(), true, 'prepared transaction must publish')
  featureRegistry.mount('skillsActivation')

  const activation = activationSurface(service)
  assert.equal(activation.availability().status, 'active')
  activation.activate('demo-skill', { scope: { kind: 'session', key: 's-1' } })
  assert.deepEqual(calls.at(-1), ['activate', ['demo-skill', { scope: { kind: 'session', key: 's-1' } }]])
  const exposure = activation.exposure.list('demo-skill', 'g-9')
  assert.equal(exposure.exposure.skillId, 'demo-skill')
  assert.deepEqual(calls.at(-1)[0], 'exposure')
  const policyHandle = activation.policy.register({ kind: 'session', key: 's-1' })
  assert.deepEqual(calls.at(-1), ['policy.register', [{ kind: 'session', key: 's-1', ownerId: 'root' }]],
    'the policy registration carries the derived caller identity')
  assert.deepEqual(Object.keys(policyHandle).sort(), ['dispose', 'generation', 'id', 'ownerId'])
  assert.equal(policyHandle.id, 'session:s-1')
  assert.equal(policyHandle.dispose().code, 'revoked')
})

test('activation registrations answer standard handles bound to the reading caller', async () => {
  const calls = []
  const marker = markedService(calls)
  const { service, featureRegistry, logger, auxiliaryManifests, facadeContract } = createMountHarness({
    marker,
    manifest: { version: '0.1.0-rc.6-0.1.0', api: '0.1' },
  })
  const mounted = mountSkillsActivationFeature({
    ctx: service.ctx, service, featureRegistry, logger, auxiliaryManifests, facadeContract,
  })
  mounted.prepared.commit()
  featureRegistry.mount('skillsActivation')

  // Two callers read the namespace through their own receiver; each
  // registration carries its own derived identity, never the declared one.
  const callerView = (name) => {
    const shadow = Object.create(service)
    Object.defineProperty(shadow, 'ctx', { value: { ...service.ctx, fiber: { name } }, enumerable: true, configurable: true })
    return shadow
  }
  const first = callerView('plugin-a').skills.activation
  const second = callerView('plugin-b').skills.activation

  const declared = await first.register({ kind: 'descriptor', skillId: 'demo-skill', summary: 'Demo', owner: 'forged-owner', sourceKind: 'explicit' })
  assert.deepEqual(calls.at(-1), ['registerDescriptor', [{ kind: 'descriptor', skillId: 'demo-skill', summary: 'Demo', owner: 'plugin-a', sourceKind: 'explicit' }]],
    'the declared owner is replaced by the derived caller identity')
  assert.deepEqual(Object.keys(declared).sort(), ['activate', 'deactivate', 'dispose', 'exposure', 'generation', 'id', 'ownerId', 'skillId'])
  assert.equal(declared.ownerId, 'plugin-a')
  assert.equal(declared.id, 'demo-skill')
  assert.match(declared.generation, /^plugin-a:skills-activation:/)

  const other = await second.register({ kind: 'descriptor', skillId: 'demo-skill-2' })
  assert.equal(other.ownerId, 'plugin-b', 'the second caller keeps its own identity')
  assert.notEqual(other.generation, declared.generation)

  // Release delegates to the owner's unregister, naming the generation the
  // registration was issued for, and is a typed idempotent no-op afterwards.
  assert.equal(declared.dispose().code, 'revoked')
  assert.deepEqual(calls.at(-1), ['unregisterDescriptor', ['demo-skill', 'plugin-a', 'g-1']])
  assert.equal(declared.dispose().code, 'stale')

  // A superseded handle cannot revoke the registration that replaced it.
  marker.unregisterDescriptor = (...args) => { calls.push(['unregisterDescriptor', args]); return { ok: false, code: 'UNREGISTER_STALE_GENERATION' } }
  assert.equal(other.dispose().code, 'stale', 'the owner refuses a stale release and the handle reports the stale no-op')

  // The domain convenience members stay reachable from the handle.
  await declared.activate({ scope: { kind: 'session', key: 's-1' } })
  assert.deepEqual(calls.at(-1), ['activate', ['demo-skill', { scope: { kind: 'session', key: 's-1' } }]])

  // A refusal keeps the registration idiom's typed throw on the async path.
  marker.registerDescriptor = () => ({ ok: false, code: 'SKILL_ENTRY_UNKNOWN', reason: 'skill "nope" is not present in the official skills registry' })
  await assert.rejects(
    () => first.register({ kind: 'descriptor', skillId: 'nope' }),
    (error) => error.code === 'SKILL_ENTRY_UNKNOWN' && /official skills registry/.test(error.message),
  )
  // A malformed spec is refused synchronously, as the facade always did.
  assert.throws(() => activationSurface(service).register({}), (error) => error.code === 'SKILLS_REGISTER_INVALID_INPUT')

  // Policy registrations are owner-scoped too: a second caller cannot take a
  // scope another caller holds, and its own scope is free.
  const held = first.policy.register({ kind: 'session', key: 's-1' })
  assert.equal(held.ownerId, 'plugin-a')
  assert.throws(
    () => second.policy.register({ kind: 'session', key: 's-1' }),
    (error) => error.code === 'SKILL_ENTRY_CONFLICT',
    'a foreign owner is refused typed instead of silently taking the slot',
  )
  assert.equal(held.dispose().code, 'revoked')
  assert.equal(second.policy.register({ kind: 'session', key: 's-1' }).ownerId, 'plugin-b',
    'the scope is free once its holder released it')
})

test('no replacement marker: mount succeeds but operations reject with the typed disabled error', () => {
  const { service, featureRegistry, logger, auxiliaryManifests, facadeContract } = createMountHarness({
    manifest: { version: '0.1.0-rc.6-0.1.0', api: '0.1' },
  })
  const mounted = mountSkillsActivationFeature({
    ctx: service.ctx, service, featureRegistry, logger, auxiliaryManifests, facadeContract,
  })
  assert.ok(mounted)
  mounted.prepared.commit()
  featureRegistry.mount('skillsActivation')

  const activation = activationSurface(service)
  assert.throws(() => activation.register({}), (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'skills.activation')
  assert.throws(() => activation.policy.register({ kind: 'session', key: 's-1' }), PluginApiFeatureDisabledError)
  assert.equal(activation.availability().status, 'unavailable')
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
    assert.equal(activationSurface(service).availability().status, 'unavailable')
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
  assert.equal(activation.availability().status, 'unavailable')
  assert.throws(() => activation.activate('demo', {}), (error) => {
    assert.ok(error instanceof PluginApiFeatureDisabledError)
    assert.equal(error.feature, 'skills.activation')
    return true
  })
  // The rest of the facade stays fully usable (typed disabled projection only
  // stops this feature).
  assert.equal(typeof state.pluginApi.events.observe, 'function')
  assert.equal(typeof state.pluginApi.tools.get, 'function')
})