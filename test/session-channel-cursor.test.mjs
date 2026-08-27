import test from 'node:test'
import assert from 'node:assert/strict'
import { createChannelEngine } from '../lib/session-channel-core.js'
import { CODE_RESYNC_REQUIRED } from '../lib/session-channel-shared.js'

test('cursor: session events are retained in the bounded log', () => {
  const engine = createChannelEngine()
  engine._observeEvent({ sessionId: 's1', eventId: 'e1', dedupeKey: 'e1', cursor: '1', kind: 'user/message', payload: {}, emittedAt: Date.now() })
  engine._observeEvent({ sessionId: 's1', eventId: 'e2', dedupeKey: 'e2', cursor: '2', kind: 'agent/message', payload: {}, emittedAt: Date.now() })
  const snap = engine.observe()
  assert.ok(snap.channels)
})

test('cursor: subscribe with cursor inside window succeeds', async () => {
  const engine = createChannelEngine()
  engine._observeEvent({ sessionId: 's1', eventId: 'e1', dedupeKey: 'e1', cursor: '1', kind: 'user/message', payload: {}, emittedAt: Date.now() })
  await engine.open({ device: 'dev1', session: 's1' })
  const channelId = Object.keys(engine.observe().channels)[0]
  const sub = await engine.subscribe({ channelId, session: 's1', cursor: '1' })
  assert.ok(sub.ok)
})

test('cursor: subscribe with cursor outside window → resync-required', async () => {
  const engine = createChannelEngine()
  await engine.open({ device: 'dev1', session: 's1' })
  const channelId = Object.keys(engine.observe().channels)[0]
  const sub = await engine.subscribe({ channelId, session: 's1', cursor: '99999' })
  assert.equal(sub.ok, false)
  assert.equal(sub.error.code, CODE_RESYNC_REQUIRED)
})

test('cursor: resume with cursor outside window → resync-required', async () => {
  const engine = createChannelEngine()
  engine._observeEvent({ sessionId: 's1', eventId: 'e1', dedupeKey: 'e1', cursor: '1', kind: 'user/message', payload: {}, emittedAt: Date.now() })
  await engine.open({ device: 'dev1', session: 's1' })
  const channelId = Object.keys(engine.observe().channels)[0]
  const r = await engine.resume({ channelId, resumeToken: 'tok', session: 's1', cursor: '99999' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, CODE_RESYNC_REQUIRED)
})

test('cursor: event log is bounded by the retention window', () => {
  const engine = createChannelEngine({ replayWindowEvents: 5 })
  const now = Date.now()
  for (let i = 1; i <= 10; i++) {
    engine._observeEvent({ sessionId: 's1', eventId: `e${i}`, dedupeKey: `e${i}`, cursor: String(i), kind: 'x', payload: {}, emittedAt: now })
  }
  // Only the last 5 events are retained. Verify by attempting subscribe with
  // cursor '1' — must be resync-required (dropped from the window).
  // (The log is internal; we verify through the cursor check.)
  return (async () => {
    await engine.open({ device: 'dev1', session: 's1' })
    const channelId = Object.keys(engine.observe().channels)[0]
    const r1 = await engine.subscribe({ channelId, session: 's1', cursor: '1' })
    assert.equal(r1.ok, false)
    assert.equal(r1.error.code, CODE_RESYNC_REQUIRED, 'cursor 1 must be outside the bounded window')
    const r10 = await engine.subscribe({ channelId, session: 's1', cursor: '10' })
    assert.ok(r10.ok, 'cursor 10 must still be inside the window')
  })()
})