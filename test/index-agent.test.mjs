import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

function createMockCtx(options = {}) {
  const agents = options.agents === false
    ? undefined
    : {
        getCalls: [],
        listCalls: 0,
        rootsCalls: 0,
        get(id) {
          this.getCalls.push(id)
          return id === 'agent-1' ? { id: 'agent-1' } : undefined
        },
        list() {
          this.listCalls += 1
          return [{ id: 'agent-1' }]
        },
        roots() {
          this.rootsCalls += 1
          return [{ id: 'agent-1' }]
        },
      }

  const web = options.web === false
    ? undefined
    : {
        registerSearchProvider() {},
        registerFetchProvider() {},
      }

  const services = {
    llm: { resolveModelInfo() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    sessions: { get() {}, list() {}, fork() {} },
    ...(agents ? { agents } : {}),
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    ...(web ? { web } : {}),
  }
  const state = {
    pluginApi: undefined,
    effects: [],
    listeners: [],
  }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') state.pluginApi = value
      },
    },
    get(name) {
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
      return () => {}
    },
    once() {},
    emit() {},
    serial() {},
    parallel() {},
    bail() {},
    ...(options.events === false ? {} : { waterfall() {} }),
  }
  return { ctx, state, agents, web }
}

test('apply mounts agent after events and exposes a working registry read API', () => {
  const { ctx, state, agents } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)
  assert.equal(state.pluginApi.agent.isActive, true)
  assert.equal(state.pluginApi.agent.get('agent-1').id, 'agent-1')
  assert.equal(state.pluginApi.agent.list().length, 1)
  assert.equal(state.pluginApi.agent.roots().length, 1)
  assert.deepEqual(agents.getCalls, ['agent-1'])

  const features = state.pluginApi.features
  assert.deepEqual(features.map((f) => f.name), ['tools', 'events', 'agent', 'session', 'web', 'llm/admission'])
  assert.ok(features.every((f) => f.isActive))
})

test('agent guard failure disables only agent and keeps facade active', () => {
  const { ctx, state } = createMockCtx({ agents: false })
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)
  const features = state.pluginApi.features
  assert.equal(features.length, 6)
  assert.deepEqual(features[0], { name: 'tools', isActive: true })
  assert.deepEqual(features[1], { name: 'events', isActive: true })
  assert.equal(features[2].name, 'agent')
  assert.equal(features[2].isActive, false)
  assert.match(features[2].reason, /agents\.get/)
  assert.deepEqual(features[3], { name: 'session', isActive: true })
  assert.deepEqual(features[4], { name: 'web', isActive: true })
  assert.equal(features[5].name, 'llm/admission')
  assert.equal(features[5].isActive, false)
  assert.match(features[5].reason, /agents\.get/)

  for (const method of ['get', 'list', 'roots']) {
    assert.throws(
      () => state.pluginApi.agent[method]('agent-1'),
      (error) => {
        assert.ok(error instanceof PluginApiFeatureDisabledError)
        assert.equal(error.feature, 'agent')
        return true
      },
    )
  }
  assert.equal(typeof state.pluginApi.events.on, 'function')
  assert.equal(typeof state.pluginApi.web.registerSearchProvider, 'function')
})

test('events guard failure does not block the agent registry read API', () => {
  const { ctx, state } = createMockCtx({ events: false })
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)
  const features = state.pluginApi.features
  assert.equal(features.length, 6)
  assert.equal(features[0].name, 'tools')
  assert.equal(features[0].isActive, true)
  assert.equal(features[1].name, 'events')
  assert.equal(features[1].isActive, false)
  assert.equal(features[2].name, 'agent')
  assert.equal(features[2].isActive, true)
  assert.equal(features[3].name, 'session')
  assert.equal(features[3].isActive, false)

  assert.equal(state.pluginApi.agent.get('agent-1').id, 'agent-1')
  assert.throws(
    () => state.pluginApi.events.on('goal/changed', () => {}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'events')
      return true
    },
  )
})

test('a third-party plugin can consume pluginApi.agent and pluginApi.events without importing dsh-agent internals', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const consumer = {
    staticInject: ['pluginApi'],
    seen: [],
    onCreated(payload) {
      this.seen.push(payload.agent)
    },
  }

  // Simulate Cordis inject resolution by reading the same facade service.
  const pluginApi = ctx.get('pluginApi')
  assert.equal(pluginApi, state.pluginApi)

  pluginApi.events.on('agent/created', (payload) => consumer.onCreated(payload))
  pluginApi.events.on('agent/status', (payload) => consumer.onCreated(payload))
  assert.equal(pluginApi.agent.list().length, 1)

  // The consumer test never imports @deepseek-ai/dsh-agent; it only touches
  // the facade. Assert the facade registered native hooks for both events.
  assert.ok(state.listeners.some((l) => l.name === 'agent/created'))
  assert.ok(state.listeners.some((l) => l.name === 'agent/status'))
})
