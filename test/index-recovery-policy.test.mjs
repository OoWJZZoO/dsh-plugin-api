import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

function createTypertRegistry() {
  const noOp = () => {}
  return {
    register: noOp, get: noOp, resolve: noOp, list: noOp, getPackage: noOp, listPackages: noOp, toJSONSchema: noOp,
    local: { get: noOp, hasSeen: noOp, list: noOp, subscribe: noOp },
    remotes: { register: noOp, get: noOp, list: noOp, subscribe: noOp },
    lookups: { register: noOp, configure: noOp, get: noOp, definitions: noOp, keys: noOp, subscribe: noOp },
    contexts: { registerHost: noOp, configureHost: noOp, registerClient: noOp, getHost: noOp, getClient: noOp, subscribe: noOp },
  }
}

function createContext(options = {}) {
  const services = {
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    typert: createTypertRegistry(),
    ...(options.services ?? {}),
  }
  const state = { pluginApi: undefined, effects: [], listeners: [], errors: [] }
  const ctx = {
    logger: { error(message) { state.errors.push(message) }, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect(fn, label) { state.effects.push({ fn, label }) },
    on(name, listener) { state.listeners.push({ name, listener }); return () => {} },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  return { ctx, state }
}

test('healthy apply mounts a host-only recovery surface after execution and before diagnostics', async () => {
  const { ctx, state } = createContext()
  assert.doesNotThrow(() => apply(ctx))
  const names = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').map((entry) => entry.name)
  assert.ok(names.includes('recovery'))
  assert.ok(names.indexOf('execution') < names.indexOf('recovery'))
  assert.ok(names.indexOf('recovery') < names.indexOf('diagnostics'))
  assert.equal(state.pluginApi.executions.recovery.classify, undefined, 'classify is internalized')
  assert.equal(typeof state.pluginApi.executions.recovery.capability.register, 'function')
  assert.equal(typeof state.pluginApi.executions.recovery.policy.register, 'function')
  assert.equal(typeof state.pluginApi.executions.recovery.evaluate, 'function')
  assert.equal(state.pluginApi.executions.recovery.consume, undefined, 'consume is deleted')
  assert.equal(typeof state.pluginApi.services.recovery.fromAgentRequestError, 'function')
  assert.equal(state.pluginApi.executions.recovery.availability().status, 'active')
  assert.equal(Object.prototype.hasOwnProperty.call(state.pluginApi, 'client'), false)
})
test('mounted recovery evaluates and consumes a bounded policy decision without executing it', async () => {
  const { ctx, state } = createContext()
  apply(ctx)
  const recovery = state.pluginApi.executions.recovery
  recovery.capability.register({
    operationId: 'op', ownerId: 'owner', generation: '1', scope: 'session',
    idempotent: true, retryable: true, allowedActions: ['retry', 'stop'],
    sideEffectClass: 'read-only', retryBudget: { maxAttempts: 1 }, deadlineMs: 60_000,
  })
  recovery.policy.register({ id: 'retry', ownerId: 'policy', generation: '1', decide() {
    return { action: 'retry', reason: { code: 'temporary' }, proposedAttemptId: 'a-2', bounds: {
      attemptsRemaining: 1, deadlineAt: '2999-01-01T00:00:00.000Z', backoff: { kind: 'immediate' },
    } }
  } })
  const decision = await recovery.evaluate({
    failure: { class: 'transient', code: 'temporary' },
    capability: { operationId: 'op', ownerId: 'owner', generation: '1' },
    execution: { executionId: 'e-1', attemptId: 'a-1', active: true },
    scope: 'session', decisionWindowId: 'window-1',
  })
  assert.equal(decision.action, 'retry')
  assert.equal(recovery.consume, undefined, 'consume is deleted (gap); the decision stays consultative')
  assert.equal(decision.execution.executionId, 'e-1')
})

test('missing event substrate disables only recovery and keeps apply fail-safe', () => {
  const { ctx, state } = createContext()
  ctx.on = undefined
  assert.doesNotThrow(() => apply(ctx))
  const feature = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((entry) => entry.name === 'recovery')
  assert.equal(feature?.isActive, false)
  assert.throws(() => state.pluginApi.executions.recovery.evaluate({}), PluginApiFeatureDisabledError)
})

test('stale recovery facade is typed unavailable after its owner slot is unmounted', () => {
  const { ctx, state } = createContext()
  apply(ctx)
  const old = state.pluginApi.executions.recovery
  const token = state.pluginApi._readSlot('recovery')
  assert.ok(token)
  state.pluginApi.unmountFeature('recovery', state.pluginApi._recoverySlot)
  assert.throws(() => old.evaluate({}), PluginApiFeatureDisabledError)
})
