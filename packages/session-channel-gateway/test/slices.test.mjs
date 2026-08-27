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

test('channel RPC: handle dispatches to facade when present', async () => {
  let called = false
  const facade = {
    [CONTRACT_SYMBOL]: true,
    dispatchChannelMethod: async (endpoint, payload, signal) => {
      called = true
      assert.equal(endpoint, 'sessionChannel/open')
      return { ok: true, value: { channelId: 'test' } }
    },
  }
  const rpc = createChannelRpcDispatch({ connection: { rpc: { handle() {} } }, facade: () => facade })
  const result = await rpc.handle('sessionChannel/open', { args: { device: 'dev1' } })
  assert.ok(called, 'facade dispatchChannelMethod must be called')
  assert.ok(result.ok)
  assert.equal(result.value.channelId, 'test')
})

test('channel RPC: handle returns internal error on throw', async () => {
  const facade = {
    [CONTRACT_SYMBOL]: true,
    dispatchChannelMethod: async () => { throw new Error('oops') },
  }
  const rpc = createChannelRpcDispatch({ connection: { rpc: { handle() {} } }, facade: () => facade })
  const result = await rpc.handle('sessionChannel/open', { args: {} })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, CODE_INTERNAL)
})

test('channel RPC: active depends on facade presence', () => {
  const rpc = createChannelRpcDispatch({ connection: { rpc: { handle() {} } }, facade: () => undefined })
  assert.ok(!rpc.active)
  const rpc2 = createChannelRpcDispatch({
    connection: { rpc: { handle() {} } },
    facade: () => ({ [CONTRACT_SYMBOL]: true, dispatchChannelMethod() {} }),
  })
  assert.ok(rpc2.active)
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
  const facade = { [CONTRACT_SYMBOL]: true, observe() {}, onChange() {} }
  const remote = createChannelRemoteNamespace({ publish, facade: () => facade })
  assert.equal(publishedKey, 'sessionChannel')
  assert.ok(publishedService)
  assert.equal(typeof publishedService.observe, 'function')
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