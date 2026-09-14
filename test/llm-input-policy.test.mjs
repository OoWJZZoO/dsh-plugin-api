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

test('registry accepts a valid image policy and returns the standard policy handle', () => {
  const registry = createLlmInputPolicyRegistry()
  const caller = { fiber: { name: 'plugin-a' } }
  const handle = registry.register(makePolicy('p1'), caller)

  assert.equal(registry.size, 1)
  assert.deepEqual(Object.keys(handle).sort(), ['dispose', 'generation', 'id', 'ownerId'])
  assert.equal(handle.id, 'p1')
  assert.equal(handle.ownerId, 'plugin-a')
  assert.equal(typeof handle.generation, 'string')
  assert.ok(Object.isFrozen(handle))
  assert.equal(handle.dispose().ok, true)
  assert.equal(handle.dispose().code, 'stale')
  assert.equal(registry.size, 0)
})

test('registry rejects cross-owner duplicate ids and invalid shapes atomically', () => {
  const registry = createLlmInputPolicyRegistry()
  const pluginA = { fiber: { name: 'plugin-a' } }
  const pluginB = { fiber: { name: 'plugin-b' } }
  registry.register(makePolicy('p1'), pluginA)

  assert.throws(
    () => registry.register(makePolicy('p1'), pluginB),
    (error) => error instanceof LlmInputPolicyRegistrationError && /another owner/.test(error.message),
  )
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
  const a = registry.register(makePolicy('a'), { fiber: { name: 'plugin-a' } })
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
  assert.equal(a.dispose().ok, true)
  assert.equal(b.dispose().ok, true)
  assert.deepEqual(snapshot.map((e) => e.id), ['a', 'b', 'c'])
  assert.deepEqual(registry.snapshot().map((e) => e.id), ['c'])
})

test('same owner + same id is latest-wins; the stale handle cannot remove the newer registration', () => {
  const registry = createLlmInputPolicyRegistry()
  const caller = { fiber: { name: 'plugin-a' } }
  const first = registry.register(makePolicy('dup'), caller)
  const firstToken = registry.snapshot()[0].token

  assert.equal(first.dispose().ok, true)
  assert.equal(first.dispose().code, 'stale')
  assert.equal(registry.size, 0)
  assert.equal(registry.isAvailable(firstToken), false)

  const second = registry.register(makePolicy('dup'), caller)
  assert.equal(first.dispose().code, 'stale', 'the stale handle cannot remove the newer registration')
  assert.equal(registry.snapshot().map((e) => e.id).join(','), 'dup')
  assert.equal(registry.snapshot()[0].token !== firstToken, true)
  assert.equal(registry.isAvailable(registry.snapshot()[0].token), true)

  // A second registration of the same (owner, id) replaces the live one.
  const third = registry.register(makePolicy('dup'), caller)
  assert.equal(second.dispose().code, 'stale', 'the superseded handle is a typed no-op')
  assert.notEqual(third.generation, second.generation)
  assert.equal(registry.snapshot().map((e) => e.id).join(','), 'dup')
  assert.equal(third.dispose().ok, true)
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