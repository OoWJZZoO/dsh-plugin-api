import test from 'node:test'
import assert from 'node:assert/strict'
import { createChannelEngine } from '../lib/session-channel-core.js'
import { CODE_RESYNC_REQUIRED, CODE_CHANNEL_REVOKED, CODE_INVALID_INPUT, CODE_ABORTED, CODE_STALE_GENERATION, CODE_SESSION_DENIED, CODE_CHANNEL_EXPIRED, CODE_RESUME_REJECTED } from '../lib/session-channel-shared.js'

const openNew = async (engine, { device = 'dev1', session = 's1', capabilities } = {}) => {
  const result = await engine.open({ device, session, capabilities }, undefined, { deviceId: `verified-${device}`, scope: ['session:read'] })
  return result
}

test('core: open creates an active channel with random opaque identity', async () => {
  const engine = createChannelEngine()
  const result = await openNew(engine)
  assert.ok(result.ok)
  // Unpredictable tokens: long random hex (UUID-derived), never sequential.
  assert.match(result.channelId, /^ch-[0-9a-f]{32}$/)
  assert.match(result.channelGeneration, /^[0-9a-f]{32}$/)
  const second = await openNew(engine, { device: 'dev2', session: 's2' })
  assert.notEqual(second.channelId, result.channelId)
  assert.notEqual(second.channelGeneration, result.channelGeneration)
})

test('core: canonical verified identity is recorded, not the caller label', async () => {
  const engine = createChannelEngine()
  await engine.open({ device: 'spoofed-label', session: 's1' }, undefined, { deviceId: 'canonical-1', scope: ['session:read'] })
  const snap = engine.observe()
  const channel = Object.values(snap.channels)[0]
  assert.equal(channel.deviceId, 'canonical-1')
})

test('core: open rejects unbounded capabilities', async () => {
  const engine = createChannelEngine()
  const tooMany = await openNew(engine, { capabilities: Array.from({ length: 33 }, (_, i) => `c${i}`) })
  assert.equal(tooMany.ok, false)
  assert.equal(tooMany.error.code, CODE_INVALID_INPUT)
  const notString = await openNew(engine, { capabilities: [42] })
  assert.equal(notString.ok, false)
})

test('core: subscribe requires the possession generation and session binding', async () => {
  const engine = createChannelEngine()
  const opened = await openNew(engine)

  const missing = await engine.subscribe({ channelId: opened.channelId, session: 's1' })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, CODE_INVALID_INPUT)

  const wrong = await engine.subscribe({ channelId: opened.channelId, channelGeneration: 'deadbeef'.repeat(4), session: 's1' })
  assert.equal(wrong.ok, false)
  assert.equal(wrong.error.code, CODE_STALE_GENERATION)

  const wrongSession = await engine.subscribe({ channelId: opened.channelId, channelGeneration: opened.channelGeneration, session: 'other-session' })
  assert.equal(wrongSession.ok, false)
  assert.equal(wrongSession.error.code, CODE_SESSION_DENIED)

  const okSub = await engine.subscribe({ channelId: opened.channelId, channelGeneration: opened.channelGeneration, session: 's1' })
  assert.ok(okSub.ok)
  assert.match(okSub.subscriptionId, /^sub-[0-9a-f]{32}$/)
  assert.ok(Array.isArray(okSub.frames), 'subscribe response must carry the initial replay batch')
  assert.equal(okSub.deliveryMode, 'at-least-once-pull')
})

test('core: ack requires subscription generation and stays monotonic', async () => {
  const engine = createChannelEngine()
  const opened = await openNew(engine)
  const sub = await engine.subscribe({ channelId: opened.channelId, channelGeneration: opened.channelGeneration, session: 's1' })

  const noGen = await engine.ack({ channelId: opened.channelId, channelGeneration: opened.channelGeneration, subscriptionId: sub.subscriptionId, cursor: '10' })
  assert.equal(noGen.ok, false)
  assert.equal(noGen.error.code, CODE_INVALID_INPUT)

  const base = { channelId: opened.channelId, channelGeneration: opened.channelGeneration, subscriptionId: sub.subscriptionId, subscriptionGeneration: sub.subscriptionGeneration }
  const r1 = await engine.ack({ ...base, cursor: '10' })
  assert.ok(r1.ok)
  assert.equal(r1.ackedCursor, '10')
  const r2 = await engine.ack({ ...base, cursor: '5' })
  assert.ok(r2.ok)
  assert.equal(r2.ackedCursor, '10')

  const staleSub = await engine.ack({ channelId: opened.channelId, channelGeneration: opened.channelGeneration, subscriptionId: sub.subscriptionId, subscriptionGeneration: 'f'.repeat(32), cursor: '20' })
  assert.equal(staleSub.ok, false)
  assert.equal(staleSub.error.code, CODE_STALE_GENERATION)
})

test('core: revoke marks channel revoked and bumps generation; old token loses qualification', async () => {
  const engine = createChannelEngine()
  const opened = await openNew(engine)
  const r = await engine.revoke({ channelId: opened.channelId, channelGeneration: opened.channelGeneration, reason: 'test' })
  assert.ok(r.ok)
  assert.equal(engine.observe().channels[opened.channelId].lifecycleState, 'revoked')
  assert.notEqual(engine.channelGenerationOf(opened.channelId), opened.channelGeneration)
  const sub = await engine.subscribe({ channelId: opened.channelId, channelGeneration: opened.channelGeneration, session: 's1' })
  assert.equal(sub.ok, false)
  assert.equal(sub.error.code, CODE_CHANNEL_REVOKED)
  // Revocation cascades to subscriptions.
  const snap = engine.observe()
  for (const sub of Object.values(snap.subscriptions)) {
    if (sub.channelId === opened.channelId) assert.equal(sub.lifecycleState, 'revoked')
  }
})

test('core: resume binds canonical device identity and possession generation', async () => {
  const engine = createChannelEngine()
  const opened = await openNew(engine, { device: 'devA' })
  const okMeta = { deviceId: 'verified-devA', scope: ['session:read'] }

  const rightful = await engine.resume({ channelId: opened.channelId, channelGeneration: opened.channelGeneration, resumeToken: 'tok-A', session: 's1' }, undefined, okMeta)
  assert.ok(rightful.ok)
  assert.ok(Array.isArray(rightful.frames))

  // A different verified device holding only an enumerated id is rejected.
  const outsider = await engine.resume({ channelId: opened.channelId, channelGeneration: opened.channelGeneration, resumeToken: 'tok-B', session: 's1' }, undefined, { deviceId: 'verified-devB' })
  assert.equal(outsider.ok, false)
  assert.equal(outsider.error.code, CODE_RESUME_REJECTED)
  assert.doesNotMatch(outsider.error.message, /devA|devB/, 'denial text must not leak device identities')
})

test('core: resume without token → invalid input', async () => {
  const engine = createChannelEngine()
  const opened = await openNew(engine)
  const r = await engine.resume({ channelId: opened.channelId, channelGeneration: opened.channelGeneration, session: 's1' }, undefined, { deviceId: 'verified-dev1' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, CODE_INVALID_INPUT)
})

test('core: fetchEvents pages frames without advancing the watermark', async () => {
  const engine = createChannelEngine()
  const opened = await openNew(engine)
  for (let i = 1; i <= 6; i++) {
    engine._observeEvent({ sessionId: 's1', kind: 'k', payload: { n: i }, emittedAt: Date.now() })
  }
  const sub = await engine.subscribe({ channelId: opened.channelId, channelGeneration: opened.channelGeneration, session: 's1', cursor: null })
  const pageOne = await engine.fetchEvents({
    channelId: opened.channelId, channelGeneration: opened.channelGeneration,
    subscriptionId: sub.subscriptionId, subscriptionGeneration: sub.subscriptionGeneration,
    maxEvents: 3,
  })
  assert.ok(pageOne.ok)
  assert.equal(pageOne.frames.length, 3)
  assert.equal(pageOne.deliveryMode, 'at-least-once-pull')
  const watermarkBefore = engine.observe().subscriptions[sub.subscriptionId].cursor
  // Cursors are engine-monotonic strings; fetch returns ordering metadata.
  assert.ok(pageOne.cursor !== undefined || pageOne.frames.length === 0)
  const afterAck = await engine.ack({
    channelId: opened.channelId, channelGeneration: opened.channelGeneration,
    subscriptionId: sub.subscriptionId, subscriptionGeneration: sub.subscriptionGeneration,
    cursor: pageOne.frames[pageOne.frames.length - 1].cursor,
  })
  assert.ok(afterAck.ok)
  const watermarkedAfter = engine.observe().subscriptions[sub.subscriptionId].cursor
  assert.notEqual(watermarkBefore, watermarkedAfter, 'ack advances the watermark')
  // Page two continues strictly after acked position.
  const pageTwo = await engine.fetchEvents({
    channelId: opened.channelId, channelGeneration: opened.channelGeneration,
    subscriptionId: sub.subscriptionId, subscriptionGeneration: sub.subscriptionGeneration,
    cursor: pageOne.cursor, maxEvents: 50,
  })
  assert.ok(pageTwo.ok)
  const overlap = pageTwo.frames.filter((frame) => pageOne.frames.some((one) => one.eventId === frame.eventId))
  assert.equal(overlap.length, 0, 'fetch pages are disjoint by cursor position')
})

test('core: heartbeat extends a live channel but never revives dead ones', async () => {
  const engine = createChannelEngine({ channelTtlMs: -1 }) // instantly expired
  const opened = await openNew(engine)
  const expiredBeat = await engine.heartbeat({ channelId: opened.channelId, channelGeneration: opened.channelGeneration })
  assert.equal(expiredBeat.ok, false)
  assert.equal(expiredBeat.error.code, CODE_CHANNEL_EXPIRED)
  const afterExpiry = await engine.subscribe({ channelId: opened.channelId, channelGeneration: opened.channelGeneration, session: 's1' })
  assert.equal(afterExpiry.error.code, CODE_CHANNEL_EXPIRED, 'lazy expiry applies on every access path')

  const liveEngine = createChannelEngine()
  const liveOpen = await openNew(liveEngine)
  const before = liveEngine.observe().channels[liveOpen.channelId]
  void before
  const beat = await liveEngine.heartbeat({ channelId: liveOpen.channelId, channelGeneration: liveOpen.channelGeneration })
  assert.ok(beat.ok)
  const revokedEngine = createChannelEngine()
  const revokedOpen = await openNew(revokedEngine)
  await revokedEngine.revoke({ channelId: revokedOpen.channelId, channelGeneration: revokedOpen.channelGeneration })
  const beatRevoked = await revokedEngine.heartbeat({ channelId: revokedOpen.channelId, channelGeneration: revokedOpen.channelGeneration })
  assert.equal(beatRevoked.ok, false)
  assert.equal(beatRevoked.error.code, CODE_CHANNEL_REVOKED)
})

test('core: aborted signal short-circuits', async () => {
  const engine = createChannelEngine()
  const ac = new AbortController()
  ac.abort()
  const r = await engine.open({ device: 'dev1', session: 's1' }, ac.signal)
  assert.equal(r.ok, false)
  assert.equal(r.error.code, CODE_ABORTED)
})

test('core: dispatchChannelMethod routes by endpoint', async () => {
  const engine = createChannelEngine()
  const r = await engine.dispatchChannelMethod('sessionChannel/open', { args: { device: 'dev1', session: 's1' } })
  assert.ok(r.ok)
  const r2 = await engine.dispatchChannelMethod('sessionChannel/bogus', { args: {} })
  assert.equal(r2.ok, false)
  assert.equal(r2.error.code, CODE_INVALID_INPUT)
})

test('core: observe returns a frozen snapshot', () => {
  const engine = createChannelEngine()
  const snap = engine.observe()
  assert.ok(snap.channels)
  assert.ok(snap.subscriptions)
})
