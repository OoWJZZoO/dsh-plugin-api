import test from 'node:test'
import assert from 'node:assert/strict'
import { runFeatureGuard } from '../lib/guards.js'
import { SESSION_DURABLE_AUDIT } from '../lib/session-durable-catalog.js'

const durableTypes = [
  'approval/asked',
  'approval/decided',
  'approval/policy',
  'schedule/change',
  'subagent/descriptor',
]
const surfaceTypes = ['user/message', 'assistant/message', 'tool/result']

function completeDeps() {
  const known = new Set([...durableTypes, ...surfaceTypes])
  return {
    dshSession: {
      Session: class Session {},
      isJsonValue() { return true },
      snapshotJsonValue(value) { return value },
      KNOWN_SESSION_EVENT_TYPES: known,
      isSurfaceEligibleType(kind) { return surfaceTypes.includes(kind) },
    },
    eventsApi: { on() {} },
    runtimeVersion: SESSION_DURABLE_AUDIT.runtimeVersion,
    facadeRuntimeVersion: SESSION_DURABLE_AUDIT.runtimeVersion,
    sessionDurableManifests: Object.fromEntries(
      Object.entries(SESSION_DURABLE_AUDIT.packages).map(([name, version]) => [name, { version }]),
    ),
  }
}

function completeCtx() {
  return {
    on() {},
    get(name) {
      return name === 'sessions' ? { get() {}, list() {} } : undefined
    },
  }
}

test('sessionDurable guard passes only with exact public prerequisites', () => {
  const result = runFeatureGuard('sessionDurable', completeCtx(), completeDeps())
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.featureProblems, { sessionDurable: [] })
})

test('sessionDurable guard fails missing or hostile sessions service APIs', () => {
  for (const sessions of [undefined, { list() {} }, { get() {} }]) {
    const result = runFeatureGuard('sessionDurable', { on() {}, get: () => sessions }, completeDeps())
    assert.equal(result.ok, false)
  }
  const hostile = runFeatureGuard('sessionDurable', { on() {}, get() { throw new Error('hostile') } }, completeDeps())
  assert.equal(hostile.ok, false)
  assert.deepEqual(hostile.problems.map((problem) => problem.name), ['sessions.get', 'sessions.list'])
})

test('sessionDurable guard fails malformed or throwing public session contract evidence', () => {
  for (const mutate of [
    (deps) => { delete deps.dshSession.Session },
    (deps) => { delete deps.dshSession.isJsonValue },
    (deps) => { delete deps.dshSession.snapshotJsonValue },
    (deps) => { deps.dshSession.KNOWN_SESSION_EVENT_TYPES = { has() { throw new Error('hostile') } } },
    (deps) => { deps.dshSession.isSurfaceEligibleType = () => { throw new Error('hostile') } },
  ]) {
    const deps = completeDeps()
    mutate(deps)
    const result = runFeatureGuard('sessionDurable', completeCtx(), deps)
    assert.equal(result.ok, false)
    assert.ok(result.problems.some((problem) => problem.name === 'dshSession.exports'))
  }
})

test('sessionDurable guard fails missing vocabulary or incorrect surface eligibility', () => {
  const missingVocabulary = completeDeps()
  missingVocabulary.dshSession.KNOWN_SESSION_EVENT_TYPES.delete('schedule/change')
  const missingResult = runFeatureGuard('sessionDurable', completeCtx(), missingVocabulary)
  assert.equal(missingResult.ok, false)
  assert.ok(missingResult.problems.some((problem) => problem.name === 'dshSession.exports'))

  const surfaceMismatch = completeDeps()
  surfaceMismatch.dshSession.isSurfaceEligibleType = () => true
  const surfaceResult = runFeatureGuard('sessionDurable', completeCtx(), surfaceMismatch)
  assert.equal(surfaceResult.ok, false)
  assert.ok(surfaceResult.problems.some((problem) => problem.name === 'dshSession.exports'))
})

test('sessionDurable guard fails absent or hostile native event subscription evidence', () => {
  for (const ctx of [
    { get: completeCtx().get },
    { get: completeCtx().get, get on() { throw new Error('hostile') } },
  ]) {
    const result = runFeatureGuard('sessionDurable', ctx, completeDeps())
    assert.equal(result.ok, false)
    assert.ok(result.problems.some((problem) => problem.name === 'ctx.on'))
  }
})

test('sessionDurable guard fails absent, malformed, or non-exact audit identities', () => {
  for (const mutate of [
    (deps) => { delete deps.sessionDurableManifests['@deepseek-ai/dsh-schedule'] },
    (deps) => { deps.sessionDurableManifests['@deepseek-ai/dsh-schedule'] = {} },
    (deps) => { deps.sessionDurableManifests['@deepseek-ai/dsh-schedule'] = { version: '0.1.0-rc.7' } },
    (deps) => { deps.runtimeVersion = '0.1.0-rc.7' },
    (deps) => { deps.facadeRuntimeVersion = '0.1.0-rc.7' },
    (deps) => { deps.sessionDurableManifests = new Proxy({}, { get() { throw new Error('hostile') } }) },
  ]) {
    const deps = completeDeps()
    mutate(deps)
    const result = runFeatureGuard('sessionDurable', completeCtx(), deps)
    assert.equal(result.ok, false)
    assert.ok(result.problems.some((problem) => problem.name === 'sessionDurable.audit'))
  }
})

test('sessionDurable guard remains isolated from baseline session and events guard results', () => {
  assert.equal(runFeatureGuard('session', completeCtx(), {}).ok, false)
  assert.equal(runFeatureGuard('events', completeCtx(), {}).ok, false)
  assert.equal(runFeatureGuard('sessionDurable', completeCtx(), completeDeps()).ok, true)
})

test('sessionDurable guard preserves the global guard-disable bypass', () => {
  const previous = process.env.DSH_PLUGIN_API_GUARD_DISABLE
  process.env.DSH_PLUGIN_API_GUARD_DISABLE = '1'
  try {
    const result = runFeatureGuard('sessionDurable', { get() { throw new Error('hostile') } }, {})
    assert.deepEqual(result, {
      ok: true,
      skipped: true,
      problems: [],
      coreProblems: [],
      featureProblems: {},
    })
  } finally {
    if (previous === undefined) delete process.env.DSH_PLUGIN_API_GUARD_DISABLE
    else process.env.DSH_PLUGIN_API_GUARD_DISABLE = previous
  }
})

test('sessionDurable guard leaves unknown features fail-closed', () => {
  const result = runFeatureGuard('not-a-real-feature', completeCtx(), completeDeps())
  assert.deepEqual(result.problems, [
    { name: 'feature', detail: 'unknown feature "not-a-real-feature"' },
  ])
})
