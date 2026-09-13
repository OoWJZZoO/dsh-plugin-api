/**
 * Shared harness for the permission-preset acceptance tests.
 *
 * Fidelity split (recorded in the feature's tasks probe record):
 * - the **real** official approval component (`@deepseek-ai/dsh-user-approval`)
 *   is mounted on a real `@deepseek-ai/cordis` tree, so the "real approval
 *   decision" evidence runs the official decision chain, not a copy;
 * - the official permission-presets service and the `permissions` projection
 *   carrier are probed-shape doubles that reproduce the frozen-runtime
 *   semantics exactly (synchronous `set` -> `apply`, the three append checks,
 *   `resolve` throwing for unknown names, `current` folding the knob log with
 *   the derived `custom` state, and `selectFor`'s option table with `custom`
 *   appended only while derived). The preset component itself is not imported:
 *   the repository does not declare it as a dependency, and the real chain that
 *   matters for the requirements is the approval decision.
 *
 * Every scenario drives the public facade entries only; the harness is the
 * official side, never a facade bypass.
 */
import { Context } from '@deepseek-ai/cordis'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { Session } from '@deepseek-ai/dsh-session'
import { createPluginApiService } from '../lib/plugin-api-service.js'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { createPermissionPresetFeature } from '../lib/sessions-permission-presets-facade.js'

export const CUSTOM_PRESET = 'custom'

/** Default preset table of the frozen runtime (sandbox mode + approval policy). */
export function defaultPresets() {
  return {
    'workspace-write': {
      sandbox: 'workspace-write',
      approval: 'ask',
      name: 'workspace-write',
      description: 'Write inside the workspace and permitted temporary directories; wider retries require approval.',
    },
    'danger-full-access': {
      sandbox: 'danger-full-access',
      approval: 'never',
      name: 'danger-full-access',
      description: 'Full file access without approval prompts.',
    },
  }
}

const foldKnobs = (events) => {
  const state = { preset: null, sandbox: null, approval: null }
  for (const event of events) {
    if (event.type === 'permission/preset') state.preset = event.data.preset
    else if (event.type === 'sandbox/mode') state.sandbox = event.data.mode
    else if (event.type === 'approval/policy') state.approval = event.data.policy
  }
  return state
}

/**
 * Probed-shape double of `@deepseek-ai/dsh-permission-presets`: the write seam
 * (`set` -> `apply`), the fold-derived read (`current`), the option table
 * (`names`/`optionOf`/`selectFor`) and the durable knob writes. `sandboxMode`
 * and `approvalPolicy` stand in for the mounted executor/approval defaults.
 */
export function createOfficialPermissionPresets({ presets = defaultPresets(), sandboxMode = 'workspace-write', approvalPolicy = 'ask' } = {}) {
  const writes = { preset: 0, sandbox: 0, approval: 0 }
  const service = {
    get names() { return Object.keys(presets) },
    current(events) { return service.derive(foldKnobs(events)) },
    derive(state) {
      const sandbox = state.sandbox ?? sandboxMode
      const approval = state.approval ?? approvalPolicy
      const matches = (spec) => spec.sandbox === sandbox && spec.approval === approval
      if (state.preset !== null) {
        const spec = presets[state.preset]
        if (spec !== undefined && matches(spec)) return state.preset
      }
      for (const [name, spec] of Object.entries(presets)) if (matches(spec)) return name
      return CUSTOM_PRESET
    },
    optionOf(name) {
      if (name === CUSTOM_PRESET) {
        return { value: CUSTOM_PRESET, name: 'Custom', description: 'Current sandbox and approval settings do not match a preset.' }
      }
      const spec = service.resolve(name)
      return { value: name, name: spec.name ?? name, ...(spec.description !== undefined ? { description: spec.description } : {}) }
    },
    selectFor(state) {
      const currentValue = service.derive(state)
      return {
        options: [...service.names.map((name) => service.optionOf(name)), ...currentValue === CUSTOM_PRESET ? [service.optionOf(CUSTOM_PRESET)] : []],
        currentValue,
      }
    },
    resolve(name) {
      const spec = presets[name]
      if (spec === undefined) throw new Error(`permission: unknown preset "${name}" (known: ${Object.keys(presets).join(', ')})`)
      return spec
    },
    set(session, name) {
      // The official `set` writes the approval knob through its canonical
      // session setter.
      service.apply(session, name, (policy) => {
        session.append('approval/policy', { policy })
        writes.approval += 1
      })
    },
    /**
     * The official `apply(session, name, setApproval)` seam: the caller picks
     * the live policy writer (the command path passes the approval service's
     * own `setPolicy`). Omitting it falls back to the durable session write.
     */
    apply(session, name, setApproval) {
      const spec = service.resolve(name)
      if (service.current(session.events) !== name) {
        session.append('permission/preset', { preset: name })
        writes.preset += 1
      }
      const events = session.events
      const effectiveSandbox = foldKnobs(events).sandbox ?? sandboxMode
      if (spec.sandbox !== effectiveSandbox) {
        session.append('sandbox/mode', { mode: spec.sandbox })
        writes.sandbox += 1
      }
      const effectiveApproval = foldKnobs(events).approval ?? approvalPolicy
      if (spec.approval !== effectiveApproval) {
        if (typeof setApproval === 'function') {
          setApproval(spec.approval)
        } else {
          session.append('approval/policy', { policy: spec.approval })
          writes.approval += 1
        }
      }
    },
  }
  return { service, writes }
}

/**
 * Build one real official `Session` and wire its published facts into the
 * harness substrate: the session itself comes from `@deepseek-ai/dsh-session`
 * (`Session.create(id)`, the same construction the repository's own durable
 * tests use), and only the publication hop is forwarded — a store-less
 * session's `append` does not reach the `session/event` firehose by itself, so
 * the harness publishes each appended envelope to the tree.
 */
export function createSessionObject(id, { publish, presets } = {}) {
  const session = Session.create(id)
  const append = session.append.bind(session)
  session.append = (type, data, options) => {
    const event = append(type, data, options)
    if (typeof publish === 'function') publish(session, event)
    return event
  }
  // A freshly published session carries the official initial facts.
  if (presets) {
    session.append('permission/preset', { preset: presets.defaultPreset })
    const spec = presets.resolve(presets.defaultPreset)
    session.append('sandbox/mode', { mode: spec.sandbox })
    session.append('approval/policy', { policy: spec.approval })
  }
  return session
}

/**
 * Boot a real cordis tree carrying the facade, the real approval service and
 * the official-shaped preset double. Returns the public faces plus the helpers
 * the scenarios need (caller plugins, fact emission, session creation).
 */
export async function createHarness(options = {}) {
  const root = new Context()
  /** Record the feature-owned subscriptions so teardown is observable. */
  const subscriptions = []
  const originalOn = root.on.bind(root)
  root.on = (name, listener) => {
    const entry = { name, active: true }
    const off = originalOn(name, listener)
    entry.off = () => { entry.active = false; return off() }
    subscriptions.push(entry)
    return entry.off
  }

  // `officialInstance` shares one official preset component (and `sessions`
  // shares one official store) across harnesses, so two independent plugin
  // trees can be driven over the same authority.
  const presets = options.officialInstance
    ?? createOfficialPermissionPresets({
      presets: options.presetTable ?? defaultPresets(),
      sandboxMode: options.sandboxMode,
      approvalPolicy: options.approvalPolicy,
    })
  const sessions = options.sessions ?? new Map()
  const dispatches = []

  const publish = (session, event) => {
    dispatches.push({ sessionId: session.id, type: event.type })
    root.emit('session/event', session, event)
  }

  const sessionsService = {
    get: (id) => sessions.get(id),
    list: () => [...sessions.values()],
    fork() {},
  }
  const systemPromptCalls = []
  const systemPrompt = {
    section(def) { systemPromptCalls.push({ kind: 'section', name: def?.id ?? def?.name }); return () => {} },
    context(def) { systemPromptCalls.push({ kind: 'context', name: def?.name }); return () => {} },
    variable() { systemPromptCalls.push({ kind: 'variable' }); return () => {} },
    tools() { systemPromptCalls.push({ kind: 'tools' }); return () => {} },
    suppressRuntimeContext() { systemPromptCalls.push({ kind: 'suppress' }); return () => {} },
    renderPrompt() { return '' },
    renderContextSections() { return [] },
    renderContextSnapshot() { return '' },
    joinContextSections() { return '' },
  }
  const services = {
    loader: { entries: () => [] },
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {}, executionMode() { return 'mode' } },
    agents: { get() {}, list() {}, roots() {} },
    sessions: sessionsService,
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    systemPrompt,
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {} },
  }
  for (const [name, value] of Object.entries(services)) root.provide(name, value)
  if (options.noPresets !== true) {
    root.provide('permissionPresets', options.presetsWithoutSet === true
      ? { current: presets.service.current, resolve: presets.service.resolve, names: presets.service.names, optionOf: presets.service.optionOf }
      : presets.service)
  }
  if (options.noProjection !== true) {
    root.provide('sessionProjections', {
      snapshot(session) {
        const state = foldKnobs(session.events)
        return { asOfSeq: session.seq - 1, values: { permissions: presets.service.selectFor(state) } }
      },
    })
  }

  const approvalDecisions = []
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: () => true })
  root.plugin(ServiceClass)
  root.plugin(ApprovalService, { policy: options.approvalPolicy ?? 'ask' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const service = root.pluginApi
  const approval = root.approval
  for (const member of ['decide', 'request']) {
    if (approval && typeof approval[member] === 'function') {
      const original = approval[member].bind(approval)
      approval[member] = (...args) => {
        approvalDecisions.push({ member, args })
        return original(...args)
      }
    }
  }
  let feature = null
  let prepared = null
  if (options.noPresets !== true) {
    feature = createPermissionPresetFeature({ ctx: root, service, logger: { warn() {} } })
    // The assembly mounts this feature through the staged publication path
    // (`prepareFeature` + commit); the harness mirrors that path.
    prepared = service.prepareFeature('sessionPermissionPresets', feature.api)
    prepared.commit()
    registry.mount('sessionPermissionPresets')
    options.onFeature?.(feature)
  }

  /**
   * Record every service name the facade resolves through `ctx.get`, so a
   * scenario can prove the feature stays inside its declared seams.
   */
  const trackServiceAccess = () => {
    const requested = []
    const original = root.get.bind(root)
    root.get = (name) => {
      requested.push(name)
      return original(name)
    }
    return {
      requested,
      reset() { requested.length = 0 },
      /** Names outside the feature's declared seams that were requested. */
      outside(allowed = ['permissionPresets', 'sessionProjections', 'sessions']) {
        return requested.filter((name) => !allowed.includes(name))
      },
    }
  }

  const createSession = (id, { seed = true } = {}) => {
    const session = createSessionObject(id, {
      publish,
      presets: seed ? { defaultPreset: options.defaultPreset ?? 'workspace-write', resolve: presets.service.resolve } : undefined,
    })
    sessions.set(id, session)
    return session
  }
  const emitFact = (session, type, data) => publish(session, { type, data })

  /**
   * Mount a calling plugin and hand back the plan-mode/permission faces it
   * receives: this is how a real third-party plugin reaches the facade.
   */
  const faces = []
  const caller = async (name) => {
    class CallerPlugin {
      static inject = ['pluginApi']
      constructor(ctx) {
        faces.push({ name, ctx, permissions: ctx.pluginApi.sessions.permissionPresets })
      }
    }
    Object.defineProperty(CallerPlugin, 'name', { value: name })
    root.plugin(CallerPlugin)
    await new Promise((resolve) => setTimeout(resolve, 20))
    return faces.find((entry) => entry.name === name)
  }

  return { root, service, registry, presets, sessions, createSession, emitFact, caller, dispatches, approval, approvalDecisions, systemPromptCalls, subscriptions, feature, prepared, trackServiceAccess }
}
