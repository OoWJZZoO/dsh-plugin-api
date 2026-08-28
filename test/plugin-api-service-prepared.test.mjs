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
  return {
    reflect: { provide() {} },
    get() {
      return undefined
    },
  }
}

function activeService() {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  return instantiate(ServiceClass, mockCtx())
}

test('prepareFeature captures the candidate without publishing anything', () => {
  const service = activeService()
  const api = { transform() {}, isActive: true }

  const prepared = service.prepareFeature('llm/request', api)

  // Public facade unchanged before commit.
  assert.notEqual(service.llm.requestTransforms, api)
  assert.throws(
    () => service.llm.requestTransforms.register({}),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'llm/request',
  )
  assert.ok(prepared)
})

test('commit publishes exactly once through the same assignment path', () => {
  const service = activeService()
  const api = { transform() {}, isActive: true }
  const prepared = service.prepareFeature('llm/request', api)

  assert.equal(prepared.commit(), true)
  assert.equal(service.llm.requestTransforms.register, service.llm.requestTransforms.register)
  assert.ok(Object.isFrozen(service.llm.requestTransforms))
  assert.equal(prepared.commit(), false, 'commit is idempotent')
  assert.equal(typeof service.llm.requestTransforms.register, 'function')
})

test('rollback discards an uncommitted candidate and leaves the disabled surface', () => {
  const service = activeService()
  const prepared = service.prepareFeature('llm/request', { transform() {} })

  assert.equal(prepared.rollback(), true)
  assert.throws(
    () => service.llm.requestTransforms.register({}),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'llm/request',
  )
  assert.equal(prepared.commit(), false, 'commit after rollback is refused')
  assert.equal(prepared.rollback(), false, 'rollback is idempotent')
})

test('rollback after commit restores the disabled facade surface', () => {
  const service = activeService()
  const api = { transform() {}, isActive: true }
  const prepared = service.prepareFeature('llm/request', api)
  prepared.commit()
  assert.equal(typeof service.llm.requestTransforms.register, 'function')

  assert.equal(prepared.rollback(), true)
  assert.throws(
    () => service.llm.requestTransforms.register({}),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'llm/request',
  )
  assert.equal(prepared.rollback(), false)
})

test('a stale transaction cannot alter a later mount', () => {
  const service = activeService()
  const firstApi = { transform() {}, isActive: true }
  const secondApi = { transform() {}, isActive: true }
  const first = service.prepareFeature('llm/request', firstApi)
  first.commit()

  // A later transaction publishes over the first one.
  const second = service.prepareFeature('llm/request', secondApi)
  second.commit()
  assert.equal(typeof service.llm.requestTransforms.register, 'function')

  // The stale transaction's rollback must not disturb the newer mount.
  first.rollback()
  assert.equal(typeof service.llm.requestTransforms.register, 'function', 'stale rollback leaves the newer API in place')
  assert.equal(typeof service.llm.requestTransforms.register, 'function')

  // The owner transaction still rolls back cleanly.
  second.rollback()
  assert.throws(
    () => service.llm.requestTransforms.register({}),
    (error) => error instanceof PluginApiFeatureDisabledError,
  )
})

test('prepareFeature rejects unknown names, tools, and the merged llm surface', () => {
  const service = activeService()
  assert.throws(
    () => service.prepareFeature('no/such-feature', {}),
    (error) => error instanceof PluginApiFeatureDisabledError,
  )
  assert.throws(() => service.prepareFeature('tools', {}), PluginApiFeatureDisabledError)
  assert.throws(() => service.prepareFeature('llm', {}), PluginApiFeatureDisabledError)
})

test('admission and request prepared surfaces roll back to their disabled shapes', () => {
  const service = activeService()
  const admissionApi = { register() {} }
  const admissionPrepared = service.prepareFeature('llm/admission', admissionApi)
  admissionPrepared.commit()
  assert.equal(typeof service.llm.admissionPolicies.register, 'function')
  admissionPrepared.rollback()
  assert.throws(
    () => service.llm.admissionPolicies.register({}),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'llm/admission',
  )

  const requestApi = { transform() {} }
  const requestPrepared = service.prepareFeature('llm/request', requestApi)
  requestPrepared.commit()
  assert.equal(typeof service.llm.requestTransforms.register, 'function')
  requestPrepared.rollback()
  assert.throws(
    () => service.llm.requestTransforms.register({}),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'llm/request',
  )
})

test('immediate mountFeature behavior is unchanged for baseline mounters', () => {
  const service = activeService()
  const eventsApi = { on() {}, catalog: {} }
  service.mountFeature('events', eventsApi)
  assert.equal(service.events.on, eventsApi.on)
  assert.ok(Object.isFrozen(service.events))
  assert.equal(service.events.catalog, eventsApi.catalog)

  const llmApi = { isActive: true, stream() {}, modelInfo() {} }
  service.mountFeature('llm', llmApi)
  assert.equal(service.llm.isActive, true)
  assert.equal(service.llm.stream, llmApi.stream)
})

test('inactive service keeps core-inactive precedence on disabled prepared surfaces', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: false })
  const service = instantiate(ServiceClass, mockCtx())

  assert.throws(() => service.llm.requestTransforms.register({}), PluginApiInactiveError)
  assert.throws(() => service.llm.admissionPolicies.register({}), PluginApiInactiveError)
  assert.throws(() => service.llm.requestTransforms.register({}), PluginApiInactiveError)
})
