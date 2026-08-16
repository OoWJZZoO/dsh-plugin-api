import test from 'node:test'
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { checkHostEnvironment, guardFailNotice, guardLogPath, writeGuardLog } from '../lib/guards.js'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'

function healthyCtx(overrides = {}) {
  return {
    plugin() {},
    llm: { resolveModelInfo() {} },
    agents: { get() {} },
    get(name) {
      if (name === 'apiProxy') return { sessions: { prompt() {}, selectModel() {} } }
      return undefined
    },
    ...overrides,
  }
}

const healthyDeps = () => ({
  dshLlm: { contentHasImage() {} },
  AsyncLocalStorage,
})

test('healthy environment passes with no problems', () => {
  const result = checkHostEnvironment(healthyCtx(), healthyDeps())
  assert.equal(result.ok, true)
  assert.equal(result.skipped, false)
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.coreProblems, [])
  assert.deepEqual(result.optionalProblems, [])
})

test('missing ctx.plugin is a core failure', () => {
  const result = checkHostEnvironment(healthyCtx({ plugin: undefined }), healthyDeps())
  assert.equal(result.ok, false)
  assert.ok(result.coreProblems.some((p) => p.name === 'ctx.plugin'))
})

test('missing llm.resolveModelInfo is a core failure', () => {
  const result = checkHostEnvironment(healthyCtx({ llm: {} }), healthyDeps())
  assert.equal(result.ok, false)
  assert.ok(result.coreProblems.some((p) => p.name === 'llm.resolveModelInfo'))
})

test('missing agents.get is a core failure', () => {
  const result = checkHostEnvironment(healthyCtx({ agents: {} }), healthyDeps())
  assert.equal(result.ok, false)
  assert.ok(result.coreProblems.some((p) => p.name === 'agents.get'))
})

test('missing dshLlm.contentHasImage is a core failure', () => {
  const result = checkHostEnvironment(healthyCtx(), { dshLlm: {}, AsyncLocalStorage })
  assert.equal(result.ok, false)
  assert.ok(result.coreProblems.some((p) => p.name === 'dshLlm.contentHasImage'))
})

test('missing AsyncLocalStorage is a core failure', () => {
  const result = checkHostEnvironment(healthyCtx(), { dshLlm: { contentHasImage() {} }, AsyncLocalStorage: null })
  assert.equal(result.ok, false)
  assert.ok(result.coreProblems.some((p) => p.name === 'AsyncLocalStorage'))
})

test('missing apiProxy is only an optional failure and guard stays ok', () => {
  const ctx = healthyCtx({ get: () => undefined })
  const result = checkHostEnvironment(ctx, healthyDeps())
  assert.equal(result.ok, true)
  assert.equal(result.coreProblems.length, 0)
  assert.equal(result.optionalProblems.length, 1)
  assert.equal(result.optionalProblems[0].name, 'apiProxy.sessions')
  assert.equal(result.problems.length, 1)
})

test('malformed apiProxy.sessions is only an optional failure and guard stays ok', () => {
  const ctx = healthyCtx({ get: () => ({ sessions: {} }) })
  const result = checkHostEnvironment(ctx, healthyDeps())
  assert.equal(result.ok, true)
  assert.ok(result.optionalProblems.some((p) => p.name === 'apiProxy.sessions'))
})

test('ctx.get throwing during apiProxy probe degrades to optional failure, never throws', () => {
  const ctx = healthyCtx({
    get() {
      throw new Error('hostile ctx.get')
    },
  })
  const result = checkHostEnvironment(ctx, healthyDeps())
  assert.equal(result.ok, true)
  assert.ok(result.optionalProblems.some((p) => p.name === 'apiProxy.sessions'))
})

test('hostile ctx with throwing getters never throws', () => {
  const hostile = new Proxy({}, {
    get() {
      throw new Error('hostile getter')
    },
  })
  const result = checkHostEnvironment(hostile, healthyDeps())
  assert.equal(typeof result.ok, 'boolean')
  assert.equal(result.ok, false)
  assert.ok(result.coreProblems.length > 0)
})

test('DSH_PLUGIN_API_GUARD_DISABLE=1 skips all checks', () => {
  const previous = process.env.DSH_PLUGIN_API_GUARD_DISABLE
  process.env.DSH_PLUGIN_API_GUARD_DISABLE = '1'
  try {
    const result = checkHostEnvironment(healthyCtx({ plugin: undefined }), healthyDeps())
    assert.equal(result.ok, true)
    assert.equal(result.skipped, true)
    assert.deepEqual(result.problems, [])
  } finally {
    if (previous === undefined) delete process.env.DSH_PLUGIN_API_GUARD_DISABLE
    else process.env.DSH_PLUGIN_API_GUARD_DISABLE = previous
  }
})

test('DSH_PLUGIN_API_FORCE_GUARD_FAIL=1 forces a core failure', () => {
  const previous = process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
  process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = '1'
  try {
    const result = checkHostEnvironment(healthyCtx(), healthyDeps())
    assert.equal(result.ok, false)
    assert.ok(result.coreProblems.some((p) => p.name === 'forced'))
  } finally {
    if (previous === undefined) delete process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
    else process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = previous
  }
})

test('DSH_PLUGIN_API_GUARD_DISABLE wins over FORCE_GUARD_FAIL', () => {
  const disable = process.env.DSH_PLUGIN_API_GUARD_DISABLE
  const force = process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
  process.env.DSH_PLUGIN_API_GUARD_DISABLE = '1'
  process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = '1'
  try {
    const result = checkHostEnvironment(healthyCtx(), healthyDeps())
    assert.equal(result.ok, true)
    assert.equal(result.skipped, true)
    assert.deepEqual(result.problems, [])
  } finally {
    if (disable === undefined) delete process.env.DSH_PLUGIN_API_GUARD_DISABLE
    else process.env.DSH_PLUGIN_API_GUARD_DISABLE = disable
    if (force === undefined) delete process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
    else process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = force
  }
})

test('guardLogPath returns the stable ~/.dsh/logs/dsh-plugin-api-guard.log path', () => {
  assert.equal(guardLogPath(), join(homedir(), '.dsh', 'logs', 'dsh-plugin-api-guard.log'))
})

test('writeGuardLog writes a timestamped diagnostic file and overwrites it', () => {
  const path = join(tmpdir(), `dsh-plugin-api-guard-test-${process.pid}.log`)
  try {
    const first = writeGuardLog([{ name: 'a', detail: 'first' }], path)
    assert.equal(first, path)
    assert.ok(existsSync(path))
    const body1 = readFileSync(path, 'utf8')
    assert.match(body1, /dsh-plugin-api environment self-check FAILED/)
    assert.match(body1, /- a: first/)

    writeGuardLog([{ name: 'b', detail: 'second' }], path)
    const body2 = readFileSync(path, 'utf8')
    assert.match(body2, /- b: second/)
    assert.doesNotMatch(body2, /- a: first/)
  } finally {
    if (existsSync(path)) unlinkSync(path)
  }
})

test('guardFailNotice is bilingual and includes the log path and skip env var', () => {
  const notice = guardFailNotice('/tmp/example.log')
  assert.match(notice, /dsh-plugin-api/)
  assert.match(notice, /llm-image-admission/)
  assert.match(notice, /\/tmp\/example\.log/)
  assert.match(notice, /DSH_PLUGIN_API_GUARD_DISABLE=1/)
  assert.match(notice, /self-check FAILED/)
  assert.match(notice, /自检未通过/)
  assert.match(notice, /日志/)
})
