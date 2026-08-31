import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { apply } from '../lib/index.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

const require = createRequire(import.meta.url)

function createMockCtx(options = {}) {
  const listeners = []
  const effects = []
  const sessions = {
    get() {},
    list() {},
    fork() {},
  }
  const services = {
    loader: { entries() { return [] } },
    llm: {
      resolveModelInfo() {},
      prepareCall() {},
      stream() {},
      registerAdapter() {},
      registerConfigurableProviders() {},
      registerModelDiscovery() {},
    },
    agents: { get() {}, list() {}, roots() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    sessions,
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
  }
  const state = {
    effects,
    listeners,
    pluginApi: undefined,
  }
  const ctx = {
    logger: options.logger,
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') state.pluginApi = value
      },
    },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      return services[name]
    },
    plugin(Class) {
      new Class(ctx)
      if (options.registryMountFailure) {
        const mount = state.pluginApi._registry.mount.bind(state.pluginApi._registry)
        state.pluginApi._registry.mount = (name) => {
          if (name !== 'sessionDurable') return mount(name)
          if (options.registryMountFailure === 'after') mount(name)
          throw new Error('registry mount failed')
        }
      }
      if (options.throwDurableMount) {
        const prepareFeature = state.pluginApi.prepareFeature.bind(state.pluginApi)
        state.pluginApi.prepareFeature = (name, api) => {
          if (name === 'sessionDurable') throw new Error('durable mount failed')
          return prepareFeature(name, api)
        }
      }
    },
    effect(fn, label) {
      if (options.throwEffect && label === 'dsh-plugin-api: sessionDurable cleanup') {
        throw new Error('effect registration failed')
      }
      effects.push({ fn, label })
    },
    on(name, listener) {
      listeners.push({ name, listener })
      let disposed = false
      return () => {
        if (disposed) return false
        disposed = true
        const index = listeners.findIndex((entry) => entry.listener === listener)
        if (index >= 0) listeners.splice(index, 1)
        return index >= 0
      }
    },
    once() {},
    emit() {},
    serial() {},
    parallel() {},
    bail() {},
    waterfall() {},
  }
  return { ctx, state, sessions }
}

function feature(state, name) {
  return state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').find((entry) => entry.name === name)
}

function durableCleanup(state) {
  const effect = state.effects.find((entry) => entry.label === 'dsh-plugin-api: sessionDurable cleanup')
  assert.ok(effect, 'sessionDurable must register an epoch cleanup effect')
  return effect.fn()
}

test('apply mounts sessionDurable immediately after session without extending the events catalog', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))

  assert.deepEqual(state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough').map((entry) => entry.name), [
    'tools',
    'events',
    'agent',
    'llm',
    'llm/request',
    'llm/admission',
    'security',
    'session',
    'sessionBranch',
    'sessionDurable',
    'execRoute',
    'sessionRoute',
    'settings',
    'systemPrompt',
    'services',
    'typert',
    'settingsRemote',
    'remote',
    'execution',
    'recovery',
    'coordination',
    'storage',
    'workspaceTransactions',
    'diagnostics',
    'tasks',

    'toolDiscovery',

    'skillsActivation',

    'context',

    'profile',

    'llmAdapters',

    'sessionChannel',
  ])
  assert.equal(feature(state, 'session').isActive, true)
  assert.equal(feature(state, 'sessionDurable').isActive, true)
  assert.equal(Object.keys(state.pluginApi.events.catalog()).length, 47)
  assert.equal(state.pluginApi.events.catalog()['approval/asked'], undefined)
  assert.deepEqual(state.pluginApi.sessions.durable.list().map((entry) => entry.name), [
    'approval/asked',
    'approval/decided',
    'approval/policy',
    'schedule/change',
    'subagent/descriptor',
  ])
  assert.ok(state.pluginApi.sessions.durable.list().every((entry) => entry.descriptor), 'the merged list carries descriptors')
  assert.equal(typeof state.pluginApi.sessions.durable.observe, 'function')
  assert.equal(typeof state.pluginApi.sessions.appendMessage, 'function')
  // One shared observe feed backs the session/event projection subscribers
  // (durable hub, sessionRoute and sessionChannel share the feed).
  assert.equal(state.listeners.filter((entry) => entry.name === 'session/event').length, 2)
})

test('durable cleanup restores feature-disabled, and a stale cleanup cannot revoke a re-mounted epoch', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const firstSessionApi = state.pluginApi.sessions
  const firstCleanup = durableCleanup(state)

  assert.equal(firstCleanup(), true)
  assert.equal(feature(state, 'sessionDurable').isActive, false)
  assert.throws(() => firstSessionApi.durable.observe(), (error) => {
    assert.ok(error instanceof PluginApiFeatureDisabledError)
    assert.equal(error.feature, 'sessionDurable')
    return true
  })
  assert.equal(firstCleanup(), false)

  apply(ctx)
  assert.equal(feature(state, 'sessionDurable').isActive, true)
  assert.equal(state.listeners.filter((entry) => entry.name === 'session/event').length, 2, 'durable remount reuses the shared session/event feed beside sessionRoute and sessionChannel')
  const secondSessionApi = state.pluginApi.sessions
  const cleanups = state.effects
    .filter((entry) => entry.label === 'dsh-plugin-api: sessionDurable cleanup')
    .map((entry) => entry.fn())
  const secondCleanup = cleanups.at(-1)

  assert.equal(firstCleanup(), false)
  assert.equal(feature(state, 'sessionDurable').isActive, true)
  assert.equal(secondCleanup(), true)
  assert.throws(() => secondSessionApi.appendMessage(), (error) => {
    assert.ok(error instanceof PluginApiFeatureDisabledError)
    assert.equal(error.feature, 'sessionDurable')
    return true
  })
})

test('an effect registration failure resets the published durable epoch before disabling it', () => {
  const { ctx, state } = createMockCtx({ throwEffect: true, logger: { error() {}, warn() {} } })
  assert.doesNotThrow(() => apply(ctx))

  assert.equal(feature(state, 'sessionDurable').isActive, false)
  assert.equal(state.listeners.filter((entry) => entry.name === 'session/event').length, 2, 'failed durable transaction leaves the sessionRoute and sessionChannel feeds intact')
  assert.throws(() => state.pluginApi.sessions.durable.list(), (error) => {
    assert.ok(error instanceof PluginApiFeatureDisabledError)
    assert.equal(error.feature, 'sessionDurable')
    return true
  })
})

test('registry mount failures before and after activation reset the published durable epoch', () => {
  for (const registryMountFailure of ['before', 'after']) {
    const { ctx, state } = createMockCtx({
      registryMountFailure,
      logger: { error() {}, warn() {} },
    })
    assert.doesNotThrow(() => apply(ctx))

    assert.equal(feature(state, 'sessionDurable').isActive, false)
    assert.equal(state.listeners.filter((entry) => entry.name === 'session/event').length, 2)
    assert.throws(() => state.pluginApi.sessions.durable.observe(), (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'sessionDurable')
      return true
    })
  }
})

test('sessionDurable remains disabled when session or events cannot mount', () => {
  for (const missing of ['sessions', 'waterfall']) {
    const { ctx, state } = createMockCtx()
    if (missing === 'sessions') {
      ctx.get = (name) => (name === 'pluginApi' ? state.pluginApi : name === 'sessions' ? undefined : undefined)
    } else {
      delete ctx.waterfall
    }
    apply(ctx)
    assert.equal(feature(state, 'sessionDurable').isActive, false)
  }
})

test('a sessionDurable mounter exception leaves the composed session facade at feature-disabled', () => {
  const { ctx, state } = createMockCtx({ throwDurableMount: true, logger: { error() {}, warn() {} } })
  assert.doesNotThrow(() => apply(ctx))

  assert.equal(feature(state, 'sessionDurable').isActive, false)
  assert.equal(typeof state.pluginApi.sessions.get, 'function')
  assert.throws(() => state.pluginApi.sessions.appendMessage(), (error) => {
    assert.ok(error instanceof PluginApiFeatureDisabledError)
    assert.equal(error.feature, 'sessionDurable')
    return true
  })
})

test('apply-time durable failure routes contain absent and throwing loggers', () => {
  for (const logger of [undefined, { error() { throw new Error('logger error') }, warn() { throw new Error('logger warn') } }]) {
    for (const options of [
      { throwDurableMount: true },
      { throwEffect: true },
      { registryMountFailure: 'before' },
      { registryMountFailure: 'after' },
    ]) {
      const { ctx, state } = createMockCtx({ ...options, logger })
      assert.doesNotThrow(() => apply(ctx))
      assert.equal(feature(state, 'sessionDurable').isActive, false)
      assert.throws(() => state.pluginApi.sessions.durable.observe(), PluginApiFeatureDisabledError)
    }
  }
})

test('host audit and public contract mismatches retain baseline session while disabling sessionDurable', () => {
  const scheduleManifest = require('@deepseek-ai/dsh-schedule/package.json')
  const originalScheduleVersion = scheduleManifest.version
  const scheduleType = 'schedule/change'

  try {
    scheduleManifest.version = '0.1.0-rc.7'
    const packageMismatch = createMockCtx()
    apply(packageMismatch.ctx)
    assert.equal(feature(packageMismatch.state, 'session').isActive, true)
    assert.equal(feature(packageMismatch.state, 'sessionDurable').isActive, false)
    assert.equal(typeof packageMismatch.state.pluginApi.sessions.get, 'function')
    assert.throws(() => packageMismatch.state.pluginApi.sessions.durable.observe(), PluginApiFeatureDisabledError)

    scheduleManifest.version = originalScheduleVersion
    assert.equal(KNOWN_SESSION_EVENT_TYPES.delete(scheduleType), true)
    const contractMismatch = createMockCtx()
    apply(contractMismatch.ctx)
    assert.equal(feature(contractMismatch.state, 'session').isActive, true)
    assert.equal(feature(contractMismatch.state, 'sessionDurable').isActive, false)
    assert.equal(typeof contractMismatch.state.pluginApi.sessions.get, 'function')
    assert.throws(() => contractMismatch.state.pluginApi.sessions.appendMessage(), PluginApiFeatureDisabledError)
  } finally {
    scheduleManifest.version = originalScheduleVersion
    KNOWN_SESSION_EVENT_TYPES.add(scheduleType)
  }
})
