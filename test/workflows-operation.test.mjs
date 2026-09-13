/**
 * Unit acceptance for the workflow run entry core module (harness-free).
 *
 * The module owns the request-shape validation, the open mapping of the
 * engine's synchronous refusals, the settled-result terminal mapping and the
 * holder-owned run handle. The real engine behaviour lives in the e2e file.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createWorkflowRunHandle,
  mapStartRejection,
  mapWorkflowResult,
  validateStartRequest,
} from '../lib/workflows-operation.js'

const validRequest = () => ({
  script: 'return { ok: true }',
  meta: { name: 'probe', description: 'probe workflow' },
  parent: { id: 'agent-1', session: { id: 's1' } },
})

test('the request shape is validated before any engine call', () => {
  assert.equal(validateStartRequest(validRequest()), null)
  assert.equal(validateStartRequest(null).code, 'invalid-request')
  assert.equal(validateStartRequest({}).code, 'invalid-request')
  assert.equal(validateStartRequest({ ...validRequest(), script: '' }).code, 'invalid-request')
  assert.equal(validateStartRequest({ ...validRequest(), script: 42 }).code, 'invalid-request')
  assert.equal(validateStartRequest({ ...validRequest(), meta: 'x' }).code, 'invalid-request')
  assert.equal(validateStartRequest({ ...validRequest(), parent: 'agent-1' }).code, 'invalid-request')
  assert.equal(validateStartRequest({ ...validRequest(), subagentProvider: '' }).code, 'invalid-request')
  assert.equal(validateStartRequest({ ...validRequest(), maxTotalAgents: 1.5 }).code, 'invalid-request')
  assert.equal(validateStartRequest({ ...validRequest(), signal: {} }).code, 'invalid-request')
  const refusal = validateStartRequest({})
  assert.equal(Object.isFrozen(refusal), true)
})

test('official refusal codes pass through unchanged and wrapper failures stay internal', () => {
  const official = Object.assign(new Error('workflow meta is invalid'), { name: 'WorkflowError', code: 'META_INVALID' })
  const mapped = mapStartRejection(official)
  assert.deepEqual({ ...mapped }, { ok: false, code: 'META_INVALID', reason: 'workflow meta is invalid' })
  assert.equal(Object.isFrozen(mapped), true)

  // Open mapping: any official code is passed through, including one the
  // default engine never emits synchronously.
  const exotic = Object.assign(new Error('cap tripped'), { name: 'WorkflowError', code: 'AGENT_CAP' })
  assert.equal(mapStartRejection(exotic).code, 'AGENT_CAP')

  const wrapper = mapStartRejection(new Error('wrapper exploded'))
  assert.equal(wrapper.code, 'internal')
  assert.equal(mapStartRejection(undefined).code, 'internal')
})

test('the settled result maps onto the three declared terminals', () => {
  const completed = mapWorkflowResult({ stopReason: 'completed', value: { answer: 42 }, agentsStarted: 2 })
  assert.deepEqual({ ...completed }, { ok: true, terminal: 'success', stopReason: 'completed', value: { answer: 42 }, agentsStarted: 2 })
  assert.equal(Object.isFrozen(completed), true)

  const noValue = mapWorkflowResult({ stopReason: 'completed', agentsStarted: 0 })
  assert.equal('value' in noValue, false, 'a script without a return value carries no value field')

  const cancelled = mapWorkflowResult({ stopReason: 'cancelled', error: 'cancelled by user', agentsStarted: 1 })
  assert.deepEqual({ ...cancelled }, { ok: false, terminal: 'aborted', stopReason: 'cancelled', error: 'cancelled by user', agentsStarted: 1 })

  const failed = mapWorkflowResult({ stopReason: 'error', error: 'script exploded', agentsStarted: 1 })
  assert.deepEqual({ ...failed }, { ok: false, terminal: 'error', stopReason: 'error', error: 'script exploded', agentsStarted: 1 })

  // No denied / superseded terminal is ever produced in this domain.
  const unexpected = mapWorkflowResult({ stopReason: 'something-else' })
  assert.equal(unexpected.terminal, 'error')
})

/** A fake official run faithful to the holder-owned contract. */
function fakeRun({ id = 'run-1', settled = { stopReason: 'completed', value: { ok: true }, agentsStarted: 0 } } = {}) {
  const calls = { cancel: [], dispose: 0 }
  let resolveResult
  const result = new Promise((resolve) => { resolveResult = resolve })
  const run = {
    id,
    meta: Object.freeze({ name: 'probe', description: 'probe workflow' }),
    result,
    cancel(reason) { calls.cancel.push(reason) },
    async dispose() { calls.dispose += 1 },
    settle(value = settled) { resolveResult(value) },
  }
  return { run, calls }
}

test('the handle exposes the official identity, meta and a derived status', async () => {
  const { run } = fakeRun()
  const handle = createWorkflowRunHandle({ run, ownerId: 'plugin-a' })
  assert.equal(handle.id, 'run-1')
  assert.equal(handle.ownerId, 'plugin-a')
  assert.deepEqual({ ...handle.meta }, { ...run.meta }, 'the handle exposes the engine-validated meta block')
  assert.equal(Object.isFrozen(handle.meta), true, 'the public meta block is frozen')
  assert.deepEqual({ ...handle.status() }, { state: 'running' })
  assert.equal(Object.isFrozen(handle), true)

  run.settle({ stopReason: 'completed', value: 1, agentsStarted: 3 })
  const settled = await handle.result
  assert.equal(settled.terminal, 'success')
  assert.deepEqual({ ...handle.status() }, { state: 'settled', stopReason: 'completed', agentsStarted: 3 })
  assert.equal(await handle.result, settled, 'the result settles exactly once')
})

test('the result never rejects even when the engine contract is breached', async () => {
  const { run } = fakeRun()
  const handle = createWorkflowRunHandle({ run, ownerId: 'plugin-a' })
  run.result = Promise.reject(new Error('engine contract breach'))
  // The wrapper captured the promise at creation; a later breach is reported
  // through the mapped terminal of a fresh handle.
  const second = createWorkflowRunHandle({ run, ownerId: 'plugin-a' })
  const settled = await second.result
  assert.equal(settled.terminal, 'error')
  assert.equal(settled.ok, false)
  assert.match(settled.error, /engine contract breach/)
  assert.equal(typeof (await handle.result).terminal, 'string')
})

test('observation is run-scoped, contained and released by its own disposer', async () => {
  const { run } = fakeRun()
  const feed = []
  const handle = createWorkflowRunHandle({
    run,
    ownerId: 'plugin-a',
    subscribeFeed: (listener) => {
      feed.push(listener)
      return () => { listener.disposed = true }
    },
  })
  const released = []
  const kept = []
  const release = handle.observe((event) => released.push(event.name))
  handle.observe(() => { throw new Error('broken listener') })
  handle.observe((event) => kept.push(event.name))

  for (const listener of feed) {
    listener({ id: 'run-1', name: 'workflow/phase' })
    listener({ id: 'other-run', name: 'workflow/phase' })
  }
  assert.deepEqual(released, ['workflow/phase'], 'only this run identity reaches the listeners')
  assert.deepEqual(kept, ['workflow/phase'], 'a broken listener is contained and never blocks the others')

  release()
  for (const listener of feed) listener({ id: 'run-1', name: 'workflow/log' })
  assert.deepEqual(released, ['workflow/phase'], 'a released subscription stops receiving')
  assert.deepEqual(kept, ['workflow/phase', 'workflow/log'], 'the other subscription is unaffected')
})

test('cancel and dispose are delegated, bounded and idempotent', async () => {
  const { run, calls } = fakeRun()
  const handle = createWorkflowRunHandle({ run, ownerId: 'plugin-a' })
  handle.cancel('user asked')
  assert.deepEqual(calls.cancel, ['user asked'])
  await handle.dispose()
  await handle.dispose()
  assert.equal(calls.dispose, 1, 'dispose is idempotent and reaches the engine once')

  // A hostile engine must not let cancel escape the facade.
  const hostile = fakeRun()
  hostile.run.cancel = () => { throw new Error('engine cancel exploded') }
  const hostileHandle = createWorkflowRunHandle({ run: hostile.run, ownerId: 'plugin-a' })
  assert.doesNotThrow(() => hostileHandle.cancel('x'))
})

test('handle operations stay bound to the run they were created with', async () => {
  const first = fakeRun({ id: 'run-1' })
  const second = fakeRun({ id: 'run-2' })
  const handleA = createWorkflowRunHandle({ run: first.run, ownerId: 'plugin-a' })
  const handleB = createWorkflowRunHandle({ run: second.run, ownerId: 'plugin-b' })
  handleA.cancel('a')
  assert.deepEqual(first.calls.cancel, ['a'])
  assert.deepEqual(second.calls.cancel, [], 'a handle never reaches another run')
  first.run.settle({ stopReason: 'cancelled', agentsStarted: 0 })
  assert.equal((await handleA.result).terminal, 'aborted')
  assert.equal(handleB.status().state, 'running', 'the other run keeps its own state')
})
