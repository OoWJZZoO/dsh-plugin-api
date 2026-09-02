/**
 * pluginApi.sessions feature (session lifecycle + session read surface + read-only state accessors + session type catalogs).
 *
 * Host-side only. The feature is a thin direct passthrough over the official
 * `sessions` service and the official Session object, plus typed session lifecycle session
 * lifecycle subscriptions that delegate to the already-mounted
 * `pluginApi.events` bus.
 */
import {
  KNOWN_SESSION_EVENT_TYPES,
  isSurfaceEligibleType,
} from '@deepseek-ai/dsh-session'
import * as dshSession from '@deepseek-ai/dsh-session'
import { deepFreeze } from './deep-freeze.js'
import { createSessionTypeCatalogs } from './session-catalog.js'

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
    return service?._registry?.isActive?.('events') === true
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
    warn(logger, 'dsh-plugin-api session: session type catalogs session type catalogs unavailable; catalogs are empty and type guards always return false')
  }

  return {
    // session lifecycle — the standard projection subscription entry:
    // the on/once verbs merge into one observe entry that returns the
    // projection handle (current/subscribe/dispose/epoch).
    observe(name, listener, opts) {
      const handle = eventsApi.observe(name, opts)
      if (typeof listener === 'function') {
        try {
          handle.subscribe(listener)
        } catch (error) {
          try {
            handle.dispose?.()
          } catch {
            // disposal failure must not mask the subscription error
          }
          throw error
        }
      }
      return handle
    },

    // session store operations — session lifecycle store.
    get(id) {
      return sessions.get(id)
    },

    list() {
      return sessions.list()
    },

    fork(source, boundary, childSessionId) {
      return sessions.fork(source, boundary, childSessionId)
    },

    // session read projections — the per-session object accessors and
    // session type catalogs live under the views subtree so the store
    // operations above stay distinct from session-object projections.
    views: Object.freeze({
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

      sessionEventTypes: typeCatalogs.sessionEventTypes,
      surfaceEventTypes: typeCatalogs.surfaceEventTypes,
      isSessionEventType: typeCatalogs.isSessionEventType,
      isSurfaceEventType: typeCatalogs.isSurfaceEventType,
    }),
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
export function mountSessionFeature({ ctx, service, logger, featureRegistry } = {}) {
  // Unified idempotent re-apply signal.
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('session')) {
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
    || !isFunction(eventsApi.observe)
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
