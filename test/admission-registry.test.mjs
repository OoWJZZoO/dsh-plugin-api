import test from 'node:test'
import assert from 'node:assert/strict'
import { AdmissionIntentError, AdmissionRegistry } from '../lib/admission.js'

function makeIntent(overrides = {}) {
  return {
    id: 'test-intent',
    match: () => false,
    project: (options) => options,
    ...overrides,
  }
}

test('register returns a dispose wrapper around dispose(id)', () => {
  const registry = new AdmissionRegistry()
  const intent = makeIntent()
  const dispose = registry.register(intent)

  assert.equal(typeof dispose, 'function')
  assert.equal(dispose(), true)
  assert.equal(dispose(), false)
})

test('dispose(id) returns true once, then false, and allows re-registration', () => {
  const registry = new AdmissionRegistry()
  registry.register(makeIntent({ id: 'a' }))

  assert.equal(registry.dispose('a'), true)
  assert.equal(registry.dispose('a'), false)

  registry.register(makeIntent({ id: 'a' }))
  assert.equal(registry.dispose('a'), true)
})

test('rejects invalid ids with AdmissionIntentError code INVALID_ADMISSION_ID', () => {
  const registry = new AdmissionRegistry()
  const invalidIds = ['', '   ', 0, 1, null, undefined, {}, []]

  for (const id of invalidIds) {
    assert.throws(
      () => registry.register(makeIntent({ id })),
      (error) => error instanceof AdmissionIntentError && error.code === 'INVALID_ADMISSION_ID',
      `expected INVALID_ADMISSION_ID for ${String(id)}`
    )
  }
})

test('rejects missing or non-function match with INVALID_ADMISSION_INTENT', () => {
  const registry = new AdmissionRegistry()
  for (const match of [undefined, null, 'yes', 42]) {
    assert.throws(
      () => registry.register(makeIntent({ match })),
      (error) => error instanceof AdmissionIntentError && error.code === 'INVALID_ADMISSION_INTENT'
    )
  }
})

test('rejects missing or non-function project with PROJECTOR_REQUIRED', () => {
  const registry = new AdmissionRegistry()
  for (const project of [undefined, null, 'project', 42]) {
    assert.throws(
      () => registry.register(makeIntent({ project })),
      (error) => error instanceof AdmissionIntentError && error.code === 'PROJECTOR_REQUIRED'
    )
  }
})

test('rejects duplicate id with DUPLICATE_ADMISSION_INTENT and installs nothing partially', () => {
  const registry = new AdmissionRegistry()
  registry.register(makeIntent({ id: 'dup' }))

  assert.throws(
    () => registry.register(makeIntent({ id: 'dup' })),
    (error) => error instanceof AdmissionIntentError && error.code === 'DUPLICATE_ADMISSION_INTENT'
  )

  assert.equal(registry.matches({}), false)
  assert.deepEqual(registry.matchingProjectors({}), [])
  assert.equal(registry.dispose('dup'), true)
})

test('rejected registrations never partially install', () => {
  const registry = new AdmissionRegistry()
  const ctx = { sessionId: 's1', provider: 'p', model: 'm' }

  for (const bad of [
    makeIntent({ id: '' }),
    makeIntent({ match: null }),
    makeIntent({ project: null }),
  ]) {
    assert.throws(() => registry.register(bad), AdmissionIntentError)
  }

  assert.equal(registry.matches(ctx), false)
  assert.deepEqual(registry.matchingProjectors(ctx), [])
})

test('no intents means no match and no projectors', () => {
  const registry = new AdmissionRegistry()
  assert.equal(registry.matches({}), false)
  assert.deepEqual(registry.matchingProjectors({}), [])
})

test('multiple intents use OR semantics and projectors keep registration order', () => {
  const registry = new AdmissionRegistry()
  const projectA = (options) => ({ ...options, a: true })
  const projectB = (options) => ({ ...options, b: true })
  const projectC = (options) => ({ ...options, c: true })

  registry.register(makeIntent({ id: 'a', match: () => false, project: projectA }))
  registry.register(makeIntent({ id: 'b', match: () => true, project: projectB }))
  registry.register(makeIntent({ id: 'c', match: () => true, project: projectC }))

  assert.equal(registry.matches({}), true)
  assert.deepEqual(registry.matchingProjectors({}), [projectB, projectC])
})

test('disposing one intent does not affect other intents', () => {
  const registry = new AdmissionRegistry()
  registry.register(makeIntent({ id: 'a', match: () => false }))
  registry.register(makeIntent({ id: 'b', match: () => true }))

  assert.equal(registry.dispose('a'), true)
  assert.equal(registry.matches({}), true)
  assert.deepEqual(registry.matchingProjectors({}).length, 1)
})

test('match throw is treated as no-match with 30s per-id rate-limited warning', () => {
  const warnings = []
  let now = 0
  const registry = new AdmissionRegistry({
    warn: (message) => warnings.push(message),
    now: () => now,
  })

  registry.register(makeIntent({ id: 'throwing', match: () => { throw new Error('boom') } }))
  registry.register(makeIntent({ id: 'ok', match: () => true }))

  assert.equal(registry.matches({}), true)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /throwing/)

  registry.matches({})
  assert.equal(warnings.length, 1)

  now = 29_999
  registry.matches({})
  assert.equal(warnings.length, 1)

  now = 30_000
  registry.matches({})
  assert.equal(warnings.length, 2)
})

test('match returning a thenable or non-boolean is treated as no-match with warning', () => {
  const warnings = []
  const registry = new AdmissionRegistry({ warn: (message) => warnings.push(message) })

  registry.register(makeIntent({ id: 'promise', match: () => Promise.resolve(true) }))
  registry.register(makeIntent({ id: 'stringy', match: () => 'true' }))

  assert.equal(registry.matches({}), false)
  assert.deepEqual(registry.matchingProjectors({}), [])
  assert.equal(warnings.length, 2)
})
