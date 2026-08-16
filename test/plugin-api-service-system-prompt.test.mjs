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

test('active service exposes a disabled systemPrompt stub', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const ctx = mockCtx()
  const service = new ServiceClass(ctx)

  assert.equal(service.systemPrompt.isActive, false)
  for (const method of ['section', 'context', 'variable', 'tools', 'suppressRuntimeContext', 'render', 'renderContextSections']) {
    assert.throws(
      () => service.systemPrompt[method](),
      (error) => {
        assert.ok(error instanceof PluginApiFeatureDisabledError)
        assert.equal(error.feature, 'systemPrompt')
        return true
      },
      `${method} should throw feature-disabled`,
    )
  }

  assert.equal(ctx.getCalls.length, 0)
})

test('inert service throws inactive errors from systemPrompt stub', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: false })
  const ctx = mockCtx()
  const service = new ServiceClass(ctx)

  for (const method of ['section', 'context', 'variable', 'tools', 'suppressRuntimeContext', 'render', 'renderContextSections']) {
    assert.throws(() => service.systemPrompt[method](), PluginApiInactiveError, `${method} should throw inactive`)
  }

  assert.equal(ctx.getCalls.length, 0)
})

test('mountFeature injects the systemPrompt API', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass(mockCtx())

  const systemPromptApi = { isActive: true, section() {}, render() {} }
  service.mountFeature('systemPrompt', systemPromptApi)

  assert.equal(service.systemPrompt, systemPromptApi)
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
