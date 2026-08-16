import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

test('starts empty', () => {
  const registry = createFeatureRegistry()
  assert.deepEqual(registry.snapshot(), [])
  assert.equal(registry.isActive('llm/admission'), false)
})

test('mount makes a feature active and visible in snapshot', () => {
  const registry = createFeatureRegistry()
  registry.mount('llm/admission')
  assert.equal(registry.isActive('llm/admission'), true)
  assert.deepEqual(registry.snapshot(), [{ name: 'llm/admission', isActive: true }])
})

test('disable records a readable reason and is observable', () => {
  const registry = createFeatureRegistry()
  registry.disable('llm/admission', 'apiProxy.sessions is unavailable')
  assert.equal(registry.isActive('llm/admission'), false)
  const snapshot = registry.snapshot()
  assert.equal(snapshot.length, 1)
  assert.equal(snapshot[0].name, 'llm/admission')
  assert.equal(snapshot[0].isActive, false)
  assert.match(snapshot[0].reason, /apiProxy/)
})

test('mount and disable are idempotent: last write wins', () => {
  const registry = createFeatureRegistry()
  registry.mount('llm/admission')
  registry.mount('llm/admission')
  assert.equal(registry.snapshot().length, 1)
  registry.disable('llm/admission', 'first')
  registry.disable('llm/admission', 'second')
  const snapshot = registry.snapshot()
  assert.equal(snapshot.length, 1)
  assert.equal(snapshot[0].isActive, false)
  assert.equal(snapshot[0].reason, 'second')
})

test('assertActive throws PluginApiFeatureDisabledError for disabled or unknown features', () => {
  const registry = createFeatureRegistry()
  registry.mount('llm/admission')
  registry.disable('llm/admission', 'guard failed')
  assert.throws(
    () => registry.assertActive('llm/admission'),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.code, 'PLUGIN_API_FEATURE_DISABLED')
      assert.equal(error.feature, 'llm/admission')
      assert.match(error.message, /guard failed/)
      return true
    },
  )
  assert.throws(() => registry.assertActive('unknown/feature'), PluginApiFeatureDisabledError)
})

test('assertActive does not throw for mounted features', () => {
  const registry = createFeatureRegistry()
  registry.mount('llm/admission')
  assert.doesNotThrow(() => registry.assertActive('llm/admission'))
})
