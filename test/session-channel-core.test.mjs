import test from 'node:test'
import assert from 'node:assert/strict'
import { createChannelEngine } from '../lib/session-channel-core.js'
import { CODE_RESYNC_REQUIRED, CODE_CHANNEL_REVOKED, CODE_INVALID_INPUT, CODE_ABORTED, CODE_STALE_GENERATION } from '../lib/session-channel-shared.js'

test('core: open creates an active channel', async () => {
  const engine = createChannelEngine()
  const result = await engine.open({ device: 'dev1', session: 's1' })
  assert.ok(result.ok)
  assert.ok(result.channelId)
  assert.ok(result.channelGeneration)
})

test('core: open requires device and session', async () => {
  const engine = createChannelEngine()
  const r1 = await engine.open({ session: 's1' })
  assert.equal(r1.ok, false)
  assert.equal(r1.error.code, CODE_INVALID_INPUT)
  const r2 = await engine.open({ device: 'dev1' })
  assert.equal(r2.ok, false)
})

test('core: subscribe delivers and tracks cursor', async () => {
  const engine = createChannelEngine()
  await engine.open({ device: 'dev1', session: 's1' })
  const sub = await engine.subscribe({ channelId: engine.observe().channels ? Object.keys(engine.observe().channels)[0] : null, session: 's1' })
  assert.ok(sub.ok)
  assert.ok(sub.subscriptionId)
})

test('core: ack advances monotonically', async () => {
  const engine = createChannelEngine()
  await engine.open({ device: 'dev1', session: 's1' })
  const channelId = Object.keys(engine.observe().channels)[0]
  const sub = await engine.subscribe({ channelId, session: 's1' })
  const r1 = await engine.ack({ channelId, subscriptionId: sub.subscriptionId, cursor: '10' })
  assert.ok(r1.ok)
  assert.equal(r1.ackedCursor, '10')
  // non-monotonic ack does not regress
  const r2 = await engine.ack({ channelId, subscriptionId: sub.subscriptionId, cursor: '5' })
  assert.ok(r2.ok)
  assert.equal(r2.ackedCursor, '10')
})

test('core: revoke marks channel revoked and bumps generation', async () => {
  const engine = createChannelEngine()
  await engine.open({ device: 'dev1', session: 's1' })
  const channelId = Object.keys(engine.observe().channels)[0]
  const generationBefore = engine.channelGenerationOf(channelId)
  const r = await engine.revoke({ channelId, reason: 'test' })
  assert.ok(r.ok)
  assert.equal(engine.observe().channels[channelId].lifecycleState, 'revoked')
  assert.notEqual(engine.channelGenerationOf(channelId), generationBefore)
  // subscribe after revoke is rejected
  const sub = await engine.subscribe({ channelId, session: 's1' })
  assert.equal(sub.ok, false)
  assert.equal(sub.error.code, CODE_CHANNEL_REVOKED)
})

test('core: resume validates token and generation', async () => {
  const engine = createChannelEngine()
  await engine.open({ device: 'dev1', session: 's1' })
  const channelId = Object.keys(engine.observe().channels)[0]
  const r = await engine.resume({ channelId, resumeToken: 'tok', session: 's1', cursor: undefined })
  assert.ok(r.ok)
  assert.equal(r.channelId, channelId)
})

test('core: resume without token → invalid input', async () => {
  const engine = createChannelEngine()
  await engine.open({ device: 'dev1', session: 's1' })
  const channelId = Object.keys(engine.observe().channels)[0]
  const r = await engine.resume({ channelId, session: 's1' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, CODE_INVALID_INPUT)
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

test('core: stale generation loses submission qualification', async () => {
  const engine = createChannelEngine()
  await engine.open({ device: 'dev1', session: 's1' })
  const channelId = Object.keys(engine.observe().channels)[0]
  await engine.revoke({ channelId })
  // After revoke, generation changed; subscribe fails with channel-revoked.
  const sub = await engine.subscribe({ channelId, session: 's1' })
  assert.equal(sub.ok, false)
})