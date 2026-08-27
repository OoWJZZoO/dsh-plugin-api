import test from 'node:test'
import assert from 'node:assert/strict'
import { createChannelEngine } from '../lib/session-channel-core.js'
import { CODE_RESYNC_REQUIRED } from '../lib/session-channel-shared.js'

const openNew = async (engine, session = 's1') => {
  const opened = await engine.open({ device: 'dev1', session }, undefined, { deviceId: 'verified-dev1', scope: [] })
  return opened
}

test('cursor: session events are retained in the bounded log', () => {
  const engine = createChannelEngine()
  engine._observeEvent({ sessionId: 's1', eventId: 'e1', dedupeKey: 'e1', cursor: '1', kind: 'user/message', payload: {}, emittedAt: Date.now() })
  engine._observeEvent({ sessionId: 's1', eventId: 'e2', dedupeKey: 'e2', cursor: '2', kind: 'agent/message', payload: {}, emittedAt: Date.now() })
  const snap = engine.observe()
  assert.ok(snap.channels)
})

test('cursor: fallback ids/dedupe/cursor come from a monotonic sequence, never the clock', async () => {
  const engine = createChannelEngine()
  const now = Date.now()
  for (let i = 0; i < 12; i++) {
    // No eventId and no cursor supplied → the engine mints its own stable
    // sequence values instead of colliding wall-clock fallbacks.
    engine._observeEvent({ sessionId: 's1', kind: 'x', payload: { n: i }, emittedAt: now })
  }
  const opened = await openNew(engine)
  const sub = await engine.subscribe({
    channelId: opened.channelId, channelGeneration: opened.channelGeneration, session: 's1',
  })
  assert.ok(sub.ok)
  assert.equal(sub.frames.length, 12)
  const cursors = new Set(sub.frames.map((f) => f.cursor))
  const dedupes = new Set(sub.frames.map((f) => f.dedupeKey))
  const events = new Set(sub.frames.map((f) => f.eventId))
  assert.equal(cursors.size, 12, 'every frame has a distinct cursor position')
  assert.equal(dedupes.size, 12, 'same-millisecond fallback events must not share a dedupe key')
  assert.equal(events.size, 12)
})

test('cursor: subscribe with cursor inside window succeeds and returns frames after it', async () => {
  const engine = createChannelEngine()
  engine._observeEvent({ sessionId: 's1', eventId: 'e1', dedupeKey: 'e1', cursor: '1', kind: 'user/message', payload: {}, emittedAt: Date.now() })
  const opened = await openNew(engine)
  const sub = await engine.subscribe({ channelId: opened.channelId, channelGeneration: opened.channelGeneration, session: 's1', cursor: '1' })
  assert.ok(sub.ok)
  // No further events were captured after cursor 1 — empty initial batch is valid.
  assert.ok(Array.isArray(sub.frames))
})

test('cursor: subscribe with cursor outside window → resync-required', async () => {
  const engine = createChannelEngine()
  await openNew(engine)
  const channelId = Object.keys(engine.observe().channels)[0]
  const generation = engine.channelGenerationOf(channelId)
  const sub = await engine.subscribe({ channelId, channelGeneration: generation, session: 's1', cursor: '99999' })
  assert.equal(sub.ok, false)
  assert.equal(sub.error.code, CODE_RESYNC_REQUIRED)
})

test('cursor: resume replays frames within the retained window and resyncs outside it', async () => {
  const engine = createChannelEngine()
  for (let i = 1; i <= 5; i++) {
    engine._observeEvent({ sessionId: 's1', eventId: `e${i}`, dedupeKey: `e${i}`, cursor: String(i), kind: 'x', payload: { n: i }, emittedAt: Date.now() })
  }
  const opened = await openNew(engine)
  const meta = { deviceId: 'verified-dev1', scope: [] }
  const ok = await engine.resume(
    { channelId: opened.channelId, channelGeneration: opened.channelGeneration, resumeToken: 'tok', session: 's1', cursor: '2' },
    undefined, meta,
  )
  assert.ok(ok.ok)
  assert.equal(ok.frames.length, 3, 'frames strictly after cursor 2')
  assert.deepEqual(ok.frames.map((f) => f.cursor), ['3', '4', '5'])
  const gap = await engine.resume(
    { channelId: opened.channelId, channelGeneration: opened.channelGeneration, resumeToken: 'tok', session: 's1', cursor: '99999' },
    undefined, meta,
  )
  assert.equal(gap.ok, false)
  assert.equal(gap.error.code, CODE_RESYNC_REQUIRED, 'resume must not silently skip a gap')
})

test('cursor: event log is bounded by the retention window', async () => {
  const engine = createChannelEngine({ replayWindowEvents: 5 })
  const now = Date.now()
  for (let i = 1; i <= 10; i++) {
    engine._observeEvent({ sessionId: 's1', eventId: `e${i}`, dedupeKey: `e${i}`, cursor: String(i), kind: 'x', payload: {}, emittedAt: now })
  }
  const opened = await openNew(engine)
  const generation = engine.channelGenerationOf(opened.channelId)
  const r1 = await engine.subscribe({ channelId: opened.channelId, channelGeneration: generation, session: 's1', cursor: '1' })
  assert.equal(r1.ok, false)
  assert.equal(r1.error.code, CODE_RESYNC_REQUIRED, 'cursor 1 must be outside the bounded window')
  const r10 = await engine.subscribe({ channelId: opened.channelId, channelGeneration: generation, session: 's1', cursor: '10' })
  assert.ok(r10.ok, 'cursor 10 must still be inside the window')
})
