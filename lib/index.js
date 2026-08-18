/**
 * dsh-plugin-api host plugin — M0 foundation (plugin-api-foundation).
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
import { composeCatalogs } from './catalog-compose.js'
import { createEventsBus } from './events-bus.js'
import { baseEventsCatalog } from './events-catalog.js'
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
import { createLlmApi } from './llm-api.js'
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
import { appendMessage, createDurableEpochRegistrationOwner, createSessionDurableApi } from './session-durable-feature.js'

import { mountSessionFeature } from './session-feature.js'
import { sessionLifecycleEventsCatalog } from './session-events-catalog.js'
import { createSystemPromptApi } from './system-prompt.js'
import { createSettingsApi } from './settings.js'

export const name = 'dsh-plugin-api'
export const inject = []

const require = createRequire(import.meta.url)

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
  // Unified idempotent re-apply signal (task 2.5).
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

  // B-class staged publication: cleanup registration and registry activation
  // precede prepared commit (semantic-hooks M2 A1 transaction gate).
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
  // Unified idempotent re-apply signal (task 2.5).
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('llm/admission')) {
    return { disposer: () => {}, prepared: null }
  }

  // llm/request must be active: if the request owner is unavailable or failed
  // its staged transaction, admission is P2-disabled without installing a
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
  // Unified idempotent re-apply signal (task 2.5).
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('tools')) {
    return () => {}
  }


  service.mountFeature('tools', { isActive: true })
  return () => {}
}

function mountEventsFeature({ ctx, service, featureRegistry, logger, guardResults }) {
  // Guard-driven slice composition (design C2/C4): the composed catalog
  // contains the base slice plus one slice per feature whose guard passed.
  // Disabled features contribute no entries; their event names fall through
  // to the non-cataloged passthrough (mount-time exclusion is the one and
  // only gating mechanism).
  const passed = (name) => Boolean(guardResults?.[name]?.ok)

  // Unified idempotent re-apply signal (task 2.5), with a defensive catalog
  // signature check: if the mounted catalog no longer matches the current
  // guard-driven composition, fall through and recompose (unreachable in
  // practice because guard inputs are stable across re-applies).
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
    catalog = composeCatalogs(...slices)
  } catch (error) {
    logger.error(`dsh-plugin-api events catalog composition failed: ${error?.message ?? error}`)
    return null
  }

  const events = createEventsBus({ ctx, catalog, logger })
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

function createAgentBaseFactory({ routeOf, active }) {
  const unavailable = (member) => () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('agent', `A11 member "${member}" is unavailable`)
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
  return (consumerCtx) => ({
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
  })
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
    logger?.error?.(`dsh-plugin-api agent A11 extension unavailable (${phase})`)
  }
  const compose = (consumerCtx, base) => {
    if (!candidateActive) return base
    const a11 = extension.createView(consumerCtx)
    const composed = {
      ...base,
      ...a11,
      provider: a11.provider,
    }
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
      token = service.mountFeature('agentExtension', { name: 'a11', compose })
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
  // Unified idempotent re-apply signal (task 2.5).
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('llm')) {
    return () => {}
  }

  const llm = safeGet(ctx, 'llm')
  const llmApi = createLlmApi({ llm, deepFreeze })
  service.mountFeature('llm', llmApi)

  return () => {}
}

function mountSystemPromptFeature({ ctx, service, logger, featureRegistry }) {
  // Unified idempotent re-apply signal (task 2.5).
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('systemPrompt')) {
    return () => {}
  }

  const systemPrompt = safeGet(ctx, 'systemPrompt')
  const api = createSystemPromptApi({ systemPrompt })
  service.mountFeature('systemPrompt', api)
  return () => {}
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

  const owner = createDurableEpochRegistrationOwner({ logger })
  let epoch
  const reset = (diagnostic) => {
    if (service.resetSessionDurable(epoch)) {
      featureRegistry.disable('sessionDurable', diagnostic?.reason ?? 'durable session contract breach')
    }
  }
  const activeApi = createSessionDurableApi({
    Session: dshSession.Session,
    sessions,
    eventsApi,
    contracts,
    owner,
    reset,
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
    owner.close()
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
      return rolledBack
    },
  }
}

function mountSettingsFeature({ ctx, service, logger, featureRegistry }) {
  // Unified idempotent re-apply signal (task 2.5).
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('settings')) {
    return () => {}
  }

  const settings = createSettingsApi({ ctx, logger })
  service.mountFeature('settings', settings)

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
  // Unified idempotent re-apply signal (task 2.5).
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

export function mountExecRouteFeature({ ctx, service, featureRegistry, logger, createOwner = createExecRouteOwner }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('execRoute')) {
    return () => {}
  }

  const required = ['tools', 'events', 'agent', 'session']
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

// Final integrated order (design C4, task 2.9): tools must mount before
// events (guard-driven catalog composition reads the tools outcome) and
// events must mount before session (session mount requires an active events
// feature). llm mounts before llm/request (the request owner wraps the
// public llm/stream waterfall) and llm/admission mounts after the request
// owner (admission depends on the owner pipeline and never installs a second
// stream listener). web is served by the services namespace
// (pluginApi.services.web).
const FEATURE_MOUNTERS = new Map([
  ['tools', mountToolsFeature],
  ['events', mountEventsFeature],
  ['agent', mountAgentFeature],
  ['llm', mountLlmFeature],
  ['llm/request', mountLlmRequestFeature],
  ['llm/admission', mountAdmissionFeature],
  ['session', mountSessionFeature],
  ['sessionDurable', mountSessionDurableFeature],
  ['execRoute', mountExecRouteFeature],
  ['settings', mountSettingsFeature],
  ['systemPrompt', mountSystemPromptFeature],
  ['services', mountServicesFeature],
])

export function apply(ctx) {
  const logger = createSafeLogger(ctx)
  let coreActive = false
  let service = null
  let featureRegistry = null

  try {
    const manifest = readOwnManifest()
    const runtimeVersion = readRuntimeVersion()
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
        runtimeVersion,
        facadeRuntimeVersion: sessionDurableAudit.facadeRuntimeVersion,
        sessionDurableManifests: sessionDurableAudit.manifests,
      })
    }

    // Pass 2: mount each feature whose feature-level guard passed. The shared
    // pipeline handle lets the request owner read frozen L2 policy identities
    // while the admission feature owns the live registry.
    const llmPipeline = createLlmPipelineHandle()

    for (const [featureName, mount] of FEATURE_MOUNTERS) {
      const featureGuard = guardResults[featureName]

      if ((featureName === 'execRoute' || featureName === 'agent') && featureRegistry.isActive(featureName)) {
        continue
      }

      if (!featureGuard.ok) {
        featureRegistry.disable(featureName, formatProblems(featureGuard.problems))
        if (featureName === 'execRoute') {
          service.reportExecRouteP2Once?.('guard', 'mandatory-substrate', featureGuard.problems)
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
          service.reportExecRouteP2Once?.('activation', 'cleanup-registration', problems)
        } else {
          const logPath = writeGuardLog(problems)
          logger.error(featureFailNotice(featureName, logPath))
        }
        continue
      }

      let mounted
      try {
        mounted = mount({ ctx, service, featureRegistry, logger, guardResults, llmPipeline, sessionDurableAudit })
      } catch (error) {
        if (featureName === 'execRoute') {
          const problems = [{ name: featureName, detail: `feature mount failed: ${error?.message ?? error}` }]
          featureRegistry.disable(featureName, formatProblems(problems))
          service.reportExecRouteP2Once?.('mount', 'dependency-or-registration', problems)
          continue
        }
        logger.error(`dsh-plugin-api feature "${featureName}" mount failed: ${error?.message ?? error}`)
      }

      // A11/execRoute owners use publish/rollback transactions. L2/L4 owners
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
          ctx.effect(() => mounted.candidateDisposer, `dsh-plugin-api: ${featureName} A11 cleanup`)
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
          service.reportExecRouteP2Once?.('activation', category, problems)
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
          service.reportExecRouteP2Once?.('mount', 'dependency-or-registration', problems)
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
