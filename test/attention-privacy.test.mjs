/**
 * Privacy, boundary and negative mechanical assertions: host projection,
 * forwarded payloads and log exits stay free of secret/owner-private material;
 * attention never becomes durable; the surface never grows UI-policy or
 * session-authority powers; model visibility stays denied by default.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createAttentionHub } from '../lib/attention-hub.js'
import { attentionLogSummary, redactionViolation } from '../lib/attention-redaction.js'
import { buildAttentionUpdate } from '../lib/attention-wire.js'
import { createAttentionForwarder, buildAttentionFrame } from '../packages/api-remotes/lib/attention-forwarder.js'
import { createBrowserAttentionRuntime } from '../packages/client-runtime/lib/browser-runtime.js'

function caller(ownerId, kind = 'web') {
  return { ownerId, kind, scopes: null }
}

const SECRET_PATTERNS = [/sk-[a-zA-Z0-9_-]{16,}/, /\bAKIA[A-Z0-9]{16}\b/, /-----BEGIN /, /\beyJ[a-zA-Z0-9_-]{10,}\./]

function assertNoSecretMaterial(payload) {
  const json = JSON.stringify(payload)
  for (const pattern of SECRET_PATTERNS) {
    assert.equal(pattern.test(json), false, `secret pattern ${pattern} must not reach an exit`)
  }
}

test('redaction: secret material is rejected at the host boundary before any projection', () => {
  assert.ok(redactionViolation({ id: 'a', title: 't', level: 'info', meta: { token: 'x' } }))
  assert.ok(redactionViolation({ id: 'a', title: 'sk-abcdefghijklmnopqrstuvwxyz', level: 'info' }))
  assert.equal(redactionViolation({ id: 'a', title: 'clean', level: 'info' }), null)
})

test('host projection and forwarded payloads never carry secret material', () => {
  let now = 1000
  const hub = createAttentionHub({ now: () => now, resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  const producer = caller('producer', 'web')
  const consumer = caller('consumer', 'desktop')
  hub.contribute({ id: 'n1', title: 'Clean title', level: 'info', body: 'Clean body', meta: { count: 3 } }, producer)
  // host projection
  const view = hub.current(consumer)
  assertNoSecretMaterial(view)
  // hub whole-hub snapshot for the pipeline
  assertNoSecretMaterial(hub.snapshotAll())
  // forwarded frame (wire copy)
  const delta = buildAttentionUpdate({
    kind: 'attention.delta',
    epoch: hub.currentEpoch(),
    seq: 3,
    changes: [{ op: 'add', id: 'n1', item: view[0] }],
  })
  assertNoSecretMaterial(buildAttentionFrame(delta))
  // log summaries carry only a bounded, key-free line
  const summary = attentionLogSummary({ id: 'n1', level: 'info', seq: 1, scope: {} })
  assert.match(summary, /attention\(id=n1/)
  assert.equal(typeof summary, 'string')
  assert.ok(!summary.includes('Clean title'), 'log exits never carry content fields')
})

test('forwarded stream is the official pipeline shape only (no parallel channel)', () => {
  const hub = createAttentionHub({ resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  const producer = caller('producer', 'web')
  hub.contribute({ id: 'p1', title: 'x', level: 'info' }, producer)
  const frames = []
  const source = { subscribe: (listener) => hub.onUpdate(listener) }
  const forwarder = createAttentionForwarder({ allowlist: ['agent-preset/selected', 'commands/change'] })
  forwarder.attach({
    source,
    stream: { push: (frame) => frames.push(frame) },
    snapshot: () => hub.snapshotAll(),
  })
  const [frame] = frames
  assert.equal(frame.type, 'host/remote-event')
  assert.equal(frame.event, 'attention/update')
  forwarder.dispose()
})

test('attention never becomes durable: nothing escapes hub or runtime memory', async () => {
  const receive = { subscribe: () => () => {} }
  const runtime = createBrowserAttentionRuntime({ receive, send: null, fetchSnapshot: null })
  await runtime.attach()
  const hub = createAttentionHub({ resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  hub.contribute({ id: 'd1', title: 'one', level: 'info' }, caller('a'))
  assert.equal(hub.snapshotAll().items.length, 1)
  // a second hub/runtime never observes the first one's state
  const other = createAttentionHub({ resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  assert.equal(other.current(caller('b')).length, 0)
  assert.equal(runtime.current().length, 0)
})

test('model visibility stays denied by default: no model-target field anywhere', () => {
  const hub = createAttentionHub({ resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  hub.contribute({ id: 'm1', title: 'visible', level: 'info' }, caller('a'))
  const snapshot = hub.snapshotAll()
  for (const item of snapshot.items) {
    for (const key of Object.keys(item)) {
      assert.equal(key.toLowerCase().includes('model'), false, `unexpected model field ${key}`)
    }
  }
})

test('the attention surface never grows UI-policy or session-authority powers', () => {
  const hub = createAttentionHub({ resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  const allowed = new Set([
    'name', 'contribute', 'dispose', 'dismiss', 'invoke', 'current', 'list', 'snapshotAll',
    'observe', 'availability', 'setAvailability', 'sweep', 'withdrawOwner', 'reloadOwner',
    'resetEpoch', 'onUpdate', 'currentEpoch', 'peekSeq',
  ])
  for (const member of Object.keys(hub)) {
    assert.ok(allowed.has(member), `unexpected hub member ${member}`)
  }
  // no notification/display/hardware authority and no session request/cancel verbs
  for (const forbidden of ['notify', 'requestPermission', 'playSound', 'toast', 'sendRequest', 'cancelSession', 'append']) {
    assert.equal(Object.prototype.hasOwnProperty.call(hub, forbidden), false, forbidden)
  }
})