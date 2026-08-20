/**
 * Stable service definition table for the `pluginApi.services` capability
 * namespace. Each entry describes one official capability seam that the facade
 * exposes as a read-only passthrough namespace member.
 *
 * The table is intentionally static: runtime facade construction never
 * introspects the official service objects. Only members declared here are
 * exposed, so official mutable fields and private internals stay hidden.
 *
 * Member kinds:
 * - method: delegate `(...args) => service[name](...args)`
 * - getter: delegate readonly property access `service[name]`
 * - forward: delegate to a facade-provided function (official package public
 *   export forwarding), resolved via `uriHelpers` for the two SV15 URI helpers
 * - optional: only present on the facade when the official service actually
 *   exposes the member (e.g. `sessionTelemetry.flush?`)
 */

import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const SERVICE_DEFINITIONS = [
  {
    key: 'fs',
    ctxService: 'fs',
    pkg: 'dsh-fs',
    members: [
      { kind: 'getter', name: 'sandboxMode' },
      { kind: 'method', name: 'resolve' },
      { kind: 'method', name: 'processPath' },
      { kind: 'method', name: 'fileUrl' },
      { kind: 'method', name: 'contains' },
      { kind: 'method', name: 'stat' },
      { kind: 'method', name: 'lstat' },
      { kind: 'method', name: 'readText' },
      { kind: 'method', name: 'streamText' },
      { kind: 'method', name: 'readBytes' },
      { kind: 'method', name: 'listDir' },
      { kind: 'method', name: 'writeText' },
      { kind: 'method', name: 'editText' },
    ],
  },
  {
    key: 'codeRuntime',
    ctxService: 'codeRuntime',
    pkg: 'dsh-code-runtime',
    members: [
      { kind: 'getter', name: 'language' },
      { kind: 'getter', name: 'isolation' },
      { kind: 'method', name: 'run' },
    ],
  },
  {
    key: 'workspaces',
    ctxService: 'workspaceRegistry',
    pkg: 'dsh-workspace',
    members: [
      { kind: 'getter', name: 'archivedSessionIds' },
      { kind: 'method', name: 'create' },
      { kind: 'method', name: 'get' },
      { kind: 'method', name: 'list' },
      { kind: 'method', name: 'delete' },
      { kind: 'method', name: 'insertBefore' },
      { kind: 'method', name: 'archiveSession' },
      { kind: 'method', name: 'resolveByPath' },
    ],
  },
  {
    key: 'subagents',
    ctxService: 'subagents',
    pkg: 'dsh-subagent',
    members: [
      { kind: 'method', name: 'startContinuable' },
      { kind: 'method', name: 'followup' },
      { kind: 'method', name: 'interrupt' },
      { kind: 'method', name: 'reportFrom' },
      { kind: 'method', name: 'registerContinuableSetup' },
      { kind: 'method', name: 'drainContinuableDescendants' },
      { kind: 'method', name: 'listChildren' },
      { kind: 'method', name: 'listDescendants' },
      { kind: 'method', name: 'registerProvider' },
      { kind: 'method', name: 'getProvider' },
      { kind: 'method', name: 'list' },
      { kind: 'method', name: 'start' },
    ],
  },
  {
    key: 'workflows',
    ctxService: 'workflowEngine',
    pkg: 'dsh-workflow',
    members: [
      { kind: 'method', name: 'start' },
    ],
  },
  {
    key: 'approval',
    ctxService: 'approval',
    pkg: 'dsh-user-approval',
    members: [
      { kind: 'method', name: 'setPolicy' },
      { kind: 'method', name: 'request' },
      { kind: 'method', name: 'overrideOf' },
    ],
  },
  {
    key: 'userQuestions',
    ctxService: 'userQuestions',
    pkg: 'dsh-user-questions',
    members: [
      { kind: 'method', name: 'registerProvider' },
      { kind: 'method', name: 'ask' },
    ],
  },
  {
    key: 'attachments',
    ctxService: 'attachments',
    pkg: 'dsh-attachment',
    members: [
      { kind: 'getter', name: 'imageLimits' },
      { kind: 'method', name: 'validateImage' },
      { kind: 'method', name: 'saveImage' },
      { kind: 'method', name: 'readImage' },
    ],
  },
  {
    key: 'skills',
    ctxService: 'skills',
    pkg: 'dsh-skill',
    members: [
      { kind: 'method', name: 'registerProvider' },
      { kind: 'method', name: 'register' },
      { kind: 'method', name: 'list' },
      { kind: 'method', name: 'snapshot' },
      { kind: 'method', name: 'get' },
    ],
  },
  {
    key: 'storage',
    ctxService: 'storage',
    pkg: 'dsh-storage',
    members: [
      { kind: 'getter', name: 'backend' },
      { kind: 'getter', name: 'domain' },
      { kind: 'method', name: 'mount' },
      { kind: 'method', name: 'form' },
    ],
  },
  {
    key: 'sessionProjections',
    ctxService: 'sessionProjections',
    pkg: 'dsh-session-projection',
    members: [
      { kind: 'method', name: 'register' },
      { kind: 'method', name: 'onChanged' },
      { kind: 'method', name: 'snapshot' },
      { kind: 'method', name: 'checkpoint' },
      { kind: 'method', name: 'restoreFloor' },
      { kind: 'method', name: 'viewCheckpoint' },
      { kind: 'method', name: 'restore' },
    ],
  },
  {
    key: 'sessionQuery',
    ctxService: 'sessionQuery',
    pkg: 'dsh-session-query',
    members: [
      { kind: 'method', name: 'searchSessions' },
      { kind: 'method', name: 'searchEvents' },
      { kind: 'method', name: 'listSessions' },
      { kind: 'method', name: 'readSession' },
      { kind: 'method', name: 'filterSessions' },
      { kind: 'method', name: 'readTitle' },
      { kind: 'method', name: 'readTitleSnapshot' },
      { kind: 'method', name: 'readTitleSnapshots' },
      { kind: 'method', name: 'listEvents' },
      { kind: 'method', name: 'filterEvents' },
      { kind: 'method', name: 'readSurface' },
      { kind: 'method', name: 'traceSession' },
      { kind: 'method', name: 'traceEvent' },
      { kind: 'method', name: 'readEvent' },
    ],
  },
  {
    key: 'sessionTitle',
    ctxService: 'sessionTitle',
    pkg: 'dsh-session-title',
    members: [
      { kind: 'method', name: 'get' },
      { kind: 'method', name: 'rename' },
      { kind: 'method', name: 'refresh' },
      { kind: 'method', name: 'register' },
    ],
  },
  {
    key: 'sessionTelemetry',
    ctxService: 'sessionTelemetry',
    pkg: 'dsh-session-telemetry',
    members: [
      { kind: 'getter', name: 'sharing' },
      { kind: 'method', name: 'emit' },
      { kind: 'method', name: 'flush', optional: true },
      { kind: 'method', name: 'shutdown' },
    ],
  },
  {
    key: 'sessionReferences',
    ctxService: 'sessionReferenceResolver',
    pkg: 'dsh-session-reference',
    members: [
      { kind: 'method', name: 'listCandidates' },
      { kind: 'method', name: 'prepare' },
      { kind: 'forward', name: 'encodeSessionReferenceUri' },
      { kind: 'forward', name: 'decodeSessionReferenceUri' },
    ],
  },
  {
    key: 'tokenMeter',
    ctxService: 'tokenMeter',
    pkg: 'dsh-token-meter',
    members: [
      { kind: 'method', name: 'measure' },
      { kind: 'method', name: 'estimateMessage' },
    ],
  },
  {
    key: 'agentDefaultModel',
    ctxService: 'agentDefaultModel',
    pkg: 'dsh-agent-default-model',
    members: [
      { kind: 'method', name: 'currentSelection' },
      { kind: 'method', name: 'saveSelection' },
    ],
  },
  {
    key: 'web',
    ctxService: 'web',
    pkg: 'dsh-web',
    members: [
      { kind: 'method', name: 'registerSearchProvider' },
      { kind: 'method', name: 'registerFetchProvider' },
    ],
  },
  {
    key: 'compaction',
    ctxService: 'compaction',
    pkg: 'dsh-compaction',
    members: [
      { kind: 'method', name: 'compactIfNeeded' },
      { kind: 'method', name: 'compactNow' },
      { kind: 'method', name: 'compactRegion' },
    ],
  },
  {
    key: 'jobs',
    ctxService: 'jobs',
    pkg: 'dsh-jobs',
    members: [
      { kind: 'method', name: 'start' },
      { kind: 'method', name: 'list' },
      { kind: 'method', name: 'get' },
      { kind: 'method', name: 'read' },
      { kind: 'method', name: 'kill' },
      { kind: 'method', name: 'wait' },
      { kind: 'method', name: 'onJobDone' },
      { kind: 'method', name: 'onJobsChanged' },
      { kind: 'method', name: 'attachController' },
    ],
  },
  {
    key: 'shellEnv',
    ctxService: 'shellEnv',
    pkg: 'dsh-shell-env',
    members: [
      { kind: 'method', name: 'register' },
      { kind: 'method', name: 'collect' },
      { kind: 'method', name: 'list' },
    ],
  },
]

export const SERVICES_NAMESPACE_KEYS = SERVICE_DEFINITIONS.map((def) => def.key)

export const servicesNamespaceBrand = Symbol.for('@deepseek-ai/dsh-plugin-api/servicesNamespace')

function isCallable(value) {
  return typeof value === 'function'
}

function memberAvailable(service, member) {
  return service != null && member.name in service && service[member.name] !== undefined
}

/**
 * Build the active read-only passthrough facade for one official service.
 * The facade exposes exactly the members declared in the service definition:
 * methods delegate 1:1, getters delegate readonly property access, and
 * forward members delegate to facade-provided functions (`uriHelpers`).
 *
 * @param def ServiceDefinition
 * @param service official service instance
 * @param uriHelpers map of forward member name -> function
 * @returns frozen facade with `isActive === true`
 */
function memberAvailableFor(def, member, service, uriHelpers) {
  if (member.kind === 'method') return isCallable(service?.[member.name])
  if (member.kind === 'getter') return memberAvailable(service, member)
  if (member.kind === 'forward') return isCallable(uriHelpers?.[member.name])
  return false
}

export function buildActiveFacade(def, service, uriHelpers = {}, active = true, logger = undefined) {
  // Observable failure presentation: a declared
  // non-optional member missing from the live official service degrades the
  // WHOLE facade to disabled (isActive:false + typed error on call). Members
  // are never silently omitted; optional members stay exempt.
  for (const member of def.members) {
    if (member.optional) continue
    if (!memberAvailableFor(def, member, service, uriHelpers)) {
      const reason = `official service "${def.ctxService}" is missing declared member "${member.name}"`
      try {
        logger?.error?.(`dsh-plugin-api capability services.${def.key} disabled: ${reason}`)
      } catch {
        // logging must never take down the fail-safe path
      }
      return buildDisabledFacade(def, normalizeActive(active), reason)
    }
  }

  const facade = { isActive: true }

  for (const member of def.members) {
    if (member.kind === 'method') {
      if (member.optional && !isCallable(service?.[member.name])) continue
      facade[member.name] = (...args) => {
        if (!normalizeActive(active)()) throw new PluginApiInactiveError()
        return service[member.name](...args)
      }
    } else if (member.kind === 'getter') {
      if (member.optional && !memberAvailable(service, member)) continue
      Object.defineProperty(facade, member.name, {
        enumerable: true,
        get() {
          return service[member.name]
        },
      })
    } else if (member.kind === 'forward') {
      if (member.optional && !isCallable(uriHelpers?.[member.name])) continue
      facade[member.name] = (...args) => uriHelpers[member.name](...args)
    }
  }

  return Object.freeze(facade)
}

/**
 * Build the read-only disabled facade for one service. Every declared member
 * throws a typed error: inactive core first, then the configured feature code
 * (`services.<key>` for per-service degradation, `services` for the
 * feature-level all-disabled namespace).
 */
export function buildDisabledFacade(def, active, reason, featureCode = `services.${def.key}`) {
  const facade = { isActive: false }
  const fail = () => {
    if (!active()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError(featureCode, reason)
  }

  for (const member of def.members) {
    if (member.kind === 'getter') {
      Object.defineProperty(facade, member.name, {
        enumerable: true,
        get: fail,
      })
    } else {
      facade[member.name] = fail
    }
  }

  return Object.freeze(facade)
}

/**
 * Build the feature-level all-disabled `pluginApi.services` namespace used as
 * the service default before the capabilities feature is mounted and as the
 * all-services-missing fallback. Every member throws
 * `PluginApiFeatureDisabledError('services')` (feature-level error string).
 */
function buildDisabledServicesNamespace(active) {
  const namespace = {}
  for (const def of SERVICE_DEFINITIONS) {
    namespace[def.key] = buildDisabledFacade(def, active, undefined, 'services')
  }
  return Object.freeze(namespace)
}

export function createDisabledServicesNamespace(active) {
  return buildDisabledServicesNamespace(active)
}

function safeGet(ctx, name) {
  if (typeof ctx?.get !== 'function') return undefined
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}

function normalizeActive(active) {
  return typeof active === 'function' ? active : () => Boolean(active)
}

/**
 * Build the runtime `pluginApi.services` namespace. Each declared official
 * service is probed independently: an available service gets an active frozen
 * passthrough facade, a missing or member-incomplete service gets a per-service
 * disabled facade (`services.<key>`), and the namespace itself is frozen.
 */
export function createServicesNamespace({ ctx, active = true, logger, uriHelpers } = {}) {
  const isActive = normalizeActive(active)

  if (typeof ctx?.get !== 'function') {
    return buildDisabledServicesNamespace(isActive)
  }

  const namespace = {}
  let availableCount = 0

  for (const def of SERVICE_DEFINITIONS) {
    const service = safeGet(ctx, def.ctxService)
    if (service !== undefined) {
      availableCount += 1
      try {
        namespace[def.key] = buildActiveFacade(def, service, uriHelpers, isActive, logger)
      } catch (error) {
        const detail = error instanceof Error && error.message ? `: ${error.message}` : ''
        const reason = `official service "${def.ctxService}" could not build declared facade${detail}`
        namespace[def.key] = buildDisabledFacade(def, isActive, reason)
        try {
          logger?.error?.(`dsh-plugin-api capability services.${def.key} disabled: ${reason}`)
        } catch {
          // logging must never take down the fail-safe path
        }
      }
    } else {
      const reason = `official service "${def.ctxService}" is unavailable`
      namespace[def.key] = buildDisabledFacade(def, isActive, reason)
      try {
        logger?.error?.(`dsh-plugin-api capability service "${def.ctxService}" unavailable; services.${def.key} disabled`)
      } catch {
        // logging must never take down the fail-safe path
      }
    }
  }

  if (availableCount === 0) {
    return buildDisabledServicesNamespace(isActive)
  }

  Object.defineProperty(namespace, servicesNamespaceBrand, { value: true })
  return Object.freeze(namespace)
}
