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
import { AdmissionRegistry } from './admission.js'
import { installAdmissionBridge } from './admission-bridge.js'
import { createEventsBus } from './events-bus.js'
import { eventsCatalog } from './events-catalog.js'
import {
  featureFailNotice,
  guardFailNotice,
  runCoreGuard,
  runFeatureGuard,
  writeGuardLog,
} from './guards.js'
import { createFeatureRegistry } from './feature-registry.js'
import { createPluginApiService, pluginApiBrand } from './plugin-api-service.js'
import { createRequestHasImage, installProjectionGuard } from './projection-guard.js'
import { createServicesNamespace, servicesNamespaceBrand } from './services.js'

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

function mountAdmissionFeature({ ctx, service, logger }) {
  // Idempotent re-apply: the feature is already mounted on a reused service.
  if (service?.llm?.admission?.isActive === true) {
    return () => {}
  }

  const llm = safeGet(ctx, 'llm')
  const apiProxy = safeGet(ctx, 'apiProxy')
  const agents = safeGet(ctx, 'agents')
  const registry = new AdmissionRegistry()

  const bridge = installAdmissionBridge({ llm, apiProxy, registry, agents, logger })
  if (!bridge.isActive()) {
    return null
  }

  const disposeProjectionGuard = installProjectionGuard({
    ctx,
    registry,
    agents,
    hasImage: createRequestHasImage(dshLlm?.contentHasImage),
    logger,
  })

  service.mountFeature('llm/admission', {
    register: (intent) => registry.register(intent),
    get isActive() {
      return bridge.isActive()
    },
  })

  return () => {
    try {
      disposeProjectionGuard()
    } catch {
      // disposal must never take down the fail-safe path
    }
    bridge.dispose()
  }
}

function mountEventsFeature({ ctx, service, logger }) {
  // Idempotent re-apply: a reused service already carries the mounted API.
  if (service?.events?.catalog === eventsCatalog) {
    return () => {}
  }

  const events = createEventsBus({ ctx, catalog: eventsCatalog, logger })
  service.mountFeature('events', events)

  return () => {
    try {
      if (typeof events.dispose === 'function') events.dispose()
    } catch {
      // disposal must never take down the fail-safe path
    }
  }
}

function mountWebFeature({ ctx, service }) {
  // Idempotent re-apply: a reused service already carries the mounted API.
  if (service?.web?.isActive === true) {
    return () => {}
  }

  const web = safeGet(ctx, 'web')
  const webApi = {
    isActive: true,
    registerSearchProvider(provider) {
      return web.registerSearchProvider(provider)
    },
    registerFetchProvider(provider) {
      return web.registerFetchProvider(provider)
    },
  }
  service.mountFeature('web', webApi)
  return () => {}
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

export function mountServicesFeature({ ctx, service, logger, uriHelpers }) {
  // Idempotent re-apply: a reused service already carries the mounted namespace.
  if (service?.services?.[servicesNamespaceBrand] === true) {
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

const FEATURE_MOUNTERS = new Map([
  ['events', mountEventsFeature],
  ['web', mountWebFeature],
  ['llm/admission', mountAdmissionFeature],
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
    const core = runCoreGuard(ctx, {
      apiVersion: manifest.apiVersion,
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

    // Core is active. Mount each feature whose feature-level guard passes.
    for (const [featureName, mount] of FEATURE_MOUNTERS) {
      const featureGuard = runFeatureGuard(featureName, ctx, { dshLlm })

      if (!featureGuard.ok) {
        featureRegistry.disable(featureName, formatProblems(featureGuard.problems))
        const logPath = writeGuardLog(featureGuard.problems)
        logger.error(featureFailNotice(featureName, logPath))
        continue
      }

      if (typeof ctx?.effect !== 'function') {
        const problems = [{ name: 'ctx.effect', detail: 'feature cleanup cannot be registered' }]
        featureRegistry.disable(featureName, formatProblems(problems))
        const logPath = writeGuardLog(problems)
        logger.error(featureFailNotice(featureName, logPath))
        continue
      }

      let disposer
      try {
        disposer = mount({ ctx, service, featureRegistry, logger })
      } catch (error) {
        logger.error(`dsh-plugin-api feature "${featureName}" mount failed: ${error?.message ?? error}`)
      }

      if (typeof disposer !== 'function') {
        const problems = [{ name: featureName, detail: 'feature mount did not produce a disposer; feature disabled' }]
        featureRegistry.disable(featureName, formatProblems(problems))
        const logPath = writeGuardLog(problems)
        logger.error(featureFailNotice(featureName, logPath))
        continue
      }

      try {
        ctx.effect(() => disposer, `dsh-plugin-api: ${featureName} cleanup`)
        featureRegistry.mount(featureName)
      } catch (error) {
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
