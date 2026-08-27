import test from 'node:test'
import assert from 'node:assert/strict'
import { createChannelProjection } from '../lib/session-channel-project.js'
import { createChannelEngine } from '../lib/session-channel-core.js'

test('projection: observe returns a deep-frozen snapshot', async () => {
  const engine = createChannelEngine()
  const projection = createChannelProjection(engine)
  await engine.open({ device: 'dev1', session: 's1' })
  const snap = projection.observe({})
  assert.ok(Object.isFrozen(snap), 'top-level snapshot must be frozen')
  assert.ok(Object.isFrozen(snap.channels), 'channels map must be frozen')
  const channelId = Object.keys(snap.channels)[0]
  assert.ok(Object.isFrozen(snap.channels[channelId]), 'channel record must be frozen')
  assert.ok(Object.isFrozen(snap.subscriptions), 'subscriptions map must be frozen')
  assert.throws(() => { snap.channels[channelId].lifecycleState = 'hacked' }, TypeError, 'frozen snapshot must reject mutation')
})

test('projection: observe never mutates channel state', async () => {
  const engine = createChannelEngine()
  const projection = createChannelProjection(engine)
  await engine.open({ device: 'dev1', session: 's1' })
  const before = projection.observe({})
  const after = projection.observe({})
  assert.deepEqual(before, after, 'repeated observe must not change state')
})

test('projection: onChange notifies listeners on state change', async () => {
  const engine = createChannelEngine()
  const projection = createChannelProjection(engine)
  let notified = 0
  const disposer = projection.onChange(() => { notified += 1 })
  await engine.open({ device: 'dev1', session: 's1' })
  assert.ok(notified >= 1, 'listener must be notified after open')
  assert.equal(typeof disposer, 'function')
})

test('projection: disposer removes the listener', async () => {
  const engine = createChannelEngine()
  const projection = createChannelProjection(engine)
  let notified = 0
  const disposer = projection.onChange(() => { notified += 1 })
  disposer()
  await engine.open({ device: 'dev1', session: 's1' })
  assert.equal(notified, 0, 'disposed listener must not be notified')
})

test('projection: listener exceptions are isolated', async () => {
  const engine = createChannelEngine()
  const projection = createChannelProjection(engine)
  projection.onChange(() => { throw new Error('listener boom') })
  assert.doesNotThrow(async () => {
    await engine.open({ device: 'dev1', session: 's1' })
  }, 'a throwing listener must not break engine notifications')
})