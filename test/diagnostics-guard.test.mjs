import test from 'node:test'
import assert from 'node:assert/strict'
import { runFeatureGuard } from '../lib/guards.js'

test('diagnostics feature guard passes when official services are resolvable', () => {
  const result = runFeatureGuard('diagnostics', { get() { return {} } })
  assert.equal(result.skipped, false)
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.featureProblems.diagnostics, [])
})

test('diagnostics feature guard fails closed without service resolution', () => {
  const result = runFeatureGuard('diagnostics', {})
  assert.equal(result.skipped, false)
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((problem) => problem.name === 'ctx.get'))
})

test('unknown feature names still produce the neutral fallback problem', () => {
  const result = runFeatureGuard('not-a-feature', {})
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((problem) => problem.name === 'feature'))
})

test('unrelated feature branches are unaffected by the diagnostics branch', () => {
  const events = runFeatureGuard('events', { on() {}, once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {} })
  assert.equal(events.ok, true)
  assert.equal(events.problems.length, 0)
})
