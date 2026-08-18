import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createLlmInputPolicyRegistry } from '../lib/llm-input-policy.js'
import { LlmInputPolicyRegistrationError } from '../lib/errors.js'

function makePolicy(id, overrides = {}) {
  return {
    id,
    input: 'image',
    match() { return true },
    process() { return { kind: 'pass' } },
    validate() { return true },
    ...overrides,
  }
}

test('registry accepts a valid image policy and returns an identity-bound disposer', () => {
  const registry = createLlmInputPolicyRegistry()
  const disposer = registry.register(makePolicy('p1'))

  assert.equal(registry.size, 1)
  assert.equal(disposer(), true)
  assert.equal(disposer(), false)
  assert.equal(registry.size, 0)
})

test('registry rejects duplicate ids and invalid shapes atomically', () => {
  const registry = createLlmInputPolicyRegistry()
  registry.register(makePolicy('p1'))

  assert.throws(() => registry.register(makePolicy('p1')), LlmInputPolicyRegistrationError)
  assert.throws(() => registry.register(makePolicy('p2', { input: 'audio' })), LlmInputPolicyRegistrationError)
  assert.throws(() => registry.register(makePolicy('p3', { match: undefined })), LlmInputPolicyRegistrationError)
  assert.throws(() => registry.register(makePolicy('p4', { process: 'not-a-function' })), LlmInputPolicyRegistrationError)
  assert.throws(() => registry.register(makePolicy('p5', { validate: null })), LlmInputPolicyRegistrationError)
  assert.throws(() => registry.register(makePolicy('p6', { detector() {} })), LlmInputPolicyRegistrationError)
  assert.throws(() => registry.register(makePolicy('p7', { inspector() {} })), LlmInputPolicyRegistrationError)
  assert.throws(() => registry.register(makePolicy('p8', { project() {} })), LlmInputPolicyRegistrationError)
  assert.throws(() => registry.register({ id: '  ', input: 'image', match() {}, process() {}, validate() {} }), LlmInputPolicyRegistrationError)
  assert.throws(() => registry.register(null), LlmInputPolicyRegistrationError)

  assert.equal(registry.size, 1, 'failed registrations leave no partial state')
})

test('registry snapshot preserves successful-registration order with frozen entries', () => {
  const registry = createLlmInputPolicyRegistry()
  const a = registry.register(makePolicy('a'))
  const b = registry.register(makePolicy('b'))
  registry.register(makePolicy('c'))

  const snapshot = registry.snapshot()
  assert.deepEqual(snapshot.map((e) => e.id), ['a', 'b', 'c'])
  for (const entry of snapshot) {
    assert.ok(Object.isFrozen(entry))
    assert.equal(typeof entry.token, 'object')
    assert.equal(typeof entry.match, 'function')
    assert.equal(entry.input, 'image')
  }

  // disposal after the snapshot cannot alter a held snapshot
  a()
  b()
  assert.deepEqual(snapshot.map((e) => e.id), ['a', 'b', 'c'])
  assert.deepEqual(registry.snapshot().map((e) => e.id), ['c'])
})

test('disposal removes only the exact token; a newer registration with the same id survives', () => {
  const registry = createLlmInputPolicyRegistry()
  const first = registry.register(makePolicy('dup'))
  const firstToken = registry.snapshot()[0].token

  assert.equal(first(), true)
  assert.equal(first(), false)
  assert.equal(registry.size, 0)
  assert.equal(registry.isAvailable(firstToken), false)

  const second = registry.register(makePolicy('dup'))
  assert.equal(first(), false, 'the stale disposer cannot remove the newer registration')
  assert.equal(registry.snapshot().map((e) => e.id).join(','), 'dup')
  assert.equal(registry.snapshot()[0].token !== firstToken, true)
  assert.equal(registry.isAvailable(registry.snapshot()[0].token), true)
  assert.equal(second(), true)
})

test('disposed registry rejects further registration', () => {
  const registry = createLlmInputPolicyRegistry()
  registry.register(makePolicy('p1'))
  registry.dispose()
  assert.throws(() => registry.register(makePolicy('p2')), LlmInputPolicyRegistrationError)
})

test('registry module stays harness-free', () => {
  const source = readFileSync(new URL('../lib/llm-input-policy.js', import.meta.url), 'utf8')
  assert.equal(/from ['"]@deepseek-ai|from ['"]cordis/.test(source), false,
    'the policy registry must not import official packages or Cordis')
})