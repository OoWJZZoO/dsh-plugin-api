import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createSecurityRegistry,
  validatePolicySpec,
  validateRedactionSpec,
  validateEgressSpec,
  describeTarget,
  SECURITY_POINTS,
  POINT_DEFAULTS,
  SECURITY_OUTCOMES,
  REDACTION_AUDIENCES,
  EGRESS_KINDS,
} from '../lib/security-policy.js'
import { SecurityPolicyRegistrationError, SecurityRedactionRegistrationError, SecurityEgressRegistrationError } from '../lib/security-errors.js'

let seq = 0
const now = () => (seq += 1)
const rng = () => `tok${seq}`

function policyRegistry(overrides = {}) {
  return createSecurityRegistry({ validateSpec: validatePolicySpec, now, rng, ...overrides })
}

test('register returns an owner-specific opaque generation and an idempotent disposer', () => {
  const reg = policyRegistry()
  const handle = reg.register('owner-one', {
    id: 'policy-a',
    point: SECURITY_POINTS.toolBefore,
    decide: () => ({ outcome: 'allow' }),
  })
  assert.equal(typeof handle.generation, 'string')
  assert.ok(handle.generation.startsWith('owner-one:'), 'generation is owner-scoped')
  assert.notEqual(handle.generation, reg.register('owner-two', {
    id: 'policy-a',
    point: SECURITY_POINTS.toolBefore,
    decide: () => ({ outcome: 'allow' }),
  }).generation, 'different owners never share a generation')
  assert.equal(handle.dispose(), true)
  assert.equal(handle.dispose(), false, 'disposal is idempotent')
  // identity-bound: another owner's entry survives
  const decision = reg.evaluate({ point: SECURITY_POINTS.toolBefore, context: {} })
  assert.equal(decision.consulted.length, 1, 'the other owner entry stays')
  assert.deepEqual(decision.ownerIds, ['owner-two'])
})

test('re-registering the same owner+id retires the older generation at the next evaluation', () => {
  const reg = policyRegistry()
  const first = reg.register('owner', {
    id: 'policy-a',
    point: SECURITY_POINTS.toolBefore,
    decide: () => ({ outcome: 'allow' }),
  })
  const second = reg.register('owner', {
    id: 'policy-a',
    point: SECURITY_POINTS.toolBefore,
    decide: () => ({ outcome: 'deny' }),
  })
  const decision = reg.evaluate({ point: SECURITY_POINTS.toolBefore, context: {} })
  assert.equal(decision.winner, 'policy-a', 'stable id, newest generation')
  assert.equal(decision.outcome, 'deny', 'the newer generation decides')
  // the stale disposer no longer owns the entry
  assert.equal(first.dispose(), false)
  assert.equal(second.dispose(), true)
})

test('multiple policies with distinct ids coexist in insertion order', () => {
  const reg = policyRegistry()
  const seen = []
  const make = (id, outcome) => reg.register('owner', {
    id,
    point: SECURITY_POINTS.modelRequestBefore,
    decide: (ctx) => { seen.push(id); return { outcome } },
  })
  make('first', 'allow')
  make('second', 'ask')
  const decision = reg.evaluate({ point: SECURITY_POINTS.modelRequestBefore, context: {} })
  assert.deepEqual(seen, ['first', 'second'])
  assert.deepEqual(decision.consulted, ['first', 'second'])
  assert.equal(decision.outcome, 'ask', 'ask outranks allow')
  assert.equal(decision.winner, 'second')
})

test('decision convergence follows deny > ask > allow and records every consulted policy', () => {
  const reg = policyRegistry()
  reg.register('owner', { id: 'allow-a', point: SECURITY_POINTS.approvalBefore, decide: () => ({ outcome: 'allow' }) })
  reg.register('owner', { id: 'ask-a', point: SECURITY_POINTS.approvalBefore, decide: () => ({ outcome: 'ask' }) })
  reg.register('owner', { id: 'deny-a', point: SECURITY_POINTS.approvalBefore, decide: () => ({ outcome: 'deny', reason: 'blocked by rule' }) })
  const decision = reg.evaluate({ point: SECURITY_POINTS.approvalBefore, context: {} })
  assert.equal(decision.outcome, 'deny')
  assert.equal(decision.winner, 'deny-a')
  assert.equal(decision.reason, 'blocked by rule')
  assert.deepEqual(decision.consulted, ['allow-a', 'ask-a', 'deny-a'])
  assert.ok(SECURITY_OUTCOMES.includes(decision.outcome))
})

test('a throwing or malformed policy degrades only that policy to the point default', () => {
  let reported = null
  const reg = policyRegistry({ onPolicyError: (owner, id, error) => { reported = { owner, id, error } } })
  reg.register('owner', {
    id: 'broken',
    point: SECURITY_POINTS.approvalBefore,
    decide: () => { throw new Error('boom') },
  })
  reg.register('owner', {
    id: 'good',
    point: SECURITY_POINTS.approvalBefore,
    decide: () => ({ outcome: 'deny' }),
  })
  const decision = reg.evaluate({ point: SECURITY_POINTS.approvalBefore, context: {} })
  assert.equal(decision.outcome, 'deny', 'the healthy policy still decides')
  assert.equal(decision.winner, 'good')
  assert.equal(decision.consulted.length, 2, 'the degraded policy is still consulted')
  assert.equal(reported.owner, 'owner')
  assert.equal(reported.id, 'broken')
  assert.match(reported.error.message, /boom/)
})

test('a malformed result degrades the policy instead of poisoning the point', () => {
  const reg = policyRegistry({ onPolicyError: () => {} })
  reg.register('owner', { id: 'bad', point: SECURITY_POINTS.toolBefore, decide: () => ({ outcome: 'maybe' }) })
  const decision = reg.evaluate({ point: SECURITY_POINTS.toolBefore, context: {} })
  assert.equal(decision.outcome, POINT_DEFAULTS[SECURITY_POINTS.toolBefore])
  assert.match(decision.reason, /^degraded:/)
})

test('point defaults are fail-closed: no decision point defaults to allow', () => {
  assert.equal(POINT_DEFAULTS[SECURITY_POINTS.egress], 'deny')
  assert.equal(POINT_DEFAULTS[SECURITY_POINTS.approvalBefore], 'ask')
  assert.equal(POINT_DEFAULTS[SECURITY_POINTS.toolBefore], 'ask')
  assert.equal(POINT_DEFAULTS[SECURITY_POINTS.modelRequestBefore], 'ask')
  assert.equal(POINT_DEFAULTS[SECURITY_POINTS.toolAfter], 'noop')
  assert.ok(!Object.values(POINT_DEFAULTS).includes('allow'))
})

test('all-degraded evaluation converges to the point default and stays alive', () => {
  const reg = policyRegistry({ onPolicyError: () => {} })
  reg.register('owner', { id: 'a', point: SECURITY_POINTS.toolBefore, decide: () => { throw new Error('x') } })
  const decision = reg.evaluate({ point: SECURITY_POINTS.toolBefore, context: {} })
  assert.equal(decision.outcome, POINT_DEFAULTS[SECURITY_POINTS.toolBefore])
  assert.equal(decision.winner, undefined)
})

test('no consulted policy returns null so seams pass through unchanged', () => {
  const reg = policyRegistry()
  assert.equal(reg.evaluate({ point: SECURITY_POINTS.approvalBefore, context: {} }), null)
  const only = policyRegistry()
  only.register('owner', { id: 'a', point: SECURITY_POINTS.modelRequestBefore, decide: () => ({ outcome: 'deny' }) })
  assert.equal(only.evaluate({ point: SECURITY_POINTS.approvalBefore, context: {} }), null)
})

test('missing provenance still evaluates and carries a provenance marker', () => {
  const reg = policyRegistry()
  reg.register('owner', { id: 'a', point: SECURITY_POINTS.modelRequestBefore, decide: () => ({ outcome: 'allow' }) })
  const unknown = reg.evaluate({ point: SECURITY_POINTS.modelRequestBefore, context: { provider: 'p' } })
  assert.equal(unknown.provenance, 'unknown')
  assert.equal(unknown.sessionId, undefined)
  const resolved = reg.evaluate({ point: SECURITY_POINTS.modelRequestBefore, context: { sessionId: 's1', provider: 'p', provenance: 'resolved' } })
  assert.equal(resolved.provenance, 'resolved')
  assert.equal(resolved.sessionId, 's1')
})

test('decisions carry decisionId/auditId/at and are deep-frozen', () => {
  const reg = policyRegistry()
  reg.register('owner', { id: 'a', point: SECURITY_POINTS.approvalBefore, decide: () => ({ outcome: 'deny' }) })
  const decision = reg.evaluate({ point: SECURITY_POINTS.approvalBefore, context: { toolName: 'bash' } })
  assert.equal(typeof decision.decisionId, 'string')
  assert.equal(decision.decisionId, decision.auditId, 'auditId is keyed to the decision id')
  assert.equal(decision.at, seq)
  assert.ok(Object.isFrozen(decision))
})

test('optional match filter gates participation', () => {
  const reg = policyRegistry()
  reg.register('owner', {
    id: 'only-http',
    point: SECURITY_POINTS.toolBefore,
    match: (ctx) => ctx.toolName === 'fetch',
    decide: () => ({ outcome: 'deny' }),
  })
  const other = reg.evaluate({ point: SECURITY_POINTS.toolBefore, context: { toolName: 'bash' } })
  assert.equal(other, null)
  const hit = reg.evaluate({ point: SECURITY_POINTS.toolBefore, context: { toolName: 'fetch' } })
  assert.equal(hit.outcome, 'deny')
})

test('expired policies stop participating', () => {
  const reg = policyRegistry()
  reg.register('owner', { id: 'a', point: SECURITY_POINTS.egress ? SECURITY_POINTS.toolBefore : SECURITY_POINTS.toolBefore, expiresAt: 1, decide: () => ({ outcome: 'allow' }) })
  assert.equal(reg.evaluate({ point: SECURITY_POINTS.toolBefore, context: {} }), null)
})

test('registration rejects missing fields, malformed matchers, and invalid points with typed errors', () => {
  const reg = policyRegistry()
  const expectTyped = (fn, ErrorClass, label) => {
    assert.throws(fn, (error) => {
      assert.ok(error instanceof ErrorClass, `${label}: wrong class ${error?.name}`)
      assert.equal(error.code, ErrorClass === SecurityPolicyRegistrationError ? 'SECURITY_POLICY_INVALID_SPEC' : ErrorClass === SecurityRedactionRegistrationError ? 'SECURITY_REDACTION_RULE_INVALID' : 'SECURITY_EGRESS_INVALID_SPEC')
      return true
    })
  }
  expectTyped(() => reg.register('', { id: 'a', point: SECURITY_POINTS.approvalBefore, decide: () => ({ outcome: 'allow' }) }), SecurityPolicyRegistrationError, 'empty owner')
  expectTyped(() => reg.register('owner', {}), SecurityPolicyRegistrationError, 'empty spec')
  expectTyped(() => reg.register('owner', { point: 'none', decide: () => ({ outcome: 'allow' }) }), SecurityPolicyRegistrationError, 'invalid point')
  expectTyped(() => reg.register('owner', { point: SECURITY_POINTS.approvalBefore, match: 'not-a-fn', decide: () => ({ outcome: 'allow' }) }), SecurityPolicyRegistrationError, 'malformed matcher')
  expectTyped(() => reg.register('owner', { point: SECURITY_POINTS.approvalBefore }), SecurityPolicyRegistrationError, 'missing decide')
  expectTyped(() => validatePolicySpec({ point: SECURITY_POINTS.egress, decide: () => ({ outcome: 'allow' }) }), SecurityPolicyRegistrationError, 'bad point validation')
  expectTyped(() => validateRedactionSpec({ audiences: [], match: () => true, action: 'redact' }), SecurityRedactionRegistrationError, 'empty audiences')
  expectTyped(() => validateRedactionSpec({ audiences: ['model', 'model'], match: () => true, action: 'redact' }), SecurityRedactionRegistrationError, 'duplicate audiences')
  expectTyped(() => validateRedactionSpec({ audiences: ['model'], match: () => true, action: 'erase' }), SecurityRedactionRegistrationError, 'invalid action')
  expectTyped(() => validateRedactionSpec({ audiences: ['model'], match: () => true, action: 'redact', mayTouchSecret: 'yes' }), SecurityRedactionRegistrationError, 'invalid mayTouchSecret')
  expectTyped(() => validateEgressSpec({ match: () => true }), SecurityEgressRegistrationError, 'missing decide')
  expectTyped(() => validateEgressSpec({ match: 'x', decide: () => ({ outcome: 'allow' }) }), SecurityEgressRegistrationError, 'malformed egress match')
})

test('redaction spec normalization defaults action to redact and freezes audiences', () => {
  const rule = validateRedactionSpec({ audiences: ['model', 'ui'], match: () => true })
  assert.equal(rule.action, 'redact')
  assert.deepEqual([...rule.audiences], ['model', 'ui'])
  assert.ok(Object.isFrozen(rule.audiences))
})

test('describeTarget bounds and validates egress targets', () => {
  assert.deepEqual(describeTarget({ kind: 'mcp', destination: '  bigcode  ' }), { kind: 'mcp', destination: 'bigcode' })
  assert.throws(() => describeTarget({ kind: 'carrier-pigeon', destination: 'x' }), SecurityEgressRegistrationError)
  assert.throws(() => describeTarget({ kind: 'http', destination: '' }), SecurityEgressRegistrationError)
  assert.throws(() => describeTarget(null), SecurityEgressRegistrationError)
})

test('allowed audience/kind vocabularies are stable', () => {
  assert.deepEqual(REDACTION_AUDIENCES, ['model', 'ui', 'log', 'debug'])
  assert.deepEqual(EGRESS_KINDS, ['subprocess', 'http', 'mcp', 'remote'])
})