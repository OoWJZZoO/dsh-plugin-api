/**
 * Shared harness for the plan-mode acceptance tests.
 *
 * The official side is a mock faithful to the probed
 * `@deepseek-ai/dsh-plan-mode` seam: the synchronous `set(agent, active)`
 * decision order (noop / queued / cancelled / committed), the pending table
 * keyed by the session object, the conditional narration and the `onBoundary`
 * settlement that appends the `plan/mode` fact. Official state lives in the
 * mock's own bookkeeping, mirroring the official component that owns its
 * session objects (the facade's read-only payload policy deep-freezes what it
 * dispatches). Every scenario drives the public facade entries only; the kit
 * is the official side, never a facade bypass.
 */
import { apply } from '../lib/index.js'

export function createOfficialPlanMode() {
  const pending = new Map() // session object -> { active }
  const logs = new WeakMap() // session object -> committed facts
  const turns = new WeakMap() // session object -> open turn flag
  const toldAtHeader = new WeakMap() // session object -> mode carried by the last logged header
  const narrations = []
  const setCalls = []
  const appendSources = []

  const logOf = (session) => {
    if (!logs.has(session)) logs.set(session, [])
    return logs.get(session)
  }
  const fold = (session) => {
    let active = false
    for (const event of logOf(session)) {
      if (event.type === 'plan/mode') active = event.active === true
    }
    return active
  }

  const service = {
    get(agent) {
      const session = agent.session
      const state = { active: fold(session) }
      const current = pending.get(session)
      if (current) state.pending = current.active
      return Object.freeze(state)
    },
    set(agent, active) {
      setCalls.push({ sessionId: agent.session.id, active })
      const session = agent.session
      const current = pending.get(session)
      if (active === (current ? current.active : fold(session))) return 'noop'
      if (turns.get(session) === true) {
        pending.set(session, { active, narrate: true })
        return fold(session) === active ? 'cancelled' : 'queued'
      }
      if (active === fold(session)) {
        pending.delete(session)
        return 'cancelled'
      }
      logOf(session).push({ type: 'plan/mode', active })
      appendSources.push('official-set')
      pending.delete(session)
      // Official narration is conditional: the notice is injected only when the
      // last logged header described the *other* mode. Nothing has been told
      // before the first header, so the first switch stays silent.
      const told = toldAtHeader.get(session)
      if (told !== undefined && told !== active) {
        narrations.push({ sessionId: session.id, active })
      }
      return 'committed'
    },
  }

  return {
    service,
    narrations,
    setCalls,
    appendSources,
    logOf,
    pendingCount: () => pending.size,
    setOpenTurn(session, value) { turns.set(session, value === true) },
    /** The official header fact: the mode the last logged header carried. */
    markHeader(session, mode) { toldAtHeader.set(session, mode === true) },
    /** Official pre-step boundary: settle the pending intent. */
    onBoundary(session) {
      const current = pending.get(session)
      if (!current) return 'none'
      pending.delete(session)
      if (fold(session) === current.active) return 'silent-clear'
      logOf(session).push({ type: 'plan/mode', active: current.active })
      appendSources.push('official-boundary')
      return 'committed'
    },
  }
}

export function createHarness(options = {}) {
  const official = options.official ?? createOfficialPlanMode()
  const sessions = options.sessions ?? new Map()
  const state = { pluginApi: undefined, effects: [], listeners: [] }
  const callerFiber = options.unowned === true ? undefined : { name: options.fiberName ?? 'plan-plugin' }

  const sessionsService = {
    get(id) { return sessions.get(id) },
    list() { return [...sessions.values()] },
    fork() {},
  }

  const services = {
    loader: { entries() { return callerFiber ? [{ fiber: callerFiber, options: { name: callerFiber.name } }] : [] } },
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {}, executionMode() { return 'mode' } },
    agents: { get() {}, list() {}, roots() {} },
    sessions: sessionsService,
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    systemPrompt: { section() { return () => {} }, context() { return () => {} }, variable() { return () => {} }, tools() { return () => {} }, suppressRuntimeContext() { return () => {} }, renderPrompt() {}, renderContextSections() {}, renderContextSnapshot() {}, joinContextSections() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {} },
  }
  if (options.noPlanMode !== true) services.planMode = official.service

  const ctx = {
    ...(callerFiber ? { fiber: callerFiber } : {}),
    loader: services.loader,
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect(fn, label) { state.effects.push({ fn, label }) },
    on(name, listener) {
      if (options.onThrows === true) throw new Error('the shared event substrate is unavailable')
      const entry = { name, listener }
      state.listeners.push(entry)
      return () => {
        const index = state.listeners.indexOf(entry)
        if (index >= 0) state.listeners.splice(index, 1)
        return true
      }
    },
    once() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
    emit(name, ...args) { for (const entry of state.listeners.filter((entry) => entry.name === name)) entry.listener(...args) },
    model() { return { name: 'x' } },
    runtime: { name: 'test', version: '0.1.0-rc.6' },
  }

  apply(ctx)

  /**
   * Install recording probes on the cross-domain faces the plan-mode feature
   * must never touch. Installed after the boot so other features' own probes
   * stay out of the record; any access during a later facade call is recorded.
   */
  const probeCrossDomain = () => {
    const accesses = []
    for (const name of ['permissionPresets', 'approval', 'security', 'sandboxPolicy', 'sandbox']) {
      services[name] = new Proxy({}, {
        get(_target, property) {
          accesses.push(`${name}.${String(property)}`)
          return undefined
        },
      })
    }
    return {
      accesses,
      reset() { accesses.length = 0 },
    }
  }

  /** Create an official session (the official store owns liveness). */
  const createSession = (id, fields = {}) => {
    const { mode: initialMode, openTurn, ...rest } = fields
    const session = { id, ...rest }
    sessions.set(id, session)
    if (openTurn !== undefined) official.setOpenTurn(session, openTurn)
    if (initialMode !== undefined) official.logOf(session).push({ type: 'plan/mode', active: initialMode === true })
    return session
  }
  /** The official path emits facts; the facade derives its feed from them. */
  const emitFact = (session, event) => ctx.emit('session/event', session, event)

  return { ctx, state, services, official, sessions, createSession, emitFact, probeCrossDomain, callerFiber }
}

/** Create an official session and the agent handle that targets it. */
export function mountOfficialSession(kit, id, fields = {}) {
  const session = kit.createSession(id, fields)
  return { session, agent: { session } }
}

/** The public plan-mode sub-face of a mounted facade. */
export const planModeOf = (state) => state.pluginApi.sessions.planMode
