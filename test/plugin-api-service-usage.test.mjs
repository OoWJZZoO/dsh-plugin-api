import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginApiService } from '../lib/plugin-api-service.js'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from '../lib/errors.js'

function makeService({ coreActive = true } = {}) {
  const registry = createFeatureRegistry()
  const Service = createPluginApiService({
    apiVersion: '0.6',
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

function makeUsageApi() {
  return {
    record(sample, opts) {
      return { status: 'committed', recordId: 'rec-1' }
    },
    settle(executionId, opts) {
      return { status: 'settled', recordId: 'rec-1' }
    },
    pricing: {
      register(entry) {
        return { status: 'registered' }
      },
    },
    query(params) {
      return { items: [], scopes: [], truncated: false, provisional: false, unavailable: false }
    },
    budget: {
      observe(params, listener) {
        return { status: 'observed', disposer: () => true }
      },
    },
    get availability() {
      return { sources: { llmStream: 'available' }, owners: { ledger: 'available' } }
    },
  }
}

test('usage disabled surface throws core-inactive and feature-disabled errors before touching owners', () => {
  const inactive = makeService({ coreActive: false })
  assert.throws(() => inactive.usage.record({}, {}), PluginApiInactiveError)

  const active = makeService({ coreActive: true })
  assert.throws(() => active.usage.query({}), (error) => {
    assert.ok(error instanceof PluginApiFeatureDisabledError)
    assert.equal(error.feature, 'usage')
    return true
  })
  assert.deepEqual(active.usage.availability, { sources: {}, owners: {} })
  assert.throws(() => active.usage.pricing.register({}), PluginApiFeatureDisabledError)
  assert.throws(() => active.usage.budget.observe({}, () => {}), PluginApiFeatureDisabledError)
})

test('mount exposes the usage surface and delegates to the owner', () => {
  const service = makeService({ coreActive: true })
  const token = service.mountFeature('usage', makeUsageApi())
  assert.ok(token)
  const committed = service.usage.record({ sampleId: 's-1' }, { scope: 'session', ownerId: 'o', generation: 'g', operationId: 'op' })
  assert.equal(committed.status, 'committed')
  assert.equal(service.usage.settle('exec-1', {}).status, 'settled')
  assert.equal(service.usage.pricing.register({ revision: 'r' }).status, 'registered')
  assert.equal(typeof service.usage.budget.observe, 'function')
  assert.equal(service.usage.availability.sources.llmStream, 'available')
})

test('mount rejects a usage owner with an incomplete shape', () => {
  const service = makeService({ coreActive: true })
  assert.throws(
    () => service.mountFeature('usage', { record() {} }),
    (error) => error instanceof PluginApiFeatureDisabledError,
  )
})

test('unmount is token-bound, idempotent and restores the disabled surface', () => {
  const service = makeService({ coreActive: true })
  const first = service.mountFeature('usage', makeUsageApi())
  const second = service.mountFeature('usage', makeUsageApi())
  assert.notEqual(first, second)
  assert.equal(service.unmountFeature('usage', first), false, 'stale token cannot unmount newer owner')
  assert.equal(service.unmountFeature('usage', second), true)
  assert.equal(service.unmountFeature('usage', second), false)
  assert.throws(() => service.usage.query({}), (error) => {
    assert.ok(error instanceof PluginApiFeatureDisabledError)
    assert.equal(error.feature, 'usage')
    return true
  })
})

test('existing service surfaces remain untouched after usage additions', () => {
  const service = makeService({ coreActive: true })
  assert.equal(typeof service.tools.isActive, 'boolean')
  assert.throws(() => service.events.on('x', () => {}), (error) => error instanceof PluginApiFeatureDisabledError)
  assert.equal(typeof service.usage.record, 'function')
  assert.equal(typeof service.execution.observe, 'function')
})
