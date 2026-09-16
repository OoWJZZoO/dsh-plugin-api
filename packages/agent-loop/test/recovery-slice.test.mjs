import test from 'node:test'
import assert from 'node:assert/strict'
import { consumeRequestRecovery, consumeToolRecovery, RECOVERY_OWNER_ID } from '../lib/recovery-slice.js'

/**
 * Contract-faithful internal-authority double: same decide/commit surface and
 * single-consumption semantics as the facade's recovery owner internal pair.
 */
function createAuthorityDouble({ decision, policies = 1 } = {}) {
  const commits = []
  const consumed = new Set()
  const decideCalls = []
  return {
    commits,
    decideCalls,
    recovery: {
      async decide(input) {
        decideCalls.push(input)
        if (policies === 0) return { ok: true, decision: null, consultedPolicies: 0 }
        return { ok: true, decision: decision ?? null, consultedPolicies: policies }
      },
      async commit(dec, operation) {
        if (!dec?.decisionId) return { ok: false, code: 'invalid-input', reason: 'decision must carry a decisionId' }
        if (consumed.has(dec.decisionId)) return { ok: false, code: 'conflict', reason: 'decision already consumed' }
        consumed.add(dec.decisionId)
        commits.push({ decisionId: dec.decisionId, operation: operation?.operation ?? operation })
        return { ok: true, code: 'committed', decisionId: dec.decisionId, channel: 'automatic' }
      },
    },
  }
}

function createLoopCtx(authority, pluginApi) {
  return {
    get(name) {
      if (name === 'pluginApi') return pluginApi
      return undefined
    },
    ...(authority ? { [Symbol.for('dsh-plugin-api.policyAuthority')]: authority } : {}),
  }
}

const SESSION = { id: 'session-1' }

test('a missing internal authority keeps the official default governing (fail-safe)', async () => {
  const outcome = await consumeRequestRecovery({
    loopCtx: {},
    session: SESSION,
    turn: 1,
    attemptEpoch: '0',
    provider: 'p',
    failure: { code: 'timeout', message: 'x' },
  })
  assert.deepEqual(outcome, { governs: false })
})

test('no matching recovery policy reports a null decision and the official default governs', async () => {
  const authority = createAuthorityDouble({ policies: 0 })
  const outcome = await consumeRequestRecovery({
    loopCtx: createLoopCtx(authority),
    session: SESSION,
    turn: 1,
    attemptEpoch: '0',
    provider: 'p',
    failure: { code: 'timeout', message: 'x' },
  })
  assert.equal(outcome.governs, false)
})

test('a policy retry is committed once and advances the attempt with a fallback cause mapping', async () => {
  const authority = createAuthorityDouble({
    decision: { decisionId: 'd1', action: 'retry', reason: { code: 'temporary' } },
  })
  const capabilitySpecs = []
  const pluginApi = {
    executions: {
      recovery: {
        capability: {
          register(spec) {
            capabilitySpecs.push(spec)
            return { id: spec.operationId, dispose: () => true }
          },
        },
      },
    },
  }
  const outcome = await consumeRequestRecovery({
    loopCtx: createLoopCtx(authority, pluginApi),
    session: SESSION,
    turn: 2,
    attemptEpoch: '1',
    provider: 'p',
    failure: { code: 'timeout', message: 'x' },
    retryPolicy: { mode: 'normal', maxRetries: 3 },
  })
  assert.equal(outcome.governs, true)
  assert.equal(outcome.action.kind, 'retry')
  assert.equal(outcome.action.cause, 'temporary')
  assert.equal(authority.commits.length, 1)
  assert.equal(authority.commits[0].operation.ownerId, RECOVERY_OWNER_ID)
  assert.equal(authority.commits[0].operation.executionId, 'agent-loop:session-1:turn-2')
  assert.equal(authority.commits[0].operation.attemptId, '1')
  assert.equal(capabilitySpecs.length, 1)
  assert.equal(capabilitySpecs[0].operationId, 'agent-loop-model-request')
  assert.equal(capabilitySpecs[0].retryBudget.maxAttempts, 3)
  // The declaration must satisfy the engine's identity contract, and the
  // decide call must reference the operation by the same pair: a declaration
  // the engine refuses is swallowed as best-effort and would silently turn the
  // automatic retry into a terminal stop.
  assert.equal(capabilitySpecs[0].scopeOwner, RECOVERY_OWNER_ID, 'the declaration names the operation scope owner')
  assert.equal(typeof capabilitySpecs[0].scopeGeneration, 'string')
  assert.equal(capabilitySpecs[0].ownerId, undefined, 'the declaration does not borrow the caller-identity parameter name')
  assert.deepEqual(authority.decideCalls[0]?.capability ?? {}, {
    operationId: 'agent-loop-model-request',
    scopeOwner: RECOVERY_OWNER_ID,
    scopeGeneration: capabilitySpecs[0].scopeGeneration,
  }, 'the decide call carries the same scope pair the declaration used')
})

test('the declaration the slice sends is accepted by the real recovery engine', async () => {
  const { createRecoveryPolicyOwner } = await import('../../../lib/recovery-policy.js')
  const owner = createRecoveryPolicyOwner({ logger: { warn() {} } })
  const capabilitySpecs = []
  const pluginApi = { executions: { recovery: { capability: { register(spec) { capabilitySpecs.push(spec); return owner.api.capability.register(spec) } } } } }
  const authority = createAuthorityDouble({ decision: { decisionId: 'd-real', action: 'stop', reason: { code: 'no-retry' } } })
  await consumeRequestRecovery({
    loopCtx: createLoopCtx(authority, pluginApi),
    session: SESSION,
    turn: 3,
    attemptEpoch: '1',
    provider: 'p',
    failure: { code: 'timeout', message: 'x' },
    retryPolicy: { mode: 'normal', maxRetries: 2 },
  })
  // The engine owns the declaration: a refused one never reaches its registry,
  // which is exactly how the automatic path would go silent. The declaration
  // count is the evidence — the availability flag stays active either way.
  assert.equal(owner.api.availability().capabilities, 1, 'the engine accepted the declaration')
  assert.equal(capabilitySpecs.length, 1)
  owner.dispose()
})

test('a fallback decision re-enters the next attempt with the fallback cause; abort becomes terminal', async () => {
  const fallback = await consumeRequestRecovery({
    loopCtx: createLoopCtx(createAuthorityDouble({ decision: { decisionId: 'd2', action: 'fallback', reason: { code: 'provider-down' } } })),
    session: SESSION,
    turn: 1,
    attemptEpoch: '0',
    provider: 'p',
    failure: { code: 'timeout', message: 'x' },
  })
  assert.equal(fallback.governs, true)
  assert.equal(fallback.action.kind, 'retry')
  assert.equal(fallback.action.cause, 'recovery-fallback')
  const abort = await consumeRequestRecovery({
    loopCtx: createLoopCtx(createAuthorityDouble({ decision: { decisionId: 'd3', action: 'abort' } })),
    session: SESSION,
    turn: 1,
    attemptEpoch: '0',
    provider: 'p',
    failure: { code: 'timeout', message: 'x' },
  })
  assert.equal(abort.governs, true)
  assert.equal(abort.terminal, true)
})

test('a consumed window cannot start a second automatic application', async () => {
  const authority = createAuthorityDouble({
    decision: { decisionId: 'd4', action: 'retry', reason: { code: 'temporary' } },
  })
  const input = {
    loopCtx: createLoopCtx(authority),
    session: SESSION,
    turn: 1,
    attemptEpoch: '0',
    provider: 'p',
    failure: { code: 'timeout', message: 'x' },
  }
  const first = await consumeRequestRecovery(input)
  assert.equal(first.governs, true)
  assert.equal(first.action.kind, 'retry')
  // the real owner reuses the decision per window; the double simulates the
  // commit guard directly: a second application attempt is a typed conflict
  const secondCommit = await authority.recovery.commit(
    { decisionId: 'd4' },
    { operation: { ownerId: RECOVERY_OWNER_ID } },
  )
  assert.equal(secondCommit.ok, false)
  assert.equal(secondCommit.code, 'conflict')
})

test('tool dispatch recovery re-dispatches once per call window and then keeps official semantics', async () => {
  const authority = createAuthorityDouble({
    decision: { decisionId: 't1', action: 'retry', reason: { code: 'immediate' } },
  })
  const first = await consumeToolRecovery({
    loopCtx: createLoopCtx(authority),
    session: SESSION,
    turn: 1,
    step: 1,
    callId: 'call-1',
    toolName: 'read',
    failure: new Error('dispatch failed'),
  })
  assert.equal(first.governs, true)
  assert.equal(first.action.kind, 'retry')
  // window reuse: the same call window cannot consume the decision twice
  const secondCommit = await authority.recovery.commit(
    { decisionId: 't1' },
    { operation: { ownerId: RECOVERY_OWNER_ID } },
  )
  assert.equal(secondCommit.ok, false)
  assert.equal(secondCommit.code, 'conflict')
})

test('tool recovery without policies keeps the official scheduler failure semantics', async () => {
  const authority = createAuthorityDouble({ policies: 0 })
  const outcome = await consumeToolRecovery({
    loopCtx: createLoopCtx(authority),
    session: SESSION,
    turn: 1,
    step: 1,
    callId: 'call-1',
    toolName: 'read',
    failure: new Error('dispatch failed'),
  })
  assert.equal(outcome.governs, false)
})
