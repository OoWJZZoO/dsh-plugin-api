/**
 * dsh-plugin-api host plugin — foundation foundation (plugin-api-foundation).
 *
 * apply() is fail-safe by design: it NEVER throws. The only safe failure mode
 * for a DSH plugin is returning normally (fiber stays active) while installing
 * nothing but, when possible, an inert `pluginApi` service. A thrown apply()
 * would take the whole harness boot down.
 *
 * Layered guard:
 * - CORE guard failure (non-registration primitives): register an inert
 *   `pluginApi` service and return.
 * - CORE guard failure (ctx.plugin / ctx.reflect.provide): no service can be
 *   registered; log and return. Cordis native missing-service behavior applies.
 * - FEATURE guard failure: the facade stays active and only that feature is
 *   disabled, with an explicit error log.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as dshLlm from '@deepseek-ai/dsh-llm'
import * as dshSession from '@deepseek-ai/dsh-session'
import * as dshSystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as typertProtocol from '@deepseek-ai/dsh-typert-protocol'
import { composeCatalogs } from './catalog-compose.js'
import { createEventsBus } from './events-bus.js'
import { baseEventsCatalog } from './events-catalog.js'
import { createCompactionEventsCatalogSlice } from './compaction-events-catalog.js'
import { createSessionTitleEventsCatalogSlice } from './session-title-events-catalog.js'
import { officialHostEventCatalogSlices } from './official-host-events-catalog.js'
import { agentEventsCatalog } from './agent-events-catalog.js'
import { llmEventsCatalog } from './llm-events-catalog.js'
import { systemPromptEventsCatalog } from './system-prompt-events-catalog.js'
import { settingsEventsCatalog } from './settings-events-catalog.js'
import { toolsEventsCatalog } from './tools-events-catalog.js'
import { deepFreeze } from './deep-freeze.js'
import { installLlmAdmissionGateway } from './llm-admission-gateway.js'
import { createLlmInputPolicyRegistry } from './llm-input-policy.js'
import { createAgentCreateExtension } from './agent-create-api.js'
import { createExecRouteOwner } from './exec-route.js'
import { createDiagnosticsOwner } from './diagnostics.js'
import { createLlmApi } from './llm-api.js'
import { createOfficialPassthroughHost } from './official-passthrough-host.js'
import {
  createAuthoritativeResolver,
  createLlmPipelineHandle,
  mountLlmRequestFeature as mountLlmRequestOwner,
} from './llm-request.js'
import {
  featureFailNotice,
  guardFailNotice,
  runCoreGuard,
  runFeatureGuard,
  writeGuardLog,
} from './guards.js'
import { createFeatureRegistry } from './feature-registry.js'
import { createPluginApiService, pluginApiBrand } from './plugin-api-service.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'
import { createServicesNamespace, servicesNamespaceBrand } from './services.js'
import { buildSessionDurableContracts, DURABLE_EVENT_DESCRIPTORS, DURABLE_EVENT_TYPES, SESSION_DURABLE_AUDIT } from './session-durable-catalog.js'
import { appendMessage, createDurableEpochRegistrationOwner, createDurableObservationHub, createSessionDurableApi } from './session-durable-feature.js'

import { mountSessionFeature } from './session-feature.js'
import { sessionLifecycleEventsCatalog } from './session-events-catalog.js'
import { createSystemPromptApi } from './system-prompt.js'
import { createSettingsApi } from './settings.js'
import { createSettingsRemoteApi } from './settings-remote.js'
import { createHostRemoteApi } from './host-remote.js'
import { createSessionRouteOwner } from './session-route.js'
import { createTypertFacade } from './typert.js'
import { createToolAbortedErrorFactory } from './tool-abort.js'
import { createExecutionObservation } from './execution-observation.js'
import { createUsage } from './usage.js'
import { createRecoveryPolicyOwner } from './recovery-policy.js'
import { createCoordinationLease } from './coordination-lease.js'
import { createWorkspaceMutationTransaction } from './workspace-mutation-transaction.js'
import { createTaskExecutionObservation } from './task-execution-observation.js'
import { createProfileInspection } from './profile-inspection.js'
import { createProfileMutation, installedRuntimeVersion } from './profile-mutation.js'
import { createMutationEvidenceIntake } from './workspace-transaction-adapters.js'
import { createTaskEvidenceIntake } from './task-execution-adapters.js'
import { createSecurityOwner } from './security-owner.js'

import { createToolDiscoveryEngine } from './tool-discovery.js'

import { parseFacadeVersion } from './version.js'
import {
  createOfficialAgentLeaf,
  createOfficialLlmLeaf,
  createOfficialSessionLeaf,
  createOfficialSettingsLeaf,
  createOfficialSystemPromptLeaf,
} from './official-host-namespaces.js'

export const name = 'dsh-plugin-api-main'
export const inject = []

const require = createRequire(import.meta.url)

/**
 * MCP component marker shared with the replacement bundle
 * `@deepseek-ai/dsh-plugin-api-mcp`: the facade projects the read-only
 * `pluginApi.mcp` face only while a replacement claiming the
 * `@deepseek-ai/dsh-mcp-client` component is active on this root. The facade
 * never imports the auxiliary package and keeps no catalog of its own.
 */
const MCP_COMPONENT_MARKER = Symbol.for('dsh-plugin-api.mcp.contract')
const ATTACHMENT_COMPONENT_MARKER = Symbol.for('dsh-plugin-api.attachments.owner')
const ATTACHMENT_CONTRACT_MARKER = Symbol.for('dsh-plugin-api.attachments.contract')
const ROUTE_POLICY_COMPONENT_MARKER = Symbol.for('dsh-plugin-api.agent-loop.contract')
const ROUTE_POLICY_ACTIVE_MARKER = Symbol.for('dsh-plugin-api.agent-loop.route-policy.contract')
const ROUTE_POLICY_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-agent-loop'
const ROUTE_POLICY_ROW_ID = 'plugin-api-agent-loop'
const ROUTE_POLICY_OFFICIAL_ROW_ID = 'agent-loop'
const ROUTE_POLICY_OFFICIAL_PACKAGE_NAME = '@deepseek-ai/dsh-agent-loop'
// session-branch facade
const SESSION_BRANCH_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-session-branch'
const SESSION_BRANCH_ROW_ID = 'plugin-api-session-branch'
const SESSION_BRANCH_CONTRACT_MARKER = Symbol.for('dsh-plugin-api.session-branch.contract')
// session-branch facade

/**
 * Resolve the replacement-owned `ctx.mcpCatalog` service, verified by the
 * component owner marker. Returns null (fail-closed) on any inconsistency so
 * `pluginApi.mcp` degrades to its typed disabled surface.
 */
function resolveMarkedMcpCatalog(ctx) {
  try {
    const root = ctx?.root ?? ctx
    const marker = root?.[MCP_COMPONENT_MARKER]
    if (!marker || typeof marker.package !== 'string') return null
    const catalog = typeof ctx?.get === 'function' ? ctx.get('mcpCatalog') : null
    return catalog && typeof catalog.servers === 'function' ? catalog : null
  } catch {
    return null
  }
}

/**
 * Resolve the agent-loop replacement's route capability lazily. The main
 * facade does not import the replacement package; the component marker, active
 * loader row, fork marker, and exact full-version contract are the publication
 * gates. When any gate fails, the route-policy leaf stays typed-unavailable.
 */
export function resolveMarkedRoutePolicy(ctx) {
  try {
    const root = ctx?.root ?? ctx
    const marker = root?.[ROUTE_POLICY_COMPONENT_MARKER]
    if (marker?.package !== ROUTE_POLICY_PACKAGE_NAME || marker.rowId !== ROUTE_POLICY_ROW_ID) return null
    const entries = ctx?.loader?.entries?.()
    const rows = Array.isArray(entries) ? entries : entries && typeof entries[Symbol.iterator] === 'function' ? [...entries] : null
    if (!rows) return null
    let activeReplacement = 0
    let officialEnabled = false
    for (const entry of rows) {
      const options = entry?.options ?? entry ?? {}
      const disabled = Boolean(options.disabled ?? entry?.disabled)
      if ((options.id === ROUTE_POLICY_ROW_ID || options.name === ROUTE_POLICY_PACKAGE_NAME) && !disabled) activeReplacement += 1
      if ((options.id === ROUTE_POLICY_OFFICIAL_ROW_ID || options.name === ROUTE_POLICY_OFFICIAL_PACKAGE_NAME) && !disabled) officialEnabled = true
    }
    if (activeReplacement !== 1 || officialEnabled) return null
    const routePolicy = safeGet(ctx, 'routePolicy')
    const agentLoop = safeGet(ctx, 'agentLoop')
    if (!routePolicy?.[ROUTE_POLICY_ACTIVE_MARKER] || typeof routePolicy.decide !== 'function') return null
    if (agentLoop?.[ROUTE_POLICY_COMPONENT_MARKER]?.package !== ROUTE_POLICY_PACKAGE_NAME) return null
    const auxiliary = readPackageManifest(ROUTE_POLICY_PACKAGE_NAME)
    const main = readOwnManifest()
    const ownVersion = parseFacadeVersion(auxiliary?.version)
    const mainVersion = parseFacadeVersion(main.packageVersion)
    if (!ownVersion || !mainVersion || ownVersion.runtime !== mainVersion.runtime || ownVersion.api !== mainVersion.api || auxiliary.api !== main.apiVersion) return null
    if (marker.runtime !== ownVersion.runtime || marker.api !== ownVersion.api) return null
    return routePolicy
  } catch {
    return null
  }
}

/**
 * Resolve the attachment replacement's capability slice lazily.  The main
 * facade never imports the auxiliary package: the root marker, active loader
 * row, official service marker, and exact package contract are the only
 * publication gates.
 */
// Attachment-owned append-only loader/version gate. Keeping this resolver
// exported lets the attachment-focused suite exercise the real facade
// publication boundary without constructing unrelated feature mounts.
export function resolveMarkedAttachmentPipeline(ctx) {
  try {
    const root = ctx?.root ?? ctx
    const marker = root?.[ATTACHMENT_COMPONENT_MARKER]
    if (marker?.package !== '@deepseek-ai/dsh-plugin-api-attachments' || marker.rowId !== 'plugin-api-attachments') return null
    const entries = ctx?.loader?.entries?.()
    const rows = Array.isArray(entries) ? entries : entries && typeof entries[Symbol.iterator] === 'function' ? [...entries] : null
    if (!rows) return null
    const activeRow = rows.some((entry) => {
      const options = entry?.options ?? entry ?? {}
      return (options.id === 'plugin-api-attachments' || options.name === '@deepseek-ai/dsh-plugin-api-attachments') && !Boolean(options.disabled ?? entry?.disabled)
    })
    if (!activeRow) return null
    const attachments = safeGet(ctx, 'attachments')
    const pipeline = safeGet(ctx, 'attachmentsPipeline')
    if (!attachments?.[ATTACHMENT_CONTRACT_MARKER] || !pipeline?.pipeline || !pipeline?.projection) return null
    const auxiliary = readPackageManifest('@deepseek-ai/dsh-plugin-api-attachments')
    const main = readOwnManifest()
    const parse = (version) => typeof version === 'string' ? /^(.+)-(\d+\.\d+)$/.exec(version) : null
    const own = parse(auxiliary?.version)
    const facade = parse(main?.packageVersion)
    if (!own || !facade || own[1] !== facade[1] || own[2] !== facade[2] || auxiliary.api !== main.apiVersion) return null
    return pipeline
  } catch {
    return null
  }
}

/**
 * Merge feature API objects by property descriptors so getters stay lazy.
 * Later apis override earlier ones on name collisions. Never evaluates a
 * getter and never throws for a non-object input.
 */
function mergeFeatureSurface(...apis) {
  const descriptors = {}
  for (const api of apis) {
    if (api === null || typeof api !== 'object') continue
    Object.assign(descriptors, Object.getOwnPropertyDescriptors(api))
  }
  return Object.defineProperties(Object.create(null), descriptors)
}

function resolveOfficialModule(name) {
  try {
    const mod = require(name)
    return mod ?? undefined
  } catch {
    return undefined
  }
}

function readOwnManifest() {
  try {
    const url = new URL('../package.json', import.meta.url)
    const pkg = JSON.parse(readFileSync(url, 'utf8'))
    return {
      apiVersion: pkg?.dsh?.api,
      packageVersion: pkg?.version,
    }
  } catch {
    return { apiVersion: undefined, packageVersion: undefined }
  }
}

function readRuntimeVersion() {
  try {
    const pkg = require('@deepseek-ai/dsh-llm/package.json')
    return pkg?.version
  } catch {
    return undefined
  }
}

/**
 * Build the stable "tool call aborted" factory once, lazily, and fail-safe.
 * `HarnessError` comes from the already-imported `dshLlm`; `TOOL_ABORTED` is
 * resolved lazily from `@deepseek-ai/dsh-tools` and may be absent — any
 * resolution failure only degrades the factory and never throws through apply
 *. The mode is decided at this single call, so it stays
 * stable for the host lifetime, surviving re-applies via
 * the reused service instance.
 * @param {(id: string) => unknown} [resolveModule] - injectable module loader
 *   for tests (defaults to the module-scoped `require`).
 * @returns {() => Error} stable factory (full identity or degraded).
 */
export function buildToolAbortedErrorFactory(resolveModule = require) {
  try {
    const dshTools = resolveModule('@deepseek-ai/dsh-tools')
    return createToolAbortedErrorFactory({
      HarnessError: dshLlm?.HarnessError,
      TOOL_ABORTED: dshTools?.TOOL_ABORTED,
    })
  } catch {
    return createToolAbortedErrorFactory({ HarnessError: dshLlm?.HarnessError })
  }
}

function readSessionDurableManifests() {
  const manifests = {}
  for (const name of Object.keys(SESSION_DURABLE_AUDIT.packages)) {
    try {
      manifests[name] = require(`${name}/package.json`)
    } catch {
      manifests[name] = undefined
    }
  }
  return manifests
}

function readPackageManifest(packageName) {
  try {
    const manifest = require(`${packageName}/package.json`)
    return {
      version: manifest?.version,
      api: manifest?.dsh?.api,
    }
  } catch {
    return undefined
  }
}

function readReplacementAuxiliaryManifests() {
  return {
    compactionEvents: readPackageManifest('@deepseek-ai/dsh-plugin-api-compaction-events'),
    sessionTitle: readPackageManifest('@deepseek-ai/dsh-plugin-api-session-title'),
    // session-branch facade
    sessionBranch: readPackageManifest(SESSION_BRANCH_PACKAGE_NAME),
    // session-branch facade
  }
}

function facadeRuntimeVersion(packageVersion) {
  return typeof packageVersion === 'string'
    ? packageVersion.match(/^(.+)-\d+\.\d+$/)?.[1]
    : undefined
}

function safeGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}

function createSafeLogger(ctx) {
  return {
    error(message) {
      try {
        ctx?.logger?.error?.(message)
      } catch {
        // logging must never take down the fail-safe path
      }
    },
    warn(message) {
      try {
        ctx?.logger?.warn?.(message)
      } catch {
        // logging must never take down the fail-safe path
      }
    },
  }
}

function formatProblems(problems) {
  return (problems ?? []).map((p) => `${p.name}: ${p.detail}`).join('; ')
}

/**
 * The single host-side publication boundary for prepared feature owners.
 * Nothing becomes publicly active until Cordis accepted the cleanup callback;
 * cleanup reverses publication before releasing owner resources and is both
 * idempotent and safe when an older callback runs after a later epoch.
 */
export function runPreparedMountTransaction({ ctx, featureName, cleanup, commit, rollback, activate }) {
  let closed = false
  const close = () => {
    if (closed) return false
    closed = true
    try {
      rollback?.()
    } catch {
      // Rollback is best effort; every cleanup stage must still be attempted.
    }
    try {
      cleanup?.()
    } catch {
      // Owner disposal must not escape the host fail-safe boundary.
    }
    return true
  }

  try {
    ctx.effect(() => close, `dsh-plugin-api: ${featureName} cleanup`)
    if (commit?.() === false) throw new Error('prepared feature commit returned false')
    activate?.()
    return close
  } catch (error) {
    close()
    throw error
  }
}

function mountLlmRequestFeature({ ctx, service, featureRegistry, logger, llmPipeline }) {
  // Unified idempotent re-apply signal.
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('llm/request')) {
    return { disposer: () => {}, prepared: null }
  }

  const llm = safeGet(ctx, 'llm')
  const agents = safeGet(ctx, 'agents')
  const owner = mountLlmRequestOwner({
    ctx,
    llm,
    contentHasImage: dshLlm?.contentHasImage,
    agents,
    policyHandle: llmPipeline,
    resolveAuthoritative: createAuthoritativeResolver(llm),
    logger,
  })
  if (!owner) {
    return null
  }

  // translated staged publication: cleanup registration and registry activation
  // precede prepared commit (semantic-hooks compat contract transaction gate).
  let prepared
  try {
    prepared = service.prepareFeature('llm/request', owner.api)
  } catch {
    try {
      owner.disposer()
    } catch {
      // An unpublished raw owner must not retain its listener after prepare fails.
    }
    return null
  }
  return {
    disposer: () => {
      try {
        owner.disposer()
      } catch {
        // disposal must never take down the fail-safe path
      }
    },
    prepared,
  }
}

function mountAdmissionFeature({ ctx, service, featureRegistry, logger, llmPipeline }) {
  // Unified idempotent re-apply signal.
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('llm/admission')) {
    return { disposer: () => {}, prepared: null }
  }

  // llm/request must be active: if the request owner is unavailable or failed
  // its staged transaction, admission is feature-disabled-disabled without installing a
  // gateway wrapper. If admission is unavailable, request transforms remain
  // available but non-native terminal image handling never relaxes the
  // official admission check.
  if (typeof featureRegistry?.isActive === 'function' && !featureRegistry.isActive('llm/request')) {
    return null
  }

  const llm = safeGet(ctx, 'llm')
  const apiProxy = safeGet(ctx, 'apiProxy')
  const agents = safeGet(ctx, 'agents')
  const registry = createLlmInputPolicyRegistry()

  const gateway = installLlmAdmissionGateway({
    llm,
    apiProxy,
    policySource: registry,
    agents,
    logger,
  })
  if (!gateway) {
    try {
      llmPipeline?.setPolicySource?.(null)
    } catch {
      // best-effort detach
    }
    return null
  }

  try {
    llmPipeline?.setPolicySource?.(registry)
  } catch (error) {
    logger.error(`dsh-plugin-api: llm/admission could not attach its policy source: ${error?.message ?? error}`)
    gateway.dispose()
    return null
  }

  let prepared
  try {
    prepared = service.prepareFeature('llm/admission', {
      register: (policy) => registry.register(policy),
    })
  } catch {
    try {
      llmPipeline?.setPolicySource?.(null)
    } catch {
      // Best-effort private pipeline detachment.
    }
    gateway.dispose()
    return null
  }
  return {
    disposer: () => {
      try {
        llmPipeline?.setPolicySource?.(null)
      } catch {
        // disposal must never take down the fail-safe path
      }
      gateway.dispose()
    },
    prepared,
  }
}


function mountToolsFeature({ service, featureRegistry }) {
  // Unified idempotent re-apply signal.
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('tools')) {
    return () => {}
  }


  service.mountFeature('tools', { isActive: true })
  return () => {}
}

function mountEventsFeature({ ctx, service, featureRegistry, logger, guardResults, facadeContract, auxiliaryManifests }) {
  // Guard-driven slice composition: the composed catalog contains the base
  // slice plus one slice per feature whose guard passed. Disabled features
  // contribute no entries; their event names fall through to the
  // non-cataloged passthrough (mount-time exclusion is the one and only
  // gating mechanism).
  const passed = (name) => Boolean(guardResults?.[name]?.ok)

  // Unified idempotent re-apply signal, with a defensive catalog signature
  // check: if the mounted catalog no longer matches the current guard-driven
  // composition, fall through and recompose (unreachable in practice because
  // guard inputs are stable across re-applies).
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('events')) {
    const existingCatalog = service?.events?.catalog
    const catalogMatches = Boolean(existingCatalog) &&
      (passed('tools') ? existingCatalog['tools/change'] !== undefined : existingCatalog['tools/change'] === undefined) &&
      (passed('session') ? existingCatalog['session/created'] !== undefined : existingCatalog['session/created'] === undefined)
    if (catalogMatches) {
      return () => {}
    }
  }
  let catalog
  try {
    const slices = [baseEventsCatalog]
    if (passed('agent')) slices.push(agentEventsCatalog)
    if (passed('llm')) slices.push(llmEventsCatalog)
    if (passed('systemPrompt')) slices.push(systemPromptEventsCatalog)
    if (passed('settings')) slices.push(settingsEventsCatalog)
    if (passed('session')) slices.push(sessionLifecycleEventsCatalog)
    if (passed('tools')) slices.push(toolsEventsCatalog)
    // Declarative host leaves: fail-open per producer slice. An unavailable
    // producer omits only its own slice; the remaining slices and the whole
    // existing catalog stay active. No native listener or bridge is added.
    for (const slice of officialHostEventCatalogSlices) {
      try {
        if (slice.isAvailable?.(ctx) === true) slices.push(slice.catalog)
      } catch {
        // per-slice inert on any probing failure
      }
    }
    catalog = composeCatalogs(...slices)
  } catch (error) {
    logger.error(`dsh-plugin-api events catalog composition failed: ${error?.message ?? error}`)
    return null
  }

  const rSlices = [
    createCompactionEventsCatalogSlice({
      expectedContract: facadeContract,
      auxiliaryManifest: auxiliaryManifests?.compactionEvents,
      logger,
    }),
    createSessionTitleEventsCatalogSlice({
      expectedContract: facadeContract,
      auxiliaryManifest: auxiliaryManifests?.sessionTitle,
      logger,
    }),
  ]
  const events = createEventsBus({ ctx, catalog, rSlices, logger })
  service.mountFeature('events', events)

  return () => {
    try {
      if (typeof events.dispose === 'function') events.dispose()
    } catch {
      // disposal must never take down the fail-safe path
    }
  }
}

function resolveConsumerAgents(consumerCtx) {
  return consumerCtx?.get?.('agents')
}

function createAgentBaseFactory({ routeOf, active, createAgentLeaf }) {
  const unavailable = (member) => () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('agent', `agent extension member "${member}" is unavailable`)
  }
  const create = unavailable('create')
  const resume = unavailable('resume')
  const register = unavailable('register')
  const enter = unavailable('provider.enter')
  const announce = unavailable('provider.announce')
  const setFactory = unavailable('provider.setFactory')
  const availability = Object.freeze({
    create: false,
    resume: false,
    register: false,
    provider: Object.freeze({ enter: false, announce: false, setFactory: false }),
  })
  const resolve = (consumerCtx) => {
    try {
      const agents = resolveConsumerAgents(consumerCtx)
      if (!agents) throw new Error('official agents service is unavailable')
      return agents
    } catch {
      throw new PluginApiFeatureDisabledError('agent', 'official agents service is no longer resolvable')
    }
  }
  return (consumerCtx) => {
    const view = {
      isActive: true,
      get(id) { return resolve(consumerCtx).get(id) },
      list() { return resolve(consumerCtx).list() },
      roots() { return resolve(consumerCtx).roots() },
      routeOf,
      create,
      resume,
      register,
      provider: Object.freeze({ isActive: false, enter, announce, setFactory }),
      availability,
    }
    // Official registry leaves degrade per member; they must
    // never affect the established agent member surface when the registry is absent.
    let registry
    try {
      registry = resolve(consumerCtx)
    } catch {
      registry = undefined
    }
    if (createAgentLeaf && registry) {
      const leaf = createAgentLeaf(registry)
      Object.defineProperties(view, Object.getOwnPropertyDescriptors(leaf.api))
    }
    return view
  }
}

function mountAgentFeature({ ctx, service, featureRegistry, logger }) {
  const alreadyActive = featureRegistry?.isActive?.('agent')
  const extension = createAgentCreateExtension({
    probeRegistry: () => safeGet(ctx, 'agents'),
    logger,
    active: () => service.isActive,
  })
  let baseToken
  let token
  let disposed = false
  let candidateActive = true
  let candidateCleanupDone = false
  const diagnostics = new Set()
  const reportCandidateFailure = (phase) => {
    if (diagnostics.has(phase)) return
    diagnostics.add(phase)
    logger?.error?.(`dsh-plugin-api agent extension unavailable (${phase})`)
  }
  const compose = (consumerCtx, base) => {
    if (!candidateActive) return base
    const extensionView = extension.createView(consumerCtx)
    // Descriptor merge keeps lazy getters (e.g. the agent options snapshot)
    // lazily evaluated on the composed view: a leaf-member failure stays
    // member-local and can never break the established agent read surface.
    const composed = Object.defineProperties(
      Object.create(null),
      Object.assign(
        {},
        Object.getOwnPropertyDescriptors(base),
        Object.getOwnPropertyDescriptors(extensionView),
      ),
    )
    Object.defineProperty(composed, 'provider', {
      enumerable: true,
      configurable: false,
      value: extensionView.provider,
    })
    Object.defineProperty(composed, 'availability', {
      enumerable: true,
      configurable: false,
      get() {
        return extension.availability
      },
    })
    return composed
  }
  const removeCandidate = (phase, report = true) => {
    if (candidateCleanupDone) return true
    const current = token
    let removed = false
    if (current) {
      try {
        removed = service.unmountFeature('agentExtension', current) === true
      } catch {
        removed = false
      }
      if (!removed) {
        try {
          removed = service._removeAgentExtension?.(current) === true
        } catch {
          removed = false
        }
      }
    }
    if (!removed) {
      try {
        removed = service._removeAgentExtensionByCompose?.(compose) === true
      } catch {
        removed = false
      }
    }
    candidateActive = false
    if (token === current) token = null
    if (!removed && report) reportCandidateFailure(phase)
    candidateCleanupDone = true
    return removed
  }
  const baseFactory = createAgentBaseFactory({
    routeOf: (exec) => service._execRouteDelegate(exec),
    active: () => service.isActive,
    createAgentLeaf: (registry) => createOfficialAgentLeaf({
      agents: registry,
      active: () => service.isActive,
    }),
  })
  return {
    reportCandidateFailure,
    disposer() {
      if (disposed) return
      disposed = true
      if (!baseToken) return
      try {
        service.unmountFeature('agent', baseToken)
      } catch {
        // Agent base cleanup must not escape the host fail-safe boundary.
      }
    },
    candidateDisposer() {
      removeCandidate('cleanup')
    },
    publish() {
      if (!alreadyActive && !baseToken) baseToken = service.mountFeature('agent', baseFactory)
    },
    finalize() {
      if (token) return
      candidateActive = true
      token = service.mountFeature('agentExtension', { name: 'agent-extension', compose })
    },
    rollbackCandidate() {
      removeCandidate('rollback', false)
    },
    rollback() {
      removeCandidate('rollback', false)
      if (baseToken) {
        service.unmountFeature('agent', baseToken)
        baseToken = null
      }
    },
  }
}

function mountLlmFeature({ ctx, service, featureRegistry }) {
  // Unified idempotent re-apply signal.
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('llm')) {
    return () => {}
  }

  const llm = safeGet(ctx, 'llm')
  const llmApi = createLlmApi({ llm, deepFreeze })
  const llmLeaf = createOfficialLlmLeaf({
    llm,
    publicExports: resolveOfficialModule('@deepseek-ai/dsh-llm') ?? dshLlm,
    active: () => service.isActive,
  })
  service.mountFeature('llm', mergeFeatureSurface(llmApi, llmLeaf.api))

  return () => {}
}

function mountSystemPromptFeature({ ctx, service, logger, featureRegistry }) {
  // Unified idempotent re-apply signal.
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('systemPrompt')) {
    return () => {}
  }

  const systemPrompt = safeGet(ctx, 'systemPrompt')
  const api = createSystemPromptApi({ systemPrompt })
  const leaf = createOfficialSystemPromptLeaf({
    systemPrompt,
    active: () => service.isActive,
  })
  service.mountFeature('systemPrompt', mergeFeatureSurface(api, leaf.api))
  return () => {}
}

function mountOfficialPassthroughFeature({ service, featureRegistry, logger }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('officialPassthrough')) {
    return () => {}
  }

  const owner = createOfficialPassthroughHost({
    namespace: dshSystemPrompt,
    active: () => service.isActive,
    logger,
  })
  let token
  try {
    token = service.mountFeature('officialPassthrough', owner.api)
  } catch {
    try { owner.dispose() } catch {}
    return null
  }
  return () => {
    try { owner.dispose() } catch {}
    let removed = false
    try { removed = service.unmountFeature('officialPassthrough', token) === true } catch {}
    if (removed) {
      try { featureRegistry?.disable?.('officialPassthrough', 'official passthrough owner disposed') } catch {}
    }
  }
}

function hasExactSessionDurableAudit({ runtimeVersion, facadeRuntimeVersion: runtimeFromFacade, manifests } = {}) {
  if (
    runtimeVersion !== SESSION_DURABLE_AUDIT.runtimeVersion
    || runtimeFromFacade !== SESSION_DURABLE_AUDIT.runtimeVersion
  ) return false
  return Object.entries(SESSION_DURABLE_AUDIT.packages).every(([name, version]) => manifests?.[name]?.version === version)
}

function mountSessionDurableFeature({ ctx, service, logger, featureRegistry, sessionDurableAudit } = {}) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('sessionDurable')) {
    return () => {}
  }

  if (
    typeof featureRegistry?.isActive !== 'function'
    || !featureRegistry.isActive('session')
    || !featureRegistry.isActive('events')
  ) return null

  if (!hasExactSessionDurableAudit(sessionDurableAudit)) return null

  const sessions = safeGet(ctx, 'sessions')
  const eventsApi = service?.events
  if (!sessions || typeof sessions.get !== 'function' || typeof sessions.list !== 'function' || !eventsApi || typeof eventsApi.on !== 'function') {
    return null
  }

  const contracts = buildSessionDurableContracts({
    Session: dshSession.Session,
    isJsonValue: dshSession.isJsonValue,
    snapshotJsonValue: dshSession.snapshotJsonValue,
    knownSessionEventTypes: dshSession.KNOWN_SESSION_EVENT_TYPES,
    isSurfaceEligibleType: dshSession.isSurfaceEligibleType,
  })
  if (!contracts.available) return null

  // The hub is service-lifetime state: epochs only attach private observer
  // maps, never their own events-bus `session/event` subscriptions.
  const hadHub = Boolean(service._durableObservationHub && !service._durableObservationHub.isClosed)
  if (!hadHub) service._durableObservationHub = createDurableObservationHub({ eventsApi, logger })
  const hub = service._durableObservationHub
  if (!hub?.nativeDisposer) return null

  const owner = createDurableEpochRegistrationOwner({ logger })
  let epoch
  const closeHubComposite = () => {
    // Each step is intentionally isolated: no fallible cleanup may prevent
    // later state invalidation or the final native release.
    let detached
    try { detached = hub.closeState() } catch {}
    try { hub.disposeEpoch(detached) } catch {}
    try { service.resetSessionDurable(epoch) } catch {}
    try { featureRegistry.disable('sessionDurable', 'session durable hub disposed') } catch {}
    try { hub.releaseNative() } catch {}
    if (service._durableObservationHub === hub) service._durableObservationHub = null
  }
  const reset = (diagnostic) => {
    if (service.resetSessionDurable(epoch)) {
      featureRegistry.disable('sessionDurable', diagnostic?.reason ?? 'durable session contract breach')
    }
  }
  if (!hadHub) {
    try {
      ctx.effect(() => {
        let disposed = false
        return () => {
          if (disposed) return false
          disposed = true
          // State invalidation precedes the fallible native disposer. The
          // epoch cleanup registered below then becomes a harmless stale no-op.
          closeHubComposite()
          return true
        }
      }, 'dsh-plugin-api: sessionDurable hub cleanup')
    } catch {
      closeHubComposite()
      return null
    }
  }
  const activeApi = createSessionDurableApi({
    Session: dshSession.Session,
    sessions,
    eventsApi,
    contracts,
    owner,
    reset,
    hub,
  })
  const facade = {
    get durableEventTypes() {
      return DURABLE_EVENT_TYPES
    },
    get durableEventDescriptors() {
      return DURABLE_EVENT_DESCRIPTORS
    },
    isDurableEventType(type) {
      return DURABLE_EVENT_TYPES.includes(type)
    },
    getDurableEventDescriptor(type) {
      return DURABLE_EVENT_DESCRIPTORS[type]
    },
    onDurable: activeApi.onDurable,
    onceDurable: activeApi.onceDurable,
    appendMessage(targetSession, kind, payload, options) {
      return appendMessage(targetSession, kind, payload, options, {
        Session: dshSession.Session,
        sessions,
        contracts,
        logger,
      })
    },
  }
  let closed = false
  const closeEpoch = () => {
    if (closed) return false
    closed = true
    hub.closeEpoch(activeApi._hubEpoch)
    return true
  }
  const prepared = service.prepareFeature('sessionDurable', {
    facade,
    closeEpoch,
    onMounted(value) {
      epoch = value
    },
  })

  return {
    disposer: closeEpoch,
    publish: prepared.commit,
    rollback() {
      const rolledBack = prepared.rollback()
      if (rolledBack) featureRegistry.disable('sessionDurable', 'session durable epoch disposed')
      // A failed first lifetime transaction owns the native entry and must
      // release it. Later epoch failures leave the idle service hub reusable.
      if (!hadHub) {
        closeHubComposite()
      }
      return rolledBack
    },
  }
}

function mountSettingsFeature({ ctx, service, logger, featureRegistry }) {
  // Unified idempotent re-apply signal.
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('settings')) {
    return () => {}
  }

  const settings = createSettingsApi({ ctx, logger })
  const leaf = createOfficialSettingsLeaf({
    ctx,
    active: () => service.isActive,
  })
  service.mountFeature('settings', mergeFeatureSurface(settings, leaf.api))

  return () => {
    try {
      settings.dispose()
    } catch {
      // disposal must never take down the fail-safe path
    }
  }
}

function loadSessionReferenceUriHelpers(logger) {
  try {
    const mod = require('@deepseek-ai/dsh-session-reference')
    if (
      typeof mod?.encodeSessionReferenceUri === 'function'
      && typeof mod?.decodeSessionReferenceUri === 'function'
    ) {
      return {
        encodeSessionReferenceUri: mod.encodeSessionReferenceUri,
        decodeSessionReferenceUri: mod.decodeSessionReferenceUri,
      }
    }
  } catch (error) {
    logger?.warn?.(`dsh-plugin-api: session reference URI helpers unavailable: ${error?.message ?? error}`)
  }
  return undefined
}

export function mountServicesFeature({ ctx, service, logger, uriHelpers, featureRegistry }) {
  // Unified idempotent re-apply signal.
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('services')) {
    return () => {}
  }

  const helpers = uriHelpers ?? loadSessionReferenceUriHelpers(logger)
  const namespace = createServicesNamespace({
    ctx,
    active: () => service.isActive,
    logger,
    uriHelpers: helpers,
  })
  service.mountFeature('services', namespace)
  return () => {}
}

function mountTypertFeature({ ctx, service, logger, featureRegistry }) {
  if (featureRegistry?.isActive?.('typert')) return () => {}
  const facade = createTypertFacade({ ctx, active: () => service.isActive, logger })
  if (!facade.isActive) return null
  const prepared = service.prepareFeature('typert', facade)
  return {
    disposer() { try { facade.dispose?.() } catch {} },
    prepared,
  }
}

function mountSettingsRemoteFeature({ ctx, service, logger, featureRegistry }) {
  if (featureRegistry?.isActive?.('settingsRemote')) return () => {}
  if (!featureRegistry?.isActive?.('typert')) return null
  const api = createSettingsRemoteApi({
    ctx,
    protocol: typertProtocol,
    active: () => service.isActive,
    logger,
  })
  if (!api.isActive) return null
  const prepared = service.prepareFeature('settingsRemote', api)
  return {
    disposer() { try { api.dispose?.() } catch {} },
    prepared,
  }
}

function mountHostRemoteFeature({ ctx, service, logger, featureRegistry }) {
  if (featureRegistry?.isActive?.('remote')) return () => {}
  if (!featureRegistry?.isActive?.('typert')) return null
  const api = createHostRemoteApi({
    ctx,
    protocol: typertProtocol,
    active: () => service.isActive,
    logger,
  })
  if (!api.isActive) return null
  const prepared = service.prepareFeature('remote', api)
  return {
    disposer() { try { api.dispose?.() } catch {} },
    prepared,
  }
}

export function mountExecRouteFeature({ ctx, service, featureRegistry, logger, createOwner = createExecRouteOwner }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('execRoute')) {
    return () => {}
  }

  // Route capture owns no agent or events behavior. It only needs the
  // established tools lifecycle and the public session request context.
  const required = ['tools', 'session']
  if (!required.every((name) => featureRegistry?.isActive?.(name))) return null

  const epoch = {}
  const ownerHookDisposers = []
  const ownerCtx = Object.create(ctx ?? null)
  ownerCtx.on = (...args) => {
    let disposer
    try {
      disposer = ctx?.on?.(...args)
    } catch (error) {
      try {
        ctx?.off?.(args[0], args[1])
      } catch {
        // A non-conforming native registration cannot escape the fail-safe path.
      }
      throw error
    }
    if (typeof disposer === 'function') {
      ownerHookDisposers.push(disposer)
      return disposer
    }
    try {
      ctx?.off?.(args[0], args[1])
    } catch {
      // A non-conforming native registration cannot escape the fail-safe path.
    }
    return disposer
  }
  const disposeOwnerHooks = () => {
    for (const dispose of ownerHookDisposers.splice(0)) {
      try {
        dispose()
      } catch {
        // A malformed owner cleanup must not escape apply().
      }
    }
  }
  let owner
  let token = null
  let rolledBack = false
  try {
    owner = createOwner({
      ctx: ownerCtx,
      logger,
      epoch,
      isCurrentEpoch: () => token !== null,
    })
    if (!owner || typeof owner.routeOf !== 'function' || typeof owner.dispose !== 'function') {
      try {
        owner?.dispose?.()
      } catch {
        // A malformed owner cannot escape the fail-safe mount path.
      }
      disposeOwnerHooks()
      return null
    }
  } catch {
    disposeOwnerHooks()
    return null
  }

  const rollback = () => {
    if (rolledBack) return
    rolledBack = true
    try {
      if (token !== null) service.unmountFeature('execRoute', token)
    } catch {
      // Transaction rollback must not escape apply().
    }
    try {
      owner.dispose()
    } catch {
      // Owner disposal must not escape apply().
    }
    disposeOwnerHooks()
  }

  return {
    disposer: rollback,
    publish() {
      token = service.mountFeature('execRoute', owner)
    },
    rollback,
  }
}

export function mountSessionRouteFeature({ ctx, service, featureRegistry, logger, createOwner = createSessionRouteOwner }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('sessionRoute')) {
    return { disposer: () => {}, prepared: null }
  }
  if (!featureRegistry?.isActive?.('session') || !featureRegistry?.isActive?.('events')) return null
  const sessions = safeGet(ctx, 'sessions')
  const eventsApi = service?.events
  if (!sessions || typeof sessions.get !== 'function' || typeof sessions.list !== 'function'
    || !eventsApi || typeof eventsApi.on !== 'function') return null

  let owner
  try {
    owner = createOwner({ sessions, eventsApi, ctx, logger, coreActive: () => service.isActive })
  } catch {
    return null
  }
  if (!owner?.api || typeof owner.dispose !== 'function') {
    try { owner?.dispose?.() } catch {}
    return null
  }
  let prepared
  try {
    prepared = service.prepareFeature('sessionRoute', owner.api)
  } catch {
    try { owner.dispose() } catch {}
    return null
  }
  return {
    disposer: () => {
      try { owner.dispose() } catch {}
      try { featureRegistry.disable('sessionRoute', 'session route epoch disposed') } catch {}
    },
    prepared,
  }
}

function mountExecutionFeature({ ctx, service, featureRegistry, logger }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('execution')) {
    return { disposer: () => {}, prepared: null }
  }
  // The mandatory substrate is ctx.on; source absence degrades per source at
  // mount time, never disables the whole feature.
  if (typeof ctx?.on !== 'function') return null

  const owner = createExecutionObservation({ ctx, logger })
  let prepared
  try {
    prepared = service.prepareFeature('execution', owner.api)
  } catch {
    try { owner.dispose() } catch {}
    return null
  }
  return {
    disposer: () => {
      try { owner.dispose() } catch {}
    },
    prepared,
  }
}

export function mountDiagnosticsFeature({ ctx, service, featureRegistry, logger, createOwner = createDiagnosticsOwner }) {
  // Unified idempotent re-apply signal.
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('diagnostics')) {
    return () => {}
  }

  // The diagnostics projection only needs the facade core to be active; the
  // facade core guard already verifies the shared boot primitives. Any owner
  // construction failure degrades the feature (fail-safe, never throws).
  let owner
  try {
    owner = createOwner({
      ctx,
      logger,
      coreActive: () => service.isActive,
      registry: featureRegistry,
    })
  } catch {
    return null
  }
  if (!owner?.api || typeof owner.dispose !== 'function'
    || typeof owner.api.register !== 'function'
    || typeof owner.api.get !== 'function'
    || typeof owner.api.onChange !== 'function') {
    try { owner?.dispose?.() } catch {}
    return null
  }
  let prepared
  try {
    prepared = service.prepareFeature('diagnostics', owner.api)
  } catch {
    try { owner.dispose() } catch {}
    return null
  }
  return {
    disposer() {
      try { owner.dispose() } catch {}
    },
    prepared,
  }
}

function mountUsageFeature({ ctx, service, featureRegistry, logger }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('usage')) {
    return { disposer: () => {}, prepared: null }
  }
  // The mandatory substrate for the provider-confirmed intake is ctx.on;
  // optional sources (execution correlation, tokenMeter) degrade at mount and
  // never disable the ledger/projections.
  if (typeof ctx?.on !== 'function') return null

  const owner = createUsage({ ctx, logger })
  let llmDisposer = null
  let prepared = null
  try {
    // Read-only execution-observation correlation: consume only the public
    // usage face existence. The usage ledger never creates execution identity
    // itself and degrades to missing when execution-observation is unavailable
    // or disabled.
    try {
      const execFace = service?.execution
      if (execFace && typeof execFace.get === 'function' && typeof execFace.onChange === 'function') {
        owner.setSourceAvailability('correlation', 'available')
      } else {
        owner.setSourceAvailability('correlation', 'missing')
      }
    } catch {
      owner.setSourceAvailability('correlation', 'missing')
    }
    // tokenMeter estimated source: fail-open.
    try {
      const meter = typeof ctx?.get === 'function' ? ctx.get?.('tokenMeter') : undefined
      owner.setSourceAvailability('tokenMeter', meter ? 'available' : 'missing')
    } catch {
      owner.setSourceAvailability('tokenMeter', 'missing')
    }
    // Non-intrusive provider-confirmed intake on the public llm/stream seam:
    // this listener only marks the source available and never consumes or
    // replaces the returned stream. Provider-confirmed usage payloads are
    // recorded by their observers through the public record() face, which
    // normalizes the official usage chunk (see usage-sample-normalizer).
    try {
      llmDisposer = ctx.on('llm/stream', (options, next) => {
        try {
          owner.setSourceAvailability('llmStream', 'available')
        } catch {
          // availability bookkeeping never interrupts dispatch
        }
        const result = next()
        if (result && typeof result.then === 'function') {
          Promise.resolve(result).catch(() => {})
        }
        return result
      })
    } catch {
      llmDisposer = null
      owner.setSourceAvailability('llmStream', 'missing')
    }
    prepared = service.prepareFeature('usage', owner.api)
  } catch {
    try {
      llmDisposer?.()
    } catch {
      // detection failure degrades only usage
    }
    try {
      owner.dispose()
    } catch {}
    return null
  }
  return {
    disposer: () => {
      try {
        llmDisposer?.()
      } catch {
        // best-effort detach
      }
      try {
        owner.dispose()
      } catch {}
    },
    prepared,
  }
}

function mountRecoveryFeature({ service, featureRegistry, logger }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('recovery')) {
    return { disposer: () => {}, prepared: null }
  }
  let owner
  try {
    owner = createRecoveryPolicyOwner({ logger })
  } catch {
    return null
  }
  if (!owner?.api || typeof owner.dispose !== 'function'
    || typeof owner.api.classify !== 'function'
    || typeof owner.api.evaluate !== 'function'
    || typeof owner.api.consume !== 'function') {
    try { owner?.dispose?.() } catch {}
    return null
  }
  let prepared
  try {
    prepared = service.prepareFeature('recovery', owner.api)
  } catch {
    try { owner.dispose() } catch {}
    return null
  }
  return {
    disposer: () => {
      try { owner.dispose() } catch {}
    },
    prepared,
  }
}

function mountCoordinationFeature({ ctx, service, featureRegistry, logger }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('coordination')) {
    return { disposer: () => {}, prepared: null }
  }
  let owner
  try {
    owner = createCoordinationLease({ ctx, logger })
  } catch {
    return null
  }
  if (!owner?.api || typeof owner.dispose !== 'function'
    || typeof owner.api.availability !== 'function'
    || typeof owner.api.acquire !== 'function'
    || typeof owner.api.heartbeat !== 'function'
    || typeof owner.api.release !== 'function'
    || typeof owner.api.takeover !== 'function'
    || typeof owner.api.compareAndSet !== 'function'
    || typeof owner.api.watch !== 'function') {
    try { owner?.dispose?.() } catch {}
    return null
  }
  let prepared
  try {
    prepared = service.prepareFeature('coordination', owner.api)
  } catch {
    try { owner.dispose() } catch {}
    return null
  }
  return {
    disposer: () => {
      try { owner.dispose() } catch {}
    },
    prepared,
  }
}

// security-policy: host owner of the pluginApi.security facade. Binds the
// official approval/tools seams and the facade-owned llm/stream re-entry
// point; a binding or owner failure degrades the whole feature to the
// fail-safe disabled state through the shared mount path (never throws).
function mountSecurityFeature({ ctx, service, featureRegistry, logger }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('security')) {
    return { disposer: () => {}, prepared: null }
  }
  let owner
  try {
    owner = createSecurityOwner({
      ctx,
      logger,
      diagnosticsFacade: () => service?.diagnostics ?? null,
    })
  } catch {
    return null
  }
  if (!owner?.api || typeof owner.dispose !== 'function'
    || typeof owner.api.policy?.register !== 'function'
    || typeof owner.api.redaction?.register !== 'function'
    || typeof owner.api.egress?.register !== 'function'
    || typeof owner.api.audit?.query !== 'function') {
    try { owner?.dispose?.() } catch {}
    return null
  }
  let prepared
  try {
    prepared = service.prepareFeature('security', owner.api)
  } catch {
    try { owner.dispose() } catch {}
    return null
  }
  return {
    disposer: () => {
      try { owner.dispose() } catch {}
    },
    prepared,
  }
}

function mountWorkspaceTransactionsFeature({ ctx, service, featureRegistry, logger }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('workspaceTransactions')) {
    return { disposer: () => {}, prepared: null }
  }
  const coordination = typeof service?._readSlot === 'function' ? service._readSlot('coordination') : null
  const recovery = typeof service?._readSlot === 'function' ? service._readSlot('recovery') : null
  let owner
  try {
    owner = createWorkspaceMutationTransaction({ ctx, coordination, recovery, logger })
  } catch {
    return null
  }
  let evidenceIntake = null
  try {
    evidenceIntake = createMutationEvidenceIntake({ ctx, logger })
  } catch {
    // a broken evidence intake degrades to no observations; the facade stays
  }
  if (!owner?.api || typeof owner.dispose !== 'function'
    || typeof owner.api.prepare !== 'function'
    || typeof owner.api.record !== 'function'
    || typeof owner.api.preview !== 'function'
    || typeof owner.api.commit !== 'function'
    || typeof owner.api.rollback !== 'function'
    || typeof owner.api.recover !== 'function'
    || typeof owner.api.get !== 'function'
    || typeof owner.api.observe !== 'function') {
    try { owner?.dispose?.() } catch {}
    try { evidenceIntake?.dispose?.() } catch {}
    return null
  }
  let prepared
  try {
    prepared = service.prepareFeature('workspaceTransactions', owner.api)
  } catch {
    try { owner.dispose() } catch {}
    try { evidenceIntake?.dispose?.() } catch {}
    return null
  }
  return {
    disposer: () => {
      try { owner.dispose() } catch {}
      try { evidenceIntake?.dispose?.() } catch {}
    },
    prepared,
  }
}

function mountTasksFeature({ ctx, service, featureRegistry, logger }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('tasks')) {
    return { disposer: () => {}, prepared: null }
  }
  const readSlot = typeof service?._readSlot === 'function' ? (name) => service._readSlot(name) : () => null
  let owner
  try {
    owner = createTaskExecutionObservation({
      ctx,
      execution: readSlot('execution'),
      recovery: readSlot('recovery'),
      coordination: readSlot('coordination'),
      diagnostics: readSlot('diagnostics'),
      workspaceTransactions: readSlot('workspaceTransactions'),
      logger,
    })
  } catch {
    return null
  }
  let evidenceIntake = null
  try {
    evidenceIntake = createTaskEvidenceIntake({
      ctx,
      execution: readSlot('execution'),
      logger,
    })
  } catch {
    // a broken evidence intake degrades to no provenance; the facade stays
  }
  if (!owner?.api || typeof owner.dispose !== 'function'
    || typeof owner.api.register !== 'function'
    || typeof owner.api.start !== 'function'
    || typeof owner.api.claim !== 'function'
    || typeof owner.api.reassign !== 'function'
    || typeof owner.api.settle !== 'function'
    || typeof owner.api.attach !== 'function'
    || typeof owner.api.get !== 'function'
    || typeof owner.api.observe !== 'function'
    || typeof owner.api.history !== 'function') {
    try { owner?.dispose?.() } catch {}
    try { evidenceIntake?.dispose?.() } catch {}
    return null
  }
  let prepared
  try {
    prepared = service.prepareFeature('tasks', owner.api)
  } catch {
    try { owner.dispose() } catch {}
    try { evidenceIntake?.dispose?.() } catch {}
    return null
  }
  return {
    disposer: () => {
      try { owner.dispose() } catch {}
      try { evidenceIntake?.dispose?.() } catch {}
    },
    prepared,
  }
}

function mountProfileFeature({ ctx, service, featureRegistry, logger, facadeContract, auxiliaryManifests }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('profile')) {
    return { disposer: () => {}, prepared: null }
  }
  let owner
  try {
    owner = createProfileInspection({ ctx, logger })
  } catch {
    return null
  }
  if (!owner?.api || typeof owner.dispose !== 'function'
    || typeof owner.api.inspect !== 'function'
    || typeof owner.api.health !== 'function'
    || typeof owner.api.planDiff !== 'function') {
    try { owner?.dispose?.() } catch {}
    return null
  }
  let prepared
  try {
    prepared = service.prepareFeature('profile', owner.api)
    const mutation = createProfileMutation({
      logger,
      installedRuntime: installedRuntimeVersion(),
      facadeApi: facadeContract?.api,
    })
    if (typeof service._setProfileMutationProvider === 'function') {
      service._setProfileMutationProvider((callerCtx) => mutation.apiFor(callerCtx))
    }
    const runtimeViewOwners = []
    try {
      const inspected = owner.api.inspect({ view: 'runtime' })
      for (const row of inspected?.rows ?? []) {
        if (typeof row?.name === 'string' && row.name.length > 0) runtimeViewOwners.push(row.name)
      }
    } catch {
      // an unreadable runtime view degrades the gc owner set to empty
    }
    const fireBootGc = () => { try { mutation.triggerBootGc(runtimeViewOwners) } catch {} }
    setTimeout(fireBootGc, 0)
  } catch {
    try { owner.dispose() } catch {}
    return null
  }
  return {
    disposer: () => {
      try { owner.dispose() } catch {}
      if (typeof service._setProfileMutationProvider === 'function') {
        try { service._setProfileMutationProvider(null) } catch {}
      }
    },
    prepared,
  }
}

// tool-discovery
/**
 * Construct the tool discovery engine and publish it on `pluginApi.tools.discovery`.
 * Fail-safe gradient: provider/section registration failures degrade only the
 * exposure planes (availability reports them truthfully); the catalog,
 * search, activation and audit faces stay fully usable; any construction
 * failure is caught by the generic mount fail-safe, which disables the
 * feature without touching the rest of the boot.
 */
function mountToolDiscoveryFeature({ ctx, service, featureRegistry, logger }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('toolDiscovery')) {
    return { disposer: () => {}, prepared: null }
  }
  const systemPrompt = ctx.get('systemPrompt')
  const exposure = { providerRegistered: false, hintRegistered: false }
  const reportDiagnostics = (ownerId, detail) => {
    try {
      logger?.error?.(`dsh-plugin-api tool-discovery: ${detail} (owner: ${ownerId})`)
    } catch {
      // diagnostics must never escape the fail-safe path
    }
  }
  const engine = createToolDiscoveryEngine({
    scopeConstraint: buildToolDiscoveryScopeConstraint(ctx),
    reportDiagnostics,
    isActive: () => Boolean(service?.isActive),
  })
  let providerDisposer = null
  let hintDisposer = null
  try {
    providerDisposer = systemPrompt.tools((context) => engine.provider(context))
    exposure.providerRegistered = true
  } catch (error) {
    reportDiagnostics('<facade>', `exposure provider registration failed: ${error?.message ?? error}`)
  }
  try {
    hintDisposer = systemPrompt.section({
      name: 'discovery:hints',
      order: 1000,
      text: (context) => engine.hintText(context),
    })
    exposure.hintRegistered = true
  } catch (error) {
    reportDiagnostics('<facade>', `hint section registration failed: ${error?.message ?? error}`)
  }
  const ownerApi = {
    catalog: engine.catalog,
    search: engine.search,
    activate: engine.activate,
    deactivate: engine.deactivate,
    audit: engine.audit,
    availability: () => engine.availability(exposure),
    provider: engine.provider,
    hintText: engine.hintText,
  }
  service.mountFeature('toolDiscovery', ownerApi)
  return {
    disposer: () => {
      try { providerDisposer?.() } catch {}
      try { hintDisposer?.() } catch {}
      try { engine.dispose() } catch {}
    },
    prepared: null,
  }
}

/**
 * Scope-constraint seam over the marked agent-loop replacement's route
 * decisions (consumption only: this feature never makes route judgments).
 * Absent or gated route policy yields no constraint at all; a scope with no
 * decision on record yields an explicit unknown marker; otherwise the latest
 * decision for the scope is reported as the applied constraint (its rejection
 * reason when denied). The seam is synchronous and never throws.
 */
export function buildToolDiscoveryScopeConstraint(ctx, resolveRoutePolicy = resolveMarkedRoutePolicy) {
  let routePolicy
  try {
    routePolicy = resolveRoutePolicy(ctx)
  } catch {
    routePolicy = null
  }
  if (!routePolicy || typeof routePolicy.decisions?.history !== 'function') return null
  return (scopeKey) => {
    let page
    try {
      page = routePolicy.decisions.history({ sessionId: scopeKey }, { limit: 100 })
    } catch (error) {
      return { status: 'unknown', source: 'route-policy', detail: 'route-decision-read-failed', forbidden: [] }
    }
    const items = Array.isArray(page?.items) ? page.items : []
    const decision = items[items.length - 1]
    if (!decision) return { status: 'unknown', source: 'route-policy', detail: 'no-route-decision', forbidden: [] }
    return {
      status: 'applied',
      source: 'route-policy',
      reason: String(decision.reason?.code ?? (decision.commitState === 'denied' ? 'route-denied' : 'route-decided')),
      forbidden: [],
    }
  }
}
// tool-discovery

// session-branch facade
/**
 * Mount the branch facade add-on under `pluginApi.session.branches`.
 *
 * The facade is a read-only projection plus operation entry over the
 * replacement row's `sessions.branches` sub-interface; it lazily resolves the
 * marked replacement and never imports the auxiliary package. The version
 * gate mirrors the replacement-catalog-slice policy: a mismatch disables only
 * this facade's live surface while the rest of the session facade stays
 * active.
 */
function sessionBranchAuxiliaryVersionMatches(auxiliaryManifest, facadeContract) {
  if (facadeContract === undefined || facadeContract === null) return false
  const parsed = parseFacadeVersion(auxiliaryManifest?.version)
  const api = typeof auxiliaryManifest?.api === 'string' ? auxiliaryManifest.api.trim() : undefined
  if (!parsed || api !== facadeContract.api) return false
  return parsed.runtime === facadeContract.runtime && parsed.api === facadeContract.api
}

function resolveSessionBranchSurface(ctx) {
  try {
    const sessions = ctx?.get?.('sessions')
    if (sessions?.[SESSION_BRANCH_CONTRACT_MARKER] !== true) return null
    const branches = sessions.branches
    if (!branches || typeof branches.create !== 'function') return null
    return branches
  } catch {
    return null
  }
}

function mountSessionBranchFeature({ ctx, service, featureRegistry, logger, auxiliaryManifests, facadeContract }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('sessionBranch')) {
    return { disposer: () => {}, prepared: null }
  }
  const versionOk = sessionBranchAuxiliaryVersionMatches(auxiliaryManifests?.sessionBranch, facadeContract)
  let mismatchReported = false
  if (versionOk === false && !mismatchReported) {
    mismatchReported = true
    try {
      logger?.warn?.(
        `dsh-plugin-api: auxiliary package ${SESSION_BRANCH_PACKAGE_NAME} version does not match the main facade contract; the session branch surface is disabled`,
      )
    } catch {
      // diagnostics must never change mount outcomes
    }
  }
  const resolve = () => (versionOk === true ? resolveSessionBranchSurface(ctx) : null)
  const ensure = () => {
    const branches = resolve()
    if (branches === null) {
      throw new PluginApiFeatureDisabledError('sessionBranch', 'the session branch replacement is not active or its version is mismatched')
    }
    return branches
  }
  if (versionOk === false) {
    // A missing or mismatched auxiliary contract disables only this facade
    // feature; the typed disabled add-on remains on the session surface.
    return null
  }
  const invoke = (method) => (...args) => {
    const branches = ensure()
    return Reflect.apply(branches[method], branches, args)
  }
  const ownerApi = {
    create: invoke('create'),
    graph: invoke('graph'),
    plan: invoke('plan'),
    preview: invoke('preview'),
    commit: invoke('commit'),
    rollback: invoke('rollback'),
    restore: invoke('restore'),
    availability() {
      const branches = resolve()
      if (branches === null) {
        return Object.freeze({ active: false, contract: false, versionMatch: versionOk === true })
      }
      const inner = typeof branches.availability === 'function' ? branches.availability() : {}
      return Object.freeze({ active: true, contract: true, versionMatch: versionOk === true, ...inner })
    },
  }
  let prepared
  try {
    prepared = service.prepareFeature('sessionBranch', ownerApi)
  } catch {
    return null
  }
  return {
    disposer: () => {},
    prepared,
  }
}
export { mountSessionBranchFeature }
// session-branch facade


// Final integrated order: tools must mount before
// events (guard-driven catalog composition reads the tools outcome) and
// events must mount before session (session mount requires an active events
// feature). llm mounts before llm/request (the request owner wraps the
// public llm/stream waterfall) and llm/admission mounts after the request
// owner (admission depends on the owner pipeline and never installs a second
// stream listener). security-policy mounts after llm/admission so its
// llm/stream listener registers after the request owner's (model-request-before
// then evaluates the effective, possibly re-entered request exactly once).
// web is served by the services namespace (pluginApi.services.web).
const FEATURE_MOUNTERS = new Map([
  ['tools', mountToolsFeature],
  ['events', mountEventsFeature],
  ['agent', mountAgentFeature],
  ['llm', mountLlmFeature],
  ['llm/request', mountLlmRequestFeature],
  ['llm/admission', mountAdmissionFeature],
  ['security', mountSecurityFeature], // security-policy
  ['session', mountSessionFeature],
  // session-branch facade
  ['sessionBranch', mountSessionBranchFeature],
  // session-branch facade
  ['sessionDurable', mountSessionDurableFeature],
  ['execRoute', mountExecRouteFeature],
  ['sessionRoute', mountSessionRouteFeature],
  ['settings', mountSettingsFeature],
  ['systemPrompt', mountSystemPromptFeature],
  ['officialPassthrough', mountOfficialPassthroughFeature],
  ['services', mountServicesFeature],
  ['typert', mountTypertFeature],
  ['settingsRemote', mountSettingsRemoteFeature],
  ['remote', mountHostRemoteFeature],
  ['execution', mountExecutionFeature],
  ['recovery', mountRecoveryFeature],
  ['coordination', mountCoordinationFeature],
  ['workspaceTransactions', mountWorkspaceTransactionsFeature],
  ['diagnostics', mountDiagnosticsFeature],
  ['usage', mountUsageFeature],
  ['tasks', mountTasksFeature],

  // tool-discovery
  ['toolDiscovery', mountToolDiscoveryFeature],
  // tool-discovery

  ['profile', mountProfileFeature],
])

export function apply(ctx) {
  const logger = createSafeLogger(ctx)
  let coreActive = false
  let service = null
  let featureRegistry = null

  try {
    const manifest = readOwnManifest()
    const runtimeVersion = readRuntimeVersion()
    const facadeContract = {
      runtime: facadeRuntimeVersion(manifest.packageVersion),
      api: typeof manifest.apiVersion === 'string' ? manifest.apiVersion.trim() : undefined,
    }
    const auxiliaryManifests = readReplacementAuxiliaryManifests()
    const sessionDurableAudit = {
      runtimeVersion,
      facadeRuntimeVersion: facadeRuntimeVersion(manifest.packageVersion),
      manifests: readSessionDurableManifests(),
    }
    const core = runCoreGuard(ctx, {
      apiVersion: manifest.apiVersion,
      facadeVersion: manifest.packageVersion,
      runtimeVersion,
    })

    const existing = safeGet(ctx, 'pluginApi')

    if (existing && existing[pluginApiBrand]) {
      service = existing
      featureRegistry =
        existing._registry && typeof existing._registry.snapshot === 'function'
          ? existing._registry
          : createFeatureRegistry()
      if (typeof service.reconcile === 'function') {
        service.reconcile({ registry: featureRegistry, coreActive: () => coreActive })
      }
    } else if (existing) {
      logger.error(
        'dsh-plugin-api: another plugin already provided a non-facade "pluginApi" service; the facade will not overwrite it',
      )
      return
    } else {
      featureRegistry = createFeatureRegistry()
      const ServiceClass = createPluginApiService({
        apiVersion: manifest.apiVersion,
        registry: featureRegistry,
        coreActive: () => coreActive,
        toolAbortedErrorFactory: buildToolAbortedErrorFactory(),
        mcpCatalogProvider: () => resolveMarkedMcpCatalog(ctx),
        attachmentsProvider: () => resolveMarkedAttachmentPipeline(ctx),
        routePolicyProvider: () => resolveMarkedRoutePolicy(ctx),
      })

      if (typeof ctx?.plugin !== 'function') {
        const problems = [{ name: 'ctx.plugin', detail: 'fiber context cannot register the pluginApi service' }]
        const logPath = writeGuardLog(problems)
        logger.error(guardFailNotice(logPath))
        return
      }

      try {
        ctx.plugin(ServiceClass)
      } catch (error) {
        logger.error(`dsh-plugin-api failed to register pluginApi service: ${error?.message ?? error}`)
        return
      }

      service = safeGet(ctx, 'pluginApi')
      if (!service) {
        logger.error('dsh-plugin-api: pluginApi service did not become available after registration')
        return
      }
    }

    coreActive = core.ok

    if (!core.ok) {
      const logPath = writeGuardLog(core.problems)
      logger.error(guardFailNotice(logPath))
      return
    }

    // Core is active. Pass 1: run every feature guard up front so that
    // guard-driven catalog composition (mountEventsFeature) can see the
    // outcome of features mounted later in the order.
    const guardResults = {}
    for (const [featureName] of FEATURE_MOUNTERS) {
      guardResults[featureName] = runFeatureGuard(featureName, ctx, {
        dshLlm,
        dshSession,
        dshSystemPrompt,
        typertProtocol,
        runtimeVersion,
        facadeRuntimeVersion: sessionDurableAudit.facadeRuntimeVersion,
        sessionDurableManifests: sessionDurableAudit.manifests,
      })
    }

    // Pass 2: mount each feature whose feature-level guard passed. The shared
    // pipeline handle lets the request owner read frozen image-admission policy
    // identities while the admission feature owns the live registry.
    const llmPipeline = createLlmPipelineHandle()

    for (const [featureName, mount] of FEATURE_MOUNTERS) {
      const featureGuard = guardResults[featureName]

      if ((featureName === 'execRoute' || featureName === 'agent') && featureRegistry.isActive(featureName)) {
        continue
      }

      if (!featureGuard.ok) {
        featureRegistry.disable(featureName, formatProblems(featureGuard.problems))
        if (featureName === 'execRoute') {
          service.reportExecRouteDiagnosticsOnce?.('guard', 'mandatory-substrate', featureGuard.problems)
        } else {
          const logPath = writeGuardLog(featureGuard.problems)
          logger.error(featureFailNotice(featureName, logPath))
        }
        continue
      }

      if (typeof ctx?.effect !== 'function') {
        const problems = [{ name: 'ctx.effect', detail: 'feature cleanup cannot be registered' }]
        featureRegistry.disable(featureName, formatProblems(problems))
        if (featureName === 'execRoute') {
          service.reportExecRouteDiagnosticsOnce?.('activation', 'cleanup-registration', problems)
        } else {
          const logPath = writeGuardLog(problems)
          logger.error(featureFailNotice(featureName, logPath))
        }
        continue
      }

      let mounted
      try {
        mounted = mount({ ctx, service, featureRegistry, logger, guardResults, llmPipeline, sessionDurableAudit, facadeContract, auxiliaryManifests })
      } catch (error) {
        if (featureName === 'execRoute') {
          const problems = [{ name: featureName, detail: `feature mount failed: ${error?.message ?? error}` }]
          featureRegistry.disable(featureName, formatProblems(problems))
          service.reportExecRouteDiagnosticsOnce?.('mount', 'dependency-or-registration', problems)
          continue
        }
        logger.error(`dsh-plugin-api feature "${featureName}" mount failed: ${error?.message ?? error}`)
      }

      // agent extension/execRoute owners use publish/rollback transactions. image admission/compat request owners
      // carry the service-level prepared transaction beside their disposer.
      const ownerPrepared = mounted && typeof mounted === 'object' &&
        typeof mounted.disposer === 'function' &&
        typeof mounted.publish === 'function' &&
        typeof mounted.rollback === 'function'

      const agentPrepared = ownerPrepared && featureName === 'agent' && typeof mounted.finalize === 'function'
      if (agentPrepared) {
        try {
          ctx.effect(() => mounted.disposer, `dsh-plugin-api: ${featureName} cleanup`)
          mounted.publish()
          featureRegistry.mount(featureName)
        } catch (error) {
          try { mounted.rollback() } catch {}
          const problems = [{ name: featureName, detail: `failed to activate feature: ${error?.message ?? error}` }]
          featureRegistry.disable(featureName, formatProblems(problems))
          const logPath = writeGuardLog(problems)
          logger.error(featureFailNotice(featureName, logPath))
          continue
        }
        try {
          ctx.effect(() => mounted.candidateDisposer, `dsh-plugin-api: ${featureName} extension cleanup`)
          mounted.finalize()
        } catch {
          try { mounted.rollbackCandidate?.() } catch {}
          mounted.reportCandidateFailure?.('cleanup-registration-or-publication')
        }
        continue
      }

      const reportPreparedFailure = (category, error) => {
        const problems = [{ name: featureName, detail: `failed to ${category} feature: ${error?.message ?? error}` }]
        if (featureName === 'agent' && mounted.agentCandidate) {
          try { mounted.rollback() } catch {}
          logger.error(`dsh-plugin-api agent extension ${category} failed: ${error?.message ?? error}`)
          return
        }
        try { mounted.rollback() } catch {}
        featureRegistry.disable(featureName, formatProblems(problems))
        if (featureName === 'execRoute') {
          service.reportExecRouteDiagnosticsOnce?.('activation', category, problems)
        } else {
          const logPath = writeGuardLog(problems)
          logger.error(featureFailNotice(featureName, logPath))
        }
      }

      if (ownerPrepared) {
        try {
          runPreparedMountTransaction({
            ctx,
            featureName,
            cleanup: mounted.disposer,
            commit: mounted.publish,
            rollback: mounted.rollback,
            activate: () => featureRegistry.mount(featureName),
          })
        } catch (error) {
          const category = error?.message?.includes('publish') ? 'publication'
            : error?.message?.includes('registry') ? 'registry'
              : 'cleanup-registration'
          reportPreparedFailure(category, error)
        }
        continue
      }

      let disposer
      let prepared
      if (mounted && typeof mounted === 'object' && typeof mounted.disposer === 'function') {
        disposer = mounted.disposer
        prepared = typeof mounted.prepared?.commit === 'function' ? mounted.prepared : null
      } else if (typeof mounted === 'function') {
        disposer = mounted
      }
      if (typeof disposer !== 'function') {
        const problems = [{ name: featureName, detail: 'feature mount did not produce a disposer; feature disabled' }]
        featureRegistry.disable(featureName, formatProblems(problems))
        if (featureName === 'execRoute') {
          service.reportExecRouteDiagnosticsOnce?.('mount', 'dependency-or-registration', problems)
        } else {
          const logPath = writeGuardLog(problems)
          logger.error(featureFailNotice(featureName, logPath))
        }
        continue
      }

      try {
        if (prepared) {
          runPreparedMountTransaction({
            ctx,
            featureName,
            cleanup: disposer,
            commit: prepared.commit,
            rollback: prepared.rollback,
            activate: () => featureRegistry.mount(featureName),
          })
        } else {
          ctx.effect(() => disposer, `dsh-plugin-api: ${featureName} cleanup`)
          featureRegistry.mount(featureName)
        }
      } catch (error) {
        // Staged transaction rollback, then best-effort disposal, then
        // disable; unrelated features continue mounting.
        try {
          prepared?.rollback?.()
        } catch {
          // rollback must never take down the fail-safe path
        }
        try {
          disposer()
        } catch {
          // disposal must never take down the fail-safe path
        }
        const problems = [{ name: 'ctx.effect', detail: `failed to register cleanup for feature "${featureName}": ${error?.message ?? error}` }]
        featureRegistry.disable(featureName, formatProblems(problems))
        const logPath = writeGuardLog(problems)
        logger.error(featureFailNotice(featureName, logPath))
      }
    }
  } catch (error) {
    // Final fail-safe catch-all: apply must never throw.
    logger.error(`dsh-plugin-api apply failed unexpectedly: ${error?.message ?? error}`)
  }
}
