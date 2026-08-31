import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginApiService } from '../lib/plugin-api-service.js'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from '../lib/errors.js'

function makeService({ coreActive = true } = {}) {
  const registry = createFeatureRegistry()
  const Service = createPluginApiService({
    apiVersion: '0.1',
    registry,
    coreActive,
  })
  const ctx = {
    reflect: { provide() {} },
    logger: { error() {}, warn() {} },
    get() {
      return undefined
    },
  }
  return new Service(ctx)
}

function makeDiscoveryOwner() {
  return {
    catalog: {
      register(spec) {
        return { generation: `g:${spec.id}`, dispose: () => true }
      },
    },
    search(query) {
      return { descriptors: [{ id: 'alpha', summary: 's', capabilities: [], sourceKind: 'plugin' }], exclusions: [], constraint: { status: 'none' } }
    },
    activate() {
      return Promise.resolve({ generation: 'g:1', dispose: () => ({ ok: true }) })
    },
    deactivate() {
      return { ok: true }
    },
    audit: {
      query() {
        return { items: [], truncated: false }
      },
    },
    availability() {
      return { active: true, catalog: { registered: 1 } }
    },
  }
}

test('discovery disabled surface throws inactive and feature-disabled errors before touching owners', () => {
  const inactive = makeService({ coreActive: false })
  assert.throws(() => inactive.tools.discovery.search('x'), PluginApiInactiveError)
  assert.throws(() => inactive.tools.discovery.activate('a', {}), PluginApiInactiveError)

  const active = makeService({ coreActive: true })
  const fail = (fn) => {
    assert.throws(fn, (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'toolDiscovery')
      return true
    })
  }
  fail(() => active.tools.discovery.catalog.register({}))
  fail(() => active.tools.discovery.search('x'))
  fail(() => active.tools.discovery.activate('a', {}))
  fail(() => active.tools.discovery.deactivate('a'))
  fail(() => active.tools.discovery.audit.query({}))
  assert.deepEqual(active.tools.discovery.availability(), { status: 'unavailable' })
})

test('mount exposes the discovery surface and delegates to the owner', async () => {
  const service = makeService({ coreActive: true })
  const owner = makeDiscoveryOwner()
  service.mountFeature('toolDiscovery', owner)

  const discovery = service.tools.discovery
  const registered = discovery.catalog.register({ id: 'alpha', owner: 'o' })
  assert.equal(registered.generation, 'g:alpha')
  const search = discovery.search('alpha')
  assert.equal(search.descriptors[0].id, 'alpha')
  const activated = await discovery.activate('alpha', { session: { id: 's1' } })
  assert.equal(activated.generation, 'g:1')
  assert.deepEqual(discovery.deactivate('alpha'), { ok: true })
  assert.deepEqual(discovery.audit.query({}), { items: [], truncated: false })
  assert.deepEqual(discovery.availability(), { status: 'active', active: true, catalog: { registered: 1 } })
})

test('mount does not change the tools surface contract', () => {
  const service = makeService({ coreActive: true })
  service.mountFeature('tools', { isActive: true })
  service.mountFeature('toolDiscovery', makeDiscoveryOwner())
  assert.equal(service.tools.isActive, true)
  assert.equal(typeof service.tools.register, 'function')
  assert.equal(typeof service.tools.discovery.search, 'function')
})

test('unmount restores the disabled discovery surface', () => {
  const service = makeService({ coreActive: true })
  const owner = makeDiscoveryOwner()
  const token = service.mountFeature('toolDiscovery', owner)
  assert.equal(service.tools.discovery.deactivate('a').ok, true)
  assert.equal(service.unmountFeature('toolDiscovery', token), true)
  assert.throws(() => service.tools.discovery.search('x'), PluginApiFeatureDisabledError)
  assert.equal(service.unmountFeature('toolDiscovery', token), false, 'second unmount is a no-op')
})

test('a stale mounted slot cannot be used after remount', () => {
  const service = makeService({ coreActive: true })
  const first = service.mountFeature('toolDiscovery', makeDiscoveryOwner())
  const staleSurface = service.tools.discovery
  const second = service.mountFeature('toolDiscovery', makeDiscoveryOwner())
  assert.notEqual(first, second)
  assert.throws(() => staleSurface.search('x'), PluginApiFeatureDisabledError, 'stale surface rejected')
  assert.equal(typeof service.tools.discovery.search, 'function', 'current surface works')
})

test('core inactivity rejects mounted discovery operations with the inactive error', async () => {
  let coreActive = true
  const registry = createFeatureRegistry()
  const Service = createPluginApiService({ apiVersion: '0.1', registry, coreActive: () => coreActive })
  const ctx = { reflect: { provide() {} }, logger: { error() {}, warn() {} }, get() { return undefined } }
  const service = new Service(ctx)
  service.mountFeature('toolDiscovery', makeDiscoveryOwner())
  coreActive = false
  assert.throws(() => service.tools.discovery.search('x'), PluginApiInactiveError)
  assert.throws(() => service.tools.discovery.activate('a', {}), PluginApiInactiveError)
})

test('invalid owners are rejected at mount time', () => {
  const service = makeService({ coreActive: true })
  for (const owner of [null, {}, { catalog: {} }, { search() {} }, { catalog: { register() {} }, search() {}, activate() {}, deactivate() {}, audit: {} }]) {
    assert.throws(() => service.mountFeature('toolDiscovery', owner), PluginApiFeatureDisabledError)
  }
})

test('prepared transactions can publish discovery and roll back cleanly', () => {
  const service = makeService({ coreActive: true })
  const prepared = service.prepareFeature('toolDiscovery', makeDiscoveryOwner())
  assert.throws(() => service.tools.discovery.search('x'), PluginApiFeatureDisabledError, 'prepared but unpublished')
  assert.equal(prepared.commit(), true)
  assert.equal(typeof service.tools.discovery.search, 'function')
  assert.equal(prepared.commit(), false, 'commit is at-most-once')
  assert.throws(() => service.prepareFeature('unknownFeature', {}), PluginApiFeatureDisabledError)
})