import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientSettingsScope, createDisabledClientSettingsScope } from '../lib/client-settings-scope.js'

test('settings scope forwards the official binder and returns its exact scope identity', () => {
  const scope = { getSnapshot() {}, subscribe() {}, set() {}, unset() {} }
  let receiver
  let input
  const service = { bind(spec) { receiver = this; input = spec; return scope } }
  const api = createClientSettingsScope({ settingsScope: service })
  const spec = { namespace: 'readImage' }
  assert.equal(api.bind(spec), scope)
  assert.equal(receiver, service)
  assert.equal(input, spec)
})

test('settings scope rejects malformed official results and exposes disabled face', () => {
  assert.throws(() => createClientSettingsScope({ settingsScope: { bind() { return {} } } }).bind({}), /namespace/)
  assert.throws(() => createClientSettingsScope({ settingsScope: { bind() { return {} } } }).bind({ namespace: 'readImage', decode: true }), /decode/)
  assert.throws(() => createClientSettingsScope({ settingsScope: { bind() { return {} } } }).bind({ namespace: 'readImage' }), /malformed scope/)
  assert.throws(() => createDisabledClientSettingsScope().bind({}), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED')
})
