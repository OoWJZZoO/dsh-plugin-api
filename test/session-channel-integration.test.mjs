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
  const ServiceClass = createPluginApiService({ apiVersion: '0.7', registry, coreActive: true })
  const service = new ServiceClass({
    reflect: { provide() {} },
    get() { return undefined },
    on() { return () => {} },
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

test('facade: pluginApi.sessionChannel has correct shape', async () => {
  const service = createRealService()
  const result = mountSessionChannelFeature({ ctx: { get: () => {} }, service, logger: { warn() {} }, featureRegistry: { isActive: () => false } })
  assert.ok(result, 'mount succeeded')
  assert.ok(result.prepared.commit(), 'prepared transaction commits')
  const api = service.sessionChannel
  assert.ok(api, 'pluginApi.sessionChannel must be published')
  assert.equal(typeof api.open, 'function')
  assert.equal(typeof api.subscribe, 'function')
  assert.equal(typeof api.ack, 'function')
  assert.equal(typeof api.resume, 'function')
  assert.equal(typeof api.revoke, 'function')
  assert.equal(typeof api.observe, 'function')
  assert.equal(typeof api.onChange, 'function')
  assert.equal(typeof api.auth.registerVerifier, 'function')
  assert.equal(typeof api.auth.registerPairingProvider, 'function')
  assert.equal(typeof api.auth.registerAuthorizer, 'function')
  // Coordination surface (non-enumerable, for R packages)
  assert.equal(typeof api.dispatchChannelMethod, 'function', 'dispatchChannelMethod must be exposed directly')
  assert.equal(typeof api.channelGenerationOf, 'function', 'channelGenerationOf must be exposed directly')
  assert.equal(Object.keys(api).includes('dispatchChannelMethod'), false, 'coordination must not be a public enumerable field')
  // Contract symbol present (non-enumerable)
  assert.equal(api[CONTRACT_SYMBOL], true)
  assert.doesNotThrow(() => result.disposer())
})

test('facade: open fails closed without verifier (typed unavailable)', async () => {
  const service = createRealService()
  const result = mountSessionChannelFeature({ ctx: { get: () => {} }, service, logger: { warn() {} }, featureRegistry: { isActive: () => false } })
  result.prepared.commit()
  const api = service.sessionChannel
  const r = await api.open({ device: 'dev1', session: 's1' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'unavailable')
  assert.doesNotThrow(() => result.disposer())
})

test('facade: open succeeds after registering a verifier', async () => {
  const service = createRealService()
  const result = mountSessionChannelFeature({ ctx: { get: () => {} }, service, logger: { warn() {} }, featureRegistry: { isActive: () => false } })
  result.prepared.commit()
  const api = service.sessionChannel
  api.auth.registerVerifier({ id: 'v1', verify: (cred) => ({ deviceId: 'dev1', scope: [] }) })
  const r = await api.open({ device: 'dev1', session: 's1' })
  assert.ok(r.ok, 'open must succeed after verifier registration')
  assert.ok(r.channelId)
  assert.doesNotThrow(() => result.disposer())
})

test('facade: projection observe returns a snapshot', async () => {
  const service = createRealService()
  const result = mountSessionChannelFeature({ ctx: { get: () => {} }, service, logger: { warn() {} }, featureRegistry: { isActive: () => false } })
  result.prepared.commit()
  const api = service.sessionChannel
  const snap = api.observe({})
  assert.ok(snap.channels)
  assert.ok(snap.subscriptions)
  assert.doesNotThrow(() => result.disposer())
})

test('cross-package: CONTRACT_SYMBOL is present on the coordination surface', () => {
  // Verify that the shared symbol is the same reference everywhere
  assert.equal(CONTRACT_SYMBOL, Symbol.for('dsh-plugin-api.session-channel.contract'))
})