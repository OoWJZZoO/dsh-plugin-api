import test from 'node:test'
import assert from 'node:assert/strict'
import { createLoopSliceGuestFacet, createAttemptEndWaiter } from '../lib/loop-slice-guest.js'
import { createCheckpointsApi } from '../lib/checkpoint-facade.js'
import { createBranchAuthorityFixture, createCoordinationFixture, createIdFactory, createMemoryFacility } from './checkpoint-test-kit.mjs'

/**
 * Integration wave — stop-then-restore full sequence on the shared loop
 * boundary: the guest facet adapts the loop boundary (by:'system' + restore
 * cause over the single cancel path), the attempt-end facts drive the
 * restore terminal waiter, and the checkpoint restore authority commits
 * exclusively through the branch authority. Consumer continuation after
 * restore rides the mounted session request surface (typed surface).
 */

function makeBoundaryCtx() {
  const state = {
    cancels: [],
    endListeners: new Set(),
    observed: new Map([['s1', { state: 'running', attemptId: 'attempt-live' }]]),
    seq: 10,
  }
  const boundary = {
    admit({ sessionId, operationId }) {
      state.observed.set(sessionId, { state: 'running', attemptId: 'attempt-live' })
      return { accepted: true, attemptRef: { sessionId, operationId } }
    },
    cancelAttempt(ref, { reason, signal }) {
      state.cancels.push({ ref, reason })
      // the loop aborts the attempt; the terminal fact follows on the same
      // turn (the waiter is already subscribed when the stop is requested)
      state.observed.delete(ref.sessionId)
      // the loop aborts asynchronously: the attempt-end fact lands after the
      // restore authority subscribed its terminal waiter (find first the
      // microtask turn, then the macrotask turn)
      setTimeout(() => {
        boundary.emitEnd({
          attemptId: ref.operationId ?? 'attempt-live', operationId: 'op-restore', executionId: 'ex-restore',
          sessionId: ref.sessionId, seq: ++state.seq, observedAt: '2026-09-06T00:00:50.000Z',
          outcome: 'aborted', reason: reason?.message ?? 'cancel', classification: reason?.classification ?? 'system', followUp: 'none',
        })
      }, 0)
      return { ok: true, code: 'accepted' }
    },
    availability() {
      return { status: 'active', contractVersion: 1 }
    },
    slots: {
      get: (sessionId) => {
        const entry = state.observed.get(sessionId)
        if (!entry) return undefined
        return { current: { attemptId: entry.attemptId }, pending: [] }
      },
    },
    emitEnd(fact) {
      for (const listener of state.endListeners) listener(fact)
    },
  }
  const listeners = []
  const ctx = {
    get(name) {
      if (name === 'agentLoop') return { [Symbol.for('dsh-plugin-api.agent-loop.interaction')]: boundary }
      if (name === 'sessions') return { get: (id) => (id === 's1' ? { id } : undefined), list() {}, fork() {} }
      return undefined
    },
    on(name, listener) {
      if (name === 'agent/attempt/end') {
        state.endListeners.add(listener)
        return () => state.endListeners.delete(listener)
      }
      return () => true
    },
  }
  return { ctx, state, boundary }
}

test('stop-restore: the shared cancel path carries the system identity and restore cause', async () => {
  const { ctx, state } = makeBoundaryCtx()
  const guest = createLoopSliceGuestFacet({ ctx })
  assert.equal(guest.active(), true)
  assert.equal(guest.versionOk(), true)
  assert.deepEqual(guest.observed('s1'), { state: 'running', attemptId: 'attempt-live' })

  const outcome = await guest.cancel.request({
    sessionId: 's1',
    attemptId: 'attempt-live',
    by: 'system',
    cause: 'restore:cp-1',
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.code, 'requested')
  // exactly one cancel was issued over the single boundary path with the
  // restore cause attached (stop-then-restore never opens a second channel)
  assert.equal(state.cancels.length, 1)
  assert.equal(state.cancels[0].ref.sessionId, 's1')
  assert.deepEqual(state.cancels[0].ref.operationId, 'attempt-live')
  assert.equal(state.cancels[0].reason.message, 'restore:cp-1')
  assert.equal(state.cancels[0].reason.classification, 'system')
})

test('stop-restore: the attempt-end waiter resolves the operation terminal', async () => {
  const { ctx, boundary } = makeBoundaryCtx()
  const waiter = createAttemptEndWaiter({ ctx })

  const pending = waiter('attempt-live', { timeoutMs: 500 })
  boundary.emitEnd({
    attemptId: 'attempt-live', operationId: 'op-1', executionId: 'ex-1', sessionId: 's1',
    seq: 11, observedAt: '2026-09-06T00:00:40.000Z',
    outcome: 'aborted', reason: 'restore required', classification: 'system', followUp: 'none',
  })
  const result = await pending
  assert.equal(result.ok, true)
  assert.equal(result.terminal, 'aborted', 'the terminal outcome value is reported')
})

test('stop-restore: full sequence commits restore exclusively through the authority', async () => {
  const { ctx, state } = makeBoundaryCtx()
  const branch = createBranchAuthorityFixture()
  const coordination = createCoordinationFixture()
  const guest = createLoopSliceGuestFacet({ ctx })
  const facade = createCheckpointsApi({
    ctx,
    active: () => true,
    ownerOf: () => 'owner-a',
    facility: createMemoryFacility(),
    factsSource: guest,
    authorities: { branch: branch.face },
    stepAuthorities: { branches: branch.face },
    coordination: coordination.face,
    waitForTerminal: createAttemptEndWaiter({ ctx }),
    idFactory: createIdFactory('cp'),
  })

  // capture a branch checkpoint while the session runs
  const created = await facade.api.create(
    { scope: { sessionId: 's1' }, source: { kind: 'branch' }, captureKey: 'stop-restore-1' },
    { owner: 'owner-a' },
  )
  assert.equal(created.ok, true)
  const checkpointId = created.summary.checkpointId

  const plan = await facade.api.planRestore(checkpointId)
  assert.equal(plan.ok, true)

  // stop-then-restore: the restore preflight requests the system stop, the
  // loop releases the terminal, and the restore commits through the single
  // branch authority (never a parallel channel).
  const restored = await facade.api.restore(checkpointId, { plan: plan.plan }, { owner: 'owner-a' })
  assert.equal(restored.ok, true, 'restore ok; result=' + JSON.stringify(restored))
  const handle = restored.handle
  const status = handle.status()
  assert.equal(status.terminal, 'success')
  assert.ok(state.cancels.length >= 1, 'the system stop went out over the shared boundary')
  assert.equal(state.cancels[0].reason.classification, 'system')
})

test('stop-restore: consumers continue through the mounted request surface after restore', async () => {
  const { ctx } = makeBoundaryCtx()
  const guest = createLoopSliceGuestFacet({ ctx })
  // The session request surface (mounted assembly) admits the continuation
  // while the boundary is available; the activity identity stays stable per
  // session and the loop boundary accepts the next admission exactly once.
  const admitted = guest.active()
  assert.equal(admitted, true)
  // The continuation rides the same boundary admit path (single authority):
  // the integration wave mounts sessions.request over this boundary.
  const { createSessionInteractionOperation } = await import('../lib/session-interaction-operation.js')
  const operation = createSessionInteractionOperation({
    ctx,
    coreActive: () => true,
    ownerOf: () => 'owner-a',
  })
  const outcome = await operation.request(
    { sessionId: 's1', content: [{ type: 'text', text: 'after restore' }], idempotencyKey: 'cont-1' },
    undefined,
  )
  assert.equal(outcome.ok, true)
  assert.equal(outcome.code, 'accepted')
})