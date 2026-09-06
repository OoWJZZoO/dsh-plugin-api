/**
 * Namespace availability decoration for the host `pluginApi` surface.
 *
 * The public namespace set is the set of registry namespace navigation
 * records (single source of truth), not an implicit path-depth rule. Each
 * record names the namespace and the capability path that determines its
 * availability; the availability status is derived from the same backing
 * feature inputs the `capabilities` query uses, so a missing backing
 * service reports a frozen `unavailable` state through the namespace shape
 * instead of making the namespace disappear.
 *
 * Every namespace availability member converges on the single vocabulary
 * `{ status: 'active' | 'degraded' | 'unavailable', reason?: string }`.
 * Domain surfaces may provide their own availability; only a `status`
 * (and an optional caller-facing `reason`) survive decoration, so a plugin
 * can write one generic availability probe across every namespace.
 */
import { capabilityDescriptor } from './capability-descriptors.js'

export const AVAILABILITY_STATUSES = Object.freeze(['active', 'degraded', 'unavailable'])

/**
 * Host namespace navigation records mirroring the registry `namespaces`
 * section. `path` is the member path relative to the top-level namespace
 * surface ('' = the surface itself); `capabilityPath` selects the backing
 * descriptor that drives the availability status.
 */
export const HOST_NAMESPACE_RECORDS = Object.freeze({
  events: Object.freeze({ path: '', capabilityPath: 'events' }),
  llm: Object.freeze({ path: '', capabilityPath: 'llm' }),
  'llm.routing': Object.freeze({ path: 'routing', capabilityPath: 'llm.routing' }),
  agents: Object.freeze({ path: '', capabilityPath: 'agents' }),
  executions: Object.freeze({ path: '', capabilityPath: 'executions' }),
  'executions.recovery': Object.freeze({ path: 'recovery', capabilityPath: 'executions.recovery' }),
  'executions.recovery.checkpoints': Object.freeze({ path: 'recovery.checkpoints', capabilityPath: 'executions.recovery.checkpoints' }),
  sessions: Object.freeze({ path: '', capabilityPath: 'sessions' }),
  'sessions.branches': Object.freeze({ path: 'branches', capabilityPath: 'sessions.branches' }),
  'sessions.channels': Object.freeze({ path: 'channels', capabilityPath: 'sessions.channels' }),
  'sessions.views': Object.freeze({ path: 'views', capabilityPath: 'sessions' }),
  'sessions.activity': Object.freeze({ path: 'activity', capabilityPath: 'sessions.activity' }),
  tools: Object.freeze({ path: '', capabilityPath: 'tools' }),
  'tools.discovery': Object.freeze({ path: 'discovery', capabilityPath: 'tools.discovery' }),
  skills: Object.freeze({ path: '', capabilityPath: 'skills' }),
  'skills.activation': Object.freeze({ path: 'activation', capabilityPath: 'skills.activation' }),
  prompts: Object.freeze({ path: '', capabilityPath: 'prompts' }),
  'prompts.provenance': Object.freeze({ path: 'provenance', capabilityPath: 'prompts.provenance' }),
  attachments: Object.freeze({ path: '', capabilityPath: 'attachments' }),
  'attachments.projection': Object.freeze({ path: 'projection', capabilityPath: 'attachments.projection' }),
  mcp: Object.freeze({ path: '', capabilityPath: 'mcp' }),
  tasks: Object.freeze({ path: '', capabilityPath: 'tasks' }),
  coordination: Object.freeze({ path: '', capabilityPath: 'coordination' }),
  workspaces: Object.freeze({ path: '', capabilityPath: 'workspaces' }),
  security: Object.freeze({ path: '', capabilityPath: 'security' }),
  diagnostics: Object.freeze({ path: '', capabilityPath: 'diagnostics' }),
  settings: Object.freeze({ path: '', capabilityPath: 'settings' }),
  profiles: Object.freeze({ path: '', capabilityPath: 'profiles' }),
  remotes: Object.freeze({ path: '', capabilityPath: 'remotes' }),
  storage: Object.freeze({ path: '', capabilityPath: 'storage' }),
  attention: Object.freeze({ path: '', capabilityPath: 'attention' }),
})

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Read the availability member of a surface without invoking throwing
 * accessors. A function or record value is returned as-is; an accessor is
 * converted into a live reader closure so the underlying owner is re-read at
 * every availability() call and degradation stays visible.
 */
function readAvailability(target) {
  const descriptor = Object.getOwnPropertyDescriptor(target, 'availability')
  if (!descriptor) return undefined
  if (typeof descriptor.value === 'function' || isPlainRecord(descriptor.value)) return descriptor.value
  if (typeof descriptor.get === 'function') {
    return () => descriptor.get.call(target)
  }
  return undefined
}

/** Clone a surface into a new frozen object with additional descriptors. */
function mergeSurface(base, additions = {}) {
  return Object.freeze(Object.defineProperties(
    Object.create(Object.getPrototypeOf(base) ?? Object.prototype),
    { ...Object.getOwnPropertyDescriptors(base), ...Object.getOwnPropertyDescriptors(additions) },
  ))
}

/**
 * @param {object} options
 * @param {(feature: string) => boolean} options.resolveFeatureStatus  backing feature status resolver
 */
export function createNamespaceAvailability({ resolveFeatureStatus }) {
  const featureActive = (feature) => {
    try {
      return resolveFeatureStatus(feature) === true
    } catch {
      return false
    }
  }

  const statusOf = (capabilityPath) => {
    const descriptor = capabilityDescriptor(capabilityPath)
    if (!descriptor) return 'unavailable'
    const statuses = descriptor.features.map(featureActive)
    const activeCount = statuses.filter(Boolean).length
    if (activeCount === statuses.length) return 'active'
    if (activeCount === 0) return 'unavailable'
    return 'degraded'
  }

  /**
   * Build the namespace availability member.
   *
   * Status resolution order: a domain-provided standard `status` wins; an
   * `active` boolean flag decides next; a domain availability function that
   * resolves counts as the domain reporting presence; everything else falls
   * back to the backing features. Only a `status` plus an optional
   * caller-facing `reason` survive decoration; all per-domain details are
   * dropped so the vocabulary is uniform across namespaces.
   */
  const availabilityOf = (capabilityPath, existing) => {
    const normalized = (raw, resolved) => {
      if (isPlainRecord(raw)) {
        if (AVAILABILITY_STATUSES.includes(raw.status)) {
          return Object.freeze({ status: raw.status, ...(typeof raw.reason === 'string' ? { reason: raw.reason } : {}) })
        }
        if (typeof raw.active === 'boolean') {
          return Object.freeze({ status: raw.active ? 'active' : 'unavailable' })
        }
      }
      if (resolved && typeof existing === 'function') {
        return Object.freeze({ status: 'active' })
      }
      return Object.freeze({ status: statusOf(capabilityPath) })
    }
    if (typeof existing === 'function') {
      return (...args) => {
        let raw
        let resolved = false
        try {
          raw = existing(...args)
          // Availability getters that resolve to the owner availability function.
          if (typeof raw === 'function') raw = raw()
          resolved = true
        } catch {
          raw = null
        }
        if (raw != null && typeof raw.then === 'function') {
          // Async domain availability (e.g. coordination availability(scope)):
          // resolve the discriminated shape asynchronously.
          return raw.then(
            (value) => normalized(value, true),
            () => Object.freeze({ status: statusOf(capabilityPath) }),
          )
        }
        return normalized(raw, resolved)
      }
    }
    if (isPlainRecord(existing)) {
      // Domain-provided availability detail object (e.g. a degradation map):
      // normalize it under the standard status vocabulary.
      return () => normalized(existing, false)
    }
    return () => Object.freeze({ status: statusOf(capabilityPath) })
  }

  /**
   * Replace one leaf in a surface tree, rebuilding the branch through
   * mergeSurface so every intermediate object stays frozen and identity-stable.
   */
  const replaceInTree = (root, segments, replacement) => {
    if (segments.length === 1) {
      return mergeSurface(root, { [segments[0]]: replacement })
    }
    const [head, ...rest] = segments
    const child = isPlainRecord(root) ? root[head] : undefined
    const replacedChild = isPlainRecord(child) ? replaceInTree(child, rest, replacement) : undefined
    if (replacedChild === undefined) return root
    return mergeSurface(root, { [head]: replacedChild })
  }

  /**
   * Decorate a namespace surface (and its registered sub-namespaces) with the
   * standard `availability()` member. Objects that already carry a compliant
   * availability are kept; registered namespaces that are absent from the
   * surface are left absent (their unavailability is reported by the
   * namespace shape that does exist).
   *
   * @param {object} surface  the top-level namespace surface
   * @param {string[]} names  namespace record keys to decorate
   * @param {WeakMap} [cache]  per-raw-subobject decorated cache; keeps
   *   service-lifetime sub-namespace identity stable across surface reads
   */
  const decorate = (surface, names, cache = new WeakMap()) => {
    if (!isPlainRecord(surface)) return surface
    let result = surface
    for (const name of names) {
      const record = HOST_NAMESPACE_RECORDS[name]
      if (!record) continue
      if (record.path === '') {
        result = mergeSurface(result, {
          availability: availabilityOf(record.capabilityPath, readAvailability(result)),
        })
        continue
      }
      const segments = record.path.split('.')
      let last = null
      let target = result
      for (const segment of segments) {
        last = segment
        target = isPlainRecord(target) ? target[segment] : undefined
      }
      if (!isPlainRecord(target)) continue
      let decorated = cache.get(target)
      if (!decorated) {
        decorated = mergeSurface(target, {
          availability: availabilityOf(record.capabilityPath, readAvailability(target)),
        })
        cache.set(target, decorated)
      }
      // Multi-segment namespace paths (e.g. recovery.checkpoints) replace the
      // decorated member inside the resolved parent object, not the top-level
      // surface: the tree branch is rebuilt one merge per segment.
      const replaced = replaceInTree(result, segments, decorated)
      result = replaced
    }
    return result
  }

  return { decorate, statusOf }
}