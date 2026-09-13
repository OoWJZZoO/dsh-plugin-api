/**
 * Shared mock harness for the scoped agent contribution acceptance tests.
 *
 * It reproduces the probed official semantics recorded in the feature's tasks
 * probe record: `tools` / `systemPrompt` are host singletons whose per-agent
 * behavior comes from scoped layers keyed by the requesting context (cordis
 * resolves by access context, not by execution fiber), prompt assembly carries
 * the agent identity, and lifecycle facts (`agent/created` / `agent/disposed`)
 * flow through the shared event substrate to root-context listeners. Every
 * scenario in the tests built on this kit goes through public facade entries
 * only; the kit is the official side, never a facade bypass.
 *
 * Fidelity 声明：mock 以代码复刻源码级 probe 结论（caller-shadow 按访问 ctx
 * 解析、agent scoped 层按 agent 对象键、scope-filtered 事实派发到根上下文），
 * 因此行为测试是对 probe 结论的自洽回归，真实 fidelity 由该 feature 的规格
 * 文档中的源码级 probe 记录背书；两者互补，不互相替代。
 */
import { apply } from '../lib/index.js'

/**
 * Scoped-layer host singletons. `ctx.get(name)` returns member closures bound
 * to the ACCESSING context for the duration of each call — the simplified
 * caller-shadow semantics: a registration through an agent context lands in
 * that agent's layer (keyed by the stable agent id), a registration through
 * the host context lands in the global layer. Binding never leaks across
 * calls.
 */
export function createOfficialSingletons() {
  const layers = new Map() // scopeKey ('global' | agent id string) → { sections, variables, tools, restricts }
  const layerOf = (scopeKey) => {
    if (!layers.has(scopeKey)) layers.set(scopeKey, { sections: [], variables: [], tools: [], toolProviders: [], restricts: [], suppressed: 0 })
    return layers.get(scopeKey)
  }
  const globalLayer = layerOf('global')
  let binding = 'global' // scope key installed around each view-member call
  const agentListenersById = new Map() // agent id → [{ name, listener }] (the live fiber's listeners)

  const systemPrompt = {
    section(def) {
      const layer = layerOf(binding)
      layer.sections.push(def)
      return () => {
        const index = layer.sections.indexOf(def)
        if (index >= 0) layer.sections.splice(index, 1)
      }
    },
    context(def) {
      const layer = layerOf(binding)
      layer.sections.push(def)
      return () => {
        const index = layer.sections.indexOf(def)
        if (index >= 0) layer.sections.splice(index, 1)
      }
    },
    variable(name, provider) {
      const layer = layerOf(binding)
      layer.variables.push({ name, provider })
      return () => {
        const index = layer.variables.findIndex((entry) => entry.name === name)
        if (index >= 0) layer.variables.splice(index, 1)
      }
    },
    tools(provider) {
      const layer = layerOf(binding)
      layer.toolProviders.push(provider)
      return () => {
        const index = layer.toolProviders.indexOf(provider)
        if (index >= 0) layer.toolProviders.splice(index, 1)
      }
    },
    suppressRuntimeContext() {
      layerOf(binding).suppressed += 1
      return () => {}
    },
    renderPrompt() {
      return ''
    },
    renderContextSections() {
      return []
    },
    renderContextSnapshot() {
      return ''
    },
    joinContextSections() {
      return ''
    },
    async assemble(context) {
      // Official assembly context carries the agent OBJECT (`{ agent, scope,
      // signal? }`); the mock accepts both the object and a bare id string.
      const agentRef = context?.agent
      const agentId = typeof agentRef === 'string'
        ? agentRef
        : (typeof agentRef?.id === 'string' ? agentRef.id : null)
      // Official assemble dispatches the per-step waterfall on the agent
      // context; the snapshot capture listener runs at chain entry and reads
      // the step's selection before any variable provider observes it.
      const listeners = (agentListenersById.get(agentId) ?? [])
        .filter((entry) => entry.name === 'system-prompt/assemble')
        .map((entry) => entry.listener)
      let index = -1
      const step = (i) => {
        if (i <= index) throw new Error('assemble chain next() re-entered')
        index = i
        if (i >= listeners.length) return undefined
        return listeners[i](context, undefined, () => step(i + 1))
      }
      await step(0)
      const agentLayer = agentId ? layers.get(agentId) : undefined
      const variables = {}
      for (const { name, provider } of globalLayer.variables) variables[name] = provider(context)
      for (const { name, provider } of agentLayer?.variables ?? []) variables[name] = provider(context)
      const sections = []
      for (const def of globalLayer.sections) sections.push({ name: def.id ?? def.name, text: def.text?.(context) ?? '' })
      for (const def of agentLayer?.sections ?? []) sections.push({ name: def.id ?? def.name, text: def.text?.(context) ?? '' })
      return Object.freeze({ sections, variables, tools: [] })
    },
  }
  const tools = {
    register(definition) {
      const layer = layerOf(binding)
      layer.tools.push(definition)
      return () => {
        const index = layer.tools.indexOf(definition)
        if (index >= 0) layer.tools.splice(index, 1)
      }
    },
    restrict(filter) {
      const layer = layerOf(binding)
      layer.restricts.push(filter)
      return () => {
        const index = layer.restricts.indexOf(filter)
        if (index >= 0) layer.restricts.splice(index, 1)
      }
    },
    view(agent) {
      const agentLayer = typeof agent === 'string' ? layers.get(agent) : undefined
      return {
        tools: [...globalLayer.tools, ...(agentLayer?.tools ?? [])].map((definition) => definition.name),
        restricts: (agentLayer?.restricts ?? []).length,
      }
    },
    guard() {
      return () => {}
    },
    get() {
      return undefined
    },
    schemas() {
      return []
    },
    execute() {},
    presentAs() {},
    executionMode() {
      return 'mode'
    },
  }
  // A ctx view: every layer-mutating member runs with the binding pointed at
  // the accessing scope, restored afterwards.
  const viewFor = (scopeKey, base, mutating) => {
    const view = {}
    for (const member of mutating) {
      view[member] = (...args) => {
        const prev = binding
        binding = scopeKey
        try {
          return Reflect.apply(base[member], base, args)
        } finally {
          binding = prev
        }
      }
    }
    for (const member of Object.keys(base)) {
      if (!mutating.includes(member)) view[member] = (...args) => Reflect.apply(base[member], base, args)
    }
    return view
  }
  const systemPromptViewFor = (scopeKey) => viewFor(scopeKey, systemPrompt, ['section', 'context', 'variable', 'tools', 'suppressRuntimeContext'])
  const toolsViewFor = (scopeKey) => viewFor(scopeKey, tools, ['register', 'restrict'])
  return {
    systemPrompt,
    tools,
    systemPromptViewFor,
    toolsViewFor,
    __layers: layers,
    __agentListenersById: agentListenersById,
    __globalLayer: globalLayer,
  }
}

export function createHarness(options = {}) {
  const singletons = createOfficialSingletons()
  const agentRegistry = new Map()
  const agentsService = {
    get(id) {
      return agentRegistry.get(id)
    },
    list() {
      return [...agentRegistry.values()]
    },
    roots() {
      return [...agentRegistry.values()]
    },
  }
  const officialListeners = []
  const hostEffects = []
  const requested = []
  const hostFiber = { name: 'e2e-plugin' }
  const registerHostListener = (name, listener) => {
    officialListeners.push({ name, listener })
    return () => {
      const index = officialListeners.findIndex((entry) => entry.listener === listener)
      if (index >= 0) officialListeners.splice(index, 1)
    }
  }
  const hostCtx = {
    fiber: hostFiber,
    loader: { entries() { return [{ fiber: hostFiber, options: { name: 'e2e-plugin' } }] } },
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) {
      requested.push(name)
      if (name === 'pluginApi') return state.pluginApi
      if (name === 'agents') return agentsService
      if (name === 'systemPrompt') return singletons.systemPromptViewFor('global')
      if (name === 'tools') return singletons.toolsViewFor('global')
      return undefined
    },
    plugin(Class) { new Class(hostCtx) },
    effect(fn, label) { hostEffects.push({ fn, label }) },
    on: options.omitListenerSubstrate === true ? undefined : registerHostListener,
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
    model() { return { name: 'x' } },
    runtime: { name: 'test', version: '0.1.0-rc.6' },
  }
  const state = { pluginApi: undefined, effects: [], listeners: officialListeners }

  /**
   * A second/third independent synthetic plugin fiber (standards §11): its own
   * context resolves `pluginApi` through a per-context shadow whose `ctx` is
   * the accessing context, exactly like cordis caller-shadow binding — so
   * owner derivation sees this plugin's own fiber identity. `teardown()`
   * runs the effects the plugin registered (owner unload).
   */
  let pluginSequence = 0
  const createPluginContext = (label) => {
    const name = label ?? `plugin-${++pluginSequence}`
    const fiber = { name }
    const effects = []
    let shadow = null
    const ctx = {
      fiber,
      loader: { entries() { return [{ fiber, options: { name } }] } },
      logger: { error() {}, warn() {} },
      reflect: { provide() {} },
      get(service) {
        requested.push(service)
        if (service === 'pluginApi') {
          if (!state.pluginApi) return undefined
          if (shadow === null) {
            shadow = Object.create(state.pluginApi)
            Object.defineProperty(shadow, 'ctx', { value: ctx, writable: true, configurable: true, enumerable: true })
          }
          return shadow
        }
        if (service === 'agents') return agentsService
        if (service === 'systemPrompt') return singletons.systemPromptViewFor('global')
        if (service === 'tools') return singletons.toolsViewFor('global')
        return undefined
      },
      plugin(Class) { new Class(ctx) },
      effect(fn, effectLabel) {
        effects.push({ fn, label: effectLabel })
        return () => {}
      },
      teardown() {
        for (const entry of effects.splice(0)) {
          try {
            entry.fn()()
          } catch {
            // teardown must never throw through the harness
          }
        }
      },
      on: registerHostListener,
      once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
      model() { return { name: 'x' } },
      runtime: { name: 'test', version: '0.1.0-rc.6' },
    }
    return ctx
  }

  // An agent context: get() binds the singleton members to THIS context
  // (caller-shadow semantics); on() registers per-agent listeners. A fresh
  // context for the same id (cold resume) replaces the listener registry
  // entry — the old fiber's listeners are unreachable, as in the official
  // substrate.
  const makeAgent = (id) => {
    const agentListeners = []
    singletons.__agentListenersById.set(id, agentListeners)
    const agentCtx = {
      id,
      get(name) {
        if (name === 'systemPrompt') return singletons.systemPromptViewFor(id)
        if (name === 'tools') return singletons.toolsViewFor(id)
        return undefined
      },
      on(name, listener) {
        agentListeners.push({ name, listener })
        return () => {
          const index = agentListeners.findIndex((entry) => entry.listener === listener)
          if (index >= 0) agentListeners.splice(index, 1)
        }
      },
      effect() { return () => {} },
    }
    const agent = { id, ctx: agentCtx }
    agentRegistry.set(id, agent)
    return { agent, agentCtx, agentListeners }
  }
  const announce = (agent) => {
    for (const entry of officialListeners) {
      if (entry.name === 'agent/created') entry.listener(null, 'agent/created', { agent })
    }
  }
  const disposeAgent = (agent) => {
    agentRegistry.delete(agent.id)
    for (const entry of officialListeners) {
      if (entry.name === 'agent/disposed') entry.listener(null, 'agent/disposed', { agent })
    }
    // Fiber teardown: the official scoped registrations die with the agent
    // fiber regardless of the event listener outcome, so the agent's layer
    // (and its dead listener registry) is gone after the dispose fact.
    singletons.__layers.delete(agent.id)
    singletons.__agentListenersById.delete(agent.id)
  }

  apply(hostCtx)
  if (options.omitListenerSubstrate === true) {
    // restore the substrate after the boot probe so the harness itself stays usable
    hostCtx.on = registerHostListener
  }
  // Clean-slate reset for the scenarios: the facade's own boot-time global
  // sections (the tool-discovery hint) are environment, not scenario data —
  // every global section asserted in the tests below is contributed by the
  // test itself.
  singletons.__globalLayer.sections = singletons.__globalLayer.sections.filter((def) => def.name === 'discovery:hints' ? false : true)
  return { state, singletons, makeAgent, announce, disposeAgent, hostCtx, hostEffects, requested, createPluginContext }
}

export const scopedSection = (id, text) => ({
  kind: 'section',
  id,
  section: { id, text: () => text },
})
