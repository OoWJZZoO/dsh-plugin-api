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

function assertDisabledView(agent) {
  assert.equal(agent.isActive, false)
  for (const method of ['get', 'list', 'roots']) {
    assert.throws(() => agent[method]('x'), (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'agent')
      assert.doesNotMatch(error.message, /agent extension member/)
      return true
    })
  }
  for (const method of ['create', 'resume', 'register']) {
    assert.throws(() => agent[method]('x'), (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'agent')
      assert.match(error.message, new RegExp(`agent extension member "${method}"`))
      return true
    })
  }
  for (const method of ['enter', 'announce', 'setFactory']) {
    assert.throws(() => agent.provider[method]('x'), (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'agent')
      assert.match(error.message, new RegExp(`provider\\.${method}`))
      return true
    })
  }
  assert.equal(agent.provider.isActive, false)
  assert.deepEqual(Object.keys(agent.provider), ['isActive', 'enter', 'announce', 'setFactory'])
  assert.deepEqual(agent.availability, {
    create: false,
    resume: false,
    register: false,
    provider: { enter: false, announce: false, setFactory: false },
  })
  assert.ok(Object.isFrozen(agent.availability))
  assert.ok(Object.isFrozen(agent.availability.provider))
  assert.ok(Object.isFrozen(agent.provider))
}

test('active service exposes the complete disabled agent stub without official service calls', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const ctx = mockCtx()
  const service = new ServiceClass(ctx)

  assertDisabledView(service.agent)
  assert.equal(ctx.getCalls.length, 0)
})

test('inert service throws inactive errors from every declared agent member', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: false })
  const ctx = mockCtx()
  const service = new ServiceClass(ctx)
  const agent = service.agent

  assert.equal(agent.isActive, false)
  for (const method of ['get', 'list', 'roots', 'create', 'resume', 'register']) {
    assert.throws(() => agent[method]('x'), PluginApiInactiveError)
  }
  for (const method of ['enter', 'announce', 'setFactory']) {
    assert.throws(() => agent.provider[method]('x'), PluginApiInactiveError)
  }
  assert.equal(agent.provider.isActive, false)
  assert.deepEqual(Object.keys(agent.provider), ['isActive', 'enter', 'announce', 'setFactory'])
  assert.deepEqual(agent.availability, {
    create: false,
    resume: false,
    register: false,
    provider: { enter: false, announce: false, setFactory: false },
  })
  assert.ok(Object.isFrozen(agent.availability))
  assert.ok(Object.isFrozen(agent.availability.provider))
  assert.ok(Object.isFrozen(agent.provider))
  assert.equal(ctx.getCalls.length, 0)
})

test('mountFeature installs an agent facade factory', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass(mockCtx())
  const agentApi = { isActive: true, get() {}, list() {}, roots() {} }

  service.mountFeature('agent', () => agentApi)

  assert.equal(service.agent.get, agentApi.get)
  assert.equal(service.agent.list, agentApi.list)
  assert.ok(Object.isFrozen(service.agent))
})

test('agent mount tokens restore exact prior factory and stale cleanup is isolated', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass(mockCtx())
  const first = { name: 'first' }
  const second = { name: 'second' }
  const firstToken = service.mountFeature('agent', () => first)
  const secondToken = service.mountFeature('agent', () => second)

  assert.equal(service.agent.name, second.name)
  assert.equal(service.unmountFeature('agent', firstToken), false)
  assert.equal(service.agent.name, second.name)
  assert.equal(service.unmountFeature('agent', secondToken), true)
  assert.equal(service.agent.name, first.name)
  assert.equal(service.unmountFeature('agent', secondToken), false)
})

test('agent facade factory receives the consuming context for official reads', () => {
  const registry = createFeatureRegistry()
  const host = mockCtx()
  const consumerAgents = { get(id) { return { id, owner: 'consumer' } }, list() { return [] }, roots() { return [] } }
  const consumer = { get(name) { return name === 'agents' ? consumerAgents : undefined } }
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass(host)
  service.mountFeature('agent', (ctx) => ({
    isActive: true,
    get(id) { return ctx.get('agents').get(id) },
    list() { return ctx.get('agents').list() },
    roots() { return ctx.get('agents').roots() },
  }))
  const traced = Object.create(service)
  traced.ctx = consumer
  assert.deepEqual(traced.agent.get('x'), { id: 'x', owner: 'consumer' })
  assert.deepEqual(host.getCalls, [])
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
