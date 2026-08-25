import test from 'node:test'
import assert from 'node:assert/strict'
import { createRecoveryPolicyOwner } from '../lib/recovery-policy.js'
import {
  RecoveryPolicyConsumeError,
  RecoveryPolicyRegistrationError,
} from '../lib/errors.js'

function createOwner() {
  let sequence = 0
  return createRecoveryPolicyOwner({
    idFactory(prefix) {
      sequence += 1
      return `${prefix}-${sequence}`
    },
  })
}

function capability(owner, overrides = {}) {
  return owner.api.capability.declare({
    operationId: 'operation-1',
    ownerId: 'owner-1',
    generation: '1',
    scope: 'session',
    idempotent: true,
    retryable: true,
    allowedActions: ['retry', 'fallback', 'fork', 'abort', 'stop'],
    sideEffectClass: 'read-only',
    retryBudget: { maxAttempts: 2 },
    deadlineMs: 60_000,
    ...overrides,
  })
}

function input(overrides = {}) {
  return {
    failure: { class: 'transient', code: 'provider-timeout' },
    capability: { operationId: 'operation-1', ownerId: 'owner-1', generation: '1' },
    execution: { executionId: 'execution-1', attemptId: 'attempt-1', active: true, cancellable: true },
    scope: 'session',
    evidence: { source: { kind: 'test', observedAt: '2026-08-25T00:00:00.000Z', certainty: 'observed' } },
    ...overrides,
  }
}

test('capability registration validates declarations and old disposer cannot remove a newer generation', () => {
  const owner = createOwner()
  const oldDispose = capability(owner)
  const newDispose = capability(owner, { generation: '2' })
  assert.equal(oldDispose(), false)
  assert.equal(newDispose(), true)
  assert.throws(
    () => owner.api.capability.declare({ operationId: 'x', ownerId: 'o', generation: '1', scope: 'bad' }),
    RecoveryPolicyRegistrationError,
  )
})
test('policies receive frozen explicit input and converge to conservative precedence', async () => {
  const owner = createOwner()
  capability(owner)
  const calls = []
  owner.api.policy.register({
    id: 'retry-policy', ownerId: 'p1', generation: '1', priority: 'low',
    match(value) {
      calls.push(['match', Object.isFrozen(value), Object.isFrozen(value.evidence)])
      return true
    },
    decide(value) {
      calls.push(['decide', Object.isFrozen(value), value.classification.class])
      return {
        action: 'retry',
        reason: { code: 'retryable' },
        proposedAttemptId: 'attempt-2',
        bounds: {
          attemptsRemaining: 1,
          deadlineAt: '2999-01-01T00:00:00.000Z',
          backoff: { kind: 'fixed', ms: 25 },
        },
      }
    },
  })
  owner.api.policy.register({
    id: 'stop-policy', ownerId: 'p2', generation: '1', priority: 'high',
    decide() { return { action: 'stop', reason: { code: 'operator-stop' } } },
  })
  const decision = await owner.api.evaluate(input())
  assert.equal(decision.action, 'stop')
  assert.equal(decision.reason.code, 'operator-stop')
  assert.deepEqual(calls, [
    ['match', true, true],
    ['decide', true, 'transient'],
  ])
  assert.equal(Object.isFrozen(decision), true)
  assert.equal(Object.isFrozen(decision.evidenceProvenance), true)
})

test('policy failures and unsafe retry candidates fail closed without calling an operation', async () => {
  const owner = createOwner()
  owner.api.policy.register({ id: 'broken', ownerId: 'p1', generation: '1', decide() { throw new Error('private') } })
  owner.api.policy.register({ id: 'unsafe', ownerId: 'p2', generation: '1', decide() {
    return { action: 'retry', reason: { code: 'retry' }, bounds: { attemptsRemaining: 1, deadlineAt: '2999-01-01T00:00:00.000Z', backoff: { kind: 'immediate' } } }
  } })
  const decision = await owner.api.evaluate(input({ capability: undefined }))
  assert.equal(decision.action, 'stop')
  assert.equal(decision.reason.code, 'retry-capability-missing')
  assert.equal(owner.diagnostics().some((entry) => entry.code === 'policy-decision-failed'), true)
  assert.equal(owner.diagnostics().some((entry) => entry.code === 'retry-capability-missing'), true)
})

test('retry preserves execution and creates a distinct proposed attempt with finite bounds', async () => {
  const owner = createOwner()
  capability(owner)
  owner.api.policy.register({
    id: 'retry', ownerId: 'p', generation: '1', decide() {
      return { action: 'retry', reason: { code: 'temporary' }, bounds: {
        attemptsRemaining: 1,
        deadlineAt: '2999-01-01T00:00:00.000Z',
        backoff: { kind: 'exponential-jitter', ms: 50 },
      } }
    },
  })
  const decision = await owner.api.evaluate(input())
  assert.equal(decision.action, 'retry')
  assert.equal(decision.execution.executionId, 'execution-1')
  assert.notEqual(decision.proposedAttemptId, 'attempt-1')
  assert.equal(decision.bounds.attemptsRemaining, 1)
  assert.equal(decision.bounds.backoff.kind, 'exponential-jitter')
})

test('fallback and fork preserve parentage but do not choose route or claim copied state', async () => {
  const owner = createOwner()
  capability(owner)
  owner.api.policy.register({ id: 'fallback', ownerId: 'p', generation: '1', decide() {
    return { action: 'fallback', reason: { code: 'provider-failed' } }
  } })
  const fallback = await owner.api.evaluate(input({ decisionWindowId: 'fallback-window' }))
  assert.equal(fallback.action, 'fallback')
  assert.deepEqual(fallback.parent, { executionId: 'execution-1', attemptId: 'attempt-1' })
  assert.equal('provider' in fallback, false)

  const forkOwner = createOwner()
  capability(forkOwner)
  forkOwner.api.policy.register({ id: 'fork', ownerId: 'p', generation: '1', decide() {
    return { action: 'fork', reason: { code: 'manual-fork' } }
  } })
  const fork = await forkOwner.api.evaluate(input({ decisionWindowId: 'fork-window', approvalGranted: true }))
  assert.equal(fork.action, 'fork')
  assert.deepEqual(fork.parent, { executionId: 'execution-1', attemptId: 'attempt-1' })
  assert.equal('copied' in fork, false)
})

test('abort requires a live cancellable operation and terminal executions stop late evaluation', async () => {
  const owner = createOwner()
  capability(owner)
  owner.api.policy.register({ id: 'abort', ownerId: 'p', generation: '1', decide() {
    return { action: 'abort', reason: { code: 'cancel' } }
  } })
  const inactive = await owner.api.evaluate(input({ cancellable: false, decisionWindowId: 'inactive' }))
  assert.equal(inactive.action, 'stop')
  assert.equal(inactive.reason.code, 'abort-operation-inactive')
  const terminal = await owner.api.evaluate(input({ execution: { executionId: 'execution-2', attemptId: 'a', terminalOutcome: 'success' } }))
  assert.equal(terminal.action, 'stop')
  assert.equal(terminal.reason.code, 'terminal-outcome-committed')
})

test('same decision window is stable and consume is identity guarded and single use', async () => {
  const owner = createOwner()
  capability(owner)
  let count = 0
  owner.api.policy.register({ id: 'retry', ownerId: 'p', generation: '1', decide() {
    count += 1
    return { action: 'retry', reason: { code: 'temporary' }, proposedAttemptId: 'attempt-2', bounds: {
      attemptsRemaining: 1, deadlineAt: '2999-01-01T00:00:00.000Z', backoff: { kind: 'immediate' },
    } }
  } })
  const first = await owner.api.evaluate(input({ decisionWindowId: 'same' }))
  const second = await owner.api.evaluate(input({ decisionWindowId: 'same' }))
  assert.strictEqual(second, first)
  assert.equal(count, 1)
  assert.deepEqual(owner.api.consume(first.decisionId, { attemptId: 'attempt-2' }).consumed, true)
  assert.throws(() => owner.api.consume(first.decisionId, { attemptId: 'attempt-2' }), RecoveryPolicyConsumeError)
  assert.throws(() => owner.api.consume(first.decisionId, { attemptId: 'other' }), RecoveryPolicyConsumeError)
})

test('cancellation and stale policy results cannot publish a decision', async () => {
  const owner = createOwner()
  capability(owner)
  let dispose
  dispose = owner.api.policy.register({ id: 'late', ownerId: 'p', generation: '1', async decide() {
    dispose()
    await Promise.resolve()
    return { action: 'stop', reason: { code: 'late' } }
  } })
  const stale = await owner.api.evaluate(input({ decisionWindowId: 'stale' }))
  assert.equal(stale.action, 'stop')
  assert.equal(stale.reason.code, 'safe-default')
  const controller = new AbortController()
  controller.abort()
  const cancelled = await owner.api.evaluate(input({ signal: controller.signal, decisionWindowId: 'cancelled' }))
  assert.equal(cancelled.reason.code, 'recovery-cancelled')
})

test('visibility defaults to omission for model and exposes only bounded proposed fields when elevated', async () => {
  const owner = createOwner()
  const decision = await owner.api.evaluate({ failure: { class: 'permanent', code: 'denied' }, decisionWindowId: 'visibility' })
  assert.equal(owner.api.visibility.project(decision, { audience: 'model' }), undefined)
  const view = owner.api.visibility.project(decision, { audience: 'model', elevate: true })
  assert.equal(view.proposedAction, 'stop')
  assert.equal('capabilityEvidence' in view, false)
  assert.equal('requestBody' in view, false)
})
