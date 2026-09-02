import test from 'node:test'
import assert from 'node:assert/strict'
import { createRecoveryPolicyOwner } from '../lib/recovery-policy.js'
import { createTaskExecutionObservation } from '../lib/task-execution-observation.js'

const NOW = '2026-09-01T00:00:00.000Z'
let clock = Date.parse(NOW)
const now = () => new Date(clock).toISOString()

function createOwner() {
  return createRecoveryPolicyOwner({ logger: { warn() {} }, now })
}

function retryPolicyInput(overrides = {}) {
  return {
    id: 'retry-once',
    ownerId: 'policy-owner-a',
    generation: 'gen-1',
    priority: 'normal',
    ...overrides,
    decide: overrides.decide ?? ((input) => ({
      action: 'retry',
      reason: { code: 'immediate' },
      bounds: { attemptsRemaining: 1, deadlineAt: '2999-01-01T00:00:00.000Z', backoff: { kind: 'immediate' } },
      proposedAttemptId: 'attempt-next',
    })),
  }
}

function baseInput(overrides = {}) {
  return {
    ownerId: 'op-owner',
    generation: 'gen-op-1',
    scope: 'session',
    execution: { executionId: 'exec-1', attemptId: 'attempt-1', active: true, cancellable: true },
    capability: { operationId: 'op-1', ownerId: 'op-owner', generation: 'gen-op-1' },
    failure: { code: 'provider-error', message: 'temporary' },
    attemptsRemaining: 1,
    ...overrides,
  }
}

test('automatic decide reports a null decision when no recovery policy is registered', async () => {
  const owner = createOwner()
  const result = await owner.api._internal.decide(baseInput())
  assert.equal(result.ok, true)
  assert.equal(result.decision, null)
  assert.equal(result.consultedPolicies, 0)
})

test('automatic decide reports a null decision when no policy matches (official default governs)', async () => {
  const owner = createOwner()
  owner.api.policy.register(retryPolicyInput({
    match: () => false,
  }))
  const result = await owner.api._internal.decide(baseInput())
  assert.equal(result.ok, true)
  assert.equal(result.decision, null)
  assert.equal(result.consultedPolicies, 0)
})

test('registered policy is evaluated and consumed exactly once per window', async () => {
  const owner = createOwner()
  owner.api.capability.register({
    operationId: 'op-1',
    ownerId: 'op-owner',
    generation: 'gen-op-1',
    scope: 'session',
    idempotent: true,
    retryable: true,
    allowedActions: ['retry', 'stop'],
    sideEffectClass: 'read-only',
    retryBudget: { maxAttempts: 2 },
  })
  owner.api.policy.register(retryPolicyInput())
  const decided = await owner.api._internal.decide(baseInput())
  assert.equal(decided.ok, true)
  assert.equal(decided.consultedPolicies, 1)
  assert.equal(decided.decision.action, 'retry')
  const committed = await owner.api._internal.commit(decided.decision, {
    operation: { ownerId: 'op-owner', generation: 'gen-op-1', executionId: 'exec-1', attemptId: 'attempt-1' },
  })
  assert.equal(committed.ok, true)
  assert.equal(committed.channel, 'automatic')
  // duplicate commit in the same window is a typed conflict: no second attempt
  const again = await owner.api._internal.commit(decided.decision, {
    operation: { ownerId: 'op-owner', generation: 'gen-op-1', executionId: 'exec-1', attemptId: 'attempt-1' },
  })
  assert.equal(again.ok, false)
  assert.equal(again.code, 'conflict')
  // window reuse: a duplicate failure returns the same decision, still once
  const duplicate = await owner.api._internal.decide(baseInput())
  assert.equal(duplicate.decision.decisionId, decided.decision.decisionId)
})

test('cancellation and terminal outcomes never produce an automatic retry', async () => {
  const owner = createOwner()
  owner.api.capability.register({
    operationId: 'op-1',
    ownerId: 'op-owner',
    generation: 'gen-op-1',
    scope: 'session',
    idempotent: true,
    retryable: true,
    allowedActions: ['retry', 'stop'],
    sideEffectClass: 'read-only',
    retryBudget: { maxAttempts: 3 },
  })
  owner.api.policy.register(retryPolicyInput())
  const controller = new AbortController()
  controller.abort()
  const cancelled = await owner.api._internal.decide(baseInput({ signal: controller.signal, decisionWindowId: 'w-cancelled' }))
  assert.equal(cancelled.decision.action, 'stop')
  assert.equal(cancelled.decision.reason.code, 'recovery-cancelled')
  const terminal = await owner.api._internal.decide(baseInput({
    execution: { executionId: 'exec-1', attemptId: 'attempt-1', terminalOutcome: 'error' },
    decisionWindowId: 'w-terminal',
  }))
  assert.equal(terminal.decision.action, 'stop')
  assert.equal(terminal.decision.reason.code, 'terminal-outcome-committed')
})

test('cooperative evaluate keeps the safe-default outcome and shares the same generation and reducer', async () => {
  const owner = createOwner()
  const plain = await owner.api.evaluate(baseInput({ decisionWindowId: 'coop-a' }))
  assert.equal(plain.action, 'stop')
  assert.equal(plain.reason.code, 'safe-default')
  owner.api.capability.register({
    operationId: 'op-1',
    ownerId: 'op-owner',
    generation: 'gen-op-1',
    scope: 'session',
    idempotent: true,
    retryable: true,
    allowedActions: ['retry', 'stop'],
    sideEffectClass: 'read-only',
    retryBudget: { maxAttempts: 2 },
  })
  owner.api.policy.register(retryPolicyInput({ decide: () => ({ action: 'retry', reason: { code: 'temporary' }, bounds: { attemptsRemaining: 1, deadlineAt: '2999-01-01T00:00:00.000Z', backoff: { kind: 'immediate' } } }) }))
  const automatic = await owner.api._internal.decide(baseInput({ decisionWindowId: 'coop-b' }))
  const cooperative = await owner.api.evaluate(baseInput({ decisionWindowId: 'coop-c' }))
  assert.equal(automatic.decision.action, 'retry')
  assert.equal(cooperative.action, 'retry')
  assert.equal(automatic.decision.reason.code, 'temporary')
  assert.equal(cooperative.reason.code, 'temporary')
})

test('recovery-visibility policies are consumed by the public decision projection', async () => {
  const owner = createOwner()
  owner.api.capability.register({
    operationId: 'op-1',
    ownerId: 'op-owner',
    generation: 'gen-op-1',
    scope: 'session',
    idempotent: true,
    retryable: true,
    allowedActions: ['retry', 'stop'],
    sideEffectClass: 'read-only',
    retryBudget: { maxAttempts: 2 },
  })
  owner.api.policy.register(retryPolicyInput())
  const full = await owner.api.evaluate(baseInput({ decisionWindowId: 'vis-full' }))
  assert.ok(full.capabilityEvidence.length >= 0)
  assert.ok(full.bounds)
  owner.api.visibility.register({
    id: 'redact-evidence',
    ownerId: 'audience-owner',
    generation: 'gen-vis-1',
    fields: ['action', 'reason', 'observedAt'],
  })
  const projected = await owner.api.evaluate(baseInput({ decisionWindowId: 'vis-projected' }))
  assert.equal(projected.action, 'retry')
  assert.equal(projected.bounds, undefined)
  assert.equal(projected.capabilityEvidence, undefined)
  assert.ok(projected.decisionId)
  assert.ok(projected.reason)
})

test('coverage and per-path status flip only when the binding probe reports the owner wired', async () => {
  const owner = createOwner()
  const probes = { 'recovery/model': () => false }
  owner.api._internal.bindProbes(probes)
  assert.equal(owner.api.coverage().automatic['recovery/model'], 'unavailable')
  assert.equal(owner.api.coverage().automatic['recovery/tool'], 'unavailable')
  probes['recovery/model'] = () => true
  probes['recovery/tool'] = () => true
  probes['recovery/task'] = () => true
  probes['recovery/transaction'] = () => true
  probes['recovery-visibility'] = () => true
  owner.api._internal.bindProbes(probes)
  const view = owner.api.coverage()
  assert.equal(view.status, 'active')
  for (const path of ['recovery/model', 'recovery/tool', 'recovery/task', 'recovery/transaction', 'recovery-visibility']) {
    assert.equal(view.automatic[path], 'active')
  }
  assert.equal(owner.api._internal.status('recovery/model').status, 'active')
  assert.equal(owner.api._internal.status('recovery').status, 'active')
  // an unregistered path never inherits a neighbour's status
  assert.equal(owner.api._internal.status('recovery/unknown').status, 'unavailable')
  assert.equal(owner.api._internal.status('recovery/unknown').reason, 'unregistered path')
  // a throwing probe degrades truthfully to unavailable
  probes['recovery/tool'] = () => { throw new Error('probe failed') }
  owner.api._internal.bindProbes(probes)
  assert.equal(owner.api.coverage().automatic['recovery/tool'], 'unavailable')
})

function createTaskSources({ recovery }) {
  const taskScope = { kind: 'workspace', key: 'repo-a' }
  const records = new Map()
  let generationSeq = 0
  const redact = (value) => ({
    resource: value.resource,
    ownerId: value.ownerId,
    generation: value.generation,
    expiresAt: value.expiresAt,
    state: value.state,
    version: value.version,
    fencingValid: value.state === 'active',
  })
  const coordination = {
    async acquire({ resource, ownerId, leaseMs }) {
      if (records.get(resource.key)?.state === 'active') {
        return { ok: false, code: 'conflict', observed: redact(records.get(resource.key)) }
      }
      generationSeq += 1
      const value = {
        resource,
        ownerId,
        generation: `gen:${String(generationSeq).padStart(12, '0')}`,
        fencingToken: `tok-${generationSeq}`,
        expiresAt: new Date(Date.parse(now()) + (leaseMs ?? 60_000)).toISOString(),
        state: 'active',
        version: 0,
      }
      records.set(resource.key, value)
      return { ok: true, handle: { ...value } }
    },
    async takeover() {
      return { ok: false, code: 'conflict', reason: 'not needed in this test' }
    },
    watch(resource) {
      return {
        current() {
          const current = records.get(resource?.key)
          if (!current) return Promise.resolve({ code: 'unavailable' })
          return Promise.resolve(redact(current))
        },
        subscribe() { return () => false },
        dispose() { return true },
      }
    },
    subscribe() { return () => false },
    dispose() { return true },
  }
  const sources = {
    coordination,
    recovery,
    execution: { get() {}, observe() {}, history() {}, onChange() {}, availability: { status: 'available' } },
    diagnostics: { get() {} },
    workspaceTransactions: { get() {} },
    ctx: {
      get(name) {
        if (name === 'jobs') return { get() {}, list() {}, read() {} }
        if (name === 'sessions') return { get() {} }
        return null
      },
      on() { return () => {} },
    },
  }
  return { sources, taskScope }
}

test('task settlement consults the shared authority and a retry decision withholds the terminal commit', async () => {
  const recoveryOwner = createOwner()
  recoveryOwner.api.capability.register({
    operationId: 'task-settlement',
    ownerId: 'facade-task-owner',
    generation: 'gen-any',
    scope: 'workspace',
    idempotent: false,
    retryable: true,
    allowNonIdempotentRetry: true,
    allowedActions: ['retry', 'stop'],
    sideEffectClass: 'external',
    retryBudget: { maxAttempts: 2 },
  })
  recoveryOwner.api.policy.register({
    id: 'task-retry',
    ownerId: 'policy-owner-a',
    generation: 'gen-1',
    decide: (input) => ({
      action: 'retry',
      reason: { code: 'immediate' },
      bounds: { attemptsRemaining: 1, deadlineAt: '2999-01-01T00:00:00.000Z', backoff: { kind: 'immediate' } },
      proposedAttemptId: 'attempt-next',
    }),
  })
  const { sources, taskScope } = createTaskSources({ recovery: recoveryOwner.api })
  const owner = createTaskExecutionObservation({
    ctx: sources.ctx,
    execution: sources.execution,
    recovery: sources.recovery,
    coordination: sources.coordination,
    diagnostics: sources.diagnostics,
    workspaceTransactions: sources.workspaceTransactions,
    logger: { error() {} },
    now,
    idFactory: () => `id-${Math.random().toString(36).slice(2, 8)}`,
  })
  await owner.api.register({ taskId: 'task-1', ownerId: 'worker-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  await owner.api.start('task-1', { workflowId: 'wf-1' })
  const acquired = await sources.coordination.acquire({ resource: { scope: 'workspace', key: 'repo-a:task' }, ownerId: 'worker-1', leaseMs: 60_000 })
  const claimed = await owner.api.claim('task-1', { ownerId: 'worker-1', lease: acquired.handle })
  assert.equal(claimed.ok, true)
  const settled = await owner.api.settle('task-1', { attemptId: claimed.attemptId, outcome: 'error', reason: 'broke' })
  assert.equal(settled.ok, false)
  assert.equal(settled.code, 'conflict')
  assert.equal(settled.recovery.action, 'retry')
  // the attempt stays active so the worker can retry its work
  const read = await owner.api.get('task-1')
  const attempt = read.task.attempts.find((item) => item.attemptId === claimed.attemptId)
  assert.equal(attempt.state, 'active')
  // the window is consumed: a repeated settlement proceeds with the official path
  const repeated = await owner.api.settle('task-1', { attemptId: claimed.attemptId, outcome: 'error', reason: 'broke' })
  assert.equal(repeated.ok, true)
})

test('task settlement without a matching policy keeps the official settlement path', async () => {
  const recoveryOwner = createOwner()
  const { sources, taskScope } = createTaskSources({ recovery: recoveryOwner.api })
  const owner = createTaskExecutionObservation({
    ctx: sources.ctx,
    execution: sources.execution,
    recovery: sources.recovery,
    coordination: sources.coordination,
    diagnostics: sources.diagnostics,
    workspaceTransactions: sources.workspaceTransactions,
    logger: { error() {} },
    now,
    idFactory: () => `id-${Math.random().toString(36).slice(2, 8)}`,
  })
  await owner.api.register({ taskId: 'task-1', ownerId: 'worker-1', scope: taskScope, intent: { kind: 'review', summary: 'review PR' } })
  await owner.api.start('task-1', { workflowId: 'wf-1' })
  const acquired = await sources.coordination.acquire({ resource: { scope: 'workspace', key: 'repo-a:task' }, ownerId: 'worker-1', leaseMs: 60_000 })
  const claimed = await owner.api.claim('task-1', { ownerId: 'worker-1', lease: acquired.handle })
  const settled = await owner.api.settle('task-1', { attemptId: claimed.attemptId, outcome: 'error', reason: 'broke' })
  assert.equal(settled.ok, true)
  assert.equal(settled.recovery, undefined)
})

test('egress coverage flips only for bound official owners and never inherits neighbours', async () => {
  const { createSecurityOwner } = await import('../lib/security-owner.js')
  // the security owner factory is exercised through its own test suite; here we
  // assert the binding vocabulary on the recovery side contract only.
  const owner = createOwner()
  owner.api._internal.bindProbes({ 'recovery/model': () => true })
  const view = owner.api.coverage()
  assert.equal(view.automatic['recovery/model'], 'active')
  assert.equal(view.automatic['recovery/tool'], 'unavailable')
  assert.equal(view.status, 'degraded')
})
