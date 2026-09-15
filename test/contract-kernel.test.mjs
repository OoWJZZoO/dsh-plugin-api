/**
 * Outer-contract kernel conformance: the shared handle, dispose-result and
 * observer shapes that every facade-owned register / contribute / observe
 * member must produce.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  REQUESTED,
  REVOKED,
  STALE,
  UNAVAILABLE,
  contractResult,
  createContributionHandle,
  createObserverHandle,
  createOperationHandle,
  createPendingContributionHandle,
  createResourceHandle,
  disposeResultOf,
  releasedResult,
  staleResult,
  stopRequestedResult,
} from '../lib/contract-kernel.js'

test('discriminated results are frozen and keep status out of the success flag', () => {
  const ok = contractResult(true, 'done')
  assert.equal(ok.ok, true)
  assert.equal(ok.code, 'done')
  assert.equal('reason' in ok, false, 'a missing reason must not be materialized')
  assert.ok(Object.isFrozen(ok))

  const failed = contractResult(false, 'denied', 'not your event')
  assert.deepEqual({ ...failed }, { ok: false, code: 'denied', reason: 'not your event' })
  assert.ok(Object.isFrozen(failed))

  // An empty reason is not a reason.
  assert.equal('reason' in contractResult(false, 'denied', ''), false)
})

test('disposeResultOf: only a true teardown reports a revocation', () => {
  assert.equal(disposeResultOf(true).code, REVOKED)
  assert.equal(disposeResultOf(false).code, STALE)
  assert.equal(disposeResultOf(undefined).code, STALE)
  assert.equal(disposeResultOf('ok').code, STALE)
})

test('resource handle carries the identity triple, extensions and a discriminated dispose', () => {
  let revoked = 0
  const handle = createResourceHandle({
    id: 'policy-a',
    ownerId: 'plugin-a',
    generation: 'plugin-a:1',
    extensions: { priority: 'high', status: () => 'active' },
    revoke: () => {
      revoked += 1
      return revoked === 1
    },
  })

  assert.equal(handle.id, 'policy-a')
  assert.equal(handle.ownerId, 'plugin-a')
  assert.equal(handle.generation, 'plugin-a:1')
  assert.equal(handle.priority, 'high', 'domain extension members are preserved verbatim')
  assert.equal(handle.status(), 'active')
  assert.ok(Object.isFrozen(handle), 'the handle must be frozen')
  assert.deepEqual(Object.keys(handle), ['id', 'ownerId', 'generation', 'priority', 'status', 'dispose'])

  assert.deepEqual({ ...handle.dispose() }, { ok: true, code: REVOKED })
  const second = handle.dispose()
  assert.equal(second.ok, false)
  assert.equal(second.code, STALE)
  assert.equal(revoked, 1, 'a repeated dispose must not run the teardown again')
})

test('resource handle never throws through the caller and reports a typed failure', () => {
  const handle = createResourceHandle({
    id: 'policy-b',
    ownerId: 'plugin-b',
    generation: 'plugin-b:1',
    revoke: () => {
      throw new Error('official revocation failed')
    },
  })
  const result = handle.dispose()
  assert.equal(result.ok, false)
  assert.equal(result.code, UNAVAILABLE)
  assert.match(result.reason, /official revocation failed/)
})

test('contribution handle orders by seq and carries no generation', () => {
  const handle = createContributionHandle({
    id: 'panel',
    ownerId: 'plugin-c',
    seq: 4,
    revoke: () => true,
  })
  assert.equal(handle.seq, 4)
  assert.equal('generation' in handle, false)
  assert.ok(Object.isFrozen(handle))
  assert.deepEqual({ ...handle.dispose() }, { ok: true, code: REVOKED })
  assert.equal(handle.dispose().code, STALE)
})

test('operation dispose requests a stop and never adjudicates the terminal state', () => {
  const handle = createOperationHandle({
    id: 'run-1',
    ownerId: 'plugin-d',
    extensions: { cancel: () => {}, meta: { label: 'demo' } },
    requestStop: () => true,
  })
  assert.equal(handle.dispose().code, REQUESTED)
  assert.equal(handle.dispose().code, STALE, 'a repeated stop request is a typed no-op')
  assert.equal(handle.meta.label, 'demo')
  assert.ok(Object.isFrozen(handle))

  const settled = createOperationHandle({ id: 'run-2', ownerId: 'plugin-d', requestStop: () => false })
  const outcome = settled.dispose()
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, STALE)
})

test('observer handle exposes exactly the four public members and hides its bookkeeping', () => {
  let state = { value: 1 }
  const { handle } = createObserverHandle({ epoch: 7, current: (live) => (live ? state : { stale: true }) })

  assert.deepEqual(Object.keys(handle).sort(), ['current', 'dispose', 'epoch', 'subscribe'])
  assert.ok(Object.isFrozen(handle), 'the observation handle must be frozen')
  assert.equal(handle.epoch, 7)
  assert.deepEqual(handle.current(), { value: 1 })
  assert.equal(Object.hasOwn(handle, 'listeners'), false)
  for (const field of ['disposed', 'stale', 'signal', 'abortHandler']) {
    assert.equal(field in handle, false, `the handle must not expose ${field}`)
  }
})

test('observer subscribe answers with an unsubscribe function and stops after dispose', () => {
  const seen = []
  const { handle, publish } = createObserverHandle({ epoch: 1, current: () => null })

  const off = handle.subscribe((payload) => seen.push(payload))
  assert.equal(typeof off, 'function')
  publish('a')
  off()
  publish('b')
  assert.deepEqual(seen, ['a'])

  assert.equal(handle.dispose().code, REVOKED)
  publish('c')
  assert.deepEqual(seen, ['a'], 'a disposed handle must not deliver')

  const afterDispose = handle.subscribe((payload) => seen.push(payload))
  assert.equal(typeof afterDispose, 'function', 'subscribe after dispose is a no-op, not a throw')
  afterDispose()
  assert.deepEqual(seen, ['a'])
})

test('observer listener failures are contained to the failing listener', () => {
  const reported = []
  const seen = []
  const { handle, publish } = createObserverHandle({
    epoch: 2,
    current: () => null,
    reportError: (error) => reported.push(error),
  })

  handle.subscribe(() => {
    throw new Error('broken listener')
  })
  handle.subscribe((payload) => seen.push(payload))
  publish('first')

  assert.deepEqual(seen, ['first'], 'a throwing listener must not affect the others')
  assert.equal(reported.length, 1)
  assert.match(String(reported[0]?.message), /broken listener/)

  const settled = handle.dispose()
  assert.equal(settled.code, REVOKED)
  assert.equal(handle.dispose().code, STALE)
  const degraded = handle.current()
  assert.equal(degraded, null, 'current() is told the handle is no longer live')
})

test('observer handle runs its domain teardown once and contains a failing teardown', () => {
  let teardowns = 0
  const reported = []
  const { handle } = createObserverHandle({
    epoch: 3,
    current: () => null,
    onDispose: () => {
      teardowns += 1
      throw new Error('subscription cleanup failed')
    },
    reportError: (error) => reported.push(error),
  })

  assert.equal(handle.dispose().code, REVOKED, 'a failing domain teardown still releases the handle')
  assert.equal(handle.dispose().code, STALE)
  assert.equal(teardowns, 1)
  assert.equal(reported.length, 1)
})

test('pending contribution handle walks pending -> active and reports it through status()', async () => {
  let settles = 0
  const { handle, live } = createPendingContributionHandle({
    id: 'panel',
    ownerId: 'owner-a',
    seq: 4,
    extensions: { face: Object.freeze({}) },
    settle: () => {
      settles += 1
      return Promise.resolve()
    },
  })

  assert.ok(Object.isFrozen(handle))
  assert.deepEqual(Object.keys(handle).sort(), ['dispose', 'face', 'id', 'ownerId', 'seq', 'status'])
  assert.deepEqual({ ...handle.status() }, { state: 'pending' }, 'status is reported, never a success flag')
  assert.ok(Object.isFrozen(handle.status()))
  assert.equal(live(), false)

  await Promise.resolve()
  await Promise.resolve()
  assert.equal(settles, 1)
  assert.deepEqual({ ...handle.status() }, { state: 'active' })
  assert.equal(live(), true)
  assert.equal(handle.dispose().code, REVOKED, 'releasing a live contribution reports the revocation')
  assert.deepEqual({ ...handle.status() }, { state: 'revoked' }, 'a released handle stays revoked')
  assert.equal(handle.dispose().code, STALE)
})

test('pending contribution handle reports a failed settlement and answers stale once failed', async () => {
  const reported = []
  const { handle } = createPendingContributionHandle({
    id: 'panel',
    ownerId: 'owner-a',
    seq: 5,
    settle: Promise.reject(new Error('mount refused')),
    reportError: (error) => reported.push(error),
  })

  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual({ ...handle.status() }, { state: 'failed', reason: 'mount refused' })
  assert.equal(reported.length, 1)
  assert.equal(handle.dispose().code, STALE, 'a contribution that never took effect has nothing to revoke')
  assert.deepEqual({ ...handle.status() }, { state: 'revoked' })
})

test('withdrawing a pending contribution rolls back a settlement that lands late', async () => {
  let release
  const rollbacks = []
  const { handle } = createPendingContributionHandle({
    id: 'panel',
    ownerId: 'owner-a',
    seq: 6,
    settle: new Promise((resolve) => {
      release = resolve
    }),
    revoke: () => rollbacks.push('rolled back'),
  })

  assert.equal(handle.dispose().code, REVOKED, 'withdrawing while pending is a completed action')
  assert.equal(handle.dispose().code, STALE)
  release()
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(rollbacks, ['rolled back'], 'a late settlement is torn down instead of resurrecting the handle')
  assert.deepEqual({ ...handle.status() }, { state: 'revoked' })
})

test('pending contribution handle can be driven by its controller when settlement is not a thenable', () => {
  const { handle, activate, fail, live } = createPendingContributionHandle({
    id: 'panel',
    ownerId: 'owner-a',
    seq: 7,
  })

  assert.equal(live(), false)
  activate()
  assert.deepEqual({ ...handle.status() }, { state: 'active' })
  assert.equal(live(), true)
  fail(new Error('ignored after activation'))
  assert.deepEqual({ ...handle.status() }, { state: 'active' }, 'a late failure must not rewrite a settled lifecycle')
})

test('helper result builders stay aligned with the kernel code set', () => {
  assert.equal(releasedResult().code, REVOKED)
  assert.equal(stopRequestedResult().code, REQUESTED)
  assert.equal(staleResult('gone').code, STALE)
  assert.equal(staleResult('gone').reason, 'gone')
  for (const result of [releasedResult(), stopRequestedResult(), staleResult()]) {
    assert.ok(Object.isFrozen(result))
  }
})
