import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'
import { createRoutePolicyOwner } from '../packages/agent-loop/lib/route-policy.js'

function createOwner() {
  const policy = { register() { return () => {} } }
  const candidates = { register() { return () => {} }, list() { return Promise.resolve([]) } }
  const health = { observe() {}, registerCircuitPolicy() { return () => {} }, registerProbe() { return () => {} } }
  const circuit = { status() { return { state: 'closed' } } }
  const decisions = { get() {}, history() { return { items: [], truncated: false } } }
  return {
    policy,
    candidates,
    health,
    circuit,
    decisions,
    availability() { return { status: 'active' } },
  }
}

test('route policy facade is additive and typed-unavailable until replacement gates pass', () => {
  const registry = createFeatureRegistry()
  let owner = null
  const ServiceClass = createPluginApiService({
    apiVersion: '0.1',
    registry,
    coreActive: true,
    routePolicyProvider: () => owner,
  })
  const service = new ServiceClass({ reflect: { provide() {} } })
  assert.ok(Object.isFrozen(service.llm.routing))
  assert.throws(() => service.llm.routing.policies.register({}), (error) => {
    return error instanceof PluginApiFeatureDisabledError && error.feature === 'llm.routing'
  })
  owner = createOwner()
  assert.equal(typeof service.llm.routing.policies.register, 'function')
  assert.equal(typeof service.llm.routing.health.observe, 'function')
  assert.equal(typeof service.llm.routing.circuit.inspect, 'function')
  assert.equal(typeof service.llm.routing.decisions.history, 'function')
})

test('routing registrations derive their owner from the calling plugin', () => {
  const registry = createFeatureRegistry()
  const owner = createRoutePolicyOwner({})
  const ServiceClass = createPluginApiService({
    apiVersion: '0.1',
    registry,
    coreActive: true,
    routePolicyProvider: () => owner.api,
  })
  const service = new ServiceClass({ reflect: { provide() {} } })
  const forCaller = (name) => {
    const shadow = Object.create(service)
    Object.defineProperty(shadow, 'ctx', { value: { fiber: { name } }, enumerable: true })
    return shadow
  }
  const definition = { id: 'route-a', decide: () => null }
  const first = forCaller('plugin-a').llm.routing.policies.register(definition)
  assert.equal(first.ownerId, 'plugin-a', 'the owner is derived from the calling plugin, never declared')
  assert.equal(first.id, 'route-a')

  // Same owner and id is latest-wins; another owner on the same id is a typed
  // conflict the public path can now reach.
  const replaced = forCaller('plugin-a').llm.routing.policies.register(definition)
  assert.equal(replaced.ownerId, 'plugin-a')
  assert.throws(
    () => forCaller('plugin-b').llm.routing.policies.register(definition),
    (error) => error.code === 'ROUTE_POLICY_OWNER_CONFLICT',
  )
  assert.equal(first.dispose().code, 'stale', 'a superseded handle answers a typed stale no-op')
  assert.equal(replaced.dispose().code, 'revoked')
  owner.dispose()
})
