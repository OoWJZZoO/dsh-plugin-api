/**
 * Client attention face tests (Wave 5): the main facade `ctx.pluginApi.attention`
 * outlet presents the same frozen projection shape as the host, filters by the
 * client's audience kind, forwards typed requests, reports truthful
 * availability and survives rebind with a fresh projection.
 *
 * The face is a pure module fed with the real browser attention runtime from
 * the client-runtime slice (fake transport seams only).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientAttentionFace } from '../lib/client-attention-face.js'
import { createBrowserAttentionRuntime } from '../packages/client-runtime/lib/browser-runtime.js'

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

function runtimeWith({ send, fetchSnapshot }) {
  const receive = makeChannel()
  const runtime = createBrowserAttentionRuntime({
    receive,
    send: send ?? null,
    fetchSnapshot: fetchSnapshot ?? null,
    onReset: null,
  })
  return { runtime, receive }
}

test('face: public surface members are present and frozen', () => {
  const { runtime } = runtimeWith({})
  const face = createClientAttentionFace({ runtime })
  for (const member of ['current', 'list', 'observe', 'contribute', 'dismiss', 'invoke', 'availability']) {
    assert.equal(typeof face[member], 'function', member)
  }
  assert.equal(Object.isFrozen(face), true)
})

test('face: current() filters by the client audience kind', () => {
  const { runtime, receive } = runtimeWith({})
  runtime.attach()
  receive.emit({
    kind: 'attention.snapshot',
    epoch: 1,
    seq: 1,
    items: [
      { id: 'web1', seq: 1, title: 'web', level: 'info', audience: ['web'] },
      { id: 'desk1', seq: 2, title: 'desk', level: 'info', audience: ['desktop'] },
      { id: 'all1', seq: 3, title: 'all', level: 'info', audience: 'all' },
    ],
  })
  const webFace = createClientAttentionFace({ runtime })
  assert.deepEqual(webFace.current().map((item) => item.id), ['web1', 'all1'])
  const deskFace = createClientAttentionFace({ runtime, kind: 'desktop' })
  assert.deepEqual(deskFace.current().map((item) => item.id), ['desk1', 'all1'])
})

test('face: list() paginates with cursor continuation and filters overlay', () => {
  const { runtime, receive } = runtimeWith({})
  runtime.attach()
  const items = []
  for (let index = 1; index <= 4; index += 1) {
    items.push({ id: `i${index}`, seq: index, title: `item ${index}`, level: 'info', audience: 'all', scope: { sessionId: index % 2 ? 's1' : 's2' } })
  }
  receive.emit({ kind: 'attention.snapshot', epoch: 1, seq: 0, items })
  const face = createClientAttentionFace({ runtime })
  const pageA = face.list({ limit: 2 })
  assert.equal(pageA.items.length, 2)
  assert.equal(typeof pageA.nextCursor, 'number')
  const pageB = face.list({ limit: 2, cursor: pageA.nextCursor })
  assert.equal(pageB.items.length, 2)
  assert.deepEqual(pageB.items.map((item) => item.id), ['i3', 'i4'])
  const scoped = face.list({ scope: { sessionId: 's1' } })
  assert.deepEqual(scoped.items.map((item) => item.id), ['i1', 'i3'])
})

test('face: observe delivers audience-filtered frozen changes and honors dispose', async () => {
  const { runtime, receive } = runtimeWith({})
  await runtime.attach()
  const face = createClientAttentionFace({ runtime })
  const seen = []
  const handle = face.observe({})
  handle.subscribe((change) => seen.push(change))
  receive.emit({
    kind: 'attention.delta',
    epoch: 1,
    seq: 2,
    changes: [
      { op: 'add', id: 'a', item: { id: 'a', seq: 1, title: 'A', level: 'info', audience: ['web'] } },
      { op: 'add', id: 'b', item: { id: 'b', seq: 2, title: 'B', level: 'info', audience: ['desktop'] } },
    ],
  })
  assert.equal(seen.length, 1, 'desktop-only item must not reach a web face')
  assert.equal(seen[0].id, 'a')
  assert.equal(Object.isFrozen(seen[0].item), true)
  assert.equal(typeof handle.epoch, 'number')
  handle.dispose()
  receive.emit({ kind: 'attention.delta', epoch: 1, seq: 3, changes: [{ op: 'add', id: 'c', item: { id: 'c', seq: 3, title: 'C', level: 'info', audience: 'all' } }] })
  assert.equal(seen.length, 1, 'disposed handle receives nothing')
})

test('face: contribute/dismiss/invoke forward typed round-trips to the hub', async () => {
  const requests = []
  const { runtime, receive } = runtimeWith({
    send: async (request) => {
      requests.push(request)
      return { ok: true, code: request.op }
    },
    fetchSnapshot: null,
  })
  await runtime.attach()
  const face = createClientAttentionFace({ runtime })
  const contributed = await face.contribute({ id: 'q', title: 'Q', level: 'info' })
  assert.equal(contributed.ok, true)
  assert.equal(requests[0].op, 'contribute')
  assert.deepEqual(requests[0].spec, { id: 'q', title: 'Q', level: 'info' })
  const dismissed = await face.dismiss('q', { by: 'ui' })
  assert.equal(requests[1].op, 'dismiss')
  assert.equal(dismissed.ok, true)
  const invoked = await face.invoke('q', 'go')
  assert.equal(requests[2].op, 'invoke')
  assert.equal(invoked.ok, true)
})

test('face: availability is truthful; missing pipeline → unavailable, missing channel → degraded', async () => {
  const { runtime, receive } = runtimeWith({})
  await runtime.attach()
  const face = createClientAttentionFace({ runtime })
  assert.equal(face.availability().status, 'degraded')
  const outcome = await face.contribute({ id: 'x', title: 'X', level: 'info' })
  assert.equal(outcome.code, 'unavailable')
  assert.equal(outcome.ok, false)
  // no pipeline at all → unavailable
  const none = createBrowserAttentionRuntime({ receive: null })
  const noneFace = createClientAttentionFace({ runtime: none })
  assert.equal(noneFace.availability().status, 'unavailable')
})

test('face: rebind rebuilds the projection from the host snapshot (old items not carried)', async () => {
  const { runtime, receive } = runtimeWith({
    fetchSnapshot: async () => ({ epoch: 5, seq: 50, items: [{ id: 'fresh', seq: 1, title: 'F', level: 'info', audience: 'all' }] }),
  })
  await runtime.attach()
  receive.emit({ kind: 'attention.delta', epoch: 5, seq: 2, changes: [{ op: 'add', id: 'stale', item: { id: 'stale', seq: 2, title: 'S', level: 'info', audience: 'all' } }] })
  const face = createClientAttentionFace({ runtime })
  assert.deepEqual(face.current().map((item) => item.id), ['fresh', 'stale'])
  await runtime.reload()
  assert.deepEqual(face.current().map((item) => item.id), ['fresh'], 'old-epoch items never surface')
})