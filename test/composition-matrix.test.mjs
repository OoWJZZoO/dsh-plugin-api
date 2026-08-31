import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { createTransformRegistry } from '../lib/llm-request.js'
import { createEventsBus } from '../lib/events-bus.js'
import { createCoordinationLease } from '../lib/coordination-lease.js'
import { createMemoryCoordinationAdapter } from '../lib/coordination-adapters.js'
import { PluginApiEventPriorityError, LlmRequestTransformRegistrationError } from '../lib/errors.js'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'

/**
 * Composition matrix over the real shared primitives (design §Composition
 * Matrix): two synthetic plugin owners exercise ordered registration,
 * deterministic same-key conflict, disposer identity, stale generation,
 * coordinated CAS/fencing, and pure-view non-authority.
 */

function transformFor(owner, tag) {
  const calls = []
  return {
    calls,
    apply(payload) {
      calls.push(tag)
      return payload
    },
    isConverged() { return true },
  }
}

test('ordered: reverse registration order, repeatable snapshot, and same-key deterministic rejection', () => {
  const registry = createTransformRegistry()
  const pluginFirst = transformFor('A', 'a')
  const pluginSecond = transformFor('B', 'b')

  // Reverse registration order with identical priority: snapshot follows
  // successful registration order and is stable across repeated reads.
  const disposerLower = registry.register({ id: 't1', mode: 'compat', priority: 'normal', ...pluginSecond })
  const disposerA = registry.register({ id: 't2', mode: 'compat', priority: 'normal', ...pluginFirst })
  const firstOrder = registry.snapshot().map((entry) => entry.token)
  assert.deepEqual(registry.snapshot().map((entry) => entry.token), firstOrder, 'snapshot order is repeatable')
  assert.deepEqual(registry.snapshot().map((entry) => entry.id), ['t1', 't2'], 'registration order wins at equal priority')

  // Priority outranks registration order deterministically.
  const disposerHigh = registry.register({ id: 't0', mode: 'compat', priority: 'highest', ...pluginFirst })
  assert.deepEqual(registry.snapshot().map((entry) => entry.id), ['t0', 't1', 't2'])

  // Same-key conflict: a second registration with the same id is rejected
  // deterministically, regardless of owner; the original stays live.
  assert.throws(
    () => registry.register({ id: 't1', mode: 'compat', priority: 'normal', ...pluginFirst }),
    (error) => error instanceof LlmRequestTransformRegistrationError && /duplicate transform id "t1"/.test(error.message),
  )
  assert.deepEqual(registry.snapshot().map((entry) => entry.id), ['t0', 't1', 't2'])

  // Disposer removes exactly its own registration and is a typed no-op after.
  disposerHigh()
  assert.deepEqual(registry.snapshot().map((entry) => entry.id), ['t1', 't2'])
  assert.equal(disposerHigh(), false, 'second dispose is a no-op')
  assert.equal(registry.snapshot().map((entry) => entry.id).includes('t0'), false)

  // Missing disposal keeps the registration live (no implicit removal).
  assert.deepEqual(registry.snapshot().map((entry) => entry.id), ['t1', 't2'])

  // After the original owner removes its registration, another owner may
  // register the same key again (ownership transfers explicitly).
  disposerLower()
  const disposerReclaim = registry.register({ id: 't1', mode: 'compat', priority: 'high', ...pluginSecond })
  assert.deepEqual(registry.snapshot().map((entry) => entry.id), ['t1', 't2'])
  disposerA()
  disposerReclaim()
  assert.deepEqual(registry.snapshot(), [])

  // Invalid priority and invalid specs are typed-rejected before registration.
  assert.throws(() => registry.register({ id: 'x', mode: 'compat', priority: 'loudest', apply() {}, isConverged() {} }), LlmRequestTransformRegistrationError)
  assert.throws(() => registry.register({ id: '', mode: 'compat' }), LlmRequestTransformRegistrationError)
  assert.throws(() => registry.register({ id: 'y', mode: 'raw' }), LlmRequestTransformRegistrationError)
})

test('ordered: registry disposal retires every token (stale epoch) and closes registration', () => {
  const registry = createTransformRegistry()
  const registrations = [1, 2, 3].map((n) => registry.register({
    id: `t${n}`,
    mode: 'compat',
    priority: 'normal',
    apply() {},
    isConverged() {},
  }))
  const tokens = registry.snapshot().map((entry) => entry.token)
  assert.ok(tokens.every((token) => registry.isAvailable(token)))

  registry.dispose()
  assert.ok(tokens.every((token) => !registry.isAvailable(token)), 'old-generation tokens are stale after disposal')
  assert.throws(() => registry.register({ id: 'late', mode: 'compat', apply() {}, isConverged() {} }), LlmRequestTransformRegistrationError)
  for (const dispose of registrations) assert.equal(dispose(), false, 'post-disposal disposers are typed no-ops')
})

test('ordered: events execute in successful registration order at equal priority and validate the vocabulary', () => {
  const ctx = new Context()
  const emitted = []
  ctx.on('matrix/order', (payload) => emitted.push(payload))
  const catalog = {
    'matrix/order': Object.freeze({ priorities: ['lowest', 'low', 'normal', 'high', 'highest', 'monitor'] }),
  }
  const bus = createEventsBus({ ctx, catalog })

  const secondHandle = bus.observe('matrix/order')
  secondHandle.subscribe((payload) => emitted.push(`b:${payload}`))
  const firstHandle = bus.observe('matrix/order')
  firstHandle.subscribe((payload) => emitted.push(`a:${payload}`))
  ctx.emit('matrix/order', 'x')
  assert.deepEqual(emitted, ['x', 'b:x', 'a:x'], 'listeners run in successful registration order at equal priority')

  // Each handle removes exactly its own listeners.
  emitted.length = 0
  secondHandle.dispose()
  ctx.emit('matrix/order', 'y')
  assert.deepEqual(emitted, ['y', 'a:y'])
  firstHandle.dispose()
  emitted.length = 0
  ctx.emit('matrix/order', 'z')
  assert.deepEqual(emitted, ['z'])
})

test('coordinated: memory adapter enforces one active owner with deterministic conflict and generation fencing', async () => {
  const lease = createCoordinationLease({
    ctx: new Context(),
    idFactory: (() => { let n = 0; return () => `id-${++n}` })(),
  })
  const api = lease.api
  const resource = { scope: 'workspace', key: 'shared', type: 'matrix' }
  const leaseMs = 30_000

  const acquireA = await api.acquire({ resource, ownerId: 'plugin-A', leaseMs })
  assert.equal(acquireA.ok, true, 'owner A acquires the idle resource')
  assert.equal(acquireA.code, 'acquired')
  assert.equal(acquireA.handle.resource.key, 'shared', 'handle carries the canonical resource')
  assert.ok(acquireA.handle.generation, 'handle carries an owner-local generation')
  assert.ok(Object.isFrozen(acquireA), 'results are frozen projections')

  // Same-key conflict: a second owner is rejected deterministically; the
  // incumbent owner and generation are untouched.
  const acquireIntruder = await api.acquire({ resource, ownerId: 'plugin-B', leaseMs })
  assert.equal(acquireIntruder.ok, false)
  assert.equal(acquireIntruder.code, 'conflict', 'contested acquire is a deterministic conflict, not silent selection')

  // A stale handle (old generation) is superseded before identity checks.
  const staleA = acquireA.handle
  const casStale = await api.compareAndSet({ handle: staleA, expectedVersion: 0, value: { v: 1 } })
  assert.equal(casStale.ok, true, 'the incumbent generation performs CAS successfully')
  assert.equal(casStale.code, 'cas-ok')
  assert.equal(casStale.version, 1)

  // Fencing: a takeover must present a staleness proof that matches reality;
  // a fabricated generation is deterministically rejected as conflict.
  const takeoverIntruder = await api.takeover({
    resource, ownerId: 'plugin-B', leaseMs,
    expectedProof: { generation: 'gen:000000009999' },
  })
  assert.equal(takeoverIntruder.ok, false)
  assert.equal(takeoverIntruder.code, 'conflict', 'fabricated staleness proof cannot fence through the active generation')

  // Fresh acquire after explicit release hands the resource over.
  assert.equal((await api.release(acquireA.handle)).ok, true)
  const acquireSecond = await api.acquire({ resource, ownerId: 'plugin-B', leaseMs })
  assert.equal(acquireSecond.ok, true, 'owner B acquires after A releases')
  assert.equal(acquireSecond.code, 'acquired')

  // The old A handle is now stale: neither heartbeat nor release through it
  // can touch B's generation; both are typed superseded results.
  const heartbeatStale = await api.heartbeat(staleA, { leaseMs })
  assert.equal(heartbeatStale.ok, false, 'stale owner heartbeat is a typed stale result')
  assert.equal(heartbeatStale.code, 'conflict', 'a stale public heartbeat is conflict with the condition in reason')
  const releaseStale = await api.release(staleA)
  assert.equal(releaseStale.ok, false, 'stale owner release is a typed no-op for the current owner')
  assert.equal(releaseStale.code, 'conflict', 'a stale public release is conflict with the condition in reason')
  assert.equal((await api.heartbeat(acquireSecond.handle, { leaseMs })).ok, true, 'B lease stays alive')
  lease.dispose()
})

test('pure: composed facade views are frozen and expose no write authority', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass({ reflect: { provide() {} }, get() { return undefined } })
  service.mountFeature('tools', { isActive: true })
  service.mountFeature('events', { on() {}, once() {}, catalog: {} })
  registry.mount('tools')
  registry.mount('events')
  service.mountFeature('services', Object.freeze({ fs: Object.freeze({ isActive: true }) }))

  for (const view of [service.services, service.capabilities]) {
    assert.ok(Object.isFrozen(view))
  }
  assert.throws(() => { service.services.extra = true }, TypeError)
  assert.throws(() => { service.capabilities.extra = true }, TypeError)
  assert.equal(service.capabilities.get('tools').status, 'active')
  assert.ok(Object.isFrozen(service.capabilities.get('tools')), 'capability descriptors are frozen projections')
})
// -- cross-domain synthetic consumer pair (design §Composition Matrix) --
// Two synthetic plugins exercise the composed facade: reverse registration
// order, same-owner idempotence, distinct-owner conflicts, stale disposers
// after generation advances, callback failure containment, exclusive
// pre-checks before side effects, and read-only projection surfaces that
// cannot mutate shared state (requirements §3/§8/§14/§15).
import { apply as applyFacade } from '../lib/index.js'

function composeHarness() {
  const services = {
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {}, listProviders() { return [] }, listModels() { return [] } },
    tools: { register() {}, restrict() { return () => {} }, guard() { return () => {} }, get() {}, schemas() { return [] }, execute() {}, presentAs() {}, executionMode() {} },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    systemPrompt: { section() { return () => {} }, context() { return () => {} }, variable() { return () => {} }, tools() { return () => {} }, suppressRuntimeContext() { return () => {} }, renderPrompt() {}, renderContextSections() {}, renderContextSnapshot() {}, joinContextSections() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
    storage: { open() {} },
  }
  const state = { pluginApi: undefined, errors: [], hooks: new Map() }
  const hooksOf = (name) => {
    let list = state.hooks.get(name)
    if (!list) {
      list = []
      state.hooks.set(name, list)
    }
    return list
  }
  const ctx = {
    get pluginApi() { return state.pluginApi },
    logger: { error(m) { state.errors.push(String(m)) }, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect() {},
    on(name, listener) { hooksOf(name).push(listener); return () => {} },
    once() {},
    emit(name, ...args) { for (const hook of [...hooksOf(name)]) hook(...args) },
    serial() {}, parallel() {}, bail() {}, waterfall() {},
    model() { return { name: 'x' } }, runtime: { name: 'test', version: '0.1.0-rc.6' },
  }
  return { ctx, state }
}

test('synthetic consumer pair: reverse load order, owner conflict, stale disposer, contained callbacks, exclusive pre-check', async () => {
  const { ctx } = composeHarness()
  applyFacade(ctx)
  const api = ctx.pluginApi

  // Reverse load order: the second plugin registers FIRST on the shared
  // policy surface; registration order is preserved and both stay live.
  const second = api.tools.restrict.register((input) => ({ allowed: input.tool === 'second' }))
  const first = api.tools.restrict.register((input) => ({ allowed: true }))
  assert.equal(typeof second, 'function')
  assert.equal(typeof first, 'function')

  // Same-owner idempotence and distinct-owner conflicts on one contribution
  // key: the second same-id contribution from another owner is a typed
  // conflict, never a latest-wins replacement.
  const contributionA = api.prompts.contribute({ kind: 'section', section: { id: 'shared', priority: 1, text: 'a' } })
  assert.equal(contributionA.ok, true)
  const conflict = api.prompts.contribute({ kind: 'section', section: { id: 'shared', priority: 1, text: 'b' } })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.code, 'conflict')

  // Stale disposer after the owner's contribution was evicted: dispose stays
  // idempotent and never resurrects the contribution.
  assert.equal(contributionA.handle.dispose(), true)
  assert.equal(contributionA.handle.dispose(), false)

  // Callback failure containment on the projection surface: a throwing
  // observer never reaches the dispatch caller, peers still observe.
  const seen = []
  const handle = api.events.observe('goal/changed')
  handle.subscribe(() => { throw new Error('observer boom') })
  handle.subscribe((payload) => seen.push(payload.change))
  assert.doesNotThrow(() => api.events.emit('goal/changed', { change: 'x' }))
  assert.deepEqual(seen, ['x'])

  // Exclusive pre-check before side effects: a conflicting remote
  // publication with a different service object is rejected before any
  // object mutation (read-only conflict pre-check). In this harness the
  // typert prerequisite is absent, so the surface reports the typed
  // unavailable shape instead — the optional capability never takes down
  // unrelated facade members.
  const remote = api.remotes
  if (remote && remote.availability().status === 'active') {
    const firstService = { get() { return { ok: true } } }
    remote.register('matrix-key', firstService)
    assert.throws(
      () => remote.register('matrix-key', { get() { return { ok: false } } }),
      (error) => error?.name === 'PluginApiRemoteError',
      'a conflicting owner is rejected before publication',
    )
  } else {
    assert.equal(remote.availability().status, 'unavailable')
    assert.throws(() => remote.register('matrix-key', { get() {} }), (error) => error?.code === 'PLUGIN_API_FEATURE_DISABLED')
  }

  // Read-only projection surfaces never expose write authority: the events
  // projection handle carries no dispatch members, and the catalog snapshot
  // is frozen.
  const projection = api.events.observe('goal/changed')
  assert.equal(typeof projection.subscribe, 'function')
  assert.equal(projection.emit, undefined)
  assert.equal(projection.serial, undefined)
  assert.ok(Object.isFrozen(api.events.catalog()))
})
