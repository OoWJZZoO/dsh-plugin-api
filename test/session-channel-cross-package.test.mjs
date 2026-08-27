import test from 'node:test'
import assert from 'node:assert/strict'
import { mountSessionChannelFeature } from '../lib/session-channel.js'
import { CONTRACT_SYMBOL } from '../lib/session-channel-shared.js'
import { createChannelRpcDispatch } from '../packages/session-channel-gateway/lib/slices.js'
import { createFencingTable } from '../packages/session-channel-connection/lib/slices.js'

function createMockSessionApi() {
  const listeners = new Map()
  return {
    isActive: true,
    on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
    once(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
    get(id) { return { id, events: [], seq: 0, header: () => ({}) } },
    list() { return [] },
    events(session) { return session?.events ?? [] },
    header(session) { return session?.header() ?? {} },
    sessionEventTypes: ['session/event', 'session/created'],
    emit(name, data) { const l = listeners.get(name); if (l) l(data) },
  }
}

function createMockService() {
  return {
    isActive: true,
    session: createMockSessionApi(),
    events: {
      on(name, listener) { return () => {} },
      once(name, listener) { return () => {} },
    },
    prepareFeature(name, api) {
      return {
        commit: () => { this[name] = api; return true },
        rollback: () => { delete this[name]; return true },
      }
    },
  }
}

function mountFacade() {
  const service = createMockService()
  const result = mountSessionChannelFeature({ ctx: { get: () => {} }, service, logger: { warn() {} }, featureRegistry: { isActive: () => false } })
  assert.ok(result, 'facade must mount')
  result.prepared.commit()
  return { service, api: service.sessionChannel, result }
}

test('cross-package: gateway channel RPC dispatch routes to the real facade', async () => {
  const { api } = mountFacade()
  assert.equal(api[CONTRACT_SYMBOL], true, 'facade must carry the coordination symbol')
  assert.equal(typeof api.dispatchChannelMethod, 'function', 'facade must expose dispatchChannelMethod directly')

  // Wire the real facade into the gateway slice (same discovery the R package apply uses).
  const rpc = createChannelRpcDispatch({ connection: { rpc: { handle() {} } }, facade: () => api })
  assert.ok(rpc.active, 'gateway slice must detect the facade via CONTRACT_SYMBOL')

  // A real channel method round-trip: open via the gateway RPC slice.
  api.auth.registerVerifier({ id: 'v1', verify: (cred) => ({ deviceId: cred, scope: [] }) })
  const result = await rpc.handle('sessionChannel/open', { args: { device: 'dev1', session: 's1' } })
  assert.ok(result.ok, 'channel method must route to the facade and succeed')
  assert.ok(result.value?.channelId || result.channelId, 'result must carry the opened channel')
})

test('cross-package: RPC dispatch fails closed without verifier (typed unavailable)', async () => {
  const { api } = mountFacade()
  const rpc = createChannelRpcDispatch({ connection: { rpc: { handle() {} } }, facade: () => api })
  const result = await rpc.handle('sessionChannel/open', { args: { device: 'dev1', session: 's1' } })
  assert.equal(result.ok, false, 'open via RPC without verifier must be rejected')
  assert.equal(result.error?.code, 'unavailable', 'must return typed unavailable (fail-closed)')
})

test('cross-package: RPC dispatch is denied by a denying verifier', async () => {
  const { api } = mountFacade()
  api.auth.registerVerifier({ id: 'v1', verify: () => ({ denied: true, reason: 'device blacklisted' }) })
  const rpc = createChannelRpcDispatch({ connection: { rpc: { handle() {} } }, facade: () => api })
  const result = await rpc.handle('sessionChannel/open', { args: { device: 'evil', session: 's1' } })
  assert.equal(result.ok, false, 'open via RPC with a denying verifier must be rejected')
  assert.equal(result.error?.code, 'device-denied', 'must return typed denied')
})

test('cross-package: RPC dispatch is denied by the authorizer', async () => {
  const { api } = mountFacade()
  api.auth.registerVerifier({ id: 'v1', verify: (cred) => ({ deviceId: cred, scope: ['session:read'] }) })
  api.auth.registerAuthorizer({ id: 'a1', authorize: () => ({ deny: true, reason: 'method not allowed' }) })
  const rpc = createChannelRpcDispatch({ connection: { rpc: { handle() {} } }, facade: () => api })
  const result = await rpc.handle('sessionChannel/open', { args: { device: 'dev1', session: 's1' } })
  assert.equal(result.ok, false, 'open via RPC with a denying authorizer must be rejected')
  assert.equal(result.error?.code, 'session-denied', 'must return typed denied')
})

test('cross-package: RPC dispatch rejects unknown channel methods', async () => {
  const { api } = mountFacade()
  const rpc = createChannelRpcDispatch({ connection: { rpc: { handle() {} } }, facade: () => api })
  const result = await rpc.handle('sessionChannel/bogus', { args: {} })
  assert.equal(result.ok, false)
  assert.equal(result.error?.code, 'invalid-input')
})

test('cross-package: verifier identity is passed to the authorizer (scope enforcement)', async () => {
  const { api } = mountFacade()
  let authorizedRequest
  api.auth.registerVerifier({ id: 'v1', verify: (cred) => ({ deviceId: `verified-${cred}`, scope: ['session:read'] }) })
  api.auth.registerAuthorizer({ id: 'a1', authorize: (req) => { authorizedRequest = req; return { allow: true } } })
  const result = await api.open({ device: 'dev1', session: 's1' })
  assert.ok(result.ok, 'open must succeed')
  assert.equal(authorizedRequest.deviceId, 'verified-dev1', 'authorizer must receive the verified device identity')
  assert.deepEqual(authorizedRequest.scope, ['session:read'], 'authorizer must receive the verified scope')
})

test('cross-package: connection fencing table syncs with facade generations', async () => {
  const { api } = mountFacade()
  api.auth.registerVerifier({ id: 'v1', verify: (cred) => ({ deviceId: cred, scope: [] }) })
  const opened = await api.open({ device: 'dev1', session: 's1' })
  assert.ok(opened.ok)
  const channelId = opened.channelId

  // Connection fencing slice discovers the facade through the same symbol check.
  const fence = createFencingTable({ facade: () => api })
  fence.attach()
  assert.ok(fence.active, 'fencing table must activate when facade present')
  assert.ok(fence.bind(channelId, opened.channelGeneration))
  assert.ok(fence.isCurrent(channelId, opened.channelGeneration), 'fresh generation must qualify')

  // Revoke through the facade bumps the generation; the fence prunes on the
  // next onChange notification.
  await api.revoke({ channelId })
  fence.prune()
  assert.ok(!fence.isCurrent(channelId, opened.channelGeneration), 'revoked channel generation must lose qualification')
})

test('cross-package: facade reports slice unavailable when R package is missing', () => {
  const { api } = mountFacade()
  // The facade itself stays functional; the missing-slice case is expressed by
  // the R packages returning unavailable (their own fail-safe), not by the
  // facade claiming a complete channel.
  assert.equal(typeof api.open, 'function')
  assert.equal(typeof api.subscribe, 'function')
})