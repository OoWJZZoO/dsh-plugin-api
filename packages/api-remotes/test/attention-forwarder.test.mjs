/**
 * Attention forwarder tests: the hub attention updates ride the official
 * host→browser event stream as typed `host/remote-event` frames; malformed or
 * bounded messages are dropped; the extension never enters the consumer
 * `$on` key set; attach/dispose is idempotent and conflict-safe.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAttentionFrame,
  createAttentionForwarder,
  isValidAttentionUpdate,
} from '../lib/attention-forwarder.js'
import { ATTENTION_UPDATE_EVENT } from '../lib/shared-vocab.js'

const OFFICIAL_11 = [
  'agent-preset/selected',
  'commands/change',
  'credentials/updated',
  'cordis/request-run',
  'cordis/request-run-resolved',
  'cordis/dynamic-package',
  'cordis/dynamic-retract',
  'cordis/inspect-query',
  'cordis/inspect-query-resolved',
  'llm/adapters-updated',
  'settings/document-updated',
]

function channel() {
  const listeners = []
  return {
    listeners,
    subscribe(listener) {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
  }
}

function sink() {
  const frames = []
  return { frames, push: (frame) => frames.push(frame) }
}

test('buildAttentionFrame uses the official host/remote-event wire shape', () => {
  const frame = buildAttentionFrame({ kind: 'attention.delta', epoch: 2, seq: 5, changes: [{ op: 'add', id: 'x' }] })
  assert.equal(frame.type, 'host/remote-event')
  assert.equal(frame.event, ATTENTION_UPDATE_EVENT)
  assert.equal(frame.args[0].seq, 5)
  assert.equal(Object.isFrozen(frame), true)
})

test('isValidAttentionUpdate rejects malformed and accepts well-shaped messages', () => {
  assert.equal(isValidAttentionUpdate({ kind: 'attention.delta', epoch: 1, seq: 1, changes: [{ op: 'add', id: 'x' }] }), true)
  assert.equal(isValidAttentionUpdate({ kind: 'attention.snapshot', epoch: 1, seq: 1, items: [] }), true)
  assert.equal(isValidAttentionUpdate({ kind: 'attention.delta', epoch: 1, seq: 1, changes: [{ op: 42 }] }), false)
  assert.equal(isValidAttentionUpdate({ kind: 'other', epoch: 1, seq: 1 }), false)
  assert.equal(isValidAttentionUpdate(null), false)
})

test('forwarder: forwards validated hub messages as frames onto the stream', () => {
  const source = channel()
  const stream = sink()
  const forwarder = createAttentionForwarder({ allowlist: [...OFFICIAL_11] })
  const attached = forwarder.attach({ source, stream })
  assert.equal(attached.ok, true)
  const message = { kind: 'attention.delta', epoch: 1, seq: 3, changes: [{ op: 'add', id: 'a' }] }
  source.listeners[0](message)
  assert.equal(stream.frames.length, 1)
  assert.equal(stream.frames[0].event, 'attention/update')
  assert.deepEqual(stream.frames[0].args[0], message, 'frame args carry the message')
  assert.notEqual(stream.frames[0].args[0], message, 'the frame is a copy, not the shared payload')
  forwarder.dispose()
})

test('forwarder: drops malformed messages and never lets them reach the stream', () => {
  const source = channel()
  const stream = sink()
  const forwarder = createAttentionForwarder({ allowlist: [...OFFICIAL_11] })
  forwarder.attach({ source, stream })
  source.listeners[0]({ kind: 'garbage' })
  source.listeners[0](null)
  source.listeners[0]({ kind: 'attention.delta', epoch: 1, seq: 1 })
  assert.equal(stream.frames.length, 0)
  forwarder.dispose()
})

test('forwarder: refuses to attach when the extension would enter the consumer allowlist', () => {
  const source = channel()
  const stream = sink()
  const forwarder = createAttentionForwarder({ allowlist: [...OFFICIAL_11, ATTENTION_UPDATE_EVENT] })
  const attached = forwarder.attach({ source, stream })
  assert.equal(attached.ok, false)
  assert.equal(attached.code, 'conflict')
})

test('forwarder: missing source or stream reports unavailable', () => {
  const stream = sink()
  const forwarder = createAttentionForwarder({ allowlist: [...OFFICIAL_11] })
  assert.equal(forwarder.attach({ source: null, stream }).code, 'unavailable')
  assert.equal(forwarder.attach({ source: channel(), stream: null }).code, 'unavailable')
  assert.equal(forwarder.attach({ source: channel(), stream }).ok, true)
  forwarder.dispose()
})

test('forwarder: double attach is a conflict; dispose is idempotent', () => {
  const source = channel()
  const stream = sink()
  const forwarder = createAttentionForwarder({ allowlist: [...OFFICIAL_11] })
  assert.equal(forwarder.attach({ source, stream }).ok, true)
  assert.equal(forwarder.attach({ source, stream }).code, 'conflict')
  forwarder.dispose()
  assert.equal(forwarder.detached(), true)
  assert.equal(forwarder.attach({ source, stream }).ok, true)
  forwarder.dispose()
  forwarder.dispose()
})

test('forwarder: push count is bounded and stops dropping forever', () => {
  const source = channel()
  const stream = sink()
  const forwarder = createAttentionForwarder({ allowlist: [...OFFICIAL_11], maxInFlight: 2 })
  forwarder.attach({ source, stream })
  source.listeners[0]({ kind: 'attention.delta', epoch: 1, seq: 1, changes: [{ op: 'add', id: 'a' }] })
  source.listeners[0]({ kind: 'attention.delta', epoch: 1, seq: 2, changes: [{ op: 'add', id: 'b' }] })
  source.listeners[0]({ kind: 'attention.delta', epoch: 1, seq: 3, changes: [{ op: 'add', id: 'c' }] })
  assert.equal(stream.frames.length, 2)
  forwarder.dispose()
})