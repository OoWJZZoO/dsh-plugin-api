import test from 'node:test'
import assert from 'node:assert/strict'
import { createExecutionObservation } from '../lib/execution-observation.js'

function createMockCtx() {
  const listeners = new Map()
  const ctx = {
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name).push(listener)
      return () => {
        const arr = listeners.get(name)
        if (arr) {
          const idx = arr.indexOf(listener)
          if (idx !== -1) arr.splice(idx, 1)
        }
      }
    },
    off() {},
  }
  return { ctx, listeners }
}

function call(listeners, name, ...args) {
  return listeners.get(name)?.map((fn) => fn(...args))
}

function runToolCall(listeners, sessionId = 's1') {
  const exec = { agent: { session: { id: sessionId } } }
  call(listeners, 'tools/pre-execute', exec, () => {})
  call(listeners, 'tools/result', exec, { value: 1 })
  return exec
}

test('assembly exposes observe/get/history/onChange with frozen committed snapshots', () => {
  const { ctx, listeners } = createMockCtx()
  const owner = createExecutionObservation({ ctx })
  const { api } = owner
  assert.equal(typeof api.observe, 'function')
  assert.equal(typeof api.get, 'function')
  assert.equal(typeof api.history, 'function')
  assert.equal(api.onChange, undefined, 'the merged onChange member is no longer public')
  assert.equal(typeof api.visibility.register, 'function')

  runToolCall(listeners, 's1')
  const projections = api.history('s1')
  assert.equal(projections.items.length, 1)
  assert.equal(projections.items[0].outcome, 'success')
  assert.ok(Object.isFrozen(projections.items[0]))
})

test('observe subscribes to committed snapshots and disposes idempotently', () => {
  const { ctx, listeners } = createMockCtx()
  const owner = createExecutionObservation({ ctx })
  const { api } = owner
  const observer = api.observe({ sessionId: 's1' })
  assert.deepEqual(Object.keys(observer).sort(), ['current', 'dispose', 'epoch', 'subscribe'])
  assert.ok(Object.isFrozen(observer), 'the public handle is frozen')
  assert.equal('listeners' in observer, false, 'the internal listener set never escapes')
  assert.equal('disposed' in observer, false, 'the internal liveness flag never escapes')
  assert.equal('signal' in observer, false, 'the internal abort signal never escapes')
  assert.equal('abortHandler' in observer, false, 'the internal abort handler never escapes')
  const seen = []
  observer.subscribe((snapshots) => seen.push(snapshots))

  runToolCall(listeners, 's1')
  assert.equal(seen.length >= 1, true)
  assert.equal(seen.at(-1).length, 1)
  assert.equal(seen.at(-1)[0].outcome, 'success')

  const released = observer.dispose()
  assert.equal(released.ok, true)
  assert.equal(released.code, 'revoked')
  const stale = observer.dispose()
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'stale')
})

test('a subscription from a released execution handle is a no-op', () => {
  const { ctx, listeners } = createMockCtx()
  const owner = createExecutionObservation({ ctx })
  const { api } = owner
  const observer = api.observe({ sessionId: 's1' })
  observer.dispose()
  const seen = []
  const unsubscribe = observer.subscribe((snapshots) => seen.push(snapshots))
  assert.equal(typeof unsubscribe, 'function')
  assert.doesNotThrow(() => unsubscribe())
  assert.doesNotThrow(() => observer.subscribe('not-a-function'))
  runToolCall(listeners, 's1')
  assert.equal(seen.length, 0)
})

test('a failing listener degrades only itself and a rejecting listener never escapes', async () => {
  const { ctx, listeners } = createMockCtx()
  const owner = createExecutionObservation({ ctx })
  const { api } = owner
  const observer = api.observe({ sessionId: 's1' })
  const seen = []
  observer.subscribe(() => { throw new Error('listener boom') })
  observer.subscribe(async () => { throw new Error('listener rejection') })
  observer.subscribe((snapshots) => seen.push(snapshots))
  // the reactive and the async paths both deliver to the healthy listener
  runToolCall(listeners, 's1')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(seen.length >= 1, true)
  assert.equal(seen.at(-1)[0].outcome, 'success')
  observer.dispose()
})

test('get answers the shared absence vocabulary instead of undefined', () => {
  const { ctx, listeners } = createMockCtx()
  const owner = createExecutionObservation({ ctx })
  const { api } = owner
  runToolCall(listeners, 's1')
  const projection = api.history('s1').items[0]
  const missing = api.get('unknown-execution', { audience: 'ui' })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'missing')
  assert.ok(Object.isFrozen(missing))
  owner.dispose()
  const unavailable = api.get(projection.executionId, { audience: 'ui' })
  assert.equal(unavailable.ok, false)
  assert.equal(unavailable.code, 'unavailable')
})

test('AbortSignal stops the observer only and never commits aborted', () => {
  const { ctx, listeners } = createMockCtx()
  const owner = createExecutionObservation({ ctx })
  const { api } = owner

  const controller = new AbortController()
  const observer = api.observe({ sessionId: 's1', signal: controller.signal })
  controller.abort()
  assert.equal(observer.dispose().code, 'stale', 'already disposed by abort')
  assert.equal(observer.current().length, 0)

  runToolCall(listeners, 's1')
  // The aborted observer sees nothing, but the host projection still exists.
  assert.equal(api.history('s1').items.length, 1)
  assert.equal(api.history('s1').items[0].outcome, 'success')
})

test('audience redaction is applied per get() audience option', () => {
  const { ctx, listeners } = createMockCtx()
  const owner = createExecutionObservation({ ctx })
  const { api } = owner
  runToolCall(listeners, 's1')
  const projection = api.history('s1').items[0]
  assert.ok('provenance' in projection)
  const model = api.get(projection.executionId, { audience: 'model' })
  assert.ok('executionId' in model)
  assert.ok(!('provenance' in model), 'model/tool output omits internal diagnostics')
})

test('visibility registration is exposed and works with the projection', () => {
  const { ctx, listeners } = createMockCtx()
  const owner = createExecutionObservation({ ctx })
  const { api } = owner
  const disposer = api.visibility.register({
    id: 'audit',
    ownerId: 'o',
    generation: 'g',
    filter: () => false,
  })
  assert.equal(typeof disposer, 'function')
  assert.equal(disposer(), true)
})

test('surface exposes no retry/route/checkpoint/task mutation members', () => {
  const { ctx } = createMockCtx()
  const owner = createExecutionObservation({ ctx })
  const { api } = owner
  for (const forbidden of ['retry', 'route', 'checkpoint', 'resume', 'task']) {
    assert.equal(forbidden in api, false, `forbidden member ${forbidden} must not exist`)
  }
  assert.equal(typeof api.availability.sources.tools, 'string')
  assert.ok(api.availability.epoch.startsWith('epoch:'))
})

test('dispose is idempotent and then history is inert', () => {
  const { ctx } = createMockCtx()
  const owner = createExecutionObservation({ ctx })
  assert.equal(owner.dispose(), true)
  assert.equal(owner.dispose(), false)
  assert.equal(owner.api.history('s1').items.length, 0)
})
