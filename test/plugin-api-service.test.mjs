import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import {
  PluginApiFeatureDisabledError,
  PluginApiInactiveError,
  PluginApiVersionError,
} from '../lib/errors.js'
import { createPluginApiService, pluginApiBrand } from '../lib/plugin-api-service.js'

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

test('active service exposes brand, apiVersion, features snapshot', () => {
  const registry = createFeatureRegistry()
  registry.mount('llm/admission')
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const ctx = mockCtx()
  const service = instantiate(ServiceClass, ctx)

  assert.equal(service[pluginApiBrand], true)
  assert.equal(service.isActive, true)
  assert.equal(service.apiVersion, '0.1')
  assert.deepEqual(service.features, [{ name: 'llm/admission', isActive: true }])
})

test('inert service reports isActive false and throws inactive error from methods', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: false })
  const ctx = mockCtx()
  const service = instantiate(ServiceClass, ctx)

  assert.equal(service.isActive, false)
  assert.deepEqual(service.features, [])
  assert.throws(
    () => service.assertCompatible('0.1', 'test-plugin'),
    (error) => {
      assert.ok(error instanceof PluginApiInactiveError)
      assert.equal(error.code, 'PLUGIN_API_INACTIVE')
      return true
    },
  )
  assert.throws(
    () => service.llm.admission.register({}),
    (error) => {
      assert.ok(error instanceof PluginApiInactiveError)
      assert.equal(error.code, 'PLUGIN_API_INACTIVE')
      return true
    },
  )
  assert.equal(ctx.getCalls.length, 0)
})

test('active service with unmounted feature throws feature-disabled error', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = instantiate(ServiceClass, mockCtx())

  assert.equal(service.isActive, true)
  assert.throws(
    () => service.llm.admission.register({}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.code, 'PLUGIN_API_FEATURE_DISABLED')
      assert.equal(error.feature, 'llm/admission')
      return true
    },
  )
})

test('assertCompatible returns true when satisfied', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = instantiate(ServiceClass, mockCtx())

  assert.equal(service.assertCompatible('0.1', 'test-plugin'), true)
  assert.doesNotThrow(() => service.assertCompatible('0.1'))
})

test('assertCompatible throws PluginApiVersionError when requirement differs', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = instantiate(ServiceClass, mockCtx())

  assert.throws(
    () => service.assertCompatible('0.2', 'test-plugin'),
    (error) => {
      assert.ok(error instanceof PluginApiVersionError)
      assert.equal(error.code, 'PLUGIN_API_VERSION_MISMATCH')
      assert.equal(error.declared, '0.1')
      assert.equal(error.required, '0.2')
      assert.equal(error.pluginName, 'test-plugin')
      assert.match(error.message, /0\.1/)
      assert.match(error.message, /0\.2/)
      return true
    },
  )
})

test('mountFeature injects a feature API and unknown feature throws', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = instantiate(ServiceClass, mockCtx())

  const admissionApi = { register() {}, isActive: true }
  service.mountFeature('llm/admission', admissionApi)
  assert.equal(service.llm.admission, admissionApi)

  assert.throws(
    () => service.mountFeature('unknown/feature', {}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'unknown/feature')
      return true
    },
  )
})

test('no official service calls happen before inactive or feature-disabled throws', () => {
  const registry = createFeatureRegistry()
  const inertService = instantiate(
    createPluginApiService({ apiVersion: '0.1', registry, coreActive: false }),
    mockCtx(),
  )
  assert.throws(() => inertService.assertCompatible('0.1'), PluginApiInactiveError)
  assert.throws(() => inertService.llm.admission.register({}), PluginApiInactiveError)

  const activeService = instantiate(
    createPluginApiService({ apiVersion: '0.1', registry, coreActive: true }),
    mockCtx(),
  )
  assert.throws(() => activeService.llm.admission.register({}), PluginApiFeatureDisabledError)
})
