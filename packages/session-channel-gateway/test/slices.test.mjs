import test from 'node:test'
import assert from 'node:assert/strict'
import { createChannelRpcDispatch, createChannelRemoteNamespace, attachGatewaySlices } from '../lib/slices.js'
import { CONTRACT_SYMBOL, CODE_INTERNAL } from '../lib/shared-vocab.js'

test('channel RPC: isChannelMethod recognizes all five endpoints', () => {
  const rpc = createChannelRpcDispatch({ connection: { rpc: { handle() {} } } })
  assert.ok(rpc.isChannelMethod('sessionChannel/open'))
  assert.ok(rpc.isChannelMethod('sessionChannel/subscribe'))
  assert.ok(rpc.isChannelMethod('sessionChannel/ack'))
  assert.ok(rpc.isChannelMethod('sessionChannel/resume'))
  assert.ok(rpc.isChannelMethod('sessionChannel/revoke'))
  assert.ok(!rpc.isChannelMethod('session/other'))
  assert.ok(!rpc.isChannelMethod('api/settings'))
})

test('channel RPC: handle returns unavailable when facade absent', async () => {
  const rpc = createChannelRpcDispatch({ connection: { rpc: { handle() {} } }, facade: () => undefined })
  const result = await rpc.handle('sessionChannel/open', { args: {} })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'unavailable')
  assert.ok(rpc.active === false)
})

test('channel RPC: each endpoint is served by the published member that carries it', async () => {
  const seen = []
  const facade = {
    [CONTRACT_SYMBOL]: true,
    acquire: async (args, signal) => { seen.push(['acquire', args, signal]); return { ok: true, value: { channelId: 'test' } } },
    subscriptions: { acquire: async (args) => { seen.push(['subscriptions.acquire', args]); return { ok: true, value: { subscriptionId: 'sub-1' } } } },
    history: async (args) => { seen.push(['history', args]); return { ok: true, frames: [] } },
    heartbeat: async () => { seen.push(['heartbeat']); return { ok: true } },
    ack: async () => { seen.push(['ack']); return { ok: true } },
    resume: async () => { seen.push(['resume']); return { ok: true } },
    release: async () => { seen.push(['release']); return { ok: true } },
  }
  const rpc = createChannelRpcDispatch({ connection: { rpc: { handle() {} } }, facade: () => facade })
  const signal = { aborted: false }
  const opened = await rpc.handle('sessionChannel/open', { args: { device: 'dev1' } }, signal)
  assert.deepEqual(seen.at(-1), ['acquire', { device: 'dev1' }, signal], 'open is served by acquire, arguments and signal intact')
  assert.equal(opened.value.channelId, 'test')

  const subscribed = await rpc.handle('sessionChannel/subscribe', { args: { channelId: 'c1' } })
  assert.deepEqual(seen.at(-1), ['subscriptions.acquire', { channelId: 'c1' }], 'the wire subscribe is served by the published subscription acquisition member')
  assert.equal(subscribed.value.subscriptionId, 'sub-1')

  for (const [endpoint, member] of [
    ['sessionChannel/fetchEvents', 'history'],
    ['sessionChannel/heartbeat', 'heartbeat'],
    ['sessionChannel/ack', 'ack'],
    ['sessionChannel/resume', 'resume'],
    ['sessionChannel/revoke', 'release'],
  ]) {
    await rpc.handle(endpoint, { args: {} })
    assert.equal(seen.at(-1)[0], member, `${endpoint} is served by ${member}`)
  }
})

test('channel RPC: a facade without the member, and an unknown endpoint, answer typed', async () => {
  const bare = { [CONTRACT_SYMBOL]: true }
  const rpc = createChannelRpcDispatch({ connection: { rpc: { handle() {} } }, facade: () => bare })
  const missing = await rpc.handle('sessionChannel/open', { args: {} })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'unavailable')
  const unknown = await rpc.handle('sessionChannel/nope', { args: {} })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'invalid-input')
})

test('channel RPC: handle returns internal error on throw', async () => {
  const facade = {
    [CONTRACT_SYMBOL]: true,
    acquire: async () => { throw new Error('oops') },
  }
  const rpc = createChannelRpcDispatch({ connection: { rpc: { handle() {} } }, facade: () => facade })
  const result = await rpc.handle('sessionChannel/open', { args: {} })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, CODE_INTERNAL)
})

test('channel RPC: active depends on the facade publishing the capability members', () => {
  const rpc = createChannelRpcDispatch({ connection: { rpc: { handle() {} } }, facade: () => undefined })
  assert.ok(!rpc.active)
  const members = { acquire() {}, subscriptions: { acquire() {} }, history() {}, heartbeat() {}, ack() {}, resume() {}, release() {} }
  const rpc2 = createChannelRpcDispatch({
    connection: { rpc: { handle() {} } },
    facade: () => ({ [CONTRACT_SYMBOL]: true, ...members }),
  })
  assert.ok(rpc2.active)
  // A facade that carries the marker but not the members is not active: the
  // self-check never claims a capability the facade does not publish.
  const rpc3 = createChannelRpcDispatch({
    connection: { rpc: { handle() {} } },
    facade: () => ({ [CONTRACT_SYMBOL]: true, acquire() {} }),
  })
  assert.ok(!rpc3.active)
})

test('channel RPC: dispose is idempotent', () => {
  const rpc = createChannelRpcDispatch({ connection: { rpc: { handle() {} } } })
  assert.ok(rpc.dispose())
  assert.ok(rpc.dispose())
})

test('remote namespace: publish called when facade present', () => {
  let publishedKey, publishedService
  const publish = (key, service) => {
    publishedKey = key
    publishedService = service
    return () => {}
  }
  const asked = []
  const facade = {
    [CONTRACT_SYMBOL]: true,
    current(params) { asked.push(params); return { channels: {}, subscriptions: {} } },
    observe() {},
    onChange() {},
  }
  const remote = createChannelRemoteNamespace({ publish, facade: () => facade })
  assert.equal(publishedKey, 'sessionChannel')
  assert.ok(publishedService)
  assert.equal(typeof publishedService.observe, 'function')
  // The published snapshot member reads through the facade's one-shot reader,
  // not through its observation-handle factory.
  const snapshot = publishedService.observe({ limit: 1 })
  assert.deepEqual(asked, [{ limit: 1 }], 'the published member delegates to the snapshot reader')
  assert.deepEqual(snapshot, { channels: {}, subscriptions: {} })
})

test('remote namespace: no publish when publish function absent', () => {
  const remote = createChannelRemoteNamespace({ publish: undefined })
  assert.ok(remote.active === false)
})

test('remote namespace: observe returns unavailable when facade absent', () => {
  let publishedService
  const publish = (key, service) => { publishedService = service; return () => {} }
  createChannelRemoteNamespace({ publish, facade: () => undefined })
  const result = publishedService.observe({})
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'unavailable')
})

test('attachGatewaySlices: returns combined disposer', () => {
  const result = attachGatewaySlices({
    connection: { rpc: { handle() {} } },
    facade: () => undefined,
    publish: undefined,
  })
  assert.equal(typeof result.channelRpc, 'object')
  assert.equal(typeof result.channelRemote, 'object')
  assert.equal(typeof result.dispose, 'function')
  assert.ok(result.dispose())
})