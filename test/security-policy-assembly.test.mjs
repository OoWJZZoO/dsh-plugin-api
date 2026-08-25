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
  return state.pluginApi.features.find((entry) => entry.name === name)
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
  assert.equal(typeof security.egress.check, 'function')
  assert.equal(typeof security.egress.lease.acquire, 'function')
  assert.equal(typeof security.audit.query, 'function')
  const availability = security.availability
  assert.deepEqual(availability.faces, { policy: 'active', redaction: 'active', egress: 'active', audit: 'active' })
  assert.equal(availability.audit.durable, 'non-durable')
  assert.equal(availability.secretPolicy, 'default-deny')
})

test('the FEATURE_MOUNTERS tail order pins stay intact (remote..usage at the end)', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const names = state.pluginApi.features.map((entry) => entry.name)
  assert.equal(names[names.length - 9], 'remote', 'remote stays directly before execution')
  assert.equal(names[names.length - 8], 'execution', 'execution stays directly before recovery')
  assert.equal(names[names.length - 7], 'recovery', 'recovery stays directly before coordination')
  assert.equal(names[names.length - 6], 'coordination', 'coordination stays directly before workspaceTransactions')
  assert.equal(names[names.length - 5], 'workspaceTransactions', 'workspaceTransactions stays directly before diagnostics')
  assert.equal(names[names.length - 4], 'diagnostics', 'diagnostics stays directly before usage')
  assert.equal(names[names.length - 3], 'usage', 'usage stays directly before tasks')
  assert.equal(names[names.length - 2], 'tasks', 'tasks stays directly before toolDiscovery')
  assert.equal(names[names.length - 1], 'toolDiscovery', 'tool discovery is the last FEATURE_MOUNTERS entry')
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

  const view = state.pluginApi.security.audit.query({})
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
  assert.equal(state.pluginApi.security.audit.query({ kind: 'redaction' }).records.length, 1)
})

test('egress check through the mounted facade defaults to deny and audits', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const decision = state.pluginApi.security.egress.check({ kind: 'subprocess', destination: 'evil.example' })
  assert.equal(decision.outcome, 'deny')
  assert.equal(state.pluginApi.security.audit.query({ kind: 'decision' }).records.length, 1)
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
  const availability = state.pluginApi.security.availability
  assert.deepEqual(availability.seams, {
    approval: 'absent', toolBefore: 'absent', toolAfter: 'absent', modelRequest: 'absent',
  }, 'all seams absent: no enforcement is claimed')
  // registry faces still work; the fail-safe degrade never throws through apply
  assert.equal(typeof state.pluginApi.security.policy.register, 'function')
  // unrelated features keep mounting
  assert.equal(featureOf(state, 'usage').isActive, true)
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
  assert.throws(() => state.pluginApi.security.audit.query({}), PluginApiFeatureDisabledError)
  assert.throws(() => state.pluginApi.security.egress.check({ kind: 'http', destination: 'x' }), PluginApiFeatureDisabledError)
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
  const ServiceClass = createPluginApiService({ apiVersion: '0.6', registry, coreActive: false })
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
  assert.equal(typeof security.audit.query, 'function')
  // inactive facade: every member fails with the typed inactive contract
  assert.throws(() => security.policy.register('x', { point: 'tool-before', decide: () => ({ outcome: 'allow' }) }), PluginApiInactiveError)
  assert.throws(() => security.availability, PluginApiInactiveError)
})