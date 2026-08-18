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

const LLM_METHODS = [
  'modelInfo',
  'prepareCall',
  'stream',
  'registerAdapter',
  'registerConfigurableProviders',
  'registerModelDiscovery',
]

function activeService() {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  return instantiate(ServiceClass, mockCtx())
}

test('unmounted llm namespace exposes isActive false and feature-disabled errors', () => {
  const service = activeService()

  assert.equal(service.llm.isActive, false)
  for (const method of LLM_METHODS) {
    assert.equal(typeof service.llm[method], 'function')
    assert.throws(
      () => service.llm[method](),
      (error) => {
        assert.ok(error instanceof PluginApiFeatureDisabledError)
        assert.equal(error.code, 'PLUGIN_API_FEATURE_DISABLED')
        assert.equal(error.feature, 'llm')
        return true
      },
    )
  }
})

test('inert service throws PluginApiInactiveError from llm methods before touching official services', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: false })
  const ctx = mockCtx()
  const service = instantiate(ServiceClass, ctx)

  for (const method of LLM_METHODS) {
    assert.throws(
      () => service.llm[method](),
      (error) => {
        assert.ok(error instanceof PluginApiInactiveError)
        assert.equal(error.code, 'PLUGIN_API_INACTIVE')
        return true
      },
    )
  }
  assert.equal(ctx.getCalls.length, 0)
})

test('mountFeature("llm", api) installs all methods and isActive true', () => {
  const service = activeService()
  const calls = []
  const llmApi = {
    isActive: true,
    modelInfo: () => calls.push('modelInfo'),
    prepareCall: () => calls.push('prepareCall'),
    stream: () => calls.push('stream'),
    registerAdapter: () => calls.push('registerAdapter'),
    registerConfigurableProviders: () => calls.push('registerConfigurableProviders'),
    registerModelDiscovery: () => calls.push('registerModelDiscovery'),
  }

  service.mountFeature('llm', llmApi)

  assert.equal(service.llm.isActive, true)
  for (const method of LLM_METHODS) {
    service.llm[method]()
  }
  assert.deepEqual(calls, LLM_METHODS)
})

test('unmounted llm request surface throws P1/P2 before registration validation', () => {
  const registry = createFeatureRegistry()
  const active = instantiate(
    createPluginApiService({ apiVersion: '0.1', registry, coreActive: true }),
    mockCtx(),
  )
  const inert = instantiate(
    createPluginApiService({ apiVersion: '0.1', registry, coreActive: false }),
    mockCtx(),
  )

  assert.equal(typeof active.llm.request.transform, 'function')
  assert.throws(() => inert.llm.request.transform({}), PluginApiInactiveError)
  assert.throws(
    () => active.llm.request.transform({}),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'llm/request',
  )
})

test('mountFeature("llm/request", api) installs only the request surface', () => {
  const service = activeService()
  const requestApi = { transform() {}, isActive: true }

  service.mountFeature('llm/request', requestApi)

  assert.equal(service.llm.request.transform(), undefined)
  assert.ok(Object.isFrozen(service.llm.request))
  assert.equal(service.llm.isActive, false)
  // admission.isActive is retired; the disabled surface exposes only register.
  assert.equal('isActive' in service.llm.admission, false)
})

test('mountFeature("llm") does not overwrite an already-mounted admission surface', () => {
  const service = activeService()
  const admissionApi = { register() {}, isActive: true }

  service.mountFeature('llm/admission', admissionApi)
  service.mountFeature('llm', {
    isActive: true,
    modelInfo() {},
    prepareCall() {},
    stream() {},
    registerAdapter() {},
    registerConfigurableProviders() {},
    registerModelDiscovery() {},
  })

  assert.equal(service.llm.admission.register(), undefined)
  assert.equal(service.llm.isActive, true)
})

test('llm/admission can still be mounted after llm is mounted', () => {
  const service = activeService()
  const admissionApi = { register() {}, isActive: true }

  service.mountFeature('llm', {
    isActive: true,
    modelInfo() {},
    prepareCall() {},
    stream() {},
    registerAdapter() {},
    registerConfigurableProviders() {},
    registerModelDiscovery() {},
  })
  service.mountFeature('llm/admission', admissionApi)

  assert.equal(service.llm.admission.register(), undefined)
  assert.equal(service.llm.isActive, true)
})
