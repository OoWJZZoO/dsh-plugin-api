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
    llm: {
      resolveModelInfo() {},
      prepareCall() {},
      stream() {},
      registerAdapter() {},
      registerConfigurableProviders() {},
      registerModelDiscovery() {},
    },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    sessions: { get() {}, list() {}, fork() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    ...(agents ? { agents } : {}),
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    ...(web ? { web } : {}),
  }
  const state = {
    pluginApi: undefined,
    effects: [],
    listeners: [],
    errors: [],
    warnings: [],
  }
  const ctx = {
    logger: { error(message) { state.errors.push(message) }, warn(message) { state.warnings.push(message) } },
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
    on(name, listener, eventOptions) {
      const entry = { name, listener, eventOptions }
      state.listeners.push(entry)
      return () => {
        const index = state.listeners.indexOf(entry)
        if (index < 0) return false
        state.listeners.splice(index, 1)
        return true
      }
    },
    once() {},
    emit(name, ...args) {
      let result
      for (const entry of state.listeners.filter((candidate) => candidate.name === name)) {
        result = entry.listener.apply(this, args)
      }
      return result
    },
    dispatchPreExecute(exec) {
      const hooks = state.listeners
        .filter((entry) => entry.name === 'tools/pre-execute')
        .sort((left, right) => Number(right.eventOptions?.prepend) - Number(left.eventOptions?.prepend))
      const invoke = (index) => {
        if (index >= hooks.length) return undefined
        return hooks[index].listener.call(this, exec, () => invoke(index + 1))
      }
      return invoke(0)
    },
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
  assert.deepEqual(features.map((f) => f.name), ['tools', 'events', 'agent', 'llm', 'llm/request', 'llm/admission', 'session', 'sessionDurable', 'execRoute', 'settings', 'systemPrompt', 'services'])
  assert.ok(features.every((f) => f.isActive), 'all features active (web seam satisfies the services guard)')
})

test('mounted A11 facade preserves all registry lifecycle result identities alongside routeOf', () => {
  const { ctx, state, agents } = createMockCtx()
  const calls = []
  const values = {
    create: Promise.resolve({ id: 'created' }),
    resume: Promise.resolve({ id: 'resumed' }),
    register: () => 'register-disposer',
    enter: () => 'enter-disposer',
    announce: () => 'announced',
    setFactory: () => 'factory-disposer',
  }
  for (const name of ['create', 'resume', 'register', 'enter', 'announce', 'setFactory']) {
    agents[name] = function (...args) {
      calls.push({ name, receiver: this, args })
      return typeof values[name] === 'function' ? values[name]() : values[name]
    }
  }

  apply(ctx)
  const agent = state.pluginApi.agent
  const factory = {}
  assert.equal(agent.create({ id: 'create' }), values.create)
  assert.equal(agent.resume({ id: 'resume' }), values.resume)
  assert.equal(agent.register({ id: 'register' }), 'register-disposer')
  assert.equal(agent.provider.enter({ id: 'enter' }, ctx), 'enter-disposer')
  assert.equal(agent.provider.announce({ id: 'announce' }), 'announced')
  assert.equal(agent.provider.setFactory(factory), 'factory-disposer')
  assert.equal(typeof agent.routeOf, 'function')
  assert.deepEqual(calls.map(({ name }) => name), ['create', 'resume', 'register', 'enter', 'announce', 'setFactory'])
  assert.ok(calls.every(({ receiver }) => receiver === agents))
  assert.deepEqual(calls[3].args, [{ id: 'enter' }, ctx])
  assert.equal(agent.provider.isActive, true)
  assert.deepEqual(agent.availability, {
    create: true,
    resume: true,
    register: true,
    provider: { enter: true, announce: true, setFactory: true },
  })
})
test('active composed facade degrades only a missing A11 leaf', () => {
  const { ctx, state, agents } = createMockCtx()
  agents.create = () => 'created'
  agents.resume = () => 'resumed'
  agents.register = () => 'registered'
  agents.enter = () => 'entered'
  agents.announce = () => undefined
  apply(ctx)

  const agent = state.pluginApi.agent
  assert.equal(agent.create({}), 'created')
  assert.equal(agent.resume({}), 'resumed')
  assert.equal(agent.provider.enter({}, undefined), 'entered')
  assert.throws(() => agent.provider.setFactory({}), PluginApiFeatureDisabledError)
  assert.deepEqual(agent.availability, {
    create: true,
    resume: true,
    register: true,
    provider: { enter: true, announce: true, setFactory: false },
  })
  assert.equal(agent.get('agent-1').id, 'agent-1')
  assert.equal(typeof agent.routeOf, 'function')
})

test('active composed facade degrades each missing A11 leaf independently', () => {
  const invoke = {
    create: (agent) => agent.create({}),
    resume: (agent) => agent.resume({}),
    register: (agent) => agent.register({}),
    enter: (agent) => agent.provider.enter({}, undefined),
    announce: (agent) => agent.provider.announce({}),
    setFactory: (agent) => agent.provider.setFactory({}),
  }
  for (const missing of ['create', 'resume', 'register', 'enter', 'announce']) {
    const { ctx, state, agents } = createMockCtx()
    for (const name of Object.keys(invoke)) {
      if (name !== missing) agents[name] = () => `ok-${name}`
    }
    apply(ctx)

    const agent = state.pluginApi.agent
    for (const name of Object.keys(invoke)) {
      if (name === missing) {
        assert.throws(
          () => invoke[name](agent),
          (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'agent',
          `missing ${missing} member must throw for ${name}`,
        )
      } else {
        assert.equal(invoke[name](agent), `ok-${name}`)
      }
    }
    assert.deepEqual(agent.availability, {
      create: missing !== 'create',
      resume: missing !== 'resume',
      register: missing !== 'register',
      provider: {
        enter: missing !== 'enter',
        announce: missing !== 'announce',
        setFactory: true,
      },
    })
    assert.equal(agent.provider.isActive, missing !== 'enter' && missing !== 'announce')
    assert.equal(agent.get('agent-1').id, 'agent-1')
    assert.equal(typeof agent.routeOf, 'function')
  }
})

test('active composed facade availability tracks late member degradation', () => {
  const { ctx, state, agents } = createMockCtx()
  for (const name of ['create', 'resume', 'register', 'enter', 'announce']) {
    agents[name] = function () {}
  }
  agents.setFactory = function () {
    return 'set-factory'
  }
  apply(ctx)

  const agent = state.pluginApi.agent
  assert.equal(agent.availability.provider.setFactory, true)
  agents.setFactory = undefined

  assert.throws(
    () => agent.provider.setFactory({}),
    (error) => error instanceof PluginApiFeatureDisabledError && /provider\.setFactory/.test(error.message),
  )
  assert.equal(agent.availability.provider.setFactory, false)
  assert.equal(agent.availability.provider.enter, true)
  assert.equal(agent.provider.isActive, false)
  assert.equal(state.pluginApi.agent.availability.provider.setFactory, false)
})
test('active composed A11 view resolves every official call from the consuming context', () => {
  const { ctx, state, agents: hostAgents } = createMockCtx()
  for (const name of ['create', 'resume', 'register', 'enter', 'announce', 'setFactory']) {
    hostAgents[name] = () => undefined
  }
  const consumerCalls = []
  const consumerAgents = Object.fromEntries(
    ['create', 'resume', 'register', 'enter', 'announce', 'setFactory'].map((name) => [name, function () {
      consumerCalls.push({ name, receiver: this })
      return name
    }]),
  )
  consumerAgents.get = () => ({ id: 'consumer' })
  consumerAgents.list = () => []
  consumerAgents.roots = () => []
  apply(ctx)

  const traced = Object.create(state.pluginApi)
  traced.ctx = { get(name) { return name === 'agents' ? consumerAgents : undefined } }
  const agent = traced.agent
  assert.equal(agent.create({}), 'create')
  assert.equal(agent.resume({}), 'resume')
  assert.equal(agent.register({}), 'register')
  assert.equal(agent.provider.enter({}, undefined), 'enter')
  assert.equal(agent.provider.announce({}), 'announce')
  assert.equal(agent.provider.setFactory({}), 'setFactory')
  assert.ok(consumerCalls.every(({ receiver }) => receiver === consumerAgents))
  assert.equal(hostAgents.create(), undefined)
})
test('exec-route publication failure leaves active A11 members unchanged', () => {
  const { ctx, state, agents } = createMockCtx()
  for (const name of ['create', 'resume', 'register', 'enter', 'announce', 'setFactory']) {
    agents[name] = () => name
  }
  const originalPlugin = ctx.plugin
  ctx.plugin = (Class) => {
    originalPlugin(Class)
    const original = state.pluginApi.mountFeature.bind(state.pluginApi)
    state.pluginApi.mountFeature = (name, api) => {
      if (name === 'execRoute') throw new Error('route publication failed')
      return original(name, api)
    }
  }

  apply(ctx)
  assert.equal(state.pluginApi.agent.create({}), 'create')
  assert.equal(state.pluginApi.agent.provider.setFactory({}), 'setFactory')
  assert.equal(state.pluginApi.agent.availability.create, true)
  assert.equal(state.pluginApi.agent.availability.provider.setFactory, true)
  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'execRoute')?.isActive, false)
})

test('duplicate apply does not register A11 cleanup twice', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const before = state.effects.filter((effect) => effect.label === 'dsh-plugin-api: agent A11 cleanup').length
  apply(ctx)
  assert.equal(state.effects.filter((effect) => effect.label === 'dsh-plugin-api: agent A11 cleanup').length, before)
})
test('A11 candidate publication failure preserves M1 reads and exec-route', () => {
  const { ctx, state } = createMockCtx()
  const originalPlugin = ctx.plugin
  ctx.plugin = (Class) => {
    originalPlugin(Class)
    const original = state.pluginApi.mountFeature.bind(state.pluginApi)
    state.pluginApi.mountFeature = (name, api) => {
      if (name === 'agentExtension') throw new Error('candidate publication failed')
      return original(name, api)
    }
  }

  assert.doesNotThrow(() => apply(ctx))
  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'agent')?.isActive, true)
  assert.equal(state.pluginApi.agent.get('agent-1').id, 'agent-1')
  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'execRoute')?.isActive, true)
  assert.equal(typeof state.pluginApi.agent.routeOf, 'function')
  assert.ok(state.errors.includes('dsh-plugin-api agent A11 extension unavailable (cleanup-registration-or-publication)'))
})
test('A11 cleanup registration failure preserves M1 reads and exec-route', () => {
  const { ctx, state } = createMockCtx()
  const effect = ctx.effect
  ctx.effect = (fn, label) => {
    if (label === 'dsh-plugin-api: agent A11 cleanup') throw new Error('candidate cleanup registration failed')
    return effect(fn, label)
  }

  assert.doesNotThrow(() => apply(ctx))
  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'agent')?.isActive, true)
  assert.equal(state.pluginApi.agent.get('agent-1').id, 'agent-1')
  assert.throws(() => state.pluginApi.agent.create({}), PluginApiFeatureDisabledError)
  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'execRoute')?.isActive, true)
})
test('A11 cleanup is idempotent after successful removal', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const a11Cleanup = state.effects.find((effect) => effect.label === 'dsh-plugin-api: agent A11 cleanup')
  assert.ok(a11Cleanup)
  const dispose = a11Cleanup.fn()
  assert.doesNotThrow(() => dispose())
  assert.doesNotThrow(() => dispose())

  assert.equal(state.pluginApi.agent.get('agent-1').id, 'agent-1')
  assert.throws(() => state.pluginApi.agent.create({}), PluginApiFeatureDisabledError)
  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'execRoute')?.isActive, true)
  assert.equal(typeof state.pluginApi.agent.routeOf, 'function')
  assert.equal(state.errors.filter((message) => message === 'dsh-plugin-api agent A11 extension unavailable (cleanup)').length, 0)
})
test('A11 cleanup failure is contained once and remains silent on retry', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const originalUnmount = state.pluginApi.unmountFeature.bind(state.pluginApi)
  state.pluginApi.unmountFeature = (name, token) => {
    if (name === 'agentExtension') throw new Error('cleanup failed with secret')
    return originalUnmount(name, token)
  }
  state.pluginApi._removeAgentExtension = () => {
    throw new Error('token cleanup failed with secret')
  }
  state.pluginApi._removeAgentExtensionByCompose = () => {
    throw new Error('compose cleanup failed with secret')
  }
  const a11Cleanup = state.effects.find((effect) => effect.label === 'dsh-plugin-api: agent A11 cleanup')
  assert.ok(a11Cleanup)
  const dispose = a11Cleanup.fn()
  assert.doesNotThrow(() => dispose())
  assert.doesNotThrow(() => dispose())
  assert.equal(
    state.errors.filter((message) => message === 'dsh-plugin-api agent A11 extension unavailable (cleanup)').length,
    1,
  )
  assert.ok(state.errors.every((message) => !message.includes('secret')))
  assert.equal(state.pluginApi.agent.get('agent-1').id, 'agent-1')
  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'execRoute')?.isActive, true)
})
test('A11 cleanup restores the M1 base without removing exec-route', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const a11Cleanup = state.effects.find((effect) => effect.label === 'dsh-plugin-api: agent A11 cleanup')
  assert.ok(a11Cleanup)
  const dispose = a11Cleanup.fn()
  dispose()

  assert.equal(state.pluginApi.agent.get('agent-1').id, 'agent-1')
  assert.throws(() => state.pluginApi.agent.create({}), PluginApiFeatureDisabledError)
  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'execRoute')?.isActive, true)
  assert.equal(typeof state.pluginApi.agent.routeOf, 'function')
})
test('A11 cleanup failure is idempotent and emits one fixed diagnostic', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const originalUnmount = state.pluginApi.unmountFeature.bind(state.pluginApi)
  state.pluginApi.unmountFeature = (name, token) => {
    if (name === 'agentExtension') throw new Error('cleanup failed with secret')
    return originalUnmount(name, token)
  }
  state.pluginApi._removeAgentExtension = () => {
    throw new Error('token cleanup failed with secret')
  }
  state.pluginApi._removeAgentExtensionByCompose = () => {
    throw new Error('compose cleanup failed with secret')
  }
  const a11Cleanup = state.effects.find((effect) => effect.label === 'dsh-plugin-api: agent A11 cleanup')
  assert.ok(a11Cleanup)
  const dispose = a11Cleanup.fn()
  assert.doesNotThrow(() => dispose())
  assert.doesNotThrow(() => dispose())
  assert.equal(
    state.errors.filter((message) => message === 'dsh-plugin-api agent A11 extension unavailable (cleanup)').length,
    1,
  )
  assert.ok(state.errors.every((message) => !message.includes('secret')))
  assert.equal(state.pluginApi.agent.get('agent-1').id, 'agent-1')
  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'execRoute')?.isActive, true)
})

test('stale A11 cleanup cannot remove a later extension instance', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const firstCleanup = state.effects.find((effect) => effect.label === 'dsh-plugin-api: agent A11 cleanup')
  assert.ok(firstCleanup)

  const first = state.pluginApi.agent
  const firstToken = state.pluginApi.mountFeature('agentExtension', {
    name: 'first',
    compose(_consumerCtx, base) {
      return { ...base, marker: 'first' }
    },
  })
  const secondToken = state.pluginApi.mountFeature('agentExtension', {
    name: 'second',
    compose(_consumerCtx, base) {
      return { ...base, marker: 'second' }
    },
  })
  assert.equal(state.pluginApi.agent.marker, 'second')
  const staleDispose = firstCleanup.fn()
  assert.doesNotThrow(() => staleDispose())
  assert.equal(state.pluginApi.agent.marker, 'second')
  assert.equal(state.pluginApi.unmountFeature('agentExtension', firstToken), true)
  assert.equal(state.pluginApi.agent.marker, 'second')
  assert.equal(state.pluginApi.unmountFeature('agentExtension', secondToken), true)
  assert.equal(state.pluginApi.agent.marker, undefined)
  assert.equal(first.marker, undefined)
})

test('exec-route cleanup failure leaves active A11 members intact', () => {
  const { ctx, state, agents } = createMockCtx()
  for (const name of ['create', 'resume', 'register', 'enter', 'announce', 'setFactory']) {
    agents[name] = () => name
  }
  apply(ctx)
  const routeCleanup = state.effects.find((effect) => effect.label === 'dsh-plugin-api: execRoute cleanup')
  assert.ok(routeCleanup)
  const originalUnmount = state.pluginApi.unmountFeature.bind(state.pluginApi)
  state.pluginApi.unmountFeature = (name, token) => {
    if (name === 'execRoute') throw new Error('route cleanup failed')
    return originalUnmount(name, token)
  }
  const dispose = routeCleanup.fn()
  assert.equal(typeof dispose, 'function')
  assert.doesNotThrow(() => dispose())
  assert.equal(state.pluginApi.agent.create({}), 'create')
  assert.equal(state.pluginApi.agent.provider.setFactory({}), 'setFactory')
  assert.equal(state.pluginApi.agent.availability.provider.setFactory, true)
})

test('successful exec-route disposal leaves active A11 members intact', () => {
  const { ctx, state, agents } = createMockCtx()
  for (const name of ['create', 'resume', 'register', 'enter', 'announce', 'setFactory']) {
    agents[name] = () => name
  }
  apply(ctx)
  const routeCleanup = state.effects.find((effect) => effect.label === 'dsh-plugin-api: execRoute cleanup')
  assert.ok(routeCleanup)
  const dispose = routeCleanup.fn()
  assert.equal(typeof dispose, 'function')
  dispose()
  assert.equal(state.pluginApi.agent.create({}), 'create')
  assert.equal(state.pluginApi.agent.provider.setFactory({}), 'setFactory')
  assert.equal(state.pluginApi.agent.availability.create, true)
  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'execRoute')?.isActive, true)
})
test('A11 and exec-route cleanup preserve the other extension and captured route state', () => {
  const makeExec = (provider, model) => ({
    agent: { session: { requestContext: () => ({ provider, model }) } },
  })

  {
    const { ctx, state, agents } = createMockCtx()
    agents.create = () => 'created'
    apply(ctx)
    const exec = makeExec('provider-a', 'model-a')
    ctx.dispatchPreExecute(exec)
    const route = state.pluginApi.agent.routeOf(exec)
    assert.deepEqual(route, { provider: 'provider-a', model: 'model-a' })
    const a11Cleanup = state.effects.find((effect) => effect.label === 'dsh-plugin-api: agent A11 cleanup')
    assert.ok(a11Cleanup)
    a11Cleanup.fn()()
    assert.deepEqual(state.pluginApi.agent.routeOf(exec), route)
    assert.throws(() => state.pluginApi.agent.create({}), PluginApiFeatureDisabledError)
  }

  {
    const { ctx, state, agents } = createMockCtx()
    agents.create = () => 'created'
    apply(ctx)
    const exec = makeExec('provider-b', 'model-b')
    ctx.dispatchPreExecute(exec)
    const route = state.pluginApi.agent.routeOf(exec)
    const routeCleanup = state.effects.find((effect) => effect.label === 'dsh-plugin-api: execRoute cleanup')
    assert.ok(routeCleanup)
    routeCleanup.fn()()
    assert.throws(
      () => state.pluginApi.agent.routeOf(exec),
      (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'execRoute',
    )
    assert.equal(state.pluginApi.agent.create({}), 'created')
    assert.deepEqual(route, { provider: 'provider-b', model: 'model-b' })
  }

  {
    const { ctx, state, agents } = createMockCtx()
    agents.create = () => 'created'
    apply(ctx)
    const exec = makeExec('provider-c', 'model-c')
    ctx.dispatchPreExecute(exec)
    const route = state.pluginApi.agent.routeOf(exec)
    const originalUnmount = state.pluginApi.unmountFeature.bind(state.pluginApi)
    state.pluginApi.unmountFeature = (name, token) => {
      if (name === 'execRoute') throw new Error('route cleanup failed')
      return originalUnmount(name, token)
    }
    const routeCleanup = state.effects.find((effect) => effect.label === 'dsh-plugin-api: execRoute cleanup')
    assert.ok(routeCleanup)
    assert.doesNotThrow(() => routeCleanup.fn()())
    assert.deepEqual(state.pluginApi.agent.routeOf(exec), route)
    assert.equal(state.pluginApi.agent.create({}), 'created')
    assert.equal(state.pluginApi.features.find((feature) => feature.name === 'agent')?.isActive, true)
  }
})

test('A11 partial publication failure rolls back a candidate published before throw', () => {
  const { ctx, state } = createMockCtx()
  const originalPlugin = ctx.plugin
  ctx.plugin = (Class) => {
    originalPlugin(Class)
    const original = state.pluginApi.mountFeature.bind(state.pluginApi)
    state.pluginApi.mountFeature = (name, api) => {
      const result = original(name, api)
      if (name === 'agentExtension') throw new Error('published then failed')
      return result
    }
  }

  assert.doesNotThrow(() => apply(ctx))
  assert.equal(state.pluginApi.agent.get('agent-1').id, 'agent-1')
  assert.throws(() => state.pluginApi.agent.create({}), PluginApiFeatureDisabledError)
  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'execRoute')?.isActive, true)
  assert.ok(state.errors.includes('dsh-plugin-api agent A11 extension unavailable (cleanup-registration-or-publication)'))
})

test('A11 double removal failure quarantines only the candidate extension', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const originalUnmount = state.pluginApi.unmountFeature.bind(state.pluginApi)
  const originalRemove = state.pluginApi._removeAgentExtension.bind(state.pluginApi)
  const originalRemoveByCompose = state.pluginApi._removeAgentExtensionByCompose.bind(state.pluginApi)
  state.pluginApi.unmountFeature = (name, token) => {
    if (name === 'agentExtension') throw new Error('unmount failed')
    return originalUnmount(name, token)
  }
  state.pluginApi._removeAgentExtension = (token) => {
    throw new Error('token removal failed')
  }
  state.pluginApi._removeAgentExtensionByCompose = (compose) => {
    throw new Error('compose removal failed')
  }
  const cleanup = state.effects.find((effect) => effect.label === 'dsh-plugin-api: agent A11 cleanup')
  assert.ok(cleanup)
  const dispose = cleanup.fn()
  assert.doesNotThrow(() => dispose())
  assert.equal(state.pluginApi.agent.get('agent-1').id, 'agent-1')
  assert.throws(() => state.pluginApi.agent.create({}), PluginApiFeatureDisabledError)
  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'execRoute')?.isActive, true)
  assert.equal(state.errors.filter((message) => message === 'dsh-plugin-api agent A11 extension unavailable (cleanup)').length, 1)
  state.pluginApi.unmountFeature = originalUnmount
  state.pluginApi._removeAgentExtension = originalRemove
  state.pluginApi._removeAgentExtensionByCompose = originalRemoveByCompose
})
test('integrated A11 lifecycle double preserves official identity, ownership, and ordering', async () => {
  const { ctx, state } = createMockCtx()
  const directFiber = { id: 'direct-fiber', agent: { id: 'direct-owner' } }
  const facadeFiber = { id: 'facade-fiber', agent: { id: 'facade-owner' } }
  const observed = []
  const carriers = []

  for (const name of ['session/created', 'agent/created', 'agent/session-start', 'agent/disposed']) {
    state.pluginApi?.events?.on?.(name, () => {})
  }

  function dispatch(registry, name, payload) {
    const carrier = { registry: registry.label, scope: registry.label }
    registry.events.push(name)
    carriers.push(carrier)
    return ctx.emit.call(carrier, name, payload)
  }

  function createRegistry(label, ownerCtx) {
    const entries = new Map()
    let factorySlot = false
    const registry = {
      label,
      ownerCtx,
      events: [],
      calls: [],
      enterDisposers: [],
      errors: {
        duplicate: new Error(`${label}: duplicate id`),
        invalidAnnounce: new Error(`${label}: invalid announce`),
      },
      get() { return undefined },
      list() { return [] },
      roots() { return [] },
      create(options) {
        this.calls.push({ name: 'create', args: [options], receiver: this, owner: this.ownerCtx })
        const agent = options.agent
        const handle = {
          agent,
          dispose: () => {
            if (handle.disposed) return undefined
            handle.disposed = true
            dispatch(this, 'agent/disposed', { agent })
            return undefined
          },
        }
        dispatch(this, 'session/created', { agent })
        try {
          dispatch(this, 'agent/created', { agent })
          dispatch(this, 'agent/session-start', { agent })
          if (options.failAfterPublication) throw options.failAfterPublication
        } catch (error) {
          handle.dispose()
          this.createPromise = Promise.reject(error)
          return this.createPromise
        }
        this.createPromise = Promise.resolve(handle)
        this.createHandle = handle
        return this.createPromise
      },
      resume(options) {
        this.calls.push({ name: 'resume', args: [options], receiver: this, owner: this.ownerCtx })
        const agent = options.agent
        dispatch(this, 'session/created', { agent })
        try {
          dispatch(this, 'agent/created', { agent })
          if (options.error) throw options.error
          dispatch(this, 'agent/session-start', { agent })
        } catch (error) {
          dispatch(this, 'agent/disposed', { agent })
          this.resumePromise = Promise.reject(error)
          return this.resumePromise
        }
        this.resumePromise = Promise.resolve({ agent, dispose() {} })
        return this.resumePromise
      },
      register(agent) {
        this.calls.push({ name: 'register', args: [agent], receiver: this, owner: this.ownerCtx })
        const entry = enterImpl(this, agent, this.ownerCtx.agent)
        try {
          announceImpl(this, agent)
        } catch (error) {
          entry.dispose()
          throw error
        }
        this.registerDisposer = entry.dispose
        return this.registerDisposer
      },
      enter(agent, owner) {
        this.calls.push({ name: 'enter', args: [agent, owner], receiver: this, owner: this.ownerCtx })
        const entry = enterImpl(this, agent, owner)
        this.enterDisposers.push(entry.dispose)
        return entry.dispose
      },
      announce(agent) {
        this.calls.push({ name: 'announce', args: [agent], receiver: this, owner: this.ownerCtx })
        return announceImpl(this, agent)
      },
      setFactory(factory) {
        this.calls.push({ name: 'setFactory', args: [factory], receiver: this, owner: this.ownerCtx })
        if (factorySlot) throw new Error(`${label}: factory occupied`)
        factorySlot = true
        let disposed = false
        this.factoryDisposer = () => {
          if (disposed) return undefined
          disposed = true
          factorySlot = false
          this.events.push('factory-disposed')
          return undefined
        }
        return this.factoryDisposer
      },
      isFactoryOccupied() { return factorySlot },
    }

    function enterImpl(target, agent, owner) {
      if (entries.has(agent.id)) throw target.errors.duplicate
      const record = { agent, owner, announced: false }
      entries.set(agent.id, record)
      let disposed = false
      record.dispose = () => {
        if (disposed) return undefined
        disposed = true
        if (entries.get(agent.id) !== record) return undefined
        entries.delete(agent.id)
        dispatch(target, 'agent/disposed', { agent })
        return undefined
      }
      target.events.push(`enter:${owner?.id ?? 'root'}`)
      return record
    }

    function announceImpl(target, agent) {
      const record = entries.get(agent.id)
      if (!record || record.agent !== agent || record.announced) {
        throw target.errors.invalidAnnounce
      }
      try {
        dispatch(target, 'agent/created', { agent })
      } catch (error) {
        record.dispose()
        throw error
      }
      record.announced = true
      return undefined
    }

    return registry
  }

  const direct = createRegistry('direct', directFiber)
  const consumer = createRegistry('facade', facadeFiber)
  const host = createRegistry('host', { id: 'host-fiber', agent: { id: 'host-owner' } })
  Object.assign(ctx.get('agents'), host)
  apply(ctx)

  const eventNames = ['session/created', 'agent/created', 'agent/session-start', 'agent/disposed']
  for (const name of eventNames) {
    state.pluginApi.events.on(name, function (payload) {
      const agent = payload?.agent
      observed.push({ name, label: agent?.label, listener: 'first', carrier: this })
      if (name === 'agent/created' && agent?.veto) throw agent.veto
    })
    state.pluginApi.events.on(name, function (payload) {
      observed.push({ name, label: payload?.agent?.label, listener: 'second', carrier: this })
    })
  }

  const traced = Object.create(state.pluginApi)
  traced.ctx = { get(name) { return name === 'agents' ? consumer : undefined } }
  const facade = traced.agent
  assert.equal(facade.routeOf instanceof Function, true)

  const directFactory = { label: 'direct-factory' }
  const facadeFactory = { label: 'facade-factory' }
  const scopedObserved = []
  const directOptions = { agent: { label: 'direct-created' } }
  const facadeOptions = { agent: { label: 'facade-created' } }
  state.pluginApi.events.on('agent/created', function (payload) {
    scopedObserved.push(['direct', payload.agent.label, this])
  }, { scope: directOptions.agent })
  state.pluginApi.events.on('agent/created', function (payload) {
    scopedObserved.push(['facade', payload.agent.label, this])
  }, { scope: facadeOptions.agent })
  state.pluginApi.events.on('agent/session-start', () => Promise.reject(new Error('async lifecycle rejection')))

  const directFactoryDisposer = direct.setFactory(directFactory)
  const facadeFactoryDisposer = facade.provider.setFactory(facadeFactory)
  assert.equal(directFactoryDisposer, direct.factoryDisposer)
  assert.equal(facadeFactoryDisposer, consumer.factoryDisposer)
  assert.equal(direct.isFactoryOccupied(), true)
  assert.equal(consumer.isFactoryOccupied(), true)
  assert.throws(() => direct.setFactory({ label: 'duplicate' }), /direct: factory occupied/)
  assert.throws(() => facade.provider.setFactory({ label: 'duplicate' }), /facade: factory occupied/)
  directFactoryDisposer()
  facadeFactoryDisposer()
  assert.equal(direct.isFactoryOccupied(), false)
  assert.equal(consumer.isFactoryOccupied(), false)
  assert.equal(facade.availability.provider.setFactory, true)

  const directPromise = direct.create(directOptions)
  const facadePromise = facade.create(facadeOptions)
  assert.equal(directPromise, direct.createPromise)
  assert.equal(facadePromise, consumer.createPromise)
  const directHandle = await directPromise
  const facadeHandle = await facadePromise
  assert.equal(directHandle, direct.createHandle)
  assert.equal(facadeHandle, consumer.createHandle)
  const directDispose = directHandle.dispose
  const facadeDispose = facadeHandle.dispose
  assert.equal(directDispose, directHandle.dispose)
  assert.equal(facadeDispose, facadeHandle.dispose)
  directDispose()
  facadeDispose()
  directDispose()
  facadeDispose()

  const directResumeError = new Error('direct resume failure')
  const facadeResumeError = new Error('facade resume failure')
  const directResumeOptions = { error: directResumeError, agent: { label: 'direct-resume' } }
  const facadeResumeOptions = { error: facadeResumeError, agent: { label: 'facade-resume' } }
  const directResumePromise = direct.resume(directResumeOptions)
  const facadeResumePromise = facade.resume(facadeResumeOptions)
  assert.equal(directResumePromise, direct.resumePromise)
  assert.equal(facadeResumePromise, consumer.resumePromise)
  await assert.rejects(directResumePromise, (error) => error === directResumeError)
  await assert.rejects(facadeResumePromise, (error) => error === facadeResumeError)

  const directRollbackError = new Error('direct post-publication failure')
  const facadeRollbackError = new Error('facade post-publication failure')
  const directRollbackOptions = { agent: { label: 'direct-rollback' }, failAfterPublication: directRollbackError }
  const facadeRollbackOptions = { agent: { label: 'facade-rollback' }, failAfterPublication: facadeRollbackError }
  const directRollbackPromise = direct.create(directRollbackOptions)
  const facadeRollbackPromise = facade.create(facadeRollbackOptions)
  assert.equal(directRollbackPromise, direct.createPromise)
  assert.equal(facadeRollbackPromise, consumer.createPromise)
  await assert.rejects(directRollbackPromise, (error) => error === directRollbackError)
  await assert.rejects(facadeRollbackPromise, (error) => error === facadeRollbackError)

  const directRegistered = { id: 'direct-registered', label: 'direct-registered' }
  const facadeRegistered = { id: 'facade-registered', label: 'facade-registered' }
  const directRegisterDisposer = direct.register(directRegistered)
  const facadeRegisterDisposer = facade.register(facadeRegistered)
  assert.equal(directRegisterDisposer, direct.registerDisposer)
  assert.equal(facadeRegisterDisposer, consumer.registerDisposer)
  directRegisterDisposer()
  facadeRegisterDisposer()
  directRegisterDisposer()
  facadeRegisterDisposer()

  const directEntered = { id: 'direct-entered', label: 'direct-entered' }
  const facadeEntered = { id: 'facade-entered', label: 'facade-entered' }
  const directEnterDisposer = direct.enter(directEntered, undefined)
  const facadeEnterDisposer = facade.provider.enter(facadeEntered, facadeFiber.agent)
  assert.equal(directEnterDisposer, direct.enterDisposers.at(-1))
  assert.equal(facadeEnterDisposer, consumer.enterDisposers.at(-1))
  assert.equal(typeof directEnterDisposer, 'function')
  assert.equal(typeof facadeEnterDisposer, 'function')
  assert.equal(direct.announce(directEntered), undefined)
  assert.equal(facade.provider.announce(facadeEntered), undefined)
  assert.throws(() => direct.announce({ id: 'missing-direct' }), (error) => error === direct.errors.invalidAnnounce)
  assert.throws(() => facade.provider.announce({ id: 'missing-facade' }), (error) => error === consumer.errors.invalidAnnounce)
  const directDuplicate = { id: 'direct-entered', label: 'direct-duplicate' }
  const facadeDuplicate = { id: 'facade-entered', label: 'facade-duplicate' }
  assert.throws(() => direct.enter(directDuplicate, undefined), (error) => error === direct.errors.duplicate)
  assert.throws(() => facade.provider.enter(facadeDuplicate, facadeFiber.agent), (error) => error === consumer.errors.duplicate)
  directEnterDisposer()
  facadeEnterDisposer()

  const directVeto = new Error('direct veto')
  const facadeVeto = new Error('facade veto')
  const directVetoAgent = { id: 'direct-veto', label: 'direct-veto', veto: directVeto }
  const facadeVetoAgent = { id: 'facade-veto', label: 'facade-veto', veto: facadeVeto }
  direct.enter(directVetoAgent, undefined)
  facade.provider.enter(facadeVetoAgent, facadeFiber.agent)
  assert.throws(() => direct.announce(directVetoAgent), (error) => error === directVeto)
  assert.throws(() => facade.provider.announce(facadeVetoAgent), (error) => error === facadeVeto)

  assert.deepEqual(
    direct.calls.map(({ name }) => name),
    ['setFactory', 'setFactory', 'create', 'resume', 'create', 'register', 'enter', 'announce', 'announce', 'enter', 'enter', 'announce'],
  )
  assert.deepEqual(
    consumer.calls.map(({ name }) => name),
    ['setFactory', 'setFactory', 'create', 'resume', 'create', 'register', 'enter', 'announce', 'announce', 'enter', 'enter', 'announce'],
  )
  assert.ok(direct.calls.every(({ receiver }) => receiver === direct))
  assert.ok(consumer.calls.every(({ receiver }) => receiver === consumer))
  assert.equal(direct.calls.find(({ name }) => name === 'create').owner, directFiber)
  assert.equal(consumer.calls.find(({ name }) => name === 'create').owner, facadeFiber)
  assert.equal(direct.calls.find(({ name }) => name === 'resume').owner, directFiber)
  assert.equal(consumer.calls.find(({ name }) => name === 'resume').owner, facadeFiber)
  assert.equal(direct.calls.find(({ name }) => name === 'register').owner, directFiber)
  assert.equal(consumer.calls.find(({ name }) => name === 'register').owner, facadeFiber)
  assert.equal(direct.calls.find(({ name }) => name === 'setFactory').owner, directFiber)
  assert.equal(consumer.calls.find(({ name }) => name === 'setFactory').owner, facadeFiber)
  assert.equal(direct.calls.find(({ name }) => name === 'create').args[0], directOptions)
  assert.equal(consumer.calls.find(({ name }) => name === 'create').args[0], facadeOptions)
  assert.equal(direct.calls.find(({ name }) => name === 'enter').args[1], undefined)
  assert.equal(consumer.calls.find(({ name }) => name === 'enter').args[1], facadeFiber.agent)

  assert.deepEqual(direct.events, [
    'factory-disposed', 'session/created', 'agent/created', 'agent/session-start', 'agent/disposed',
    'session/created', 'agent/created', 'agent/disposed',
    'session/created', 'agent/created', 'agent/session-start', 'agent/disposed',
    'enter:direct-owner', 'agent/created', 'agent/disposed',
    'enter:root', 'agent/created', 'agent/disposed',
    'enter:root', 'agent/created', 'agent/disposed',
  ])
  assert.deepEqual(consumer.events, [
    'factory-disposed', 'session/created', 'agent/created', 'agent/session-start', 'agent/disposed',
    'session/created', 'agent/created', 'agent/disposed',
    'session/created', 'agent/created', 'agent/session-start', 'agent/disposed',
    'enter:facade-owner', 'agent/created', 'agent/disposed',
    'enter:facade-owner', 'agent/created', 'agent/disposed',
    'enter:facade-owner', 'agent/created', 'agent/disposed',
  ])
  const expectedObserved = [
    ['session/created', 'direct-created'], ['agent/created', 'direct-created'], ['agent/session-start', 'direct-created'],
    ['session/created', 'facade-created'], ['agent/created', 'facade-created'], ['agent/session-start', 'facade-created'],
    ['agent/disposed', 'direct-created'], ['agent/disposed', 'facade-created'],
    ['session/created', 'direct-resume'], ['agent/created', 'direct-resume'], ['agent/disposed', 'direct-resume'],
    ['session/created', 'facade-resume'], ['agent/created', 'facade-resume'], ['agent/disposed', 'facade-resume'],
    ['session/created', 'direct-rollback'], ['agent/created', 'direct-rollback'], ['agent/session-start', 'direct-rollback'], ['agent/disposed', 'direct-rollback'],
    ['session/created', 'facade-rollback'], ['agent/created', 'facade-rollback'], ['agent/session-start', 'facade-rollback'], ['agent/disposed', 'facade-rollback'],
    ['agent/created', 'direct-registered'], ['agent/created', 'facade-registered'],
    ['agent/disposed', 'direct-registered'], ['agent/disposed', 'facade-registered'],
    ['agent/created', 'direct-entered'], ['agent/created', 'facade-entered'],
    ['agent/disposed', 'direct-entered'], ['agent/disposed', 'facade-entered'],
    ['agent/created', 'direct-veto'], ['agent/disposed', 'direct-veto'],
    ['agent/created', 'facade-veto'], ['agent/disposed', 'facade-veto'],
  ]
  const observedSequence = expectedObserved.flatMap(([name, label]) => {
    const listeners = name === 'agent/created' && label.endsWith('veto') ? ['first'] : ['first', 'second']
    return listeners.map((listener) => [name, label, listener])
  })
  assert.deepEqual(
    observed.map(({ name, label, listener }) => [name, label, listener]),
    observedSequence,
  )
  assert.ok(observed.every(({ carrier }) => carriers.includes(carrier)))
  assert.ok(carriers.every((carrier) => carrier.scope === carrier.registry))
  assert.deepEqual(
    scopedObserved.map(([kind, label]) => [kind, label]),
    [['direct', 'direct-created'], ['facade', 'facade-created']],
  )
  assert.ok(state.warnings.some((message) => message.includes('facade listener failure contained')))
  assert.equal(facade.availability.provider.setFactory, true)
})
test('agent guard failure disables only agent and keeps facade active', () => {
  const { ctx, state } = createMockCtx({ agents: false })
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)
  const features = state.pluginApi.features
  assert.equal(features.length, 12)
  assert.deepEqual(features[0], { name: 'tools', isActive: true })
  assert.deepEqual(features[1], { name: 'events', isActive: true })
  assert.equal(features[2].name, 'agent')
  assert.equal(features[2].isActive, false)
  assert.match(features[2].reason, /agents\.get/)
  assert.deepEqual(features[3], { name: 'llm', isActive: true })
  assert.deepEqual(features[4], { name: 'llm/request', isActive: true })
  assert.equal(features[5].name, 'llm/admission')
  assert.equal(features[5].isActive, false)
  assert.match(features[5].reason, /agents\.get/)
  assert.deepEqual(features[6], { name: 'session', isActive: true })
  assert.deepEqual(features[7], { name: 'sessionDurable', isActive: true })
  assert.deepEqual(features[8], { name: 'execRoute', isActive: true })
  assert.deepEqual(features[9], { name: 'settings', isActive: true })
  assert.deepEqual(features[10], { name: 'systemPrompt', isActive: true })
  assert.deepEqual(features[11], { name: 'services', isActive: true })

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
  assert.equal(typeof state.pluginApi.services.web.registerSearchProvider, 'function')
  const exec = { agent: { session: { requestContext: () => ({ provider: 'provider-a', model: 'model-a' }) } } }
  ctx.dispatchPreExecute(exec)
  const route = state.pluginApi.tools.routeOf(exec)
  assert.deepEqual(route, { provider: 'provider-a', model: 'model-a' })
  assert.equal(state.pluginApi.agent.routeOf(exec), route)
})

test('events guard failure does not block the agent registry read API', () => {
  const { ctx, state } = createMockCtx({ events: false })
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)
  const features = state.pluginApi.features
  assert.equal(features.length, 12)
  assert.equal(features[0].name, 'tools')
  assert.equal(features[0].isActive, true)
  assert.equal(features[1].name, 'events')
  assert.equal(features[1].isActive, false)
  assert.equal(features[2].name, 'agent')
  assert.equal(features[2].isActive, true)
  assert.equal(features[3].name, 'llm')
  assert.equal(features[3].isActive, true)
  assert.equal(features[4].name, 'llm/request')
  assert.equal(features[4].isActive, true)
  assert.equal(features[5].name, 'llm/admission')
  assert.equal(features[5].isActive, true)
  assert.equal(features[6].name, 'session')
  assert.equal(features[6].isActive, false)
  assert.equal(features[7].name, 'sessionDurable')
  assert.equal(features[7].isActive, false)
  assert.equal(features[8].name, 'execRoute')
  assert.equal(features[8].isActive, false)
  assert.equal(features[9].name, 'settings')
  assert.equal(features[9].isActive, true)
  assert.equal(features[10].name, 'systemPrompt')
  assert.equal(features[10].isActive, true)
  assert.equal(features[11].name, 'services')
  assert.equal(features[11].isActive, true)

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

test('duplicate apply does not reprobe or republish A11', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const firstAgentEffects = state.effects.filter((effect) => effect.label === 'dsh-plugin-api: agent cleanup').length
  const firstA11Effects = state.effects.filter((effect) => effect.label === 'dsh-plugin-api: agent A11 cleanup').length
  let a11Mounts = 0
  const mount = state.pluginApi.mountFeature.bind(state.pluginApi)
  state.pluginApi.mountFeature = (name, api) => {
    if (name === 'agentExtension') a11Mounts += 1
    return mount(name, api)
  }
  apply(ctx)
  assert.equal(state.effects.filter((effect) => effect.label === 'dsh-plugin-api: agent cleanup').length, firstAgentEffects)
  assert.equal(state.effects.filter((effect) => effect.label === 'dsh-plugin-api: agent A11 cleanup').length, firstA11Effects)
  assert.equal(a11Mounts, 0)
  assert.equal(state.pluginApi.agent.get('agent-1').id, 'agent-1')
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
