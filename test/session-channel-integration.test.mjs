import test from 'node:test'
import assert from 'node:assert/strict'
import { mountSessionChannelFeature } from '../lib/session-channel.js'
import { runFeatureGuard } from '../lib/guards.js'
import { CONTRACT_SYMBOL } from '../lib/session-channel-shared.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'
import { createFeatureRegistry } from '../lib/feature-registry.js'

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

function createRealService() {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass({
    reflect: { provide() {} },
    get() { return undefined },
    on() { return () => {} },
    once() {},
    effect() {},
  })
  // Pre-mount the session feature so the sessionChannel mounter can resolve it
  service.mountFeature('session', createMockSessionApi())
  return service
}

test('mount: sessionChannel mounts when session feature is available', () => {
  const service = createRealService()
  const result = mountSessionChannelFeature({ ctx: { get: () => {} }, service, logger: { warn() {} }, featureRegistry: { isActive: () => false } })
  assert.ok(result, 'mount must succeed when session feature is available')
  assert.equal(typeof result.disposer, 'function')
  assert.ok(result.prepared, 'prepared transaction must be returned')
})

test('mount: sessionChannel returns null when session feature is unavailable', () => {
  const service = { isActive: true, session: null, events: null }
  const result = mountSessionChannelFeature({ ctx: { get: () => {} }, service, logger: { warn() {} }, featureRegistry: { isActive: () => false } })
  assert.equal(result, null, 'mount must return null when session feature is unavailable')
})

test('mount: sessionChannel returns idempotent disposer on re-apply', () => {
  const service = createRealService()
  const result = mountSessionChannelFeature({ ctx: { get: () => {} }, service, logger: { warn() {} }, featureRegistry: { isActive: () => true } })
  assert.ok(result)
  assert.equal(typeof result.disposer, 'function')
  assert.equal(result.prepared, null, 're-apply must return null prepared transaction')
})

test('mount: disposer cleans up resources', () => {
  const service = createRealService()
  const result = mountSessionChannelFeature({ ctx: { get: () => {} }, service, logger: { warn() {} }, featureRegistry: { isActive: () => false } })
  assert.doesNotThrow(() => result.disposer(), 'disposer must not throw')
})

test('guard: sessionChannel passes when sessions service is available', () => {
  const ctx = { get: (name) => name === 'sessions' ? { get() {}, list() {} } : undefined }
  const guard = runFeatureGuard('sessionChannel', ctx)
  assert.ok(guard.ok, 'guard must pass when sessions service is available')
})

test('guard: sessionChannel fails when sessions service is unavailable', () => {
  const ctx = { get: () => undefined }
  const guard = runFeatureGuard('sessionChannel', ctx)
  assert.ok(!guard.ok, 'guard must fail when sessions service is unavailable')
})

test('guard: sessionChannel guard is deterministic', () => {
  const ctx = { get: (name) => name === 'sessions' ? { get() {}, list() {} } : undefined }
  const guard1 = runFeatureGuard('sessionChannel', ctx)
  const guard2 = runFeatureGuard('sessionChannel', ctx)
  assert.equal(guard1.ok, guard2.ok)
})

test('facade: pluginApi.sessions.channels has correct shape', async () => {
  const service = createRealService()
  const result = mountSessionChannelFeature({ ctx: { get: () => {} }, service, logger: { warn() {} }, featureRegistry: { isActive: () => false } })
  assert.ok(result, 'mount succeeded')
  assert.ok(result.prepared.commit(), 'prepared transaction commits')
  const api = service.sessions.channels
  assert.ok(api, 'pluginApi.sessions.channels must be published')
  assert.equal(typeof api.acquire, 'function')
  assert.equal(typeof api.history, 'function')
  assert.equal(typeof api.ack, 'function')
  assert.equal(typeof api.resume, 'function')
  assert.equal(typeof api.release, 'function')
  // The one-shot snapshot and the observation handle are separate members:
  // `list` (the event-frame fetch under its old name) is gone.
  assert.equal(typeof api.current, 'function')
  assert.equal(typeof api.observe, 'function')
  assert.equal('list' in api, false, 'the renamed event-frame fetch must not keep its old name')
  assert.equal(typeof api.auth.register, 'function')
  assert.equal(typeof api.auth.pairingProvider.register, 'function')
  assert.equal(typeof api.auth.register, 'function')
  // Coordination internals are retired from the public face (internalized)
  assert.equal('dispatchChannelMethod' in api, false, 'dispatchChannelMethod must not be exposed')
  assert.equal('channelGenerationOf' in api, false, 'channelGenerationOf must not be exposed')
  // Contract symbol present (non-enumerable)
  assert.equal(api[CONTRACT_SYMBOL], true)
  assert.doesNotThrow(() => result.disposer())
})

test('facade: open fails closed without verifier (typed unavailable)', async () => {
  const service = createRealService()
  const result = mountSessionChannelFeature({ ctx: { get: () => {} }, service, logger: { warn() {} }, featureRegistry: { isActive: () => false } })
  result.prepared.commit()
  const api = service.sessions.channels
  const r = await api.acquire({ device: 'dev1', session: 's1' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'unavailable')
  assert.doesNotThrow(() => result.disposer())
})

test('facade: open succeeds after registering a verifier', async () => {
  const service = createRealService()
  const result = mountSessionChannelFeature({ ctx: { get: () => {} }, service, logger: { warn() {} }, featureRegistry: { isActive: () => false } })
  result.prepared.commit()
  const api = service.sessions.channels
  api.auth.register({ kind: 'verifier', id: 'v1', verify: (cred) => ({ deviceId: 'dev1', scope: [] }) })
  const r = await api.acquire({ device: 'dev1', session: 's1' })
  assert.ok(r.ok, 'open must succeed after verifier registration')
  assert.ok(r.channelId)
  assert.doesNotThrow(() => result.disposer())
})

test('facade: current returns the one-shot frozen snapshot', async () => {
  const service = createRealService()
  const result = mountSessionChannelFeature({ ctx: { get: () => {} }, service, logger: { warn() {} }, featureRegistry: { isActive: () => false } })
  result.prepared.commit()
  const api = service.sessions.channels
  const snap = api.current({})
  assert.ok(snap.channels)
  assert.ok(snap.subscriptions)
  assert.ok(Object.isFrozen(snap), 'the snapshot is deep-frozen')
  assert.doesNotThrow(() => result.disposer())
})

test('facade: observe answers the standard observation handle over the projection', async () => {
  const service = createRealService()
  const result = mountSessionChannelFeature({ ctx: { get: () => {} }, service, logger: { warn() {} }, featureRegistry: { isActive: () => false } })
  result.prepared.commit()
  const api = service.sessions.channels
  const seen = []
  const handle = api.observe((snapshot) => seen.push(snapshot))
  assert.deepEqual(Object.keys(handle).sort(), ['current', 'dispose', 'epoch', 'subscribe'])
  assert.ok(Object.isFrozen(handle))
  assert.equal(typeof handle.epoch, 'string')
  assert.ok(handle.current().channels, 'the handle reads the live projection')

  // A state change flows to the subscriber.
  api.auth.register({ kind: 'verifier', id: 'v1', verify: () => ({ deviceId: 'dev1', scope: [] }) })
  await api.acquire({ device: 'dev1', session: 's1' })
  assert.ok(seen.length > 0, 'the listener observes channel state changes')

  // Release is a discriminated, idempotent result and degrades the read face.
  const first = handle.dispose()
  assert.deepEqual({ ok: first.ok, code: first.code }, { ok: true, code: 'revoked' })
  assert.equal(handle.current().connectionState, 'unknown', 'a released handle answers the degraded view')
  assert.equal(handle.subscribe(() => {})(), undefined, 'subscribing to a released handle is a no-op')
  const second = handle.dispose()
  assert.deepEqual({ ok: second.ok, code: second.code }, { ok: false, code: 'stale' })
  assert.doesNotThrow(() => result.disposer())
})

test('cross-package: CONTRACT_SYMBOL is present on the coordination surface', () => {
  // Verify that the shared symbol is the same reference everywhere
  assert.equal(CONTRACT_SYMBOL, Symbol.for('dsh-plugin-api.session-channel.contract'))
})