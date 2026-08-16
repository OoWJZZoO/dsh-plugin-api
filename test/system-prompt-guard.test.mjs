import test from 'node:test'
import assert from 'node:assert/strict'
import { runFeatureGuard } from '../lib/guards.js'

function completeService() {
  return {
    section() {},
    context() {},
    variable() {},
    tools() {},
    suppressRuntimeContext() {},
  }
}

function completeDeps() {
  return {
    dshSystemPrompt: {
      renderPrompt() {},
      renderContextSections() {},
    },
  }
}

function ctxWith({ service } = {}) {
  const resolved = service === undefined ? completeService() : service
  return {
    get(name) {
      return name === 'systemPrompt' ? resolved : undefined
    },
  }
}

test('systemPrompt guard passes with a complete service and render helpers', () => {
  const result = runFeatureGuard('systemPrompt', ctxWith(), completeDeps())
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
})

test('systemPrompt guard fails when the service is missing', () => {
  const result = runFeatureGuard('systemPrompt', ctxWith({ service: null }), completeDeps())
  assert.equal(result.ok, false)
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0].name, 'systemPrompt.service')
  assert.deepEqual(result.featureProblems, { systemPrompt: result.problems })
})

test('systemPrompt guard fails when any service method is missing', () => {
  const service = completeService()
  delete service.variable
  const result = runFeatureGuard('systemPrompt', ctxWith({ service }), completeDeps())
  assert.equal(result.ok, false)
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0].name, 'systemPrompt.service')
})

test('systemPrompt guard fails when renderPrompt is missing', () => {
  const deps = { dshSystemPrompt: { renderContextSections() {} } }
  const result = runFeatureGuard('systemPrompt', ctxWith(), deps)
  assert.equal(result.ok, false)
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0].name, 'dshSystemPrompt.renderPrompt')
})

test('systemPrompt guard fails when renderContextSections is missing', () => {
  const deps = { dshSystemPrompt: { renderPrompt() {} } }
  const result = runFeatureGuard('systemPrompt', ctxWith(), deps)
  assert.equal(result.ok, false)
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0].name, 'dshSystemPrompt.renderContextSections')
})

test('unknown feature names still produce a guard problem', () => {
  const result = runFeatureGuard('unknown/feature', ctxWith(), completeDeps())
  assert.equal(result.ok, false)
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0].name, 'feature')
})

test('systemPrompt guard failure does not affect other feature branches', () => {
  const failed = runFeatureGuard('systemPrompt', ctxWith({ service: null }), completeDeps())
  assert.equal(failed.ok, false)

  const eventsCtx = {
    on() {},
    once() {},
    emit() {},
    serial() {},
    parallel() {},
    bail() {},
    waterfall() {},
  }
  const events = runFeatureGuard('events', eventsCtx, completeDeps())
  assert.equal(events.ok, true)
  assert.deepEqual(events.problems, [])
})
