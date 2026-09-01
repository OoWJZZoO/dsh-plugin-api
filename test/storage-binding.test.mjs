import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'
import { createStorageBinding, createDisabledStorageApi, STORAGE_SCOPES } from '../lib/storage-binding.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from '../lib/errors.js'

function fakeFacility({ domain, openError } = {}) {
  const opened = []
  const table = { records: new Map(), tableName: null }
  const domainStub = {
    closeCalls: 0,
    deleteCalls: 0,
    table(name) {
      table.tableName = name
      return {
        keys: () => [...table.records.keys()],
        delete: async (key) => { table.records.delete(key); domainStub.deleteCalls += 1; return true },
      }
    },
    async close() { domainStub.closeCalls += 1 },
  }
  return {
    domainStub,
    table,
    facility: {
      opened,
      async open(spec) {
        if (openError) throw openError
        opened.push(spec)
        return domainStub
      },
    },
  }
}

function facilityCtx(facility) {
  return {
    storage: { domain: facility },
    get() { return undefined },
  }
}

const VALID = { scope: 'workspace', owner: 'pluginx', schema: 'com.example.todo', version: 1, name: 'todos', tables: { items: { valueSchema: 'zod-liked-schema' } } }

test('binding publishes only the owner/scope envelope contract and namespaces the official unit', async () => {
  const { facility, domainStub, table } = fakeFacility()
  const binding = createStorageBinding({ ctx: facilityCtx(facility), active: true })
  assert.equal(binding.isActive, true)

  const result = await binding.open(VALID)
  assert.equal(result.ok, true)
  assert.equal(result.code, 'opened')
  assert.deepEqual(result.envelope, { scope: 'workspace', owner: 'pluginx', schema: 'com.example.todo', version: 1, name: 'todos' })
  assert.ok(Object.isFrozen(result.envelope))
  assert.ok(Object.isFrozen(result))

  assert.equal(facility.opened.length, 1)
  assert.equal(facility.opened[0].name, 'workspace__pluginx__todos', 'official unit name is owner- and scope-namespaced')
  assert.equal(facility.opened[0].version, 1)
  assert.deepEqual(Object.keys(facility.opened[0].tables), ['items'], 'plugin tables pass through untouched')

  // dispose() closes without deleting any record; no legacy close() alias.
  table.records.set('k1', { data: 1 })
  assert.equal(result.handle.close, undefined, 'the operation handle exposes dispose(), not a close alias')
  const disposed = await result.handle.dispose()
  assert.equal(disposed.ok, true)
  assert.equal(disposed.code, 'disposed')
  assert.equal(domainStub.closeCalls, 1)
  assert.equal(domainStub.deleteCalls, 0, 'dispose never deletes data')
  assert.equal(table.records.has('k1'), true)

  // purge() is the explicit deletion operation.
  const purged = await result.handle.purge()
  assert.equal(purged.ok, true)
  assert.equal(purged.code, 'purged')
  assert.equal(domainStub.deleteCalls, 1, 'purge deletes every stored record')
  assert.equal(table.records.has('k1'), false)
})

test('open validates the scope/owner/schema/version envelope before touching the facility', async () => {
  const { facility } = fakeFacility()
  const binding = createStorageBinding({ ctx: facilityCtx(facility), active: true })
  const cases = [
    { ...VALID, scope: 'global' },
    { ...VALID, scope: 'session' }, // scope is validated but 'session' is legal
    { ...VALID, owner: 'pluginx' },
  ]
  for (const bad of [
    { ...VALID, scope: 'global' },
    { ...VALID, scope: undefined },
    { ...VALID, owner: 'PLUGINX' },
    { ...VALID, owner: '' },
    { ...VALID, schema: '' },
    { ...VALID, version: -1 },
    { ...VALID, version: 1.5 },
    { ...VALID, name: 'Bad Name' },
  ]) {
    const result = await binding.open(bad)
    assert.equal(result.ok, false, JSON.stringify(bad))
    assert.equal(result.code, 'invalid-input')
  }
  assert.equal(facility.opened.length, 0, 'invalid envelopes never reach the official facility')

  const scoped = await binding.open({ ...VALID, scope: 'session' })
  assert.equal(scoped.ok, true)
  assert.equal(facility.opened[0].name, 'session__pluginx__todos')
  const profile = await binding.open({ ...VALID, scope: 'profile' })
  assert.equal(profile.ok, true)
  assert.deepEqual(STORAGE_SCOPES, ['profile', 'workspace', 'session'])
})

test('official failures map to the typed vocabulary with official identity preserved', async () => {
  const examples = [
    [{ code: 'version-mismatch', message: 'stored version 3 vs spec 1' }, 'unsupported-schema'],
    [{ code: 'already-open', message: "domain 'x' is already open" }, 'conflict'],
    [{ code: 'backend-not-found', message: 'no backend' }, 'backend-unavailable'],
    [{ code: 'facet-unsupported', message: 'no kv facet' }, 'facet-unsupported'],
    [{ code: 'invalid-record', message: 'table t key k invalid' }, 'invalid-record'],
    [{ code: 'malformed-medium', message: 'medium damaged' }, 'malformed-medium'],
    [{ code: 'unexpected-thing', message: 'unknown' }, 'unavailable'],
    [new Error('open blew up'), 'unavailable'],
  ]
  for (const [error, expectedCode] of examples) {
    const { facility } = fakeFacility({ openError: error })
    const binding = createStorageBinding({ ctx: facilityCtx(facility), active: true })
    const result = await binding.open(VALID)
    assert.equal(result.ok, false, String(error))
    assert.equal(result.code, expectedCode, `expected ${expectedCode} for ${String(error)}`)
    if (error instanceof Error) {
      assert.equal(result.reason.includes('open blew up'), true)
    } else {
      assert.equal(result.official, error.code, 'official discriminant is preserved')
    }
    assert.ok(Object.isFrozen(result))
  }
})

test('the storage face is disabled without the official facility and typed before mounting', async () => {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const active = new ServiceClass({ reflect: { provide() {} }, get() { return undefined } })
  assert.equal(typeof active.storage, 'object')
  assert.equal(active.storage.isActive, false)
  assert.throws(
    () => active.storage.open({}),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'storage',
  )

  const inert = createPluginApiService({ apiVersion: '0.1', registry, coreActive: false })
  const inactive = new inert({ reflect: { provide() {} }, get() { return undefined } })
  assert.throws(() => inactive.storage.open({}), PluginApiInactiveError)

  // mountFeature('storage', binding) publishes the live face (the slot wraps
  // the owner with guard checks; behavior is delegated to the binding).
  const { facility } = fakeFacility()
  const binding = createStorageBinding({ ctx: facilityCtx(facility), active: true })
  assert.equal(binding.isActive, true)
  active.mountFeature('storage', binding)
  assert.equal(active.storage.isActive, true)
  assert.equal(typeof active.storage.open, 'function')
  assert.equal(typeof active.storage.availability, 'function')
  assert.equal((await active.storage.open(VALID)).code, 'opened')
})

test('a missing or malformed facility yields the disabled face without throwing', () => {
  for (const ctx of [{ get() { return undefined } }, { storage: {} }, { get() { return {} } }]) {
    const binding = createStorageBinding({ ctx, active: true })
    assert.equal(binding.isActive, false, JSON.stringify(ctx))
    assert.throws(() => binding.open(VALID), PluginApiFeatureDisabledError)
  }
  const disabled = createDisabledStorageApi(() => true)
  assert.equal(disabled.isActive, false)
  assert.throws(() => disabled.open({}), PluginApiFeatureDisabledError)
})

test('inactive core precedence: open types as inactive before validation or facility calls', async () => {
  let active = true
  const { facility } = fakeFacility()
  const binding = createStorageBinding({ ctx: facilityCtx(facility), active: () => active })
  active = false
  await assert.rejects(() => binding.open(VALID), PluginApiInactiveError)
  assert.equal(facility.opened.length, 0)
})