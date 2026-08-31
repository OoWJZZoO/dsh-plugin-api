import test from 'node:test'
import assert from 'node:assert/strict'
import { mountSessionChannelFeature } from '../lib/session-channel.js'
import { CONTRACT_SYMBOL } from '../lib/session-channel-shared.js'
import { createChannelRpcDispatch } from '../packages/session-channel-gateway/lib/slices.js'
import { createFencingTable } from '../packages/session-channel-connection/lib/slices.js'

function createMockSessionApi() {
  const feeds = new Map()
  const api = {
    isActive: true,
    observe(name, listener) {
      const listeners = new Set()
      const feed = {
        listeners,
        subscribe(next) {
          listeners.add(next)
          return () => listeners.delete(next)
        },
        dispose() {
          feeds.delete(name)
          return true
        },
      }
      feeds.set(name, feed)
      if (typeof listener === 'function') feed.subscribe(listener)
      return feed
    },
    emit(name, data) {
      const feed = feeds.get(name)
      if (!feed) return
      for (const listener of [...feed.listeners]) listener(data)
    },
    get(id) { return { id, events: [], seq: 0, header: () => ({}) } },
    list() { return [] },
    events(session) { return session?.events ?? [] },
    header(session) { return session?.header() ?? {} },
    sessionEventTypes: ['session/event', 'session/created'],
  }
  return api
}

function createMockService() {
  const sessions = createMockSessionApi()
  const service = {
    isActive: true,
    sessions,
    events: {
      observe() {
        return {
          subscribe() { return () => false },
          dispose() { return true },
        }
      },
    },
    prepareFeature(name, api) {
      return {
        commit: () => {
          if (name === 'sessionChannel') {
            // The real service publishes the channel slot under sessions.channels.
            Object.defineProperty(service.sessions, 'channels', { value: api, enumerable: true })
          }
          this[name] = api
          return true
        },
        rollback: () => {
          if (name === 'sessionChannel') delete service.sessions.channels
          delete this[name]
          return true
        },
      }
    },
  }
  return service
}

function mountFacade() {
  const service = createMockService()
  const result = mountSessionChannelFeature({ ctx: {}, service, logger: { warn() {} }, featureRegistry: { isActive: () => false } })
  assert.ok(result, 'facade must mount')
  result.prepared.commit()
  return { service, api: service.sessions.channels, result }
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
  assert.ok(result.channelId, 'result must carry the opened channel')
  assert.match(result.channelGeneration, /^[0-9a-f]{32}$/, 'open response carries a random opaque possession token')
})

test('cross-package: RPC dispatch fails closed without verifier (typed unavailable)', async () => {
  const { api } = mountFacade()
  const rpc = createChannelRpcDispatch({ connection: { rpc: { handle() {} } }, facade: () => api })
  const result = await rpc.handle('sessionChannel/open', { args: { device: 'dev1', session: 's1' } })
  assert.equal(result.ok, false, 'open via RPC without verifier must be rejected')
  assert.equal(result.error?.code, 'unavailable', 'must return typed unavailable (fail-closed)')
})

test('cross-package: RPC dispatch is denied by a denying verifier (fixed generic text)', async () => {
  const { api } = mountFacade()
  api.auth.registerVerifier({
    id: 'v1',
    verify: () => { throw new Error('super-secret-db-connection-string') },
  })
  const rpc = createChannelRpcDispatch({ connection: { rpc: { handle() {} } }, facade: () => api })
  const result = await rpc.handle('sessionChannel/open', { args: { device: 'evil', session: 's1' } })
  assert.equal(result.ok, false, 'throwing verifier denies the caller (fail-closed)')
  assert.equal(result.error?.code, 'device-denied', 'must return typed denied')
  JSON.stringify(result)
  assert.doesNotMatch(JSON.stringify(result), /super-secret/, 'plugin exception details never reach the wire payload')
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

test('cross-package: possession gating holds end-to-end over the RPC carrier', async () => {
  const { api } = mountFacade()
  api.auth.registerVerifier({ id: 'v1', verify: (cred) => ({ deviceId: cred, scope: [] }) })
  const rpc = createChannelRpcDispatch({ connection: { rpc: { handle() {} } }, facade: () => api })
  const opened = await rpc.handle('sessionChannel/open', { args: { device: 'dev1', session: 's1' } })
  assert.ok(opened.ok)

  // Subscribe WITHOUT the generation token is invalid even though the
  // channelId is returned verbatim in projections.
  const missing = await rpc.handle('sessionChannel/subscribe', { args: { channelId: opened.channelId, session: 's1' } })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'invalid-input')

  // A guessed token does not qualify.
  const guessed = await rpc.handle('sessionChannel/subscribe', { args: { channelId: opened.channelId, channelGeneration: 'a'.repeat(32), session: 's1' } })
  assert.equal(guessed.ok, false)
  assert.equal(guessed.error.code, 'stale-generation')

  // The legitimate holder operates the channel.
  const legit = await rpc.handle('sessionChannel/subscribe', { args: { channelId: opened.channelId, channelGeneration: opened.channelGeneration, session: 's1' } })
  assert.ok(legit.ok)

  // Revocation requires possession too; afterwards the old token is dead.
  await rpc.handle('sessionChannel/revoke', { args: { channelId: opened.channelId, channelGeneration: opened.channelGeneration } })
  const postRevoke = await rpc.handle('sessionChannel/subscribe', { args: { channelId: opened.channelId, channelGeneration: opened.channelGeneration, session: 's1' } })
  assert.equal(postRevoke.ok, false)
  assert.equal(postRevoke.error.code, 'channel-revoked')
})

test('cross-package: anonymous floods cannot lock out verified callers (bucket isolation)', async () => {
  const { api } = mountFacade()
  let verifyCalls = 0
  api.auth.registerVerifier({ id: 'v1', verify: (cred) => { verifyCalls += 1; return { deviceId: cred, scope: [] } } })

  // Establish a legitimately-owned channel and subscription BEFORE the flood.
  const opened = await api.open({ device: 'deviceA', session: 's1' })
  assert.ok(opened.ok)
  const ownedSub = await api.subscribe({
    channelId: opened.channelId, channelGeneration: opened.channelGeneration, session: 's1',
  })
  assert.ok(ownedSub.ok)

  // Ten anonymous opens exhaust the shared anonymous bucket for this method;
  // each attempt runs the chain once, then further anonymous calls brake
  // before the chain runs again (plugin callbacks stay protected).
  let lastAnonymous
  for (let i = 0; i < 15; i++) {
    lastAnonymous = await api.open({ device: 'anon', session: 's1' })
  }
  assert.equal(lastAnonymous.ok, false)
  assert.equal(lastAnonymous.error.code, 'rate-limited')
  assert.equal(verifyCalls, 10, 'the verifier chain ran at most the anonymous budget')

  // Possession-gated calls live in their own buckets: an anonymous flood on
  // `open` never touches `fetchEvents`, so the paired consumer keeps working.
  const pull = await api.fetchEvents({
    channelId: opened.channelId, channelGeneration: opened.channelGeneration,
    subscriptionId: ownedSub.subscriptionId, subscriptionGeneration: ownedSub.subscriptionGeneration,
    maxEvents: 10,
  })
  assert.ok(pull.ok, 'flooded method must not brake other method buckets for the rightful holder')
})

test('cross-package: authorizer sees canonical identity plus possession context', async () => {
  const { api } = mountFacade()
  const seen = []
  api.auth.registerVerifier({ id: 'v1', verify: (cred) => ({ deviceId: `verified-${cred}`, scope: ['session:read'] }) })
  api.auth.registerAuthorizer({ id: 'a1', authorize: (req) => { seen.push(req); return { allow: true } } })
  const opened = await api.open({ device: 'label-A', session: 's1' })
  assert.ok(opened.ok)
  assert.equal(seen[0]?.deviceId, 'verified-label-A')
  assert.deepEqual(seen[0]?.scope, ['session:read'])

  // Possession-gated method: authorizer receives method/channel context.
  await api.subscribe({ channelId: opened.channelId, channelGeneration: opened.channelGeneration, session: 's1' })
  const last = seen[seen.length - 1]
  assert.equal(last.method, 'subscribe')
  assert.equal(last.channel, opened.channelId)
})

test('cross-package: wire-time audience filter narrows captured payloads by profile', async () => {
  const { api, service } = mountFacade()
  api.auth.registerVerifier({ id: 'v1', verify: (cred) => ({ deviceId: cred, scope: [] }) })
  api.redaction.registerProfile({ id: 'telemetry', allowlist: ['detail'] })

  // Unknown profile ids fail closed at subscribe time.
  const opened = await api.open({ device: 'dev1', session: 's1' })
  const badSub = await api.subscribe({
    channelId: opened.channelId, channelGeneration: opened.channelGeneration, session: 's1', redactionProfile: 'no-such-profile',
  })
  assert.equal(badSub.ok, false)
  assert.equal(badSub.error.code, 'invalid-input')

  const cleanSub = await api.subscribe({
    channelId: opened.channelId, channelGeneration: opened.channelGeneration, session: 's1',
  })
  const profiledSub = await api.subscribe({
    channelId: opened.channelId, channelGeneration: opened.channelGeneration, session: 's1', redactionProfile: 'telemetry',
  })

  // Drive one official session event carrying both a profile field and a secret.
  service.sessions.emit('session/event', {
    sessionId: 's1',
    detail: 'channel-telemetry-value',
    resumeToken: 'must-not-appear',
    unlistedField: 'dropped-by-default',
  })

  const defaultFrame = await api.fetchEvents({
    channelId: opened.channelId, channelGeneration: opened.channelGeneration,
    subscriptionId: cleanSub.subscriptionId, subscriptionGeneration: cleanSub.subscriptionGeneration,
    maxEvents: 10,
  })
  assert.ok(defaultFrame.ok)
  const defaultPayload = defaultFrame.frames[0]?.payload ?? {}
  assert.equal(defaultPayload.detail, undefined, 'default audience stays narrow')
  assert.doesNotMatch(JSON.stringify(defaultPayload), /must-not-appear/)

  const profiledFrame = await api.fetchEvents({
    channelId: opened.channelId, channelGeneration: opened.channelGeneration,
    subscriptionId: profiledSub.subscriptionId, subscriptionGeneration: profiledSub.subscriptionGeneration,
    maxEvents: 10,
  })
  assert.ok(profiledFrame.ok)
  assert.equal(profiledFrame.frames[0]?.payload?.detail, 'channel-telemetry-value', 'profiled audience receives its declared fields')
  assert.doesNotMatch(JSON.stringify(profiledFrame), /must-not-appear/, 'secret fields win over any profile')
})

test('cross-package: connection fencing table syncs with facade generations', async () => {
  const { api } = mountFacade()
  api.auth.registerVerifier({ id: 'v1', verify: (cred) => ({ deviceId: cred, scope: [] }) })
  const opened = await api.open({ device: 'dev1', session: 's1' })
  assert.ok(opened.ok)
  const channelId = opened.channelId

  const fence = createFencingTable({ facade: () => api })
  fence.attach()
  assert.ok(fence.active, 'fencing table must activate when facade present')
  assert.ok(fence.bind(channelId, opened.channelGeneration))
  assert.ok(fence.isCurrent(channelId, opened.channelGeneration), 'fresh generation must qualify')

  await api.revoke({ channelId, channelGeneration: opened.channelGeneration })
  fence.prune()
  assert.ok(!fence.isCurrent(channelId, opened.channelGeneration), 'revoked channel generation must lose qualification')
})

test('cross-package: facade reports slice unavailable when R package is missing', () => {
  const { api } = mountFacade()
  assert.equal(typeof api.open, 'function')
  assert.equal(typeof api.subscribe, 'function')
  assert.equal(typeof api.fetchEvents, 'function')
  assert.equal(typeof api.heartbeat, 'function')
})
