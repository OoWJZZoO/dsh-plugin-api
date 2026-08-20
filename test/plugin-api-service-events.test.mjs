import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from '../lib/errors.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'

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

test('active service exposes disabled events stub', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const ctx = mockCtx()
  const service = new ServiceClass(ctx)

  assert.equal(service.events.catalog, undefined)
  for (const method of ['on', 'once', 'emit', 'serial', 'parallel', 'bail', 'waterfall']) {
    assert.throws(
      () => service.events[method]('x', () => {}),
      (error) => {
        assert.ok(error instanceof PluginApiFeatureDisabledError)
        assert.equal(error.feature, 'events')
        return true
      },
    )
  }

  // web is no longer a service-level stub pluginApi.services.web.
  assert.equal(service.web, undefined)

  assert.equal(ctx.getCalls.length, 0)
})

test('inert service throws inactive errors from events stub', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: false })
  const ctx = mockCtx()
  const service = new ServiceClass(ctx)

  for (const method of ['on', 'once', 'emit', 'serial', 'parallel', 'bail', 'waterfall']) {
    assert.throws(() => service.events[method]('x', () => {}), PluginApiInactiveError)
  }

  assert.equal(ctx.getCalls.length, 0)
})

test('mountFeature injects the events API', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass(mockCtx())

  const eventsApi = { on() {}, catalog: {} }

  service.mountFeature('events', eventsApi)

  assert.equal(service.events.on, eventsApi.on)
  assert.equal(service.events.catalog, eventsApi.catalog)
  assert.ok(Object.isFrozen(service.events))
})

test('mountFeature still rejects unknown feature names', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass(mockCtx())

  assert.throws(
    () => service.mountFeature('unknown/feature', {}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'unknown/feature')
      return true
    },
  )
})
