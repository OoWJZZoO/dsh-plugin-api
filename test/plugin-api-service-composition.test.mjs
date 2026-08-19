import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from '../lib/errors.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'

function serviceWithActiveCore() {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  return new ServiceClass({ reflect: { provide() {} }, get() { return { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} } } })
}

test('composition authority publishes additive immutable llm, agent, tools, session, and services views', () => {
  const service = serviceWithActiveCore()
  const route = Object.freeze({ provider: 'p', model: 'm' })
  service.mountFeature('llm', { isActive: true, stream() {} })
  service.mountFeature('llm/request', { transform() { return 'transform' } })
  service.mountFeature('llm/admission', { register() { return 'register' } })
  service.mountFeature('agent', () => ({ isActive: true, get() { return 'm1' }, list() { return [] }, roots() { return [] } }))
  service.mountFeature('agentExtension', { name: 'a11', compose(_ctx, base) { return { ...base, create() { return 'a11' } } } })
  service.mountFeature('tools', {})
  service.mountFeature('execRoute', { routeOf() { return route } })
  service.mountFeature('session', { get() { return 'm1-session' } })
  service.mountFeature('services', Object.freeze({ compaction: Object.freeze({ isActive: false }) }))

  assert.equal(service.llm.request.transform(), 'transform')
  assert.equal(service.llm.admission.register(), 'register')
  assert.equal(service.agent.get(), 'm1')
  assert.equal(service.agent.create(), 'a11')
  assert.equal(service.agent.routeOf({}), route)
  assert.equal(service.tools.routeOf({}), route)
  assert.equal(service.session.get(), 'm1-session')
  assert.equal(service.services.compaction.isActive, false)
  for (const view of [service.llm, service.agent, service.tools, service.session, service.services]) {
    assert.ok(Object.isFrozen(view))
  }
  assert.throws(() => { service.llm.request = {} }, TypeError)
  assert.throws(() => { service.session = {} }, TypeError)
})

test('slot rollback revokes retained L2/L4 references without touching a newer slot', () => {
  const service = serviceWithActiveCore()
  const first = service.prepareFeature('llm/request', { transform() { return 'first' } })
  first.commit()
  const retainedFirst = service.llm.request
  const second = service.prepareFeature('llm/request', { transform() { return 'second' } })
  second.commit()

  assert.equal(service.llm.request.transform(), 'second')
  assert.throws(
    () => retainedFirst.transform(),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'llm/request',
  )
  first.rollback()
  assert.equal(service.llm.request.transform(), 'second')
  second.rollback()
  assert.throws(() => service.llm.request.transform(), PluginApiFeatureDisabledError)
})

test('routing composes independent execution and session leaves with frozen availability', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.4', registry, coreActive: true })
  const service = new ServiceClass({ reflect: { provide() {} } })
  const exec = {}
  const execution = Object.freeze({ provider: 'p', model: 'm' })
  const session = {}
  const sessionRoute = Object.freeze({ provider: 'sp', model: 'sm' })
  const routing = service.routing
  assert.ok(Object.isFrozen(routing))
  service.mountFeature('execRoute', { routeOf(value) { return value === exec ? execution : undefined } })
  service.mountFeature('sessionRoute', {
    current(value) { return value === session ? sessionRoute : undefined },
    on() { return () => true },
    once() { return () => true },
    wait() { return Promise.resolve(sessionRoute) },
  })
  registry.mount('execRoute')
  registry.mount('sessionRoute')
  assert.equal(service.routing, routing, 'routing namespace identity is service-lifetime stable')
  assert.equal(routing.ofExecution(exec), execution)
  assert.equal(routing.current(session), sessionRoute)
  assert.deepEqual(routing.availability, { execution: true, session: true })
  assert.ok(Object.isFrozen(routing.availability))

  service.unmountFeature('execRoute', service._execRouteToken)
  registry.disable('execRoute', 'test teardown')
  assert.throws(() => routing.ofExecution(exec), PluginApiFeatureDisabledError)
  assert.equal(routing.current(session), sessionRoute)
  assert.deepEqual(service.routing.availability, { execution: false, session: true })
})

test('routing checks core and leaf guards before inspecting hostile inputs', () => {
  const registry = createFeatureRegistry()
  const Inert = createPluginApiService({ apiVersion: '0.4', registry, coreActive: false })
  const inert = new Inert({ reflect: { provide() {} } })
  const hostile = new Proxy({}, { get() { throw new Error('inspected') } })
  assert.throws(() => inert.routing.ofExecution(hostile), PluginApiInactiveError)
  assert.throws(() => inert.routing.current(hostile), PluginApiInactiveError)
  assert.throws(() => inert.routing.wait(hostile, { signal: hostile }), PluginApiInactiveError)
  assert.throws(() => inert.routing.availability, PluginApiInactiveError)

  const Active = createPluginApiService({ apiVersion: '0.4', registry, coreActive: true })
  const active = new Active({ reflect: { provide() {} } })
  assert.throws(() => active.routing.ofExecution(hostile), (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'execRoute')
  assert.throws(() => active.routing.current(hostile), (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'sessionRoute')
})
