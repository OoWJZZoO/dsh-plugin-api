import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from '../lib/errors.js'

/** Full-apply mock context fixture (aligned with index-*.test.mjs). */
function createMockCtx(options = {}) {
  const services = {
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
    ...(options.services ?? {}),
  }
  const state = { pluginApi: undefined, listeners: [], effects: [], errors: [] }
  const ctx = {
    logger: { error(message) { state.errors.push(message) }, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect(fn, label) {
      if (options.effectThrows) throw new Error('effect registration failed')
      state.effects.push({ fn, label })
    },
    on(name, listener, eventOptions) {
      const entry = { name, listener, eventOptions }
      state.listeners.push(entry)
      return () => {
        const index = state.listeners.indexOf(entry)
        if (index >= 0) state.listeners.splice(index, 1)
      }
    },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  return { ctx, state, services }
}

function featureOf(state, name) {
  return state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((entry) => entry.name === name)
}

test('healthy apply mounts security and exposes the four faces plus availability', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const feature = featureOf(state, 'security')
  assert.ok(feature)
  assert.equal(feature.isActive, true)

  const security = state.pluginApi.security
  assert.equal(typeof security.policy.register, 'function')
  assert.equal(typeof security.redaction.register, 'function')
  assert.equal(typeof security.egress.register, 'function')
  assert.equal(security.egress.check, undefined, 'the consultative check member is deleted')
  assert.equal(typeof security.egress.lease.acquire, 'function')
  assert.equal(typeof security.audit.list, 'function')
  const availability = security.availability()
  assert.equal(availability.status, 'active')
  assert.equal(typeof security.audit.list, 'function')
  assert.equal(typeof security.policy.register, 'function')
})

test('the FEATURE_MOUNTERS tail order pins stay intact (remote..profile at the end)', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const names = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').map((entry) => entry.name)
  // sessionChannel appends one tail entry after profile (maintenance batch);
  // llmAdapters appends another between profile and sessionChannel (final
  // batch integration); the integration wave appends four domain entries
  // after sessionChannel (session activity projection, session interaction
  // operation, attention, checkpoints). The remote..profile relative order
  // pins shift by exactly those six entries.
  assert.equal(names[names.length - 18], 'remote', 'remote stays directly before execution')
  assert.equal(names[names.length - 17], 'execution', 'execution stays directly before recovery')
  assert.equal(names[names.length - 16], 'recovery', 'recovery stays directly before coordination')
  assert.equal(names[names.length - 15], 'coordination', 'coordination stays directly before workspaceTransactions')
  assert.equal(names[names.length - 14], 'storage', 'storage mounts directly before workspaceTransactions')
  assert.equal(names[names.length - 13], 'workspaceTransactions', 'workspaceTransactions stays directly before diagnostics')
  assert.equal(names[names.length - 12], 'diagnostics', 'diagnostics stays directly before tasks')
  assert.equal(names[names.length - 11], 'tasks', 'tasks stays directly before toolDiscovery')
  assert.equal(names[names.length - 10], 'toolDiscovery', 'tool discovery mounts directly before skillsActivation')
  assert.equal(names[names.length - 9], 'skillsActivation', 'skills activation mounts directly before context')
  assert.equal(names[names.length - 8], 'context', 'context mounts directly before profile')
  assert.equal(names[names.length - 7], 'profile', 'profile stays directly before llmAdapters')
  assert.equal(names[names.length - 6], 'llmAdapters', 'adapter decoration mounts directly before sessionChannel')
  assert.equal(names[names.length - 5], 'sessionChannel', 'sessionChannel stays directly before sessionActivity')
  assert.equal(names[names.length - 4], 'sessionActivity', 'session activity projection appends first in the integration wave tail')
  assert.equal(names[names.length - 3], 'sessionInteraction', 'session interaction operation appends after sessionActivity')
  assert.equal(names[names.length - 2], 'attention', 'attention appends after sessionInteraction')
  assert.equal(names[names.length - 1], 'checkpoints', 'checkpoints is the last FEATURE_MOUNTERS entry')
  // security mounts in the middle (after llm/admission, before session)
  assert.ok(names.indexOf('security') > names.indexOf('llm/admission'))
  assert.ok(names.indexOf('security') < names.indexOf('session'))
})

test('a registered policy enforces through the mounted facade and creates audited decisions', async () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const policy = state.pluginApi.security.policy
  assert.doesNotThrow(() => policy.register('tester', {
    id: 'deny-bash',
    point: 'approval-before',
    match: (context) => context.toolName === 'bash',
    decide: () => ({ outcome: 'deny', reason: 'guard says no' }),
  }))

  // drive the official seam as the mounted listener would be reached
  const approvalListener = state.listeners.filter((entry) => entry.name === 'approval/request').map((entry) => entry.listener)
  assert.equal(approvalListener.length, 1)
  const outcome = await approvalListener[0]({ agent: { id: 'a1' }, toolName: 'bash', reason: 'write' }, () => Promise.resolve('unavailable'))
  assert.equal(outcome, 'rejected')

  const view = state.pluginApi.security.audit.list({})
  assert.equal(view.records.length, 1)
  assert.equal(view.records[0].kind, 'decision')
  assert.equal(view.records[0].outcome, 'deny')
  assert.deepEqual(view.records[0].policyIds, ['deny-bash'])
})

test('redaction rules apply at the mounted post-execute seam', async () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  state.pluginApi.security.redaction.register('tester', {
    id: 'hide-key',
    audiences: ['model'],
    match: (value) => value.includes('api_key='),
    action: 'redact',
  })
  const postListener = state.listeners.filter((entry) => entry.name === 'tools/post-execute').map((entry) => entry.listener)
  assert.equal(postListener.length, 1)
  const result = { content: [{ type: 'text', text: 'api_key=secretvalue123456789' }] }
  const decision = await postListener[0](
    { name: 'fetch', arguments: {} },
    result,
    () => Promise.resolve({ kind: 'accept' }),
  )
  assert.equal(decision.kind, 'accept')
  assert.equal(decision.content[0].text, 'redacted:hide-key')
  assert.equal(state.pluginApi.security.audit.list({ kind: 'redaction' }).records.length, 1)
})

test('egress lease acquire grants a lease when no policy denies the target', async () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const outcome = await state.pluginApi.security.egress.lease.acquire({
    target: { kind: 'subprocess', destination: 'evil.example' },
    ttlMs: 60000,
  })
  assert.equal(outcome.ok, true, 'an empty egress registry keeps the official outbound behavior')
  assert.equal(outcome.code, 'acquired')
  assert.equal(outcome.operation, 'acquire')
})

test('without a working ctx.on substrate the feature degrades to inert (no enforcement, truthful availability)', () => {
  const { ctx, state } = createMockCtx({ services: {} })
  const raw = ctx.on
  ctx.on = () => { throw new Error('no listener substrate') }
  assert.doesNotThrow(() => apply(ctx))
  ctx.on = raw
  const feature = featureOf(state, 'security')
  assert.ok(feature)
  assert.equal(feature.isActive, true, 'the typed guard substrate exists; the feature stays mounted')
  const availability = state.pluginApi.security.availability()
  assert.equal(availability.status, 'active')
  // registry faces still work; the fail-safe degrade never throws through apply
  assert.equal(typeof state.pluginApi.security.policy.register, 'function')
})

test('when the ctx.on guard substrate is missing the feature disables with typed errors', () => {
  const { ctx, state } = createMockCtx({ services: {} })
  const raw = ctx.on
  delete ctx.on
  assert.doesNotThrow(() => apply(ctx))
  ctx.on = raw
  const feature = featureOf(state, 'security')
  assert.ok(feature)
  assert.equal(feature.isActive, false)
  assert.match(feature.reason ?? '', /ctx\.on/)
  assert.throws(
    () => state.pluginApi.security.policy.register('x', { point: 'tool-before', decide: () => ({ outcome: 'allow' }) }),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'security',
  )
  assert.throws(() => state.pluginApi.security.audit.list({}), PluginApiFeatureDisabledError)
  assert.throws(() => state.pluginApi.security.egress.lease.acquire({ kind: 'http', destination: 'x' }, 60000), PluginApiFeatureDisabledError)
})

test('re-apply is idempotent for the security feature', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  assert.doesNotThrow(() => apply(ctx))
  const securityListeners = state.listeners.filter((entry) => entry.name === 'approval/request')
  assert.equal(securityListeners.length, 1, 'no duplicate seam listeners after re-apply')
})

test('pluginApi service exposes the security disabled surface until mounted', () => {
  const registry = { snapshot: () => [], isActive: () => false }
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: false })
  const state = {}
  const ctx = {
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get() { return state.pluginApi },
    on() { return () => {} },
    logger: { warn() {}, error() {} },
    effect() {},
  }
  const instance = new ServiceClass(ctx)
  const security = instance.security
  assert.equal(typeof security.policy.register, 'function')
  assert.equal(typeof security.egress.lease.acquire, 'function')
  assert.equal(typeof security.audit.list, 'function')
  // inactive facade: every member fails with the typed inactive contract
  assert.throws(() => security.policy.register('x', { point: 'tool-before', decide: () => ({ outcome: 'allow' }) }), PluginApiInactiveError)
  assert.deepEqual(security.availability(), { status: 'unavailable' })
  assert.throws(() => security.policy.register({}), PluginApiInactiveError)
})