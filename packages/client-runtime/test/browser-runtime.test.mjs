/**
 * Browser attention runtime tests (the client-half state machine): message
 * reconciliation, item id/seq dedupe, epoch rebuild on reset, host snapshot
 * refetch, typed request forwarding without queueing, truthful availability
 * and listener containment.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createBrowserAttentionRuntime, isValidAttentionMessage } from '../lib/browser-runtime.js'

function makeChannel() {
  const listeners = new Set()
  return {
    listeners,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(message) {
      for (const listener of [...listeners]) listener(message)
    },
  }
}

test('isValidAttentionMessage: shape-only validation', () => {
  assert.equal(isValidAttentionMessage({ kind: 'attention.snapshot', epoch: 1, seq: 1, items: [] }), true)
  assert.equal(isValidAttentionMessage({ kind: 'attention.delta', epoch: 1, seq: 1, changes: [{ op: 'remove', id: 'x' }] }), true)
  assert.equal(isValidAttentionMessage({ kind: 'bogus', epoch: 1, seq: 1, items: [] }), false)
  assert.equal(isValidAttentionMessage({ kind: 'attention.delta', epoch: 1, seq: 1, changes: [{ op: 9 }] }), false)
})

test('snapshot ingest builds the projection; current() is frozen and sorted', () => {
  const receive = makeChannel()
  const runtime = createBrowserAttentionRuntime({ receive, send: null, fetchSnapshot: null })
  runtime.attach()
  receive.emit({
    kind: 'attention.snapshot',
    epoch: 1,
    seq: 10,
    items: [
      { id: 'b', seq: 2, title: 'B', level: 'warning' },
      { id: 'a', seq: 1, title: 'A', level: 'info' },
    ],
  })
  const view = runtime.current()
  assert.deepEqual(view.map((item) => item.id), ['a', 'b'])
  assert.equal(Object.isFrozen(view), true)
  assert.equal(Object.isFrozen(view[0]), true)
  runtime.dispose()
})

test('delta reconciliation: add/update/remove with id/seq dedupe', () => {
  const receive = makeChannel()
  const seen = []
  const runtime = createBrowserAttentionRuntime({ receive, send: null, fetchSnapshot: null })
  runtime.attach()
  runtime.observe((change) => seen.push(change))
  receive.emit({ kind: 'attention.delta', epoch: 1, seq: 11, changes: [{ op: 'add', id: 'c', item: { id: 'c', seq: 3, title: 'C' } }] })
  assert.deepEqual(runtime.current().map((i) => i.id), ['c'])
  assert.equal(seen[0].op, 'add')
  assert.equal(seen[0].id, 'c')
  // duplicate add with the same seq must not render twice
  receive.emit({ kind: 'attention.delta', epoch: 1, seq: 12, changes: [{ op: 'add', id: 'c', item: { id: 'c', seq: 3, title: 'C' } }] })
  assert.equal(runtime.current().length, 1)
  assert.equal(seen.length, 1)
  // update replaces the item
  receive.emit({ kind: 'attention.delta', epoch: 1, seq: 13, changes: [{ op: 'update', id: 'c', item: { id: 'c', seq: 4, title: 'C2' } }] })
  assert.equal(runtime.current()[0].title, 'C2')
  assert.equal(seen[seen.length - 1].op, 'update')
  // remove with reason
  receive.emit({ kind: 'attention.delta', epoch: 1, seq: 14, changes: [{ op: 'remove', id: 'c', reason: 'dismissed' }] })
  assert.equal(runtime.current().length, 0)
  assert.equal(seen[seen.length - 1].op, 'remove')
  assert.equal(seen[seen.length - 1].reason, 'dismissed')
  runtime.dispose()
})

test('stale host epoch deltas are dropped', () => {
  const receive = makeChannel()
  const runtime = createBrowserAttentionRuntime({ receive, send: null, fetchSnapshot: null })
  runtime.attach()
  receive.emit({ kind: 'attention.snapshot', epoch: 5, seq: 1, items: [{ id: 'a', seq: 1 }] })
  receive.emit({ kind: 'attention.delta', epoch: 4, seq: 2, changes: [{ op: 'add', id: 'b', item: { id: 'b', seq: 2 } }] })
  assert.deepEqual(runtime.current().map((i) => i.id), ['a'])
  runtime.dispose()
})

test('rebind rebuilds the projection from the host snapshot with a fresh epoch', async () => {
  const receive = makeChannel()
  const resets = makeChannel()
  let fetchCalls = 0
  const runtime = createBrowserAttentionRuntime({
    receive,
    send: null,
    fetchSnapshot: async () => {
      fetchCalls += 1
      return { epoch: 5, seq: 30, items: [{ id: 'x', seq: 1, title: 'X' }] }
    },
    onReset: resets,
  })
  await runtime.attach()
  assert.equal(fetchCalls, 1)
  receive.emit({ kind: 'attention.delta', epoch: 5, seq: 6, changes: [{ op: 'add', id: 'y', item: { id: 'y', seq: 2 } }] })
  assert.deepEqual(runtime.current().map((i) => i.id), ['x', 'y'])
  await runtime.reload()
  assert.equal(fetchCalls, 2)
  assert.deepEqual(runtime.current().map((i) => i.id), ['x'], 'old-epoch live items must not be carried')
  runtime.dispose()
})

test('contribute/dismiss/invoke are forwarded typed and never queued', async () => {
  const receive = makeChannel()
  const requests = []
  const runtime = createBrowserAttentionRuntime({
    receive,
    send: async (request) => {
      requests.push(request)
      return { ok: true, code: request.op === 'contribute' ? 'registered' : request.op === 'dismiss' ? 'dismissed' : 'invoked' }
    },
    fetchSnapshot: null,
  })
  runtime.attach()
  const contributed = await runtime.contribute({ id: 'q', title: 'Q', level: 'info' })
  assert.equal(contributed.ok, true)
  assert.equal(requests[0].kind, 'attention.request')
  assert.equal(requests[0].op, 'contribute')
  const dismissed = await runtime.dismiss('q', { by: 'ui' })
  assert.equal(requests[1].op, 'dismiss')
  assert.equal(dismissed.code, 'dismissed')
  const invoked = await runtime.invoke('q', 'go')
  assert.equal(requests[2].op, 'invoke')
  assert.equal(invoked.code, 'invoked')
  runtime.dispose()
})

test('missing request channel → typed unavailable, not queued', async () => {
  const receive = makeChannel()
  const runtime = createBrowserAttentionRuntime({ receive, send: null, fetchSnapshot: null })
  runtime.attach()
  const outcome = await runtime.contribute({ id: 'q', title: 'Q', level: 'info' })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'unavailable')
  runtime.dispose()
})

test('availability reflects the seams truthfully', () => {
  const receive = makeChannel()
  const none = createBrowserAttentionRuntime({ receive: null })
  assert.equal(none.availability().status, 'unavailable')
  const receiveOnly = createBrowserAttentionRuntime({ receive, send: null })
  assert.equal(receiveOnly.availability().status, 'degraded')
  const full = createBrowserAttentionRuntime({ receive, send: async () => ({ ok: false }) })
  assert.equal(full.availability().status, 'active')
  full.dispose()
  assert.equal(full.availability().status, 'unavailable')
})

test('listener exceptions are contained', () => {
  const receive = makeChannel()
  const runtime = createBrowserAttentionRuntime({ receive, send: null, fetchSnapshot: null })
  runtime.attach()
  const good = []
  runtime.observe(() => { throw new Error('boom') })
  runtime.observe((change) => good.push(change))
  receive.emit({ kind: 'attention.delta', epoch: 1, seq: 1, changes: [{ op: 'add', id: 'a', item: { id: 'a', seq: 1 } }] })
  assert.equal(good.length, 1)
  runtime.dispose()
})

test('dispose is idempotent and stops delivery', () => {
  const receive = makeChannel()
  const runtime = createBrowserAttentionRuntime({ receive, send: null, fetchSnapshot: null })
  runtime.attach()
  runtime.dispose()
  runtime.dispose()
  assert.equal(runtime.availability().status, 'unavailable')
})