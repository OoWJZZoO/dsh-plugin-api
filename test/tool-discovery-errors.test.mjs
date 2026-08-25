import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ToolDiscoveryActivationSupersededError,
  ToolDiscoveryEntryConflictError,
  ToolDiscoveryEntryDeactivatedError,
  ToolDiscoveryEntryDisposedError,
  ToolDiscoveryEntryFailedError,
  ToolDiscoveryEntryUnknownError,
  ToolDiscoveryRegistrationError,
  ToolDiscoveryScopeUnresolvedError,
  staleGenerationOutcome,
} from '../lib/tool-discovery-errors.js'
import { PluginApiError } from '../lib/errors.js'
import { CODES } from '../lib/tool-discovery-normalize.js'

test('every discovery error is a PluginApiError with a capability-word code', () => {
  const cases = [
    [new ToolDiscoveryRegistrationError('bad spec'), CODES.REGISTRATION_INVALID],
    [new ToolDiscoveryEntryConflictError('alpha'), CODES.ENTRY_CONFLICT],
    [new ToolDiscoveryEntryUnknownError('alpha'), CODES.ENTRY_UNKNOWN],
    [new ToolDiscoveryEntryDisposedError('alpha'), CODES.ENTRY_DISPOSED],
    [new ToolDiscoveryEntryDeactivatedError('alpha'), CODES.ENTRY_DEACTIVATED],
    [new ToolDiscoveryEntryFailedError('alpha', 'boom'), CODES.ENTRY_FAILED],
    [new ToolDiscoveryScopeUnresolvedError('nope'), CODES.SCOPE_UNRESOLVED],
    [new ToolDiscoveryActivationSupersededError('alpha'), CODES.ACTIVATION_SUPERSEDED],
  ]
  for (const [error, code] of cases) {
    assert.ok(error instanceof PluginApiError, `${code} extends PluginApiError`)
    assert.equal(error.code, code)
    assert.equal(typeof error.message, 'string')
    assert.ok(error.message.length > 0)
  }
})

test('errors carry the affected entry id where applicable', () => {
  const conflict = new ToolDiscoveryEntryConflictError('alpha-1')
  assert.equal(conflict.entryId, 'alpha-1')
  const failed = new ToolDiscoveryEntryFailedError('alpha-1', 'boom')
  assert.equal(failed.entryId, 'alpha-1')
})

test('custom causes propagate', () => {
  const cause = new Error('root')
  const error = new ToolDiscoveryRegistrationError('bad', { cause })
  assert.equal(error.cause, cause)
})

test('stale generation outcome is a frozen typed no-op, not an error', () => {
  const outcome = staleGenerationOutcome('already reclaimed')
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, CODES.GENERATION_STALE)
  assert.equal(outcome.reason, 'already reclaimed')
  assert.ok(Object.isFrozen(outcome))
  const bare = staleGenerationOutcome()
  assert.equal(bare.reason, undefined)
})

test('codes match the normalize module constants exactly', () => {
  assert.equal(CODES.REGISTRATION_INVALID, 'DISCOVERY_REGISTRATION_INVALID')
  assert.equal(CODES.ENTRY_CONFLICT, 'DISCOVERY_ENTRY_CONFLICT')
  assert.equal(CODES.ENTRY_UNKNOWN, 'DISCOVERY_ENTRY_UNKNOWN')
  assert.equal(CODES.ENTRY_DISPOSED, 'DISCOVERY_ENTRY_DISPOSED')
  assert.equal(CODES.ENTRY_DEACTIVATED, 'DISCOVERY_ENTRY_DEACTIVATED')
  assert.equal(CODES.ENTRY_FAILED, 'DISCOVERY_ENTRY_FAILED')
  assert.equal(CODES.SCOPE_UNRESOLVED, 'DISCOVERY_SCOPE_UNRESOLVED')
  assert.equal(CODES.GENERATION_STALE, 'DISCOVERY_GENERATION_STALE')
  assert.equal(CODES.ACTIVATION_SUPERSEDED, 'DISCOVERY_ACTIVATION_SUPERSEDED')
})