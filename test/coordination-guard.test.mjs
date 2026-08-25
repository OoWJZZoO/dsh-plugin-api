import test from 'node:test'
import assert from 'node:assert/strict'
import { runFeatureGuard } from '../lib/guards.js'

test('coordination guard passes when ctx.get is available', () => {
  const result = runFeatureGuard('coordination', { get() {} })
  assert.equal(result.ok, true)
  assert.equal(result.skipped, false)
})

test('coordination guard fails closed when ctx.get is missing and never throws', () => {
  const result = runFeatureGuard('coordination', {})
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((problem) => problem.name === 'ctx.get'))
})

test('unknown feature names are still reported', () => {
  const result = runFeatureGuard('not-a-feature', { get() {} })
  assert.equal(result.ok, false)
  assert.equal(result.problems[0].name, 'feature')
})