import test from 'node:test'
import assert from 'node:assert/strict'
import { runFeatureGuard } from '../lib/guards.js'

test('guard: sessionChannel passes when sessions service is available', () => {
  const ctx = { get: (name) => name === 'sessions' ? { get() {}, list() {} } : undefined }
  const guard = runFeatureGuard('sessionChannel', ctx)
  assert.ok(guard.ok)
  assert.equal(guard.featureProblems.sessionChannel.length, 0)
})

test('guard: sessionChannel fails when sessions service is missing', () => {
  const ctx = { get: () => undefined }
  const guard = runFeatureGuard('sessionChannel', ctx)
  assert.ok(!guard.ok)
  assert.ok(guard.featureProblems.sessionChannel.some((p) => p.name === 'sessions service'))
})

test('guard: sessionChannel fails when sessions service is incomplete', () => {
  const ctx = { get: (name) => name === 'sessions' ? { get() {} } : undefined }
  const guard = runFeatureGuard('sessionChannel', ctx)
  assert.ok(!guard.ok)
})

test('guard: sessionChannel guard failure does not affect other features', () => {
  const ctx = { get: () => undefined }
  const sessionGuard = runFeatureGuard('sessionChannel', ctx)
  const otherCtx = { get: (name) => name === 'sessions' ? { get() {}, list() {} } : undefined }
  const sessionOk = runFeatureGuard('sessionChannel', otherCtx)
  assert.ok(!sessionGuard.ok)
  assert.ok(sessionOk.ok)
  // A failing sessionChannel guard must not disturb core problems
  assert.equal(sessionGuard.coreProblems.length, 0)
})

test('guard: DSH_PLUGIN_API_GUARD_DISABLE skips the probe', () => {
  const previous = process.env.DSH_PLUGIN_API_GUARD_DISABLE
  process.env.DSH_PLUGIN_API_GUARD_DISABLE = '1'
  try {
    const guard = runFeatureGuard('sessionChannel', { get: () => undefined })
    assert.ok(guard.ok)
    assert.ok(guard.skipped)
  } finally {
    if (previous === undefined) delete process.env.DSH_PLUGIN_API_GUARD_DISABLE
    else process.env.DSH_PLUGIN_API_GUARD_DISABLE = previous
  }
})