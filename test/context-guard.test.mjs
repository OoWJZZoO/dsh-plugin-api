import test from 'node:test'
import assert from 'node:assert/strict'
import { runFeatureGuard } from '../lib/guards.js'

const SYSTEM_PROMPT_SHAPE = {
  section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {},
}
const SESSIONS_SHAPE = { get() {}, list() {} }

function contextCtx(overrides = {}) {
  return {
    get(name) {
      if (name === 'systemPrompt') return Object.hasOwn(overrides, 'systemPrompt') ? overrides.systemPrompt : SYSTEM_PROMPT_SHAPE
      if (name === 'sessions') return Object.hasOwn(overrides, 'sessions') ? overrides.sessions : SESSIONS_SHAPE
      return undefined
    },
    ...overrides.extra,
  }
}

test('context guard passes when the mandatory seams are present', () => {
  const result = runFeatureGuard('context', contextCtx(), {})
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
})

test('context guard fails when the systemPrompt service or the sessions service is missing', () => {
  const bothMissing = runFeatureGuard('context', contextCtx({ systemPrompt: undefined, sessions: undefined }), {})
  assert.equal(bothMissing.ok, false)
  assert.ok(bothMissing.problems.some((p) => p.name === 'systemPrompt.service'))
  assert.ok(bothMissing.problems.some((p) => p.name === 'sessions service'))

  const promptOnly = runFeatureGuard('context', contextCtx({ sessions: undefined }), {})
  assert.equal(promptOnly.ok, false)
  assert.ok(promptOnly.problems.some((p) => p.name === 'sessions service'))

  const sessionsOnly = runFeatureGuard('context', contextCtx({ systemPrompt: undefined }), {})
  assert.equal(sessionsOnly.ok, false)
  assert.ok(sessionsOnly.problems.some((p) => p.name === 'systemPrompt.service'))

  const partialPrompt = runFeatureGuard('context', contextCtx({ systemPrompt: { section() {} } }), {})
  assert.equal(partialPrompt.ok, false)
})

test('soft seams (attachments marker, compaction events, tool/skill discovery, evidence slice) never fail the context guard', () => {
  const result = runFeatureGuard('context', contextCtx(), {})
  assert.equal(result.ok, true, 'soft-source absence degrades at mount, not at the guard')
  assert.ok(result.problems.every((p) => !p.name.includes('attachment') && !p.name.includes('compaction')
    && !p.name.includes('tool') && !p.name.includes('skill') && !p.name.includes('evidence')))
})

test('guarded probes are isolated: a throwing get degrades to reported problems, never throws', () => {
  const result = runFeatureGuard('context', {
    get() { throw new Error('hostile getter') },
  }, {})
  assert.equal(result.ok, false)
  assert.ok(result.problems.length > 0)
})