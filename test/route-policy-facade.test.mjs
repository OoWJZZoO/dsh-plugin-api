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
    apiVersion: '0.7',
    registry,
    coreActive: true,
    routePolicyProvider: () => owner,
  })
  const service = new ServiceClass({ reflect: { provide() {} } })
  assert.ok(Object.isFrozen(service.routePolicy))
  assert.throws(() => service.routePolicy.policy.register({}), (error) => {
    return error instanceof PluginApiFeatureDisabledError && error.feature === 'routePolicy'
  })
  owner = createOwner()
  assert.equal(service.routePolicy.availability().status, 'active')
  assert.equal(typeof service.routePolicy.policy.register, 'function')
  assert.equal(typeof service.routePolicy.health.observe, 'function')
  assert.equal(typeof service.routePolicy.circuit.status, 'function')
  assert.equal(typeof service.routePolicy.decisions.history, 'function')
  assert.equal(service.routing.availability.execution, false)
})
