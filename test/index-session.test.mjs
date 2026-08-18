import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

function createMockCtx(options = {}) {
  const web = {
    registerSearchProvider(provider) {
      web.searchProviderCalls.push(provider)
      return web.searchDisposer
    },
    registerFetchProvider(provider) {
      web.fetchProviderCalls.push(provider)
      return web.fetchDisposer
    },
    searchProviderCalls: [],
    fetchProviderCalls: [],
    searchDisposer: () => {},
    fetchDisposer: () => {},
  }

  const sessions = options.sessions === false
    ? undefined
    : {
        get() {},
        list() {},
        fork() {},
      }

  const services = {
    llm: {
      resolveModelInfo() {},
      prepareCall() {},
      stream() {},
      registerAdapter() {},
      registerConfigurableProviders() {},
      registerModelDiscovery() {},
    },
    agents: { get() {}, list() {}, roots() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web,
    ...(sessions ? { sessions } : {}),
    ...(options.services ?? {}),
  }

  const state = {
    pluginApi: undefined,
    provideCount: 0,
    effects: [],
    getCalls: [],
    listeners: [],
  }

  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') {
          state.pluginApi = value
          state.provideCount += 1
        }
      },
    },
    get(name) {
      state.getCalls.push(name)
      if (name === 'pluginApi') return state.pluginApi
      if (name in services) return services[name]
      return undefined
    },
    plugin(Class) {
      new Class(ctx)
    },
    effect(fn, label) {
      state.effects.push({ fn, label })
    },
    on(name, listener) {
      state.listeners.push({ name, listener })
      return () => false
    },
    once(name, listener) {
      state.listeners.push({ name, listener, once: true })
      return () => false
    },
    emit() {},
    serial() {},
    parallel() {},
    bail() {},
    waterfall() {},
  }

  return { ctx, state, services, web, sessions }
}

test('apply mounts session after events with a composed events catalog', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)

  const catalog = state.pluginApi.events.catalog
  assert.ok(catalog, 'events catalog must exist')
  assert.equal(Object.keys(catalog).length, 47)
  assert.ok(Object.isFrozen(catalog), 'composed catalog must be frozen')
  for (const name of [
    'session/created',
    'session/disposed',
    'session/event',
    'session/flush',
  ]) {
    assert.ok(catalog[name], `${name} must be in the composed catalog`)
  }

  assert.equal(state.pluginApi.session.isActive, true)
  assert.deepEqual(
    state.pluginApi.features.map((feature) => feature.name),
    ['tools', 'events', 'agent', 'llm', 'llm/request', 'llm/admission', 'session', 'sessionDurable', 'execRoute', 'sessionRoute', 'settings', 'systemPrompt', 'services', 'typert', 'settingsRemote'],
  )
  assert.ok(state.pluginApi.features.slice(0, 13).every((feature) => feature.isActive))
  assert.equal(state.pluginApi.features[13].isActive, false)
  assert.equal(state.pluginApi.features[14].isActive, false)
  assert.equal(state.pluginApi.features.some((feature) => feature.name === 'compaction'), false)
  const listener = () => {}
  state.pluginApi.session.on('session/event', listener)
  assert.ok(state.listeners.some((l) => l.name === 'session/event'), 'session/event must register a native hook')

  assert.ok(Array.isArray(state.pluginApi.session.sessionEventTypes))
  assert.ok(Object.isFrozen(state.pluginApi.session.sessionEventTypes))
  assert.ok(Array.isArray(state.pluginApi.session.surfaceEventTypes))
  assert.ok(Object.isFrozen(state.pluginApi.session.surfaceEventTypes))
  assert.equal(typeof state.pluginApi.session.get, 'function')
  assert.equal(typeof state.pluginApi.session.fork, 'function')
  assert.equal(typeof state.pluginApi.session.header, 'function')
  assert.equal(typeof state.pluginApi.session.deriveMessages, 'function')
  assert.equal(typeof state.pluginApi.session.isSessionEventType, 'function')
})

test('apply completes every guard pass before pass-2 publication and an early P2 does not stop later mounters', () => {
  const { ctx, state } = createMockCtx({ services: { tools: undefined } })
  let firstPublicationGetCalls
  const originalEffect = ctx.effect
  ctx.effect = (fn, label) => {
    if (!firstPublicationGetCalls) firstPublicationGetCalls = [...state.getCalls]
    originalEffect(fn, label)
  }

  assert.doesNotThrow(() => apply(ctx))

  // `fs` is only resolved by the final services guard. Its presence before
  // the first cleanup registration proves all guard branches have run before
  // the first pass-2 publication attempt.
  assert.equal(state.effects[0]?.label, 'dsh-plugin-api: events cleanup')
  assert.ok(firstPublicationGetCalls.includes('fs'))
  assert.ok(firstPublicationGetCalls.includes('systemPrompt'))
  assert.ok(firstPublicationGetCalls.includes('sessions'))

  const features = state.pluginApi.features
  assert.deepEqual(
    features.map((feature) => feature.name),
    ['tools', 'events', 'agent', 'llm', 'llm/request', 'llm/admission', 'session', 'sessionDurable', 'execRoute', 'sessionRoute', 'settings', 'systemPrompt', 'services', 'typert', 'settingsRemote'],
  )
  assert.equal(features.find((feature) => feature.name === 'tools')?.isActive, false)
  assert.equal(features.find((feature) => feature.name === 'execRoute')?.isActive, false)
  for (const name of ['events', 'agent', 'llm', 'llm/request', 'llm/admission', 'session', 'sessionDurable', 'settings', 'systemPrompt', 'services']) {
    assert.equal(features.find((feature) => feature.name === name)?.isActive, true, `${name} remains independently mounted`)
  }
  assert.equal(features.find((feature) => feature.name === 'typert')?.isActive, false)
  assert.equal(features.find((feature) => feature.name === 'settingsRemote')?.isActive, false)
  assert.equal(state.pluginApi.events.catalog['tools/change'], undefined)
  assert.equal(state.pluginApi.features.some((feature) => feature.name === 'compaction'), false)
})

test('session guard failure disables only session and keeps the facade active', () => {
  const { ctx, state } = createMockCtx({ sessions: false })
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)

  const features = state.pluginApi.features
  assert.equal(features.length, 15)
  assert.deepEqual(features.map((f) => f.name), ['tools', 'events', 'agent', 'llm', 'llm/request', 'llm/admission', 'session', 'sessionDurable', 'execRoute', 'sessionRoute', 'settings', 'systemPrompt', 'services', 'typert', 'settingsRemote'])
  assert.equal(features[0].isActive, true)
  assert.equal(features[1].isActive, true)
  assert.equal(features[2].isActive, true)
  assert.equal(features[3].isActive, true)
  assert.equal(features[4].isActive, true)
  assert.equal(features[5].isActive, true)
  assert.equal(features[6].isActive, false)
  assert.match(features[6].reason, /sessions\.get/)
  assert.equal(features[7].isActive, false)
  assert.equal(features[8].isActive, false)
  assert.equal(features[9].isActive, false)
  assert.equal(features[10].isActive, true)
  assert.equal(features[11].isActive, true)
  assert.equal(features[12].isActive, true)

  assert.throws(
    () => state.pluginApi.session.get('s1'),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'session')
      return true
    },
  )

  assert.equal(typeof state.pluginApi.events.on, 'function')
  assert.equal(typeof state.pluginApi.services.web.registerSearchProvider, 'function')
  assert.equal(typeof state.pluginApi.llm.admission.register, 'function')
})

test('sessionRoute prepared cleanup rolls back its epoch, preserves routing identity, and reapplies cleanly', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const routing = state.pluginApi.routing
  const firstEffect = state.effects.find((entry) => entry.label === 'dsh-plugin-api: sessionRoute cleanup')?.fn
  assert.equal(typeof firstEffect, 'function')
  const firstCleanup = firstEffect()
  assert.equal(firstCleanup(), true)
  assert.equal(state.pluginApi.features.find((entry) => entry.name === 'sessionRoute')?.isActive, false)
  assert.equal(state.pluginApi.routing, routing)
  assert.equal(firstCleanup(), false)

  apply(ctx)
  assert.equal(state.pluginApi.features.find((entry) => entry.name === 'sessionRoute')?.isActive, true)
  assert.equal(state.pluginApi.routing, routing)
  const secondEffect = state.effects
    .filter((entry) => entry.label === 'dsh-plugin-api: sessionRoute cleanup')
    .at(-1).fn
  const secondCleanup = secondEffect()
  assert.equal(secondCleanup(), true)
  assert.equal(firstCleanup(), false)
})
