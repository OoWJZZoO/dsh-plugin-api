import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'

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
