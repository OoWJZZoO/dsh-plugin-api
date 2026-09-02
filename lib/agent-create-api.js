/**
 * agent extension-local adapter for the official AgentRegistry creation and provider APIs.
 *
 * The adapter does not import Cordis or official DSH modules. Its caller supplies
 * probe and consumer-context resolution so the eventual facade can preserve the
 * context that owns each official registry call.
 */
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

const MEMBER_PATHS = Object.freeze({
  create: 'create',
  resume: 'resume',
  register: 'register',
  enter: 'providers.register',
  announce: 'providers.register',
  setFactory: 'providers.register',
})

const MEMBER_NAMES = Object.freeze(Object.keys(MEMBER_PATHS))

function availabilityOf(state) {
  const memberStatuses = [
    state.create,
    state.resume,
    state.register,
    state.enter && state.announce && state.setFactory && state.register,
  ]
  const activeCount = memberStatuses.filter(Boolean).length
  if (activeCount === memberStatuses.length) return Object.freeze({ status: 'active' })
  if (activeCount === 0) return Object.freeze({
    status: 'unavailable',
    reason: 'official agents service is unavailable',
  })
  return Object.freeze({ status: 'degraded', reason: 'some agents members are unavailable' })
}

function defaultResolveRegistry(consumerCtx) {
  if (typeof consumerCtx?.get !== 'function') return undefined
  return consumerCtx.get('agents')
}

/**
 * @param {object} options
 * @param {() => unknown} options.probeRegistry
 *   Resolves the official registry once during mount preparation.
 * @param {(consumerCtx: object) => unknown} [options.resolveRegistry]
 *   Resolves the registry from the context that is consuming pluginApi.
 * @param {{ error?: (message: string) => void }} [options.logger]
 * @param {boolean | (() => boolean)} [options.active]
 */
export function createAgentCreateExtension({
  probeRegistry,
  resolveRegistry = defaultResolveRegistry,
  logger,
  active = true,
} = {}) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const available = Object.fromEntries(MEMBER_NAMES.map((name) => [name, false]))
  const diagnostics = new Set()

  const report = (member, phase) => {
    const key = `agent:${MEMBER_PATHS[member]}:${phase}`
    if (diagnostics.has(key)) return
    diagnostics.add(key)
    try {
      logger?.error?.(`dsh-plugin-api agent ${MEMBER_PATHS[member]} is unavailable (${phase})`)
    } catch {
      // Diagnostics are best-effort and cannot affect caller behavior.
    }
  }

  const markUnavailable = (member, phase) => {
    available[member] = false
    report(member, phase)
  }

  let probe
  try {
    probe = typeof probeRegistry === 'function' ? probeRegistry() : undefined
  } catch {
    probe = undefined
  }

  for (const member of MEMBER_NAMES) {
    try {
      available[member] = typeof probe?.[member] === 'function'
    } catch {
      available[member] = false
    }
    if (!available[member]) report(member, 'mount-probe')
  }

  const availability = () => availabilityOf(available)

  const unavailable = (member) => {
    if (!isActive()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError(
      'agents',
      `agents extension member "${MEMBER_PATHS[member] ?? member}" is unavailable`,
    )
  }

  const resolveMember = (consumerCtx, member) => {
    if (!available[member]) return unavailable(member)

    let registry
    let method
    try {
      registry = resolveRegistry(consumerCtx)
      method = registry?.[member]
    } catch {
      markUnavailable(member, 'call-resolution')
      return unavailable(member)
    }

    if (typeof method !== 'function') {
      markUnavailable(member, 'call-resolution')
      return unavailable(member)
    }

    return { registry, method }
  }

  const forward = (consumerCtx, member, args) => {
    if (!isActive()) throw new PluginApiInactiveError()
    const target = resolveMember(consumerCtx, member)
    if (!target) return undefined
    // Official invocation is deliberately outside every adapter containment path.
    return Reflect.apply(target.method, target.registry, args)
  }

  const createView = (consumerCtx) => ({
    create(options) {
      return forward(consumerCtx, 'create', [options])
    },
    resume(options) {
      return forward(consumerCtx, 'resume', [options])
    },
    register(agent) {
      return forward(consumerCtx, 'register', [agent])
    },
    providers: {
      // The merged provider registration entry: the claim, announcement and
      // factory verbs converge on one registration entry dispatching by spec
      // shape.
      register(spec, owner) {
        if (spec && typeof spec === 'object' && 'factory' in spec) {
          return forward(consumerCtx, 'setFactory', [spec.factory])
        }
        if (spec && typeof spec === 'object' && 'announce' in spec) {
          return forward(consumerCtx, 'announce', [spec.announce])
        }
        if (spec && typeof spec === 'object' && 'agent' in spec) {
          return forward(consumerCtx, 'enter', [spec.agent, spec.owner])
        }
        return forward(consumerCtx, 'enter', [spec, owner])
      },
    },
  })

  return {
    get availability() {
      return availability()
    },
    createView,
  }
}
