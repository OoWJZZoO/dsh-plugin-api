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
  service.mountFeature('agentExtension', { name: 'agent-extension', compose(_ctx, base) { return { ...base, create() { return 'agent-extension' } } } })
  service.mountFeature('tools', {})
  service.mountFeature('execRoute', { routeOf() { return route } })
  service.mountFeature('session', { get() { return 'm1-session' } })
  service.mountFeature('services', Object.freeze({ compaction: Object.freeze({ isActive: false }) }))

  assert.equal(service.llm.requestTransforms.register(), 'transform')
  assert.equal(service.llm.admissionPolicies.register(), 'register')
  assert.equal(service.agents.get(), 'm1')
  assert.equal(service.agents.create(), 'agent-extension')
  assert.equal(service.llm.routing.forExecution({}), route)
  assert.equal(service.sessions.get(), 'm1-session')
  assert.equal(service.services.compaction.isActive, false)
  for (const view of [service.llm, service.agents, service.tools, service.sessions, service.services]) {
    assert.ok(Object.isFrozen(view))
  }
  assert.throws(() => { service.llm.requestTransforms = {} }, TypeError)
  assert.throws(() => { service.sessions = {} }, TypeError)
})

test('slot rollback revokes retained image admission/compat request references without touching a newer slot', () => {
  const service = serviceWithActiveCore()
  const first = service.prepareFeature('llm/request', { transform() { return 'first' } })
  first.commit()
  const retainedFirst = service.llm.requestTransforms
  const second = service.prepareFeature('llm/request', { transform() { return 'second' } })
  second.commit()

  assert.equal(service.llm.requestTransforms.register(), 'second')
  assert.equal(retainedFirst, service.llm.requestTransforms, 'leaf wrapper identity stays service-lifetime stable')
  assert.equal(retainedFirst.register(), 'second', 'retained wrapper resolves the current slot')
  first.rollback()
  assert.equal(service.llm.requestTransforms.register(), 'second')
  second.rollback()
  assert.throws(() => service.llm.requestTransforms.register(), PluginApiFeatureDisabledError)
})

test('routing composes independent execution and session leaves with frozen surface', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.4', registry, coreActive: true })
  const service = new ServiceClass({ reflect: { provide() {} } })
  const exec = {}
  const execution = Object.freeze({ provider: 'p', model: 'm' })
  const session = {}
  const sessionRoute = Object.freeze({ provider: 'sp', model: 'sm' })
  const routing = service.llm.routing
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
  assert.equal(service.llm.routing, routing, 'routing namespace identity is service-lifetime stable')
  assert.equal(routing.forExecution(exec), execution)
  assert.equal(routing.current(session), sessionRoute)
  assert.equal(typeof routing.policies.register, 'function')

  service.unmountFeature('execRoute', service._execRouteToken)
  registry.disable('execRoute', 'test teardown')
  assert.throws(() => routing.forExecution(exec), PluginApiFeatureDisabledError)
  assert.equal(routing.current(session), sessionRoute)
  // capability availability is reported through the capabilities query surface
  assert.equal(service.capabilities.get('llm.routing').status, 'degraded')
})

test('routing checks core and leaf guards before inspecting hostile inputs', () => {
  const registry = createFeatureRegistry()
  const Inert = createPluginApiService({ apiVersion: '0.4', registry, coreActive: false })
  const inert = new Inert({ reflect: { provide() {} } })
  const hostile = new Proxy({}, { get() { throw new Error('inspected') } })
  assert.throws(() => inert.llm.routing.forExecution(hostile), PluginApiInactiveError)
  assert.throws(() => inert.llm.routing.current(hostile), PluginApiInactiveError)
  assert.throws(() => inert.llm.routing.wait(hostile, { signal: hostile }), PluginApiInactiveError)
  assert.throws(() => inert.llm.routing.policies.register(hostile), PluginApiInactiveError)

  const Active = createPluginApiService({ apiVersion: '0.4', registry, coreActive: true })
  const active = new Active({ reflect: { provide() {} } })
  assert.throws(() => active.llm.routing.forExecution(hostile), (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'llm.routing')
  assert.throws(() => active.llm.routing.current(hostile), (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'llm.routing')
})
