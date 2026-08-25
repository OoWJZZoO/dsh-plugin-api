import test from 'node:test'
import assert from 'node:assert/strict'
import { createRoutePolicyOwner } from '../packages/agent-loop/lib/route-policy.js'

function owner(options = {}) {
  let id = 0
  return createRoutePolicyOwner({
    idFactory: () => String(++id),
    ...options,
  })
}

function windowKey(attemptEpoch = '0') {
  return { sessionId: 'session-1', turn: 1, attemptEpoch }
}

test('route policy converges in priority and registration order with contained failures', async () => {
  const route = owner()
  const calls = []
  route.api.policy.register({
    id: 'low',
    ownerId: 'plugin-a',
    generation: 1,
    priority: 'low',
    decide(input) {
      calls.push(['low', Object.isFrozen(input), Object.isFrozen(input.candidates)])
      return { action: 'select', candidateId: 'second' }
    },
  })
  route.api.policy.register({
    id: 'broken',
    ownerId: 'plugin-b',
    generation: 1,
    priority: 'normal',
    decide() {
      throw new Error('private detail')
    },
  })
  route.api.policy.register({
    id: 'high',
    ownerId: 'plugin-c',
    generation: 1,
    priority: 'high',
    decide() {
      return { action: 'select', candidateId: 'seed' }
    },
  })
  const decision = await route.decide({
    windowKey: windowKey(),
    seed: { provider: 'provider-a', model: 'model-a' },
    candidates: [{ candidateId: 'second', provider: 'provider-b', model: 'model-b' }],
  })
  assert.equal(decision.candidateId, 'seed')
  assert.deepEqual(calls, [['low', true, true]])
  assert.equal(decision.commitState, 'success')
  assert.ok(Object.isFrozen(decision))
  assert.ok(route.diagnostics().some((entry) => entry.code === 'POLICY_FAILED'))
})

test('reject short-circuits and a committed window is reused without late mutation', async () => {
  const route = owner()
  let count = 0
  route.api.policy.register({
    id: 'deny',
    ownerId: 'plugin',
    generation: 1,
    decide() {
      count += 1
      return { action: 'reject', reason: { code: 'BUDGET_DENIED', detail: 'bounded' } }
    },
  })
  const input = { windowKey: windowKey(), seed: { provider: 'p', model: 'm' } }
  const first = await route.decide(input)
  route.api.policy.register({
    id: 'select-late',
    ownerId: 'late',
    generation: 1,
    decide() {
      return { action: 'select', candidateId: 'seed' }
    },
  })
  const second = await route.decide(input)
  assert.strictEqual(second, first)
  assert.equal(count, 1)
  assert.equal(first.commitState, 'denied')
  assert.equal(first.reason.code, 'BUDGET_DENIED')
})

test('new attempt creates a new decision and records fallback lineage', async () => {
  const route = owner()
  const first = await route.decide({ windowKey: windowKey('0'), seed: { provider: 'p1', model: 'm1' } })
  const second = await route.decide({
    windowKey: windowKey('1'),
    seed: { provider: 'p2', model: 'm2' },
    priorDecision: first,
    fallbackCause: { code: 'TIMEOUT', detail: 'provider timeout' },
  })
  assert.notEqual(second.decisionId, first.decisionId)
  assert.equal(second.fallbackParentId, first.decisionId)
  assert.equal(second.fallbackCause.code, 'TIMEOUT')
  assert.equal(route.api.decisions.history({ sessionId: 'session-1' }).items.length, 2)
})

test('health evidence opens a circuit and bounded probe closes it', async () => {
  const route = owner()
  route.api.health.registerCircuitPolicy({
    id: 'provider-health',
    ownerId: 'health-plugin',
    generation: 1,
    scope: { provider: 'provider-a', model: 'model-a' },
    openAfter: 2,
    reEvaluateAfterMs: 0,
  })
  route.api.health.registerProbe({
    id: 'provider-probe',
    ownerId: 'probe-plugin',
    generation: 1,
    scope: { provider: 'provider-a', model: 'model-a' },
    run(input) {
      assert.equal(input.probe, true)
      assert.equal(typeof input.operationId, 'string')
      return 'healthy'
    },
  })
  const scope = { provider: 'provider-a', model: 'model-a' }
  route.api.health.observe(scope, 'failure', { source: 'test', reason: 'first' })
  route.api.health.observe(scope, 'failure', { source: 'test', reason: 'second' })
  assert.equal(route.api.circuit.status(scope).state, 'open')
  const result = await route.api.health.probe(scope)
  assert.equal(result.state, 'success')
  assert.equal(route.api.circuit.status(scope).state, 'closed')
})

test('old owner generation disposers cannot remove a newer registration', () => {
  const route = owner()
  const oldDispose = route.api.policy.register({
    id: 'same',
    ownerId: 'plugin',
    generation: 1,
    decide() { return { action: 'no-op' } },
  })
  const newDispose = route.api.policy.register({
    id: 'same',
    ownerId: 'plugin',
    generation: 2,
    decide() { return { action: 'no-op' } },
  })
  assert.equal(oldDispose(), false)
  assert.equal(route.api.policy.availability.registrations, 1)
  assert.equal(newDispose(), true)
  assert.equal(route.api.policy.availability.registrations, 0)
})
