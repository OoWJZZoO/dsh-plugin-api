import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseFullVersion,
  fullVersionContractsMatch,
  runtimeIdentityMatches,
  RUNTIME_VERSION,
  API_PROTOCOL,
} from '../lib/version.js'

test('parseFullVersion accepts <runtime>-<api.major>.<api.minor>', () => {
  assert.deepEqual(parseFullVersion('0.1.0-rc.6-0.7'), { runtime: '0.1.0-rc.6', api: '0.7' })
  assert.deepEqual(parseFullVersion('0.1.0-rc.6-0.10'), { runtime: '0.1.0-rc.6', api: '0.10' })
})

test('parseFullVersion treats prerelease and numeric-increment suffixes correctly', () => {
  // protocol minor increments numerically; 0.10 must not be mis-read as 0.1
  const v = parseFullVersion('0.1.0-rc.6-0.10')
  assert.equal(v.api, '0.10')
  // runtime part keeps its own rc suffix untouched
  assert.equal(parseFullVersion('0.1.0-rc.6-0.7').runtime, '0.1.0-rc.6')
})

test('parseFullVersion returns null for malformed input', () => {
  assert.equal(parseFullVersion(undefined), null)
  assert.equal(parseFullVersion('0.1.0-rc.6'), null) // no protocol suffix
  assert.equal(parseFullVersion('0.1.0-rc.6-0'), null) // minor missing
  assert.equal(parseFullVersion(''), null)
  assert.equal(parseFullVersion(42), null)
})

test('parseFullVersion keeps protocol major open (release protocol 1.x stays a valid shape)', () => {
  // The parser mirrors the main facade: the API protocol major is not gatekept
  // here; protocol 1.0 is reserved for release, so 1.x remains parseable.
  assert.deepEqual(parseFullVersion('0.1.0-rc.6-1.5'), { runtime: '0.1.0-rc.6', api: '1.5' })
})

test('fullVersionContractsMatch requires equal runtime, api and dsh.api agreement', () => {
  const consistent = {
    ownVersion: '0.1.0-rc.6-0.7',
    ownApi: '0.7',
    mainVersion: '0.1.0-rc.6-0.7',
    mainApi: '0.7',
  }
  assert.equal(fullVersionContractsMatch(consistent), true)

  assert.equal(
    fullVersionContractsMatch({ ...consistent, ownVersion: '0.1.1-rc.6-0.5' }),
    false,
    'runtime mismatch fails',
  )
  assert.equal(
    fullVersionContractsMatch({ ...consistent, ownApi: '0.4' }),
    false,
    'own dsh.api disagreeing with own suffix fails',
  )
  assert.equal(
    fullVersionContractsMatch({ ...consistent, mainApi: '0.6' }),
    false,
    'main dsh.api disagreeing with main suffix fails',
  )
  assert.equal(
    fullVersionContractsMatch({ ...consistent, mainVersion: '0.1.0-rc.6-0.6' }),
    false,
    'protocol mismatch fails',
  )
  assert.equal(fullVersionContractsMatch({ ...consistent, ownVersion: undefined }), false)
  assert.equal(fullVersionContractsMatch({}), false)
})

test('runtimeIdentityMatches locks the exact prerelease runtime identity', () => {
  assert.equal(runtimeIdentityMatches('0.1.0-rc.6'), true)
  assert.equal(runtimeIdentityMatches('0.1.0'), false)
  assert.equal(runtimeIdentityMatches('0.1.0-rc.7'), false)
})

test('locked constants are exposed for assembly checks', () => {
  assert.equal(RUNTIME_VERSION, '0.1.0-rc.6')
  assert.equal(API_PROTOCOL, '0.7')
})
