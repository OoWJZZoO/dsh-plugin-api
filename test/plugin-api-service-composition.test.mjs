import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'
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
