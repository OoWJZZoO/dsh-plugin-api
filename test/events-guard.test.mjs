import test from 'node:test'
import assert from 'node:assert/strict'
import { runFeatureGuard } from '../lib/guards.js'

function ctxWith({ events = true, web = true } = {}) {
  const ctx = {
    get(name) {
      if (name === 'web' && web) {
        return {
          registerSearchProvider() {},
          registerFetchProvider() {},
        }
      }
      if (name === 'web' && !web) return undefined
      return undefined
    },
  }
  if (events) {
    Object.assign(ctx, {
      on() {},
      once() {},
      emit() {},
      serial() {},
      parallel() {},
      bail() {},
      waterfall() {},
    })
  }
  return ctx
}

test('events guard passes when all seven Cordis event methods exist', () => {
  const result = runFeatureGuard('events', ctxWith())
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
})

test('events guard fails with a problem when any Cordis event method is missing', () => {
  const ctx = ctxWith()
  delete ctx.waterfall
  const result = runFeatureGuard('events', ctx)
  assert.equal(result.ok, false)
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0].name, 'ctx.waterfall')
  assert.deepEqual(result.featureProblems, { events: result.problems })
})

test('web guard passes when the official web service exposes both providers', () => {
  const result = runFeatureGuard('web', ctxWith())
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
})

test('web guard fails with a problem when a web provider method is missing', () => {
  const ctx = ctxWith({ web: true })
  ctx.get = (name) => (name === 'web' ? { registerSearchProvider() {} } : undefined)
  const result = runFeatureGuard('web', ctx)
  assert.equal(result.ok, false)
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0].name, 'web.registerFetchProvider')
  assert.deepEqual(result.featureProblems, { web: result.problems })
})

test('unknown feature names produce a guard problem', () => {
  const result = runFeatureGuard('unknown/feature', ctxWith())
  assert.equal(result.ok, false)
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0].name, 'feature')
})
