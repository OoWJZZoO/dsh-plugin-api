import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginApiService } from '../lib/plugin-api-service.js'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from '../lib/errors.js'

function makeService({ coreActive = true } = {}) {
  const registry = createFeatureRegistry()
  const Service = createPluginApiService({
    apiVersion: '0.1',
    registry,
    coreActive,
  })
  const ctx = {
    reflect: { provide() {} },
    logger: { error() {}, warn() {} },
    get() {
      return undefined
    },
  }
  return new Service(ctx)
}

function makeExecutionApi() {
  return {
    observe() {
      return { current: () => [], dispose: () => true }
    },
    get(id) {
      return id === 'e1' ? { executionId: 'e1' } : undefined
    },
    history() {
      return { items: [] }
    },
    onChange() {
      return () => true
    },
    visibility: { register() { return () => true } },
    get availability() {
      return { sources: { tools: 'available' }, epoch: 'epoch:1' }
    },
  }
}

test('execution disabled surface throws core-inactive and feature-disabled errors before touching owners', () => {
  const inactive = makeService({ coreActive: false })
  assert.throws(() => inactive.executions.get('e1'), PluginApiInactiveError)

  const active = makeService({ coreActive: true })
  assert.throws(() => active.executions.get('e1'), (error) => {
    assert.ok(error instanceof PluginApiFeatureDisabledError)
    assert.equal(error.feature, 'executions')
    return true
  })
  assert.deepEqual(active.executions.availability, { sources: {}, epoch: 'none' })
})

test('mount exposes the execution surface and delegates to the owner', () => {
  const service = makeService({ coreActive: true })
  const api = makeExecutionApi()
  const token = service.mountFeature('execution', api)
  assert.ok(token)
  assert.equal(service.executions.get('e1').executionId, 'e1')
  assert.equal(service.executions.history('s1').items.length, 0)
  const observer = service.executions.observe()
  assert.equal(observer.dispose(), true)
  assert.equal(typeof service.executions.visibility.register, 'function')
  assert.equal(service.executions.availability.sources.tools, 'available')
})

test('unmount is token-bound, idempotent and restores the disabled surface', () => {
  const service = makeService({ coreActive: true })
  const first = service.mountFeature('execution', makeExecutionApi())
  const second = service.mountFeature('execution', makeExecutionApi())
  assert.notEqual(first, second)
  assert.equal(service.unmountFeature('execution', first), false, 'stale token cannot unmount newer owner')
  assert.equal(service.unmountFeature('execution', second), true)
  assert.equal(service.unmountFeature('execution', second), false)
  assert.throws(() => service.executions.get('e1'), (error) => {
    assert.ok(error instanceof PluginApiFeatureDisabledError)
    assert.equal(error.feature, 'executions')
    return true
  })
})

test('existing service surfaces remain untouched after execution additions', () => {
  const service = makeService({ coreActive: true })
  assert.equal(typeof service.tools.isActive, 'boolean')
  assert.throws(() => service.events.on('x', () => {}), (error) => error instanceof PluginApiFeatureDisabledError)
  assert.equal(typeof service.executions.observe, 'function')
})
