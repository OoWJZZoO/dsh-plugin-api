/**
 * Delivered-contract regression tests through the integrated host facade:
 * the tool aborted-error helper, the generic host remote publication, and
 * the jobs / shellEnv service seams. Each section re-proves the approved
 * contract after the final integration joins: exact member surfaces, official identity and
 * receiver forwarding, owner disposer isolation, wire-parameter validation,
 * and local per-leaf degradation without affecting unrelated features.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, buildToolAbortedErrorFactory } from '../lib/index.js'
import { PluginApiFeatureDisabledError, PluginApiRemoteError } from '../lib/errors.js'

function noOp() {}

function createTypertRegistry() {
  return {
    register: noOp, get: noOp, resolve: noOp, list: noOp, getPackage: noOp, listPackages: noOp, toJSONSchema: noOp,
    local: { get: noOp, hasSeen: noOp, list: noOp, subscribe: noOp },
    remotes: { register: noOp, get: noOp, list: noOp, subscribe: noOp },
    lookups: { register: noOp, configure: noOp, get: noOp, definitions: noOp, keys: noOp, subscribe: noOp },
    contexts: { registerHost: noOp, configureHost: noOp, registerClient: noOp, getHost: noOp, getClient: noOp, subscribe: noOp },
  }
}

function createMockCtx({ services: extra = {}, systemPrompt = true } = {}) {
  const services = {
    llm: {
      resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {},
      registerConfigurableProviders() {}, registerModelDiscovery() {},
    },
    agents: { get() {}, list() {}, roots() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    sessions: { get() {}, list() {}, fork() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    typert: createTypertRegistry(),
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
    ...(systemPrompt ? { systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} } } : {}),
    ...extra,
  }
  const state = {
    pluginApi: undefined,
    provided: [], // { name, value }
  }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') {
          state.pluginApi = value
          return () => { state.pluginApi = undefined }
        }
        state.provided.push({ name, value })
        return () => {
          const index = state.provided.findIndex((s) => s.name === name && s.value === value)
          if (index >= 0) state.provided.splice(index, 1)
          return true
        }
      },
    },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      if (name in services) return services[name]
      return undefined
    },
    plugin(Class) { new Class(ctx) },
    effect() {},
    on() { return () => {} },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  return { ctx, state, services }
}

// -- tool aborted-error contract --

test('aborted error: typed identity through the integrated facade', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const tools = state.pluginApi.tools
  assert.equal(tools.isActive, true)
  const err = tools.toolAbortedError()
  assert.ok(err instanceof Error)
  assert.equal(err.name, 'AbortError')
  assert.equal(err.message, 'tool call aborted')
  if (typeof err.code === 'string') assert.equal(err.code, 'ABORTED')
})

test('aborted error: degraded factory when the official source is unavailable', () => {
  const make = buildToolAbortedErrorFactory(() => { throw new Error('module not found') })
  const err = make()
  assert.ok(err instanceof Error)
  assert.equal(err.name, 'AbortError')
  assert.equal(err.message, 'tool call aborted')
  assert.equal('code' in err, false)
})

test('aborted error: disabled tools degrade locally without touching other features', () => {
  const { ctx, state } = createMockCtx({ services: { tools: undefined } })
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(state.pluginApi.tools.isActive, false)
  assert.equal(typeof state.pluginApi.tools.toolAbortedError, 'function')
  assert.throws(
    () => state.pluginApi.tools.toolAbortedError(),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'tools',
  )
  assert.equal(state.pluginApi.services.web.isActive, true, 'unrelated features stay healthy')
})

// -- generic host remote publication --

test('remote: publication registers with wire-parameter validation and an isolated owner disposer', async () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const remote = state.pluginApi.remote
  assert.equal(remote.isActive, true)

  const service = {
    getPayload(limit) { return { limit } },
    setPayload(payload) { return { ok: true, payload } },
  }
  const disposer = remote.publish('regressionConfig', service)
  assert.equal(typeof disposer, 'function')
  const published = state.provided.find((s) => s.name === 'regressionConfig')
  assert.ok(published, 'service published through the official boundary')
  assert.equal(published.value, service)

  // Wire parameter names are the method parameter names: an identifier-shaped
  // signature is accepted, a signature the official gateway cannot derive
  // (destructuring) is rejected with a typed error before registration.
  assert.throws(
    () => remote.publish('badWireConfig', { config({ limit }) { return null } }),
    (error) => error instanceof PluginApiRemoteError,
  )

  // The disposer is idempotent and removes only its own publication.
  assert.equal(await disposer(), true)
  assert.equal(state.provided.some((s) => s.name === 'regressionConfig'), false)
  assert.equal(await disposer(), false)
})

test('remote: same-key same-reference publish is idempotent; a conflicting owner is rejected', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  const remote = state.pluginApi.remote
  const service = { get() { return { ok: true } } }

  const first = remote.publish('conflictConfig', service)
  const second = remote.publish('conflictConfig', service)
  assert.equal(first, second, 'idempotent re-publication reuses the same disposer')
  assert.throws(
    () => remote.publish('conflictConfig', { get() { return { ok: true } } }),
    (error) => error instanceof PluginApiRemoteError,
    'a different reference under the same key is a typed conflict',
  )
  first()
  assert.equal(state.provided.some((s) => s.name === 'conflictConfig'), false)
})

test('remote: missing typert prerequisite degrades to the disabled surface (feature-disabled isolation)', () => {
  const { ctx, state } = createMockCtx({ services: { typert: undefined } })
  assert.doesNotThrow(() => apply(ctx))
  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.remote.isActive, false)
  assert.throws(
    () => state.pluginApi.remote.publish('k', { get() {} }),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'remote',
  )
  assert.equal(state.pluginApi.tools.isActive, true, 'unrelated features stay healthy')
})

// -- jobs / shellEnv service seams --

const JOBS_MEMBERS = ['start', 'list', 'get', 'read', 'kill', 'wait', 'onJobDone', 'onJobsChanged', 'attachController']
const SHELLENV_MEMBERS = ['register', 'collect', 'list']

function createJobsService() {
  const calls = []
  const jobs = {}
  for (const member of JOBS_MEMBERS) {
    jobs[member] = function (...args) {
      calls.push([member, this, args])
      return { member, args }
    }
  }
  return { jobs, calls }
}

function createShellEnvService() {
  const calls = []
  const shellEnv = {}
  for (const member of SHELLENV_MEMBERS) {
    shellEnv[member] = function (...args) {
      calls.push([member, this, args])
      return { member, args }
    }
  }
  return { shellEnv, calls }
}

test('services/jobs and services/shellEnv expose exact members with receiver identity through apply', () => {
  const jobsFixture = createJobsService()
  const shellEnvFixture = createShellEnvService()
  const { ctx, state } = createMockCtx({
    services: { jobs: jobsFixture.jobs, shellEnv: shellEnvFixture.shellEnv },
  })
  assert.doesNotThrow(() => apply(ctx))
  const services = state.pluginApi.services

  assert.deepEqual(Object.keys(services.jobs), ['isActive', ...JOBS_MEMBERS])
  assert.equal(services.jobs.isActive, true)
  assert.deepEqual(Object.keys(services.shellEnv), ['isActive', ...SHELLENV_MEMBERS])
  assert.equal(services.shellEnv.isActive, true)

  for (const member of JOBS_MEMBERS) {
    const args = [member, 7]
    const result = services.jobs[member](...args)
    assert.deepEqual(result, { member, args })
    assert.equal(jobsFixture.calls.at(-1)[1], jobsFixture.jobs, `${member} keeps the official receiver`)
    assert.deepEqual(jobsFixture.calls.at(-1)[2], args)
  }
  for (const member of SHELLENV_MEMBERS) {
    const args = ['env', 1]
    const result = services.shellEnv[member](...args)
    assert.deepEqual(result, { member, args })
    assert.equal(shellEnvFixture.calls.at(-1)[1], shellEnvFixture.shellEnv, `${member} keeps the official receiver`)
    assert.deepEqual(shellEnvFixture.calls.at(-1)[2], args)
  }
})

test('services/jobs and services/shellEnv degrade per service when a provider is absent', () => {
  const { ctx, state } = createMockCtx({ services: { jobs: undefined, shellEnv: undefined } })
  assert.doesNotThrow(() => apply(ctx))
  const services = state.pluginApi.services

  assert.equal(services.jobs.isActive, false)
  assert.throws(
    () => services.jobs.start('x'),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'services.jobs',
  )
  assert.equal(services.shellEnv.isActive, false)
  assert.throws(
    () => services.shellEnv.collect(),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'services.shellEnv',
  )
  assert.equal(services.web.isActive, true, 'missing seam providers never disable the namespace')
})