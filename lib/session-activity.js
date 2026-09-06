/**
 * Facade assembly for the read-only session activity projection.
 *
 * `createSessionActivityProjection` wires the activity store, the evidence
 * adapters (official events + durable joiner + attempt-facts consumption),
 * the frozen query view, the epoch-local observer hub and the availability
 * probe into the public `pluginApi.sessions.activity` projection surface
 * (mounted by the integration wave at the frozen shared mounter slots).
 *
 * The projection is authoritative only on the host, read-only by boundary:
 * it never creates, settles, retries or mutates an execution or session, never
 * dispatches/transforms/vetoes a canonical event, and never throws through
 * apply (fail-safe: registration failures degrade sources, they never break
 * the owner). When the facade capability is disabled, every member throws the
 * typed feature-disabled error; the inactive-core case is a mount-time
 * concern of the shared core and is not produced here.
 */
import { createActivityStore } from './session-activity-store.js'
import { createSessionActivityAdapters } from './session-activity-adapters.js'
import { createSessionActivityView } from './session-activity-view.js'
import { createSessionActivityObserverHub } from './session-activity-observe.js'
import { createSessionActivityAvailability } from './session-activity-availability.js'
import { PluginApiFeatureDisabledError } from './errors.js'

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

/**
 * Create the session activity projection owner.
 *
 * @param {{ ctx: object, logger?: object, enabled?: boolean, observe?: boolean,
 *           now?: () => string }} [options]
 * @returns {{
 *   api: object,
 *   dispose: () => boolean,
 *   availability: () => { status: string, reason?: string },
 *   setSliceState: ({ active: boolean, versionMatched: boolean }) => void,
 *   ingestAttemptFact: (event: string, payload: object) => boolean,
 *   joinDurable: (session: object) => object,
 *   cleanupOwner: (ownerId: unknown) => number,
 *   rollEpoch: () => number,
 * }}
 */
export function createSessionActivityProjection({ ctx, logger, enabled = true, observe = true, now } = {}) {
  const store = createActivityStore(now ? { now } : {})
  let liveAdapters = null
  function unavailableSources() {
    const a = liveAdapters?.availability ?? {}
    const out = []
    for (const group of ['session', 'agent', 'tools', 'approval']) {
      if (a[group] === 'missing' || a[group] === 'degraded') out.push(`${group}:${a[group]}`)
    }
    if (a.durable === 'missing') out.push('durable:missing')
    return out
  }
  const view = createSessionActivityView({ store, unavailableSources })
  const hub = createSessionActivityObserverHub({ store, render: (sessionId) => view.current(sessionId, { audience: 'ui' }) })
  const guard = () => {
    if (enabled !== true) {
      throw new PluginApiFeatureDisabledError('sessions.activity')
    }
  }

  // Notify observers after each store change; adapters consume an observing
  // wrapper so the owner remains the single notifier.
  const observedStore = {
    ...store,
    ingest(fact) {
      const result = store.ingest(fact)
      if (result && isObject(result) && result.sessionId !== undefined) {
        hub.notify(result.sessionId)
      }
      return result
    },
  }
  liveAdapters = createSessionActivityAdapters({ ctx, store: observedStore, logger })
  const availabilityProbe = createSessionActivityAvailability({
    enabled,
    adapters: liveAdapters,
    sliceState: () => liveAdapters.sliceState(),
  })

  const api = Object.freeze({
    current(sessionId, options) {
      guard()
      return view.current(sessionId, options)
    },
    get(activityId, options) {
      guard()
      return view.get(activityId, options)
    },
    list(options) {
      guard()
      return view.list(options)
    },
    history(sessionId, options) {
      guard()
      return view.history(sessionId, options)
    },
    observe(options) {
      guard()
      return hub.observe(options)
    },
    availability() {
      guard()
      return availabilityProbe.availability()
    },
  })

  const dispose = () => {
    let result = false
    try {
      result = liveAdapters.dispose()
    } catch {
      // disposal never escapes the fail-safe path
    }
    try {
      hub.dispose()
    } catch {
      // best-effort
    }
    return result
  }

  return {
    api,
    dispose,
    availability: () => availabilityProbe.availability(),
    setSliceState: (state) => liveAdapters.setSliceState(state),
    ingestAttemptFact: (event, payload) => liveAdapters.ingestAttemptFact(event, payload),
    joinDurable: (session) => liveAdapters.joinDurable(session),
    cleanupOwner: (ownerId) => hub.cleanupOwner(ownerId),
    rollEpoch: () => {
      hub.rollEpoch()
      return store.rollEpoch()
    },
  }
}