import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeVersion, parseContract, parseFacadeVersion, satisfiesContract } from '../lib/version.js'

test('normalizeVersion reduces patch and prerelease to major.minor', () => {
  assert.equal(normalizeVersion('0.1.0-rc.6'), '0.1')
  assert.equal(normalizeVersion('0.1.0'), '0.1')
  assert.equal(normalizeVersion('0.1'), '0.1')
  assert.equal(normalizeVersion('1.2.3'), '1.2')
})

test('normalizeVersion accepts a leading v', () => {
  assert.equal(normalizeVersion('v0.1.0-rc.6'), '0.1')
})

test('normalizeVersion returns null for missing or unparseable input', () => {
  assert.equal(normalizeVersion(undefined), null)
  assert.equal(normalizeVersion(null), null)
  assert.equal(normalizeVersion(''), null)
  assert.equal(normalizeVersion('abc'), null)
  assert.equal(normalizeVersion('1'), null)
})

test('parseContract only accepts major.minor', () => {
  assert.equal(parseContract('0.1'), '0.1')
  assert.equal(parseContract('1.2'), '1.2')
  assert.equal(parseContract('0.1.0'), null)
  assert.equal(parseContract('0.1.0-rc.6'), null)
  assert.equal(parseContract(''), null)
  assert.equal(parseContract(undefined), null)
})

test('satisfiesContract is true when major.minor are equal', () => {
  assert.equal(satisfiesContract('0.1', '0.1.0-rc.6'), true)
  assert.equal(satisfiesContract('0.1', '0.1.9'), true)
})

test('satisfiesContract is false when major.minor differ', () => {
  assert.equal(satisfiesContract('0.1', '0.2.0'), false)
  assert.equal(satisfiesContract('1.0', '0.1.0-rc.6'), false)
})

test('satisfiesContract is false for missing or unparseable inputs', () => {
  assert.equal(satisfiesContract('0.1', 'abc'), false)
  assert.equal(satisfiesContract('abc', '0.1.0'), false)
  assert.equal(satisfiesContract(undefined, '0.1.0'), false)
  assert.equal(satisfiesContract('0.1', undefined), false)
})

test('parseFacadeVersion splits the full unique version into runtime and api parts', () => {
  assert.deepEqual(parseFacadeVersion('0.1.0-rc.6-0.5'), { runtime: '0.1.0-rc.6', api: '0.5' })
  assert.deepEqual(parseFacadeVersion('0.1.0-0.4'), { runtime: '0.1.0', api: '0.4' })
  assert.deepEqual(parseFacadeVersion('1.2.3-rc.1-0.10'), { runtime: '1.2.3-rc.1', api: '0.10' })
})

test('parseFacadeVersion returns null for unparseable input', () => {
  assert.equal(parseFacadeVersion(undefined), null)
  assert.equal(parseFacadeVersion(null), null)
  assert.equal(parseFacadeVersion(''), null)
  assert.equal(parseFacadeVersion('0.2'), null)
  assert.equal(parseFacadeVersion('0.1.0-rc.6'), null)
  assert.equal(parseFacadeVersion('0.1.0-rc.6-abc'), null)
  assert.equal(parseFacadeVersion('0.1.0-rc.6-0.2.1'), null)
})
