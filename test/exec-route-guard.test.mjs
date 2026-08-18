import test from 'node:test'
import assert from 'node:assert/strict'
import { runFeatureGuard } from '../lib/guards.js'

function healthyCtx() {
  const services = { tools: {}, sessions: {} }
  return {
    on() {},
    get(name) {
      return services[name]
    },
  }
}

test('execRoute guard passes with the required public substrate', () => {
  const result = runFeatureGuard('execRoute', healthyCtx())

  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.featureProblems, { execRoute: [] })
})

test('execRoute guard fails closed for every mandatory missing substrate member', () => {
  const cases = [
    ['ctx.on', { get: healthyCtx().get }],
    ['tools service', { ...healthyCtx(), get(name) { return name === 'tools' ? undefined : {} } }],
    ['sessions service', { ...healthyCtx(), get(name) { return name === 'sessions' ? undefined : {} } }],
  ]

  for (const [expected, ctx] of cases) {
    const result = runFeatureGuard('execRoute', ctx)
    assert.equal(result.ok, false, `${expected} should fail`)
    assert.ok(result.problems.some((problem) => problem.name === expected))
    assert.deepEqual(result.featureProblems.execRoute, result.problems)
  }
})

test('execRoute guard contains throwing public substrate probes', () => {
  const throwing = new Proxy({}, {
    get() {
      throw new Error('private diagnostic detail')
    },
  })
  const result = runFeatureGuard('execRoute', {
    get() {
      throw new Error('hostile service lookup')
    },
    get on() {
      throw new Error('hostile event hook')
    },
  })
  const serviceResult = runFeatureGuard('execRoute', {
    on() {},
    get() {
      return throwing
    },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.problems.map((problem) => problem.name), ['ctx.on', 'tools service', 'sessions service'])
  assert.equal(serviceResult.ok, true)
  assert.deepEqual(serviceResult.problems, [])
})

test('execRoute guard does not inspect route-bearing execution objects or alter other guard branches', () => {
  let requestContextReads = 0
  const routeBearingService = {
    get agent() {
      requestContextReads += 1
      throw new Error('must not inspect executions')
    },
  }
  const ctx = {
    on() {},
    get() {
      return routeBearingService
    },
  }

  const routeResult = runFeatureGuard('execRoute', ctx)
  const toolsResult = runFeatureGuard('tools', {
    get(name) {
      if (name !== 'tools') return undefined
      return { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} }
    },
  })

  assert.equal(routeResult.ok, true)
  assert.equal(requestContextReads, 0)
  assert.equal(toolsResult.ok, true)
  assert.deepEqual(toolsResult.featureProblems, { tools: [] })
})
