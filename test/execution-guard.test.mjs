import test from 'node:test'
import assert from 'node:assert/strict'
import { runFeatureGuard } from '../lib/guards.js'

test('execution guard passes with the mandatory ctx.on substrate alone', () => {
  const result = runFeatureGuard('execution', { on() {} })
  assert.equal(result.ok, true)
  assert.deepEqual(result.featureProblems, { execution: [] })
})

test('execution guard fails closed only for a missing ctx.on', () => {
  const result = runFeatureGuard('execution', {})
  assert.equal(result.ok, false)
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0].name, 'ctx.on')
  assert.deepEqual(result.featureProblems.execution, result.problems)
})

test('execution guard contains a throwing ctx.on probe', () => {
  const result = runFeatureGuard('execution', {
    get on() {
      throw new Error('hostile getter')
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.problems.length, 1)
})

test('execution guard does not affect other feature branches or the unknown fallback', () => {
  const healthy = runFeatureGuard('session', {
    get() {
      return { get() {}, list() {}, fork() {} }
    },
  })
  assert.equal(healthy.ok, true)
  const unknown = runFeatureGuard('not-a-feature', { on() {} })
  assert.equal(unknown.ok, false)
  assert.match(unknown.problems[0].detail, /unknown feature/)
})
