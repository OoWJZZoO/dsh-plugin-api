/**
 * Checkpoints facade composition — `pluginApi.executions.recovery.checkpoints`
 * (integration wave mounts this surface into the shared mounter; this module
 * only builds the frozen surface and never touches shared mounter/guard
 * files).
 *
 * Faces: `create` (capture mutation), `list`/`inspect` (projection),
 * `planRestore` (pure plan projection), `restore` (operation authority) and
 * `availability`. Every entry is fail-safe: core-inactive raises the uniform
 * core-inactive error at the entry point; feature-level disabled faces and
 * typed outcomes are produced by the capability path (typed disabled or
 * unavailable per the contract).
 */

import { deepFreeze } from './deep-freeze.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'
import { createCheckpointStore } from './checkpoint-record.js'
import { createCaptureAuthority } from './checkpoint-capture.js'
import { createCheckpointProjection } from './checkpoint-projection.js'
import { createRestorePlanner } from './checkpoint-plan.js'
import { createLoopFacts } from './checkpoint-facts.js'
import { createAutoCapturePolicy } from './checkpoint-auto-capture.js'
import { createRestoreAuthority } from './checkpoint-restore.js'
import { createCheckpointAvailability } from './checkpoint-availability.js'
import { createRestoreStepAdapters, resolveCaptureSource } from './checkpoint-sources.js'

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

/**
 * Build the checkpoints surface.
 * @param {{
 *   ctx?: object,
 *   active?: Function,
 *   ownerOf?: Function,
 *   facility?: object,           // durable record backend facility
 *   authorities?: object,        // { branch, journal, snapshot } capture faces
 *   stepAuthorities?: object,    // { branches, transactions, snapshot } restore faces
 *   facts?: object,              // shared loop slice guest facet
 *   activity?: object,           // sessions.activity degraded evidence facet
 *   coordination?: object,       // coordination face
 *   waitForTerminal?: Function,
 *   audit?: object,
 *   idFactory?: Function,
 *   now?: Function,
 *   logger?: object,
 * }} options
 */
export function createCheckpointsApi(options = {}) {
  const { ctx = {}, active, ownerOf, now, logger } = options
  const isActive = typeof active === 'function' ? active : () => true
  const clock = typeof now === 'function' ? now : () => new Date()

  const store = options.store ?? createCheckpointStore({ facility: options.facility, logger })
  const facts = options.facts ?? createLoopFacts({ facts: options.factsSource, activity: options.activity, logger })
  const capture = options.capture ?? createCaptureAuthority({ store, authorities: options.authorities ?? {}, ownerOf, idFactory: options.idFactory, now: clock, audit: options.audit, logger })
  const sourceAdapters = options.sources ?? captureSourcesOf(options.authorities ?? {})
  // Scope-resource existence probe for projection exits: records stay
  // inspectable; a gone/unreachable scope resource is marked explicitly.
  const confirmScopeResource = async (record) => {
    const kind = record?.data?.source?.kind
    const resourceId = record?.scope?.session ?? record?.scope?.workspace ?? record?.scope?.profile
    const adapter = sourceAdapters[kind]
    if (!adapter || typeof adapter.confirmScopeResource !== 'function' || !resourceId) {
      return { status: 'unknown' }
    }
    try {
      const outcome = await adapter.confirmScopeResource(resourceId)
      if (outcome?.reachable === true) return { status: 'reachable' }
      if (outcome?.reachable === false) return { status: 'unavailable', reason: outcome.reason }
      return { status: 'unknown', ...(outcome?.reason ? { reason: outcome.reason } : {}) }
    } catch {
      return { status: 'unknown', reason: 'scope resource check failed' }
    }
  }
  const projection = options.projection ?? createCheckpointProjection({ store, now: clock, confirmScopeResource })
  const planner = options.planner ?? createRestorePlanner({ store, facts, sources: sourceAdapters, now: clock, logger })
  const stepAdapters = options.stepAdapters ?? createRestoreStepAdapters(options.stepAuthorities ?? {})
  const restore = options.restore ?? createRestoreAuthority({
    store,
    planner,
    facts,
    stepAdapters,
    coordination: options.coordination,
    ownerOf,
    idFactory: options.idFactory,
    now: clock,
    waitForTerminal: options.waitForTerminal,
    audit: options.audit,
    logger,
  })
  const autoCapture = options.autoCapture ?? createAutoCapturePolicy({ facts, capture, ownerOf, logger })
  const availability = options.availability ?? createCheckpointAvailability({
    active,
    projection,
    capture,
    autoCapture,
    restore,
  })

  const surface = deepFreeze({
    create: async (spec, caller) => {
      if (!isActive()) throw new PluginApiInactiveError()
      return capture.create(spec, caller ?? {})
    },
    list: async (query) => {
      if (!isActive()) throw new PluginApiInactiveError()
      return projection.list(query)
    },
    inspect: async (checkpointId) => {
      if (!isActive()) throw new PluginApiInactiveError()
      return projection.inspect(checkpointId)
    },
    planRestore: async (checkpointId) => {
      if (!isActive()) throw new PluginApiInactiveError()
      return planner.planRestore(checkpointId)
    },
    restore: async (checkpointId, input, caller) => {
      if (!isActive()) throw new PluginApiInactiveError()
      return restore.restore(checkpointId, input ?? {}, caller ?? {})
    },
    availability: () => {
      if (!isActive()) return deepFreeze({ status: 'unavailable', reason: 'the plugin api core is inactive' })
      return availability.availability()
    },
  })

  // Internal sub-faces (integration wave wires these into the shared mounter).
  return deepFreeze({
    api: surface,
    internals: deepFreeze({ store, facts, capture, projection, planner, restore, autoCapture, availability, stepAdapters }),
  })
}

/**
 * Build the per-kind source adapters (availability + plan-time anchor/scope
 * confirmation) over the wired authority faces; unwired faces yield honest
 * unavailable/unconfirmable adapters instead of being silently skipped.
 */
function captureSourcesOf(authorities) {
  const sources = {}
  const faces = { branch: authorities.branch, 'workspace-journal': authorities.journal, 'workspace-snapshot': authorities.snapshot }
  for (const [kind, face] of Object.entries(faces)) {
    if (!isObject(face)) {
      const stub = deepFreeze({
        kind,
        availability: () => deepFreeze({ status: 'unavailable', reason: `owning authority face for '${kind}' is not wired` }),
        confirmAnchor: async () => ({ ok: false, code: 'unconfirmable', reason: `owning authority face for '${kind}' is not wired` }),
        confirmScopeResource: async () => ({ unknown: true, reason: `owning authority face for '${kind}' is not wired` }),
      })
      sources[kind] = stub
      continue
    }
    sources[kind] = resolveCaptureSource({ kind }, { branch: authorities.branch, journal: authorities.journal, snapshot: authorities.snapshot })
  }
  return sources
}

/** Disabled surface shape (typed capability-disabled): every member typed; availability reports the reason. */
export function createDisabledCheckpointsApi(active = () => false, reason = 'checkpoints capability is disabled') {
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('checkpoints', reason)
  }
  return deepFreeze({
    create: fail,
    list: fail,
    inspect: fail,
    planRestore: fail,
    restore: fail,
    availability: () => deepFreeze({ status: 'unavailable', reason }),
  })
}