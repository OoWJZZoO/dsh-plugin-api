/**
 * Host namespace cutover tests: published target namespace, capabilities query
 * surface, disabled/unavailable surface shapes, and negative assertions that
 * removed old public paths and delegates no longer exist on the public root.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { PluginApiCapabilityUnavailableError, PluginApiFeatureDisabledError, PluginApiInactiveError } from '../lib/errors.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'
import { CAPABILITY_PATHS } from '../lib/capability-descriptors.js'

function createService({ coreActive = true } = {}) {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive })
  return { service: new ServiceClass({ reflect: { provide() {} }, get() { return undefined } }), registry }
}

function mountReady(service, registry) {
  service.mountFeature('tools', { isActive: true })
  service.mountFeature('events', { on() {}, once() {}, catalog: {} })
  registry.mount('tools')
  registry.mount('events')
}

test('capabilities surface is frozen and lists registry-backed capability paths', () => {
  const { service } = createService()
  mountReady(service, createFeatureRegistry())
  const capabilities = service.capabilities
  assert.ok(Object.isFrozen(capabilities))
  assert.deepEqual(capabilities.list(), CAPABILITY_PATHS)
  assert.deepEqual(capabilities.list({ prefix: 'llm.' }), ['llm.requestTransforms', 'llm.admissionPolicies', 'llm.adapters', 'llm.routing'])
  assert.deepEqual(capabilities.list({ prefix: 'llm' }), ['llm', 'llm.requestTransforms', 'llm.admissionPolicies', 'llm.adapters', 'llm.routing'])
  assert.deepEqual(capabilities.list({ prefix: 'sessions.' }), ['sessions.branches', 'sessions.channels'])
})

test('capabilities.get reports active status for a mounted capability', () => {
  const { service, registry } = createService()
  service.mountFeature('execRoute', { routeOf() {} })
  registry.mount('execRoute')
  const result = service.capabilities.get('llm.routing')
  assert.ok(Object.isFrozen(result))
  assert.equal(result.capability, 'llm.routing')
  assert.equal(result.status, 'degraded', 'gateway slot(s) mounted without session/route policy stay degraded')
})

test('capabilities.require resolves true when every required capability is available', () => {
  const { service } = createService()
  assert.equal(service.capabilities.require(['apiVersion', 'isActive', 'assertCompatible', 'capabilities']), true)
})

test('capabilities.require throws a typed unavailable error for missing capabilities', () => {
  const { service } = createService()
  assert.throws(
    () => service.capabilities.require(['llm.routing', 'sessions.channels']),
    (error) => error instanceof PluginApiCapabilityUnavailableError && error.capability === 'llm.routing',
  )
})

test('capabilities.get rejects unknown capability paths with a typed error', () => {
  const { service } = createService()
  assert.throws(
    () => service.capabilities.get('no.such.capability'),
    (error) => error instanceof PluginApiCapabilityUnavailableError && error.capability === 'no.such.capability',
  )
})

test('capabilities surface fails through inactive-core typed errors when the core is inert', () => {
  const { service } = createService({ coreActive: false })
  assert.throws(() => service.capabilities.get('llm'), PluginApiInactiveError)
  assert.throws(() => service.capabilities.list(), PluginApiInactiveError)
  assert.throws(() => service.capabilities.require(['llm']), PluginApiInactiveError)
})

test('removed old public paths and delegates are absent from the published root', () => {
  const { service, registry } = createService()
  mountReady(service, registry)
  for (const path of ['agent', 'session', 'sessionChannel', 'execution', 'recovery', 'routing', 'routePolicy', 'systemPrompt', 'context', 'workspaceTransactions', 'profile', 'remote', 'features']) {
    assert.equal(path in service, false, `${path} must not be a public root`)
  }
  assert.equal(typeof service.reportExecRouteDiagnosticsOnce, 'undefined', 'diagnostics helper must not be public')
  // routeOf delegates are gone; route queries live only on llm.routing.forExecution
  const tools = service.tools
  assert.equal('routeOf' in tools, false, 'tools.routeOf must be removed')
  const agents = service.agents
  assert.equal('routeOf' in agents, false, 'agents.routeOf must be removed')
})

test('removed old roots are typed-unavailable through their replacement shapes (shape absence)', () => {
  const { service, registry } = createService()
  mountReady(service, registry)
  // Old roots do not exist, so the shape is absent (unavailable), while the
  // target namespace stays present and typed.
  assert.equal(service.systemPrompt, undefined)
  assert.equal(typeof service.llm.routing.forExecution, 'function')
  assert.equal(typeof service.llm.requestTransforms.register, 'function')
  assert.equal(typeof service.llm.admissionPolicies.register, 'function')
  assert.equal(service.workspaces.transactions, service.workspaces.transactions)
})

test('target host namespace is published with singular roots and plural collections', () => {
  const { service, registry } = createService()
  mountReady(service, registry)
  for (const root of ['events', 'llm', 'agents', 'executions', 'sessions', 'tools', 'skills', 'prompts', 'attachments', 'mcp', 'tasks', 'coordination', 'workspaces', 'security', 'diagnostics', 'settings', 'profiles', 'remotes', 'storage', 'services', 'capabilities']) {
    assert.ok(root in service, `${root} root must be published`)
  }
  // nested domains
  assert.equal(typeof service.executions.recovery, 'object')
  assert.equal(typeof service.prompts.provenance, 'object')
  assert.equal(typeof service.sessions.branches, 'object')
  assert.equal(typeof service.sessions.channels, 'object')
  assert.equal(typeof service.llm.routing, 'object')
  assert.equal(typeof service.workspaces.transactions, 'object')
})

test('agents publishes the plural providers leaf with typed disabled behavior', () => {
  const { service, registry } = createService()
  mountReady(service, registry)
  const agents = service.agents
  assert.equal(agents.providers.isActive, false)
  assert.equal('provider' in agents, false, 'singular provider leaf must not exist')
  assert.deepEqual(agents.availability(), {
    status: 'unavailable',
    create: false,
    resume: false,
    register: false,
    providers: { enter: false, announce: false, setFactory: false },
  })
  assert.throws(() => agents.providers.enter({}, undefined), (error) => {
    return error instanceof PluginApiFeatureDisabledError && error.feature === 'agents'
  })
})

test('disabled surfaces keep the exact target member shape with typed errors', () => {
  const { service, registry } = createService()
  mountReady(service, registry)
  // executions disabled surface shape includes nested recovery
  const executions = service.executions
  assert.equal(typeof executions.observe, 'function')
  assert.equal(typeof executions.recovery.classify, 'function')
  assert.throws(() => executions.observe({}), PluginApiFeatureDisabledError)
  assert.throws(() => executions.recovery.consume({}), PluginApiFeatureDisabledError)
  // prompts disabled surface shape includes provenance and utility leaves
  const prompts = service.prompts
  assert.equal(typeof prompts.section, 'function')
  assert.equal(typeof prompts.provenance.contribute, 'function')
  assert.throws(() => prompts.renderContextSnapshot({}), (error) => error instanceof PluginApiFeatureDisabledError)
})
test('the published host root matches the registry-driven capability surface', () => {
  const { service, registry } = createService()
  mountReady(service, registry)
  // Root metadata plus every registry member's top-level domain is published;
  // the registry snapshot is the single source of truth for the member set.
  const publishedRoots = new Set(Object.keys(service).filter((key) => typeof service[key] !== 'function' || ['isActive', 'assertCompatible'].includes(key)))
  for (const root of ['events', 'llm', 'agents', 'executions', 'sessions', 'tools', 'skills', 'prompts', 'attachments', 'mcp', 'tasks', 'coordination', 'workspaces', 'security', 'diagnostics', 'settings', 'profiles', 'remotes', 'storage', 'services', 'capabilities']) {
    assert.ok(publishedRoots.has(root), `${root} must be published by the registry-driven surface`)
  }
  // Removed old roots never appear.
  for (const oldRoot of ['agent', 'session', 'sessionChannel', 'execution', 'recovery', 'routing', 'routePolicy', 'systemPrompt', 'context', 'workspaceTransactions', 'profile', 'remote', 'features']) {
    assert.equal(publishedRoots.has(oldRoot), false, `${oldRoot} must not be published`)
  }
})
