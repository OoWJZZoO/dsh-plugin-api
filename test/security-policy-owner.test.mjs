import test from 'node:test'
import assert from 'node:assert/strict'
import { createSecurityOwner } from '../lib/security-owner.js'
import { SecurityPolicyDeniedError } from '../lib/security-errors.js'

/**
 * Official seam fixture shapes, verified against the locked runtime
 * (`/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`
 * dsh-user-approval / dsh-tools / dsh-llm types on 2026-08-25):
 * - approval/request waterfall: (req, next) => Promise<ApprovalOutcome>
 *   where ApprovalOutcome = 'allowed-once'|'rejected'|'cancelled'|'unavailable'
 *   (dsh-user-approval/lib/types/types.d.ts:23; index.d.ts:24)
 * - tools/pre-execute: (exec, next) => Promise<PreToolDecision>
 *   PreToolDecision = {kind:'allow'} | {kind:'deny', reason} | {kind:'ask', reason?}
 *   (dsh-tools/lib/types/index.d.ts:38; PreToolDecision at :418-426)
 * - tools/post-execute: (exec, result, next) => Promise<PostToolDecision>
 *   accept = {kind:'accept', content?} | {kind:'accept', value} | {kind:'block', feedback}
 *   (dsh-tools/lib/types/index.d.ts:61; PostToolDecision at :431-445)
 * - llm/stream: (options, next) => AsyncIterable<StreamChunk> (dsh-llm types :43)
 */
const APPROVAL_OUTCOMES = Object.freeze(['allowed-once', 'rejected', 'cancelled', 'unavailable'])
const TOOL_PRE_DECISIONS = Object.freeze(['allow', 'deny', 'ask'])
const TOOL_POST_DECISIONS = Object.freeze(['accept', 'block'])

function createMockCtx() {
  const listeners = new Map()
  let nextId = 1
  const ctx = {
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name).push(listener)
      const entry = listeners.get(name).at(-1)
      return () => {
        const arr = listeners.get(name)
        const index = arr?.indexOf(entry)
        if (arr && index !== -1) arr.splice(index, 1)
      }
    },
  }
  /** Chained waterfall dispatch: each member receives (args..., next). */
  const waterfall = async (name, base, ...args) => {
    const chain = listeners.get(name) ?? []
    let index = 0
    const next = async () => {
      const listener = chain[index++]
      if (!listener) return base
      return listener(...args, next)
    }
    return next()
  }
  return { ctx, listeners, waterfall, helpers: { nextId: () => `id-${nextId++}` } }
}

function ownerWith({ diagnostics = null, on = null } = {}) {
  const { ctx, listeners, waterfall } = createMockCtx()
  const warnings = []
  const owner = createSecurityOwner({
    ctx,
    logger: { warn(message) { warnings.push(message) } },
    diagnosticsFacade: () => diagnostics,
  })
  return { ctx, listeners, waterfall, owner, warnings }
}

test('owner creation requires the ctx.on substrate (fail-safe setup)', () => {
  assert.equal(createSecurityOwner({ ctx: {} }), null)
  assert.equal(createSecurityOwner({ ctx: { on: 'not-a-fn' } }), null)
})

test('healthy owner exposes the four faces and a truthful availability projection', () => {
  const { owner } = ownerWith()
  assert.ok(owner)
  assert.equal(typeof owner.api.policy.register, 'function')
  assert.equal(typeof owner.api.redaction.register, 'function')
  assert.equal(typeof owner.api.egress.register, 'function')
  assert.equal(owner.api.egress.check, undefined, 'the consultative check member is deleted')
  assert.equal(typeof owner.api.egress.lease.acquire, 'function')
  assert.equal(typeof owner.api.audit.list, 'function')
  const availability = owner.api.availability
  assert.deepEqual(availability.faces, { policy: 'active', redaction: 'active', egress: 'active', audit: 'active' })
  assert.deepEqual(availability.seams, { approval: 'bound', toolBefore: 'bound', toolAfter: 'bound', modelRequest: 'bound' })
  assert.equal(availability.secretPolicy, 'default-deny')
  assert.equal(availability.audit.durable, 'non-durable')
  assert.ok(Object.isFrozen(availability))
})

test('a single seam binding failure degrades only that seam (availability truthful)', () => {
  const listeners = new Map()
  const ctx = {
    on(name, listener) {
      if (name === 'approval/request') throw new Error('seam unavailable')
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name).push(listener)
      const entry = listeners.get(name).at(-1)
      return () => {
        const arr = listeners.get(name)
        const index = arr?.indexOf(entry)
        if (arr && index !== -1) arr.splice(index, 1)
      }
    },
  }
  const owner = createSecurityOwner({ ctx, logger: { warn() {} } })
  assert.ok(owner)
  const availability = owner.api.availability
  assert.equal(availability.seams.approval, 'absent', 'the broken seam is reported absent')
  assert.equal(availability.seams.toolBefore, 'bound', 'the other seams stay bound')
  assert.equal(availability.seams.toolAfter, 'bound')
  assert.equal(availability.seams.modelRequest, 'bound')
})

test('no registered policies leaves the official approval flow completely unchanged', async () => {
  const { listeners, waterfall, owner } = ownerWith()
  const outcome = await waterfall('approval/request', 'unavailable', { toolName: 'bash', reason: 'why' })
  assert.equal(outcome, 'unavailable', 'base next() passes through untouched')
  assert.equal(owner.api.audit.list({}).records.length, 0, 'no decision, no audit record')
})

test('approval deny short-circuits with the official rejected outcome and audits the decision', async () => {
  const { listeners, waterfall, owner } = ownerWith()
  owner.api.policy.register('approver', {
    id: 'ro-deny',
    point: 'approval-before',
    match: (ctx) => ctx.toolName === 'bash',
    decide: (ctx) => ({ outcome: 'deny', reason: 'read-only policy' }),
  })
  const outcome = await waterfall('approval/request', 'unavailable', { toolName: 'bash', reason: 'write file' })
  assert.equal(outcome, 'rejected')
  assert.ok(APPROVAL_OUTCOMES.includes(outcome))
  const view = owner.api.audit.list({})
  assert.equal(view.records.length, 1)
  const hit = view.records[0]
  assert.equal(hit.kind, 'decision')
  assert.deepEqual(hit.ownerIds, ['approver'])
  assert.deepEqual(hit.policyIds, ['ro-deny'])
  assert.equal(hit.outcome, 'deny')
  assert.equal(hit.summary.point, 'approval-before')
})

test('approval allow claims the official one-shot grant; ask falls through to the interactive flow', async () => {
  const { listeners, waterfall, owner } = ownerWith()
  owner.api.policy.register('approver', { id: 'allow-1', point: 'approval-before', decide: () => ({ outcome: 'allow' }) })
  owner.api.policy.register('approver', { id: 'ask-1', point: 'approval-before', match: (ctx) => ctx.toolName === 'asky', decide: () => ({ outcome: 'ask' }) })
  const allowed = await waterfall('approval/request', 'unavailable', { toolName: 'ok' })
  assert.equal(allowed, 'allowed-once')
  const asked = await waterfall('approval/request', 'unavailable', { toolName: 'asky' })
  assert.equal(asked, 'unavailable', 'ask delegates to the official flow and its default')
})

test('registering approval policies only for other points leaves approval untouched', async () => {
  const { listeners, waterfall, owner } = ownerWith()
  owner.api.policy.register('x', { id: 'tool-only', point: 'tool-before', decide: () => ({ outcome: 'deny' }) })
  const outcome = await waterfall('approval/request', 'unavailable', { toolName: 'bash' })
  assert.equal(outcome, 'unavailable')
})

test('tool-pre deny short-circuits with a PreToolDecision deny; ask/allow pass through', async () => {
  const { listeners, waterfall, owner } = ownerWith()
  owner.api.policy.register('guard', { id: 'no-bash', point: 'tool-before', match: (ctx) => ctx.toolName === 'bash', decide: () => ({ outcome: 'deny', reason: 'no bash' }) })
  owner.api.policy.register('guard', { id: 'asky', point: 'tool-before', match: (ctx) => ctx.toolName === 'asky', decide: () => ({ outcome: 'ask' }) })
  const denied = await waterfall('tools/pre-execute', { kind: 'allow' }, { name: 'bash', callId: 'c1' })
  assert.equal(denied.kind, 'deny')
  assert.equal(denied.reason, 'no bash')
  assert.ok(TOOL_PRE_DECISIONS.includes(denied.kind))
  const asked = await waterfall('tools/pre-execute', { kind: 'allow' }, { name: 'asky' })
  assert.equal(asked.kind, 'allow', 'ask delegates to the official flow (no auto-allow)')
  const plain = await waterfall('tools/pre-execute', { kind: 'allow' }, { name: 'ls' })
  assert.equal(plain.kind, 'allow')
})

test('post-execute redaction rewrites content blocks and records a redaction audit record', async () => {
  const { listeners, waterfall, owner } = ownerWith()
  owner.api.redaction.register('redactor', {
    id: 'mask-keys',
    audiences: ['model', 'ui'],
    match: (value) => value.includes('api_key='),
    action: 'redact',
  })
  const result = {
    content: [
      { type: 'text', text: 'result ok' },
      { type: 'text', text: 'api_key=abcdef1234567890' },
    ],
  }
  const decision = await waterfall('tools/post-execute', { kind: 'accept' }, { name: 'fetch' }, result)
  assert.equal(decision.kind, 'accept')
  assert.ok(TOOL_POST_DECISIONS.includes(decision.kind))
  assert.equal(decision.content[0].text, 'result ok', 'untouched block survives')
  assert.equal(decision.content[1].text, 'redacted:mask-keys')
  const view = owner.api.audit.list({ kind: 'redaction' })
  assert.equal(view.records.length, 1)
  assert.deepEqual(view.records[0].summary.applied, [{ ruleId: 'mask-keys', count: 1 }])
  assert.deepEqual(view.records[0].summary.audiences, ['model', 'ui'])
})

test('post-execute with no matching rules passes through unchanged and writes no audit', async () => {
  const { listeners, waterfall, owner } = ownerWith()
  owner.api.redaction.register('redactor', { id: 'strict', audiences: ['model'], match: () => false, action: 'redact' })
  const result = { content: [{ type: 'text', text: 'unchanged' }] }
  const decision = await waterfall('tools/post-execute', { kind: 'accept', content: result.content }, { name: 'x' }, result)
  assert.equal(decision.kind, 'accept')
  assert.equal(decision.content[0].text, 'unchanged')
  assert.equal(owner.api.audit.list({ kind: 'redaction' }).records.length, 0)
})

test('post-execute composes after next(): other listeners keep their decisions', async () => {
  const { listeners, waterfall, owner } = ownerWith()
  owner.api.redaction.register('redactor', { id: 'hide', audiences: ['model'], match: (v) => v.includes('secret-x'), action: 'redact' })
  // a "spill policy" sibling listener claims content first
  listeners.get('tools/post-execute').unshift(async (exec, result, next) => ({ kind: 'accept', content: [{ type: 'text', text: 'spilled' }] }))
  const result = { content: [{ type: 'text', text: 'secret-x value' }] }
  const decision = await waterfall('tools/post-execute', { kind: 'accept' }, { name: 'x' }, result)
  assert.equal(decision.kind, 'accept')
  assert.equal(decision.content[0].text, 'spilled', 'we never clobber the sibling decision (no match on transformed root)')
})

test('post-execute never rewrites a block decision: the corrective feedback stays intact', async () => {
  const { listeners, waterfall, owner } = ownerWith()
  owner.api.redaction.register('redactor', { id: 'hide', audiences: ['model'], match: (v) => v.includes('secret-x'), action: 'redact' })
  const corrective = [{ type: 'text', text: 'correct this call' }]
  // the block sibling runs AFTER the security listener (waterfall order) so
  // the security listener delegates into it and must keep its feedback
  listeners.get('tools/post-execute').push(async (exec, result, next) => ({ kind: 'block', feedback: corrective }))
  const result = { content: [{ type: 'text', text: 'secret-x value' }] }
  const decision = await waterfall('tools/post-execute', { kind: 'accept' }, { name: 'x' }, result)
  assert.equal(decision.kind, 'block')
  assert.equal(decision.feedback, corrective, 'downstream corrective feedback is never replaced')
  // the redaction attempt is still audited with its applied counts
  const view = owner.api.audit.list({ kind: 'redaction' })
  assert.equal(view.records.length, 1)
  assert.deepEqual(view.records[0].summary.applied, [{ ruleId: 'hide', count: 1 }])
})

test('llm/stream denial throws the typed error so the request fails closed', async () => {
  const { listeners, waterfall, owner } = ownerWith()
  owner.api.policy.register('g', { id: 'no-models', point: 'model-request-before', match: (ctx) => ctx.provider === 'banned-provider', decide: () => ({ outcome: 'deny', reason: 'provider not allowed' }) })
  let threw = null
  try {
    await waterfall('llm/stream', [], { sessionId: 's1', provider: 'banned-provider', model: 'm' })
  } catch (error) {
    threw = error
  }
  assert.ok(threw instanceof SecurityPolicyDeniedError)
  assert.equal(threw.code, 'SECURITY_POLICY_DENIED')
  assert.equal(threw.policyId, 'no-models')
  const view = owner.api.audit.list({})
  assert.equal(view.records.length, 1)
  assert.equal(view.records[0].outcome, 'deny')
})

test('llm/stream: a preceding llm-request listener still sees the request before the model-request gate', async () => {
  const { ctx, listeners, waterfall } = createMockCtx()
  const seen = []
  // simulate the llm/request owner's listener registered FIRST (FEATURE_MOUNTERS order)
  ctx.on('llm/stream', (options, next) => {
    seen.push(options.sessionId)
    return next()
  })
  const owner = createSecurityOwner({ ctx, logger: { warn() {} } })
  owner.api.policy.register('g2', { id: 'deny-m2', point: 'model-request-before', decide: (c) => (c.sessionId === 'evil' ? { outcome: 'deny' } : { outcome: 'allow' }) })
  const flow = async (sessionId, terminal) => {
    const chain = listeners.get('llm/stream') ?? []
    let index = 0
    const next = async () => {
      const listener = chain[index++]
      if (!listener) return terminal
      return listener({ sessionId }, next)
    }
    return next()
  }
  await assert.rejects(
    () => flow('evil', ['terminal']),
    (error) => error instanceof SecurityPolicyDeniedError && error.code === 'SECURITY_POLICY_DENIED',
  )
  assert.deepEqual(seen, ['evil'], 'the llm-request-precursor listener sees the effective request first')
  const pass = await flow('fine', ['terminal'])
  assert.deepEqual(pass, ['terminal'])
  assert.deepEqual(seen, ['evil', 'fine'])
  owner.dispose()
})

test('llm/stream allow/ask/no-policy delegate through next()', async () => {
  const { listeners, waterfall, owner } = ownerWith()
  owner.api.policy.register('g', { id: 'ok', point: 'model-request-before', decide: () => ({ outcome: 'allow' }) })
  const pass = await waterfall('llm/stream', ['stream-chunk'], { sessionId: 's1' })
  assert.deepEqual(pass, ['stream-chunk'])
  const view = owner.api.audit.list({})
  assert.equal(view.records.length, 1, 'allow decisions are audited too')
})

test('egress lease grants are audited with the lease generation', () => {
  const { owner } = ownerWith()
  owner.api.egress.register('gw', { id: 'allow-http', match: (ctx) => ctx.target.kind === 'http', decide: () => ({ outcome: 'allow' }) })
  const { generation, expiresAt, revoke } = owner.api.egress.lease.acquire({ kind: 'http', destination: 'ok.example' }, 60000)
  assert.equal(typeof generation, 'string')
  assert.equal(typeof expiresAt, 'number')
  const grant = owner.api.audit.list({ kind: 'egress-grant' })
  assert.equal(grant.records.length, 1)
  assert.equal(grant.records[0].summary.destination, 'ok.example')
  assert.equal(grant.records[0].generation, generation, 'the grant record carries the lease generation')
  assert.equal(revoke(), true)
})

test('egress default deny fails closed through the lease acquire', () => {
  const { owner } = ownerWith()
  assert.throws(
    () => owner.api.egress.lease.acquire({ kind: 'subprocess', destination: 'evil.example' }, 60000),
    (error) => error?.name === 'SecurityEgressDeniedError',
  )
  assert.equal(owner.api.audit.list({ kind: 'egress-grant' }).records.length, 0, 'no grant is recorded for a denied acquire')
})

test('a policy throwing repeatedly degrades and reports through the diagnostics facility', async () => {
  const checks = []
  const diagnostics = {
    register(entry) {
      checks.push(entry)
      return () => true
    },
  }
  const { listeners, waterfall, owner, warnings } = ownerWith({ diagnostics })
  owner.api.policy.register('flaky', {
    id: 'boom',
    point: 'approval-before',
    decide: () => { throw new Error('flaky policy failed') },
  })
  const outcome = await waterfall('approval/request', 'unavailable', { toolName: 'x' })
  assert.equal(outcome, 'unavailable', 'degraded policy falls through (default ask)')
  assert.equal(checks.length, 1)
  assert.equal(checks[0].ownerId, 'flaky')
  assert.equal(checks[0].checkId, 'policy:boom')
  assert.equal(checks[0].scope, 'plugin')
  const runResult = await checks[0].run({})
  assert.equal(runResult.health, 'failed')
  assert.equal(owner.api.availability.reportChannel, 'available')
  const second = await waterfall('approval/request', 'unavailable', { toolName: 'x' })
  assert.equal(second, 'unavailable')
  assert.equal(checks.length, 1, 'diagnostics re-registration stays latest-wins per policy')
  assert.equal(warnings.length, 0)
})

test('a failing policy never breaks the remaining policies or the seam', async () => {
  const { listeners, waterfall, owner } = ownerWith()
  owner.api.policy.register('flaky', { id: 'boom', point: 'approval-before', decide: () => { throw new Error('x') } })
  owner.api.policy.register('solid', { id: 'deny-all', point: 'approval-before', decide: () => ({ outcome: 'deny' }) })
  const outcome = await waterfall('approval/request', 'unavailable', { toolName: 'x' })
  assert.equal(outcome, 'rejected', 'the healthy policy still wins')
})

test('diagnostics fallback keeps the facade alive without console output', async () => {
  const { listeners, waterfall, owner, warnings } = ownerWith() // no diagnostics facade
  owner.api.policy.register('flaky', { id: 'boom', point: 'approval-before', decide: () => { throw new Error('x') } })
  await waterfall('approval/request', 'unavailable', { toolName: 'x' })
  assert.equal(owner.api.availability.reportChannel, 'degraded')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /flaky/)
})

test('registration-time validation failures report with owner attribution and reject typed', () => {
  const checks = []
  const diagnostics = { register(entry) { checks.push(entry); return () => true } }
  const { owner } = ownerWith({ diagnostics })
  assert.throws(
    () => owner.api.policy.register('bad-owner', { id: 'x', point: 'approval-before' }),
    (error) => error.code === 'SECURITY_POLICY_INVALID_SPEC',
  )
  assert.equal(checks.length, 1)
  assert.equal(checks[0].ownerId, 'bad-owner')
})

test('dispose is idempotent, unsubscribes seams, and stops enforcement', async () => {
  const { listeners, waterfall, owner } = ownerWith()
  owner.api.policy.register('g', { id: 'deny', point: 'approval-before', decide: () => ({ outcome: 'deny' }) })
  assert.equal(owner.dispose(), true)
  assert.equal(owner.dispose(), false)
  assert.equal(listeners.get('approval/request').length, 0)
  assert.equal(listeners.get('tools/pre-execute').length, 0)
  assert.equal(listeners.get('tools/post-execute').length, 0)
  const outcome = await waterfall('approval/request', 'unavailable', { toolName: 'x' })
  assert.equal(outcome, 'unavailable')
})

test('generation handles dispose policies when the policy is replaced', () => {
  const { owner } = ownerWith()
  const first = owner.api.policy.register('owner', { id: 'p', point: 'approval-before', decide: () => ({ outcome: 'allow' }) })
  const second = owner.api.policy.register('owner', { id: 'p', point: 'approval-before', decide: () => ({ outcome: 'deny' }) })
  assert.equal(first.dispose(), false, 'replaced generation no longer owns the slot')
  assert.equal(second.dispose(), true)
})

test('redaction with a secret gate denial keeps the secret redacted and audits a bounded note', async () => {
  const { listeners, waterfall, owner } = ownerWith()
  owner.api.redaction.register('plugin', {
    id: 'show-everything',
    audiences: ['model'],
    match: (value) => value.includes('sk-'),
    action: 'expose',
  })
  const result = { content: [{ type: 'text', text: 'sk-abcdefghijklmnopqrstuv secret' }] }
  const decision = await waterfall('tools/post-execute', { kind: 'accept' }, { name: 'x' }, result)
  assert.equal(decision.kind, 'accept')
  assert.equal(decision.content[0].text, 'redacted:show-everything', 'exposure denied: secret stays redacted')
  const view = owner.api.audit.list({ kind: 'redaction' })
  assert.equal(view.records.length, 1)
  assert.deepEqual(view.records[0].summary.blocked, [{ ruleId: 'show-everything', count: 1 }])
  assert.deepEqual(view.records[0].summary.applied, [], 'no applied entries for the denied exposure')
})