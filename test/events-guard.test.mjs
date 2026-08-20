import test from 'node:test'
import assert from 'node:assert/strict'
import { runFeatureGuard } from '../lib/guards.js'

function ctxWith({ events = true, web = true, agents = true } = {}) {
  const ctx = {
    get(name) {
      if (name === 'web' && web) {
        return {
          registerSearchProvider() {},
          registerFetchProvider() {},
        }
      }
      if (name === 'web' && !web) return undefined
      if (name === 'agents' && agents) {
        return {
          get() {},
          list() {},
          roots() {},
        }
      }
      if (name === 'agents' && !agents) return undefined
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

// web is no longer an independent feature pluginApi.services.web
// is covered by the services guard (SERVICE_DEFINITIONS includes web).

test('agent guard passes when the official agents service exposes get/list/roots', () => {
  const result = runFeatureGuard('agent', ctxWith())
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
})

test('agent guard fails when any agents registry read method is missing', () => {
  const ctx = ctxWith()
  ctx.get = (name) => (name === 'agents' ? { get() {}, list() {} } : undefined)
  const result = runFeatureGuard('agent', ctx)
  assert.equal(result.ok, false)
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0].name, 'agents.roots')
  assert.deepEqual(result.featureProblems, { agent: result.problems })
})

test('agent guard fails when the agents service is unavailable', () => {
  const result = runFeatureGuard('agent', ctxWith({ agents: false }))
  assert.equal(result.ok, false)
  assert.equal(result.problems.length, 3)
  assert.deepEqual(result.problems.map((p) => p.name), ['agents.get', 'agents.list', 'agents.roots'])
})

test('unknown feature names produce a guard problem', () => {
  const result = runFeatureGuard('unknown/feature', ctxWith())
  assert.equal(result.ok, false)
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0].name, 'feature')
})
