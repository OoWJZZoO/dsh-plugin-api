/**
 * pluginApi.session feature (S1 + S3 + S4 + S5).
 *
 * Host-side only. The feature is a thin A-class passthrough over the official
 * `sessions` service and the official Session object, plus typed S1 session
 * lifecycle subscriptions that delegate to the already-mounted
 * `pluginApi.events` bus.
 */
import {
  KNOWN_SESSION_EVENT_TYPES,
  isSurfaceEligibleType,
} from '@deepseek-ai/dsh-session'
import { deepFreeze } from './deep-freeze.js'
import { createSessionTypeCatalogs } from './session-catalog.js'
import { SESSION_LIFECYCLE_EVENT_NAMES } from './session-events-catalog.js'

const SESSION_LIFECYCLE_EVENT_NAME_SET = new Set(SESSION_LIFECYCLE_EVENT_NAMES)

function safeGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}

function warn(logger, message) {
  try {
    logger?.warn?.(message)
  } catch {
    // logging must never take down the fail-safe path
  }
}

function isFunction(value) {
  return typeof value === 'function'
}

function hasActiveEventsFeature(service) {
  try {
    const features = service?.features
    return Array.isArray(features)
      && features.some((feature) => feature?.name === 'events' && feature?.isActive === true)
  } catch {
    return false
  }
}

/**
 * @param {object} options
 * @param {object} options.ctx - Cordis-like context with on/once
 * @param {object} options.sessions - official `sessions` service
 * @param {object} options.eventsApi - mounted `pluginApi.events` bus
 * @param {{ knownSessionEventTypes?: Set<string>, isSurfaceEligibleType?: (type: string) => boolean }} [options.dshSession]
 * @param {{ warn: (message: string) => void }} [options.logger]
 */
export function createSessionApi({ ctx, sessions, eventsApi, dshSession, logger } = {}) {
  const typeCatalogs = createSessionTypeCatalogs(dshSession ?? {})

  if (!typeCatalogs.ok) {
    warn(logger, 'dsh-plugin-api session: S5 session type catalogs unavailable; catalogs are empty and type guards always return false')
  }

  return {
    isActive: true,

    // S1 — typed session lifecycle subscriptions delegate to pluginApi.events.
    on(name, listener, opts) {
      if (SESSION_LIFECYCLE_EVENT_NAME_SET.has(name)) {
        return eventsApi.on(name, listener, opts)
      }
      return ctx.on(name, listener)
    },

    once(name, listener, opts) {
      if (SESSION_LIFECYCLE_EVENT_NAME_SET.has(name)) {
        return eventsApi.once(name, listener, opts)
      }
      return ctx.once(name, listener)
    },

    // S3 — session read surface.
    get(id) {
      return sessions.get(id)
    },

    list() {
      return sessions.list()
    },

    fork(source, boundary, childSessionId) {
      return sessions.fork(source, boundary, childSessionId)
    },

    // S4 — read-only session state accessors.
    header(session) {
      return session.header
    },

    events(session) {
      return session.events
    },

    seq(session) {
      return session.seq
    },

    surface(session) {
      return deepFreeze({
        nodes: [...session.surface.nodes],
        replaceGeneration: session.surface.replaceGeneration,
      })
    },

    requestHeader(session) {
      return session.requestHeader()
    },

    requestContext(session) {
      return session.requestContext()
    },

    deriveMessages(session) {
      return deepFreeze([...session.deriveMessages()])
    },

    // S5 — session log event type catalogs and type guards.
    sessionEventTypes: typeCatalogs.sessionEventTypes,
    surfaceEventTypes: typeCatalogs.surfaceEventTypes,
    isSessionEventType: typeCatalogs.isSessionEventType,
    isSurfaceEventType: typeCatalogs.isSurfaceEventType,
  }
}

/**
 * Mount the session feature on the pluginApi service.
 *
 * @param {object} options
 * @param {object} options.ctx
 * @param {object} options.service - pluginApi service instance
 * @param {{ warn: (message: string) => void }} [options.logger]
 * @returns {(() => void) | null} disposer, or null when the feature must be disabled
 */
export function mountSessionFeature({ ctx, service, logger } = {}) {
  if (service?.session?.isActive === true) {
    return () => {}
  }

  const sessions = safeGet(ctx, 'sessions')
  const eventsApi = service?.events

  if (
    !sessions
    || !isFunction(sessions.get)
    || !isFunction(sessions.list)
    || !isFunction(sessions.fork)
    || !eventsApi
    || !isFunction(eventsApi.on)
    || !isFunction(eventsApi.once)
    || !hasActiveEventsFeature(service)
  ) {
    return null
  }

  const sessionApi = createSessionApi({
    ctx,
    sessions,
    eventsApi,
    dshSession: {
      knownSessionEventTypes: KNOWN_SESSION_EVENT_TYPES,
      isSurfaceEligibleType,
    },
    logger,
  })

  service.mountFeature('session', sessionApi)
  return () => {}
}
