import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { POLICY_AUTHORITY, readPolicyAuthority } from '../lib/policy-authority.js'
import { createSecurityOwner } from '../lib/security-owner.js'
import { createRecoveryPolicyOwner } from '../lib/recovery-policy.js'
import { createSecurityEgress } from '../lib/security-egress.js'

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
    effect(fn, label) { state.effects.push({ fn, label }) },
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

test('apply publishes the symbol-keyed internal policy authority contract', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const contract = readPolicyAuthority(ctx)
  assert.ok(contract, 'the internal contract is published on the root context')
  assert.equal(contract.version, 1)
  assert.equal(typeof contract.egress.admit, 'function')
  assert.equal(typeof contract.egress.release, 'function')
  assert.equal(typeof contract.recovery.decide, 'function')
  assert.equal(typeof contract.recovery.commit, 'function')
  assert.equal(typeof contract.policy.status, 'function')
  const cleanup = state.effects.find((entry) => entry.label.includes('policy authority'))
  assert.ok(cleanup, 'a teardown is registered for the contract')
  cleanup.fn()
  assert.equal(readPolicyAuthority(ctx), null, 'teardown removes the contract')
})

test('a missing contract reads as null so components degrade instead of assuming allow', () => {
  assert.equal(readPolicyAuthority({}), null)
  assert.equal(readPolicyAuthority(null), null)
  assert.equal(readPolicyAuthority(undefined), null)
  assert.equal(readPolicyAuthority({ [POLICY_AUTHORITY]: { version: 999 } }), null, 'a version mismatch degrades the contract')
})

test('egress admit fails closed on deny and binds the exact target', () => {
  const core = createSecurityEgress({ now: Date.now, rng: () => 'r' })
  const denied = core.admit({ kind: 'http', destination: 'denied.example' }, { component: 'llm/provider' })
  assert.equal(denied.ok, false)
  assert.equal(denied.outcome, 'deny')
  assert.equal(denied.resource, 'egress:http:denied.example')
  assert.match(denied.reason, /no egress policy allows/)
  core.registry.register('o', { match: (ctx) => ctx.target.destination === 'ok.example', decide: () => ({ outcome: 'allow' }) })
  const allowed = core.admit({ kind: 'http', destination: 'ok.example' }, { component: 'llm/provider' })
  assert.equal(allowed.ok, true)
  assert.equal(allowed.outcome, 'allow')
  assert.equal(allowed.resource, 'egress:http:ok.example')
  assert.equal(allowed.component, 'llm/provider')
  const other = core.admit({ kind: 'http', destination: 'other.example' }, { component: 'llm/provider' })
  assert.equal(other.ok, false, 'a redirect or different destination must re-admit')
})

test('egress coverage reports three parts and never inherits an unregistered path', async () => {
  const { owner } = (() => {
    const listeners = []
    const ctx = { on() { return () => {} }, effect() {} }
    return { owner: createSecurityOwner({ ctx, logger: { warn() {} } }) }
  })()
  const view = await Promise.resolve(owner.api.egress.coverage())
  assert.equal(view.registration, 'active')
  assert.equal(view.cooperative, 'active')
  assert.equal(view.status, 'degraded')
  for (const path of ['llm/provider', 'mcp/http', 'web', 'subprocess', 'connection', 'telemetry']) {
    assert.ok(path in view.automatic, `${path} is a registered automatic path`)
    assert.equal(view.automatic[path], 'unavailable', 'paths without a bound owner report unavailable')
  }
  assert.ok(Object.isFrozen(view.automatic))
  assert.equal(typeof view.observedAt, 'string')
})

test('recovery coverage reports per-path automatic status and registration availability', async () => {
  const owner = createRecoveryPolicyOwner({ logger: { warn() {} } })
  const view = await Promise.resolve(owner.api.coverage())
  assert.equal(view.registration, 'active')
  assert.equal(view.cooperative, 'active')
  for (const path of ['recovery/model', 'recovery/tool', 'recovery/task', 'recovery/transaction']) {
    assert.ok(path in view.automatic, `${path} is registered`)
    assert.equal(view.automatic[path], 'unavailable')
  }
  assert.equal(owner.api._internal.status('recovery/model').status, 'unavailable')
  assert.equal(owner.api._internal.status('recovery/unknown-path').status, 'unavailable')
  assert.equal(owner.api._internal.status('recovery/unknown-path').reason, 'unregistered path')
})

test('recovery decide and commit form a single-consumption automatic authority', async () => {
  const owner = createRecoveryPolicyOwner({ logger: { warn() {} } })
  owner.api.capability.register({
    operationId: 'op-1', ownerId: 'o1', generation: 'g1', scope: 'session',
    idempotent: true, retryable: true, allowedActions: ['retry'], sideEffectClass: 'none',
  })
  owner.api.policy.register({
    id: 'p1', ownerId: 'o1', generation: 'g1', priority: 'high',
    match: () => true,
    decide: () => ({
      action: 'retry',
      reason: { code: 'temporary' },
      bounds: {
        attemptsRemaining: 2,
        deadlineAt: '2999-01-01T00:00:00.000Z',
        backoff: { kind: 'exponential-jitter', ms: 50 },
      },
    }),
  })
  const input = {
    execution: { executionId: 'e1', attemptId: 'a1' },
    capability: { operationId: 'op-1', ownerId: 'o1', generation: 'g1' },
    failure: new Error('transient'),
    attemptsRemaining: 2,
    ownerId: 'o1',
    generation: 'g1',
  }
  const decided = await owner.api._internal.decide(input)
  assert.equal(decided.ok, true)
  assert.equal(decided.decision.action, 'retry')
  const decisionId = decided.decision.decisionId
  const committed = await owner.api._internal.commit(
    { decisionId },
    { operation: { ownerId: 'o1', generation: 'g1', executionId: 'e1', attemptId: 'a1' } },
  )
  assert.equal(committed.ok, true)
  assert.equal(committed.code, 'committed')
  assert.equal(committed.channel, 'automatic')
  const again = await owner.api._internal.commit(
    { decisionId },
    { operation: { ownerId: 'o1', generation: 'g1', executionId: 'e1', attemptId: 'a1' } },
  )
  assert.equal(again.ok, false)
  assert.equal(again.code, 'conflict')
  assert.match(again.reason, /already consumed/)
})

test('recovery commit rejects identity mismatches and terminal operations', async () => {
  const owner = createRecoveryPolicyOwner({ logger: { warn() {} } })
  owner.api.capability.register({
    operationId: 'op-2', ownerId: 'o2', generation: 'g2', scope: 'session',
    idempotent: true, retryable: true, allowedActions: ['retry'], sideEffectClass: 'none',
  })
  owner.api.policy.register({
    id: 'p2', ownerId: 'o2', generation: 'g2',
    decide: () => ({
      action: 'retry',
      reason: { code: 'temporary' },
      bounds: {
        attemptsRemaining: 2,
        deadlineAt: '2999-01-01T00:00:00.000Z',
        backoff: { kind: 'exponential-jitter', ms: 50 },
      },
    }),
  })
  const decided = await owner.api._internal.decide({
    execution: { executionId: 'e2', attemptId: 'a2' },
    capability: { operationId: 'op-2', ownerId: 'o2', generation: 'g2' },
    failure: new Error('boom'),
    attemptsRemaining: 2,
    ownerId: 'o2',
    generation: 'g2',
  })
  const decisionId = decided.decision.decisionId
  const wrongOwner = await owner.api._internal.commit(
    { decisionId },
    { operation: { ownerId: 'other', executionId: 'e2', attemptId: 'a2' } },
  )
  assert.equal(wrongOwner.ok, false)
  assert.match(wrongOwner.reason, /owner identity mismatch/)
  const wrongExecution = await owner.api._internal.commit(
    { decisionId },
    { operation: { ownerId: 'o2', executionId: 'e-other', attemptId: 'a2' } },
  )
  assert.equal(wrongExecution.ok, false)
  assert.match(wrongExecution.reason, /execution identity mismatch/)
  const terminal = await owner.api._internal.commit(
    { decisionId },
    { operation: { ownerId: 'o2', executionId: 'e2', attemptId: 'a2', terminal: true } },
  )
  assert.equal(terminal.ok, false)
  assert.match(terminal.reason, /terminal or cancelled/)
})

test('cooperative evaluate and automatic decide share the same generation and decision', async () => {
  const owner = createRecoveryPolicyOwner({ logger: { warn() {} } })
  owner.api.capability.register({
    operationId: 'op-3', ownerId: 'o3', generation: 'g3', scope: 'session',
    idempotent: true, retryable: true, allowedActions: ['retry'], sideEffectClass: 'none',
  })
  owner.api.policy.register({
    id: 'p3', ownerId: 'o3', generation: 'g3',
    decide: () => ({ action: 'retry', reason: { code: 'temporary' } }),
  })
  const input = {
    execution: { executionId: 'e3', attemptId: 'a3' },
    capability: { operationId: 'op-3', ownerId: 'o3', generation: 'g3' },
    failure: new Error('x'),
    attemptsRemaining: 2,
    ownerId: 'o3',
    generation: 'g3',
  }
  const cooperative = await owner.api.evaluate(input)
  const automatic = await owner.api._internal.decide(input)
  assert.equal(automatic.decision.decisionId, cooperative.decisionId, 'the same window yields the same decision')
  assert.equal(automatic.decision.action, cooperative.action)
})

test('an aborted signal cancels recovery evaluation without a retry', async () => {
  const owner = createRecoveryPolicyOwner({ logger: { warn() {} } })
  const controller = new AbortController()
  controller.abort()
  const decision = await owner.api.evaluate({
    execution: { executionId: 'e4', attemptId: 'a4' },
    failure: new Error('late'),
    signal: controller.signal,
  })
  assert.equal(decision.action, 'stop')
  assert.equal(decision.reason.code, 'recovery-cancelled')
})

test('a throwing recovery policy is contained and falls back to the safe default', async () => {
  const owner = createRecoveryPolicyOwner({ logger: { warn() {} } })
  owner.api.policy.register({
    id: 'broken', ownerId: 'o9', generation: 'g9',
    decide: () => { throw new Error('policy exploded') },
  })
  const decision = await owner.api.evaluate({ failure: new Error('x'), classification: { class: 'retryable' } })
  assert.equal(decision.action, 'stop')
  assert.match(decision.reason.code, /safe-default/)
})

test('multiple recovery owners converge deterministically by precedence', async () => {
  const owner = createRecoveryPolicyOwner({ logger: { warn() {} } })
  owner.api.policy.register({ id: 'low', ownerId: 'a', generation: 'g', priority: 'low', decide: () => ({ action: 'retry', reason: { code: 'immediate' } }) })
  owner.api.policy.register({ id: 'high', ownerId: 'b', generation: 'g', priority: 'high', decide: () => ({ action: 'abort' }) })
  owner.api.capability.register({
    operationId: 'op-5', ownerId: 'a', generation: 'g', scope: 'session',
    idempotent: true, retryable: true, allowedActions: ['retry', 'abort'], sideEffectClass: 'none',
  })
  const decision = await owner.api.evaluate({
    execution: { executionId: 'e5', attemptId: 'a5', active: true, cancellable: true },
    capability: { operationId: 'op-5', ownerId: 'a', generation: 'g' },
    failure: new Error('x'),
    attemptsRemaining: 1,
  })
  assert.equal(decision.action, 'abort', 'higher-precedence action converges')
})

test('policy registration handles carry owner-bound id, ownerId, generation and dispose', async () => {
  const listeners = []
  const ctx = { on() { return () => {} }, effect() {} }
  const security = createSecurityOwner({ ctx, logger: { warn() {} } })
  const policyHandle = security.api.policy.register('acme', { id: 'p-x', point: 'approval-before', decide: () => ({ outcome: 'allow' }) })
  assert.equal(policyHandle.id, 'p-x')
  assert.equal(policyHandle.ownerId, 'acme')
  assert.equal(typeof policyHandle.generation, 'string')
  assert.equal(typeof policyHandle.dispose, 'function')
  assert.equal(policyHandle.dispose(), true)
  assert.equal(policyHandle.dispose(), false, 'dispose is identity-bound and idempotent')

  const recovery = createRecoveryPolicyOwner({ logger: { warn() {} } })
  const capabilityHandle = recovery.api.capability.register({
    operationId: 'op-h', ownerId: 'o-h', generation: 'g-h', scope: 'session',
    idempotent: true, retryable: true, allowedActions: ['stop'], sideEffectClass: 'none',
  })
  assert.equal(capabilityHandle.id, 'op-h')
  assert.equal(capabilityHandle.ownerId, 'o-h')
  assert.equal(capabilityHandle.generation, 'g-h')
  assert.equal(typeof capabilityHandle.dispose, 'function')
  const policyRecoveryHandle = recovery.api.policy.register({
    id: 'p-h', ownerId: 'o-h', generation: 'g-h', decide: () => ({ action: 'stop' }),
  })
  assert.equal(policyRecoveryHandle.id, 'p-h')
  assert.equal(policyRecoveryHandle.ownerId, 'o-h')
  assert.equal(policyRecoveryHandle.generation, 'g-h')
  assert.equal(policyRecoveryHandle.dispose(), true)
  assert.equal(policyRecoveryHandle.dispose(), false)
})

test('egress grant audit records the cooperative channel', async () => {
  const listeners = []
  const ctx = { on() { return () => {} }, effect() {} }
  const owner = createSecurityOwner({ ctx, logger: { warn() {} } })
  owner.api.egress.register('gw', { id: 'allow', match: () => true, decide: () => ({ outcome: 'allow' }) })
  const outcome = await owner.api.egress.lease.acquire({ target: { kind: 'http', destination: 'ok.example' }, ttlMs: 60000 })
  assert.equal(outcome.ok, true)
  const records = owner.api.audit.list({ kind: 'egress-grant' }).records
  assert.equal(records.length, 1)
  assert.equal(records[0].channel, 'cooperative')
})
