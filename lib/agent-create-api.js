/**
 * agent extension-local adapter for the official AgentRegistry creation and provider APIs.
 *
 * The adapter does not import Cordis or official DSH modules. Its caller supplies
 * probe and consumer-context resolution so the eventual facade can preserve the
 * context that owns each official registry call.
 */
import { PluginApiError, PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'
import { createResourceHandle } from './contract-kernel.js'
import { callerIdentityOf } from './profile-mutation.js'

const MEMBER_PATHS = Object.freeze({
  create: 'create',
  resume: 'resume',
  register: 'register',
  enter: 'providers.register',
  announce: 'providers.register',
  setFactory: 'providers.register',
})

const MEMBER_NAMES = Object.freeze(Object.keys(MEMBER_PATHS))

/**
 * The explicit provider-registration variants. The merged entry never sniffs
 * which keys happen to exist on the input: `kind` selects the official verb.
 */
export const AGENT_PROVIDER_KINDS = Object.freeze(['factory', 'announce', 'enter'])

/** The well-known resource identity of the single official factory slot. */
const FACTORY_SLOT_ID = 'factory'

/** Typed invalid-input error for `agents.providers.register` (names the legal variants). */
export class AgentProviderRegistrationError extends PluginApiError {
  constructor(message) {
    super('AGENT_PROVIDER_INVALID_REGISTRATION', message)
  }
}

function isObjectLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

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

  const createView = (consumerCtx) => {
    const ownersById = new Map() // `${kind}\u0000${id}` -> derived owner of the live registration
    let providerGeneration = 0

    const providerOwner = () => callerIdentityOf(consumerCtx)

    const providerIdentity = (spec, fallbackId) => {
      const explicit = typeof spec?.id === 'string' && spec.id.trim().length > 0 ? spec.id.trim() : undefined
      if (explicit !== undefined) return explicit
      if (isObjectLike(spec?.agent) && typeof spec.agent.id === 'string' && spec.agent.id.trim().length > 0) {
        return spec.agent.id.trim()
      }
      return fallbackId
    }

    // A live registration of the same kind under the same id belongs to exactly
    // one owner: a second owner is a typed owner conflict, never a silent
    // takeover of the first owner's registration.
    const assertProviderSlot = (kind, id, ownerId) => {
      const liveOwner = ownersById.get(`${kind}\u0000${id}`)
      if (liveOwner !== undefined && liveOwner !== ownerId) {
        throw new AgentProviderRegistrationError(
          `agents.providers.register "${kind}" entry "${id}" is already registered by another owner`,
        )
      }
    }

    const mintProviderHandle = ({ kind, id, ownerId, revoke, irreversible }) => {
      const slotKey = `${kind}\u0000${id}`
      ownersById.set(slotKey, ownerId)
      return createResourceHandle({
        id,
        ownerId,
        generation: `${ownerId}:${kind}:${++providerGeneration}`,
        revoke: () => {
          if (ownersById.get(slotKey) === ownerId) ownersById.delete(slotKey)
          if (irreversible === true) return false
          try {
            revoke()
          } catch {
            // A domain teardown failure is reported as a typed stale no-op
            // rather than thrown through the caller.
            return false
          }
          return true
        },
      })
    }

    const registerProvider = (spec, owner) => {
      if (!isObjectLike(spec)) {
        throw new AgentProviderRegistrationError(
          'agents.providers.register requires a spec object with an explicit kind ' +
            `(one of ${AGENT_PROVIDER_KINDS.map((kind) => `"${kind}"`).join(' | ')})`,
        )
      }
      const kind = spec.kind
      if (typeof kind !== 'string' || !AGENT_PROVIDER_KINDS.includes(kind)) {
        throw new AgentProviderRegistrationError(
          `agents.providers.register kind ${JSON.stringify(spec.kind)} is invalid; ` +
            `expected one of ${AGENT_PROVIDER_KINDS.map((entry) => `"${entry}"`).join(' | ')}`,
        )
      }
      const ownerId = providerOwner()
      if (kind === 'factory') {
        if (!isObjectLike(spec.factory)) {
          throw new AgentProviderRegistrationError(
            'agents.providers.register "factory" requires a factory object',
          )
        }
        const id = providerIdentity(spec, FACTORY_SLOT_ID)
        assertProviderSlot(kind, id, ownerId)
        const disposer = forward(consumerCtx, 'setFactory', [spec.factory])
        return mintProviderHandle({
          kind,
          id,
          ownerId,
          revoke: () => {
            if (typeof disposer === 'function') disposer()
          },
        })
      }
      if (!isObjectLike(spec.agent)) {
        throw new AgentProviderRegistrationError(
          `agents.providers.register "${kind}" requires an agent`,
        )
      }
      const id = providerIdentity(spec, spec.agent.id)
      assertProviderSlot(kind, id, ownerId)
      if (kind === 'announce') {
        forward(consumerCtx, 'announce', [spec.agent])
        // Announcing is irreversible in the official contract: it emits
        // `agent/created` and the entry's lifecycle stays owned by the enter
        // detach. The handle therefore reports the typed no-op on dispose.
        return mintProviderHandle({ kind, id, ownerId, irreversible: true })
      }
      const detach = forward(consumerCtx, 'enter', [spec.agent, spec.owner])
      return mintProviderHandle({
        kind,
        id,
        ownerId,
        revoke: () => {
          if (typeof detach === 'function') detach()
        },
      })
    }

    return {
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
        // The merged provider registration entry: `kind` selects the official
        // verb explicitly (`factory` → setFactory, `announce` → announce,
        // `enter` → enter) instead of sniffing which keys the input carries.
        // Every variant answers with the standard resource handle; the runtime
        // owner for `enter` is forwarded verbatim through `owner`.
        register: registerProvider,
      },
    }
  }

  return {
    get availability() {
      return availability()
    },
    createView,
  }
}
