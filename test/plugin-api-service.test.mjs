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

test('inert service exposes settings stub that throws inactive error without service calls', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: false })
  const ctx = mockCtx()
  const service = instantiate(ServiceClass, ctx)

  for (const call of [
    () => service.settings.register('ns', {}),
    () => service.settings.scope('ns'),
    () => service.settings.describe(),
    () => service.settings.installSettingsSection({}, 'ns', {}, {}, {}),
  ]) {
    assert.throws(call, (error) => {
      assert.ok(error instanceof PluginApiInactiveError)
      assert.equal(error.code, 'PLUGIN_API_INACTIVE')
      return true
    })
  }
  assert.equal(service.settings.isActive, false)
  assert.equal(ctx.getCalls.length, 0)
})

test('active service with unmounted settings feature throws feature-disabled error', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = instantiate(ServiceClass, mockCtx())

  for (const call of [
    () => service.settings.register('ns', {}),
    () => service.settings.scope('ns'),
    () => service.settings.describe(),
    () => service.settings.installSettingsSection({}, 'ns', {}, {}, {}),
  ]) {
    assert.throws(call, (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.code, 'PLUGIN_API_FEATURE_DISABLED')
      assert.equal(error.feature, 'settings')
      return true
    })
  }
  assert.equal(service.settings.isActive, false)
})

test('mountFeature injects the settings API', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = instantiate(ServiceClass, mockCtx())

  const settingsApi = { isActive: true, register() {}, scope() {}, describe() {}, installSettingsSection() {} }
  service.mountFeature('settings', settingsApi)
  assert.equal(service.settings, settingsApi)
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

test('default services namespace exposes the 18 disabled facades before mount', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = instantiate(ServiceClass, mockCtx())

  assert.equal(typeof service.services, 'object')
  assert.equal(Object.keys(service.services).length, 18)
  assert.ok(Object.isFrozen(service.services))
  for (const key of Object.keys(service.services)) {
    assert.equal(service.services[key].isActive, false)
  }
})

test('default services namespace throws feature-disabled error with feature code "services"', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = instantiate(ServiceClass, mockCtx())

  assert.throws(
    () => service.services.fs.readText({}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'services')
      return true
    },
  )
})

test('inert service services namespace throws inactive error before touching official services', () => {
  const registry = createFeatureRegistry()
  const ctx = mockCtx()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: false })
  const service = instantiate(ServiceClass, ctx)

  assert.throws(
    () => service.services.fs.readText({}),
    (error) => {
      assert.ok(error instanceof PluginApiInactiveError)
      assert.equal(error.code, 'PLUGIN_API_INACTIVE')
      return true
    },
  )
  assert.equal(ctx.getCalls.length, 0)
})

test('mountFeature injects the services namespace', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = instantiate(ServiceClass, mockCtx())

  const servicesApi = { fs: { isActive: true, readText() {} } }
  service.mountFeature('services', servicesApi)
  assert.equal(service.services, servicesApi)
})
