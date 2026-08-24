import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, mountExecRouteFeature } from '../lib/index.js'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

function createCtx(options = {}) {
  const services = {
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
    ...(options.services ?? {}),
  }
  const state = { pluginApi: undefined, listeners: [], effects: [], errors: [] }
  const ctx = {
    logger: { error(message) { state.errors.push(message) }, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect(fn, label) {
      if (options.effectThrows) throw new Error('effect registration failed')
      state.effects.push({ fn, label })
    },
    on(name, listener, eventOptions) {
      if ((options.onThrows && name === 'tools/pre-execute') || options.onThrowsName === name) throw new Error('hook failed')
      const entry = { name, listener, eventOptions }
      state.listeners.push(entry)
      return () => {
        const index = state.listeners.indexOf(entry)
        if (index >= 0) state.listeners.splice(index, 1)
      }
    },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  return { ctx, state, services }
}

function listenersOf(state, name) {
  return state.listeners
    .filter((entry) => entry.name === name)
    .sort((left, right) => Number(right.eventOptions?.prepend) - Number(left.eventOptions?.prepend))
}

function dispatchWaterfall(state, name, args, final = () => undefined) {
  const hooks = listenersOf(state, name)
  function invoke(index) {
    if (index === hooks.length) return final()
    return hooks[index].listener(...args, () => invoke(index + 1))
  }
  return invoke(0)
}

function dispatchPreExecute(state, exec, final = () => undefined) {
  return dispatchWaterfall(state, 'tools/pre-execute', [exec], final)
}

function dispatchEmit(state, name, args) {
  return listenersOf(state, name).map((entry) => entry.listener(...args))
}

function execWithRoute(provider = 'provider-a', model = 'model-a') {
  return { agent: { session: { requestContext: () => ({ provider, model }) } } }
}

test('healthy apply activates execRoute after dependencies and installs one prepended capture hook', () => {
  const { ctx, state } = createCtx()
  apply(ctx)

  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'execRoute')?.isActive, true)
  const hooks = state.listeners.filter((entry) => entry.name === 'tools/pre-execute')
  assert.equal(hooks.length, 1)
  assert.equal(hooks[0].eventOptions.prepend, true)
  assert.equal(typeof state.pluginApi.agent.routeOf, 'function')
  assert.equal(typeof state.pluginApi.tools.routeOf, 'function')
})

test('sessionRoute registration failure disables only sessionRoute while execRoute remains active', () => {
  const { ctx, state } = createCtx({ onThrowsName: 'session/disposed' })
  apply(ctx)
  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'execRoute')?.isActive, true)
  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'sessionRoute')?.isActive, false)
  assert.equal(state.listeners.filter((entry) => entry.name === 'tools/pre-execute').length, 1)
  assert.throws(() => state.pluginApi.routing.current({}), (error) => {
    return error instanceof PluginApiFeatureDisabledError && error.feature === 'sessionRoute'
  })
  const exec = execWithRoute()
  dispatchPreExecute(state, exec)
  assert.deepEqual(state.pluginApi.routing.ofExecution(exec), { provider: 'provider-a', model: 'model-a' })
})

test('repeated apply retains the active execRoute hook and captured authority outcome', () => {
  const { ctx, state } = createCtx()
  apply(ctx)
  const exec = execWithRoute()
  dispatchPreExecute(state, exec)
  const captured = state.pluginApi.agent.routeOf(exec)
  const before = state.listeners.filter((entry) => entry.name === 'tools/pre-execute')
  const effectsBefore = state.effects.filter((effect) => effect.label === 'dsh-plugin-api: execRoute cleanup').length

  apply(ctx)

  assert.equal(state.listeners.filter((entry) => entry.name === 'tools/pre-execute').length, 1)
  assert.equal(state.effects.filter((effect) => effect.label === 'dsh-plugin-api: execRoute cleanup').length, effectsBefore)
  assert.ok(Object.isFrozen(state.pluginApi.agent))
  assert.equal(state.pluginApi.agent.routeOf(exec), captured)
  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'execRoute')?.isActive, true)
  assert.equal(before.length, 1)
})

test('repeated apply preserves active execRoute when cleanup registration later disappears', () => {
  const { ctx, state } = createCtx()
  apply(ctx)
  const exec = execWithRoute()
  dispatchPreExecute(state, exec)
  const captured = state.pluginApi.agent.routeOf(exec)
  ctx.effect = undefined

  assert.doesNotThrow(() => apply(ctx))
  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'execRoute')?.isActive, true)
  assert.equal(state.pluginApi.agent.routeOf(exec), captured)
  assert.equal(state.listeners.filter((entry) => entry.name === 'tools/pre-execute').length, 1)
})

test('owner resolution failures report a redacted diagnostic through host logger', () => {
  const { ctx, state } = createCtx()
  apply(ctx)
  const exec = { agent: { session: { requestContext() { throw new Error('credential value') } } } }

  dispatchPreExecute(state, exec)

  assert.ok(state.errors.some((message) => message === 'dsh-plugin-api exec-route tools/pre-execute resolution-failure'))
  assert.ok(state.errors.every((message) => !message.includes('credential value')))
})

test('missing declared dependency disables only execRoute with its feature-disabled delegate', () => {
  const { ctx, state } = createCtx({ services: { sessions: undefined } })
  apply(ctx)

  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'execRoute')?.isActive, false)
  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'tools')?.isActive, true)
  assert.equal(state.pluginApi.features.find((feature) => feature.name === 'agent')?.isActive, true)
  assert.throws(
    () => state.pluginApi.agent.routeOf(new Proxy({}, { get() { throw new Error('inspected') } })),
    (error) => error instanceof PluginApiFeatureDisabledError && error.feature === 'execRoute',
  )
})

test('hook registration and cleanup registration failures roll back to feature-disabled without a hook', () => {
  for (const options of [{ onThrows: true }, { effectThrows: true }]) {
    const { ctx, state } = createCtx(options)
    assert.doesNotThrow(() => apply(ctx))
    assert.equal(state.pluginApi.features.find((feature) => feature.name === 'execRoute')?.isActive, false)
    assert.equal(state.listeners.filter((entry) => entry.name === 'tools/pre-execute').length, 0)
    assert.throws(() => state.pluginApi.agent.routeOf({}), PluginApiFeatureDisabledError)
  }
})

test('publication and registry failures roll back hook and route delegate', () => {
  for (const failure of ['publish', 'registry']) {
    const { ctx, state } = createCtx()
    const originalPlugin = ctx.plugin
    ctx.plugin = (Class) => {
      originalPlugin(Class)
      if (failure === 'publish') {
        const original = state.pluginApi.mountFeature.bind(state.pluginApi)
        state.pluginApi.mountFeature = (name, api) => {
          if (name === 'execRoute') throw new Error('publication failed')
          return original(name, api)
        }
      } else {
        const original = state.pluginApi._registry.mount.bind(state.pluginApi._registry)
        state.pluginApi._registry.mount = (name) => {
          if (name === 'execRoute') throw new Error('registry failed')
          return original(name)
        }
      }
    }

    assert.doesNotThrow(() => apply(ctx))
    assert.equal(state.pluginApi.features.find((feature) => feature.name === 'execRoute')?.isActive, false)
    assert.equal(state.listeners.filter((entry) => entry.name === 'tools/pre-execute').length, 0)
    assert.throws(() => state.pluginApi.agent.routeOf({}), PluginApiFeatureDisabledError)
  }
})

test('feature-disabled diagnostics deduplicate repeated apply failures by lifecycle key', () => {
  const { ctx, state, services } = createCtx({ services: { tools: undefined } })
  const keys = []
  const originalPlugin = ctx.plugin
  ctx.plugin = (Class) => {
    originalPlugin(Class)
    const original = state.pluginApi.reportExecRouteDiagnosticsOnce.bind(state.pluginApi)
    state.pluginApi.reportExecRouteDiagnosticsOnce = (phase, category, problems) => {
      const reported = original(phase, category, problems)
      if (reported) keys.push(`${phase}:${category}`)
      return reported
    }
  }

  apply(ctx)
  apply(ctx)
  services.tools = { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} }
  ctx.effect = (fn, label) => {
    if (label === 'dsh-plugin-api: execRoute cleanup') throw new Error('cleanup registration failed')
    state.effects.push({ fn, label })
  }
  apply(ctx)
  apply(ctx)

  assert.deepEqual(keys, ['guard:mandatory-substrate', 'activation:cleanup-registration'])
})

test('every missing tools or session substrate leaves execRoute disabled without native hook', () => {
  for (const dependency of ['tools', 'sessions']) {
    const services = { [dependency]: undefined }
    const { ctx, state } = createCtx({ services })

    apply(ctx)

    assert.equal(state.pluginApi.features.find((feature) => feature.name === 'execRoute')?.isActive, false)
    assert.equal(state.listeners.filter((entry) => entry.name === 'tools/pre-execute').length, 0)
  }
})

test('execRoute mounter needs only active tools and session when events and agent are inactive', () => {
  const { ctx, state } = createCtx()
  const registry = createFeatureRegistry()
  registry.mount('tools')
  registry.mount('session')
  registry.disable('events', 'independently inactive')
  registry.disable('agent', 'independently inactive')
  const owner = mountExecRouteFeature({
    ctx,
    service: { mountFeature() {}, unmountFeature() {} },
    featureRegistry: registry,
  })

  assert.ok(owner)
  assert.equal(state.listeners.filter((entry) => entry.name === 'tools/pre-execute').length, 1)
  owner.disposer()
  assert.equal(state.listeners.filter((entry) => entry.name === 'tools/pre-execute').length, 0)
})

test('malformed execRoute owner result is rejected before publication', () => {
  const { ctx, state } = createCtx()
  const registry = createFeatureRegistry()
  for (const name of ['tools', 'events', 'agent', 'session']) registry.mount(name)
  const service = {
    mountFeature() { throw new Error('must not publish malformed owner') },
    unmountFeature() {},
  }

  let removed = false
  const withDispose = mountExecRouteFeature({
    ctx,
    service,
    featureRegistry: registry,
    createOwner: ({ ctx: ownerCtx }) => {
      const disposeHook = ownerCtx.on('tools/pre-execute', () => {})
      return {
        dispose() {
          removed = true
          disposeHook()
        },
        // Missing routeOf makes this a partial malformed result.
      }
    },
  })

  assert.equal(withDispose, null)
  assert.equal(removed, true)
  assert.equal(state.listeners.filter((entry) => entry.name === 'tools/pre-execute').length, 0)

  const withoutDispose = mountExecRouteFeature({
    ctx,
    service,
    featureRegistry: registry,
    createOwner: ({ ctx: ownerCtx }) => {
      ownerCtx.on('tools/pre-execute', () => {})
      return { routeOf() {} }
    },
  })

  assert.equal(withoutDispose, null)
  assert.equal(state.listeners.filter((entry) => entry.name === 'tools/pre-execute').length, 0)
})

test('malformed native hook registration return is rolled back through public off', () => {
  const { ctx, state } = createCtx()
  const registry = createFeatureRegistry()
  for (const name of ['tools', 'events', 'agent', 'session']) registry.mount(name)
  ctx.on = (name, listener, eventOptions) => {
    state.listeners.push({ name, listener, eventOptions })
    return undefined
  }
  ctx.off = (name, listener) => {
    const index = state.listeners.findIndex((entry) => entry.name === name && entry.listener === listener)
    if (index >= 0) state.listeners.splice(index, 1)
  }

  const result = mountExecRouteFeature({
    ctx,
    service: { mountFeature() {}, unmountFeature() {} },
    featureRegistry: registry,
  })

  assert.equal(result, null)
  assert.equal(state.listeners.filter((entry) => entry.name === 'tools/pre-execute').length, 0)
})

test('partially registered native hook throw is rolled back through public off', () => {
  const { ctx, state } = createCtx()
  const registry = createFeatureRegistry()
  for (const name of ['tools', 'events', 'agent', 'session']) registry.mount(name)
  ctx.on = (name, listener, eventOptions) => {
    state.listeners.push({ name, listener, eventOptions })
    throw new Error('registered then failed')
  }
  ctx.off = (name, listener) => {
    const index = state.listeners.findIndex((entry) => entry.name === name && entry.listener === listener)
    if (index >= 0) state.listeners.splice(index, 1)
  }

  const result = mountExecRouteFeature({
    ctx,
    service: { mountFeature() {}, unmountFeature() {} },
    featureRegistry: registry,
  })

  assert.equal(result, null)
  assert.equal(state.listeners.filter((entry) => entry.name === 'tools/pre-execute').length, 0)
})

test('route outcome remains available to facade listeners through every dispatched tools lifecycle stage', () => {
  const { ctx, state } = createCtx()
  apply(ctx)
  let contextReads = 0
  let context = { provider: 'provider-a', model: 'model-a' }
  const exec = {
    agent: {
      session: {
        requestContext() {
          contextReads += 1
          return context
        },
      },
    },
  }
  const seen = []
  const observe = (stage) => () => {
    const agentOutcome = state.pluginApi.agent.routeOf(exec)
    const toolsOutcome = state.pluginApi.tools.routeOf(exec)
    seen.push({ stage, agentOutcome, toolsOutcome })
  }

  state.pluginApi.events.on('tools/pre-execute', observe('pre-execute'))
  state.pluginApi.events.on('tools/execute', observe('execute'))
  state.pluginApi.events.on('tools/post-execute', observe('post-execute'))
  state.pluginApi.events.on('tools/result', observe('result'))

  const signal = { id: 'original-signal' }
  const result = { isError: false, content: [{ type: 'text', text: 'ok' }] }
  dispatchWaterfall(state, 'tools/pre-execute', [exec], () => ({ kind: 'allow' }))
  context = { provider: 'provider-b', model: 'model-b' }
  dispatchWaterfall(state, 'tools/pre-execute', [exec], () => ({ kind: 'allow' }))
  dispatchWaterfall(state, 'tools/execute', [exec], () => signal)
  dispatchWaterfall(state, 'tools/post-execute', [exec, result], () => ({ kind: 'accept' }))
  dispatchEmit(state, 'tools/result', [exec, result])

  assert.deepEqual(seen.map(({ stage }) => stage), ['pre-execute', 'pre-execute', 'execute', 'post-execute', 'result'])
  const captured = seen[0].agentOutcome
  assert.deepEqual(captured, { provider: 'provider-a', model: 'model-a' })
  for (const { agentOutcome, toolsOutcome } of seen) {
    assert.equal(agentOutcome, captured)
    assert.equal(toolsOutcome, captured)
  }
  assert.equal(contextReads, 1)
})

test('dispatched final-result paths preserve captured routes or leave unobserved routes absent', () => {
  const { ctx, state } = createCtx()
  apply(ctx)
  let capturedReads = 0
  let capturedContext = { provider: 'provider-a', model: 'model-a' }
  const capturedExec = {
    agent: {
      session: {
        requestContext() {
          capturedReads += 1
          return capturedContext
        },
      },
    },
  }
  let unobservedReads = 0
  const unobservedExec = {
    agent: {
      session: {
        requestContext() {
          unobservedReads += 1
          return { provider: 'provider-b', model: 'model-b' }
        },
      },
    },
  }
  const seen = []
  const observe = (exec) => seen.push({
    exec,
    agentOutcome: state.pluginApi.agent.routeOf(exec),
    toolsOutcome: state.pluginApi.tools.routeOf(exec),
  })
  state.pluginApi.events.on('tools/execute', observe)
  state.pluginApi.events.on('tools/result', observe)

  dispatchWaterfall(state, 'tools/pre-execute', [capturedExec], () => ({ kind: 'allow' }))
  const captured = state.pluginApi.agent.routeOf(capturedExec)
  capturedContext = { provider: 'provider-c', model: 'model-c' }
  dispatchWaterfall(state, 'tools/execute', [capturedExec], () => ({ id: 'captured-signal' }))
  // The final-result route intentionally bypasses tools/post-execute.
  dispatchEmit(state, 'tools/result', [capturedExec, { isError: false }])
  dispatchWaterfall(state, 'tools/execute', [unobservedExec], () => ({ id: 'unobserved-signal' }))
  dispatchEmit(state, 'tools/result', [unobservedExec, { isError: false }])

  assert.equal(capturedReads, 1)
  assert.equal(unobservedReads, 0)
  assert.equal(seen[0].agentOutcome, captured)
  assert.equal(seen[0].toolsOutcome, captured)
  assert.equal(seen[1].agentOutcome, captured)
  assert.equal(seen[1].toolsOutcome, captured)
  assert.equal(seen[2].agentOutcome, undefined)
  assert.equal(seen[2].toolsOutcome, undefined)
  assert.equal(seen[3].agentOutcome, undefined)
  assert.equal(seen[3].toolsOutcome, undefined)
})

test('route capture leaves dispatched decision, signal, result, and emission semantics unchanged', () => {
  const { ctx, state } = createCtx()
  apply(ctx)
  const exec = execWithRoute()
  const signal = { id: 'original-signal' }
  const result = { isError: false, content: [{ type: 'text', text: 'ok' }] }
  const finalDecision = { kind: 'allow' }
  const postDecision = { kind: 'accept' }
  const emitted = []

  state.pluginApi.events.on('tools/pre-execute', (observedExec, next) => {
    assert.equal(state.pluginApi.tools.routeOf(observedExec)?.model, 'model-a')
    return next()
  })
  state.pluginApi.events.on('tools/execute', (observedExec, next) => {
    assert.equal(state.pluginApi.agent.routeOf(observedExec)?.provider, 'provider-a')
    return next()
  })
  state.pluginApi.events.on('tools/post-execute', (observedExec, observedResult, next) => {
    assert.equal(state.pluginApi.tools.routeOf(observedExec)?.model, 'model-a')
    assert.equal(observedResult, result)
    return next()
  })
  state.pluginApi.events.on('tools/result', (observedExec, observedResult) => {
    assert.equal(state.pluginApi.agent.routeOf(observedExec)?.provider, 'provider-a')
    emitted.push(observedResult)
  })

  assert.equal(dispatchWaterfall(state, 'tools/pre-execute', [exec], () => finalDecision), finalDecision)
  assert.equal(dispatchWaterfall(state, 'tools/execute', [exec], () => signal), signal)
  assert.equal(dispatchWaterfall(state, 'tools/post-execute', [exec, result], () => postDecision), postDecision)
  dispatchEmit(state, 'tools/result', [exec, result])
  assert.deepEqual(emitted, [result])
})

test('route absence leaves dispatched decision, signal, result, and emission semantics unchanged', () => {
  const { ctx, state } = createCtx()
  apply(ctx)
  const exec = { agent: { session: { requestContext: () => undefined } } }
  const signal = { id: 'original-signal' }
  const result = { isError: false, content: [{ type: 'text', text: 'ok' }] }
  const finalDecision = { kind: 'allow' }
  const postDecision = { kind: 'accept' }
  const emitted = []

  state.pluginApi.events.on('tools/pre-execute', (observedExec, next) => {
    assert.equal(state.pluginApi.agent.routeOf(observedExec), undefined)
    assert.equal(state.pluginApi.tools.routeOf(observedExec), undefined)
    return next()
  })
  state.pluginApi.events.on('tools/execute', (observedExec, next) => {
    assert.equal(state.pluginApi.agent.routeOf(observedExec), undefined)
    assert.equal(state.pluginApi.tools.routeOf(observedExec), undefined)
    return next()
  })
  state.pluginApi.events.on('tools/post-execute', (observedExec, observedResult, next) => {
    assert.equal(state.pluginApi.agent.routeOf(observedExec), undefined)
    assert.equal(state.pluginApi.tools.routeOf(observedExec), undefined)
    assert.equal(observedResult, result)
    return next()
  })
  state.pluginApi.events.on('tools/result', (observedExec, observedResult) => {
    assert.equal(state.pluginApi.agent.routeOf(observedExec), undefined)
    assert.equal(state.pluginApi.tools.routeOf(observedExec), undefined)
    emitted.push(observedResult)
  })

  assert.equal(dispatchWaterfall(state, 'tools/pre-execute', [exec], () => finalDecision), finalDecision)
  assert.equal(dispatchWaterfall(state, 'tools/execute', [exec], () => signal), signal)
  assert.equal(dispatchWaterfall(state, 'tools/post-execute', [exec, result], () => postDecision), postDecision)
  dispatchEmit(state, 'tools/result', [exec, result])
  assert.deepEqual(emitted, [result])
})

test('registered cleanup is idempotent and stale after a failed later apply', () => {
  const { ctx, state } = createCtx()
  apply(ctx)
  const execRouteEffect = state.effects.find((effect) => effect.label === 'dsh-plugin-api: execRoute cleanup')
  assert.ok(execRouteEffect)

  const dispose = execRouteEffect.fn()
  dispose()
  dispose()
  assert.equal(state.listeners.filter((entry) => entry.name === 'tools/pre-execute').length, 0)
  assert.throws(() => state.pluginApi.agent.routeOf({}), PluginApiFeatureDisabledError)
})
