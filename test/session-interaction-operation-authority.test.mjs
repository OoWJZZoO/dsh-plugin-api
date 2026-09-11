/**
 * Authority tests for the single session request operation owner.
 *
 * Covers Requirements 1–6, 8, 10 acceptance behaviors: outcome vocabulary,
 * dedupe/already-running, admission/append failure paths, handle lifecycle,
 * cancel-as-signal and adjudication (pending / live / superseded / stale),
 * activity correlation on attempt facts, availability and bounded audit.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRequestAuthority,
  resolveAgentLoopBoundary,
  INTERACTION_BOUNDARY_SYMBOL,
} from '../lib/session-interaction-operation-authority.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from '../lib/errors.js'

function makeBoundary() {
  const boundary = {
    admitted: [],
    cancelled: [],
    admit(spec) {
      this.admitted.push(spec)
      if (spec.sessionId === 's-busy') {
        // simulate an already-live loop-side attempt
        return { accepted: false, code: 'busy', reason: 'loop busy' }
      }
      if (spec.sessionId === 's-noagent') {
        return { accepted: false, code: 'no-agent', reason: 'no agent' }
      }
      return { accepted: true, attemptRef: { sessionId: spec.sessionId, operationId: spec.operationId } }
    },
    cancelAttempt(ref, opts) {
      this.cancelled.push({ ref, opts })
      return { ok: true, code: 'accepted' }
    },
    availability() {
      return { status: 'active' }
    },
  }
  return boundary
}

function makeAuthority(overrides = {}) {
  const boundary = overrides.boundary ?? makeBoundary()
  return {
    boundary,
    authority: createRequestAuthority({
      sessionExists: overrides.sessionExists ?? ((s) => s.startsWith('s') && s !== 's-missing'),
      resolveBoundary: overrides.resolveBoundary ?? (() => ({ boundary, versionOk: true })),
      durableAppend: overrides.durableAppend ?? (async () => ({ ok: true, seq: 1 })),
      ownerOf: overrides.ownerOf ?? (() => 'o1'),
      userCtx: overrides.userCtx,
      readActivityCorrelation: overrides.readActivityCorrelation,
      now: overrides.now ?? (() => new Date('2026-09-06T00:00:00Z')),
      timer: overrides.timer,
      cancelConfirmTimeoutMs: overrides.cancelConfirmTimeoutMs ?? 10,
      coreActive: overrides.coreActive,
      featureDisabled: overrides.featureDisabled,
      durableAvailable: overrides.durableAvailable,
      auditLimit: overrides.auditLimit,
      logger: { warn: () => {} },
    }),
  }
}

test('accepted request returns a frozen discriminated outcome with a handle and facade execution identity', async () => {
  const { boundary, authority } = makeAuthority()
  const out = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'hi' }, idempotencyKey: 'k1' })
  assert.equal(out.ok, true)
  assert.equal(out.code, 'accepted')
  assert.equal(out.operation.ownerId, 'o1')
  assert.ok(out.operation.id.startsWith('op_'))
  assert.equal(out.activity.executionId.slice(0, 3), 'ex_')
  // No projection reader is wired in this standalone fixture: the projection
  // is unreachable, so the correlation says `unavailable` rather than
  // pretending evidence was awaited from a healthy source (Requirement 6).
  assert.equal(out.activity.confidence, 'unavailable')
  assert.equal(out.activity.activityId, null)
  assert.ok(Object.isFrozen(out))
  assert.equal(boundary.admitted.length, 1)
  assert.equal(boundary.admitted[0].idempotencyKey, 'k1')
  assert.equal(boundary.admitted[0].operationId, out.operation.id)
  const handle = out.operation
  assert.equal(handle.status().phase, 'accepted')
  assert.equal(typeof handle.observe, 'function')
  assert.equal(typeof handle.dispose, 'function')
})

test('duplicate (same owner + key while live) and already-running outcomes', async () => {
  const { authority } = makeAuthority()
  const first = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'a' }, idempotencyKey: 'k1' })
  const dup = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'a' }, idempotencyKey: 'k1' })
  assert.equal(dup.code, 'duplicate')
  assert.equal(dup.operationRef.id, first.operation.id)
  const running = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'b' } })
  assert.equal(running.code, 'already-running')
  assert.equal(running.operationRef.id, first.operation.id)
})

test('rejected: malformed input and nonexistent session never start processing', async () => {
  const { boundary, authority } = makeAuthority()
  const badKind = await authority.request({ sessionId: 's1', message: { kind: 'assistant/message', text: 'x' } })
  assert.equal(badKind.code, 'rejected')
  assert.equal(badKind.domainCode, 'invalid-input')
  const noSession = await authority.request({ sessionId: 's-missing', message: { kind: 'user-message', text: 'x' } })
  assert.equal(noSession.code, 'rejected')
  assert.equal(noSession.domainCode, 'invalid-input')
  assert.equal(boundary.admitted.length, 0)
})

test('unavailable: loop boundary absent or version-mismatched', async () => {
  const { authority } = makeAuthority({ resolveBoundary: () => null })
  const out = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'x' } })
  assert.equal(out.code, 'unavailable')
  const { authority: mismatched } = makeAuthority({ resolveBoundary: () => ({ boundary: makeBoundary(), versionOk: false }) })
  const out2 = await mismatched.request({ sessionId: 's1', message: { kind: 'user-message', text: 'x' } })
  assert.equal(out2.code, 'unavailable')
  assert.equal(mismatched.availability().status, 'degraded')
})

test('loop-side rejection maps to typed rejected/unavailable outcomes without guessing', async () => {
  const busyBoundary = makeBoundary()
  const busyAuth = makeAuthority({ boundary: busyBoundary }).authority
  const busy = await busyAuth.request({ sessionId: 's-busy', message: { kind: 'user-message', text: 'x' } })
  assert.equal(busy.code, 'rejected')
  assert.equal(busy.domainCode, 'loop-busy')

  const noAgent = makeAuthority({ boundary: makeBoundary() }).authority
  const na = await noAgent.request({ sessionId: 's-noagent', message: { kind: 'user-message', text: 'x' } })
  assert.equal(na.code, 'rejected')
  assert.equal(na.domainCode, 'no-agent')
})

test('durable append failure returns unavailable and rolls back the pending admission', async () => {
  const boundary = makeBoundary()
  const { authority } = makeAuthority({ boundary, durableAppend: async () => ({ ok: false, reason: 'denied by durable layer' }) })
  const out = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'x' } })
  assert.equal(out.code, 'unavailable')
  assert.equal(boundary.cancelled.length, 1, 'pending admission was rolled back')
  assert.equal(authority.internalAudit().records.some((r) => r.outcomeCode === 'unavailable'), true)
})

test('operation terminal is exactly once, frozen, and rewrites nothing', async () => {
  const { authority } = makeAuthority()
  const out = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'x' } })
  const opId = out.operation.id
  authority.ingestAttemptFact({ name: 'agent/attempt/start', attemptId: 'a1', operationId: opId, sessionId: 's1', seq: 1, observedAt: 't1' })
  assert.equal(out.operation.status().phase, 'running')
  authority.ingestAttemptFact({ name: 'agent/attempt/end', attemptId: 'a1', operationId: opId, sessionId: 's1', seq: 1, observedAt: 't2', outcome: 'success', classification: 'completed', followUp: 'none' })
  const terminal = out.operation.status()
  assert.equal(terminal.phase, 'terminal')
  assert.equal(terminal.terminal.outcome, 'success')
  // late signals and stale cancel do not rewrite
  authority.ingestAttemptFact({ name: 'agent/attempt/end', attemptId: 'a1', operationId: opId, sessionId: 's1', seq: 2, observedAt: 't3', outcome: 'error', classification: 'late' })
  assert.equal(out.operation.status().terminal.outcome, 'success')
  assert.equal(authority.cancel({ operationId: opId }).code, 'stale')
  const auditCodes = authority.internalAudit().records.map((r) => r.outcomeCode)
  assert.equal(auditCodes.includes('late-fact'), true, 'late results are bounded diagnostic audit only')
  assert.equal(auditCodes.filter((c) => c === 'success').length >= 1, true)
})

test('cancel on a never-started operation adjudicates aborted (pending admission removed)', async () => {
  const boundary = makeBoundary()
  const { authority } = makeAuthority({ boundary })
  const out = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'x' } })
  const result = authority.cancel({ operationId: out.operation.id, by: 'user', reason: 'no longer needed' })
  assert.deepEqual(result, { ok: true, code: 'accepted' })
  assert.equal(boundary.cancelled.length, 1)
  assert.equal(boundary.cancelled[0].ref.operationId, out.operation.id)
  const status = out.operation.status()
  assert.equal(status.phase, 'terminal')
  assert.equal(status.terminal.outcome, 'aborted')
})

test('cancel on a live attempt awaits the attempt-end fact and respects cancel precedence', async () => {
  const boundary = makeBoundary()
  const { authority } = makeAuthority({ boundary })
  const out = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'x' } })
  const opId = out.operation.id
  authority.ingestAttemptFact({ name: 'agent/attempt/start', attemptId: 'a1', operationId: opId, sessionId: 's1', seq: 1, observedAt: 't1' })
  authority.cancel({ operationId: opId, by: 'system', reason: 'stop-then-restore' })
  // cancel is a signal: still running until the commit point fact arrives
  assert.notEqual(out.operation.status().phase, 'terminal')
  authority.ingestAttemptFact({ name: 'agent/attempt/end', attemptId: 'a1', operationId: opId, sessionId: 's1', seq: 1, observedAt: 't2', outcome: 'success', classification: 'completed', followUp: 'none' })
  const status = out.operation.status()
  assert.equal(status.phase, 'terminal')
  assert.equal(status.terminal.outcome, 'aborted', 'in-window cancel outranks the later success fact')
})

test('live-cancel confirmation bound adjudicates aborted when the loop cannot confirm', () => {
  let callback
  const boundary = makeBoundary()
  boundary.cancelAttempt = () => ({ ok: true, code: 'accepted' })
  const { authority } = makeAuthority({
    boundary,
    timer: { setTimeout: (fn) => { callback = fn; return 1 }, clearTimeout: () => {} },
    cancelConfirmTimeoutMs: 5,
  })
  const outPromise = authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'x' } })
  return outPromise.then((out) => {
    const opId = out.operation.id
    authority.ingestAttemptFact({ name: 'agent/attempt/start', attemptId: 'a1', operationId: opId, sessionId: 's1', seq: 1, observedAt: 't1' })
    authority.cancel({ operationId: opId })
    assert.equal(out.operation.status().phase, 'running')
    callback()
    assert.equal(out.operation.status().terminal.outcome, 'aborted')
  })
})

test('superseded attempt fact adjudicates superseded when no cancel was requested', async () => {
  const { authority } = makeAuthority()
  const out = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'x' } })
  const opId = out.operation.id
  authority.ingestAttemptFact({ name: 'agent/attempt/start', attemptId: 'a1', operationId: opId, sessionId: 's1', seq: 1, observedAt: 't1' })
  authority.ingestAttemptFact({ name: 'agent/attempt/end', attemptId: 'a1', operationId: opId, sessionId: 's1', seq: 1, observedAt: 't2', outcome: 'superseded', classification: 'superseded', followUp: 'none' })
  assert.equal(out.operation.status().terminal.outcome, 'superseded')
})

test('caller signal abort triggers the same cancel path as a cancel call', async () => {
  const controller = new AbortController()
  const boundary = makeBoundary()
  const { authority } = makeAuthority({ boundary })
  const outPromise = authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'x' }, signal: controller.signal })
  return outPromise.then((out) => {
    controller.abort()
    const status = out.operation.status()
    assert.equal(status.phase, 'terminal')
    assert.equal(status.terminal.outcome, 'aborted')
    assert.equal(boundary.cancelled.length, 1)
  })
})

test('dispose requests stop of the caller own operation without forging a terminal', async () => {
  const { authority } = makeAuthority()
  const out = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'x' } })
  const result = out.operation.dispose()
  assert.equal(result.ok, true)
  assert.equal(out.operation.status().terminal.outcome, 'aborted')
})

test('availability reflects authority, boundary and durable state', async () => {
  const active = makeAuthority().authority
  assert.deepEqual(active.availability(), { status: 'active' })
  const degradedBoundary = makeAuthority({ resolveBoundary: () => ({ boundary: makeBoundary(), versionOk: false }) }).authority
  assert.equal(degradedBoundary.availability().status, 'degraded')
  const degradedDurable = makeAuthority({ durableAvailable: () => false }).authority
  assert.equal(degradedDurable.availability().status, 'degraded')
  const absent = makeAuthority({ resolveBoundary: () => null }).authority
  assert.equal(absent.availability().status, 'degraded')
})

test('typed core-inactive and feature-disabled errors', async () => {
  const inactive = makeAuthority({ coreActive: () => false }).authority
  await assert.rejects(() => inactive.request({ sessionId: 's1' }), PluginApiInactiveError)
  assert.throws(() => inactive.cancel({ sessionId: 's1' }), PluginApiInactiveError)
  const disabled = makeAuthority({ featureDisabled: () => true }).authority
  await assert.rejects(() => disabled.request({ sessionId: 's1' }), PluginApiFeatureDisabledError)
  const inactiveAvailability = makeAuthority({ coreActive: () => false }).authority.availability()
  assert.equal(inactiveAvailability.status, 'unavailable')
})

test('audit is bounded, owner-derived and content-free with gap marker semantics', async () => {
  const { authority } = makeAuthority({ auditLimit: 5 })
  for (let i = 0; i < 10; i += 1) {
    const out = await authority.request({ sessionId: `s-live-${i}`, message: { kind: 'user-message', text: 'x' } })
    authority.cancel({ operationId: out.operation.id })
  }
  const audit = authority.internalAudit()
  assert.equal(audit.records.length, 5)
  assert.equal(audit.truncated, true)
  assert.ok(audit.records.every((r) => r.owner === 'o1'))
  assert.ok(audit.records.every((r) => !Object.hasOwn(r, 'text') && !Object.hasOwn(r, 'message')))
  assert.ok(audit.records.some((r) => r.by === 'owner'))
})

test('owner identity is derived from caller context, never caller-reported', async () => {
  const { authority } = makeAuthority({ ownerOf: (callerCtx) => callerCtx?.owner ?? 'root' })
  const out = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'x' } }, { owner: 'real-owner' })
  assert.equal(out.operation.ownerId, 'real-owner')
})

test('resolveAgentLoopBoundary reads the shared marker symbol with a duck-type check', () => {
  const boundary = makeBoundary()
  const ctx = { get: (name) => (name === 'agentLoop' ? { [INTERACTION_BOUNDARY_SYMBOL]: boundary } : undefined) }
  assert.equal(resolveAgentLoopBoundary(ctx), boundary)
  assert.equal(resolveAgentLoopBoundary({}), null)
  assert.equal(resolveAgentLoopBoundary({ get: () => { throw new Error('x') } }), null)
  const partial = { get: (name) => (name === 'agentLoop' ? { [INTERACTION_BOUNDARY_SYMBOL]: { admit: () => {} } } : undefined) }
  assert.equal(resolveAgentLoopBoundary(partial), null)
})

test('parent cancellation cascades to still-live children; child does not reverse-cancel the parent', async () => {
  const boundary = makeBoundary()
  const { authority } = makeAuthority({ boundary })
  const parent = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'parent' } })
  const child = await authority.request({ sessionId: 's2', message: { kind: 'user-message', text: 'child' }, parent: parent.operation.id, cause: 'parent-work' })
  assert.equal(child.code, 'accepted')
  // child cancel does NOT reverse-cancel the parent
  assert.equal(authority.cancel({ operationId: child.operation.id }).code, 'accepted')
  assert.equal(child.operation.status().terminal.outcome, 'aborted')
  assert.equal(parent.operation.status().phase, 'accepted', 'child cancellation never reverse-cancels the parent')
  // parent cancel cascades to a second still-live child
  const child2 = await authority.request({ sessionId: 's3', message: { kind: 'user-message', text: 'child2' }, parent: parent.operation.id })
  assert.equal(authority.cancel({ operationId: parent.operation.id }).code, 'accepted')
  assert.equal(parent.operation.status().terminal.outcome, 'aborted')
  assert.equal(child2.operation.status().phase, 'terminal')
  assert.equal(child2.operation.status().terminal.outcome, 'aborted')
})

test('parent cancellation propagates to a live child attempt through the shared boundary', async () => {
  const boundary = makeBoundary()
  const { authority } = makeAuthority({ boundary })
  const parent = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'parent' } })
  const child = await authority.request({ sessionId: 's2', message: { kind: 'user-message', text: 'child' }, parent: parent.operation.id })
  authority.ingestAttemptFact({ name: 'agent/attempt/start', attemptId: 'c-a1', operationId: child.operation.id, sessionId: 's2', seq: 1, observedAt: 't1' })
  assert.equal(child.operation.status().phase, 'running')
  authority.cancel({ operationId: parent.operation.id, by: 'system', reason: 'parent stopped' })
  // the cascade reached the child's live attempt (best-effort); the terminal is
  // adjudicated at the commit point when the loop-side attempt-end fact lands
  authority.ingestAttemptFact({ name: 'agent/attempt/end', attemptId: 'c-a1', operationId: child.operation.id, sessionId: 's2', seq: 1, observedAt: 't2', outcome: 'aborted', classification: 'aborted', followUp: 'none' })
  assert.equal(child.operation.status().terminal.outcome, 'aborted', 'live child attempt resolved from the cascaded signal at its commit point')
})

test('accepted handle exposes the frozen declared retry capability', async () => {
  const { authority } = makeAuthority()
  const withKey = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'x' }, idempotencyKey: 'k1' })
  assert.deepEqual(withKey.operation.capability, { idempotent: true, autoRetry: false, failClosed: true })
  assert.ok(Object.isFrozen(withKey.operation.capability))
  const withoutKey = await authority.request({ sessionId: 's2', message: { kind: 'user-message', text: 'y' } })
  assert.deepEqual(withoutKey.operation.capability, { idempotent: false, autoRetry: false, failClosed: true })
})

test('activity correlation: exposed once the shared projection evidences the execution', async () => {
  const reads = []
  let evidenced = false
  const readActivityCorrelation = ({ executionId }) => {
    reads.push(executionId)
    return evidenced ? { confidence: 'observed', activityId: 'act_1' } : { confidence: 'unknown' }
  }
  const { authority } = makeAuthority({ readActivityCorrelation })
  const out = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'hi' } })
  assert.equal(out.activity.confidence, 'unknown', 'a healthy projection without evidence is unknown')
  assert.equal(out.activity.activityId, null)
  assert.equal(reads.includes(out.activity.executionId), true, 'the reader is consulted with the facade execution identity')

  const observed = []
  const off = out.operation.observe((status) => observed.push(status.activity))
  evidenced = true
  const status = out.operation.status()
  assert.deepEqual(status.activity, {
    activityId: 'act_1',
    executionId: out.activity.executionId,
    confidence: 'observed',
  })
  assert.equal(observed.at(-1).activityId, 'act_1', 'observers are notified when the correlation appears')
  // an evidenced correlation is stable: it is not re-consulted on later reads
  const readsAfterSettle = reads.length
  out.operation.status()
  assert.equal(reads.length, readsAfterSettle)
  off()
})

test('activity correlation: the projection grade is passed through, never upgraded or invented', async () => {
  const reconstructed = makeAuthority({
    readActivityCorrelation: () => ({ confidence: 'reconstructed', activityId: 'act_r' }),
  }).authority
  const out = await reconstructed.request({ sessionId: 's1', message: { kind: 'user-message', text: 'hi' } })
  assert.equal(out.activity.activityId, 'act_r')
  assert.equal(out.activity.confidence, 'reconstructed', 'a weaker grade is never upgraded to observed')

  // an evidenced answer without a usable identity degrades to `unknown`: the
  // authority never claims evidence it cannot name.
  const anonymous = makeAuthority({ readActivityCorrelation: () => ({ confidence: 'observed' }) }).authority
  const second = await anonymous.request({ sessionId: 's1', message: { kind: 'user-message', text: 'hi' } })
  assert.equal(second.activity.activityId, null)
  assert.equal(second.activity.confidence, 'unknown')
})

test('activity correlation: a throwing or degraded projection reports unavailable, never a guess', async () => {
  const throwing = makeAuthority({
    readActivityCorrelation: () => { throw new Error('projection blew up') },
  }).authority
  const out = await throwing.request({ sessionId: 's1', message: { kind: 'user-message', text: 'hi' } })
  assert.equal(out.activity.confidence, 'unavailable')
  assert.equal(out.activity.activityId, null)

  let healthy = true
  const { authority } = makeAuthority({
    readActivityCorrelation: () => (healthy ? { confidence: 'unknown' } : { confidence: 'unavailable' }),
  })
  const first = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'hi' } })
  assert.equal(first.activity.confidence, 'unknown')
  healthy = false
  assert.equal(first.operation.status().activity.confidence, 'unavailable', 'degradation is folded into the next read')
})

test('activity correlation: a terminal commit folds in the evidence available at commit time', async () => {
  let evidenced = false
  const { authority } = makeAuthority({
    readActivityCorrelation: () => (evidenced ? { confidence: 'observed', activityId: 'act_t' } : { confidence: 'unknown' }),
  })
  const out = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'hi' } })
  authority.ingestAttemptFact({
    name: 'agent/attempt/start', sessionId: 's1', operationId: out.operation.id,
    executionId: out.activity.executionId, attemptId: 'a1',
  })
  evidenced = true
  authority.ingestAttemptFact({
    name: 'agent/attempt/end', sessionId: 's1', operationId: out.operation.id,
    executionId: out.activity.executionId, attemptId: 'a1', outcome: 'success', followUp: 'none',
  })
  const status = out.operation.status()
  assert.equal(status.phase, 'terminal')
  assert.equal(status.terminal.outcome, 'success')
  assert.equal(status.activity.activityId, 'act_t')
  assert.equal(status.activity.confidence, 'observed')
  // the correlation refresh never rewrites the committed terminal
  assert.equal(out.operation.status().terminal.outcome, 'success')
})

test('direct durable append is not interpreted as a processing request (no admission, no operation, no acceptance effect)', async () => {
  const boundary = makeBoundary()
  const fixtureAppends = []
  const durableAppend = async (sessionId, kind, payload) => {
    fixtureAppends.push({ sessionId, kind, payload })
    return { ok: true, seq: fixtureAppends.length }
  }
  const { authority } = makeAuthority({ boundary, durableAppend })
  // a third-party plugin appends directly to the durable layer — NOT through
  // the request authority
  await durableAppend('s1', 'user-message', { text: 'direct append' })
  assert.equal(boundary.admitted.length, 0, 'no admission happened for the direct append')
  assert.equal(authority.internalAudit().records.some((r) => r.outcomeCode === 'accepted'), false, 'no operation acceptance was recorded')
  // the authority still serves a request normally afterward
  const out = await authority.request({ sessionId: 's1', message: { kind: 'user-message', text: 'via authority' } })
  assert.equal(out.code, 'accepted')
})
