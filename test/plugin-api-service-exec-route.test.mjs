import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from '../lib/errors.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'

function createService({ coreActive = true, logWriter, featureNotice, logger } = {}) {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.4', registry, coreActive, logWriter, featureNotice })
  const getCalls = []
  const ctx = {
    reflect: { provide() {} },
    logger: logger ?? { error() {} },
    get(name) {
      getCalls.push(name)
      return name === 'tools' ? { register() {} } : undefined
    },
  }
  return { service: new ServiceClass(ctx), getCalls }
}

test('execRoute core-inactive and feature-disabled delegates throw before inspecting input or official services', () => {
  const hostile = new Proxy({}, { get() { throw new Error('input inspected') } })
  const inert = createService({ coreActive: false })
  const disabled = createService()

  for (const routeMethod of [inert.service.llm.routing.forExecution, inert.service.llm.routing.current]) {
    assert.throws(() => routeMethod(hostile), PluginApiInactiveError)
  }
  assert.throws(
    () => disabled.service.llm.routing.forExecution(hostile),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'execRoute',
  )
  assert.throws(
    () => disabled.service.llm.routing.current(hostile),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'sessionRoute',
  )
  assert.deepEqual(inert.getCalls, [])
  assert.deepEqual(disabled.getCalls, [])
})

test('llm.routing.forExecution shares the mounted owner outcome without tools lookup', () => {
  const { service, getCalls } = createService()
  const exec = {}
  const snapshot = Object.freeze({ provider: 'provider-a', model: 'model-a' })
  const token = service.mountFeature('execRoute', { routeOf(received) { return received === exec ? snapshot : undefined } })
  service.mountFeature('tools', { isActive: true })
  service.mountFeature('agent', () => ({ isActive: true, get() {}, list() {}, roots() {} }))
  const lookupsBeforeRoute = getCalls.length

  assert.equal(service.llm.routing.forExecution(exec), snapshot)
  assert.equal(getCalls.length, lookupsBeforeRoute)
  assert.ok(token)
})

test('execRoute unmount is token-bound, idempotent, and restores feature-disabled', () => {
  const { service } = createService()
  const first = service.mountFeature('execRoute', { routeOf() { return { provider: 'first', model: 'first' } } })
  const second = service.mountFeature('execRoute', { routeOf() { return { provider: 'second', model: 'second' } } })

  assert.equal(service.unmountFeature('execRoute', first), false)
  assert.deepEqual(service.llm.routing.forExecution({}), { provider: 'second', model: 'second' })
  assert.equal(service.unmountFeature('execRoute', second), true)
  assert.equal(service.unmountFeature('execRoute', second), false)
  assert.throws(
    () => service.llm.routing.forExecution({}),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'execRoute',
  )
})

test('execRoute feature-disabled diagnostic ledger deduplicates per key while preserving distinct keys', () => {
  const writes = []
  const notices = []
  const logged = []
  const { service } = createService({
    logWriter(problems) {
      writes.push(problems)
      return '/tmp/guard.log'
    },
    featureNotice(feature, path) {
      notices.push([feature, path])
      return `${feature}:${path}`
    },
    logger: { error(message) { logged.push(message) } },
  })
  const problems = [{ name: 'ctx.on', detail: 'missing' }]

  assert.equal(service._reportExecRouteDiagnosticsOnce('guard', 'mandatory-substrate', problems), true)
  assert.equal(service._reportExecRouteDiagnosticsOnce('guard', 'mandatory-substrate', problems), false)
  assert.equal(service._reportExecRouteDiagnosticsOnce('mount', 'dependency-or-registration', problems), true)
  assert.equal(writes.length, 2)
  assert.equal(notices.length, 2)
  assert.deepEqual(logged, ['execRoute:/tmp/guard.log', 'execRoute:/tmp/guard.log'])
})

test('execRoute feature-disabled diagnostic failures remain inert', () => {
  const { service } = createService({
    logWriter() { throw new Error('write failed') },
    featureNotice() { throw new Error('notice failed') },
    logger: { error() { throw new Error('logger failed') } },
  })

  assert.doesNotThrow(() => service._reportExecRouteDiagnosticsOnce('activation', 'publication', []))
  assert.equal(service._reportExecRouteDiagnosticsOnce('activation', 'publication', []), false)
})

test('existing agent and tools forwarding remains available after execRoute additions', () => {
  const { service } = createService()
  const agentApi = { isActive: true, get: () => 'agent', list: () => [], roots: () => [] }
  service.mountFeature('agent', () => agentApi)

  assert.equal(service.agents.get(), 'agent')
  assert.deepEqual(service.agents.list(), [])
  assert.deepEqual(service.agents.roots(), [])
})