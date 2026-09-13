import { createCredentialMutationAuthority } from './credentials-mutation.js'
import { deriveAdapterRegistrationOwner } from './llm-adapter-registration.js'

/**
 * `credentials` feature mount: a controlled wrapper around the official
 * credential provider's write seam (`set`/`unset`) with the official
 * `describe`/`resolve` reads used for preflight and commit verification.
 *
 * The authority validates the request and the management backend state before
 * any side effect, wraps the official write, verifies rejections against the
 * management storage layer, audits metadata only, and derives its per-ref
 * revision markers from the official `credentials/updated` fact (the official
 * fact stream is the only revision source; the facade keeps no credential
 * state). The public surface is caller-bound: `set`/`unset` derive their owner
 * from the calling plugin's fiber, so it is materialized per caller context.
 *
 * Every failure path is fail-safe: a missing official service or write member
 * degrades this feature alone with typed results; nothing throws through apply
 * or through a dispatch callback, and no credential value ever leaves the
 * official seam.
 */
export function createCredentialMutationFeature({ ctx, service, logger }) {
  const reportDiagnostics = (message) => {
    try {
      logger?.warn?.(`dsh-plugin-api credentials: ${message}`)
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

  const authority = createCredentialMutationAuthority({
    active: () => service.isActive,
    resolveCredentials: () => resolveService('credentials'),
    resolveOwnerId: deriveAdapterRegistrationOwner,
    logger,
    observeAvailable: () => observeEstablished,
  })

  if (typeof ctx?.on === 'function') {
    try {
      subscriptions.push(ctx.on('credentials/updated', (ref) => {
        try {
          authority.observeUpdated(ref)
        } catch (error) {
          reportDiagnostics(`credential update handling failed: ${String(error?.message ?? error)}`)
        }
      }))
      observeEstablished = true
    } catch (error) {
      reportDiagnostics(`credential fact subscription failed; revision tracking stays inactive: ${String(error?.message ?? error)}`)
    }
  } else {
    reportDiagnostics('the shared event substrate is unavailable; revision tracking stays inactive')
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
      set: (ref, value, options) => authority.set(ref, value, options, callerCtx),
      unset: (ref, options) => authority.unset(ref, options, callerCtx),
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
 * Mount the credential mutation feature through the staged publication path
 * (`prepareFeature`), so a failed mount restores the typed disabled surface and
 * never leaves a half-published slot.
 */
export function mountCredentialMutationFeature({ ctx, service, featureRegistry, logger }) {
  if (typeof featureRegistry?.isActive === 'function' && featureRegistry.isActive('credentials')) {
    return { disposer: () => {}, prepared: null }
  }
  let feature
  try {
    feature = createCredentialMutationFeature({ ctx, service, logger })
  } catch (error) {
    try {
      logger?.warn?.(`dsh-plugin-api: credentials mount failed and stays disabled: ${error?.message ?? error}`)
    } catch {
      // diagnostics must never escape the fail-safe mount path
    }
    return null
  }
  let prepared
  try {
    prepared = service.prepareFeature('credentials', feature.api)
  } catch (error) {
    try {
      logger?.warn?.(`dsh-plugin-api: credentials could not be prepared: ${error?.message ?? error}`)
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
