import test from 'node:test'
import assert from 'node:assert/strict'
import { parseFullVersion, fullVersionContractsMatch, runtimeIdentityMatches } from '../lib/version.js'

test('parseFullVersion: parses valid version strings', () => {
  const result = parseFullVersion('0.1.0-rc.6-0.7')
  assert.deepEqual(result, { runtime: '0.1.0-rc.6', api: '0.7' })
})

test('parseFullVersion: returns null for invalid input', () => {
  assert.equal(parseFullVersion(undefined), null)
  assert.equal(parseFullVersion(null), null)
  assert.equal(parseFullVersion(42), null)
  assert.equal(parseFullVersion(''), null)
})

test('fullVersionContractsMatch: passes when both versions match', () => {
  assert.ok(fullVersionContractsMatch({
    ownVersion: '0.1.0-rc.6-0.7',
    ownApi: '0.7',
    mainVersion: '0.1.0-rc.6-0.7',
    mainApi: '0.7',
  }))
})

test('fullVersionContractsMatch: fails on runtime mismatch', () => {
  assert.ok(!fullVersionContractsMatch({
    ownVersion: '0.1.0-rc.6-0.7',
    ownApi: '0.7',
    mainVersion: '0.1.0-rc.7-0.7',
    mainApi: '0.7',
  }))
})

test('fullVersionContractsMatch: fails on api mismatch', () => {
  assert.ok(!fullVersionContractsMatch({
    ownVersion: '0.1.0-rc.6-0.7',
    ownApi: '0.7',
    mainVersion: '0.1.0-rc.6-0.8',
    mainApi: '0.8',
  }))
})

test('fullVersionContractsMatch: fails on dsh.api vs version suffix mismatch', () => {
  assert.ok(!fullVersionContractsMatch({
    ownVersion: '0.1.0-rc.6-0.7',
    ownApi: '0.8',
    mainVersion: '0.1.0-rc.6-0.7',
    mainApi: '0.7',
  }))
})

test('runtimeIdentityMatches: matches exact pinned version', () => {
  assert.ok(runtimeIdentityMatches('0.1.0-rc.6'))
  assert.ok(!runtimeIdentityMatches('0.1.0-rc.5'))
  assert.ok(!runtimeIdentityMatches(undefined))
})