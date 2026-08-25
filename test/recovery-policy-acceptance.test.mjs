import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRecoveryPolicyOwner } from '../lib/recovery-policy.js'
import { createRecoveryAdapters } from '../lib/recovery-adapters.js'
import { RecoveryPolicyBoundaryError } from '../lib/errors.js'

const root = resolve(new URL('..', import.meta.url).pathname)

function owner(options = {}) {
  let sequence = 0
  return createRecoveryPolicyOwner({
    idFactory(prefix) {
      sequence += 1
      return `${prefix}-${sequence}`
    },
    ...options,
  })
}

function declareCapability(recovery, overrides = {}) {
  return recovery.api.capability.declare({
    operationId: 'operation-1',
    ownerId: 'consumer-1',
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

function execution() {
  return { executionId: 'execution-1', attemptId: 'attempt-1', active: true, cancellable: true }
}

test('explicit public projections interoperate without ownership or mutation', async () => {
  const recovery = owner()
  declareCapability(recovery)
  const evidence = {
    source: { kind: 'operation', observedAt: '2026-08-25T00:00:00.000Z', certainty: 'observed' },
    budget: { remaining: 3, provenance: { source: 'usage-budget-telemetry', certainty: 'observed' } },
    route: { lineageId: 'route-lineage-1', provenance: { source: 'model-route-policy', certainty: 'inferred' } },
    diagnostics: { availability: 'active', provenance: { source: 'plugin-diagnostics', certainty: 'observed' } },
    branch: { branchId: 'branch-1', provenance: { source: 'session', certainty: 'observed' } },
    checkpoint: { status: 'unavailable', provenance: { source: 'checkpoint', certainty: 'unavailable' } },
  }
  const before = structuredClone(evidence)
  const policyInputChecks = []
  recovery.api.policy.register({
    id: 'fallback-on-transient',
    ownerId: 'consumer-1',
    generation: '1',
    decide(input) {
      policyInputChecks.push({
        frozen: Object.isFrozen(input) && Object.isFrozen(input.evidence),
        route: input.evidence.route.lineageId,
        checkpoint: input.evidence.checkpoint.status,
      })
      return { action: 'fallback', reason: { code: 'route-owner-must-select-next-candidate' } }
    },
  })

  let routeSelections = 0
  let actionExecutions = 0
  const decision = await recovery.api.evaluate({
    failure: { class: 'transient', code: 'provider-timeout' },
    capability: { operationId: 'operation-1', ownerId: 'consumer-1', generation: '1' },
    execution: execution(),
    scope: 'session',
    evidence,
    decisionWindowId: 'interop-window',
  })

  assert.equal(decision.action, 'fallback')
  assert.deepEqual(decision.parent, { executionId: 'execution-1', attemptId: 'attempt-1' })
  assert.equal(decision.route, undefined)
  assert.deepEqual(policyInputChecks, [{ frozen: true, route: 'route-lineage-1', checkpoint: 'unavailable' }])
  assert.deepEqual(evidence, before)
  assert.deepEqual(
    decision.evidenceProvenance.map((item) => [item.source, item.certainty]),
    [
      ['operation', 'observed'],
      ['budget', 'observed'],
      ['route', 'inferred'],
      ['diagnostics', 'observed'],
      ['checkpoint', 'unavailable'],
      ['branch', 'observed'],
    ],
  )

  // This is the caller-owned handoff boundary: recovery only returns lineage;
  // the route owner chooses a candidate and the execution owner performs work.
  const routePolicy = {
    decide(input) {
      routeSelections += 1
      assert.deepEqual(input.parent, decision.parent)
      return { candidateId: 'route-owned-candidate' }
    },
  }
  const routeDecision = routePolicy.decide({ parent: decision.parent })
  assert.equal(routeDecision.candidateId, 'route-owned-candidate')
  assert.equal(routeSelections, 1)
  assert.equal(actionExecutions, 0)
})

test('missing projections stay unavailable and recovery does not mutate sibling owners', async () => {
  const recovery = owner()
  const before = recovery.api.availability()
  const decision = await recovery.api.evaluate({
    failure: { class: 'permanent', code: 'provider-error' },
    execution: execution(),
    scope: 'session',
    evidence: { source: { kind: 'operation', observedAt: '2026-08-25T00:00:00.000Z' } },
    decisionWindowId: 'missing-projections',
  })
  const after = recovery.api.availability()
  assert.equal(decision.action, 'stop')
  assert.deepEqual(
    decision.evidenceProvenance.slice(1).map((item) => item.certainty),
    ['unavailable', 'unavailable', 'unavailable', 'unavailable', 'unavailable'],
  )
  assert.equal(before.capabilities, after.capabilities)
  assert.equal(before.policies, after.policies)
  assert.equal('retry' in recovery.api, false)
  assert.equal('route' in recovery.api, false)
  assert.equal('checkpoint' in recovery.api, false)
})

test('unsupported capabilities and boundary requests fail closed with explicit evidence', async () => {
  const kinds = [
    'automatic-route-selection',
    'provider-billing',
    'approval-bypass',
    'boot-mutation',
    'checkpoint-restore',
    'workspace-transaction',
    'lease-cas',
    'automatic-compensation',
    'scheduler',
  ]
  const adapters = createRecoveryAdapters()
  for (const kind of kinds) {
    const adapted = adapters.fromAgentRequestError({ requestedCapability: kind })
    assert.equal(adapted.unsupported.kind, kind)
    assert.throws(() => adapters.unsupported(kind), RecoveryPolicyBoundaryError)

    const recovery = owner()
    const decision = await recovery.api.evaluate({ requestedCapability: kind, decisionWindowId: kind })
    assert.equal(decision.action, 'stop')
    assert.equal(decision.reason.code, 'unsupported-boundary')
  }
})

test('route, billing, approval, replay, budget, and abort attempts remain outside recovery', async () => {
  const routeRecovery = owner()
  declareCapability(routeRecovery)
  routeRecovery.api.policy.register({
    id: 'route-selection', ownerId: 'p', generation: '1', decide() {
      return { action: 'fallback', provider: 'provider-b', model: 'model-b' }
    },
  })
  const routeDecision = await routeRecovery.api.evaluate({
    failure: { class: 'transient' }, capability: { operationId: 'operation-1', ownerId: 'consumer-1', generation: '1' },
    execution: execution(), scope: 'session', decisionWindowId: 'route-selection',
  })
  assert.equal(routeDecision.reason.code, 'fallback-route-selection-forbidden')

  const nonIdempotent = owner()
  declareCapability(nonIdempotent, { idempotent: false, sideEffectClass: 'non-idempotent', allowedActions: ['retry', 'stop'] })
  nonIdempotent.api.policy.register({
    id: 'replay', ownerId: 'p', generation: '1', decide() {
      return { action: 'retry', bounds: { attemptsRemaining: 1, deadlineAt: '2999-01-01T00:00:00.000Z', backoff: { kind: 'immediate' } } }
    },
  })
  const replayDecision = await nonIdempotent.api.evaluate({
    failure: { class: 'transient' }, capability: { operationId: 'operation-1', ownerId: 'consumer-1', generation: '1' },
    execution: execution(), scope: 'session', decisionWindowId: 'non-idempotent',
  })
  assert.equal(replayDecision.reason.code, 'retry-non-idempotent')

  const approval = owner()
  declareCapability(approval, { allowedActions: ['fork', 'stop'], forkRequiresApproval: true })
  approval.api.policy.register({ id: 'fork', ownerId: 'p', generation: '1', decide() { return { action: 'fork' } } })
  const approvalDecision = await approval.api.evaluate({
    failure: { class: 'transient' }, capability: { operationId: 'operation-1', ownerId: 'consumer-1', generation: '1' },
    execution: execution(), scope: 'session', approvalGranted: false, decisionWindowId: 'approval-bypass',
  })
  assert.equal(approvalDecision.reason.code, 'fork-approval-required')

  const budget = owner()
  declareCapability(budget, { allowedActions: ['retry', 'stop'] })
  budget.api.policy.register({ id: 'retry', ownerId: 'p', generation: '1', decide() {
    return { action: 'retry', bounds: { attemptsRemaining: 1, deadlineAt: '2999-01-01T00:00:00.000Z', backoff: { kind: 'immediate' } } }
  } })
  const budgetDecision = await budget.api.evaluate({
    failure: { class: 'transient' }, capability: { operationId: 'operation-1', ownerId: 'consumer-1', generation: '1' },
    execution: execution(), scope: 'session', attemptsRemaining: 0, decisionWindowId: 'budget-exhausted',
  })
  assert.equal(budgetDecision.reason.code, 'retry-budget-exhausted')

  const abort = owner()
  abort.api.policy.register({ id: 'abort', ownerId: 'p', generation: '1', decide() { return { action: 'abort' } } })
  const abortDecision = await abort.api.evaluate({ failure: { class: 'transient' }, cancellable: true, decisionWindowId: 'missing-active-operation' })
  assert.equal(abortDecision.reason.code, 'abort-operation-inactive')

  const invalid = owner()
  invalid.api.policy.register({ id: 'billing', ownerId: 'p', generation: '1', decide() { return { action: 'bill' } } })
  const invalidDecision = await invalid.api.evaluate({ failure: { class: 'permanent' }, decisionWindowId: 'invalid-billing-action' })
  assert.equal(invalidDecision.reason.code, 'decision-action-invalid')
})

test('recovery implementation has no private official imports and the repository diff has no official package paths', () => {
  for (const file of ['lib/recovery-classifier.js', 'lib/recovery-adapters.js', 'lib/recovery-policy.js']) {
    const source = readFileSync(resolve(root, file), 'utf8')
    assert.doesNotMatch(source, /@deepseek-ai\/dsh|\/usr\/lib\/node_modules\/@deepseek-ai\/dsh/)
  }
  const diffPaths = execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' })
  assert.doesNotMatch(diffPaths, /@deepseek-ai[\\/]dsh/)
})
