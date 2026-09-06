/**
 * Checkpoints facade composition — `pluginApi.executions.recovery.checkpoints`
 * (integration wave mounts this surface into the shared mounter; this module
 * only builds the frozen surface and never touches shared mounter/guard
 * files).
 *
 * Faces: `create` (capture mutation), `list`/`inspect` (projection),
 * `planRestore` (pure plan projection), `restore` (operation authority) and
 * `availability`. Every entry is fail-safe: core-inactive raises the uniform
 * P1 error at the entry point; feature-level disabled faces and typed
 * outcomes are produced by the capability path (P2/P3 per the contract).
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
import { createRestoreStepAdapters } from './checkpoint-sources.js'

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
  const projection = options.projection ?? createCheckpointProjection({ store, now: clock })
  const planner = options.planner ?? createRestorePlanner({ store, facts, sources: captureSourcesOf(options.authorities ?? {}), now: clock, logger })
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

function captureSourcesOf(authorities) {
  const sources = {}
  const faces = { branch: authorities.branch, 'workspace-journal': authorities.journal, 'workspace-snapshot': authorities.snapshot }
  for (const [kind, face] of Object.entries(faces)) {
    if (!isObject(face)) continue
    sources[kind] = {
      availability: typeof face.availability === 'function'
        ? () => face.availability()
        : () => deepFreeze({ status: 'active' }),
    }
  }
  return sources
}

/** Disabled surface shape (P2): every member typed, availability reports the reason. */
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