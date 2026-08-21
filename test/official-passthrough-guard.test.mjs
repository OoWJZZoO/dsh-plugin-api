import test from 'node:test'
import assert from 'node:assert/strict'
import { runFeatureGuard } from '../lib/guards.js'

const validNamespace = {
  renderContextSnapshot() {},
  joinContextSections() {},
}

test('official helper guard keeps sibling helpers available independently', () => {
  const result = runFeatureGuard('officialPassthrough', {}, {
    dshSystemPrompt: {
      renderContextSnapshot: validNamespace.renderContextSnapshot,
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [
    {
      name: 'systemPrompt.joinContextSections',
      detail: 'systemPrompt.joinContextSections: missing-export',
    },
  ])
  assert.deepEqual(result.featureProblems.officialPassthrough, result.problems)
})

test('official helper guard distinguishes missing and invalid exports', () => {
  const result = runFeatureGuard('officialPassthrough', {}, {
    dshSystemPrompt: {
      renderContextSnapshot: 42,
      joinContextSections: validNamespace.joinContextSections,
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [
    {
      name: 'systemPrompt.renderContextSnapshot',
      detail: 'systemPrompt.renderContextSnapshot: invalid-export',
    },
  ])

  const missing = runFeatureGuard('officialPassthrough', {}, { dshSystemPrompt: {} })
  assert.equal(missing.ok, false)
  assert.deepEqual(missing.problems, [
    {
      name: 'systemPrompt.renderContextSnapshot',
      detail: 'systemPrompt.renderContextSnapshot: missing-export',
    },
    {
      name: 'systemPrompt.joinContextSections',
      detail: 'systemPrompt.joinContextSections: missing-export',
    },
  ])
})

test('throwing official export getters degrade to invalid-export without leaking the thrown value', () => {
  const namespace = {}
  Object.defineProperties(namespace, {
    renderContextSnapshot: { get() { throw new Error('secret provider state') } },
    joinContextSections: { get() { throw new Error('secret provider state') } },
  })

  const result = runFeatureGuard('officialPassthrough', {}, { dshSystemPrompt: namespace })

  assert.equal(result.ok, false)
  assert.deepEqual(result.problems, [
    {
      name: 'systemPrompt.renderContextSnapshot',
      detail: 'systemPrompt.renderContextSnapshot: invalid-export',
    },
    {
      name: 'systemPrompt.joinContextSections',
      detail: 'systemPrompt.joinContextSections: invalid-export',
    },
  ])
  assert.doesNotMatch(JSON.stringify(result), /secret provider state/)
})
