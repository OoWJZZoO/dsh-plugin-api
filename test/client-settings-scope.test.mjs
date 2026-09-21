import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientSettingsScope, createDisabledClientSettingsScope } from '../lib/client-settings-scope.js'

test('settings scope forwards the official binder and answers the shared read/subscribe members', () => {
  const scope = {
    getSnapshot() { return 1 },
    subscribe() { return () => {} },
    set() {},
    unset() {},
  }
  let receiver
  let input
  const service = { bind(spec) { receiver = this; input = spec; return scope } }
  const api = createClientSettingsScope({ settingsScope: service })
  const spec = { namespace: 'readImage' }
  const view = api.scope(spec)
  assert.equal(receiver, service)
  assert.equal(input, spec)
  // Shared member names with the host namespace.
  assert.equal(view.get(), 1)
  assert.equal(typeof view.watch(() => {}), 'function')
  // Official members stay as registered extension members.
  assert.equal(typeof view.getSnapshot, 'function')
  assert.equal(typeof view.subscribe, 'function')
  assert.equal(typeof view.set, 'function')
  assert.equal(typeof view.unset, 'function')
  assert.ok(Object.isFrozen(view))
})

test('settings scope rejects malformed official results and exposes disabled face', () => {
  assert.throws(() => createClientSettingsScope({ settingsScope: { bind() { return {} } } }).scope({}), /namespace/)
  assert.throws(() => createClientSettingsScope({ settingsScope: { bind() { return {} } } }).scope({ namespace: 'readImage', decode: true }), /decode/)
  assert.throws(() => createClientSettingsScope({ settingsScope: { bind() { return {} } } }).scope({ namespace: 'readImage' }), /malformed scope/)
  assert.throws(() => createDisabledClientSettingsScope().scope({}), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED')
})
