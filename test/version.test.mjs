import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeVersion, parseContract, satisfiesContract } from '../lib/version.js'

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
