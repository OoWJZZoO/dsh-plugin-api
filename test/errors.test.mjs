import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PluginApiError,
  PluginApiEventPriorityError,
  PluginApiFeatureDisabledError,
  PluginApiInactiveError,
  PluginApiRemoteError,
  PluginApiServiceUnavailableError,
  PluginApiSettingsNamespaceError,
  PluginApiVersionError,
} from '../lib/errors.js'

test('PluginApiError is the base class and carries a code', () => {
  const error = new PluginApiError('PLUGIN_API_BASE', 'base error')
  assert.ok(error instanceof Error)
  assert.equal(error.code, 'PLUGIN_API_BASE')
  assert.match(error.message, /base error/)
})

test('PluginApiInactiveError has code PLUGIN_API_INACTIVE', () => {
  const error = new PluginApiInactiveError('facade is inactive')
  assert.ok(error instanceof PluginApiError)
  assert.ok(error instanceof PluginApiInactiveError)
  assert.equal(error.code, 'PLUGIN_API_INACTIVE')
  assert.match(error.message, /inactive/)
})

test('PluginApiFeatureDisabledError carries feature and code', () => {
  const error = new PluginApiFeatureDisabledError('llm.admissionPolicies', 'feature is disabled')
  assert.ok(error instanceof PluginApiError)
  assert.equal(error.code, 'PLUGIN_API_FEATURE_DISABLED')
  assert.equal(error.feature, 'llm.admissionPolicies')
  assert.match(error.message, /llm\.admissionPolicies/)
  assert.match(error.message, /disabled/)
})

test('PluginApiVersionError carries declared and required', () => {
  const error = new PluginApiVersionError({
    declared: '0.1',
    required: '0.2',
    pluginName: 'test-plugin',
  })
  assert.ok(error instanceof PluginApiError)
  assert.equal(error.code, 'PLUGIN_API_VERSION_MISMATCH')
  assert.equal(error.declared, '0.1')
  assert.equal(error.required, '0.2')
  assert.equal(error.pluginName, 'test-plugin')
  assert.match(error.message, /0\.1/)
  assert.match(error.message, /0\.2/)
})

test('PluginApiVersionError has a readable default message', () => {
  const error = new PluginApiVersionError({ declared: '0.1', required: '0.2' })
  assert.match(error.message, /version/i)
  assert.match(error.message, /0\.1/)
  assert.match(error.message, /0\.2/)
})

test('PluginApiEventPriorityError carries the invalid priority value', () => {
  const error = new PluginApiEventPriorityError('urgent')
  assert.ok(error instanceof PluginApiError)
  assert.ok(error instanceof PluginApiEventPriorityError)
  assert.equal(error.code, 'PLUGIN_API_INVALID_PRIORITY')
  assert.equal(error.name, 'PluginApiEventPriorityError')
  assert.equal(error.priority, 'urgent')
  assert.match(error.message, /urgent/)
  assert.match(error.message, /priority/i)
})

test('PluginApiRemoteError carries code and optional serviceKey', () => {
  const error = new PluginApiRemoteError('key conflict', { serviceKey: 'svc' })
  assert.ok(error instanceof PluginApiError)
  assert.ok(error instanceof PluginApiRemoteError)
  assert.equal(error.code, 'PLUGIN_API_REMOTE_INVALID')
  assert.equal(error.name, 'PluginApiRemoteError')
  assert.equal(error.serviceKey, 'svc')
  assert.match(error.message, /svc/)
  const bare = new PluginApiRemoteError('plain')
  assert.equal(bare.serviceKey, undefined)
  const defaulted = new PluginApiRemoteError()
  assert.match(defaulted.message, /remote/)
})

test('PluginApiServiceUnavailableError carries the service name', () => {
  const error = new PluginApiServiceUnavailableError('settings')
  assert.ok(error instanceof PluginApiError)
  assert.ok(error instanceof PluginApiServiceUnavailableError)
  assert.equal(error.code, 'PLUGIN_API_SERVICE_UNAVAILABLE')
  assert.equal(error.service, 'settings')
  assert.match(error.message, /settings/)
  assert.match(error.message, /unavailable/i)
})

test('PluginApiSettingsNamespaceError carries the namespace', () => {
  const error = new PluginApiSettingsNamespaceError('my-plugin')
  assert.ok(error instanceof PluginApiError)
  assert.ok(error instanceof PluginApiSettingsNamespaceError)
  assert.equal(error.code, 'PLUGIN_API_SETTINGS_NAMESPACE_NOT_FOUND')
  assert.equal(error.ns, 'my-plugin')
  assert.match(error.message, /my-plugin/)
  assert.match(error.message, /register/i)
})
