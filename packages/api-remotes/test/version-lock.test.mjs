/**
 * Version-lock tests: the bundle pins the runtime full version and its
 * replaced owner package identity; identity mismatch must be distinguishable
 * and never silently ignored.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LOCKED_OWNER_PACKAGE,
  LOCKED_RUNTIME_VERSION,
  fullVersionContractsMatch,
  parseFullVersion,
  runtimeIdentityMatches,
} from '../lib/version.js'

test('version: locked identity constants', () => {
  assert.equal(LOCKED_RUNTIME_VERSION, '0.1.0-rc.6')
  assert.equal(LOCKED_OWNER_PACKAGE, '@deepseek-ai/dsh-api-remotes')
})

test('parseFullVersion splits runtime and api components', () => {
  assert.deepEqual(parseFullVersion('0.1.0-rc.6-0.1.0'), {
    runtime: '0.1.0-rc.6',
    api: '0.1',
    maintenance: '0',
  })
  assert.equal(parseFullVersion('not-a-version'), null)
  assert.equal(parseFullVersion(undefined), null)
})

test('fullVersionContractsMatch requires same runtime/api and consistent dsh.api', () => {
  assert.equal(fullVersionContractsMatch({
    ownVersion: '0.1.0-rc.6-0.1.0',
    ownApi: '0.1',
    mainVersion: '0.1.0-rc.6-0.1.0',
    mainApi: '0.1',
  }), true)
  assert.equal(fullVersionContractsMatch({
    ownVersion: '0.2.0-0.1.0',
    ownApi: '0.1',
    mainVersion: '0.1.0-rc.6-0.1.0',
    mainApi: '0.1',
  }), false, 'runtime mismatch must fail')
  assert.equal(fullVersionContractsMatch({
    ownVersion: '0.1.0-rc.6-0.1.0',
    ownApi: '0.1',
    mainVersion: '0.1.0-rc.6-0.2.0',
    mainApi: '0.2',
  }), false, 'api protocol mismatch must fail')
  assert.equal(fullVersionContractsMatch({
    ownVersion: '0.1.0-rc.6-0.1.0',
    ownApi: '0.2',
    mainVersion: '0.1.0-rc.6-0.1.0',
    mainApi: '0.1',
  }), false, 'own dsh.api must agree with its own version suffix')
})

test('runtimeIdentityMatches is exact for the locked runtime', () => {
  assert.equal(runtimeIdentityMatches('0.1.0-rc.6'), true)
  assert.equal(runtimeIdentityMatches('0.1.0-rc.7'), false)
  assert.equal(runtimeIdentityMatches(undefined), false)
})