import { createPermissionPresetAuthority } from './sessions-permission-presets.js'
import { deriveAdapterRegistrationOwner } from './llm-adapter-registration.js'

/**
 * `sessions.permissionPresets` feature mount: a controlled wrapper around the
 * official permission-presets service and its `permissions` projection.
 *
 * The authority maps the official selection verbs onto a frozen discriminated
 * result, projects the official preset read and the official projection view,
 * and derives the change feed from the official `session/event` and
 * `session/disposed` facts (both subscribed here, each owned by this feature's
 * disposer). The public sub-surface is caller-bound: `select` derives its owner
 * from the calling plugin's fiber, so the surface is materialized per caller
 * context and cached there.
 *
 * Every failure path is fail-safe: a missing official service, a missing
 * projection carrier or a throwing official member degrades this feature alone
 * with typed results; nothing throws through apply or through a dispatch
 * callback.
 */
export function createPermissionPresetFeature({ ctx, service, logger }) {
  const reportDiagnostics = (message) => {
    try {
      logger?.warn?.(`dsh-plugin-api sessions.permissionPresets: ${message}`)
    } catch {
      // diagnostics never escape the facade path
    }
  }
  const resolveService = (name) => {
    try {
      return typeof ctx?.get === 'function' ? ctx.get(name) : undefined
    } catch {
      return undefined
    }
  }

  const subscriptions = []
  let observeEstablished = false

  const authority = createPermissionPresetAuthority({
    active: () => service.isActive,
    resolvePresets: () => resolveService('permissionPresets'),
    resolveSnapshot: () => {
      const projections = resolveService('sessionProjections')
      if (!projections || typeof projections.snapshot !== 'function') return null
      return (session) => projections.snapshot(session)
    },
    resolveTargetPresence: (sessionId) => {
      const sessions = resolveService('sessions')
      if (!sessions || typeof sessions.get !== 'function') return null
      try {
        const session = sessions.get(sessionId)
        return session !== undefined && session !== null
      } catch {
        return null
      }
    },
    resolveOwnerId: deriveAdapterRegistrationOwner,
    logger,
    observeAvailable: () => observeEstablished,
    optionsAvailable: () => {
      const projections = resolveService('sessionProjections')
      return Boolean(projections) && typeof projections.snapshot === 'function'
    },
  })

  if (typeof ctx?.on === 'function') {
    try {
      subscriptions.push(ctx.on('session/event', (session, event) => {
        try {
          authority.ingestSessionEvent(session, event)
        } catch (error) {
          reportDiagnostics(`session event handling failed: ${String(error?.message ?? error)}`)
        }
      }))
      subscriptions.push(ctx.on('session/disposed', (session) => {
        try {
          authority.ingestSessionDisposed(session)
        } catch (error) {
          reportDiagnostics(`session disposal handling failed: ${String(error?.message ?? error)}`)
        }
      }))
      observeEstablished = true
    } catch (error) {
      reportDiagnostics(`session fact subscriptions failed; observation stays inactive: ${String(error?.message ?? error)}`)
    }
  } else {
    reportDiagnostics('the shared event substrate is unavailable; observation stays inactive')
  }

  const callerCache = new WeakMap()
  const surfaceFor = (callerCtx) => {
    let cached
    try {
      cached = callerCache.get(callerCtx)
    } catch {
      cached = undefined
    }
    if (cached) return cached
    const surface = Object.freeze({
      current: (session) => authority.current(session),
      options: (session) => authority.options(session),
      select: (session, name) => authority.select(session, name, callerCtx),
      observe: (session) => authority.observe(session),
      availability: () => authority.availability(),
    })
    try {
      callerCache.set(callerCtx, surface)
    } catch {
      // a non-object caller context simply skips the cache
    }
    return surface
  }

  return {
    authority,
    api: Object.freeze({
      surfaceFor,
      availability: () => authority.availability(),
    }),
    disposer: () => {
      for (const off of subscriptions.splice(0)) {
        try {
          off?.()
        } catch {
          // teardown must never throw through the host path
        }
      }
      try {
        authority.dispose()
      } catch {
        // authority teardown is best-effort
      }
    },
  }
}

/**
 * Mount the permission-preset feature through the staged publication path used
 * by the other session-scoped faces (`prepareFeature`), so a failed mount
 * restores the typed disabled surface and never leaves a half-published slot.
 */
export function mountSessionsPermissionPresetsFeature({ ctx, service, featureRegistry, logger }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('sessionPermissionPresets')) {
    return { disposer: () => {}, prepared: null }
  }
  let feature
  try {
    feature = createPermissionPresetFeature({ ctx, service, logger })
  } catch (error) {
    try {
      logger?.warn?.(`dsh-plugin-api: sessions.permissionPresets mount failed and stays disabled: ${error?.message ?? error}`)
    } catch {
      // diagnostics must never escape the fail-safe mount path
    }
    return null
  }
  let prepared
  try {
    prepared = service.prepareFeature('sessionPermissionPresets', feature.api)
  } catch (error) {
    try {
      logger?.warn?.(`dsh-plugin-api: sessions.permissionPresets could not be prepared: ${error?.message ?? error}`)
    } catch {
      // diagnostics must never escape the fail-safe mount path
    }
    try {
      feature.disposer()
    } catch {
      // teardown must never throw through the fail-safe path
    }
    return null
  }
  return {
    disposer: () => {
      try {
        feature.disposer()
      } catch {
        // teardown must never throw through the host path
      }
    },
    prepared,
  }
}
