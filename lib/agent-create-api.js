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
  enter: 'provider.enter',
  announce: 'provider.announce',
  setFactory: 'provider.setFactory',
})

const MEMBER_NAMES = Object.freeze(Object.keys(MEMBER_PATHS))

function freezeAvailability(state) {
  return Object.freeze({
    create: state.create,
    resume: state.resume,
    register: state.register,
    provider: Object.freeze({
      enter: state.enter,
      announce: state.announce,
      setFactory: state.setFactory,
    }),
  })
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

  const availability = () => freezeAvailability(available)

  const unavailable = (member) => {
    if (!isActive()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError(
      'agent',
      `agent extension member "${MEMBER_PATHS[member]}" is unavailable`,
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
    provider: {
      get isActive() {
        return available.enter && available.announce && available.setFactory
      },
      enter(agent, owner) {
        return forward(consumerCtx, 'enter', [agent, owner])
      },
      announce(agent) {
        return forward(consumerCtx, 'announce', [agent])
      },
      setFactory(factory) {
        return forward(consumerCtx, 'setFactory', [factory])
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
