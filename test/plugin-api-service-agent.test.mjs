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

function assertDisabledView(agents) {
  assert.equal(agents.isActive, false)
  for (const method of ['get', 'list', 'roots']) {
    assert.throws(() => agents[method]('x'), (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'agents')
      assert.doesNotMatch(error.message, /agents extension member/)
      return true
    })
  }
  for (const method of ['create', 'resume', 'register']) {
    assert.throws(() => agents[method]('x'), (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'agents')
      assert.match(error.message, new RegExp(`agents extension member "${method}"`))
      return true
    })
  }
  for (const method of ['enter', 'announce', 'setFactory']) {
    assert.throws(() => agents.providers[method]('x'), (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'agents')
      assert.match(error.message, new RegExp(`providers\\.${method}`))
      return true
    })
  }
  assert.equal(agents.providers.isActive, false)
  assert.deepEqual(Object.keys(agents.providers), ['isActive', 'enter', 'announce', 'setFactory'])
  const availability = agents.availability()
  assert.deepEqual(availability, {
    status: 'unavailable',
    create: false,
    resume: false,
    register: false,
    providers: { enter: false, announce: false, setFactory: false },
  })
  assert.ok(Object.isFrozen(availability))
  assert.ok(Object.isFrozen(agents.providers))
}

test('active service exposes the complete disabled agents stub without official service calls', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const ctx = mockCtx()
  const service = new ServiceClass(ctx)

  assertDisabledView(service.agents)
  assert.equal(ctx.getCalls.length, 0)
})

test('inert service throws inactive errors from every declared agents member', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: false })
  const ctx = mockCtx()
  const service = new ServiceClass(ctx)
  const agents = service.agents

  assert.equal(agents.isActive, false)
  for (const method of ['get', 'list', 'roots', 'create', 'resume', 'register']) {
    assert.throws(() => agents[method]('x'), PluginApiInactiveError)
  }
  for (const method of ['enter', 'announce', 'setFactory']) {
    assert.throws(() => agents.providers[method]('x'), PluginApiInactiveError)
  }
  assert.equal(agents.providers.isActive, false)
  assert.deepEqual(Object.keys(agents.providers), ['isActive', 'enter', 'announce', 'setFactory'])
  const inertAvailability = agents.availability()
  assert.deepEqual(inertAvailability, {
    status: 'unavailable',
    create: false,
    resume: false,
    register: false,
    providers: { enter: false, announce: false, setFactory: false },
  })
  assert.ok(Object.isFrozen(inertAvailability))
  assert.ok(Object.isFrozen(agents.providers))
  assert.equal(ctx.getCalls.length, 0)
})

test('mountFeature installs an agents facade factory', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass(mockCtx())
  const agentApi = { isActive: true, get() {}, list() {}, roots() {} }

  service.mountFeature('agent', () => agentApi)

  assert.equal(service.agents.get, agentApi.get)
  assert.equal(service.agents.list, agentApi.list)
  assert.ok(Object.isFrozen(service.agents))
})

test('agents mount tokens restore exact prior factory and stale cleanup is isolated', () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const service = new ServiceClass(mockCtx())
  const first = { name: 'first' }
  const second = { name: 'second' }
  const firstToken = service.mountFeature('agent', () => first)
  const secondToken = service.mountFeature('agent', () => second)

  assert.equal(service.agents.name, second.name)
  assert.equal(service.unmountFeature('agent', firstToken), false)
  assert.equal(service.agents.name, second.name)
  assert.equal(service.unmountFeature('agent', secondToken), true)
  assert.equal(service.agents.name, first.name)
  assert.equal(service.unmountFeature('agent', secondToken), false)
})

test('agents facade factory receives the consuming context for official reads', () => {
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

  assert.equal(traced.agents.get('a-1').owner, 'consumer')
  assert.deepEqual(traced.agents.list(), [])
  assert.deepEqual(traced.agents.roots(), [])
})