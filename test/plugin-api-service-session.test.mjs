import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import {
  PluginApiFeatureDisabledError,
  PluginApiInactiveError,
} from '../lib/errors.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'

function instantiate(ServiceClass, ctx) {
  return new ServiceClass(ctx)
}

function mockCtx() {
  const getCalls = []
  return {
    getCalls,
    reflect: { provide() {} },
    get(name) {
      getCalls.push(name)
      return undefined
    },
  }
}

const SESSION_METHODS = [
  'observe',
  'get',
  'list',
  'fork',
  'header',
  'events',
  'seq',
  'surface',
  'requestHeader',
  'requestContext',
  'deriveMessages',
  'isSessionEventType',
  'isSurfaceEventType',
]

test('active service with unmounted session throws feature-disabled from every method', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const ctx = mockCtx()
  const service = instantiate(ServiceClass, ctx)

  assert.equal(service.isActive, true)
  assert.equal(service.sessions.views, undefined)
  assert.equal(service.sessions.views, undefined)

  for (const method of SESSION_METHODS) {
    if (method === 'observe') {
      // The projection entry stays shape-compatible: it returns the inert
      // handle instead of throwing.
      const inertHandle = service.sessions.observe()
      assert.equal(typeof inertHandle.subscribe, 'function')
      assert.equal(inertHandle.epoch, 0)
      continue
    }
    assert.throws(
      () => service.sessions[method](),
      (error) => {
        assert.ok(error instanceof PluginApiFeatureDisabledError)
        assert.equal(error.code, 'PLUGIN_API_FEATURE_DISABLED')
        assert.equal(error.feature, 'sessions')
        return true
      },
      `${method} should throw feature-disabled`,
    )
  }
  assert.equal(ctx.getCalls.length, 0)
})

test('inert service session methods throw inactive before touching any official service', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: false })
  const ctx = mockCtx()
  const service = instantiate(ServiceClass, ctx)

  assert.equal(service.isActive, false)
  for (const method of SESSION_METHODS) {
    if (method === 'observe') {
      // The projection entry stays shape-compatible even when the core is
      // inactive: it returns the inert handle.
      const inertHandle = service.sessions.observe()
      assert.equal(inertHandle.epoch, 0)
      continue
    }
    assert.throws(
      () => service.sessions[method](),
      (error) => {
        assert.ok(error instanceof PluginApiInactiveError)
        assert.equal(error.code, 'PLUGIN_API_INACTIVE')
        return true
      },
      `${method} should throw inactive`,
    )
  }
  assert.equal(ctx.getCalls.length, 0)
})

test('mountFeature injects the session API and unknown feature still throws', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = instantiate(ServiceClass, mockCtx())

  const sessionApi = { isActive: true, get() {}, list() {}, fork() {} }
  service.mountFeature('session', sessionApi)
assert.equal(service.sessions.availability().status, 'degraded')
  assert.equal(service.sessions.get, sessionApi.get)
  assert.equal(service.sessions.list, sessionApi.list)
  assert.equal(service.sessions.fork, sessionApi.fork)
  assert.throws(() => service.sessions.durable.appendMessage(), PluginApiFeatureDisabledError)

  assert.throws(
    () => service.mountFeature('unknown/feature', {}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'unknown/feature')
      return true
    },
  )
})
