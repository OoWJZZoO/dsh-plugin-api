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

test('active service exposes disabled events and web stubs', () => {
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

  assert.throws(() => service.web.registerSearchProvider({}), (error) => {
    assert.ok(error instanceof PluginApiFeatureDisabledError)
    assert.equal(error.feature, 'web')
    return true
  })
  assert.throws(() => service.web.registerFetchProvider({}), (error) => {
    assert.ok(error instanceof PluginApiFeatureDisabledError)
    assert.equal(error.feature, 'web')
    return true
  })

  assert.equal(ctx.getCalls.length, 0)
})

test('inert service throws inactive errors from events and web stubs', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: false })
  const ctx = mockCtx()
  const service = new ServiceClass(ctx)

  for (const method of ['on', 'once', 'emit', 'serial', 'parallel', 'bail', 'waterfall']) {
    assert.throws(() => service.events[method]('x', () => {}), PluginApiInactiveError)
  }
  assert.throws(() => service.web.registerSearchProvider({}), PluginApiInactiveError)
  assert.throws(() => service.web.registerFetchProvider({}), PluginApiInactiveError)

  assert.equal(ctx.getCalls.length, 0)
})

test('mountFeature injects events and web APIs', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass(mockCtx())

  const eventsApi = { on() {}, catalog: {} }
  const webApi = { registerSearchProvider() {}, registerFetchProvider() {} }

  service.mountFeature('events', eventsApi)
  service.mountFeature('web', webApi)

  assert.equal(service.events, eventsApi)
  assert.equal(service.web, webApi)
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
