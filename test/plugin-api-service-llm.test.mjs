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
  'adapters',
  'providers',
  'models',
]

function activeService() {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  return instantiate(ServiceClass, mockCtx())
}

test('unmounted llm namespace exposes isActive false and feature-disabled errors', () => {
  const service = activeService()

assert.equal(service.llm.availability().status, 'unavailable')
  for (const method of LLM_METHODS) {
    const member = service.llm[method]
    assert.ok(member, `llm.${method} exists`)
    if (typeof member === 'function') {
      assert.throws(
        () => member(),
        (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'llm',
      )
    } else {
      assert.throws(() => member.register({}), (error) => error instanceof PluginApiFeatureDisabledError)
    }
  }
})

test('inert service throws PluginApiInactiveError from llm methods before touching official services', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: false })
  const ctx = mockCtx()
  const service = instantiate(ServiceClass, ctx)

  for (const method of ['modelInfo', 'prepareCall', 'stream']) {
    assert.throws(
      () => service.llm[method](),
      (error) => error instanceof PluginApiInactiveError && error.code === 'PLUGIN_API_INACTIVE',
    )
  }
  assert.throws(() => service.llm.adapters.register({}), (error) => error instanceof PluginApiInactiveError)
  assert.throws(() => service.llm.providers.register({}), (error) => error instanceof PluginApiInactiveError)
  assert.throws(() => service.llm.models.register({}), (error) => error instanceof PluginApiInactiveError)
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
  }

  service.mountFeature('llm', llmApi)

assert.equal(service.llm.availability().status, 'active')
  for (const method of ['modelInfo', 'prepareCall', 'stream']) {
    service.llm[method]()
  }
  assert.deepEqual(calls, ['modelInfo', 'prepareCall', 'stream'])
})

test('unmounted llm request surface throws core-inactive/feature-disabled before registration validation', () => {
  const registry = createFeatureRegistry()
  const active = instantiate(
    createPluginApiService({ apiVersion: '0.1', registry, coreActive: true }),
    mockCtx(),
  )
  const inert = instantiate(
    createPluginApiService({ apiVersion: '0.1', registry, coreActive: false }),
    mockCtx(),
  )

  assert.equal(typeof active.llm.requestTransforms.register, 'function')
  assert.throws(() => inert.llm.requestTransforms.register({}), PluginApiInactiveError)
  assert.throws(
    () => active.llm.requestTransforms.register({}),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'llm.requestTransforms',
  )
})

test('mountFeature("llm/request", api) installs only the request surface', () => {
  const service = activeService()
  const requestApi = { transform() {}, isActive: true }

  service.mountFeature('llm/request', requestApi)

  assert.equal(service.llm.requestTransforms.register(), undefined)
  assert.ok(Object.isFrozen(service.llm.requestTransforms))
assert.equal(service.llm.availability().status, 'unavailable')
  // admission.isActive is retired; the disabled surface exposes only register.
  assert.equal('isActive' in service.llm.admissionPolicies, false)
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

  assert.equal(service.llm.admissionPolicies.register(), undefined)
assert.equal(service.llm.availability().status, 'active')
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

  assert.equal(service.llm.admissionPolicies.register(), undefined)
assert.equal(service.llm.availability().status, 'active')
})
