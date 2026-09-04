/**
 * Cordis service that exposes the public `pluginApi` facade.
 *
 * The service is the recommended, supported entry point for third-party
 * plugins. It is a thin state/version facade:
 * - `isActive` reflects the CORE guard result;
 * - `features` reflects the per-feature state registry;
 * - `assertCompatible(requirement, pluginName?)` implements plugin->facade
 *   version negotiation;
 * - feature APIs (currently `llm.admission`) are injected by the host apply
 *   through `mountFeature`. Until mounted, they throw a typed disabled error.
 *
 * Rule: in inactive/disabled states every API method throws BEFORE touching
 * any official service (this module performs no official-service calls at all).
 */
import { Service } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import {
  PluginApiError,
  LlmAdaptersConflictError,
  LlmAdaptersOwnerConflictError,
  LlmAdaptersUnavailableError,
  LlmAdaptersValidationError,
  PluginApiCapabilityUnavailableError,
  PluginApiFeatureDisabledError,
  PluginApiInactiveError,
  PluginApiVersionError,
} from './errors.js'
import { CAPABILITY_DESCRIPTORS, CAPABILITY_PATHS, capabilityDescriptor } from './capability-descriptors.js'
import { capabilityMatrixView } from './capability-matrix.js'
import { createNamespaceAvailability } from './namespace-availability.js'
import { featureFailNotice, writeGuardLog } from './guards.js'
import { createDisabledServicesNamespace } from './services.js'
import { createDisabledHostRemoteApi } from './host-remote.js'
import { createDisabledStorageApi } from './storage-binding.js'
import { createToolAbortedErrorFactory } from './tool-abort.js'
import { satisfiesContract } from './version.js'

export const pluginApiBrand = Symbol.for('@deepseek-ai/dsh-plugin-api/pluginApi')

const require = createRequire(import.meta.url)

let toolsPublicModule
function resolveToolsPublicModule() {
  if (toolsPublicModule !== undefined) return toolsPublicModule
  try {
    toolsPublicModule = require('@deepseek-ai/dsh-tools') ?? null
  } catch {
    toolsPublicModule = null
  }
  return toolsPublicModule
}

const durableEpochRecords = new WeakMap()

function createDisabledAdmissionApi(active) {
  return Object.freeze({
    register() {
      if (!active()) throw new PluginApiInactiveError()
      throw new PluginApiFeatureDisabledError('llm.admissionPolicies')
    },
  })
}

function createDisabledRequestApi(active) {
  return Object.freeze({
    transform() {
      if (!active()) throw new PluginApiInactiveError()
      throw new PluginApiFeatureDisabledError('llm.requestTransforms')
    },
  })
}

function createDisabledLlmApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('llm')
  }
  const disabledNested = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('llm')
  }
  return Object.freeze({
    modelInfo: fail,
    prepareCall: fail,
    stream: fail,
    providers: Object.freeze({ register: disabledNested }),
    models: Object.freeze({ register: disabledNested }),
  })
}

function createDisabledEventsApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('events')
  }
  // The event vocabulary self-description is a side-effect free query: an
  // unavailable bus reports an empty frozen vocabulary instead of throwing or
  // returning undefined. The projection subscription entry stays shape-
  // compatible so callers keep one contract across active and unavailable
  // states.
  const inertDispose = () => false
  return {
    catalog() {
      return Object.freeze({})
    },
    observe() {
      return Object.freeze({
        current: () => null,
        subscribe: () => inertDispose,
        dispose: () => false,
        epoch: 0,
      })
    },
    availability() {
      return Object.freeze({ status: 'unavailable' })
    },
    emit: fail,
    serial: fail,
    parallel: fail,
    bail: fail,
    waterfall: fail,
    define: fail,
  }
}





// context-provenance
function createDisabledContextApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('prompts.provenance')
  }
  const failPolicy = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('prompts.provenance', 'provenance.policy is unavailable')
  }
  return Object.freeze({
    contribute: fail,
    compose: fail,
    inspect: fail,
    mapping: fail,
    observe: fail,
    policy: Object.freeze({ register: failPolicy }),
    availability: fail,
  })
}
// context-provenance

function createDisabledToolsApi(active, discoverySurface) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('tools')
  }
  return {
    register: fail,

    restrict: Object.freeze({ register: fail }),
    guard: Object.freeze({ register: fail }),
    get: fail,
    list: fail,
    execute: fail,
    presentation: Object.freeze({ register: fail }),
    executionMode: Object.freeze({ register: fail }),
    // tool-discovery
    get discovery() {
      return typeof discoverySurface === 'function' ? discoverySurface() : discoverySurface
    },
    // tool-discovery
  }
}

// tool-discovery
function createDisabledToolsDiscoveryApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('tools.discovery')
  }
  return Object.freeze({
    catalog: Object.freeze({ register: fail }),
    list: fail,
    activate: fail,
    deactivate: fail,
    audit: Object.freeze({ list: fail }),
    get availability() {
      fail()
    },
  })
}
// tool-discovery

function createToolsApi(resolveTools, discoverySurface) {
  const tools = () => {
    let service
    try {
      service = resolveTools()
    } catch {
      service = undefined
    }
    if (service == null) {
      throw new PluginApiFeatureDisabledError('tools', 'official tools service is no longer resolvable')
    }
    return service
  }
  return Object.freeze({
    register(definition) {
      return tools().register(definition)
    },
    get(name, scope) {
      return tools().get(name, scope)
    },
    list(scope) {
      const view = tools().schemas(scope)
      return Array.isArray(view) ? Object.freeze(view) : Object.freeze(view ?? {})
    },
    execute(input) {
      return tools().execute(input)
    },
    // Policy and registry registration entries ride the official registration
    // verbs; the official handle identity is preserved.
    //
    restrict: Object.freeze({ register: (filter) => tools().restrict(filter) }),
    guard: Object.freeze({ register: (guard) => tools().guard(guard) }),
    presentation: Object.freeze({ register: (...args) => tools().presentAs(...args) }),
    executionMode: Object.freeze({ register: (exec) => tools().executionMode(exec) }),
    defineTool(options) {
      const module = resolveToolsPublicModule()
      const defineTool = module?.defineTool
      if (typeof defineTool !== 'function') {
        throw new PluginApiFeatureDisabledError('tools', 'official tools defineTool export is unavailable')
      }
      return defineTool(options)
    },
    // tool-discovery
    get discovery() {
      return typeof discoverySurface === 'function' ? discoverySurface() : discoverySurface
    },
    // tool-discovery
  })
}

function createDisabledSystemPromptApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('prompts')
  }
  const failRenderContextSnapshot = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('prompts.renderContextSnapshot')
  }
  const failJoinContextSections = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('prompts.joinContextSections')
  }
  return Object.freeze({
    render: fail,
    renderContextSections: fail,
    renderContextSnapshot: failRenderContextSnapshot,
    joinContextSections: failJoinContextSections,
  })
}


function createDisabledAgentApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('agents')
  }
  const failAgentExtension = (member) => () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('agents', `agents extension member "${member}" is unavailable`)
  }
  return Object.freeze({
    get: fail,
    list: fail,
    roots: fail,
    create: failAgentExtension('create'),
    resume: failAgentExtension('resume'),
    register: failAgentExtension('register'),
    providers: Object.freeze({
      register: failAgentExtension('providers.register'),
    }),
    availability: Object.freeze({
      status: 'unavailable',
      reason: 'official agents service is unavailable',
    }),
  })
}

function createDisabledSessionApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('sessions')
  }
  return Object.freeze({
    // The projection subscription entry stays shape-compatible across
    // active and unavailable states: it returns the inert projection handle.
    observe() {
      return Object.freeze({
        current: () => null,
        subscribe: () => () => false,
        dispose: () => false,
        epoch: 0,
      })
    },
    get: fail,
    list: fail,
    fork: fail,
    // The session-object read accessors live under the views subtree in the
    // active shape too, so the unavailable namespace stays shape-compatible.
    views: Object.freeze({
      header: fail,
      events: fail,
      seq: fail,
      surface: fail,
      requestHeader: fail,
      requestContext: fail,
      deriveMessages: fail,
      isSessionEventType: fail,
      isSurfaceEventType: fail,
      sessionEventTypes: undefined,
      surfaceEventTypes: undefined,
    }),
  })
}

function createDisabledSessionRouteApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('llm.routing')
  }
  return Object.freeze({ current: fail, on: fail, once: fail, wait: fail })
}

function createDisabledDiagnosticsApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('diagnostics')
  }
  return Object.freeze({ register: fail, get: fail, observe: fail })
}

function createDisabledProfileApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('profiles')
  }
  const snapshotFail = (member) => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('profiles', `snapshot.${member} is unavailable`)
  }
  return Object.freeze({
    inspect: fail,
    health: fail,
    planDiff: fail,
    apply: fail,
    snapshot: Object.freeze({
      create: () => snapshotFail('create'),
      modify: () => snapshotFail('modify'),
      validate: () => snapshotFail('validate'),
      delete: () => snapshotFail('delete'),
      apply: () => snapshotFail('apply'),
    }),
  })
}

function createDisabledSessionDurableApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('sessions.durable')
  }
  return {
    isDurableEventType: fail,
    appendMessage: fail,
    durable: Object.freeze({
      list: fail,
      get: fail,
      observe: fail,
      isDurableEventType: fail,
      appendMessage: fail,
    }),
  }
}

// session-branch facade
const SESSION_BRANCH_SURFACE_METHODS = ['create', 'graph', 'plan', 'preview', 'commit', 'rollback', 'restore']

function createDisabledSessionBranchApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('sessions.branches')
  }
  const surface = {}
  for (const name of SESSION_BRANCH_SURFACE_METHODS) surface[name] = fail
  return Object.freeze({
    ...surface,
    availability: () => Object.freeze({ status: 'unavailable' }),
  })
}
// session-branch facade

// skills activation facade
const SKILLS_ACTIVATION_SURFACE_METHODS = ['activate', 'deactivate']

function createDisabledSkillsActivationApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('skills.activation')
  }
  const surface = {}
  for (const name of SKILLS_ACTIVATION_SURFACE_METHODS) surface[name] = fail
  surface.exposure = Object.freeze({ list: fail })
  surface.audit = Object.freeze({ list: fail })
  surface.policy = Object.freeze({ register: fail })
  surface.register = fail
  return Object.freeze({
    ...surface,
    availability: () => Object.freeze({ status: 'unavailable' }),
  })
}
// skills activation facade

function createDisabledExecutionApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('executions')
  }
  return Object.freeze({
    observe: fail,
    get: fail,
    history: fail,
    visibility: Object.freeze({ register: fail }),
    availability: Object.freeze({ sources: Object.freeze({}), epoch: 'none' }),
  })
}

function createDisabledRecoveryApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('executions.recovery')
  }
  return Object.freeze({
    capability: Object.freeze({ register: fail }),
    policy: Object.freeze({ register: fail }),
    evaluate: fail,
    visibility: Object.freeze({ register: fail }),
    get availability() {
      return fail()
    },
  })
}

// security-policy: the inactive/disabled host surface mirrors the active
// shape (policy/redaction/egress registry faces, read-only audit projection,
// availability) so consumer code always receives the same typed contract.
function createDisabledSecurityApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('security')
  }
  return Object.freeze({
    policy: Object.freeze({ register: fail }),
    redaction: Object.freeze({ register: fail }),
    egress: Object.freeze({
      register: fail,
      lease: Object.freeze({ acquire: fail }),
    }),
    audit: Object.freeze({ list: fail }),
    get availability() {
      return fail()
    },
  })
}

function createDisabledSessionChannelApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('sessions.channels')
  }
  return Object.freeze({
    acquire: fail,
    list: fail,
    heartbeat: fail,
    ack: fail,
    resume: fail,
    release: fail,
    observe: fail,
    auth: Object.freeze({
      register: fail,
      initiatePairing: fail,
      approvePairing: fail,
      rejectPairing: fail,
      pairingProvider: Object.freeze({ register: fail }),
    }),
    redaction: Object.freeze({ register: fail }),
  })
}
function createDisabledCoordinationApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('coordination')
  }
  return Object.freeze({
    availability: fail,
    acquire: fail,
    heartbeat: fail,
    release: fail,
    takeover: fail,
    compareAndSet: fail,
    observe: fail,
  })
}

function createDisabledWorkspaceTransactionsApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('workspaces.transactions')
  }
  return Object.freeze({
    prepare: fail,
    record: fail,
    preview: fail,
    commit: fail,
    rollback: fail,
    recover: fail,
    get: fail,
    observe: fail,
  })
}

function createDisabledTasksApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('tasks')
  }
  return Object.freeze({
    register: fail,
    start: fail,
    acquire: fail,
    takeover: fail,
    settle: fail,
    attach: fail,
    get: fail,
    observe: fail,
    history: fail,
  })
}

function createDisabledRoutePolicyApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('llm.routing')
  }
  return Object.freeze({
    policies: Object.freeze({ register: fail }),
    candidates: Object.freeze({ register: fail, list: fail }),
    health: Object.freeze({
      observe: fail,
      circuitPolicy: Object.freeze({ register: fail }),
      probe: Object.freeze({ register: fail }),
      get: fail,
      history: fail,
    }),
    circuit: Object.freeze({ inspect: fail }),
    observe: fail,
    decisions: Object.freeze({ get: fail, history: fail }),
    availability: fail,
  })
}

function createConditionalRoutePolicySurface(active, provider) {
  const owner = () => {
    if (!active()) throw new PluginApiInactiveError()
    let value
    try {
      value = provider?.()
    } catch {
      value = undefined
    }
    if (!value || typeof value !== 'object') throw new PluginApiFeatureDisabledError('llm.routing', 'agent-loop replacement is not active')
    return value
  }
  const invoke = (path, method) => (...args) => {
    const value = owner()
    const target = value?.[path]
    if (!target || typeof target[method] !== 'function') throw new PluginApiFeatureDisabledError('llm.routing', `route policy member "${path}.${method}" is unavailable`)
    return Reflect.apply(target[method], target, args)
  }
  // The owner's `policy` registry is published as the plural `policies` leaf
  // per the fixed public shape; `candidates`/`health`/`circuit`/`decisions`
  // keep their names.
  const policies = Object.freeze({ register: invoke('policy', 'register') })
  const candidates = Object.freeze({
    register: invoke('candidates', 'register'),
    list: invoke('candidates', 'list'),
  })
  const health = Object.freeze({
    observe: invoke('health', 'observe'),
    registerCircuitPolicy: invoke('health', 'registerCircuitPolicy'),
    circuitPolicy: Object.freeze({ register: invoke('health', 'registerCircuitPolicy') }),
    registerProbe: invoke('health', 'registerProbe'),
    probe: Object.freeze({ register: invoke('health', 'registerProbe') }),
    startProbe: invoke('health', 'startProbe'),
    completeProbe: invoke('health', 'completeProbe'),
    get: invoke('health', 'get'),
    history: invoke('health', 'history'),
  })
  const circuit = Object.freeze({ status: invoke('circuit', 'status') })
  const decisions = Object.freeze({
    get: invoke('decisions', 'get'),
    history: invoke('decisions', 'history'),
  })
  return Object.freeze({
    policies,
    candidates,
    health,
    circuit,
    decisions,
    availability: (...args) => {
      const value = owner()
      if (typeof value.availability !== 'function') throw new PluginApiFeatureDisabledError('llm.routing')
      return value.availability(...args)
    },
  })
}

/**
 * Fixed conditional `mcp` namespace: the facade never owns an MCP catalog or
 * its lifecycle state. It projects the replacement-owned `ctx.mcpCatalog`
 * read-only face only while that replacement's component marker is active on
 * the root context, and it resolves the catalog lazily at every call because
 * the facade mounts before the replacement row applies. When the replacement
 * is not active the face fails with the standard typed disabled error;
 * construction and catalog resolution never throw through boot.
 */
function createConditionalMcpSurface(active, catalogProvider) {
  const currentCatalog = () => {
    try {
      return catalogProvider()
    } catch {
      return null
    }
  }
  const withCatalog = (method) => (...args) => {
    if (!active()) throw new PluginApiInactiveError()
    const catalog = currentCatalog()
    if (!catalog || typeof catalog[method] !== 'function') {
      throw new PluginApiFeatureDisabledError('mcp', 'MCP replacement is not active')
    }
    return catalog[method](...args)
  }
  return Object.freeze({
    servers: withCatalog('servers'),
    tools: withCatalog('tools'),
    resolvePublicName: withCatalog('resolvePublicName'),
    observe: withCatalog('onChange'),
  })
}

const ATTACHMENT_UNAVAILABLE = Object.freeze({
  status: 'unavailable',
  commitState: 'error',
  error: Object.freeze({
    code: 'ATTACHMENT_PIPELINE_UNAVAILABLE',
    message: 'attachment pipeline capability is unavailable',
  }),
})

/** The facade's own package identity must never be attributed as a decoration owner. */
const FACADE_OWNER_IDS = new Set(['@deepseek-ai/dsh-plugin-api-main', 'plugin-api-main'])

/**
 * Derive the calling plugin's owner identity from the caller's shadowed
 * context (fiber → loader entry row name/id). Unresolvable or facade-owned
 * identities return undefined; the facade never attributes decorations to
 * itself.
 */
function deriveLlmAdaptersOwner(callerCtx) {
  try {
    if (callerCtx && typeof callerCtx === 'object') {
      const fiber = callerCtx.fiber ?? callerCtx.ctx?.fiber
      const loader = callerCtx.loader ?? callerCtx.ctx?.loader
      if (typeof loader?.entries === 'function') {
        for (const entry of loader.entries()) {
          if (entry?.fiber === fiber) {
            const name = entry?.options?.name
            if (typeof name === 'string' && name.length > 0) return name
            const id = entry?.options?.id ?? entry?.id
            if (typeof id === 'string' && id.length > 0) return id
          }
        }
      }
      if (fiber && typeof fiber.name === 'string' && fiber.name.length > 0) return fiber.name
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Conditional `llm.adapters` face: the member always exists inside the `llm`
 * namespace, but `decorate`/`snapshot` throw the standard typed errors until
 * the replacement's decoration facet is resolved and the registry key is
 * active. The caller owner is derived per invocation from the caller's
 * shadowed context (never from caller-supplied strings); the facade never
 * holds a second decoration registry.
 *
 * Replacement-side typed results are normalized into facade typed errors:
 * validation / conflict / unavailable / owner-conflict.
 */
function createConditionalLlmAdaptersSurface(active, provider, registryGate) {
  const currentFacet = () => {
    try {
      return provider()
    } catch {
      return null
    }
  }
  const gates = () => {
    if (!active()) throw new PluginApiInactiveError()
    if (typeof registryGate === 'function' && !registryGate()) {
      throw new PluginApiFeatureDisabledError('llm.adapters', 'adapter decoration is not active')
    }
    const facet = currentFacet()
    if (!facet || typeof facet.decorate !== 'function') {
      throw new PluginApiFeatureDisabledError('llm.adapters', 'adapter decoration replacement is not active')
    }
    return facet
  }
  const toFacadeError = (outcome) => {
    const reason = typeof outcome?.reason === 'string' && outcome.reason.length > 0 ? outcome.reason : 'registration failed'
    switch (outcome?.status) {
      case 'validation':
        return new LlmAdaptersValidationError(reason)
      case 'conflict':
        return new LlmAdaptersConflictError(reason)
      case 'owner-conflict':
        return new LlmAdaptersOwnerConflictError(reason)
      default:
        return new LlmAdaptersUnavailableError(reason)
    }
  }
  const buildHandle = (facet, record, callerCtx) => {
    let teardown = false
    try {
      if (typeof callerCtx?.effect === 'function') {
        callerCtx.effect(() => () => {
          try {
            facet.dispose(record.ownerIdentity, record.id, record.generation)
          } catch {
            // identity-bound disposal must never throw through teardown
          }
        })
        teardown = true
      }
    } catch {
      teardown = false
    }
    if (!teardown) throw new LlmAdaptersUnavailableError('caller fiber teardown is unavailable')
    return Object.freeze({
      dispose() {
        try {
          return facet.dispose(record.ownerIdentity, record.id, record.generation)
        } catch {
          return { status: 'unavailable', reason: 'decoration handle disposal failed' }
        }
      },
      snapshot() {
        try {
          const outcome = facet.snapshotOf(record.ownerIdentity, record.id, record.generation)
          return outcome?.status === 'ok' ? outcome.snapshot : undefined
        } catch {
          return undefined
        }
      },
    })
  }
  return Object.freeze({
    register(definition, callerCtx) {
      const facet = gates()
      const owner = deriveLlmAdaptersOwner(callerCtx)
      if (owner === undefined || FACADE_OWNER_IDS.has(owner)) {
        throw new LlmAdaptersUnavailableError('decoration owner is unavailable')
      }
      const outcome = facet.decorate(definition, owner)
      if (outcome?.status === 'ok' && outcome.record) {
        return buildHandle(facet, outcome.record, callerCtx)
      }
      throw toFacadeError(outcome)
    },
    list() {
      const facet = gates()
      const snapshot = facet.snapshot()
      return Array.isArray(snapshot) ? Object.freeze(snapshot) : Object.freeze(snapshot ?? {})
    },
  })
}

function createConditionalAttachmentsSurface(active, pipelineProvider) {
  const currentPipeline = () => {
    try {
      const value = pipelineProvider?.()
      return value?.pipeline && value?.projection ? value : null
    } catch {
      return null
    }
  }
  const invoke = (owner, method, args) => {
    if (!active()) return ATTACHMENT_UNAVAILABLE
    const pipeline = currentPipeline()
    const target = pipeline?.[owner]
    if (!target || typeof target[method] !== 'function') return ATTACHMENT_UNAVAILABLE
    try {
      const result = Reflect.apply(target[method], target, args)
      if (result && typeof result.then === 'function') {
        return result.catch(() => ATTACHMENT_UNAVAILABLE)
      }
      return result
    } catch {
      return ATTACHMENT_UNAVAILABLE
    }
  }
  const pipeline = Object.freeze({
    ingest: (...args) => invoke('pipeline', 'ingest', args),
    transform: (...args) => invoke('pipeline', 'transform', args),
    transforms: Object.freeze({ register: (...args) => invoke('pipeline', 'registerTransform', args) }),
    cleanup: (...args) => invoke('pipeline', 'cleanup', args),
    capabilities: (...args) => invoke('pipeline', 'capabilities', args),
  })
  const projection = Object.freeze({
    get: (...args) => invoke('projection', 'resolve', args),
    open: (...args) => invoke('projection', 'open', args),
    project: (...args) => invoke('projection', 'project', args),
    provenance: (...args) => invoke('projection', 'provenance', args),
    availability: (...args) => invoke('projection', 'availability', args),
  })
  return Object.freeze({
    pipeline,
    projection,
    availability: (...args) => invoke('projection', 'availability', args),
  })
}

function createActiveSessionDurableApi({ availability, epoch, facade }) {
  const assertAvailable = () => {
    const { active, registry } = availability()
    if (!active) throw new PluginApiInactiveError()
    if (!epoch.current || !registry?.isActive?.('sessionDurable')) {
      throw new PluginApiFeatureDisabledError('sessions.durable')
    }
  }
  const api = {
    // The nested durable namespace carries the target projection shapes:
    // list merges the type and descriptor catalogs, get resolves one
    // descriptor, observe is the merged subscription entry.
    durable: Object.freeze({
      list() {
        assertAvailable()
        const view = typeof facade.list === 'function' ? facade.list() : facade.durableEventTypes
        return Array.isArray(view) ? Object.freeze(view) : Object.freeze(view ?? {})
      },
      get(type) {
        assertAvailable()
        return facade.getDurableEventDescriptor(type)
      },
      observe(targetSession, kind, listener) {
        assertAvailable()
        return Reflect.apply(facade.onDurable, facade, [targetSession, kind, listener])
      },
      isDurableEventType(type) {
        assertAvailable()
        return facade.isDurableEventType(type)
      },
      appendMessage(targetSession, kind, payload, options) {
        assertAvailable()
        return Reflect.apply(facade.appendMessage, facade, [targetSession, kind, payload, options])
      },
    }),
  }
  return api
}

// session-branch facade
function composeSessionApi(baseSessionApi, durableSessionApi, branchesApi, channelsApi) {
  return Object.freeze(Object.defineProperties(
    Object.create(Object.getPrototypeOf(baseSessionApi) ?? Object.prototype),
    {
      ...Object.getOwnPropertyDescriptors(baseSessionApi),
      ...Object.getOwnPropertyDescriptors(durableSessionApi),
      ...(branchesApi === undefined ? {} : Object.getOwnPropertyDescriptors({ branches: branchesApi })),
      // sessionChannel facade
      ...(channelsApi === undefined ? {} : Object.getOwnPropertyDescriptors({ channels: channelsApi })),
      // sessionChannel facade
    },
  ))
}
// session-branch facade

function createDisabledSettingsApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('settings')
  }
  return Object.freeze({
    register: fail,
    scope: fail,
    inspect: fail,
  })
}

function createDisabledSettingsRemoteApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('settingsRemote')
  }
  return Object.freeze({ remote: fail, dispose() {} })
}


const CONTRIBUTION_KINDS = Object.freeze({
  section: { member: 'section', args: (spec) => [spec.section ?? spec] },
  context: { member: 'context', args: (spec) => [spec.context ?? spec] },
  variable: { member: 'variable', args: (spec) => [spec.name, spec.provider] },
  tools: { member: 'tools', args: (spec) => [spec.provider ?? spec] },
  suppressRuntimeContext: { member: 'suppressRuntimeContext', args: () => [] },
})

/**
 * Merged contribution entry (contribution idiom): one contribute(spec) over
 * several reversible assembly inputs. Returns a frozen discriminated result
 * with a handle { id, ownerId, seq, dispose() }; the same id stays rejected
 * with `conflict` while the earlier contribution is active, disposal is
 * idempotent, and the underlying disposer is never leaked.
 */
function createContributeEntry(getBase, resolveOwnerId = (spec) => spec?.ownerId ?? 'caller', backingStatus = () => 'active') {
  let sequence = 0
  let anonSeq = 0
  const activeByOwner = new Map()
  return (spec) => {
    if (!spec || typeof spec !== 'object' || typeof spec.kind !== 'string') {
      return Object.freeze({ ok: false, code: 'invalid-input', reason: 'prompts.contribute requires a kind and a spec' })
    }
    const route = CONTRIBUTION_KINDS[spec.kind]
    const base = getBase()
    if (!route || typeof base?.[route.member] !== 'function') {
      // A live backing without the declared member is unsupported; a
      // disabled backing reports the typed unavailable failure shape
      // (contribution never throws through the caller). The backing state is
      // read from the namespace availability probe, not from a member-level
      // flag on the backing surface.
      const backingDisabled = backingStatus() === 'unavailable'
      return Object.freeze({
        ok: false,
        code: backingDisabled ? 'unavailable' : 'unsupported',
        reason: backingDisabled
          ? 'prompts.contribute is unavailable: the system-prompt backing is disabled'
          : `prompts.contribute kind "${spec.kind}" is unsupported`,
      })
    }
    const id = spec.id ?? spec.name ?? spec.section?.id ?? `anonymous:${++anonSeq}`
    const ownerId = resolveOwnerId(spec)
    let byOwner = activeByOwner.get(ownerId)
    if (byOwner?.has(id)) {
      return Object.freeze({ ok: false, code: 'conflict', reason: `a contribution with id "${id}" is already active for owner "${ownerId}"` })
    }
    if (!byOwner) {
      byOwner = new Map()
      activeByOwner.set(ownerId, byOwner)
    }
    let disposer
    try {
      disposer = route.member === 'suppressRuntimeContext'
        ? base[route.member]()
        : Reflect.apply(base[route.member], base, route.args(spec))
    } catch (error) {
      return Object.freeze({ ok: false, code: 'error', reason: String(error?.message ?? error) })
    }
    const seq = ++sequence
    let disposed = false
    const handle = Object.freeze({
      id,
      ownerId,
      seq,
      dispose() {
        if (disposed) return false
        disposed = true
        byOwner.delete(id)
        if (byOwner.size === 0) activeByOwner.delete(ownerId)
        try {
          if (typeof disposer === 'function') disposer()
        } catch {
          // disposal must never throw through the caller
        }
        return true
      },
    })
    byOwner.set(id, handle)
    return Object.freeze({ ok: true, code: 'contributed', handle })
  }
}

function composeSurface(base, additions = {}) {
  return Object.freeze(Object.defineProperties(
    Object.create(Object.getPrototypeOf(base) ?? Object.prototype),
    { ...Object.getOwnPropertyDescriptors(base), ...Object.getOwnPropertyDescriptors(additions) },
  ))
}

/**
 * Build the frozen `capabilities` query surface.
 *
 * The surface reads registry-backed capability descriptors (see
 * `lib/capability-descriptors.js`, which mirrors the public contract registry)
 * and reports the current availability of each capability as one of
 * `active | degraded | unavailable`. It exposes no internal mounter snapshots,
 * package names, replacement rows, or writable registry objects.
 */
function createCapabilitiesApi({ active, resolveFeatureStatus }) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const statusOf = (capability) => {
    if (!isActive()) throw new PluginApiInactiveError()
    const descriptor = capabilityDescriptor(capability)
    if (!descriptor) {
      throw new PluginApiCapabilityUnavailableError(capability, { reason: 'unknown capability' })
    }
    const statuses = descriptor.features.map((feature) => {
      try {
        return resolveFeatureStatus(feature) === true
      } catch {
        return false
      }
    })
    const activeCount = statuses.filter(Boolean).length
    if (activeCount === statuses.length) return 'active'
    if (activeCount === 0) return 'unavailable'
    return 'degraded'
  }
  return Object.freeze({
    get: (capability) => Object.freeze({ capability, status: statusOf(capability) }),
    list: ({ prefix } = {}) => {
      if (!isActive()) throw new PluginApiInactiveError()
      return Object.freeze(
        CAPABILITY_PATHS.filter((path) => prefix === undefined || path.startsWith(prefix)),
      )
    },
    require: (capabilities = []) => {
      const missing = []
      for (const capability of capabilities) {
        if (statusOf(capability) === 'unavailable') missing.push(capability)
      }
      if (missing.length > 0) {
        throw new PluginApiCapabilityUnavailableError(missing[0], { reason: `required capabilities unavailable: ${missing.join(', ')}` })
      }
      return true
    },
  })
}

function createFeatureSlot({ active, feature, api, methods, isCurrent }) {
  const record = { current: true, api: null, surface: null }
  const assertAvailable = () => {
    if (!active()) throw new PluginApiInactiveError()
    if (!record.current || isCurrent() !== record) throw new PluginApiFeatureDisabledError(feature)
  }
  const surface = {}
  for (const name of methods) {
    surface[name] = (...args) => {
      assertAvailable()
      return Reflect.apply(api[name], api, args)
    }
  }
  record.api = api
  record.surface = Object.freeze(surface)
  return record
}

function createOfficialPassthroughSlot({ active, api, isCurrent }) {
  const record = { current: true, api: null, surface: null }
  const surface = {}
  for (const surfaceKey of ['systemPrompt.renderContextSnapshot', 'systemPrompt.joinContextSections']) {
    const member = surfaceKey.slice(surfaceKey.indexOf('.') + 1)
    surface[member] = (...args) => {
      if (!active()) throw new PluginApiInactiveError()
      if (!record.current || isCurrent() !== record) {
        throw new PluginApiFeatureDisabledError(surfaceKey)
      }
      return Reflect.apply(api[member], api, args)
    }
  }
  record.api = api
  record.surface = Object.freeze(surface)
  return record
}

/**
 * @param {object} options
 * @param {string} options.apiVersion  facade API contract (major.minor)
 * @param {object} options.registry  feature state registry
 * @param {boolean | (() => boolean)} options.coreActive
 */
export function createPluginApiService({ apiVersion, registry, coreActive = false, logWriter = writeGuardLog, featureNotice = featureFailNotice, toolAbortedErrorFactory, mcpCatalogProvider = null, attachmentsProvider = null, routePolicyProvider = null } = {}) {
  const active = typeof coreActive === 'function' ? coreActive : () => Boolean(coreActive)

  return class PluginApiService extends Service {
    static inject = []

    constructor(ctx, config) {
      super(ctx, 'pluginApi')
      this[pluginApiBrand] = true
      this.apiVersion = apiVersion
      this._active = active
      this._registry = registry
      this._mountedFeatures = new Set()
      // Stable "tool call aborted" factory (decided once at first apply,
      // persists via the reused service instance). Default is fail-safe
      // degraded so construction can never throw.
      this._toolAbortedErrorFactory = typeof toolAbortedErrorFactory === 'function'
        ? toolAbortedErrorFactory
        : createToolAbortedErrorFactory({})
      this._execRouteDisabled = (exec) => {
        if (!this._active()) throw new PluginApiInactiveError()
        throw new PluginApiFeatureDisabledError('llm.routing')
      }
      this._execRouteDelegate = this._execRouteDisabled
      this._execRouteToken = null
      this._execRouteDiagnostics = new Set()
      this._sessionRouteSlot = null
      this._diagnosticsSlot = null
      this._diagnosticsSurface = createDisabledDiagnosticsApi(active)
      this._routingSurface = null
      this._llmBaseApi = createDisabledLlmApi(active)
      this._llmRequestSlot = null
      this._llmAdmissionSlot = null
      this._llmAdaptersProvider = null
      this._llmAdaptersSurface = createConditionalLlmAdaptersSurface(
        active,
        () => (typeof this._llmAdaptersProvider === 'function' ? this._llmAdaptersProvider() : null),
        () => this._registry?.isActive?.('llmAdapters') === true,
      )
      this._installLlmSlot('llm/request', createDisabledRequestApi(active))
      this._installLlmSlot('llm/admission', createDisabledAdmissionApi(active))
      this._buildLlmLeaves()
      Object.defineProperty(this, 'llm', {
        enumerable: true,
        configurable: false,
        get() {
          // agent-style caller capture: `this` is the caller's (shadowed)
          // context, so `this.ctx` carries the caller fiber identity used to
          // mint the decoration owner binding.
          const callerCtx = this?.ctx ?? this
          const adapters = this._llmAdaptersForCaller(callerCtx)
          const base = this._llmBaseApi
          return this._decoratedNamespaces(['llm', 'llm.routing'], composeSurface(base, {
            admissionPolicies: this._admissionPoliciesSurface,
            requestTransforms: this._requestTransformsSurface,
            adapters,
            routing: this._routingSurface,
          }))
        },
      })
      this._eventsSurface = createDisabledEventsApi(active)
      Object.defineProperty(this, 'events', {
        enumerable: true,
        configurable: false,
        get: () => this._decoratedNamespaces(['events'], this._eventsSurface),
      })

      this._executionSlot = null
      this._executionSurface = createDisabledExecutionApi(active)
      Object.defineProperty(this, 'executions', {
        enumerable: true,
        configurable: false,
        get: () => {
          const executions = this._executionSlot ? this._executionSlot.surface : this._executionSurface
          return this._decoratedNamespaces(['executions', 'executions.recovery'], composeSurface(executions, {
            recovery: this._recoverySlot ? this._recoverySlot.surface : this._recoverySurface,
          }))
        },
      })

      this._recoverySlot = null
      this._recoverySurface = createDisabledRecoveryApi(active)

      this._coordinationSlot = null
      this._coordinationSurface = createDisabledCoordinationApi(active)
      Object.defineProperty(this, 'coordination', {
        enumerable: true,
        configurable: false,
        get: () => this._decoratedNamespaces(['coordination'], this._coordinationSlot ? this._coordinationSlot.surface : this._coordinationSurface),
      })

      this._storageSlot = null
      this._storageSurface = createDisabledStorageApi(active)
      Object.defineProperty(this, 'storage', {
        enumerable: true,
        configurable: false,
        get: () => this._decoratedNamespaces(['storage'], this._storageSlot ? this._storageSlot.surface : this._storageSurface),
      })

      this._workspaceTransactionsSlot = null
      this._workspaceTransactionsSurface = createDisabledWorkspaceTransactionsApi(active)
      Object.defineProperty(this, 'workspaces', {
        enumerable: true,
        configurable: false,
        get: () => this._decoratedNamespaces(['workspaces'], Object.freeze({
          transactions: this._workspaceTransactionsSlot
            ? this._workspaceTransactionsSlot.surface
            : this._workspaceTransactionsSurface,
        })),
      })

      this._tasksSlot = null
      this._tasksSurface = createDisabledTasksApi(active)
      Object.defineProperty(this, 'tasks', {
        enumerable: true,
        configurable: false,
        get: () => this._decoratedNamespaces(['tasks'], this._tasksSlot ? this._tasksSlot.surface : this._tasksSurface),
      })

      // profiles: two owners under one namespace (inspection slot + lazy
      // mutation provider). The published surface always exposes the stable
      // member shape; a missing mutation provider leaves mutation members
      // typed-disabled until the mutation owner mounts.
      this._profileSlot = null
      this._profileMutationProvider = null
      this._profileSurface = createDisabledProfileApi(active)
      Object.defineProperty(this, 'profiles', {
        enumerable: true,
        configurable: false,
        get() {
          // agent-style caller capture: `this` is the caller's (shadowed)
          // context, so `this.ctx` carries the caller fiber identity used to
          // mint the owner binding.
          const callerCtx = this?.ctx ?? this
          const base = this._profileSurface
          const provider = this._profileMutationProvider
          let mutation = null
          if (typeof provider === 'function') {
            try {
              mutation = provider(callerCtx)
            } catch {
              mutation = null
            }
          }
          if (!mutation || typeof mutation.apply !== 'function' || !mutation.snapshot) {
            return this._decoratedNamespaces(['profiles'], base)
          }
          return this._decoratedNamespaces(['profiles'], composeSurface(base, { apply: mutation.apply, snapshot: mutation.snapshot }))
        },
      })

      // security-policy: disabled-by-default host surface (policy/redaction/
      // egress registries, read-only audit, availability); slot mounts on
      // feature activation through _assignFeature.
      this._securitySlot = null
      this._securitySurface = createDisabledSecurityApi(active)
      Object.defineProperty(this, 'security', {
        enumerable: true,
        configurable: false,
        get: () => this._decoratedNamespaces(['security'], this._securitySlot ? this._securitySlot.surface : this._securitySurface),
      })

      // context-provenance lives under prompts.provenance
      this._contextSlot = null
      this._contextSurface = createDisabledContextApi(active)
      // context-provenance

      this._mcpCatalogProvider = typeof mcpCatalogProvider === 'function' ? mcpCatalogProvider : () => null
      this._mcpSurface = createConditionalMcpSurface(active, () => this._mcpCatalogProvider())
      Object.defineProperty(this, 'mcp', {
        enumerable: true,
        configurable: false,
        get: () => this._decoratedNamespaces(['mcp'], this._mcpSurface),
      })

      this._attachmentsProvider = typeof attachmentsProvider === 'function' ? attachmentsProvider : () => null
      this._attachmentsSurface = createConditionalAttachmentsSurface(active, () => this._attachmentsProvider())
      this._routePolicyProvider = typeof routePolicyProvider === 'function' ? routePolicyProvider : () => null
      this._routePolicySurface = createConditionalRoutePolicySurface(active, () => this._routePolicyProvider())



      this._toolsMounted = false
      // tool-discovery
      this._toolsDiscoverySlot = null
      this._toolsDiscoverySurface = createDisabledToolsDiscoveryApi(active)
      // tool-discovery
      this._toolsDisabled = createDisabledToolsApi(active, () => this._toolsDiscoverySurface)
      Object.defineProperty(this, 'tools', {
        enumerable: true,
        configurable: false,
        get() {
          if (!this._toolsMounted) {
            return this._decoratedNamespaces(['tools', 'tools.discovery'], this._toolsDisabled)
          }
          // Official tools methods retain caller-fiber resolution at invocation.
          return this._decoratedNamespaces(['tools', 'tools.discovery'], createToolsApi(
            () => (typeof this.ctx?.get === 'function' ? this.ctx.get('tools') : undefined),
            // tool-discovery
            () => this._toolsDiscoverySurface,
            // tool-discovery
          ))
        },
      })
      this._agentFactory = () => createDisabledAgentApi(active)
      this._agentToken = null
      this._agentExtensions = new Map()
      Object.defineProperty(this, 'agents', {
        enumerable: true,
        configurable: false,
        get() {
          let view = this._agentFactory(this.ctx)
          for (const extension of this._agentExtensions.values()) {
            view = extension(this.ctx, view)
          }
          return this._decoratedNamespaces(['agents'], composeSurface(view))
        },
      })
      this._baseSessionApi = createDisabledSessionApi(active)
      this._durableEpoch = null
      this._durableEpochSequence = 0
      this._durableSessionApi = createDisabledSessionDurableApi(() => this._active())
      // session-branch facade
      this._sessionBranchSlot = null
      this._sessionBranchSurface = createDisabledSessionBranchApi(() => this._active())
      // session-branch facade
      // sessionChannel facade
      this._sessionChannelSlot = null
      this._sessionChannelSurface = createDisabledSessionChannelApi(() => this._active())
      // sessionChannel facade
      this._sessionSurface = null
      Object.defineProperty(this, 'sessions', {
        enumerable: true,
        configurable: false,
        get: () => this._decoratedNamespaces(['sessions', 'sessions.branches', 'sessions.channels', 'sessions.views'], this._sessionSurface),
      })
      // skills activation facade
      this._skillsActivationSlot = null
      this._skillsActivationSurface = createDisabledSkillsActivationApi(() => this._active())
      this._skillsSurface = null
      Object.defineProperty(this, 'skills', {
        enumerable: true,
        configurable: false,
        get: () => this._decoratedNamespaces(['skills', 'skills.activation'], this._skillsSurface),
      })
      this._publishSkillsApi()
      // skills activation facade
      this._publishSessionApi()
      this._publishRoutingSurface()
      this._systemPromptBaseSurface = createDisabledSystemPromptApi(active)
      this._systemPromptSurface = this._systemPromptBaseSurface
      this._promptsSurfaceCache = new Map()
      this._officialPassthroughSlot = null
      this._settingsBaseSurface = createDisabledSettingsApi(active)
      this._settingsRemoteSurface = createDisabledSettingsRemoteApi(active)
      this._publishSettingsSurface()
      this._remoteSurface = createDisabledHostRemoteApi(active)
      this._servicesBaseSurface = createDisabledServicesNamespace(active)
      this._typertSurface = undefined
      this._servicesSurface = this._servicesBaseSurface
      const resolveFeatureStatus = (feature) => {
        if (feature === 'core') return true
        if (feature === 'attachments') return Boolean(this._attachmentsProvider?.())
        if (feature === 'mcp') return Boolean(this._mcpCatalogProvider?.())
        if (feature === 'routePolicy') return Boolean(this._routePolicyProvider?.())
        if (feature === 'llmAdapters') return Boolean(this._llmAdaptersProvider?.())
        return (this._registry?.isActive?.(feature) === true) || this._mountedFeatures.has(feature)
      }
      this._capabilitiesSurface = createCapabilitiesApi({
        active,
        resolveFeatureStatus,
      })
      this._namespaceAvailability = createNamespaceAvailability({ resolveFeatureStatus })
      this._resolveFeatureStatus = resolveFeatureStatus
      this._namespaceDecorateCache = new WeakMap()
      Object.defineProperties(this, {
        prompts: { enumerable: true, configurable: false, get() { return this._decoratedNamespaces(['prompts', 'prompts.provenance'], this._promptsSurface()) } },
        settings: { enumerable: true, configurable: false, get: () => this._decoratedNamespaces(['settings'], this._settingsSurface) },
        services: { enumerable: true, configurable: false, get: () => this._servicesSurface },
        remotes: { enumerable: true, configurable: false, get: () => this._decoratedNamespaces(['remotes'], this._remoteSurface) },
        diagnostics: { enumerable: true, configurable: false, get: () => this._decoratedNamespaces(['diagnostics'], this._diagnosticsSurface) },
        attachments: { enumerable: true, configurable: false, get: () => this._decoratedNamespaces(['attachments', 'attachments.projection'], this._attachmentsSurface) },
        capabilities: { enumerable: true, configurable: false, get: () => this._capabilitiesSurface },
      })
    }

    get isActive() {
      return this._active()
    }

    /**
     * Reconcile a reused service instance during idempotent re-apply: point it
     * at the current feature registry and core-active state.
     */
    reconcile({ registry, coreActive } = {}) {
      if (registry) this._registry = registry
      this._active = typeof coreActive === 'function' ? coreActive : () => Boolean(coreActive)
    }

    /**
     * Plugin -> facade version negotiation. Throws when core is inert or when
     * the running facade does not satisfy the plugin's declared requirement.
     */
    assertCompatible(requirement, pluginName) {
      if (!this.isActive) {
        throw new PluginApiInactiveError()
      }
      if (!satisfiesContract(requirement, this.apiVersion)) {
        throw new PluginApiVersionError({
          declared: this.apiVersion,
          required: requirement,
          pluginName,
        })
      }
      return true
    }

    /**
     * Frozen conservation view of the public capability matrix: one row per
     * capability cluster with its conservation status, qualifiers,
     * replacement and gap reason. Kept separate from the `capabilities`
     * query (which reports current presence as active/degraded/unavailable)
     * and from namespace availability.
     */
    capabilityMatrix() {
      return capabilityMatrixView()
    }

    /** Internal once-only diagnostic for exec route failures (not public API). */
    _reportExecRouteDiagnosticsOnce(phase, category, problems) {
      const key = `${phase}:${category}`
      if (this._execRouteDiagnostics.has(key)) return false
      this._execRouteDiagnostics.add(key)
      let logPath = null
      try {
        logPath = logWriter(problems)
      } catch {
        // feature-disabled diagnostic failures must remain inert.
      }
      try {
        this.ctx?.logger?.error?.(featureNotice('execRoute', logPath))
      } catch {
        // feature-disabled diagnostic failures must remain inert.
      }
      return true
    }

    _publishSessionApi() {
      this._sessionSurface = composeSessionApi(this._baseSessionApi, this._durableSessionApi, this._sessionBranchSurface, this._sessionChannelSurface)
    }

    // skills activation facade
    _publishSkillsApi() {
      this._skillsSurface = Object.freeze({ activation: this._skillsActivationSurface })
    }
    // skills activation facade

    _publishSettingsSurface() {
      const settingsRemote = this._settingsRemoteSurface
      this._settingsSurface = composeSurface(this._settingsBaseSurface, {
        remote: Object.freeze({ contribute: settingsRemote.contribute ?? settingsRemote.remote }),
        inspect: (...args) => {
          const base = this._settingsBaseSurface
          if (!base || typeof base.inspect !== 'function') {
            throw new PluginApiFeatureDisabledError('settings', 'settings owner is unavailable')
          }
          const view = Reflect.apply(base.inspect, base, args)
          return Array.isArray(view) ? Object.freeze(view) : Object.freeze(view ?? {})
        },
      })
    }

    _promptsSurface() {
      // `prompts` is the merged prompt plane: the system-prompt base plus
      // provenance (context) projection/contribution faces, plus the official
      // passthrough leaves when mounted. The composed view is cached per
      // accessing caller so the published object identity stays stable for
      // one caller while the contribution owner derives from that caller.
      const callerCtx = this?.ctx ?? this
      const ownerKey = deriveLlmAdaptersOwner(callerCtx) ?? 'caller'
      const cached = this._promptsSurfaceCache?.get(ownerKey)
      if (cached) return cached
      const base = this._systemPromptSurface
      const provenance = this._contextSlot ? this._contextSlot.surface : this._contextSurface
      // The five reversible assembly inputs merged into prompts.contribute and
      // the assemble passthrough (migrated to services.prompts); the composed
      // prompts face keeps the projection and self-description members.
      const { section, context, variable, tools: promptTools, suppressRuntimeContext, assemble, ...baseRest } = base ?? {}
      const contribute = createContributeEntry(
        () => this._systemPromptSurface,
        (spec) => {
          if (spec && typeof spec === 'object' && typeof spec.ownerId === 'string') return spec.ownerId
          return ownerKey
        },
        () => (this._resolveFeatureStatus?.('systemPrompt') ? 'active' : 'unavailable'),
      )
      const surface = composeSurface(baseRest, { provenance, contribute })
      if (!this._promptsSurfaceCache) this._promptsSurfaceCache = new Map()
      this._promptsSurfaceCache.set(ownerKey, surface)
      return surface
    }

    _publishPromptsSurface() {
      this._promptsSurfaceCache = new Map()
      this._promptsSurface()
    }

    _publishSystemPromptSurface() {
      this._systemPromptSurface = this._officialPassthroughSlot
        ? composeSurface(this._systemPromptBaseSurface, this._officialPassthroughSlot.surface)
        : this._systemPromptBaseSurface
      this._publishPromptsSurface()
    }

    _publishServicesSurface() {
      this._servicesSurface = composeSurface(this._servicesBaseSurface, {
        ...(this._typertSurface ? { typert: this._typertSurface } : {}),
      })
    }

    _publishRoutingSurface() {
      // `llm.routing` is a service-lifetime namespace. Its methods resolve the
      // current owner slots dynamically; remounting a leaf must not replace
      // the public object identity held by consumers. The route policy plane
      // (policies/candidates/health/circuit/decisions) is composed from the
      // route policy replacement face; `policy` is published under the plural
      // `policies` leaf per the fixed public shape.
      if (this._routingSurface) return this._routingSurface
      const service = this
      const core = () => {
        if (!service._active()) throw new PluginApiInactiveError()
      }
      const exec = (value) => {
        core()
        const execToken = service._execRouteToken
        if (!execToken?.current || service._execRouteToken !== execToken) {
          throw new PluginApiFeatureDisabledError('llm.routing')
        }
        return Reflect.apply(execToken.api.routeOf, execToken.api, [value])
      }
      const sessionMethod = (name) => (...args) => {
        core()
        const sessionSlot = service._sessionRouteSlot
        if (!sessionSlot?.current || service._sessionRouteSlot !== sessionSlot) {
          throw new PluginApiFeatureDisabledError('llm.routing')
        }
        return Reflect.apply(sessionSlot.api[name], sessionSlot.api, args)
      }
      const routePolicy = () => {
        core()
        const flat = service._routePolicySurface
        if (!flat || typeof flat.policies?.register !== 'function') {
          throw new PluginApiFeatureDisabledError('llm.routing', 'route policy replacement is not active')
        }
        return flat
      }
      const invokeRoutePolicy = (path, method) => (...args) => {
        const policy = routePolicy()
        const target = policy[path]
        if (!target || typeof target[method] !== 'function') {
          throw new PluginApiFeatureDisabledError('llm.routing', `route policy member "${path}.${method}" is unavailable`)
        }
        return Reflect.apply(target[method], target, args)
      }
      this._routingSurface = Object.freeze({
        forExecution: exec,
        current: sessionMethod('current'),
        wait: sessionMethod('wait'),
        policies: Object.freeze({ register: invokeRoutePolicy('policies', 'register') }),
        candidates: Object.freeze({
          register: invokeRoutePolicy('candidates', 'register'),
          list: invokeRoutePolicy('candidates', 'list'),
        }),
        health: Object.freeze({
          observe: invokeRoutePolicy('health', 'observe'),
          circuitPolicy: Object.freeze({ register: invokeRoutePolicy('health', 'registerCircuitPolicy') }),
          probe: Object.freeze({ register: invokeRoutePolicy('health', 'registerProbe') }),
          get: invokeRoutePolicy('health', 'get'),
          history: invokeRoutePolicy('health', 'history'),
        }),
        circuit: Object.freeze({
          inspect: invokeRoutePolicy('circuit', 'status'),
        }),
        decisions: Object.freeze({
          get: invokeRoutePolicy('decisions', 'get'),
          history: invokeRoutePolicy('decisions', 'history'),
        }),
        observe: (...args) => sessionMethod('on')(...args),
      })
    }

    _installLlmSlot(name, api) {
      const field = name === 'llm/request' ? '_llmRequestSlot' : '_llmAdmissionSlot'
      const methods = name === 'llm/request' ? ['transform'] : ['register']
      const previous = this[field]
      if (previous) previous.current = false
      const record = createFeatureSlot({
        active: () => this._active(),
        feature: name,
        api,
        methods,
        isCurrent: () => this[field],
      })
      this[field] = record
      return record
    }

    /**
     * Build the service-lifetime-stable `llm.requestTransforms` /
     * `llm.admissionPolicies` leaf views once. Each wrapper resolves the
     * current slot at invocation time, so a remounted slot never churns the
     * public object identity held by consumers.
     */
    _buildLlmLeaves() {
      this._requestTransformsSurface = Object.freeze({
        register: (spec) => this._llmRequestSlot?.surface.transform(spec),
      })
      this._admissionPoliciesSurface = Object.freeze({
        register: (spec) => this._llmAdmissionSlot?.surface.register(spec),
      })
    }

    /**
     * Install the replacement-owned decoration facet resolver. The facade
     * holds no second registry; it only forwards `decorate`/`snapshot` to the
     * resolved replacement facet per invocation. Returns true once installed.
     */
    _setLlmAdaptersProvider(provider) {
      if (typeof provider !== 'function') return false
      this._llmAdaptersProvider = provider
      return true
    }

    /**
     * Per-access `llm.adapters` surface bound to the caller's shadowed context
     * so `decorate` can mint the decoration owner from the caller fiber
     * (never from caller-supplied strings).
     */
    _llmAdaptersForCaller(callerCtx) {
      const surface = this._llmAdaptersSurface
      if (!surface || typeof surface.register !== 'function') {
        throw new PluginApiFeatureDisabledError('llm.adapters', 'adapter decoration is unavailable')
      }
      return Object.freeze({
        register: (definition) => surface.register(definition, callerCtx),
        list: () => surface.list(),
      })
    }

    /**
     * Rebuild the base `profile` namespace surface for the inspection owner.
     * The mutation face is composed per access by the `profile` getter
     * (caller-identity capture in the agent style), so the base surface here
     * only carries the projection members plus typed-disabled mutation
     * members until the mutation provider attaches.
     */
    _publishProfileSurface() {
      const inspection = this._profileSlot ? this._profileSlot.surface : null
      const disabled = createDisabledProfileApi(() => this._active())
      const surface = {
        inspect: inspection?.inspect ?? disabled.inspect,
        health: inspection?.health ?? disabled.health,
        planDiff: inspection?.planDiff ?? disabled.planDiff,
        apply: disabled.apply,
        snapshot: disabled.snapshot,
      }
      this._profileSurface = composeSurface(surface)
    }

    /**
     * Install a lazy mutation-surface provider (the facade remote client
     * owner). The provider receives the caller context so each write verb
     * can mint its owner identity from the caller fiber (never from a bare
     * caller-supplied string). Returns true once installed; idempotent.
     */
    _setProfileMutationProvider(provider) {
      if (typeof provider !== 'function') return false
      this._profileMutationProvider = provider
      return true
    }

    _warnSessionDurable(message) {
      try {
        this.ctx?.logger?.warn?.(message)
      } catch {
        // durable cleanup must not depend on logging
      }
    }

    resetSessionDurable(epoch) {
      const record = durableEpochRecords.get(epoch)
      if (this._durableEpoch !== epoch || !record?.current) return false
      record.current = false
      this._durableEpoch = null
      this._durableSessionApi = createDisabledSessionDurableApi(() => this._active())
      this._publishSessionApi()
      try {
        record.closeEpoch()
      } catch {
        this._warnSessionDurable('dsh-plugin-api session durable: epoch cleanup failed')
      }
      return true
    }

    _mountSessionDurable(api) {
      const facade = api?.facade
      const closeEpoch = api?.closeEpoch
      if (!facade || typeof facade !== 'object' || typeof closeEpoch !== 'function') {
        throw new PluginApiFeatureDisabledError('sessions.durable', 'invalid durable epoch')
      }
      const epoch = Object.freeze({})
      const record = { current: true, closeEpoch, sequence: ++this._durableEpochSequence }
      if (this._durableEpoch) this.resetSessionDurable(this._durableEpoch)
      durableEpochRecords.set(epoch, record)
      this._durableEpoch = epoch
      this._durableSessionApi = createActiveSessionDurableApi({
        availability: () => ({ active: this._active(), registry: this._registry }),
        epoch: record,
        facade,
      })
      this._publishSessionApi()
      return epoch
    }

    /**
     * Mount a feature API. Only known feature names are mountable; the host
     * apply calls this only after the feature guard passed. baseline mounters use
     * this immediate path; B mounters use `prepareFeature` so cleanup
     * registration and registry activation can precede publication.
     */
    mountFeature(name, api) {
      return this._assignFeature(name, api)
    }

    /**
     * Decorate a namespace surface with the standard `availability()`
     * members. The decorated object is cached per raw surface so repeated
     * getter reads keep one public object identity.
     */
    _decoratedNamespaces(names, surface) {
      if (!surface || typeof surface !== 'object') return surface
      const cached = this._namespaceDecorateCache.get(surface)
      if (cached) return cached
      const decorated = this._namespaceAvailability.decorate(surface, names, this._namespaceDecorateCache)
      this._namespaceDecorateCache.set(surface, decorated)
      return decorated
    }

    /**
     * Staged feature publication (first B facade activation; semantic-hooks
     * compat contract transaction gate). Captures the candidate without changing any
     * public facade field. `commit()` publishes through the exact internal
     * assignment path used by `mountFeature`, at most once. `rollback()`
     * discards the candidate and restores the disabled facade surface only
     * while this transaction still owns the published slot, so a stale
     * transaction can never alter a later mount. Both are identity-bound and
     * idempotent; `mountFeature` remains immediate for baseline mounters.
     */
    prepareFeature(name, api) {
      if (!KNOWN_FEATURES.has(name)) {
        throw new PluginApiFeatureDisabledError(name, `cannot prepare unknown feature "${name}"`)
      }
      if (name === 'tools' || name === 'llm') {
        // tools mounts through a private flag and llm merges entries into a
        // shared surface; neither is a replaceable slot, so a stale prepared
        // transaction could not prove slot ownership on rollback.
        throw new PluginApiFeatureDisabledError(name, `staged preparation is not supported for feature "${name}"`)
      }
      if (name === 'sessionDurable') {
        const transaction = { state: 'prepared', epoch: null }
        return {
          commit: () => {
            if (transaction.state !== 'prepared') return false
            transaction.epoch = this._mountSessionDurable(api)
            api?.onMounted?.(transaction.epoch)
            transaction.state = 'committed'
            return true
          },
          rollback: () => {
            if (transaction.state === 'rolled-back') return false
            const wasCommitted = transaction.state === 'committed'
            transaction.state = 'rolled-back'
            if (wasCommitted) this.resetSessionDurable(transaction.epoch)
            return true
          },
        }
      }
      if (name === 'sessionRoute') {
        const transaction = { state: 'prepared', token: null }
        return {
          commit: () => {
            if (transaction.state !== 'prepared') return false
            transaction.token = this._assignFeature(name, api)
            transaction.state = 'committed'
            return true
          },
          rollback: () => {
            if (transaction.state === 'rolled-back') return false
            const committed = transaction.state === 'committed'
            transaction.state = 'rolled-back'
            if (committed) this.unmountFeature(name, transaction.token)
            return true
          },
        }
      }
      const transaction = { name, api, state: 'prepared' }
      return {
        commit: () => {
          if (transaction.state !== 'prepared') return false
          transaction.state = 'committed'
          this._assignFeature(name, api)
          return true
        },
        rollback: () => {
          if (transaction.state === 'rolled-back') return false
          const wasCommitted = transaction.state === 'committed'
          transaction.state = 'rolled-back'
          if (wasCommitted) this._restoreDisabledSurface(name, api)
          return true
        },
      }
    }

    /** Internal assignment path shared by mountFeature and prepared commit. */
    _assignFeature(name, api) {
      this._mountedFeatures.add(name)
      if (name === 'execRoute') {
        if (!api || typeof api.routeOf !== 'function') {
          throw new PluginApiFeatureDisabledError('llm.routing', 'execRoute owner is unavailable')
        }
        if (this._execRouteToken) this._execRouteToken.current = false
        const token = { api, current: true }
        this._execRouteDelegate = (exec) => api.routeOf(exec)
        this._execRouteToken = token
        this._publishRoutingSurface()
        return token
      }
      if (name === 'llm/admission') {
        return this._installLlmSlot(name, api)
      }
      if (name === 'llm/request') {
        return this._installLlmSlot(name, api)
      }
      if (name === 'llm') {
        this._llmBaseApi = composeSurface(this._llmBaseApi, api)
        return
      }
      if (name === 'events') {
        this._eventsSurface = composeSurface(api)
        return
      }
      if (name === 'tools') {
        this._toolsMounted = true
        return
      }
      if (name === 'agentExtension') {
        if (!api || typeof api.name !== 'string' || typeof api.compose !== 'function') {
          throw new PluginApiFeatureDisabledError('agents', 'agent extension is unavailable')
        }
        const token = { name: api.name, compose: api.compose }
        this._agentExtensions.set(token, api.compose)
        return token
      }
      if (name === 'agent') {
        if (typeof api !== 'function') {
          throw new PluginApiFeatureDisabledError('agents', 'agent facade factory is unavailable')
        }
        const token = {
          previousFactory: this._agentFactory,
          previousToken: this._agentToken,
        }
        this._agentFactory = api
        this._agentToken = token
        this._agentBaseFactory ??= token.previousFactory
        return token
      }
      if (name === 'session') {
        this._baseSessionApi = api
        this._publishSessionApi()
        return
      }
      if (name === 'sessionRoute') {
        if (!api || typeof api.current !== 'function' || typeof api.on !== 'function'
          || typeof api.once !== 'function' || typeof api.wait !== 'function') {
          throw new PluginApiFeatureDisabledError('llm.routing', 'session route owner is unavailable')
        }
        if (this._sessionRouteSlot) this._sessionRouteSlot.current = false
        this._sessionRouteSlot = createFeatureSlot({
          active: () => this._active(),
          feature: 'sessionRoute',
          api,
          methods: ['current', 'on', 'once', 'wait'],
          isCurrent: () => this._sessionRouteSlot,
        })
        this._publishRoutingSurface()
        return this._sessionRouteSlot
      }
      if (name === 'diagnostics') {
        if (!api || typeof api.register !== 'function' || typeof api.get !== 'function'
          || typeof (api.observe ?? api.onChange) !== 'function') {
          throw new PluginApiFeatureDisabledError('diagnostics', 'diagnostics owner is unavailable')
        }
        if (this._diagnosticsSlot) this._diagnosticsSlot.current = false
        // The diagnostics owner historically names the subscription entry
        // onChange; observe resolves against onChange when the owner does not
        // provide an observe member directly.
        const diagnosticsApi = typeof api.observe === 'function'
          ? api
          : Object.freeze({ ...api, observe: (...args) => Reflect.apply(api.onChange, api, args) })
        this._diagnosticsSlot = createFeatureSlot({
          active: () => this._active(),
          feature: 'diagnostics',
          api: diagnosticsApi,
          methods: ['register', 'get', 'observe'],
          isCurrent: () => this._diagnosticsSlot,
        })
        this._diagnosticsSurface = this._diagnosticsSlot.surface
        return this._diagnosticsSlot
      }
      if (name === 'sessionDurable') {
        return this._mountSessionDurable(api)
      }
      if (name === 'systemPrompt') {
        this._systemPromptBaseSurface = composeSurface(api)
        this._publishSystemPromptSurface()
        return
      }
      if (name === 'officialPassthrough') {
        if (!api || typeof api.renderContextSnapshot !== 'function'
          || typeof api.joinContextSections !== 'function') {
          throw new PluginApiFeatureDisabledError('officialPassthrough', 'official helper owner is unavailable')
        }
        if (this._officialPassthroughSlot) this._officialPassthroughSlot.current = false
        const token = createOfficialPassthroughSlot({
          active: () => this._active(),
          api,
          isCurrent: () => this._officialPassthroughSlot,
        })
        this._officialPassthroughSlot = token
        this._publishSystemPromptSurface()
        return token
      }
      if (name === 'settings') {
        this._settingsBaseSurface = composeSurface(api)
        this._publishSettingsSurface()
        return
      }
      if (name === 'settingsRemote') {
        if (!api || typeof api.remote !== 'function') {
          throw new PluginApiFeatureDisabledError('settingsRemote', 'settings remote owner is unavailable')
        }
        this._settingsRemoteSurface = api
        this._publishSettingsSurface()
        return
      }
      if (name === 'remote') {
        if (!api || typeof (api.register ?? api.publish) !== 'function') {
          throw new PluginApiFeatureDisabledError('remotes', 'host remote owner is unavailable')
        }
        this._remoteSurface = api
        return
      }
      if (name === 'services') {
        this._servicesBaseSurface = composeSurface(api)
        this._publishServicesSurface()
        return
      }
      if (name === 'typert') {
        if (!api || typeof api !== 'object') {
          throw new PluginApiFeatureDisabledError('services', 'Typert facade is unavailable')
        }
        this._typertSurface = api
        this._publishServicesSurface()
        return
      }
      if (name === 'execution') {
        if (!api || typeof api.observe !== 'function' || typeof api.get !== 'function'
          || typeof api.history !== 'function') {
          throw new PluginApiFeatureDisabledError('executions', 'execution owner is unavailable')
        }
        if (this._executionSlot) this._executionSlot.current = false
        const record = { current: true, api }
        const fail = () => {
          if (!this._active()) throw new PluginApiInactiveError()
          if (!record.current || this._executionSlot !== record) {
            throw new PluginApiFeatureDisabledError('executions')
          }
        }
        const surface = Object.freeze({
          observe: (options) => {
            fail()
            return api.observe(options)
          },
          get: (executionId, options) => {
            fail()
            return api.get(executionId, options)
          },
          history: (sessionId, options) => {
            fail()
            return api.history(sessionId, options)
          },
          get visibility() {
            fail()
            return api.visibility
          },
          get availability() {
            fail()
            return api.availability
          },
        })
        record.surface = surface
        this._executionSlot = record
        this._executionSurface = surface
        return record
      }
      if (name === 'recovery') {
        if (!api || typeof api.evaluate !== 'function'
          || typeof api.capability?.register !== 'function'
          || typeof api.policy?.register !== 'function'
          || typeof api.visibility?.register !== 'function'
          || typeof api.availability !== 'function') {
          throw new PluginApiFeatureDisabledError('executions.recovery', 'recovery owner is unavailable')
        }
        if (this._recoverySlot) this._recoverySlot.current = false
        const record = { current: true, api }
        const fail = () => {
          if (!this._active()) throw new PluginApiInactiveError()
          if (!record.current || this._recoverySlot !== record) {
            throw new PluginApiFeatureDisabledError('executions.recovery')
          }
        }
        const invoke = (method) => (...args) => {
          fail()
          return Reflect.apply(api[method], api, args)
        }
        const invokeNested = (parent, method) => (...args) => {
          fail()
          return Reflect.apply(api[parent][method], api[parent], args)
        }
        const surface = Object.freeze({
          capability: Object.freeze({
            register: invokeNested('capability', 'register'),
          }),
          policy: Object.freeze({ register: invokeNested('policy', 'register') }),
          evaluate: invoke('evaluate'),
          coverage: invoke('coverage'),
          visibility: Object.freeze({
            register: invokeNested('visibility', 'register'),
          }),
          get availability() {
            fail()
            return api.availability()
          },
        })
        record.surface = surface
        this._recoverySlot = record
        this._recoverySurface = surface
        return record
      }
      if (name === 'coordination') {
        if (!api || typeof api.availability !== 'function' || typeof api.acquire !== 'function'
          || typeof api.heartbeat !== 'function' || typeof api.release !== 'function'
          || typeof api.takeover !== 'function' || typeof api.compareAndSet !== 'function'
          || typeof api.watch !== 'function') {
          throw new PluginApiFeatureDisabledError('coordination', 'coordination owner is unavailable')
        }
        if (this._coordinationSlot) this._coordinationSlot.current = false
        const record = { current: true, api }
        const fail = () => {
          if (!this._active()) throw new PluginApiInactiveError()
          if (!record.current || this._coordinationSlot !== record) {
            throw new PluginApiFeatureDisabledError('coordination')
          }
        }
        const invoke = (method) => (...args) => {
          fail()
          return Reflect.apply(api[method], api, args)
        }
        const surface = Object.freeze({
          availability: invoke('availability'),
          acquire: invoke('acquire'),
          heartbeat: invoke('heartbeat'),
          release: invoke('release'),
          takeover: invoke('takeover'),
          compareAndSet: invoke('compareAndSet'),
          observe: invoke('watch'),
        })
        record.surface = surface
        this._coordinationSlot = record
        this._coordinationSurface = surface
        return record
      }
      if (name === 'workspaceTransactions') {
        if (!api || typeof api.prepare !== 'function' || typeof api.record !== 'function'
          || typeof api.preview !== 'function' || typeof api.commit !== 'function'
          || typeof api.rollback !== 'function' || typeof api.recover !== 'function'
          || typeof api.get !== 'function' || typeof api.observe !== 'function') {
          throw new PluginApiFeatureDisabledError('workspaces.transactions', 'workspace transaction owner is unavailable')
        }
        if (this._workspaceTransactionsSlot) this._workspaceTransactionsSlot.current = false
        const record = { current: true, api }
        const fail = () => {
          if (!this._active()) throw new PluginApiInactiveError()
          if (!record.current || this._workspaceTransactionsSlot !== record) {
            throw new PluginApiFeatureDisabledError('workspaces.transactions')
          }
        }
        const invoke = (method) => (...args) => {
          fail()
          return Reflect.apply(api[method], api, args)
        }
        const surface = Object.freeze({
          prepare: invoke('prepare'),
          record: invoke('record'),
          preview: invoke('preview'),
          commit: invoke('commit'),
          rollback: invoke('rollback'),
          recover: invoke('recover'),
          get: invoke('get'),
          observe: invoke('observe'),
        })
        record.surface = surface
        this._workspaceTransactionsSlot = record
        this._workspaceTransactionsSurface = surface
        return record
      }
      if (name === 'tasks') {
        if (!api || typeof api.register !== 'function' || typeof api.start !== 'function'
          || typeof api.claim !== 'function' || typeof api.reassign !== 'function'
          || typeof api.settle !== 'function' || typeof api.attach !== 'function'
          || typeof api.get !== 'function' || typeof api.observe !== 'function'
          || typeof api.history !== 'function') {
          throw new PluginApiFeatureDisabledError('tasks', 'tasks owner is unavailable')
        }
        if (this._tasksSlot) this._tasksSlot.current = false
        const record = { current: true, api }
        const fail = () => {
          if (!this._active()) throw new PluginApiInactiveError()
          if (!record.current || this._tasksSlot !== record) {
            throw new PluginApiFeatureDisabledError('tasks')
          }
        }
        const invoke = (method) => (...args) => {
          fail()
          return Reflect.apply(api[method], api, args)
        }
        const surface = Object.freeze({
          register: invoke('register'),
          start: invoke('start'),
          acquire: invoke('claim'),
          takeover: invoke('reassign'),
          settle: invoke('settle'),
          attach: invoke('attach'),
          get: invoke('get'),
          observe: invoke('observe'),
          history: invoke('history'),
          get availability() {
            fail()
            return api.availability
          },
        })
        record.surface = surface
        this._tasksSlot = record
        this._tasksSurface = surface
        return record
      }
      // security-policy: nested registry faces (policy/redaction/egress),
      // read-only audit projection, truthful availability. Every public
      // member is guarded by the same active/current discipline as the other
      // feature slots (typed rejection when inactive/disabled).
      if (name === 'security') {
        if (!api || typeof api.policy?.register !== 'function'
          || typeof api.redaction?.register !== 'function'
          || typeof api.egress?.register !== 'function'
          || typeof api.egress?.lease?.acquire !== 'function'
          || typeof api.egress?.lease?.release !== 'function'
          || typeof api.egress?.coverage !== 'function'
          || typeof (api.audit?.list ?? api.audit?.query) !== 'function') {
          throw new PluginApiFeatureDisabledError('security', 'security owner is unavailable')
        }
        if (this._securitySlot) this._securitySlot.current = false
        const record = { current: true, api }
        const fail = () => {
          if (!this._active()) throw new PluginApiInactiveError()
          if (!record.current || this._securitySlot !== record) {
            throw new PluginApiFeatureDisabledError('security')
          }
        }
        const wrap = (fn) => (...args) => {
          fail()
          return Reflect.apply(fn, api, args)
        }
        const surface = Object.freeze({
          policy: Object.freeze({ register: wrap(api.policy.register) }),
          redaction: Object.freeze({ register: wrap(api.redaction.register) }),
          egress: Object.freeze({
            register: wrap(api.egress.register),
            lease: Object.freeze({
              acquire: wrap(api.egress.lease.acquire),
              release: wrap(api.egress.lease.release),
            }),
            coverage: wrap(api.egress.coverage),
          }),
          audit: Object.freeze({
            list: wrap(api.audit.list ?? api.audit.query),
          }),
          get availability() {
            fail()
            return api.availability
          },
        })
        record.surface = surface
        this._securitySlot = record
        this._securitySurface = surface
        return record
      }
      // context-provenance
      if (name === 'context') {
        if (!api || typeof api.contribute !== 'function' || typeof api.compose !== 'function'
          || typeof api.inspect !== 'function' || typeof api.mapping !== 'function'
          || typeof api.observe !== 'function' || typeof api.policy?.register !== 'function'
          || typeof api.availability !== 'function') {
          throw new PluginApiFeatureDisabledError('prompts.provenance', 'context owner is unavailable')
        }
        if (this._contextSlot) this._contextSlot.current = false
        const record = { current: true, api }
        const fail = () => {
          if (!this._active()) throw new PluginApiInactiveError()
          if (!record.current || this._contextSlot !== record) {
            throw new PluginApiFeatureDisabledError('prompts.provenance')
          }
        }
        const invoke = (method) => (...args) => {
          fail()
          return Reflect.apply(api[method], api, args)
        }
        const invokeNested = (parent, method) => (...args) => {
          fail()
          return Reflect.apply(api[parent][method], api[parent], args)
        }
        const surface = Object.freeze({
          contribute: invoke('contribute'),
          compose: invoke('compose'),
          inspect: invoke('inspect'),
          mapping: invoke('mapping'),
          observe: invoke('observe'),
          policy: Object.freeze({ register: invokeNested('policy', 'register') }),
          availability: invoke('availability'),
        })
        record.surface = surface
        this._contextSlot = record
        this._contextSurface = surface
        this._publishPromptsSurface()
        return record
      }
      // context-provenance
      // tool-discovery
      if (name === 'toolDiscovery') {
        if (!api || typeof api.catalog?.register !== 'function'
          || typeof (api.list ?? api.search) !== 'function'
          || typeof api.activate !== 'function' || typeof api.deactivate !== 'function'
          || typeof (api.audit?.list ?? api.audit?.query) !== 'function' || typeof api.availability !== 'function') {
          throw new PluginApiFeatureDisabledError('tools.discovery', 'tool discovery owner is unavailable')
        }
        if (this._toolsDiscoverySlot) this._toolsDiscoverySlot.current = false
        const record = { current: true, api }
        const fail = () => {
          if (!this._active()) throw new PluginApiInactiveError()
          if (!record.current || this._toolsDiscoverySlot !== record) {
            throw new PluginApiFeatureDisabledError('tools.discovery')
          }
        }
        const invoke = (method) => (...args) => {
          fail()
          return Reflect.apply(api[method], api, args)
        }
        const invokeNested = (parent, method) => (...args) => {
          fail()
          return Reflect.apply(api[parent][method], api[parent], args)
        }
        const surface = Object.freeze({
          catalog: Object.freeze({ register: invokeNested('catalog', 'register') }),
          list: (...args) => {
            fail()
            const fn = api.list ?? api.search
            if (typeof fn !== 'function') throw new PluginApiFeatureDisabledError('tools.discovery', 'discovery search owner is unavailable')
            return Reflect.apply(fn, api, args)
          },
          activate: invoke('activate'),
          deactivate: invoke('deactivate'),
          audit: Object.freeze({
            list: (...args) => {
              fail()
              const fn = api.audit?.list ?? api.audit?.query
              if (typeof fn !== 'function') throw new PluginApiFeatureDisabledError('tools.discovery', 'discovery audit owner is unavailable')
              return Reflect.apply(fn, api.audit, args)
            },
          }),
          get availability() {
            fail()
            return api.availability()
          },
        })
        record.surface = surface
        this._toolsDiscoverySlot = record
        this._toolsDiscoverySurface = surface
        return record
      }
      // tool-discovery
      // session-branch facade
      if (name === 'sessionBranch') {
        for (const member of SESSION_BRANCH_SURFACE_METHODS) {
          if (typeof api?.[member] !== 'function') {
            throw new PluginApiFeatureDisabledError('sessions.branches', `branch owner member "${member}" is unavailable`)
          }
        }
        if (typeof api?.availability !== 'function') {
          throw new PluginApiFeatureDisabledError('sessions.branches', 'branch owner availability is unavailable')
        }
        if (this._sessionBranchSlot) this._sessionBranchSlot.current = false
        const record = { current: true, api }
        const service = this
        const fail = () => {
          if (!service._active()) throw new PluginApiInactiveError()
          if (!record.current || service._sessionBranchSlot !== record) {
            throw new PluginApiFeatureDisabledError('sessions.branches')
          }
        }
        const surface = { availability: () => {
          if (!service._active() || !record.current || service._sessionBranchSlot !== record) {
            return Object.freeze({ active: false, contract: false })
          }
          return api.availability()
        } }
        for (const member of SESSION_BRANCH_SURFACE_METHODS) {
          surface[member] = (...args) => {
            fail()
            return Reflect.apply(api[member], api, args)
          }
        }
        record.surface = Object.freeze(surface)
        this._sessionBranchSlot = record
        this._sessionBranchSurface = surface
        this._publishSessionApi()
        return record
      }
      // skills activation facade
      if (name === 'skillsActivation') {
        for (const member of SKILLS_ACTIVATION_SURFACE_METHODS) {
          if (typeof api?.[member] !== 'function') {
            throw new PluginApiFeatureDisabledError('skills.activation', `activation owner member "${member}" is unavailable`)
          }
        }
        if (typeof api?.availability !== 'function' || typeof (api?.policy?.register ?? api?.policy?.registerMinimalCatalogUpdate) !== 'function') {
          throw new PluginApiFeatureDisabledError('skills.activation', 'activation owner availability or policy member is unavailable')
        }
        if (this._skillsActivationSlot) this._skillsActivationSlot.current = false
        const record = { current: true, api }
        const service = this
        const fail = () => {
          if (!service._active()) throw new PluginApiInactiveError()
          if (!record.current || service._skillsActivationSlot !== record) {
            throw new PluginApiFeatureDisabledError('skills.activation')
          }
        }
        const surface = { availability: () => {
          if (!service._active() || !record.current || service._skillsActivationSlot !== record) {
            return Object.freeze({ active: false, contract: false })
          }
          return api.availability()
        } }
        for (const member of SKILLS_ACTIVATION_SURFACE_METHODS) {
          surface[member] = (...args) => {
            fail()
            return Reflect.apply(api[member], api, args)
          }
        }
        surface.policy = Object.freeze({
          register: (...args) => {
            fail()
            if (typeof api.policy.register === 'function') {
              return Reflect.apply(api.policy.register, api.policy, args)
            }
            return Reflect.apply(api.policy.registerMinimalCatalogUpdate, api.policy, args)
          },
        })
        surface.register = (spec) => {
          fail()
          if (typeof api.register === 'function') return Reflect.apply(api.register, api, [spec])
          if (spec && typeof spec === 'object' && spec.kind === 'skill' && spec.skill !== undefined && typeof api.registerSkill === 'function') {
            return Reflect.apply(api.registerSkill, api, [spec.skill])
          }
          if (spec && typeof spec === 'object' && spec.kind === 'descriptor' && typeof api.registerDescriptor === 'function') {
            return Reflect.apply(api.registerDescriptor, api, [spec])
          }
          throw new PluginApiError(
            'SKILLS_REGISTER_INVALID_INPUT',
            'skills.activation.register requires a spec with kind "skill" (plus the skill definition) or kind "descriptor"',
          )
        }
        surface.exposure = Object.freeze({
          list: (...args) => {
            fail()
            return Reflect.apply(api.exposure.list, api.exposure, args)
          },
        })
        surface.audit = Object.freeze({
          list: (...args) => {
            fail()
            return Reflect.apply(api.audit.list, api.audit, args)
          },
        })
        record.surface = Object.freeze(surface)
        this._skillsActivationSlot = record
        this._skillsActivationSurface = surface
        this._publishSkillsApi()
        return record
      }
      // skills activation facade
      if (name === 'sessionChannel') {
        if (!api || typeof api.open !== 'function' || typeof api.subscribe !== 'function'
          || typeof api.observe !== 'function' || typeof api.onChange !== 'function'
          || typeof api.auth?.registerVerifier !== 'function') {
          throw new PluginApiFeatureDisabledError('sessions.channels', 'sessionChannel owner is unavailable')
        }
        if (this._sessionChannelSlot) this._sessionChannelSlot.current = false
        const record = { current: true, api }
        const service = this
        const fail = () => {
          if (!service._active()) throw new PluginApiInactiveError()
          if (!record.current || service._sessionChannelSlot !== record) {
            throw new PluginApiFeatureDisabledError('sessions.channels')
          }
        }
        const invoke = (method) => (...args) => {
          fail()
          return Reflect.apply(api[method], api, args)
        }
        const invokeNested = (parent, method) => (...args) => {
          fail()
          return Reflect.apply(api[parent][method], api[parent], args)
        }
        const surface = Object.defineProperties({
          acquire: invoke('open'),
          list: invoke('fetchEvents'),
          heartbeat: invoke('heartbeat'),
          ack: invoke('ack'),
          resume: invoke('resume'),
          release: invoke('revoke'),
          observe: invoke('observe'),
          auth: Object.freeze({
            initiatePairing: invokeNested('auth', 'initiatePairing'),
            approvePairing: invokeNested('auth', 'approvePairing'),
            rejectPairing: invokeNested('auth', 'rejectPairing'),
            register: (spec) => {
              fail()
              const kind = spec?.kind
              if (kind === 'verifier') return Reflect.apply(api.auth.registerVerifier, api.auth, [spec])
              if (kind === 'authorizer') return Reflect.apply(api.auth.registerAuthorizer, api.auth, [spec])
              throw new PluginApiError('AUTH_REGISTER_INVALID_INPUT', 'sessions.channels.auth.register requires a kind of verifier or authorizer')
            },
            pairingProvider: Object.freeze({ register: invokeNested('auth', 'registerPairingProvider') }),
          }),
          redaction: Object.freeze({
            register: invokeNested('redaction', 'registerProfile'),
          }),
        }, {
          [Symbol.for('dsh-plugin-api.session-channel.contract')]: { value: true, enumerable: false },
        })
        record.surface = surface
        this._sessionChannelSlot = record
        this._sessionChannelSurface = surface
        this._publishSessionApi()
        return record
      }
      if (name === 'profile') {
        // The profile namespace hosts two owners; the inspection owner is the
        // mandatory mount. The mutation owner is attached later through
        // `_setProfileMutationProvider` (its absence leaves mutation members
        // typed-disabled, matching the stable namespace shape).
        if (!api || typeof api.inspect !== 'function' || typeof api.health !== 'function'
          || typeof api.planDiff !== 'function') {
          throw new PluginApiFeatureDisabledError('profiles', 'profile owner is unavailable')
        }
        if (this._profileSlot) this._profileSlot.current = false
        this._profileSlot = createFeatureSlot({
          active: () => this._active(),
          feature: 'profile',
          api,
          methods: ['inspect', 'health', 'planDiff'],
          isCurrent: () => this._profileSlot,
        })
        this._publishProfileSurface()
        return this._profileSlot
      }
      if (name === 'storage') {
        if (!api || typeof api.open !== 'function') {
          throw new PluginApiFeatureDisabledError('storage', 'storage binding owner is unavailable')
        }
        if (this._storageSlot) this._storageSlot.current = false
        const record = { current: true, api }
        const fail = () => {
          if (!this._active()) throw new PluginApiInactiveError()
          if (!record.current || this._storageSlot !== record) {
            throw new PluginApiFeatureDisabledError('storage')
          }
        }
        const invoke = (method) => (...args) => {
          fail()
          return Reflect.apply(api[method], api, args)
        }
        const surface = Object.freeze({
          open: invoke('open'),
          availability: invoke('availability'),
        })
        record.surface = surface
        this._storageSlot = record
        return record
      }
      throw new PluginApiFeatureDisabledError(name, `cannot mount unknown feature "${name}"`)
    }

    _readSlot(name) {
      if (name === 'llm/admission') return this._llmAdmissionSlot.api
      if (name === 'llm/request') return this._llmRequestSlot.api
      if (name === 'llm') return this.llm
      if (name === 'events') return this._eventsSurface
      if (name === 'agent') return this.agents
      if (name === 'session') return this._sessionSurface
      if (name === 'sessionBranch') return this._sessionBranchSlot?.api
      if (name === 'skillsActivation') return this._skillsActivationSlot?.api
      if (name === 'sessionChannel') return this._sessionChannelSlot?.api
      if (name === 'sessionRoute') return this._sessionRouteSlot?.api
      if (name === 'diagnostics') return this._diagnosticsSlot?.api
      if (name === 'systemPrompt') return this._systemPromptSurface
      if (name === 'officialPassthrough') return this._officialPassthroughSlot?.api
      if (name === 'settings') return this._settingsSurface
      if (name === 'settingsRemote') return this._settingsRemoteSurface
      if (name === 'remote') return this._remoteSurface
      if (name === 'services') return this._servicesSurface
      if (name === 'typert') return this._typertSurface
      if (name === 'execution') return this._executionSlot?.api
      if (name === 'recovery') return this._recoverySlot?.api
      if (name === 'coordination') return this._coordinationSlot?.api
      if (name === 'workspaceTransactions') return this._workspaceTransactionsSlot?.api
      if (name === 'tasks') return this._tasksSlot?.api
      if (name === 'profile') return this._profileSlot?.api
      if (name === 'security') return this._securitySlot?.api
      if (name === 'toolDiscovery') return this._toolsDiscoverySlot?.api
      // context-provenance
      if (name === 'context') return this._contextSlot?.api
      // context-provenance
      if (name === 'routePolicy') return this._routePolicySurface
      return undefined
    }

    _disabledSurfaceFor(name) {
      if (name === 'llm/admission') return createDisabledAdmissionApi(this._active)
      if (name === 'llm/request') return createDisabledRequestApi(this._active)
      if (name === 'llm') return createDisabledLlmApi(this._active)
      if (name === 'events') return createDisabledEventsApi(this._active)
      if (name === 'agent') return createDisabledAgentApi(this._active)
      if (name === 'session') return createDisabledSessionApi(this._active)
      if (name === 'sessionBranch') return createDisabledSessionBranchApi(this._active)
      if (name === 'skillsActivation') return createDisabledSkillsActivationApi(this._active)
      if (name === 'sessionChannel') return createDisabledSessionChannelApi(this._active)
      if (name === 'sessionRoute') return createDisabledSessionRouteApi(this._active)
      if (name === 'diagnostics') return createDisabledDiagnosticsApi(this._active)
      if (name === 'systemPrompt') return createDisabledSystemPromptApi(this._active)
      if (name === 'settings') return createDisabledSettingsApi(this._active)
      if (name === 'settingsRemote') return createDisabledSettingsRemoteApi(this._active)
      if (name === 'remote') return createDisabledHostRemoteApi(this._active)
      if (name === 'services') return createDisabledServicesNamespace(this._active)
      if (name === 'execution') return createDisabledExecutionApi(this._active)
      if (name === 'recovery') return createDisabledRecoveryApi(this._active)
      if (name === 'coordination') return createDisabledCoordinationApi(this._active)
      if (name === 'storage') return createDisabledStorageApi(this._active)
      if (name === 'workspaceTransactions') return createDisabledWorkspaceTransactionsApi(this._active)
      if (name === 'tasks') return createDisabledTasksApi(this._active)
      if (name === 'profile') return createDisabledProfileApi(this._active)
      if (name === 'security') return createDisabledSecurityApi(this._active)
      if (name === 'toolDiscovery') return createDisabledToolsDiscoveryApi(this._active)
      // context-provenance
      if (name === 'context') return createDisabledContextApi(this._active)
      // context-provenance
      if (name === 'routePolicy') return createDisabledRoutePolicyApi(this._active)
      return undefined
    }

    /** Restore the disabled facade only while this transaction owns the slot. */
    _restoreDisabledSurface(name, api) {
      if (this._readSlot(name) === api) {
        const surface = this._disabledSurfaceFor(name)
        if (surface !== undefined) this._assignFeature(name, surface)
      }
    }

    _removeAgentExtension(token) {
      return Boolean(token && this._agentExtensions.delete(token))
    }

    _removeAgentExtensionByCompose(compose) {
      if (typeof compose !== 'function') return false
      for (const [token, extension] of this._agentExtensions) {
        if (extension !== compose) continue
        this._agentExtensions.delete(token)
        return true
      }
      return false
    }

    unmountFeature(name, token) {
      this._mountedFeatures.delete(name)
      if (name === 'agentExtension') {
        return this._removeAgentExtension(token)
      }
      if (name === 'agent' && token === this._agentToken) {
        this._agentFactory = token.previousFactory ?? (() => createDisabledAgentApi(this._active))
        this._agentToken = token.previousToken ?? null
        return true
      }
      if (name === 'sessionRoute' && token === this._sessionRouteSlot) {
        token.current = false
        this._sessionRouteSlot = null
        this._publishRoutingSurface()
        return true
      }
      if (name === 'settingsRemote' && token === this._settingsRemoteSurface) {
        this._settingsRemoteSurface = createDisabledSettingsRemoteApi(this._active)
        this._publishSettingsSurface()
        return true
      }
      if (name === 'remote' && token === this._remoteSurface) {
        this._remoteSurface = createDisabledHostRemoteApi(this._active)
        return true
      }
      if (name === 'typert' && token === this._typertSurface) {
        this._typertSurface = undefined
        this._publishServicesSurface()
        return true
      }
      if (name === 'officialPassthrough' && token === this._officialPassthroughSlot) {
        token.current = false
        this._officialPassthroughSlot = null
        this._publishSystemPromptSurface()
        return true
      }
      if (name === 'execution' && token === this._executionSlot) {
        token.current = false
        this._executionSlot = null
        this._executionSurface = createDisabledExecutionApi(this._active)
        return true
      }
      if (name === 'recovery' && token === this._recoverySlot) {
        token.current = false
        this._recoverySlot = null
        this._recoverySurface = createDisabledRecoveryApi(this._active)
        return true
      }
      if (name === 'coordination' && token === this._coordinationSlot) {
        token.current = false
        this._coordinationSlot = null
        this._coordinationSurface = createDisabledCoordinationApi(this._active)
        return true
      }
      if (name === 'workspaceTransactions' && token === this._workspaceTransactionsSlot) {
        token.current = false
        this._workspaceTransactionsSlot = null
        this._workspaceTransactionsSurface = createDisabledWorkspaceTransactionsApi(this._active)
        return true
      }
      if (name === 'tasks' && token === this._tasksSlot) {
        token.current = false
        this._tasksSlot = null
        this._tasksSurface = createDisabledTasksApi(this._active)
        return true
      }
      if (name === 'profile' && token === this._profileSlot) {
        token.current = false
        this._profileSlot = null
        this._profileMutationProvider = null
        this._profileSurface = createDisabledProfileApi(this._active)
        return true
      }
      if (name === 'security' && token === this._securitySlot) {
        token.current = false
        this._securitySlot = null
        this._securitySurface = createDisabledSecurityApi(this._active)
        return true
      }
      // tool-discovery
      if (name === 'toolDiscovery' && token === this._toolsDiscoverySlot) {
        token.current = false
        this._toolsDiscoverySlot = null
        this._toolsDiscoverySurface = createDisabledToolsDiscoveryApi(this._active)
        return true
      }
      // tool-discovery
      // context-provenance
      if (name === 'context' && token === this._contextSlot) {
        token.current = false
        this._contextSlot = null
        this._contextSurface = createDisabledContextApi(this._active)
        this._publishPromptsSurface()
        return true
      }
      // context-provenance
      // session-branch facade
      if (name === 'sessionBranch' && token === this._sessionBranchSlot) {
        token.current = false
        this._sessionBranchSlot = null
        this._sessionBranchSurface = createDisabledSessionBranchApi(this._active)
        this._publishSessionApi()
        return true
      }
      // session-branch facade
      // sessionChannel facade
      if (name === 'sessionChannel' && token === this._sessionChannelSlot) {
        token.current = false
        this._sessionChannelSlot = null
        this._sessionChannelSurface = createDisabledSessionChannelApi(this._active)
        this._publishSessionApi()
        return true
      }
      // sessionChannel facade
      if (name !== 'execRoute' || token !== this._execRouteToken) return false
      if (token) token.current = false
      this._execRouteDelegate = this._execRouteDisabled
      this._execRouteToken = null
      this._publishRoutingSurface()
      return true
    }
  }
}

const KNOWN_FEATURES = new Set([
  'llm/admission',
  'llm/request',
  'llm',
  'events',
  'tools',
  'agent',
  'agentExtension',
  'execRoute',
  'sessionRoute',
  'diagnostics',
  'session',
  'sessionBranch',
  'sessionDurable',
  'systemPrompt',
  'officialPassthrough',
  'settings',
  'settingsRemote',
  'remote',
  'typert',
  'services',
  'execution',
  'recovery',
  'coordination',
  'storage',
  'workspaceTransactions',
  'tasks',
  'security',
  'toolDiscovery',
  'skillsActivation',
  'context',
  'profile',
  'sessionChannel',
])
