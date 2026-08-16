import test from 'node:test'
import assert from 'node:assert/strict'
import { runFeatureGuard } from '../lib/guards.js'

const TOOL_METHODS = ['register', 'restrict', 'guard', 'get', 'schemas', 'execute', 'presentAs']

function healthyTools() {
  const tools = {}
  for (const method of TOOL_METHODS) tools[method] = () => {}
  return tools
}

function ctxWithTools(tools) {
  return {
    get(name) {
      return name === 'tools' ? tools : undefined
    },
  }
}

test('tools feature guard passes when the official tools service exposes all seven methods', () => {
  const result = runFeatureGuard('tools', ctxWithTools(healthyTools()), {})
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.featureProblems, { tools: [] })
})

test('tools feature guard fails when the tools service is missing', () => {
  const result = runFeatureGuard('tools', ctxWithTools(undefined), {})
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((p) => p.name === 'tools service'))
  assert.ok(result.featureProblems.tools.some((p) => p.name === 'tools service'))
})

test('tools feature guard fails for each missing public method', () => {
  for (const missing of TOOL_METHODS) {
    const tools = healthyTools()
    delete tools[missing]
    const result = runFeatureGuard('tools', ctxWithTools(tools), {})
    assert.equal(result.ok, false, `${missing} missing should fail the guard`)
    assert.ok(result.problems.some((p) => p.name === `tools.${missing}`), `${missing} probe should be reported`)
  }
})

test('tools feature guard does not touch core guard problems', () => {
  const result = runFeatureGuard('tools', ctxWithTools(healthyTools()), {})
  assert.equal(result.coreProblems.length, 0)
})
