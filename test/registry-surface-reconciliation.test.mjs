/**
 * Runtime ↔ registry reconciliation.
 *
 * The host facade is mounted over the in-repo owner services and every public
 * leaf is walked (skipping `_`-prefixed internals and the `services.*`
 * whitelist); every walked member must have a canonical registry row. The
 * client half reconciles the other way around plus the root roster: every
 * shipped client row resolves on the live surface, and the root roster mirrors
 * `clientDomainTree`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { apply as applyHost } from '../lib/index.js'
import { apply as applyClient } from '../lib/client-runtime.js'
import { bootFixture, settleAll } from './official-passthrough-fixture.mjs'

const registry = JSON.parse(readFileSync(
  new URL('../docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json', import.meta.url),
  'utf8',
))

function createHostHarness() {
  const services = {
    storage: { domain: { open() { return Promise.resolve({ store: {} }) } } },
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() { return () => {} }, guard() { return () => {} }, get() {}, schemas() { return [] }, execute() {}, presentAs() {} },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {}, observe() { return () => {} } },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    systemPrompt: { section() { return () => {} }, context() { return () => {} }, variable() { return () => {} }, tools() { return () => {} }, suppressRuntimeContext() { return () => {} }, renderPrompt() {}, renderContextSections() {}, renderContextSnapshot() {}, joinContextSections() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
  }
  const state = { pluginApi: undefined }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect() { return () => {} },
    on() { return () => {} },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
    model() { return { name: 'x' } },
    runtime: { name: 'test', version: '0.1.0-rc.6' },
  }
  return { ctx, state }
}

const SKIP_KEYS = new Set(['ctx', 'name', 'apiVersion'])

const walkLeaves = (root) => {
  const leaves = new Set()
  const walk = (node, prefix) => {
    let keys
    try {
      keys = Object.keys(node)
    } catch {
      return
    }
    for (const key of keys) {
      if (key.startsWith('_') || SKIP_KEYS.has(key)) continue
      const path = prefix ? `${prefix}.${key}` : key
      if (path === 'services' || path.startsWith('services.')) continue
      let value
      try {
        value = node[key]
      } catch {
        continue
      }
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        if (Object.keys(value).length > 0) {
          walk(value, path)
          continue
        }
      }
      leaves.add(path)
    }
  }
  walk(root, '')
  return leaves
}

test('host runtime surface reconciles with the registry (no non-services gap)', () => {
  const { ctx, state } = createHostHarness()
  applyHost(ctx)
  const api = state.pluginApi
  assert.ok(api, 'the host root is published')
  const leaves = walkLeaves(api)
  assert.ok(leaves.size > 200, `the walk covers the meaningful surface, saw ${leaves.size}`)
  const shipped = new Set(
    registry.members
      .filter((member) => member.runtime === 'host' && member.status !== 'removed')
      .map((member) => member.publicPath),
  )
  const gaps = [...leaves].filter((path) => !shipped.has(path)).sort()
  assert.deepEqual(gaps, [], `every non-services host member must have a registry row: ${gaps.join(', ')}`)
})

test('client root roster and shipped client rows reconcile with the live surface', async () => {
  const { ctx } = bootFixture()
  const dispose = applyClient(ctx)
  await settleAll()
  const api = ctx.get('pluginApi')
  assert.ok(api, 'the client root is published')

  const resolveRoot = (path) => {
    let node = api
    for (const segment of path.split('.')) {
      if (node === null || node === undefined) return undefined
      try {
        node = node[segment]
      } catch {
        return undefined
      }
    }
    return node
  }
  const missingRoots = registry.clientDomainTree.filter((root) => resolveRoot(root) === undefined)
  assert.deepEqual(missingRoots, [], `every client domain root resolves on the live surface: ${missingRoots.join(', ')}`)

  const resolve = (path) => {
    let node = api
    for (const segment of path.split('.')) {
      if (node === null || node === undefined) return undefined
      try {
        node = node[segment]
      } catch {
        return undefined
      }
    }
    return node
  }
  // `.handle` rows register a shape, not a navigable member: they never
  // resolve on the surface by design.
  const missing = registry.members
    .filter((member) => member.runtime === 'client' && member.status !== 'removed')
    .map((member) => member.publicPath)
    .filter((path) => !path.endsWith('.handle'))
    .filter((path) => resolve(path) === undefined)
  assert.deepEqual(missing, [], `every shipped client row must resolve on the live surface: ${missing.join(', ')}`)
  await dispose()
})

test('capabilities resolve member paths to the nearest cluster and answer unknown paths without throwing', () => {
  const { ctx, state } = createHostHarness()
  applyHost(ctx)
  const api = state.pluginApi

  // A member path answers with its nearest registered capability cluster.
  const memberPath = api.capabilities.get('executions.observe')
  assert.equal(memberPath.capability, 'executions.observe')
  assert.equal(memberPath.status, api.capabilities.get('executions').status)

  // A live services member resolves to the services cluster, while a path that
  // does not resolve never inherits a namespace status.
  const servicesMember = api.capabilities.get('services.web')
  assert.equal(servicesMember.status, api.capabilities.get('services').status)
  for (const unknown of ['executions.no-such-member', 'no.such.capability', 'slots.contribute.deep']) {
    const descriptor = api.capabilities.get(unknown)
    assert.equal(descriptor.capability, unknown)
    assert.equal(descriptor.status, 'unavailable')
    assert.equal(descriptor.reason, 'unknown capability', `${unknown} answers the unknown result`)
  }
  // `require` keeps the typed throw for unknown and unavailable paths alike.
  assert.throws(
    () => api.capabilities.require(['no.such.capability']),
    (error) => error.code === 'PLUGIN_API_CAPABILITY_UNAVAILABLE',
  )
})
