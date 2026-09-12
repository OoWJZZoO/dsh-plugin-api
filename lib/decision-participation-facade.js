/**
 * Decision participation feature assembly (host side).
 *
 * Wires the domain decision registries (`agents.decisions`,
 * `tools.executionPolicies`, `prompts.assemblyPolicies`,
 * `events.decisions`) onto the events bus participation substrate and the
 * agent-loop turn-stopping replacement slice:
 *
 * - `agents.decisions.register({ point, ... })` — points `pre-step`,
 *   `request`, `request-error` ride the official waterfall dispatch points
 *   through the bus substrate; point `turn-stopping` is carried by the
 *   agent-loop replacement slice participation chain (its registration is
 *   gated on the replacement row's availability).
 * - `tools.executionPolicies.register({ point, ... })` — `execute` (around
 *   idiom exception) and `post-execute`.
 * - `prompts.assemblyPolicies.register({ ... })` — `system-prompt/assemble`.
 * - `events.decisions.register(name, { ... })` — explicitly enumerated
 *   unified-registry points only: `fs/write-intent`, `fs/edit-intent`,
 *   `compaction/request`, `session-title/candidate`. Everything else is a
 *   typed rejection (never an unconstrained subscription surface).
 *
 * Every registration is availability-gated on its backing dispatch (active
 * catalog membership for base points, replacement-slice probes for the two
 * replacement-owned points, and the agent-loop replacement row for
 * turn-stopping) and returns a typed `unavailable` result when the backing is
 * missing — unrelated points and capabilities stay unaffected.
 */
import { callerIdentityOf } from './profile-mutation.js'
import {
  createDecisionRegistry,
  createTurnStoppingChain,
  TURN_STOPPING_PARTICIPATION_SYMBOL,
  TURN_STOPPING_PARTICIPATION_CONTRACT_VERSION,
  classifyAgentPreStepDecision,
  classifyAgentRequestDecision,
  classifyAgentRequestErrorDecision,
  classifyTurnStoppingDecision,
  classifyAssemblyDecision,
  classifyExecutionAroundDecision,
  classifyPostExecuteDecision,
  classifyFsIntentDecision,
  fsIntentDenialErrorOf,
  classifyCompactionRequestDecision,
  classifySessionTitleCandidateDecision,
} from './decision-participation.js'
import { createCompactionEventsCatalogSlice } from './compaction-events-catalog.js'
import { createSessionTitleEventsCatalogSlice } from './session-title-events-catalog.js'
import { PluginApiError, PluginApiFeatureDisabledError } from './errors.js'

const AGENT_LOOP_REPLACEMENT_NAME = '@deepseek-ai/dsh-plugin-api-agent-loop'
/** Component marker the replacement row installs on its service after its own boot self-check. */
const AGENT_LOOP_COMPONENT_SYMBOL = Symbol.for('dsh-plugin-api.agent-loop.contract')

function typedResult(status, reason) {
  return Object.freeze({ ok: false, code: status, reason })
}

function unavailableResult(point, detail) {
  return typedResult('unavailable', `decision point "${point}" is unavailable: ${detail}`)
}

function unsupportedResult(point, detail) {
  return typedResult('unsupported', `decision point "${point}" is not supported: ${detail}`)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Build one domain registry wired to the bus participation substrate.
 * `listenerOf` adapts the point's decide signature to the official dispatch
 * argument shape (the policy context shapes are fixed per point by the
 * feature requirements).
 */
function createBusBackedRegistry({ label, eventName, classify, denialErrorOf, bus, logger, listenerOf }) {
  return createDecisionRegistry({
    label,
    classify,
    logger,
    install({ decide, priority, scope }) {
      return bus.registerParticipation(eventName, {
        listener: listenerOf(decide),
        classify,
        ...(denialErrorOf !== undefined ? { denialErrorOf } : {}),
        priority,
        ...(scope !== undefined ? { scope } : {}),
      })
    },
    resolveOwnerId: (callerCtx) => callerIdentityOf(callerCtx),
  })
}

// Point adapters: how the official dispatch arguments reach the policy decide.
const adaptAgentWaterfall = (decide) => (payload, next) => decide({ ...payload, next })
const adaptPassthrough = (decide) => decide
const adaptPostExecute = (decide) => (exec, result, next) => decide({ exec, result, next })
const adaptAssemble = (decide) => (assembly, context, next) => decide(assembly, context, next)
const adaptFsIntent = (decide) => (target, exec, next) => decide({ target, exec, next })

/**
 * Per-point registry table. Each entry owns its point's adapter (how the
 * policy decide is invoked at the official dispatch) and classifier.
 */
function createRegistries({ bus, logger }) {
  const registryOptions = { bus, logger }

  const agents = {
    'pre-step': createBusBackedRegistry({
      ...registryOptions,
      label: 'agent/pre-step',
      eventName: 'agent/pre-step',
      classify: classifyAgentPreStepDecision,
      listenerOf: adaptAgentWaterfall,
    }),
    'request': createBusBackedRegistry({
      ...registryOptions,
      label: 'agent/request',
      eventName: 'agent/request',
      classify: classifyAgentRequestDecision,
      listenerOf: adaptAgentWaterfall,
    }),
    'request-error': createBusBackedRegistry({
      ...registryOptions,
      label: 'agent/request-error',
      eventName: 'agent/request-error',
      classify: classifyAgentRequestErrorDecision,
      listenerOf: adaptAgentWaterfall,
    }),
    'turn-stopping': createDecisionRegistry({
      label: 'agent/turn-stopping',
      classify: classifyTurnStoppingDecision,
      // The turn-stopping backing is the agent-loop replacement slice: the
      // chain reads this registry's entries directly, no ctx hook is installed.
      install: () => () => true,
      resolveOwnerId: (callerCtx) => callerIdentityOf(callerCtx),
      logger,
    }),
  }

  const tools = {
    'execute': createBusBackedRegistry({
      ...registryOptions,
      label: 'tools/execute',
      eventName: 'tools/execute',
      classify: classifyExecutionAroundDecision,
      listenerOf: adaptPassthrough,
    }),
    'post-execute': createBusBackedRegistry({
      ...registryOptions,
      label: 'tools/post-execute',
      eventName: 'tools/post-execute',
      classify: classifyPostExecuteDecision,
      listenerOf: adaptPostExecute,
    }),
  }

  const prompts = {
    'system-prompt/assemble': createBusBackedRegistry({
      ...registryOptions,
      label: 'system-prompt/assemble',
      eventName: 'system-prompt/assemble',
      classify: classifyAssemblyDecision,
      listenerOf: adaptAssemble,
    }),
  }

  const events = {
    'fs/write-intent': createBusBackedRegistry({
      ...registryOptions,
      label: 'fs/write-intent',
      eventName: 'fs/write-intent',
      classify: classifyFsIntentDecision,
      denialErrorOf: fsIntentDenialErrorOf,
      listenerOf: adaptFsIntent,
    }),
    'fs/edit-intent': createBusBackedRegistry({
      ...registryOptions,
      label: 'fs/edit-intent',
      eventName: 'fs/edit-intent',
      classify: classifyFsIntentDecision,
      denialErrorOf: fsIntentDenialErrorOf,
      listenerOf: adaptFsIntent,
    }),
    'compaction/request': createBusBackedRegistry({
      ...registryOptions,
      label: 'compaction/request',
      eventName: 'compaction/request',
      classify: classifyCompactionRequestDecision,
      listenerOf: adaptAgentWaterfall,
    }),
    'session-title/candidate': createBusBackedRegistry({
      ...registryOptions,
      label: 'session-title/candidate',
      eventName: 'session-title/candidate',
      classify: classifySessionTitleCandidateDecision,
      listenerOf: adaptAgentWaterfall,
    }),
  }

  return { agents, tools, prompts, events }
}

/** Unified-registry admitted point set (explicit enumeration; increments are explicit spec changes). */
const UNIFIED_ADMITTED_POINTS = Object.freeze([
  'fs/write-intent',
  'fs/edit-intent',
  'compaction/request',
  'session-title/candidate',
])

/** Points whose decision need is already carried by an existing domain face. */
const DIVERTED_POINTS = Object.freeze({
  'tools/pre-execute': 'tools.guard.register carries the pre-execute allow/deny/ask decision algebra',
  'llm/stream': 'llm.adapters decoration and llm.requestTransforms carry stream and request rewriting',
})

/**
 * Build the caller-bound public member for one domain registry group.
 * The member is rebuilt per namespace read so owner derivation always sees
 * the calling plugin's context (the composed namespace view carries no
 * context tracker of its own).
 */
function buildDomainMember({ callerCtx, points, resolveAvailability, defaultPoint }) {
  return Object.freeze({
    register(spec) {
      const point = isPlainRecord(spec) && spec.point !== undefined ? spec.point : defaultPoint
      if (!isNonEmptyString(point) || !Object.hasOwn(points, point)) {
        return unsupportedResult(String(point ?? '(missing point)'), `supported points: ${Object.keys(points).join(', ')}`)
      }
      const availability = resolveAvailability(point)
      if (availability !== true) {
        return unavailableResult(point, availability)
      }
      try {
        return points[point].register(callerCtx, spec)
      } catch (error) {
        if (error instanceof PluginApiError) throw error
        throw new PluginApiError('PLUGIN_API_DECISION_REGISTER_FAILED', `decision point "${point}" registration failed: ${String(error?.message ?? error)}`)
      }
    },
    availability() {
      return Object.freeze({
        status: Object.keys(points).every((point) => resolveAvailability(point) === true) ? 'active' : 'degraded',
      })
    },
  })
}

/** Build the caller-bound `events.decisions` member (typed admission registry). */
function buildEventsMember({ callerCtx, registries, resolvePointAvailability, activeCatalogHas }) {
  return Object.freeze({
    register(name, spec) {
      if (!isNonEmptyString(name)) {
        return unsupportedResult(String(name ?? '(missing name)'), 'the unified registry accepts only enumerated catalog decision points')
      }
      if (!Object.hasOwn(registries.events, name)) {
        if (Object.hasOwn(DIVERTED_POINTS, name)) {
          return unsupportedResult(name, DIVERTED_POINTS[name])
        }
        return unsupportedResult(name, `the admitted point set is ${UNIFIED_ADMITTED_POINTS.join(', ')}`)
      }
      const availability = resolvePointAvailability(name)
      if (availability !== true) {
        return unavailableResult(name, availability)
      }
      try {
        return registries.events[name].register(callerCtx, spec)
      } catch (error) {
        if (error instanceof PluginApiError) throw error
        throw new PluginApiError('PLUGIN_API_DECISION_REGISTER_FAILED', `decision point "${name}" registration failed: ${String(error?.message ?? error)}`)
      }
    },
    admitted() {
      return Object.freeze([...UNIFIED_ADMITTED_POINTS])
    },
    availability() {
      return Object.freeze({
        status: UNIFIED_ADMITTED_POINTS.every((name) => resolvePointAvailability(name) === true) ? 'active' : 'degraded',
      })
    },
  })
}

/**
 * Create the decision participation feature.
 *
 * @param {object} options
 * @param {object} options.ctx - host cordis context
 * @param {object} options.eventsBus - the live facade events bus (carries the
 *   internal registerParticipation substrate)
 * @param {object} options.logger
 * @param {{ runtime: string, api: string }} options.facadeContract
 * @param {{ compactionEvents?: object, sessionTitle?: object, agentLoop?: object }} [options.auxiliaryManifests]
 * @returns {{ disposer: () => void, providers: object, turnStoppingChain: object, contract: object }}
 */
export function createDecisionParticipationFeature({ ctx, eventsBus, logger, facadeContract, auxiliaryManifests } = {}) {
  const busActive = Boolean(eventsBus) && typeof eventsBus.registerParticipation === 'function'
  const bus = busActive ? eventsBus : null
  const activeCatalog = bus ? bus.catalog() : Object.freeze({})
  const activeCatalogHas = (name) => activeCatalog[name] !== undefined

  const compactionSlice = createCompactionEventsCatalogSlice({
    expectedContract: facadeContract,
    auxiliaryManifest: auxiliaryManifests?.compactionEvents,
    logger,
  })
  const sessionTitleSlice = createSessionTitleEventsCatalogSlice({
    expectedContract: facadeContract,
    auxiliaryManifest: auxiliaryManifests?.sessionTitle,
    logger,
  })

  function agentLoopRowActive() {
    try {
      for (const entry of ctx?.loader?.entries?.() ?? []) {
        const options = entry?.options ?? {}
        if (options.name === AGENT_LOOP_REPLACEMENT_NAME && entry.fiber !== undefined && !entry.disabled) return true
      }
    } catch {
      return false
    }
    return false
  }

  const registries = createRegistries({ bus: bus ?? PROBE_ONLY_BUS, logger })

  const turnStoppingChain = createTurnStoppingChain({ registry: registries.agents['turn-stopping'], logger })

  function turnStoppingAvailability() {
    if (!agentLoopRowActive()) return 'the agent-loop replacement row is not active'
    let service
    try {
      service = ctx?.get?.('agentLoop')
    } catch {
      service = undefined
    }
    if (!service) return 'the agent-loop service is not resolvable'
    // Identity proof lives on the service: the replacement row's own apply
    // boot self-check installs the component marker only after its full
    // runtime/contract identity check passed, so the marker is the facade-side
    // evidence that the replacement identity matches.
    try {
      const marker = service[AGENT_LOOP_COMPONENT_SYMBOL]
      if (marker?.package !== AGENT_LOOP_REPLACEMENT_NAME) {
        return 'the agent-loop replacement identity does not match the facade contract'
      }
    } catch {
      return 'the agent-loop replacement identity does not match the facade contract'
    }
    return true
  }

  function resolveAgentPointAvailability(point) {
    if (point === 'turn-stopping') return turnStoppingAvailability()
    if (!busActive) return 'the events bus participation substrate is unavailable'
    return activeCatalogHas(`agent/${point}`) ? true : 'the agent dispatch backing is unavailable'
  }

  const providers = {
    agents: (callerCtx) => buildDomainMember({
      callerCtx,
      points: registries.agents,
      resolveAvailability: resolveAgentPointAvailability,
    }),
    tools: (callerCtx) => buildDomainMember({
      callerCtx,
      points: registries.tools,
      resolveAvailability: (point) => (busActive && activeCatalogHas(`tools/${point}`) ? true : 'the tools dispatch backing is unavailable'),
    }),
    prompts: (callerCtx) => buildDomainMember({
      callerCtx,
      points: registries.prompts,
      resolveAvailability: () => (busActive && activeCatalogHas('system-prompt/assemble') ? true : 'the system-prompt dispatch backing is unavailable'),
      defaultPoint: 'system-prompt/assemble',
    }),
    events: (callerCtx) => buildEventsMember({
      callerCtx,
      registries,
      activeCatalogHas,
      resolvePointAvailability: (name) => {
        if (!busActive) return 'the events bus participation substrate is unavailable'
        if (name === 'compaction/request') {
          return sliceActive(compactionSlice, 'the compaction-events replacement is inactive or version-mismatched')
        }
        if (name === 'session-title/candidate') {
          return sliceActive(sessionTitleSlice, 'the session-title replacement is inactive or version-mismatched')
        }
        return activeCatalogHas(name) ? true : 'the filesystem dispatch backing is unavailable'
      },
    }),
  }

  function sliceActive(slice, reason) {
    try {
      return slice.isActive(ctx) === true ? true : reason
    } catch {
      return reason
    }
  }

  let disposed = false
  const disposer = () => {
    if (disposed) return
    disposed = true
    for (const group of Object.values(registries)) {
      for (const registry of Object.values(group)) {
        try {
          registry.disposeAll()
        } catch {
          // registry teardown never breaks the fail-safe path
        }
      }
    }
  }

  return {
    disposer,
    providers,
    turnStoppingChain,
    contract: Object.freeze({
      contractVersion: TURN_STOPPING_PARTICIPATION_CONTRACT_VERSION,
      symbol: TURN_STOPPING_PARTICIPATION_SYMBOL,
    }),
  }
}

/** Null-object bus used only to keep registry construction shape-safe when the bus is absent. */
const PROBE_ONLY_BUS = Object.freeze({
  registerParticipation() {
    throw new PluginApiError('PLUGIN_API_PARTICIPATION_UNAVAILABLE', 'the events bus participation substrate is unavailable')
  },
})

/**
 * Disabled member providers used before the feature mounts (and after
 * teardown): every namespace keeps its participation member shape, and calls
 * fail with the standard typed disabled error instead of disappearing.
 */
export function createDisabledDecisionProviders() {
  const disabledMember = (feature) => Object.freeze({
    register() {
      throw new PluginApiFeatureDisabledError(feature)
    },
    admitted() {
      return Object.freeze([])
    },
    availability() {
      return Object.freeze({ status: 'unavailable', reason: `the ${feature} backing is disabled` })
    },
  })
  const disabledProviders = {
    agents: () => disabledMember('agents.decisions'),
    tools: () => disabledMember('tools.executionPolicies'),
    prompts: () => disabledMember('prompts.assemblyPolicies'),
    events: () => disabledMember('events.decisions'),
  }
  return disabledProviders
}
