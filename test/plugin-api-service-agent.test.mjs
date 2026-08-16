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

test('active service exposes a disabled agent stub', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const ctx = mockCtx()
  const service = new ServiceClass(ctx)

  assert.equal(service.agent.isActive, false)
  for (const method of ['get', 'list', 'roots']) {
    assert.throws(
      () => service.agent[method]('x'),
      (error) => {
        assert.ok(error instanceof PluginApiFeatureDisabledError)
        assert.equal(error.feature, 'agent')
        return true
      },
    )
  }

  assert.equal(ctx.getCalls.length, 0)
})

test('inert service throws inactive errors from agent stub', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: false })
  const ctx = mockCtx()
  const service = new ServiceClass(ctx)

  assert.equal(service.agent.isActive, false)
  for (const method of ['get', 'list', 'roots']) {
    assert.throws(() => service.agent[method]('x'), PluginApiInactiveError)
  }

  assert.equal(ctx.getCalls.length, 0)
})

test('mountFeature injects the agent API', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass(mockCtx())

  const agentApi = { isActive: true, get() {}, list() {}, roots() {} }
  service.mountFeature('agent', agentApi)

  assert.equal(service.agent, agentApi)
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
