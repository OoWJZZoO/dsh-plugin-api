import { createSessionsPlanModeAuthority } from './sessions-plan-mode.js'
import { deriveAdapterRegistrationOwner } from './llm-adapter-registration.js'

/**
 * `sessions.planMode` feature mount: a controlled wrapper around the official
 * plan-mode service.
 *
 * The authority maps the official outcome verbs, projects the official read,
 * and derives the change feed from the official `session/event` and
 * `session/disposed` facts (both subscribed here, each owned by this feature's
 * disposer). The public sub-surface is caller-bound: `select` derives its
 * owner from the calling plugin's fiber, so the surface is materialized per
 * caller context and cached there.
 *
 * Every failure path is fail-safe: a missing official service, a missing fact
 * stream or a throwing official member degrades this feature alone with typed
 * results; nothing throws through apply or through a dispatch callback.
 */
export function createSessionsPlanModeFeature({ ctx, service, logger }) {
  const reportDiagnostics = (message) => {
    try {
      logger?.warn?.(`dsh-plugin-api sessions.planMode: ${message}`)
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

  const authority = createSessionsPlanModeAuthority({
    active: () => service.isActive,
    resolvePlanMode: () => resolveService('planMode'),
    resolveTargetPresence: (sessionId) => {
      // Tri-state: true (the official store holds the session), false (gone),
      // null (the store itself is unreachable, so liveness is unverifiable and
      // must never be reported as gone).
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
      get: (agent) => authority.get(agent),
      select: (agent, requested) => authority.select(agent, requested, callerCtx),
      observe: (agent) => authority.observe(agent),
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
 * Mount the plan-mode feature through the staged publication path used by the
 * other session-scoped faces (`prepareFeature`), so a failed mount restores
 * the typed disabled surface and never leaves a half-published slot.
 */
export function mountSessionsPlanModeFeature({ ctx, service, featureRegistry, logger }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('sessionPlanMode')) {
    return { disposer: () => {}, prepared: null }
  }
  let feature
  try {
    feature = createSessionsPlanModeFeature({ ctx, service, logger })
  } catch (error) {
    try {
      logger?.warn?.(`dsh-plugin-api: sessions.planMode mount failed and stays disabled: ${error?.message ?? error}`)
    } catch {
      // diagnostics must never escape the fail-safe mount path
    }
    return null
  }
  let prepared
  try {
    prepared = service.prepareFeature('sessionPlanMode', feature.api)
  } catch (error) {
    try {
      logger?.warn?.(`dsh-plugin-api: sessions.planMode could not be prepared: ${error?.message ?? error}`)
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
