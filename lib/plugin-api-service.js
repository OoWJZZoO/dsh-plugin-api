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
import { createContributionHandle, createResourceHandle, staleResult } from './contract-kernel.js'
import { ROOT_OWNER_TOKEN, callerIdentityOf } from './profile-mutation.js'
import { createNamespaceAvailability } from './namespace-availability.js'
import { featureFailNotice, writeGuardLog } from './guards.js'
import { createDisabledServicesNamespace } from './services.js'
import { createDisabledHostRemoteApi } from './host-remote.js'
import { createDisabledStorageApi } from './storage-binding.js'
import { createDisabledCheckpointsApi } from './checkpoint-facade.js'
import { createToolAbortedErrorFactory } from './tool-abort.js'
import { satisfiesContract } from './version.js'
import { createDisabledDecisionProviders } from './decision-participation-facade.js'
import { SCOPED_PROMPT_KINDS } from './scoped-agent-contributions.js'

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
    models: Object.freeze({ register: disabledNested, list: disabledNested }),
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
  // The disabled entry stays shape-compatible with the active enumeration: the
  // same discriminated envelope carrying an inert handle whose release is the
  // shared discriminated no-op. Callers keep one observation pattern across
  // active and unavailable states.
  const inertUnsubscribe = () => false
  return {
    catalog() {
      return Object.freeze({})
    },
    observe() {
      return Object.freeze({
        ok: true,
        code: 'observed',
        handle: Object.freeze({
          current: () => null,
          subscribe: () => inertUnsubscribe,
          dispose: () => staleResult('the events feature is disabled'),
          epoch: 0,
        }),
      })
    },
    availability() {
      return Object.freeze({ status: 'unavailable', reason: 'the events namespace is not mounted' })
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
    executionMode: Object.freeze({ get: fail }),
    // tool-discovery
    get discovery() {
      return typeof discoverySurface === 'function' ? discoverySurface() : discoverySurface
    },
    // tool-discovery
  }
}

// scoped-agent-contributions
/**
 * Disabled `agents.scopes` surface: the scoped-contribution feature is not
 * mounted (or is inactive), so every member reports the typed feature-disabled
 * error instead of the member being absent (a raw TypeError would be an
 * untruthful degradation for a registered public member).
 */
function createDisabledScopesApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('agents.scopes')
  }
  return Object.freeze({
    register: fail,
    snapshotOf: fail,
  })
}
// scoped-agent-contributions

// tool-discovery
// sessions.planMode
/**
 * Disabled `sessions.planMode` surface. Unlike the other session sub-faces
 * this one RETURNS typed results instead of throwing: the feature's
 * requirements select the "return, do not throw" presentation for an
 * unavailable backing, and its `availability()` never throws even when the
 * core is inert (every namespace availability member keeps that contract).
 * The member shape is identical to the live face, and
 * `surfaceFor(callerCtx)` keeps the caller-bound sub-surface contract, so the
 * namespace never disappears and callers never need a different code path.
 */
function createDisabledSessionPlanModeApi(active) {
  const assertActive = () => {
    if (!active()) throw new PluginApiInactiveError()
  }
  const reason = 'the sessions.planMode feature is not mounted in this installation'
  const unavailable = () => {
    assertActive()
    return Object.freeze({ ok: false, code: 'unavailable', reason })
  }
  const view = () => {
    assertActive()
    return Object.freeze({ target: null, active: null, observedAt: null, source: 'unavailable', reason })
  }
  const availability = () => Object.freeze({ status: 'unavailable', reason })
  const surface = Object.freeze({
    get: () => view(),
    select: () => unavailable(),
    observe: () => {
      assertActive()
      const current = Object.freeze({ target: null, active: null, observedAt: null, source: 'unavailable', reason })
      const listenerView = Object.freeze({ target: null, active: null, observedAt: null, source: 'unavailable', reason })
      return Object.freeze({
        epoch: 0,
        current: () => current,
        subscribe(listener) {
          if (typeof listener !== 'function') return () => {}
          try {
            listener(listenerView)
          } catch {
            // containment: a throwing subscriber never escapes the disabled face
          }
          return () => {}
        },
        dispose() {
          return staleResult('the disabled observation face is never live')
        },
      })
    },
    availability,
  })
  return Object.freeze({
    surfaceFor: () => surface,
    availability,
  })
}
// sessions.planMode

// sessions.permissionPresets
/**
 * Disabled `sessions.permissionPresets` surface. Mirrors the plan-mode
 * presentation contract: every member RETURNS typed results instead of
 * throwing, `availability()` never throws even when the core is inert, and the
 * member shape is identical to the live face (the namespace never disappears).
 */
function createDisabledSessionPermissionPresetsApi(active) {
  const assertActive = () => {
    if (!active()) throw new PluginApiInactiveError()
  }
  const reason = 'the sessions.permissionPresets feature is not mounted in this installation'
  const unavailable = () => {
    assertActive()
    return Object.freeze({ ok: false, code: 'unavailable', reason })
  }
  const presetView = () => {
    assertActive()
    return Object.freeze({ target: null, preset: null, observedAt: null, source: 'unavailable', reason })
  }
  const optionsView = () => {
    assertActive()
    return Object.freeze({ target: null, options: Object.freeze([]), currentValue: null, observedAt: null, source: 'unavailable', reason })
  }
  const availability = () => Object.freeze({ status: 'unavailable', reason })
  const surface = Object.freeze({
    current: () => presetView(),
    options: () => optionsView(),
    select: () => unavailable(),
    observe: () => {
      assertActive()
      const current = Object.freeze({ target: null, preset: null, observedAt: null, source: 'unavailable', reason })
      const listenerView = Object.freeze({ target: null, preset: null, options: Object.freeze([]), currentValue: null, observedAt: null, source: 'unavailable', reason })
      return Object.freeze({
        epoch: 0,
        current: () => current,
        subscribe(listener) {
          if (typeof listener !== 'function') return () => {}
          try {
            listener(listenerView)
          } catch {
            // containment: a throwing subscriber never escapes the disabled face
          }
          return () => {}
        },
        dispose() {
          return staleResult('the disabled observation face is never live')
        },
      })
    },
    availability,
  })
  return Object.freeze({
    surfaceFor: () => surface,
    availability,
  })
}
// sessions.permissionPresets

// credentials
/**
 * Disabled `credentials` surface. Mirrors the sibling presentation contract:
 * the operational members return typed results while the core is active but
 * the feature is unmounted (and throw the inactive-core error once the core
 * itself is inert), the member shape matches the live face, and
 * `availability()` never throws in any state.
 */
function createDisabledCredentialsApi(active) {
  const assertActive = () => {
    if (!active()) throw new PluginApiInactiveError()
  }
  const reason = 'the credentials feature is not mounted in this installation'
  const unavailable = () => {
    assertActive()
    return Object.freeze({ ok: false, code: 'unavailable', reason })
  }
  const availability = () => Object.freeze({ status: 'unavailable', reason })
  const surface = Object.freeze({
    set: () => unavailable(),
    unset: () => unavailable(),
    availability,
  })
  return Object.freeze({
    surfaceFor: () => surface,
    availability,
  })
}
// credentials

// sessions.compaction
/**
 * Disabled `sessions.compaction` surface. The operation entry throws the typed
 * feature-disabled error (the operation idiom's declared disabled presentation,
 * matching `sessions.branches`), while `availability()` returns a frozen typed
 * result and never throws in any state.
 */
function createDisabledSessionCompactionApi(active) {
  const assertActive = () => {
    if (!active()) throw new PluginApiInactiveError()
  }
  const reason = 'the compaction replacement is not active in this installation'
  const availability = () => Object.freeze({ status: 'unavailable', reason })
  // The disabled face keeps the exact member set of the live owner api
  // (`run` / `availability`), so the namespace never expresses its install
  // state through member presence.
  return Object.freeze({
    run: () => {
      assertActive()
      throw new PluginApiFeatureDisabledError('sessions.compaction', reason)
    },
    availability,
  })
}
// sessions.compaction

// workflows
/**
 * Disabled `workflows` surface. The operation entry throws the typed
 * feature-disabled error (the operation idiom's declared disabled
 * presentation) and `availability()` returns a frozen typed result that never
 * throws in any state.
 */
function createDisabledSessionInteractionsApi(active) {
  const assertActive = () => {
    if (!active()) throw new PluginApiInactiveError()
  }
  const reason = 'the pending-interaction authority is not available in this installation'
  const availability = () => Object.freeze({ status: 'unavailable', reason })
  const fail = () => {
    assertActive()
    throw new PluginApiFeatureDisabledError('sessions.interactions', reason)
  }
  // The disabled face keeps the caller-bound sub-surface contract so the
  // namespace never expresses its install state through member presence.
  const surface = Object.freeze({ list: fail, get: fail, respond: fail, availability })
  return Object.freeze({ surfaceFor: () => surface, availability })
}

function createDisabledSessionSelectionApi(active) {
  const assertActive = () => {
    if (!active()) throw new PluginApiInactiveError()
  }
  const reason = 'the official model selection seam is not available in this installation'
  const availability = () => Object.freeze({ status: 'unavailable', reason })
  const fail = () => {
    assertActive()
    throw new PluginApiFeatureDisabledError('sessions.selection', reason)
  }
  const surface = Object.freeze({ get: fail, set: fail, availability })
  return Object.freeze({ surfaceFor: () => surface, availability })
}

function createDisabledWorkflowsApi(active) {
  const assertActive = () => {
    if (!active()) throw new PluginApiInactiveError()
  }
  const reason = 'the official workflow engine is not available in this installation'
  const availability = () => Object.freeze({ status: 'unavailable', reason })
  // The disabled face keeps the caller-bound sub-surface contract (like the
  // credentials face): `surfaceFor` returns the exact member set of the live
  // face, so the namespace never expresses its install state through member
  // presence and the inert-core fallback resolves.
  const surface = Object.freeze({
    start: () => {
      assertActive()
      throw new PluginApiFeatureDisabledError('workflows', reason)
    },
    availability,
  })
  return Object.freeze({ surfaceFor: () => surface, availability })
}
// workflows

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

const toolDefinitionIdOf = (definition) =>
  (typeof definition?.name === 'string' && definition.name.length > 0 && definition.name)
  || (typeof definition?.id === 'string' && definition.id.length > 0 && definition.id)
  || 'anonymous'

/** Slot-token sequence for the registration handles built in this module. */
let handleGenerationSequence = 0

/**
 * Wrap one official registration verb into the shared resource handle.
 *
 * The official verb still performs the installation; the caller gets the same
 * cleanup contract as every other facade-owned registration instead of a bare
 * official disposer.
 */
function wrapOfficialRegistration(ownerId, key, id, install) {
  const officialDisposer = install()
  return createResourceHandle({
    id,
    ownerId,
    generation: `${ownerId}:${key}:${++handleGenerationSequence}`,
    revoke: () => {
      if (typeof officialDisposer !== 'function') return false
      officialDisposer()
      return true
    },
  })
}

function createToolsApi(resolveTools, discoverySurface, scopedHelpers) {
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
  // Scope-bearing registration (target dimension): the definition is
  // installed through the target agent's context, landing in that agent's
  // scoped layer. Failures are typed throws per the tools idiom, and a
  // scoped call never degrades to a global registration.
  //
  // Both branches answer with the same outer contract: a frozen resource
  // handle carrying the derived owner and a minted generation, whose
  // `dispose()` answers with a discriminated result. The target of a scoped
  // registration is a domain parameter (`targetId`), not a second identity,
  // so it rides along as a registered extension member.
  const nextHandleGeneration = (ownerKey, key) => `${ownerKey}:${key}:${++handleGenerationSequence}`
  const scopedRegister = (installer, arg, opts) => {
    if (!opts || typeof opts !== 'object' || opts.scope === undefined) {
      return undefined
    }
    const scoped = scopedHelpers?.()
    const registry = scoped?.registry
    if (!registry) {
      throw new PluginApiFeatureDisabledError('tools', 'scoped contributions are unavailable')
    }
    const scopeRecord = registry.resolveScopeToken(opts.scope)
    if (!scopeRecord) {
      throw new PluginApiFeatureDisabledError('tools', 'opts.scope must be a live scope handle from agents.scopes.register')
    }
    const ownerKey = scoped.ownerOf()
    const kind = installer === 'register' ? 'tools.register' : 'tools.restrict'
    const id = opts.id ?? (installer === 'register' ? toolDefinitionIdOf(arg) : 'restrict')
    if (registry.hasRecord(ownerKey, scopeRecord.targetId, kind, id)) {
      throw new PluginApiFeatureDisabledError('tools', `a scoped registration with id "${id}" is already active for this owner and target`)
    }
    let outcome
    try {
      outcome = registry.installScoped({
        ownerId: ownerKey,
        targetId: scopeRecord.targetId,
        handleId: scopeRecord.handle.id,
        kind,
        contributionId: id,
        install: (targetCtx) => {
          const backing = targetCtx.get('tools')
          if (!backing || typeof backing[installer] !== 'function') {
            throw new PluginApiFeatureDisabledError('tools', `the target agent's tools backing lacks "${installer}"`)
          }
          return Reflect.apply(backing[installer], backing, [arg])
        },
      }, scoped.callerCtx)
    } catch (error) {
      if (error instanceof PluginApiFeatureDisabledError) throw error
      throw new PluginApiFeatureDisabledError('tools', `scoped tool installation failed: ${String(error?.message ?? error)}`)
    }
    if (!outcome.ok) {
      throw new PluginApiFeatureDisabledError('tools', `scoped tool installation failed: ${outcome.reason ?? outcome.code}`)
    }
    const recordToken = outcome.record
    return createResourceHandle({
      id,
      ownerId: ownerKey,
      generation: nextHandleGeneration(ownerKey, id),
      extensions: { targetId: scopeRecord.targetId },
      revoke: () => {
        try {
          return registry.removeScoped(recordToken, ownerKey).status === 'ok'
        } catch {
          // disposal must never throw through the caller
          return false
        }
      },
    })
  }

  const callerOwnerKey = () => {
    try {
      return scopedHelpers?.()?.ownerOf?.() ?? ROOT_OWNER_TOKEN
    } catch {
      return ROOT_OWNER_TOKEN
    }
  }

  // Unscoped registration: the official registration verb is still the one
  // that installs the definition, but the caller does not have to learn a
  // second cleanup idiom — the raw official disposer is wrapped into the same
  // resource handle the scoped branch returns.
  const globalRegister = (installer, arg) => {
    const ownerKey = callerOwnerKey()
    const id = installer === 'register'
      ? (toolDefinitionIdOf(arg) ?? 'tool')
      : 'restrict'
    const officialDisposer = installer === 'register' ? tools().register(arg) : tools().restrict(arg)
    return createResourceHandle({
      id,
      ownerId: ownerKey,
      generation: `${ownerKey}:${id}:${++handleGenerationSequence}`,
      revoke: () => {
        if (typeof officialDisposer !== 'function') return false
        officialDisposer()
        return true
      },
    })
  }
  return Object.freeze({
    register(definition, opts) {
      const scopedOutcome = scopedRegister('register', definition, opts)
      if (scopedOutcome !== undefined) return scopedOutcome
      return globalRegister('register', definition)
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
    // verbs and answer with the same resource handle contract.
    //
    restrict: Object.freeze({
      register: (filter, opts) => {
        const scopedOutcome = scopedRegister('restrict', filter, opts)
        if (scopedOutcome !== undefined) return scopedOutcome
        return globalRegister('restrict', filter)
      },
    }),
    guard: Object.freeze({ register: (guard) => wrapOfficialRegistration(callerOwnerKey(), 'tools.guard.register', 'guard', () => tools().guard(guard)) }),
    presentation: Object.freeze({ register: (...args) => wrapOfficialRegistration(callerOwnerKey(), 'tools.presentation.register', 'presentation', () => tools().presentAs(...args)) }),
    // The official verb behind this member is a classification query, not a
    // registration: it answers with the scheduling mode of one pending call.
    // It is published under a query verb; wrapping it into a resource handle
    // would manufacture a lifecycle the official contract does not have.
    executionMode: Object.freeze({ get: (exec) => tools().executionMode(exec) }),
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
  return Object.freeze({
    render: fail,
    renderContextSections: fail,
    renderContextSnapshot: fail,
    joinContextSections: fail,
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
    availability: () => Object.freeze({ status: 'unavailable', reason: 'the sessions.branches namespace is not mounted' }),
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
    availability: () => Object.freeze({ status: 'unavailable', reason: 'the skills.activation namespace is not mounted' }),
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
    availability: Object.freeze({
      status: 'unavailable',
      reason: 'the executions namespace is not mounted',
      sources: Object.freeze({}),
      epoch: 'none',
    }),
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

function createDisabledSessionActivityApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('sessions.activity')
  }
  return Object.freeze({
    current: fail,
    get: fail,
    list: fail,
    history: fail,
    observe: fail,
    availability: () => Object.freeze({ status: 'unavailable', reason: 'the sessions.activity namespace is not mounted' }),
  })
}

function createDisabledSessionInteractionApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('sessions.request')
  }
  return Object.freeze({
    request: fail,
    cancel: fail,
    availability: () => Object.freeze({ status: 'unavailable', reason: 'the sessions.request namespace is not mounted' }),
  })
}

function createDisabledAttentionApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('attention')
  }
  return Object.freeze({
    current: fail,
    list: fail,
    observe: fail,
    contribute: fail,
    dismiss: fail,
    invoke: fail,
    availability: () => Object.freeze({ status: 'unavailable', reason: 'the attention namespace is not mounted' }),
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
      lease: Object.freeze({ acquire: fail, release: fail }),
      coverage: fail,
    }),
    audit: Object.freeze({ list: fail }),
    get availability() {
      return fail()
    },
  })
}

/** A member that reports its feature as disabled when it is exercised. */
function disabledOfficer(feature, active) {
  return () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError(feature)
  }
}

/**
 * Owner-shaped disabled candidates.
 *
 * `_disabledSurfaceFor` feeds `_restoreDisabledSurface`, which re-publishes a
 * feature's disabled form through the same internal assignment path a live
 * owner takes. The candidate therefore has to satisfy that feature's *owner*
 * contract — the guard that also protects live mounts — not the published
 * surface shape. For most features the two coincide; the ones below map owner
 * members onto different public names (or publish a property where the owner
 * exposes a function), so the published shape is not a valid candidate.
 */
function createDisabledRecoveryOwner(active) {
  const fail = disabledOfficer('executions.recovery', active)
  return Object.freeze({
    capability: Object.freeze({ register: fail }),
    policy: Object.freeze({ register: fail }),
    visibility: Object.freeze({ register: fail }),
    evaluate: fail,
    coverage: fail,
    availability: fail,
  })
}

function createDisabledCoordinationOwner(active) {
  const fail = disabledOfficer('coordination', active)
  return Object.freeze({
    availability: fail,
    acquire: fail,
    heartbeat: fail,
    release: fail,
    takeover: fail,
    compareAndSet: fail,
    watch: fail,
  })
}

function createDisabledTasksOwner(active) {
  const fail = disabledOfficer('tasks', active)
  return Object.freeze({
    register: fail,
    start: fail,
    claim: fail,
    reassign: fail,
    settle: fail,
    attach: fail,
    get: fail,
    observe: fail,
    history: fail,
  })
}

function createDisabledToolsDiscoveryOwner(active) {
  const fail = disabledOfficer('tools.discovery', active)
  return Object.freeze({
    catalog: Object.freeze({ register: fail }),
    list: fail,
    activate: fail,
    deactivate: fail,
    audit: Object.freeze({ list: fail }),
    availability: fail,
  })
}

function createDisabledSessionChannelOwner(active) {
  const fail = disabledOfficer('sessions.channels', active)
  return Object.freeze({
    open: fail,
    subscribe: fail,
    current: fail,
    observe: fail,
    onChange: fail,
    fetchEvents: fail,
    heartbeat: fail,
    ack: fail,
    resume: fail,
    revoke: fail,
    auth: Object.freeze({
      registerVerifier: fail,
      registerAuthorizer: fail,
      initiatePairing: fail,
      approvePairing: fail,
      rejectPairing: fail,
      registerPairingProvider: fail,
    }),
    redaction: Object.freeze({ registerProfile: fail }),
  })
}

function createDisabledSessionChannelApi(active) {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('sessions.channels')
  }
  return Object.freeze({
    acquire: fail,
    history: fail,
    heartbeat: fail,
    ack: fail,
    resume: fail,
    release: fail,
    current: fail,
    observe: fail,
    subscriptions: Object.freeze({ acquire: fail }),
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
    // The disabled form keeps the namespace's availability member and reports
    // the frozen unavailable state instead of throwing, matching the live set.
    availability: () => Object.freeze({ status: 'unavailable', reason: 'the workspace transaction owner is unavailable' }),
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
    // Zero-argument observation: the handle is subscribed through its own
    // `subscribe` member, never through the observe entry.
    observe: () => withCatalog('onChange')(),
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

/**
 * The availability answer of an unavailable attachments namespace. An
 * availability query is never answered with an operation failure record: it
 * carries the same detail field set the live face does, plus the reason, so a
 * probe reads one shape across both states.
 */
const ATTACHMENT_AVAILABILITY_UNAVAILABLE = Object.freeze({
  status: 'unavailable',
  reason: 'the attachments pipeline is unavailable',
  supportedMedia: Object.freeze([]),
  imageLimits: Object.freeze({}),
  limits: Object.freeze({}),
})

/** The facade's own package identity must never be attributed as a decoration owner. */
export const FACADE_OWNER_IDS = new Set(['@deepseek-ai/dsh-plugin-api-main', 'plugin-api-main'])

/**
 * Derive the calling plugin's owner identity from the caller's shadowed
 * context (fiber → loader entry row name/id). Unresolvable or facade-owned
 * identities return undefined; the facade never attributes decorations to
 * itself.
 */
/** The identity a provider-directory registration is filed under. */
function firstProviderName(entries) {
  const first = Array.isArray(entries) ? entries[0] : undefined
  const name = first !== null && typeof first === 'object' ? first.provider : undefined
  return typeof name === 'string' && name.length > 0 ? name : 'providers'
}

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
    let released = false
    // The replacement answers its own internal outcome ({ status }); the
    // public handle speaks the discriminated result the resource idiom
    // requires, with the stale/no-op case mapped onto `stale`.
    const settleDispose = (outcome) => {
      if (outcome?.status === 'ok') return Object.freeze({ ok: true, code: 'revoked' })
      const reason = typeof outcome?.reason === 'string' && outcome.reason.length > 0
        ? outcome.reason
        : 'the decoration is already revoked'
      return Object.freeze({ ok: false, code: 'stale', reason })
    }
    return Object.freeze({
      id: record.id,
      ownerId: record.ownerIdentity,
      generation: record.generation,
      dispose() {
        if (released) return staleResult('the decoration is already revoked')
        released = true
        try {
          return settleDispose(facet.dispose(record.ownerIdentity, record.id, record.generation))
        } catch (error) {
          return Object.freeze({ ok: false, code: 'unavailable', reason: String(error?.message ?? error) })
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
  const invoke = (owner, method, args, { operation = true, unavailableShape = ATTACHMENT_UNAVAILABLE } = {}) => {
    // A registration call owns its failure presentation: an unavailable
    // environment is a typed refusal the caller can act on, never an
    // availability verdict about the pipeline. Only operation-class calls
    // degrade to the discriminated unavailable result.
    const unavailable = () => {
      if (!operation) {
        throw new PluginApiFeatureDisabledError('attachments', `attachments.${owner}.${method} is unavailable`)
      }
      return unavailableShape
    }
    if (!active()) return unavailable()
    const pipeline = currentPipeline()
    const target = pipeline?.[owner]
    if (!target || typeof target[method] !== 'function') return unavailable()
    try {
      const result = Reflect.apply(target[method], target, args)
      if (result && typeof result.then === 'function') {
        return operation ? result.catch(() => unavailableShape) : result
      }
      return result
    } catch (error) {
      if (!operation) throw error
      return unavailableShape
    }
  }
  const pipeline = Object.freeze({
    ingest: (...args) => invoke('pipeline', 'ingest', args),
    transform: (...args) => invoke('pipeline', 'transform', args),
    transforms: Object.freeze({ register: (...args) => invoke('pipeline', 'registerTransform', args, { operation: false }) }),
    cleanup: (...args) => invoke('pipeline', 'cleanup', args),
    capabilities: (...args) => invoke('pipeline', 'capabilities', args),
  })
  const projection = Object.freeze({
    get: (...args) => invoke('projection', 'resolve', args),
    open: (...args) => invoke('projection', 'open', args),
    project: (...args) => invoke('projection', 'project', args),
    provenance: (...args) => invoke('projection', 'provenance', args),
    availability: (...args) => invoke('projection', 'availability', args, { unavailableShape: ATTACHMENT_AVAILABILITY_UNAVAILABLE }),
  })
  return Object.freeze({
    pipeline,
    projection,
    availability: (...args) => invoke('projection', 'availability', args, { unavailableShape: ATTACHMENT_AVAILABILITY_UNAVAILABLE }),
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
      observe(subject) {
        assertAvailable()
        // The canonical subject is `{ targetSession, kind }`; the answer is the
        // standard projection handle, and listeners attach through it.
        return Reflect.apply(facade.observeDurable, facade, [subject])
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
function composeSessionApi(baseSessionApi, durableSessionApi, branchesApi, channelsApi, interactionApi, activityApi, compactionApi, availabilityOf) {
  return Object.freeze(Object.defineProperties(
    Object.create(Object.getPrototypeOf(baseSessionApi) ?? Object.prototype),
    {
      ...Object.getOwnPropertyDescriptors(baseSessionApi),
      ...Object.getOwnPropertyDescriptors(durableSessionApi),
      ...(branchesApi === undefined ? {} : Object.getOwnPropertyDescriptors({ branches: branchesApi })),
      // sessionChannel facade
      ...(channelsApi === undefined ? {} : Object.getOwnPropertyDescriptors({ channels: channelsApi })),
      // sessionChannel facade
      // session activity projection
      ...(activityApi === undefined ? {} : Object.getOwnPropertyDescriptors({ activity: activityApi })),
      // session activity projection
      // session interaction operation
      ...(interactionApi === undefined ? {} : Object.getOwnPropertyDescriptors({ request: interactionApi.request, cancel: interactionApi.cancel })),
      // session interaction operation
      // sessions.compaction
      ...(compactionApi === undefined ? {} : Object.getOwnPropertyDescriptors({ compaction: compactionApi })),
      // sessions.compaction
      // The sessions namespace availability keeps the backing capability
      // status semantics; the session activity and interaction faces only
      // extend the caller-facing `reason` (per-context degraded/unavailable
      // layering) without changing the frozen status vocabulary.
      ...(availabilityOf === undefined ? {} : Object.getOwnPropertyDescriptors({ availability: availabilityOf })),
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
    throw new PluginApiFeatureDisabledError('settings')
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
function createContributeEntry(getBase, resolveOwnerId = () => 'caller', backingStatus = () => 'active') {
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
    const handle = createContributionHandle({
      id,
      ownerId,
      seq,
      revoke: () => {
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

/**
 * Wrap the provenance engine's contribution entry in the facade's contribution
 * contract.
 *
 * The engine owns the provenance record and its own disposal; this entry owns
 * the public contract around it: the owner derives from the calling plugin (a
 * declared owner in the spec is ignored rather than trusted), refusals answer
 * the facade's contribution codes instead of the engine's internal ones, and a
 * successful contribution answers the standard handle `{ id, ownerId, seq,
 * dispose() }` whose give-back delegates to the engine's own disposer.
 */
/**
 * Bind the recovery policy registrations to the calling plugin.
 *
 * Both policy entries take `ownerId` and `generation` from the registration
 * spec; the facade supplies the derived caller identity and a minted generation
 * instead (declared values are overwritten rather than trusted), so a caller
 * cannot claim another plugin's registration id or choose its own generation.
 * The capability declaration is deliberately not bound: its identity pair names
 * the operation under recovery, which the caller owns.
 */
function bindRecoveryPolicies(recovery, callerCtx, nextGeneration) {
  if (!recovery || typeof recovery !== 'object') return undefined
  let groups
  try {
    groups = { policy: recovery.policy, visibility: recovery.visibility }
  } catch {
    return undefined
  }
  const ownerId = deriveLlmAdaptersOwner(callerCtx) ?? 'root'
  const additions = {}
  for (const [member, kind] of [['policy', 'policy'], ['visibility', 'visibility']]) {
    const group = groups[member]
    if (!group || typeof group !== 'object') continue
    let register
    try {
      register = group.register
    } catch {
      continue
    }
    if (typeof register !== 'function') continue
    additions[member] = composeSurface(group, {
      register: (input) => register(
        input === null || typeof input !== 'object'
          ? input
          : { ...input, ownerId, generation: `${ownerId}:${kind}:${nextGeneration()}` },
      ),
    })
  }
  return Object.keys(additions).length === 0 ? undefined : composeSurface(recovery, additions)
}

/**
 * Bind the execution visibility registration to the calling plugin.
 *
 * The visibility engine takes a declared owner from the spec; the facade
 * supplies the derived caller identity instead (a declared owner is ignored
 * rather than trusted) and answers the standard resource handle whose release
 * delegates to the engine's own disposer. A surface with no visibility
 * registration at all is published as it is; a disabled one keeps refusing
 * through the wrapped entry, in the order it always did.
 */
function bindExecutionVisibility(executions, callerCtx, nextGeneration) {
  let visibility
  try {
    visibility = executions?.visibility
  } catch {
    return undefined
  }
  if (!visibility || typeof visibility.register !== 'function') return undefined
  const ownerId = deriveLlmAdaptersOwner(callerCtx) ?? 'root'
  return Object.freeze({
    ...visibility,
    register: (spec) => {
      // A spec that cannot be a policy is handed to the owner untouched, so a
      // disabled or inactive surface keeps refusing in its own order and with
      // its own error, exactly as it did before the owner was bound here.
      if (spec === null || typeof spec !== 'object') return visibility.register(spec)
      const release = visibility.register({ ...spec, ownerId })
      if (typeof release !== 'function') {
        throw new TypeError('the visibility engine did not answer a disposer')
      }
      return createResourceHandle({
        id: typeof spec.id === 'string' ? spec.id : String(spec.id),
        ownerId,
        generation: `${ownerId}:visibility:${nextGeneration()}`,
        revoke: () => release() === true,
      })
    },
  })
}

/**
 * Bind the activation registration entries to the calling plugin.
 *
 * Both entries are registrations, so both answer the standard resource handle:
 * the derived caller identity replaces whatever the spec declared, the facade
 * mints the handle generation, and the release path delegates to the owner's
 * own unregister so the activation engine stays the single state owner. The
 * registration keeps its async call shape (the owner verifies the official
 * registry before it registers), and a refusal answers the typed throw the
 * registration idiom requires — synchronously for a malformed spec, as a
 * rejection for an owner refusal. The domain convenience members the skill
 * variant used to carry (skill id plus the activation reads) stay on the
 * handle, so unifying the shape removes no capability.
 */
function bindSkillsActivation(activation, callerCtx, nextGeneration, ownerApi) {
  if (!activation || typeof activation !== 'object') return activation
  const ownerId = deriveLlmAdaptersOwner(callerCtx) ?? 'root'
  const additions = {}

  const register = activation.register
  if (typeof register === 'function') {
    additions.register = (spec) => {
      const plan = planSkillsRegistration(spec)
      // A spec the facade cannot bind an owner to is handed to the owner
      // untouched: a disabled surface keeps refusing with its own typed error,
      // and a live owner keeps answering its invalid-input error.
      if (plan === undefined) return register(spec)
      const bound = plan.kind === 'skill'
        ? { ...spec, skill: { ...spec.skill, owner: ownerId } }
        : { ...spec, owner: ownerId }
      const outcome = register(bound)
      return Promise.resolve(outcome).then((result) => {
        if (result?.ok !== true) {
          throw new PluginApiError(
            typeof result?.code === 'string' && result.code.length > 0 ? result.code : 'SKILLS_REGISTER_REFUSED',
            String(result?.reason ?? `skills.activation.register refused the ${plan.kind} registration`),
          )
        }
        const engineHandle = result.handle
        const engineGeneration = result.generation
        const revoke = plan.kind === 'skill' && typeof engineHandle?.dispose === 'function'
          ? () => engineHandle.dispose()?.ok === true
          : () => {
              // The release path is the owner's own unregister; it is not a
              // published facade member, so it is reached through the owner
              // api the slot captured rather than through the guarded surface.
              // It names the generation this registration was issued for, so a
              // superseded handle cannot revoke its replacement.
              const unregister = ownerApi?.unregisterDescriptor
              if (typeof unregister !== 'function') {
                throw new TypeError('the activation owner cannot unregister a descriptor')
              }
              return unregister.call(ownerApi, plan.id, ownerId, engineGeneration)?.ok === true
            }
        return createResourceHandle({
          id: plan.id,
          ownerId,
          generation: `${ownerId}:skills-activation:${nextGeneration()}`,
          extensions: {
            skillId: plan.id,
            activate: (request) => activation.activate(plan.id, request),
            deactivate: (generation, scope) => activation.deactivate(plan.id, generation, scope),
            exposure: (generation) => activation.exposure(plan.id, generation),
          },
          revoke,
        })
      })
    }
  }

  const policy = activation.policy
  if (policy && typeof policy.register === 'function') {
    const policyRegister = policy.register
    additions.policy = composeSurface(policy, {
      register: (input) => {
        // A malformed policy spec is handed to the owner untouched, so the
        // owner keeps refusing it its own way.
        if (input === null || typeof input !== 'object') return policyRegister(input)
        const outcome = policyRegister({ ...input, ownerId })
        if (outcome?.ok !== true) {
          throw new PluginApiError(
            typeof outcome?.code === 'string' && outcome.code.length > 0 ? outcome.code : 'SKILLS_POLICY_REGISTER_REFUSED',
            String(outcome?.reason ?? 'skills.activation.policy.register refused the policy'),
          )
        }
        const release = outcome.dispose
        return createResourceHandle({
          id: typeof input.key === 'string' ? `${input.kind}:${input.key}` : String(input.key),
          ownerId,
          generation: `${ownerId}:skills-activation-policy:${nextGeneration()}`,
          revoke: () => (typeof release === 'function' ? release()?.revoked === true : false),
        })
      },
    })
  }

  return Object.keys(additions).length === 0 ? activation : composeSurface(activation, additions)
}

/** Resolve the registration kind, resource id and release plan of a spec. */
function planSkillsRegistration(spec) {
  if (spec === null || typeof spec !== 'object') return undefined
  if (spec.kind === 'skill') {
    const name = spec.skill?.name ?? spec.id
    if (typeof name !== 'string' || name.length === 0) return undefined
    return { kind: 'skill', id: name }
  }
  if (spec.kind === 'descriptor') {
    const skillId = spec.skillId ?? spec.id
    if (typeof skillId !== 'string' || skillId.length === 0) return undefined
    return { kind: 'descriptor', id: skillId }
  }
  return undefined
}

/**
 * Bind the channel registration entries to the calling plugin.
 *
 * Authentication verifiers, pairing providers, and redaction profiles are
 * registrations, so each one carries the derived caller identity (or the root
 * token when the caller cannot be traced) instead of a constant owner: a slot
 * another plugin holds is refused typed, and the release only removes the
 * entry the handle was issued for. A spec the facade cannot read is handed to
 * the owner untouched, so a disabled face keeps refusing in its own order.
 */
function bindChannelRegistrations(channels, callerCtx) {
  if (!channels || typeof channels !== 'object') return channels
  const ownerId = deriveLlmAdaptersOwner(callerCtx) ?? 'root'
  const additions = {}
  const bind = (group, names) => {
    if (!group || typeof group !== 'object') return undefined
    const wrapped = {}
    for (const name of names) {
      if (typeof group[name] !== 'function') continue
      wrapped[name] = (spec, ...rest) => (
        spec === null || typeof spec !== 'object'
          ? group[name](spec, ...rest)
          : group[name](spec, ownerId, ...rest)
      )
    }
    return Object.keys(wrapped).length === 0 ? undefined : wrapped
  }
  const auth = bind(channels.auth, ['register', 'registerVerifier', 'registerAuthorizer'])
  if (auth !== undefined) additions.auth = composeSurface(channels.auth, auth)
  if (channels.auth?.pairingProvider && typeof channels.auth.pairingProvider.register === 'function') {
    additions.auth = composeSurface(additions.auth ?? channels.auth, {
      pairingProvider: Object.freeze({
        register: (spec, ...rest) => (
          spec === null || typeof spec !== 'object'
            ? channels.auth.pairingProvider.register(spec, ...rest)
            : channels.auth.pairingProvider.register(spec, ownerId, ...rest)
        ),
      }),
    })
  }
  const redaction = bind(channels.redaction, ['register'])
  if (redaction !== undefined) additions.redaction = composeSurface(channels.redaction, redaction)
  return Object.keys(additions).length === 0 ? channels : composeSurface(channels, additions)
}

function createProvenanceContributeEntry(contribute, resolveOwnerId = () => 'caller') {
  let sequence = 0
  return (spec) => {
    if (!spec || typeof spec !== 'object') {
      return Object.freeze({ ok: false, code: 'invalid-input', reason: 'prompts.provenance.contribute requires a contribution spec' })
    }
    const ownerId = resolveOwnerId()
    let outcome
    try {
      outcome = contribute({ ...spec, owner: ownerId })
    } catch (error) {
      if (error instanceof PluginApiInactiveError || error instanceof PluginApiFeatureDisabledError) throw error
      return Object.freeze({ ok: false, code: 'error', reason: String(error?.message ?? error) })
    }
    if (outcome?.ok !== true || !outcome.handle) {
      const code = outcome?.code === 'CONTRIBUTION_CONFLICT'
        ? 'conflict'
        : outcome?.code === 'CONTRIBUTION_INVALID' ? 'invalid-input' : 'unavailable'
      return Object.freeze({
        ok: false,
        code,
        reason: String(outcome?.detail ?? 'the provenance contribution was refused'),
      })
    }
    const engineHandle = outcome.handle
    const handle = createContributionHandle({
      id: engineHandle.id,
      ownerId,
      seq: ++sequence,
      revoke: () => {
        const released = engineHandle.dispose()
        return released?.ok === true && released.already !== true
      },
    })
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
function createCapabilitiesApi({ active, resolveFeatureStatus, resolveSurfaceMember }) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const statusOfDescriptor = (descriptor) => {
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
  /** The longest registered capability path that prefixes a member path. */
  const nearestClusterOf = (capability) => {
    let best
    for (const path of CAPABILITY_PATHS) {
      if (!capability.startsWith(`${path}.`)) continue
      if (best === undefined || path.length > best.length) best = path
    }
    return best
  }
  /**
   * Resolve one capability query.
   *
   * A registered capability path answers with its own cluster state. A member
   * path answers only when it really resolves on the live surface, and then
   * with the state of its nearest registered capability cluster. An
   * unresolvable path answers the unknown-capability result instead of a
   * throw, so a generic preflight probe never needs a try/catch; `require`
   * keeps its typed throw.
   */
  const resolveOf = (capability) => {
    const descriptor = capabilityDescriptor(capability)
    if (descriptor) return { capability, status: statusOfDescriptor(descriptor) }
    if (typeof resolveSurfaceMember !== 'function' || !resolveSurfaceMember(capability)) {
      return { capability, status: 'unavailable', reason: 'unknown capability' }
    }
    const cluster = nearestClusterOf(capability)
    const clusterDescriptor = cluster === undefined ? undefined : capabilityDescriptor(cluster)
    if (!clusterDescriptor) {
      return { capability, status: 'unavailable', reason: 'unknown capability' }
    }
    return { capability, status: statusOfDescriptor(clusterDescriptor) }
  }
  return Object.freeze({
    get: (capability) => {
      if (!isActive()) throw new PluginApiInactiveError()
      const path = typeof capability === 'string' ? capability : String(capability)
      return Object.freeze(resolveOf(path))
    },
    list: ({ prefix } = {}) => {
      if (!isActive()) throw new PluginApiInactiveError()
      return Object.freeze(
        CAPABILITY_PATHS.filter((path) => prefix === undefined || path.startsWith(prefix)),
      )
    },
    require: (capabilities = []) => {
      if (!isActive()) throw new PluginApiInactiveError()
      const missing = []
      for (const capability of capabilities) {
        const path = typeof capability === 'string' ? capability : String(capability)
        if (resolveOf(path).status === 'unavailable') missing.push(capability)
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
      this._llmAdapterRegistration = null
      this._llmAdaptersSurface = createConditionalLlmAdaptersSurface(
        active,
        () => (typeof this._llmAdaptersProvider === 'function' ? this._llmAdaptersProvider() : null),
        () => this._registry?.isActive?.('llmAdapters') === true,
      )
      this._installLlmSlot('llm/request', createDisabledRequestApi(active))
      this._installLlmSlot('llm/admission', createDisabledAdmissionApi(active))
      this._requestTransformsCallerCache = new Map()
      this._admissionPoliciesCallerCache = new Map()
      Object.defineProperty(this, 'llm', {
        enumerable: true,
        configurable: false,
        get() {
          // agent-style caller capture: `this` is the caller's (shadowed)
          // context, so `this.ctx` carries the caller fiber identity used to
          // mint the decoration owner binding and to resolve the registration
          // owner of the llm registries.
          const callerCtx = this?.ctx ?? this
          const adapters = this._llmAdaptersForCaller(callerCtx)
          const base = this._llmBaseApi
          return this._decoratedNamespaces(['llm', 'llm.routing'], composeSurface(base, {
            admissionPolicies: this._admissionPoliciesForCaller(callerCtx),
            requestTransforms: this._requestTransformsForCaller(callerCtx),
            adapters,
            routing: this._routingForCaller(callerCtx),
            providers: this._llmProvidersForCaller(callerCtx),
            models: this._llmModelsForCaller(callerCtx),
          }))
        },
      })
      this._eventsSurface = createDisabledEventsApi(active)
      Object.defineProperty(this, 'events', {
        enumerable: true,
        configurable: false,
        get() {
          // Caller capture: `this` is the caller's (shadowed) context, so the
          // decisions member binds owner derivation to the calling plugin.
          const callerCtx = this?.ctx ?? this
          let surface = this._eventsSurface
          try {
            const member = this._decisionParticipationProviders?.events?.(callerCtx)
            if (member && surface && typeof surface === 'object') {
              surface = composeSurface(surface, { decisions: member })
            }
          } catch {
            // a broken participation member degrades alone
          }
          return this._decoratedNamespaces(['events'], surface)
        },
      })

      this._executionSlot = null
      this._executionSurface = createDisabledExecutionApi(active)
      // The registration generation sequence belongs to the service, not to a
      // caller view (a method-style getter receives the view as `this`, so the
      // counter is closed over here instead of being stored on the receiver).
      let registrationSequence = 0
      Object.defineProperty(this, 'executions', {
        enumerable: true,
        configurable: false,
        // A method-style getter: the Cordis tracing proxy binds the accessing
        // context as the receiver, so the caller identity below is the reader's
        // (an arrow getter would close over the facade service itself).
        get() {
          const callerCtx = this?.ctx ?? this
          const executions = this._executionSlot ? this._executionSlot.surface : this._executionSurface
          const recovery = this._recoveryWithCheckpointsSurface !== null
            ? this._recoveryWithCheckpointsSurface
            : (this._recoverySlot ? this._recoverySlot.surface : this._recoverySurface)
          const additions = { recovery }
          const nextGeneration = () => ++registrationSequence
          // The registration entries carry the derived caller identity and the
          // facade-minted generation, like the rest of the registration plane;
          // the engines keep their own records. The capability declaration is
          // left as it is: its scopeOwner/scopeGeneration name the operation
          // under recovery (the pair the evaluate call matches on), not the
          // plugin that declares it.
          const boundRecovery = bindRecoveryPolicies(recovery, callerCtx, nextGeneration)
          if (boundRecovery !== undefined) additions.recovery = boundRecovery
          const bound = bindExecutionVisibility(executions, callerCtx, nextGeneration)
          if (bound !== undefined) additions.visibility = bound
          return this._decoratedNamespaces(['executions', 'executions.recovery', 'executions.recovery.checkpoints'], composeSurface(executions, additions))
        },
      })

      this._recoverySlot = null
      this._recoverySurface = createDisabledRecoveryApi(active)
      this._recoveryWithCheckpointsSurface = null
      this._checkpointsSlot = null

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
        // A method-style getter is required here: Cordis binds the accessing
        // caller context as the receiver, so `this.ctx` is the calling plugin.
        // An arrow getter would close over the facade service and derive the
        // facade's own identity instead.
        get() {
          return this._decoratedNamespaces(['storage'], this._storageForCaller(this?.ctx ?? this))
        },
      })

      this._workspaceTransactionsSlot = null
      this._workspaceTransactionsSurface = createDisabledWorkspaceTransactionsApi(active)
      Object.defineProperty(this, 'workspaces', {
        enumerable: true,
        configurable: false,
        // A method-style getter is required here (see `storage` above): the
        // receiver is the calling plugin's context, not the facade service.
        get() {
          const callerCtx = this?.ctx ?? this
          const slot = this._workspaceTransactionsSlot
          return this._decoratedNamespaces(['workspaces', 'workspaces.transactions'], Object.freeze({
            transactions: slot ? this._workspacesForCaller(slot, callerCtx) : this._workspaceTransactionsSurface,
          }))
        },
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
        // A method-style getter is required here (see `storage` above): the
        // receiver is the calling plugin's context, not the facade service.
        get() {
          const callerCtx = this?.ctx ?? this
          const slot = this._securitySlot
          return this._decoratedNamespaces(['security'], slot ? this._securityForCaller(slot, callerCtx) : this._securitySurface)
        },
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
      // attention: the hub lives in the host mounter; the facade publishes the
      // caller-bound surface through the provider (per-caller owner/kind/scopes
      // binding, mirroring the llm.adapters caller-capture pattern).
      this._attentionProvider = null
      this._attentionSlot = null
      this._attentionSurface = createDisabledAttentionApi(active)



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
          // Caller capture: `this` is the caller's (shadowed) context, so the
          // discovery catalog registration can derive its owner from whoever
          // is asking rather than from the context that mounted the surface.
          const callerCtx = this?.ctx ?? this
          let surface
          if (!this._toolsMounted) {
            surface = this._decoratedNamespaces(['tools', 'tools.discovery'], this._toolsDisabled)
          } else {
            // Official tools methods retain caller-fiber resolution at invocation.
            surface = this._decoratedNamespaces(['tools', 'tools.discovery'], createToolsApi(
              () => (typeof this.ctx?.get === 'function' ? this.ctx.get('tools') : undefined),
              // tool-discovery
              () => this._toolsDiscoveryForCaller(callerCtx),
              // tool-discovery
              () => {
                return {
                  registry: this._scopedContributionFeature?.registry ?? null,
                  ownerOf: () => deriveLlmAdaptersOwner(callerCtx) ?? 'caller',
                  callerCtx,
                }
              },
            ))
          }
          try {
            const callerCtx = this?.ctx ?? this
            const member = this._decisionParticipationProviders?.tools?.(callerCtx)
            if (member && surface && typeof surface === 'object') {
              surface = composeSurface(surface, { executionPolicies: member })
            }
          } catch {
            // a broken participation member degrades alone
          }
          return surface
        },
      })
      this._agentFactory = () => createDisabledAgentApi(active)
      this._agentToken = null
      this._agentExtensions = new Map()
      this._scopedContributionFeature = null
      this._scopedContributionSeq = 0
      Object.defineProperty(this, 'agents', {
        enumerable: true,
        configurable: false,
        get() {
          let view = this._agentFactory(this.ctx)
          for (const extension of this._agentExtensions.values()) {
            view = extension(this.ctx, view)
          }
          let composed = this._decoratedNamespaces(['agents'], composeSurface(view))
          try {
            const callerCtx = this?.ctx ?? this
            const member = this._decisionParticipationProviders?.agents?.(callerCtx)
            if (member && composed && typeof composed === 'object') {
              composed = composeSurface(composed, { decisions: member })
            }
          } catch {
            // a broken participation member degrades alone
          }
          try {
            // scoped contributions: scope-bound handles on the agents domain.
            // Without the feature the member stays present as a typed disabled
            // surface (never an absent member, never a raw TypeError).
            const callerCtx = this?.ctx ?? this
            const scopes = this._scopedContributionFeature?.providers?.agents?.(callerCtx)?.scopes
              ?? createDisabledScopesApi(active)
            if (composed && typeof composed === 'object') {
              composed = composeSurface(composed, { scopes })
            }
          } catch {
            // a broken scopes member degrades alone
          }
          return composed
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
      // session activity projection
      this._sessionActivitySlot = null
      this._sessionActivitySurface = createDisabledSessionActivityApi(() => this._active())
      // session activity projection
      // sessions.planMode
      this._sessionPlanModeSlot = null
      this._sessionPlanModeSurface = createDisabledSessionPlanModeApi(() => this._active())
      // sessions.planMode
      // sessions.permissionPresets
      this._sessionPermissionPresetsSlot = null
      this._sessionPermissionPresetsSurface = createDisabledSessionPermissionPresetsApi(() => this._active())
      // pending interactions: the sub-surface is caller-bound (respond derives
      // its owner from the calling fiber) and the last-resort answerer is
      // registered by the mounter.
      this._sessionInteractionsSlot = null
      this._sessionInteractionsSurface = createDisabledSessionInteractionsApi(() => this._active())
      // model selection: caller-bound coordinated mutation over the official
      // apiProxy selection seam.
      this._sessionSelectionSlot = null
      this._sessionSelectionSurface = createDisabledSessionSelectionApi(() => this._active())
      // sessions.permissionPresets
      // session interaction operation
      this._sessionInteractionSlot = null
      this._sessionInteractionSurface = createDisabledSessionInteractionApi(() => this._active())
      // credentials
      this._credentialsSlot = null
      this._credentialsSurface = createDisabledCredentialsApi(() => this._active())
      Object.defineProperty(this, 'credentials', {
        enumerable: true,
        configurable: false,
        // Method-style getter on purpose: cordis invokes accessors with the
        // accessing context as the receiver, so `this` is the caller's shadowed
        // context (the caller-bound write members derive their owner from it).
        get() {
          const slot = this._credentialsSlot ? this._credentialsSlot.surface : this._credentialsSurface
          if (!slot || typeof slot.surfaceFor !== 'function') return this._decoratedNamespaces(['credentials'], slot)
          const callerCtx = this?.ctx ?? this
          let member
          try {
            member = slot.surfaceFor(callerCtx)
          } catch {
            // A live slot refuses while the core is inert: publish the typed
            // disabled face instead of dropping the member.
            try {
              member = createDisabledCredentialsApi(() => this._active()).surfaceFor(callerCtx)
            } catch {
              member = null
            }
          }
          const surface = member && typeof member === 'object' ? member : slot
          return this._decoratedNamespaces(['credentials'], surface)
        },
      })
      // credentials
      // sessions.compaction
      this._sessionCompactionSlot = null
      this._sessionCompactionSurface = createDisabledSessionCompactionApi(() => this._active())
      // sessions.compaction
      // workflows
      this._workflowsSlot = null
      this._workflowsSurface = createDisabledWorkflowsApi(() => this._active())
      Object.defineProperty(this, 'workflows', {
        enumerable: true,
        configurable: false,
        // Method-style getter on purpose: cordis invokes accessors with the
        // accessing context as the receiver, so `this` is the caller's shadowed
        // context (the owner attribution of a started run derives from it).
        get() {
          const slot = this._workflowsSlot ? this._workflowsSlot.surface : this._workflowsSurface
          if (!slot || typeof slot.surfaceFor !== 'function') return this._decoratedNamespaces(['workflows'], slot)
          const callerCtx = this?.ctx ?? this
          let member
          try {
            member = slot.surfaceFor(callerCtx)
          } catch {
            try {
              member = createDisabledWorkflowsApi(() => this._active()).surfaceFor(callerCtx)
            } catch {
              member = null
            }
          }
          const surface = member && typeof member === 'object' ? member : slot
          return this._decoratedNamespaces(['workflows'], surface)
        },
      })
      // workflows
      // session interaction operation
      this._sessionSurface = null
      // decision participation: per-namespace member providers; disabled
      // providers keep the member shape before the feature mounts.
      this._decisionParticipationProviders = createDisabledDecisionProviders()
      Object.defineProperty(this, 'sessions', {
        enumerable: true,
        configurable: false,
        // Method-style getter on purpose: cordis invokes accessors with the
        // accessing context as the receiver, so `this` is the caller's shadowed
        // context here (the same capture the `agents`/`llm`/`events` faces use).
        // An arrow getter would bind the service's own context and the
        // caller-bound plan-mode owner derivation would attribute every switch
        // to the facade itself.
        get() {
          const decorated = this._decoratedNamespaces(['sessions', 'sessions.branches', 'sessions.channels', 'sessions.views', 'sessions.activity', 'sessions.compaction', 'sessions.interactions', 'sessions.selection'], this._sessionSurface)
          if (!decorated || typeof decorated !== 'object') return decorated
          const callerCtx = this?.ctx ?? this
          // sessions.planMode / sessions.permissionPresets: these sub-surfaces
          // are caller-bound (their write members derive the owner from the
          // calling plugin fiber), so they are materialized per access on top of
          // the cached decorated surface — the same pattern the caller-bound
          // members of `agents`/`events` use. Each disabled surface always
          // exists, so a namespace never disappears.
          const subFaces = {
            planMode: {
              slot: this._sessionPlanModeSlot,
              fallback: () => this._sessionPlanModeSurface,
              disabled: () => createDisabledSessionPlanModeApi(() => this._active()),
            },
            permissionPresets: {
              slot: this._sessionPermissionPresetsSlot,
              fallback: () => this._sessionPermissionPresetsSurface,
              disabled: () => createDisabledSessionPermissionPresetsApi(() => this._active()),
            },
            interactions: {
              slot: this._sessionInteractionsSlot,
              fallback: () => this._sessionInteractionsSurface,
              disabled: () => createDisabledSessionInteractionsApi(() => this._active()),
            },
            selection: {
              slot: this._sessionSelectionSlot,
              fallback: () => this._sessionSelectionSurface,
              disabled: () => createDisabledSessionSelectionApi(() => this._active()),
            },
          }
          let composed = decorated
          // Channel registrations carry the derived caller identity, so they
          // are bound per access like the other caller-bound sub-faces.
          try {
            const channels = composed?.channels
            if (channels !== undefined) composed = composeSurface(composed, { channels: bindChannelRegistrations(channels, callerCtx) })
          } catch {
            // a broken channel face degrades alone
          }
          for (const [name, face] of Object.entries(subFaces)) {
            const slot = face.slot ? face.slot.surface : face.fallback()
            if (!slot || typeof slot.surfaceFor !== 'function') continue
            const compose = (member) => (member && typeof member === 'object' ? composeSurface(composed, { [name]: member }) : composed)
            try {
              composed = compose(slot.surfaceFor(callerCtx))
            } catch {
              // A live slot refuses while the core is inert: publish the typed
              // disabled face instead of dropping the member, so the namespace
              // keeps its exact shape in every state.
              try {
                composed = compose(face.disabled().surfaceFor(callerCtx))
              } catch {
                // a broken member degrades alone
              }
            }
          }
          return composed
        },
      })
      // skills activation facade
      this._skillsActivationSlot = null
      this._skillsActivationSurface = createDisabledSkillsActivationApi(() => this._active())
      this._skillsSurface = null
      Object.defineProperty(this, 'skills', {
        enumerable: true,
        configurable: false,
        // Method-style for the same reason as `executions`: only a method-style
        // getter receives the accessing context as its receiver, which is what
        // the activation registrations bind their owner to.
        get() {
          const callerCtx = this?.ctx ?? this
          const slot = this._skillsActivationSlot
          const base = slot ? slot.surface : this._skillsActivationSurface
          const bound = bindSkillsActivation(base, callerCtx, () => ++registrationSequence, slot?.api)
          return this._decoratedNamespaces(['skills', 'skills.activation'], composeSurface(this._skillsSurface, { activation: bound }))
        },
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
        // A member path answers for its nearest capability cluster only after
        // it resolves on the live surface (any depth); an unresolvable path is
        // unknown, so it never inherits a namespace state it does not own.
        resolveSurfaceMember: (path) => {
          let target = this
          for (const segment of path.split('.')) {
            if (target === null || target === undefined) return false
            if (typeof target !== 'object' && typeof target !== 'function') return false
            let value
            try {
              value = target[segment]
            } catch {
              return false
            }
            if (value === undefined) return false
            target = value
          }
          return true
        },
      })
      this._namespaceAvailability = createNamespaceAvailability({ resolveFeatureStatus })
      this._resolveFeatureStatus = resolveFeatureStatus
      this._namespaceDecorateCache = new WeakMap()
      Object.defineProperties(this, {
        prompts: { enumerable: true, configurable: false, get() { return this._decoratedNamespaces(['prompts', 'prompts.provenance'], this._promptsSurface()) } },
        settings: { enumerable: true, configurable: false, get: () => this._decoratedNamespaces(['settings'], this._settingsForCaller(this?.ctx ?? this)) },
        services: { enumerable: true, configurable: false, get: () => this._servicesSurface },
        remotes: { enumerable: true, configurable: false, get: () => this._decoratedNamespaces(['remotes'], this._remoteSurface) },
        diagnostics: { enumerable: true, configurable: false, get() {
          // Bind the registration member to the caller's identity, so a check
          // registered through this surface is owned by whoever asked for it
          // rather than by a later visitor to the same namespace.
          return this._decoratedNamespaces(['diagnostics'], this._diagnosticsForCaller(this?.ctx ?? this))
        } },
        attachments: { enumerable: true, configurable: false, get: () => this._decoratedNamespaces(['attachments', 'attachments.projection'], this._attachmentsSurface) },
        capabilities: { enumerable: true, configurable: false, get: () => this._capabilitiesSurface },
        attention: {
          enumerable: true,
          configurable: false,
          get() {
            // agent-style caller capture: `this` is the caller's (shadowed)
            // context; the mounter-provided surface binds owner/kind/scopes to
            // that caller fiber identity per read.
            const callerCtx = this?.ctx ?? this
            let surface = this._attentionSurface
            const provider = this._attentionProvider
            if (typeof provider === 'function') {
              try {
                const provided = provider(callerCtx)
                if (provided && typeof provided === 'object') surface = provided
              } catch {
                // provider failures keep the typed disabled surface
              }
            }
            return this._decoratedNamespaces(['attention'], surface)
          },
        },
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
      const interaction = this._sessionInteractionSlot?.surface
      const activity = this._sessionActivitySlot?.surface
      const service = this
      const availabilityOf = () => {
        // Backing capability status (unchanged semantics: session +
        // sessionDurable drive the frozen status vocabulary). The session
        // activity and interaction faces only layer a caller-facing reason
        // onto degraded/unavailable states.
        const descriptor = capabilityDescriptor('sessions')
        const statuses = (descriptor?.features ?? []).map((feature) => service._resolveFeatureStatus?.(feature) === true)
        const activeCount = statuses.filter(Boolean).length
        const status = statuses.length > 0 && activeCount === statuses.length
          ? 'active'
          : activeCount === 0
            ? 'unavailable'
            : 'degraded'
        const details = []
        if (interaction) {
          try {
            const probe = interaction.availability?.()
            if (probe && probe.status !== undefined && probe.status !== 'active') {
              details.push(`session request/cancel ${probe.status}${typeof probe.reason === 'string' && probe.reason ? `: ${probe.reason}` : ''}`)
            }
          } catch {
            // availability probes never throw through the composed surface
          }
        }
        if (activity) {
          try {
            const probe = activity.availability?.()
            if (probe && probe.status !== undefined && probe.status !== 'active') {
              details.push(`session activity ${probe.status}`)
            }
          } catch {
            // availability probes never throw through the composed surface
          }
        }
        const planMode = this._sessionPlanModeSlot
        if (planMode) {
          try {
            const probe = planMode.api?.availability?.()
            if (probe && probe.status !== undefined && probe.status !== 'active') {
              details.push(`plan mode ${probe.status}${typeof probe.reason === 'string' && probe.reason ? `: ${probe.reason}` : ''}`)
            }
          } catch {
            // availability probes never throw through the composed surface
          }
        }
        const compaction = this._sessionCompactionSlot
        if (compaction) {
          try {
            const probe = compaction.api?.availability?.()
            if (probe && probe.status !== undefined && probe.status !== 'active') {
              details.push(`compaction ${probe.status}${typeof probe.reason === 'string' && probe.reason ? `: ${probe.reason}` : ''}`)
            }
          } catch {
            // availability probes never throw through the composed surface
          }
        }
        const interactions = this._sessionInteractionsSlot
        if (interactions) {
          try {
            const probe = interactions.api?.availability?.()
            if (probe && probe.status !== undefined && probe.status !== 'active') {
              details.push(`interactions ${probe.status}${typeof probe.reason === 'string' && probe.reason ? `: ${probe.reason}` : ''}`)
            }
          } catch {
            // availability probes never throw through the composed surface
          }
        }
        const selection = this._sessionSelectionSlot
        if (selection) {
          try {
            const probe = selection.api?.availability?.()
            if (probe && probe.status !== undefined && probe.status !== 'active') {
              details.push(`selection ${probe.status}${typeof probe.reason === 'string' && probe.reason ? `: ${probe.reason}` : ''}`)
            }
          } catch {
            // availability probes never throw through the composed surface
          }
        }
        const permissionPresets = this._sessionPermissionPresetsSlot
        if (permissionPresets) {
          try {
            const probe = permissionPresets.api?.availability?.()
            if (probe && probe.status !== undefined && probe.status !== 'active') {
              details.push(`permission presets ${probe.status}${typeof probe.reason === 'string' && probe.reason ? `: ${probe.reason}` : ''}`)
            }
          } catch {
            // availability probes never throw through the composed surface
          }
        }
        return Object.freeze({
          status,
          ...(details.length > 0 ? { reason: details.join('; ') } : {}),
        })
      }
      this._sessionSurface = composeSessionApi(
        this._baseSessionApi,
        this._durableSessionApi,
        this._sessionBranchSurface,
        this._sessionChannelSurface,
        interaction,
        activity,
        this._sessionCompactionSlot ? this._sessionCompactionSlot.surface : this._sessionCompactionSurface,
        availabilityOf,
      )
    }

    _publishRecoverySurface() {
      const base = this._recoverySlot ? this._recoverySlot.surface : this._recoverySurface
      this._recoveryWithCheckpointsSurface = this._checkpointsSlot
        ? composeSurface(base, { checkpoints: this._checkpointsSlot.surface })
        : base
      return this._recoveryWithCheckpointsSurface
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
      const provenanceBase = this._contextSlot ? this._contextSlot.surface : this._contextSurface
      // The provenance contribution enters through the standard contribution
      // idiom; the rest of the provenance face is published as the engine
      // reports it.
      const provenance = provenanceBase && typeof provenanceBase.contribute === 'function'
        ? Object.freeze({ ...provenanceBase, contribute: createProvenanceContributeEntry(provenanceBase.contribute, () => ownerKey) })
        : provenanceBase
      // The five reversible assembly inputs merged into prompts.contribute and
      // the assemble passthrough (migrated to services.prompts); the composed
      // prompts face keeps the projection and self-description members.
      const { section, context, variable, tools: promptTools, suppressRuntimeContext, assemble, ...baseRest } = base ?? {}
      const globalContribute = createContributeEntry(
        () => this._systemPromptSurface,
        // The contribution owner is the calling plugin; an explicit
        // spec.ownerId is ignored rather than trusted.
        () => ownerKey,
        () => (this._resolveFeatureStatus?.('systemPrompt') ? 'active' : 'unavailable'),
      )
      // Scope-bearing specs take the target-dimension path (installed into
      // the target agent's scoped layer); everything else keeps the global
      // contribution entry unchanged.
      const contribute = (spec) => {
        if (spec && typeof spec === 'object' && spec.scope !== undefined) {
          return this._installScopedPromptContribution(spec, callerCtx, ownerKey)
        }
        return globalContribute(spec)
      }
      const surface = composeSurface(baseRest, {
        provenance,
        contribute,
        // decision participation: the caller-bound assemblyPolicies member
        // (a broken member degrades alone and is simply absent). The cache is
        // republished by the participation mounter on mount and teardown, so
        // the published identity stays stable between those transitions.
        ...(() => {
          try {
            const member = this._decisionParticipationProviders?.prompts?.(callerCtx)
            return member ? { assemblyPolicies: member } : {}
          } catch {
            return {}
          }
        })(),
      })
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
        // The observation entry takes a single subject: `{ session }` in the
        // canonical options form, or the bare session as the convenience form;
        // listeners attach through the returned handle.
        observe: (subject) => sessionMethod('on')(
          subject !== null && typeof subject === 'object' && !Array.isArray(subject) && 'session' in subject
            ? subject.session
            : subject,
        ),
      })
    }

    /**
     * Caller-bound views for the namespaces whose members derive an owner.
     *
     * Each access builds (and caches per derived identity) a view whose bound
     * member closes over *that* caller's context. A shared mutable field on the
     * slot record would instead let the last visitor win — and would attribute
     * the facade's own internal mounts (checkpoints, workspace transactions) to
     * whichever plugin happened to read the namespace last.
     */
    /**
     * One caller-bound view per (slot, derived identity).
     *
     * The slot is part of the key on purpose: remounting replaces the slot
     * object, and a view cached from the previous slot would keep answering for
     * a dead surface — it would report `disabled` while a live slot exists. A
     * WeakMap lets the superseded slot (and its views) be collected.
     */
    _callerView(cacheField, slot, surface, callerCtx, bind) {
      const cache = this[cacheField] ?? (this[cacheField] = new WeakMap())
      let byCaller = cache.get(slot)
      if (!byCaller) {
        byCaller = new Map()
        cache.set(slot, byCaller)
      }
      const key = callerIdentityOf(callerCtx)
      const cached = byCaller.get(key)
      if (cached) return cached
      const view = bind(surface, callerCtx)
      byCaller.set(key, view)
      return view
    }

    _storageForCaller(callerCtx) {
      const slot = this._storageSlot
      if (!slot) return this._storageSurface
      return this._callerView('_storageCallerViewCache', slot, slot.surface, callerCtx,
        (surface, ctx) => Object.freeze({ ...surface, open: (...args) => surface.open(...args, ctx) }))
    }

    /**
     * Caller-bound settings surface: `register` / `scope` carry the calling
     * plugin's context as their trailing argument so the handle owner is
     * derived per caller; every other member is shared verbatim.
     */
    _settingsForCaller(callerCtx) {
      const surface = this._settingsSurface
      if (!surface) return surface
      return this._callerView('_settingsCallerViewCache', surface, surface, callerCtx,
        (base, ctx) => Object.freeze({
          ...base,
          register: (...args) => base.register(...args, ctx),
          scope: (...args) => base.scope(...args, ctx),
        }))
    }

    /**
     * Caller-bound diagnostics surface: the registration member carries the
     * calling plugin's identity as its trailing argument, so a check is owned
     * by whoever registered it. The read members are caller-independent.
     */
    _diagnosticsForCaller(callerCtx) {
      const slot = this._diagnosticsSlot
      if (!slot) return this._diagnosticsSurface
      return this._callerView('_diagnosticsCallerViewCache', slot, slot.surface, callerCtx,
        (surface, ctx) => Object.freeze({ ...surface, register: (...args) => surface.register(...args, ctx) }))
    }

    /**
     * Caller-bound tool-discovery surface: only the catalog registration is
     * caller-sensitive (it derives the entry owner); the read and lifecycle
     * members keep their exact argument lists and are shared verbatim.
     */
    _toolsDiscoveryForCaller(callerCtx) {
      const slot = this._toolsDiscoverySlot
      if (!slot) return this._toolsDiscoverySurface
      return this._callerView('_toolsDiscoveryCallerViewCache', slot, slot.surface, callerCtx,
        (surface, ctx) => Object.freeze({
          ...surface,
          catalog: Object.freeze({ register: (...args) => surface.catalog.register(...args, ctx) }),
        }))
    }

    _workspacesForCaller(slot, callerCtx) {
      return this._callerView('_workspaceTransactionsViewCache', slot, slot.surface, callerCtx,
        (surface, ctx) => Object.freeze({ ...surface, prepare: (...args) => surface.prepare(...args, ctx) }))
    }

    _securityForCaller(slot, callerCtx) {
      return this._callerView('_securityCallerViewCache', slot, slot.surface, callerCtx, (surface, ctx) => {
        const owner = callerIdentityOf(ctx)
        const group = (name) => Object.freeze({
          ...surface[name],
          register: (...args) => surface[name].register(owner, ...args),
        })
        return Object.freeze({
          ...surface,
          policy: group('policy'),
          redaction: group('redaction'),
          egress: group('egress'),
        })
      })
    }

    /**
     * Caller-bound view of the route-policy plane.
     *
     * The registration members carry the derived caller identity as their
     * trailing caller binding, so a registration definition never declares
     * (and cannot forge) its owner; an untraceable caller binds to the shared
     * root token, exactly as the replacement reports it. The read/lookup
     * members are caller-independent and shared verbatim. The view is cached
     * per derived identity so one caller keeps one object identity.
     */
    _routingForCaller(callerCtx) {
      const surface = this._routingSurface
      if (!surface) return surface
      const binding = deriveLlmAdaptersOwner(callerCtx) ?? 'root'
      this._routingCallerSurfaceCache ??= new Map()
      const cached = this._routingCallerSurfaceCache.get(binding)
      if (cached) return cached
      const bound = (member) => (...args) => member(...args, binding)
      const view = Object.freeze({
        ...surface,
        policies: Object.freeze({ ...surface.policies, register: bound(surface.policies.register) }),
        candidates: Object.freeze({ ...surface.candidates, register: bound(surface.candidates.register) }),
        health: Object.freeze({
          ...surface.health,
          circuitPolicy: Object.freeze({
            ...surface.health.circuitPolicy,
            register: bound(surface.health.circuitPolicy.register),
          }),
          probe: Object.freeze({ ...surface.health.probe, register: bound(surface.health.probe.register) }),
        }),
      })
      this._routingCallerSurfaceCache.set(binding, view)
      return view
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
     * Caller-bound `llm.requestTransforms` / `llm.admissionPolicies` leaf.
     *
     * The registry derives the registration owner from the caller, so the leaf
     * carries the caller binding as the trailing argument of its registration
     * member. The binding is captured in the leaf — one per derived identity,
     * cached on the service — rather than stamped on the slot: a stamped slot
     * would attribute a later registration to whichever caller read the
     * namespace last.
     *
     * The leaf resolves the live slot when its member is invoked, so a leaf
     * retained across a remount keeps one object identity and still answers for
     * the current registry instead of a retired one.
     */
    _llmLeafForCaller(cacheField, callerCtx, build) {
      const cache = this[cacheField]
      const key = callerIdentityOf(callerCtx)
      const cached = cache.get(key)
      if (cached) return cached
      const leaf = build(callerCtx)
      cache.set(key, leaf)
      return leaf
    }

    _requestTransformsForCaller(callerCtx) {
      return this._llmLeafForCaller('_requestTransformsCallerCache', callerCtx, (ctx) => Object.freeze({
        register: (spec) => this._llmRequestSlot?.surface.transform(spec, ctx),
      }))
    }

    _admissionPoliciesForCaller(callerCtx) {
      return this._llmLeafForCaller('_admissionPoliciesCallerCache', callerCtx, (ctx) => Object.freeze({
        register: (spec) => this._llmAdmissionSlot?.surface.register(spec, ctx),
      }))
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
     * Install the real adapter-registration instance (official
     * registerAdapter binding). Absent → the real members report the typed
     * disabled error while decorations stay independent.
     */
    _setLlmAdapterRegistration(instance) {
      if (instance !== null && (typeof instance !== 'object' || instance === null || typeof instance.register !== 'function')) {
        return false
      }
      this._llmAdapterRegistration = instance
      return true
    }

    _setLlmDirectoryRegistration(instance) {
      if (instance !== null && (typeof instance !== 'object' || instance === null
        || typeof instance.providers !== 'function' || typeof instance.models !== 'function')) {
        return false
      }
      this._llmDirectoryRegistration = instance
      return true
    }

    /**
     * Per-access `llm.adapters` surface bound to the caller's shadowed
     * context so owner identities mint from the caller fiber (never from
     * caller-supplied strings). Real registration and decorations are two
     * independent backings: either can be unavailable without affecting the
     * other's members.
     */
    /**
     * Install the scoped-contribution feature (registry + providers). Null
     * clears it; both transitions republish the caller-cached prompts
     * surface so the scope-aware contribute member is seen.
     */
    _setScopedContributionFeature(feature) {
      if (feature !== null && (typeof feature !== 'object' || feature === null || typeof feature.registry !== 'object')) {
        return false
      }
      this._scopedContributionFeature = feature
      try {
        this._publishPromptsSurface?.()
      } catch {
        // republish is best-effort; the next caller access rebuilds anyway
      }
      return true
    }

    /**
     * Scope-bearing prompts contribution (target dimension): validate the
     * scope token, install through the target agent's context into its
     * scoped layer, and return the standard contribution handle. A scoped
     * call NEVER degrades to a global installation on failure.
     */
    _installScopedPromptContribution(spec, callerCtx, ownerKey) {
      const registry = this._scopedContributionFeature?.registry
      if (!registry) {
        return Object.freeze({ ok: false, code: 'unavailable', reason: 'scoped contributions are unavailable' })
      }
      if (typeof spec.kind !== 'string' || !(spec.kind in SCOPED_PROMPT_KINDS)) {
        return Object.freeze({
          ok: false,
          code: 'unsupported',
          reason: `prompts.contribute scoped kind "${spec.kind}" is unsupported; the admitted kinds are ${Object.keys(SCOPED_PROMPT_KINDS).join(', ')}`,
        })
      }
      const scopeRecord = registry.resolveScopeToken(spec.scope)
      if (!scopeRecord) {
        return Object.freeze({ ok: false, code: 'invalid-input', reason: 'spec.scope must be a live scope handle from agents.scopes.register' })
      }
      const route = SCOPED_PROMPT_KINDS[spec.kind]
      const id = spec.id ?? spec.name ?? spec.section?.id ?? `scoped:${spec.kind}`
      // The contribution owner is the calling plugin; an explicit spec.ownerId
      // is ignored rather than trusted.
      const ownerId = ownerKey
      // The prompts contribution conflict key is (owner, target, id) — the
      // same key space as the global contribution entry (one id namespace per
      // owner, kind not part of the key). The tools face keeps its own key
      // space (per-face ids) because register/restrict are separate members.
      const conflictFace = 'prompts.contribute'
      if (registry.hasRecord(ownerId, scopeRecord.targetId, conflictFace, id)) {
        return Object.freeze({ ok: false, code: 'conflict', reason: `a scoped contribution with id "${id}" is already active for this owner and target` })
      }
      let outcome
      try {
        outcome = registry.installScoped({
          ownerId,
          targetId: scopeRecord.targetId,
          handleId: scopeRecord.handle.id,
          kind: conflictFace,
          contributionId: id,
          install: (targetCtx) => {
            const backing = targetCtx.get('systemPrompt')
            if (!backing || typeof backing[route.member] !== 'function') {
              throw new PluginApiFeatureDisabledError('prompts', `the target agent's system-prompt backing lacks "${route.member}"`)
            }
            return Reflect.apply(backing[route.member], backing, route.args(spec))
          },
        }, callerCtx)
      } catch (error) {
        return Object.freeze({ ok: false, code: 'error', reason: String(error?.message ?? error) })
      }
      if (!outcome.ok) {
        return Object.freeze({ ok: false, code: outcome.code, reason: outcome.reason ?? 'scoped contribution installation failed' })
      }
      const seq = ++this._scopedContributionSeq
      const recordToken = outcome.record
      const handle = createContributionHandle({
        id,
        ownerId,
        seq,
        revoke: () => {
          try {
            return registry.removeScoped(recordToken, ownerId).status === 'ok'
          } catch {
            // disposal must never throw through the caller
            return false
          }
        },
      })
      return Object.freeze({ ok: true, code: 'contributed', handle })
    }

    /**
     * Caller-bound view of the official provider-directory registration.
     *
     * The official entry answers with a callable registration handle that also
     * carries `.replace`; the facade wraps it into the standard resource handle
     * so the calling plugin sees the same registration shape as everywhere
     * else, with `.replace` kept as a registered extension member.
     */
    _llmProvidersForCaller(callerCtx) {
      const directory = this._llmDirectoryRegistration
      const gate = () => {
        if (!this.isActive) throw new PluginApiInactiveError()
        if (!directory) throw new PluginApiFeatureDisabledError('llm.providers', 'provider directory registration is unavailable')
      }
      return Object.freeze({
        register: (entries) => {
          gate()
          const official = directory.providers(entries)
          if (typeof official !== 'function' && (official === null || typeof official !== 'object')) {
            throw new PluginApiError('PLUGIN_API_LLM_REGISTRATION_INVALID', 'the official provider directory registration did not return a handle')
          }
          const ownerId = deriveLlmAdaptersOwner(callerCtx) ?? ROOT_OWNER_TOKEN
          const id = firstProviderName(entries)
          return createResourceHandle({
            id,
            ownerId,
            generation: `${ownerId}:${id}:${++this._llmRegistrationSequence}`,
            extensions: typeof official.replace === 'function'
              ? { replace: (...args) => Reflect.apply(official.replace, official, args) }
              : {},
            revoke: () => {
              // The official release is idempotent by contract; this call is
              // the release this handle reports.
              Reflect.apply(official, undefined, [])
              return true
            },
          })
        },
      })
    }

    /**
     * Caller-bound view of the official model-discovery registration plus the
     * caller-independent catalog projection.
     */
    _llmModelsForCaller(callerCtx) {
      const directory = this._llmDirectoryRegistration
      const gate = () => {
        if (!this.isActive) throw new PluginApiInactiveError()
        if (!directory) throw new PluginApiFeatureDisabledError('llm.models', 'model discovery registration is unavailable')
      }
      return Object.freeze({
        register: (settingsNs, discover) => {
          gate()
          const official = directory.models(settingsNs, discover)
          if (typeof official !== 'function') {
            throw new PluginApiError('PLUGIN_API_LLM_REGISTRATION_INVALID', 'the official model discovery registration did not return a disposer')
          }
          const ownerId = deriveLlmAdaptersOwner(callerCtx) ?? ROOT_OWNER_TOKEN
          const id = typeof settingsNs === 'string' && settingsNs.length > 0 ? settingsNs : 'models'
          return createResourceHandle({
            id,
            ownerId,
            generation: `${ownerId}:${id}:${++this._llmRegistrationSequence}`,
            revoke: () => {
              Reflect.apply(official, undefined, [])
              return true
            },
          })
        },
        list: () => {
          gate()
          return directory.listModels()
        },
      })
    }

    _llmAdaptersForCaller(callerCtx) {
      const decoration = this._llmAdaptersSurface
      const real = this._llmAdapterRegistration
      const realGate = () => {
        if (!this.isActive) throw new PluginApiInactiveError()
        if (!real) throw new PluginApiFeatureDisabledError('llm.adapters', 'adapter registration is unavailable')
      }
      return Object.freeze({
        register: (definition, options) => {
          realGate()
          return real.register(definition, callerCtx, options)
        },
        list: () => {
          realGate()
          return real.list()
        },
        decorations: Object.freeze({
          register: (definition) => {
            if (!decoration || typeof decoration.register !== 'function') {
              throw new PluginApiFeatureDisabledError('llm.adapters.decorations', 'adapter decoration is unavailable')
            }
            return decoration.register(definition, callerCtx)
          },
          list: () => {
            if (!decoration || typeof decoration.list !== 'function') {
              throw new PluginApiFeatureDisabledError('llm.adapters.decorations', 'adapter decoration is unavailable')
            }
            return decoration.list()
          },
        }),
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
     * Install the caller-bound attention surface provider (the host attention
     * hub lives in the mounter; the facade publishes per-caller bound faces).
     * Returns true once installed; provider failures keep the typed disabled
     * surface at read time.
     */
    _setAttentionProvider(provider) {
      if (typeof provider !== 'function') return false
      this._attentionProvider = provider
      return true
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
     * `rollback()` reports whether it actually restored the disabled form:
     * a transaction that no longer owns the slot, or a feature with no
     * restorable disabled form, answers `false` rather than silently leaving
     * the candidate published.
     */
    prepareFeature(name, api) {
      if (!KNOWN_FEATURES.has(name)) {
        throw new PluginApiFeatureDisabledError(name, `cannot prepare unknown feature "${name}"`)
      }
      if (UNSTAGEABLE_FEATURES.has(name)) {
        // These features publish by merging an entry into a shared surface
        // (events, session, systemPrompt, settings, services) or through a
        // factory/registry that never exposes the candidate as a replaceable
        // slot (tools, llm, agent, agentExtension). A transaction over them
        // could not prove slot ownership on rollback, so staging is refused
        // up front instead of silently failing to restore.
        throw new PluginApiFeatureDisabledError(name, `staged preparation is not supported for feature "${name}"`)
      }      if (name === 'sessionDurable') {
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
          return wasCommitted ? this._restoreDisabledSurface(name, api) : true
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
          throw new PluginApiFeatureDisabledError('prompts', 'official helper owner is unavailable')
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
          throw new PluginApiFeatureDisabledError('settings', 'settings remote owner is unavailable')
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
        this._publishRecoverySurface()
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
          // The observation entry takes a single subject: `{ resource, ... }`
          // in the canonical options form, or the bare resource as the
          // convenience form (the same field `acquire` uses). The canonical
          // form is recognized by carrying the field, not by being an object —
          // a resource is an object too.
          observe: (subject, options) => {
            const canonical = subject !== null && typeof subject === 'object'
              && !Array.isArray(subject) && 'resource' in subject
            return canonical
              ? invoke('watch')(subject.resource, subject)
              : invoke('watch')(subject, options)
          },
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
        const workspaceTransactionStatus = () => {
          try {
            if (!this._active()) return Object.freeze({ status: 'unavailable', reason: 'the facade is inactive' })
            // The domain probe is published verbatim, in either form it is
            // offered in: a probe function is called, a frozen availability
            // record is passed through untouched. The namespace decoration
            // performs the single status normalization (available -> active)
            // and keeps every domain detail field (scope / durability /
            // operations / backend / epoch).
            if (typeof api.availability === 'function') return api.availability()
            if (api.availability !== null && typeof api.availability === 'object' && !Array.isArray(api.availability)) {
              return api.availability
            }
          } catch {
            return Object.freeze({ status: 'unavailable', reason: 'the transaction owner probe failed' })
          }
          return record.current && this._workspaceTransactionsSlot === record
            ? Object.freeze({ status: 'active' })
            : Object.freeze({ status: 'unavailable', reason: 'the workspace transaction owner is unavailable' })
        }
        const surface = Object.freeze({
          // `prepare` derives the transaction owner from the caller, so it
          // receives the caller context as its trailing argument; the binding
          // happens in the per-caller view, never through shared state.
          prepare: (...args) => {
            fail()
            return Reflect.apply(api.prepare, api, args)
          },
          record: invoke('record'),
          preview: invoke('preview'),
          commit: invoke('commit'),
          rollback: invoke('rollback'),
          recover: invoke('recover'),
          get: invoke('get'),
          observe: invoke('observe'),
          // A namespace answers a non-throwing availability probe: the owner's
          // own answer when it offers one, otherwise the live state of this
          // slot (a missing owner must never read as active).
          availability: () => workspaceTransactionStatus(),
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
        // Registrations derive the owner from the calling plugin: the surface
        // injects the derived identity as the owner argument, so the public
        // members take only the spec and a caller cannot declare an owner.
        const wrapRegistration = (fn) => (...args) => {
          fail()
          return Reflect.apply(fn, api, args)
        }
        const surface = Object.freeze({
          policy: Object.freeze({ register: wrapRegistration(api.policy.register) }),
          redaction: Object.freeze({ register: wrapRegistration(api.redaction.register) }),
          egress: Object.freeze({
            register: wrapRegistration(api.egress.register),
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
        // The catalog registration derives its owner from the caller; the
        // caller binding rides on the per-caller view this surface is wrapped
        // by (see `_toolsDiscoveryForCaller`), never on shared slot state. The
        // surrounding read and lifecycle members keep their exact argument
        // lists.
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
          || typeof api.current !== 'function' || typeof api.observe !== 'function'
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
          history: invoke('fetchEvents'),
          heartbeat: invoke('heartbeat'),
          ack: invoke('ack'),
          resume: invoke('resume'),
          release: invoke('revoke'),
          current: invoke('current'),
          observe: invoke('observe'),
          auth: Object.freeze({
            initiatePairing: invokeNested('auth', 'initiatePairing'),
            approvePairing: invokeNested('auth', 'approvePairing'),
            rejectPairing: invokeNested('auth', 'rejectPairing'),
            // The trailing arguments carry the caller identity the facade
            // derived for this access; they are forwarded verbatim.
            register: (spec, ...rest) => {
              fail()
              const kind = spec?.kind
              if (kind === 'verifier') return Reflect.apply(api.auth.registerVerifier, api.auth, [spec, ...rest])
              if (kind === 'authorizer') return Reflect.apply(api.auth.registerAuthorizer, api.auth, [spec, ...rest])
              throw new PluginApiError('AUTH_REGISTER_INVALID_INPUT', 'sessions.channels.auth.register requires a kind of verifier or authorizer')
            },
            pairingProvider: Object.freeze({ register: invokeNested('auth', 'registerPairingProvider') }),
          }),
          // The subscription resource a channel hands out (identity plus the
          // generation the frame reader and the cursor ack are fenced by); the
          // acquisition verb is the one the coordination entry allows.
          subscriptions: Object.freeze({
            acquire: invoke('subscribe'),
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
          // `open` derives the owner from the caller, so it receives the
          // stamped caller context as its trailing argument.
          open: (...args) => {
            fail()
            return Reflect.apply(api.open, api, args)
          },
          availability: invoke('availability'),
        })
        record.surface = surface
        this._storageSlot = record
        return record
      }
      if (name === 'sessionActivity') {
        for (const member of ['current', 'get', 'list', 'history', 'observe', 'availability']) {
          if (typeof api?.[member] !== 'function') {
            throw new PluginApiFeatureDisabledError('sessions.activity', `session activity owner member "${member}" is unavailable`)
          }
        }
        if (this._sessionActivitySlot) this._sessionActivitySlot.current = false
        const record = createFeatureSlot({
          active: () => this._active(),
          feature: 'sessionActivity',
          api,
          methods: ['current', 'get', 'list', 'history', 'observe', 'availability'],
          isCurrent: () => this._sessionActivitySlot,
        })
        this._sessionActivitySlot = record
        this._sessionActivitySurface = record.surface
        this._publishSessionApi()
        return record
      }
      if (name === 'sessionPlanMode') {
        for (const member of ['surfaceFor', 'availability']) {
          if (typeof api?.[member] !== 'function') {
            throw new PluginApiFeatureDisabledError('sessions.planMode', `plan-mode owner member "${member}" is unavailable`)
          }
        }
        if (this._sessionPlanModeSlot) this._sessionPlanModeSlot.current = false
        const record = createFeatureSlot({
          active: () => this._active(),
          feature: 'sessionPlanMode',
          api,
          methods: ['surfaceFor', 'availability'],
          isCurrent: () => this._sessionPlanModeSlot,
        })
        this._sessionPlanModeSlot = record
        this._sessionPlanModeSurface = record.surface
        this._publishSessionApi()
        return record
      }
      if (name === 'workflows') {
        for (const member of ['surfaceFor', 'availability']) {
          if (typeof api?.[member] !== 'function') {
            throw new PluginApiFeatureDisabledError('workflows', `workflow owner member "${member}" is unavailable`)
          }
        }
        if (this._workflowsSlot) this._workflowsSlot.current = false
        const record = createFeatureSlot({
          active: () => this._active(),
          feature: 'workflows',
          api,
          methods: ['surfaceFor', 'availability'],
          isCurrent: () => this._workflowsSlot,
        })
        this._workflowsSlot = record
        this._workflowsSurface = record.surface
        return record
      }
      if (name === 'sessionCompaction') {
        for (const member of ['run', 'availability']) {
          if (typeof api?.[member] !== 'function') {
            throw new PluginApiFeatureDisabledError('sessions.compaction', `compaction owner member "${member}" is unavailable`)
          }
        }
        if (this._sessionCompactionSlot) this._sessionCompactionSlot.current = false
        const record = createFeatureSlot({
          active: () => this._active(),
          feature: 'sessionCompaction',
          api,
          methods: ['run', 'availability'],
          isCurrent: () => this._sessionCompactionSlot,
        })
        this._sessionCompactionSlot = record
        this._sessionCompactionSurface = record.surface
        this._publishSessionApi()
        return record
      }
      if (name === 'credentials') {
        for (const member of ['surfaceFor', 'availability']) {
          if (typeof api?.[member] !== 'function') {
            throw new PluginApiFeatureDisabledError('credentials', `credential mutation owner member "${member}" is unavailable`)
          }
        }
        if (this._credentialsSlot) this._credentialsSlot.current = false
        const record = createFeatureSlot({
          active: () => this._active(),
          feature: 'credentials',
          api,
          methods: ['surfaceFor', 'availability'],
          isCurrent: () => this._credentialsSlot,
        })
        this._credentialsSlot = record
        this._credentialsSurface = record.surface
        return record
      }
      if (name === 'sessionPermissionPresets') {
        for (const member of ['surfaceFor', 'availability']) {
          if (typeof api?.[member] !== 'function') {
            throw new PluginApiFeatureDisabledError('sessions.permissionPresets', `permission-preset owner member "${member}" is unavailable`)
          }
        }
        if (this._sessionPermissionPresetsSlot) this._sessionPermissionPresetsSlot.current = false
        const record = createFeatureSlot({
          active: () => this._active(),
          feature: 'sessionPermissionPresets',
          api,
          methods: ['surfaceFor', 'availability'],
          isCurrent: () => this._sessionPermissionPresetsSlot,
        })
        this._sessionPermissionPresetsSlot = record
        this._sessionPermissionPresetsSurface = record.surface
        this._publishSessionApi()
        return record
      }
      if (name === 'sessionInteractions') {
        for (const member of ['surfaceFor', 'availability']) {
          if (typeof api?.[member] !== 'function') {
            throw new PluginApiFeatureDisabledError('sessions.interactions', `pending-interaction owner member "${member}" is unavailable`)
          }
        }
        if (this._sessionInteractionsSlot) this._sessionInteractionsSlot.current = false
        const record = createFeatureSlot({
          active: () => this._active(),
          feature: 'sessionInteractions',
          api,
          methods: ['surfaceFor', 'availability'],
          isCurrent: () => this._sessionInteractionsSlot,
        })
        this._sessionInteractionsSlot = record
        this._sessionInteractionsSurface = record.surface
        this._publishSessionApi()
        return record
      }
      if (name === 'sessionSelection') {
        for (const member of ['surfaceFor', 'availability']) {
          if (typeof api?.[member] !== 'function') {
            throw new PluginApiFeatureDisabledError('sessions.selection', `selection owner member "${member}" is unavailable`)
          }
        }
        if (this._sessionSelectionSlot) this._sessionSelectionSlot.current = false
        const record = createFeatureSlot({
          active: () => this._active(),
          feature: 'sessionSelection',
          api,
          methods: ['surfaceFor', 'availability'],
          isCurrent: () => this._sessionSelectionSlot,
        })
        this._sessionSelectionSlot = record
        this._sessionSelectionSurface = record.surface
        this._publishSessionApi()
        return record
      }
      if (name === 'sessionInteraction') {
        for (const member of ['request', 'cancel', 'availability']) {
          if (typeof api?.[member] !== 'function') {
            throw new PluginApiFeatureDisabledError('sessions.request', `session interaction owner member "${member}" is unavailable`)
          }
        }
        if (this._sessionInteractionSlot) this._sessionInteractionSlot.current = false
        const record = createFeatureSlot({
          active: () => this._active(),
          feature: 'sessionInteraction',
          api,
          methods: ['request', 'cancel', 'availability'],
          isCurrent: () => this._sessionInteractionSlot,
        })
        this._sessionInteractionSlot = record
        this._sessionInteractionSurface = record.surface
        this._publishSessionApi()
        return record
      }
      if (name === 'attention') {
        for (const member of ['current', 'list', 'observe', 'contribute', 'dismiss', 'invoke', 'availability']) {
          if (typeof api?.[member] !== 'function') {
            throw new PluginApiFeatureDisabledError('attention', `attention owner member "${member}" is unavailable`)
          }
        }
        if (this._attentionSlot) this._attentionSlot.current = false
        const record = createFeatureSlot({
          active: () => this._active(),
          feature: 'attention',
          api,
          methods: ['current', 'list', 'observe', 'contribute', 'dismiss', 'invoke', 'availability'],
          isCurrent: () => this._attentionSlot,
        })
        this._attentionSlot = record
        return record
      }
      if (name === 'checkpoints') {
        for (const member of ['create', 'list', 'inspect', 'planRestore', 'restore', 'availability']) {
          if (typeof api?.[member] !== 'function') {
            throw new PluginApiFeatureDisabledError('executions.recovery.checkpoints', `checkpoints owner member "${member}" is unavailable`)
          }
        }
        if (this._checkpointsSlot) this._checkpointsSlot.current = false
        const record = { current: true, api }
        const service = this
        const fail = () => {
          if (!service._active()) throw new PluginApiInactiveError()
          if (!record.current || service._checkpointsSlot !== record) {
            throw new PluginApiFeatureDisabledError('executions.recovery.checkpoints')
          }
        }
        const invoke = (method) => (...args) => {
          fail()
          return Reflect.apply(api[method], api, args)
        }
        const surface = Object.freeze({
          create: invoke('create'),
          list: invoke('list'),
          inspect: invoke('inspect'),
          planRestore: invoke('planRestore'),
          restore: invoke('restore'),
          get availability() {
            fail()
            return api.availability()
          },
        })
        record.surface = surface
        this._checkpointsSlot = record
        this._publishRecoverySurface()
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
      if (name === 'storage') return this._storageSlot?.api
      if (name === 'execRoute') return this._execRouteToken?.api
      if (name === 'toolDiscovery') return this._toolsDiscoverySlot?.api
      if (name === 'sessionActivity') return this._sessionActivitySlot?.api
      if (name === 'sessionPlanMode') return this._sessionPlanModeSlot?.api
      if (name === 'sessionPermissionPresets') return this._sessionPermissionPresetsSlot?.api
      if (name === 'sessionInteractions') return this._sessionInteractionsSlot?.api
      if (name === 'sessionSelection') return this._sessionSelectionSlot?.api
      if (name === 'credentials') return this._credentialsSlot?.api
      if (name === 'sessionCompaction') return this._sessionCompactionSlot?.api
      if (name === 'workflows') return this._workflowsSlot?.api
      if (name === 'sessionInteraction') return this._sessionInteractionSlot?.api
      if (name === 'attention') return this._attentionSlot?.api
      if (name === 'checkpoints') return this._checkpointsSlot?.api
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
      if (name === 'sessionChannel') return createDisabledSessionChannelOwner(this._active)
      if (name === 'sessionRoute') return createDisabledSessionRouteApi(this._active)
      if (name === 'diagnostics') return createDisabledDiagnosticsApi(this._active)
      if (name === 'systemPrompt') return createDisabledSystemPromptApi(this._active)
      if (name === 'settings') return createDisabledSettingsApi(this._active)
      if (name === 'settingsRemote') return createDisabledSettingsRemoteApi(this._active)
      if (name === 'remote') return createDisabledHostRemoteApi(this._active)
      if (name === 'services') return createDisabledServicesNamespace(this._active)
      if (name === 'execution') return createDisabledExecutionApi(this._active)
      if (name === 'recovery') return createDisabledRecoveryOwner(this._active)
      if (name === 'coordination') return createDisabledCoordinationOwner(this._active)
      if (name === 'storage') return createDisabledStorageApi(this._active)
      if (name === 'workspaceTransactions') return createDisabledWorkspaceTransactionsApi(this._active)
      if (name === 'tasks') return createDisabledTasksOwner(this._active)
      if (name === 'profile') return createDisabledProfileApi(this._active)
      if (name === 'security') return createDisabledSecurityApi(this._active)
      if (name === 'toolDiscovery') return createDisabledToolsDiscoveryOwner(this._active)
      // context-provenance
      if (name === 'context') return createDisabledContextApi(this._active)
      // context-provenance
      if (name === 'sessionActivity') return createDisabledSessionActivityApi(this._active)
      if (name === 'sessionPlanMode') return createDisabledSessionPlanModeApi(this._active)
      if (name === 'sessionPermissionPresets') return createDisabledSessionPermissionPresetsApi(this._active)
      if (name === 'sessionInteractions') return createDisabledSessionInteractionsApi(this._active)
      if (name === 'sessionSelection') return createDisabledSessionSelectionApi(this._active)
      if (name === 'credentials') return createDisabledCredentialsApi(this._active)
      if (name === 'sessionCompaction') return createDisabledSessionCompactionApi(this._active)
      if (name === 'workflows') return createDisabledWorkflowsApi(this._active)
      if (name === 'sessionInteraction') return createDisabledSessionInteractionApi(this._active)
      if (name === 'attention') return createDisabledAttentionApi(this._active)
      if (name === 'checkpoints') return createDisabledCheckpointsApi(this._active)
      if (name === 'routePolicy') return createDisabledRoutePolicyApi(this._active)
      return undefined
    }

    /** Restore the disabled facade only while this transaction owns the slot. */
    _restoreDisabledSurface(name, api) {
      if (this._readSlot(name) !== api) return false
      // Two features carry no disabled surface object: the type registry's
      // disabled form is the absence of a published surface, and the official
      // helper slot is restored by retiring the slot.
      if (name === 'typert') {
        this._typertSurface = undefined
        this._publishServicesSurface()
        return true
      }
      if (name === 'officialPassthrough') {
        const token = this._officialPassthroughSlot
        if (!token) return false
        token.current = false
        this._officialPassthroughSlot = null
        this._publishSystemPromptSurface()
        return true
      }
      if (name === 'execRoute') {
        const token = this._execRouteToken
        if (!token) return false
        token.current = false
        this._execRouteDelegate = this._execRouteDisabled
        this._execRouteToken = null
        this._publishRoutingSurface()
        return true
      }
      const surface = this._disabledSurfaceFor(name)
      if (surface === undefined) return false
      this._assignFeature(name, surface)
      return true
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
      // storage-binding
      if (name === 'storage' && token === this._storageSlot) {
        token.current = false
        this._storageSlot = null
        this._storageSurface = createDisabledStorageApi(this._active)
        return true
      }
      // storage-binding
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
      // session activity projection
      if (name === 'sessionActivity' && token === this._sessionActivitySlot) {
        token.current = false
        this._sessionActivitySlot = null
        this._sessionActivitySurface = createDisabledSessionActivityApi(this._active)
        this._publishSessionApi()
        return true
      }
      // session activity projection
      // sessions.planMode
      if (name === 'sessionPlanMode' && token === this._sessionPlanModeSlot) {
        token.current = false
        this._sessionPlanModeSlot = null
        this._sessionPlanModeSurface = createDisabledSessionPlanModeApi(this._active)
        this._publishSessionApi()
        return true
      }
      // sessions.planMode
      // sessions.permissionPresets
      if (name === 'sessionPermissionPresets' && token === this._sessionPermissionPresetsSlot) {
        token.current = false
        this._sessionPermissionPresetsSlot = null
        this._sessionPermissionPresetsSurface = createDisabledSessionPermissionPresetsApi(this._active)
        this._publishSessionApi()
        return true
      }
      // sessions.permissionPresets
      if (name === 'sessionInteractions' && token === this._sessionInteractionsSlot) {
        token.current = false
        this._sessionInteractionsSlot = null
        this._sessionInteractionsSurface = createDisabledSessionInteractionsApi(this._active)
        this._publishSessionApi()
        return true
      }
      // sessions.interactions
      if (name === 'sessionSelection' && token === this._sessionSelectionSlot) {
        token.current = false
        this._sessionSelectionSlot = null
        this._sessionSelectionSurface = createDisabledSessionSelectionApi(this._active)
        this._publishSessionApi()
        return true
      }
      // sessions.selection
      // credentials
      if (name === 'credentials' && token === this._credentialsSlot) {
        token.current = false
        this._credentialsSlot = null
        this._credentialsSurface = createDisabledCredentialsApi(this._active)
        return true
      }
      // credentials
      // sessions.compaction
      if (name === 'sessionCompaction' && token === this._sessionCompactionSlot) {
        token.current = false
        this._sessionCompactionSlot = null
        this._sessionCompactionSurface = createDisabledSessionCompactionApi(this._active)
        this._publishSessionApi()
        return true
      }
      // sessions.compaction
      // workflows
      if (name === 'workflows' && token === this._workflowsSlot) {
        token.current = false
        this._workflowsSlot = null
        this._workflowsSurface = createDisabledWorkflowsApi(this._active)
        return true
      }
      // workflows
      // session interaction operation
      if (name === 'sessionInteraction' && token === this._sessionInteractionSlot) {
        token.current = false
        this._sessionInteractionSlot = null
        this._sessionInteractionSurface = createDisabledSessionInteractionApi(this._active)
        this._publishSessionApi()
        return true
      }
      // session interaction operation
      // attention
      if (name === 'attention' && token === this._attentionSlot) {
        token.current = false
        this._attentionSlot = null
        this._attentionProvider = null
        this._attentionSurface = createDisabledAttentionApi(this._active)
        return true
      }
      // attention
      // checkpoints
      if (name === 'checkpoints' && token === this._checkpointsSlot) {
        token.current = false
        this._checkpointsSlot = null
        this._publishRecoverySurface()
        return true
      }
      // checkpoints
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
  'sessionActivity',
  'sessionPlanMode',
  'sessionPermissionPresets',
  'credentials',
  'sessionCompaction',
  'workflows',
  'sessionInteractions',
  'sessionSelection',
  'sessionInteraction',
  'attention',
  'checkpoints',
])

/**
 * Features that cannot back a staged publication transaction: they publish by
 * merging an entry into a shared surface, or through a factory/registry that
 * never exposes the candidate as a replaceable slot. See `prepareFeature`.
 */
const UNSTAGEABLE_FEATURES = new Set([
  'tools',
  'llm',
  'events',
  'session',
  'systemPrompt',
  'settings',
  'services',
  'agent',
  'agentExtension',
])

/** The mountable feature names, for the facade's own contract tests. */
export const KNOWN_FEATURE_NAMES = Object.freeze([...KNOWN_FEATURES])
