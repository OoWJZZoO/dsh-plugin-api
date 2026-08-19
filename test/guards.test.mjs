import test from 'node:test'
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  featureFailNotice,
  guardFailNotice,
  guardLogPath,
  runCoreGuard,
  runFeatureGuard,
  writeGuardLog,
} from '../lib/guards.js'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { SERVICE_DEFINITIONS } from '../lib/services.js'

const versions = { apiVersion: '0.3', facadeVersion: '0.1.0-rc.6-0.3', runtimeVersion: '0.1.0-rc.6' }

function healthyCtx(overrides = {}) {
  return {
    plugin() {},
    reflect: { provide() {} },
    get(name) {
      if (name === 'llm') {
        return {
          resolveModelInfo() {},
          prepareCall() {},
          stream() {},
          registerAdapter() {},
          registerConfigurableProviders() {},
          registerModelDiscovery() {},
        }
      }
      if (name === 'agents') return { get() {} }
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

test('core guard passes with healthy ctx and matching versions', () => {
  const result = runCoreGuard(healthyCtx(), versions)
  assert.equal(result.ok, true)
  assert.equal(result.skipped, false)
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.coreProblems, [])
  assert.deepEqual(result.featureProblems, {})
})

test('missing ctx.plugin is a core failure', () => {
  const result = runCoreGuard(healthyCtx({ plugin: undefined }), versions)
  assert.equal(result.ok, false)
  assert.ok(result.coreProblems.some((p) => p.name === 'ctx.plugin'))
})

test('missing ctx.reflect.provide is a core failure', () => {
  const result = runCoreGuard(healthyCtx({ reflect: {} }), versions)
  assert.equal(result.ok, false)
  assert.ok(result.coreProblems.some((p) => p.name === 'ctx.reflect.provide'))
})

test('missing or unparseable dsh.api is a core failure', () => {
  for (const apiVersion of [undefined, '0.1.0', 'abc', '1']) {
    const result = runCoreGuard(healthyCtx(), { ...versions, apiVersion })
    assert.equal(result.ok, false)
    assert.ok(result.coreProblems.some((p) => p.name === 'dsh.api'))
  }
})

test('runtime version mismatch is a core failure', () => {
  // facade built for runtime 0.1.0-rc.6 but 0.2.0 is installed
  const result = runCoreGuard(healthyCtx(), { apiVersion: '0.3', facadeVersion: '0.1.0-rc.6-0.3', runtimeVersion: '0.2.0' })
  assert.equal(result.ok, false)
  assert.ok(result.coreProblems.some((p) => p.name === 'runtime version'))
})

test('runtime matching requires the exact full audited version while API protocol remains separate', () => {
  assert.equal(runCoreGuard(healthyCtx(), versions).ok, true)
  for (const runtimeVersion of ['0.1.0-rc.7', '0.1.0', '0.1.1-rc.6']) {
    const result = runCoreGuard(healthyCtx(), { ...versions, runtimeVersion })
    assert.equal(result.ok, false, `runtimeVersion=${runtimeVersion}`)
    assert.ok(result.coreProblems.some((problem) => problem.name === 'runtime version'))
  }
})

test('unparseable or inconsistent facade version is a core failure', () => {
  for (const facadeVersion of [undefined, '0.3', '0.1.0-rc.6', '0.1.0-rc.6-abc', '0.1.0-rc.6-0.2']) {
    const result = runCoreGuard(healthyCtx(), { ...versions, facadeVersion })
    assert.equal(result.ok, false, `facadeVersion=${facadeVersion}`)
    assert.ok(result.coreProblems.some((p) => p.name === 'facade version'), `facadeVersion=${facadeVersion}`)
  }
})

test('llm/admission feature guard passes when all required probes exist', () => {
  const result = runFeatureGuard('llm/admission', healthyCtx(), healthyDeps())
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
  assert.equal(result.coreProblems.length, 0)
  assert.deepEqual(result.featureProblems, { 'llm/admission': [] })
})

test('missing llm.resolveModelInfo is a feature failure and core stays healthy', () => {
  const ctx = healthyCtx({ get: (name) => (name === 'llm' ? {} : healthyCtx().get(name)) })
  const feature = runFeatureGuard('llm/admission', ctx, healthyDeps())
  const core = runCoreGuard(healthyCtx(), versions)
  assert.equal(feature.ok, false)
  assert.ok(feature.featureProblems['llm/admission'].some((p) => p.name === 'llm.resolveModelInfo'))
  assert.equal(core.ok, true)
})

test('missing agents.get is a feature failure and core stays healthy', () => {
  const ctx = healthyCtx({ get: (name) => (name === 'agents' ? {} : healthyCtx().get(name)) })
  const feature = runFeatureGuard('llm/admission', ctx, healthyDeps())
  const core = runCoreGuard(healthyCtx(), versions)
  assert.equal(feature.ok, false)
  assert.ok(feature.featureProblems['llm/admission'].some((p) => p.name === 'agents.get'))
  assert.equal(core.ok, true)
})

test('missing dshLlm.contentHasImage is a feature failure and core stays healthy', () => {
  const feature = runFeatureGuard('llm/admission', healthyCtx(), { dshLlm: {}, AsyncLocalStorage })
  const core = runCoreGuard(healthyCtx(), versions)
  assert.equal(feature.ok, false)
  assert.ok(feature.featureProblems['llm/admission'].some((p) => p.name === 'dshLlm.contentHasImage'))
  assert.equal(core.ok, true)
})

test('unusable AsyncLocalStorage is a feature failure and core stays healthy', () => {
  const feature = runFeatureGuard('llm/admission', healthyCtx(), { dshLlm: { contentHasImage() {} }, AsyncLocalStorage: {} })
  const core = runCoreGuard(healthyCtx(), versions)
  assert.equal(feature.ok, false)
  assert.ok(feature.featureProblems['llm/admission'].some((p) => p.name === 'AsyncLocalStorage'))
  assert.equal(core.ok, true)
})

test('missing apiProxy.sessions is a feature failure and core stays healthy', () => {
  const ctx = healthyCtx({ get: () => undefined })
  const feature = runFeatureGuard('llm/admission', ctx, healthyDeps())
  const core = runCoreGuard(healthyCtx(), versions)
  assert.equal(feature.ok, false)
  assert.ok(feature.featureProblems['llm/admission'].some((p) => p.name === 'apiProxy.sessions'))
  assert.equal(core.ok, true)
})

test('llm feature guard passes when all six required llm methods exist', () => {
  const result = runFeatureGuard('llm', healthyCtx(), healthyDeps())
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
  assert.equal(result.coreProblems.length, 0)
  assert.deepEqual(result.featureProblems, { llm: [] })
})

test('missing ctx.get is a llm feature failure', () => {
  const ctx = healthyCtx({ get: undefined })
  const result = runFeatureGuard('llm', ctx, healthyDeps())
  assert.equal(result.ok, false)
  assert.ok(result.featureProblems.llm.some((p) => p.name === 'ctx.get'))
})

test('missing llm service is a llm feature failure', () => {
  const ctx = healthyCtx({ get: () => undefined })
  const result = runFeatureGuard('llm', ctx, healthyDeps())
  assert.equal(result.ok, false)
  for (const method of [
    'llm.resolveModelInfo',
    'llm.prepareCall',
    'llm.stream',
    'llm.registerAdapter',
    'llm.registerConfigurableProviders',
    'llm.registerModelDiscovery',
  ]) {
    assert.ok(result.featureProblems.llm.some((p) => p.name === method), `missing problem: ${method}`)
  }
})

test('missing any one llm method is a llm feature failure', () => {
  const methods = [
    'resolveModelInfo',
    'prepareCall',
    'stream',
    'registerAdapter',
    'registerConfigurableProviders',
    'registerModelDiscovery',
  ]
  for (const method of methods) {
    const ctx = healthyCtx({
      get: (name) => {
        if (name === 'llm') {
          const llm = {
            resolveModelInfo() {},
            prepareCall() {},
            stream() {},
            registerAdapter() {},
            registerConfigurableProviders() {},
            registerModelDiscovery() {},
          }
          delete llm[method]
          return llm
        }
        return healthyCtx().get(name)
      },
    })
    const result = runFeatureGuard('llm', ctx, healthyDeps())
    assert.equal(result.ok, false, `llm guard should fail without ${method}`)
    assert.ok(result.featureProblems.llm.some((p) => p.name === `llm.${method}`), `missing problem: llm.${method}`)
  }
})

test('unknown feature guard fails without throwing', () => {
  const result = runFeatureGuard('unknown/feature', healthyCtx(), healthyDeps())
  assert.equal(result.ok, false)
  assert.ok(result.featureProblems['unknown/feature'].some((p) => p.name === 'feature'))
})

function servicesCtx({ missing = [], getMissing = false } = {}) {
  return {
    get(name) {
      if (getMissing) return undefined
      const def = SERVICE_DEFINITIONS.find((d) => d.ctxService === name)
      if (def) {
        return missing.includes(name) ? undefined : {}
      }
      return undefined
    },
  }
}

test('services feature guard passes when all 21 official services are present', () => {
  const result = runFeatureGuard('services', servicesCtx(), {})
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
})

test('services feature guard passes when only compaction is present', () => {
  const result = runFeatureGuard('services', {
    get(name) {
      if (name !== 'compaction') return undefined
      return {
        compactIfNeeded() {},
        compactNow() {},
        compactRegion() {},
      }
    },
  }, {})
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
})

test('services feature guard passes when only jobs is present', () => {
  const result = runFeatureGuard('services', {
    get(name) {
      if (name !== 'jobs') return undefined
      return {
        start() {}, list() {}, get() {}, read() {}, kill() {}, wait() {},
        onJobDone() {}, onJobsChanged() {}, attachController() {},
      }
    },
  }, {})
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
})

test('services feature guard passes when only shellEnv is present', () => {
  const result = runFeatureGuard('services', {
    get(name) {
      if (name !== 'shellEnv') return undefined
      return { register() {}, collect() {}, list() {} }
    },
  }, {})
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
})

test('services feature guard passes when only some services are present', () => {
  const result = runFeatureGuard('services', servicesCtx({ missing: ['fs', 'skills'] }), {})
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
})

test('services feature guard fails when none of the 21 services is present', () => {
  const result = runFeatureGuard('services', servicesCtx({ getMissing: true }), {})
  assert.equal(result.ok, false)
  assert.ok(result.featureProblems.services.some((p) => p.name === 'capability services'))
})

test('services feature guard fails when ctx.get is missing', () => {
  const result = runFeatureGuard('services', {}, {})
  assert.equal(result.ok, false)
  assert.ok(result.featureProblems.services.some((p) => p.name === 'ctx.get'))
})

test('hostile ctx with throwing getters is contained for the services guard', () => {
  const hostile = new Proxy({}, {
    get() {
      throw new Error('hostile getter')
    },
  })
  const result = runFeatureGuard('services', hostile, {})
  assert.equal(typeof result.ok, 'boolean')
  assert.equal(result.ok, false)
})

test('hostile ctx with throwing getters never throws in core or feature guard', () => {
  const hostile = new Proxy({}, {
    get() {
      throw new Error('hostile getter')
    },
  })
  const core = runCoreGuard(hostile, versions)
  assert.equal(typeof core.ok, 'boolean')
  assert.equal(core.ok, false)
  assert.ok(core.coreProblems.length > 0)

  const feature = runFeatureGuard('llm/admission', hostile, healthyDeps())
  assert.equal(typeof feature.ok, 'boolean')
  assert.equal(feature.ok, false)
  assert.ok(feature.featureProblems['llm/admission'].length > 0)
})

test('DSH_PLUGIN_API_GUARD_DISABLE=1 skips both core and feature checks', () => {
  const previous = process.env.DSH_PLUGIN_API_GUARD_DISABLE
  process.env.DSH_PLUGIN_API_GUARD_DISABLE = '1'
  try {
    const core = runCoreGuard(healthyCtx({ plugin: undefined }), {})
    assert.equal(core.ok, true)
    assert.equal(core.skipped, true)
    assert.deepEqual(core.problems, [])

    const feature = runFeatureGuard('llm/admission', healthyCtx({ get: () => undefined }), healthyDeps())
    assert.equal(feature.ok, true)
    assert.equal(feature.skipped, true)
    assert.deepEqual(feature.problems, [])
  } finally {
    if (previous === undefined) delete process.env.DSH_PLUGIN_API_GUARD_DISABLE
    else process.env.DSH_PLUGIN_API_GUARD_DISABLE = previous
  }
})

test('DSH_PLUGIN_API_FORCE_GUARD_FAIL=1 forces a core failure', () => {
  const previous = process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
  process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = '1'
  try {
    const result = runCoreGuard(healthyCtx(), versions)
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
    const result = runCoreGuard(healthyCtx(), versions)
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

test('guardFailNotice is bilingual, includes log path and skip env var', () => {
  const notice = guardFailNotice('/tmp/example.log')
  assert.match(notice, /dsh-plugin-api/)
  assert.match(notice, /core self-check FAILED/)
  assert.match(notice, /核心自检未通过/)
  assert.match(notice, /\/tmp\/example\.log/)
  assert.match(notice, /DSH_PLUGIN_API_GUARD_DISABLE=1/)
})

test('featureFailNotice is bilingual and includes feature name and log path', () => {
  const notice = featureFailNotice('llm/admission', '/tmp/example.log')
  assert.match(notice, /dsh-plugin-api/)
  assert.match(notice, /llm\/admission/)
  assert.match(notice, /feature .*self-check FAILED|自检未通过/)
  assert.match(notice, /\/tmp\/example\.log/)
})
