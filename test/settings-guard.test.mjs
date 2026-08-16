import test from 'node:test'
import assert from 'node:assert/strict'
import { runFeatureGuard } from '../lib/guards.js'

function settingsCtx(settings) {
  const ctx = {
    get(name) {
      if (name === 'settings') return settings
      return undefined
    },
  }
  return ctx
}

function healthySettings() {
  return {
    register() {},
    describe() {},
    get() {},
    mutate() {},
  }
}

test('settings feature guard passes when ctx.get exists and settings service is complete', () => {
  const result = runFeatureGuard('settings', settingsCtx(healthySettings()))
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.featureProblems, { settings: [] })
})

test('settings feature guard fails when ctx.get is missing', () => {
  const result = runFeatureGuard('settings', {})
  assert.equal(result.ok, false)
  assert.ok(result.featureProblems.settings.some((p) => p.name === 'ctx.get'))
})

test('settings feature guard passes when settings service is absent (optional settings mode)', () => {
  const result = runFeatureGuard('settings', settingsCtx(undefined))
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
})

test('settings feature guard fails when settings service is missing register', () => {
  const settings = healthySettings()
  delete settings.register
  const result = runFeatureGuard('settings', settingsCtx(settings))
  assert.equal(result.ok, false)
  assert.ok(result.featureProblems.settings.some((p) => p.name === 'settings.register'))
})

test('settings feature guard fails when settings service is missing describe', () => {
  const settings = healthySettings()
  delete settings.describe
  const result = runFeatureGuard('settings', settingsCtx(settings))
  assert.equal(result.ok, false)
  assert.ok(result.featureProblems.settings.some((p) => p.name === 'settings.describe'))
})

test('settings feature guard fails when settings service is missing get', () => {
  const settings = healthySettings()
  delete settings.get
  const result = runFeatureGuard('settings', settingsCtx(settings))
  assert.equal(result.ok, false)
  assert.ok(result.featureProblems.settings.some((p) => p.name === 'settings.get'))
})

test('settings feature guard fails when settings service is missing mutate', () => {
  const settings = healthySettings()
  delete settings.mutate
  const result = runFeatureGuard('settings', settingsCtx(settings))
  assert.equal(result.ok, false)
  assert.ok(result.featureProblems.settings.some((p) => p.name === 'settings.mutate'))
})

test('settings feature guard never throws when ctx.get throws', () => {
  const ctx = {
    get() {
      throw new Error('hostile get')
    },
  }
  const result = runFeatureGuard('settings', ctx)
  assert.equal(typeof result.ok, 'boolean')
  // Optional settings mode: an unreadable service is treated as absent at boot,
  // so the feature remains active and fails loudly at call time instead.
  assert.equal(result.ok, true)
})
