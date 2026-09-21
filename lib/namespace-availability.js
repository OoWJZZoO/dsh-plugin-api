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
 * `{ status: 'active' | 'degraded' | 'unavailable', ...domainDetail }`.
 * Domain surfaces may provide their own availability; the status is normalized
 * onto that vocabulary while every domain detail field is preserved, so a
 * plugin can write one generic availability probe across every namespace and
 * still read the domain facts it needs. A domain status outside the vocabulary
 * is mapped (see `NON_STANDARD_STATUSES`) and its own token is kept as the
 * `reason`; "the domain answered at all" is never treated as "active".
 */
import { capabilityDescriptor } from './capability-descriptors.js'

export const AVAILABILITY_STATUSES = Object.freeze(['active', 'degraded', 'unavailable'])

/**
 * Domain availability tokens that are not part of the public three-value
 * vocabulary, mapped onto it. The domain's own token is kept as the
 * caller-facing `reason`, so the mapping never hides what the domain said.
 */
const NON_STANDARD_STATUSES = Object.freeze({
  unsupported: 'unavailable',
  unknown: 'degraded',
  inert: 'degraded',
  available: 'active',
})

/**
 * Settled verdicts of asynchronous domain availability resolutions, keyed by
 * capability path plus the call's scope token. The public probe stays
 * synchronous and reads this cache instead of returning a promise.
 */
const asyncResolutions = new Map()

function asyncKeyOf(capabilityPath, args) {
  if (args.length === 0) return capabilityPath
  const scope = args[0]
  const token = scope === null || scope === undefined
    ? ''
    : (typeof scope === 'object' ? scopeKeyOf(scope) : String(scope))
  return `${capabilityPath}|${token}`
}

/** Best-effort stable token for an object scope without inventing identity. */
function scopeKeyOf(scope) {
  for (const field of ['scope', 'id', 'resource', 'name']) {
    const value = scope[field]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return ''
}

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
  'sessions.planMode': Object.freeze({ path: 'planMode', capabilityPath: 'sessions.planMode' }),
  'sessions.permissionPresets': Object.freeze({ path: 'permissionPresets', capabilityPath: 'sessions.permissionPresets' }),
  'sessions.compaction': Object.freeze({ path: 'compaction', capabilityPath: 'sessions.compaction' }),
  'sessions.interactions': Object.freeze({ path: 'interactions', capabilityPath: 'sessions.interactions' }),
  'sessions.selection': Object.freeze({ path: 'selection', capabilityPath: 'sessions.selection' }),
  credentials: Object.freeze({ path: '', capabilityPath: 'credentials' }),
  workflows: Object.freeze({ path: '', capabilityPath: 'workflows' }),
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
  'workspaces.transactions': Object.freeze({ path: 'transactions', capabilityPath: 'workspaces.transactions' }),
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
   * The public result is a frozen object carrying the normalized `status`
   * (`active | degraded | unavailable`) plus every domain detail the domain
   * chose to disclose. Non-standard domain statuses are mapped onto the shared
   * vocabulary and their own token is kept as the caller-facing `reason`, so a
   * domain that reports `unsupported` is never read as `active`.
   *
   * There is deliberately no "the domain answered, therefore it is active"
   * branch: when the domain discloses nothing decidable the result falls back
   * to the backing capability descriptor, which is the same input the
   * `capabilities` query uses.
   *
   * An asynchronous domain resolution is never awaited here — the public probe
   * stays synchronous. Such a domain resolves once, its settled value is
   * cached, and the probe reads the cache; until then it reports the descriptor
   * fallback rather than a fabricated `active`.
   */
  const availabilityOf = (capabilityPath, existing) => {
    const fallbackStatus = () => statusOf(capabilityPath)
    /**
     * Why a namespace reads as it does, derived from the same backing inputs the
     * `capabilities` query uses. Every non-active verdict carries one, so a
     * caller never has to guess what is missing.
     */
    const reasonFor = (status) => {
      const descriptor = capabilityDescriptor(capabilityPath)
      const inactive = (descriptor?.features ?? []).filter((feature) => !featureActive(feature))
      return inactive.length === 0
        ? `the "${capabilityPath}" backing is unavailable`
        : `the backing features of "${capabilityPath}" are ${status === 'degraded' ? 'partly ' : ''}inactive: ${inactive.join(', ')}`
    }
    /**
     * Descriptor fallback: the answer when the domain discloses nothing
     * decidable (no record, a read failure, or an unsettled async probe). An
     * active verdict is the bare verdict; a non-active one names what is
     * unavailable. There is no invented `epoch` here: with no domain record
     * there is no disclosed state to epoch, and the disabled faces that do
     * disclose one (storage, executions, the decision faces) keep their own
     * epoch through the normalization branch.
     */
    const fallback = () => {
      const status = fallbackStatus()
      return Object.freeze(status === 'active' ? { status } : { status, reason: reasonFor(status) })
    }

    const normalized = (raw) => {
      if (!isPlainRecord(raw)) return fallback()
      const { status: declared, active, reason: declaredReason, ...detail } = raw
      let status
      let mappedFrom
      if (AVAILABILITY_STATUSES.includes(declared)) {
        status = declared
      } else if (typeof NON_STANDARD_STATUSES[declared] === 'string') {
        status = NON_STANDARD_STATUSES[declared]
        mappedFrom = declared
      } else if (typeof active === 'boolean' && declared === undefined) {
        status = active ? 'active' : 'unavailable'
      } else if (declared === undefined) {
        // The domain declares no current-status token (it carries detail only):
        // the namespace falls back to its backing descriptor. That is the
        // declared shape for such faces, not a silent downgrade of a token.
        status = fallbackStatus()
      } else {
        // An unrecognized token is never silently replaced by the descriptor
        // verdict: it is reported as degraded with the original token, so an
        // unmapped domain state stays visible.
        status = 'degraded'
        mappedFrom = declared
      }
      // A domain-supplied reason always wins; a mapped token names itself; and
      // a non-active verdict that arrived with no reason at all still gets one
      // from the backing inputs, so no disabled form reads as a bare status.
      const reason = typeof declaredReason === 'string' && declaredReason.length > 0
        ? declaredReason
        : (mappedFrom ?? (status === 'active' ? undefined : reasonFor(status)))
      return Object.freeze({
        status,
        // Domain detail is preserved, not trimmed: a caller deciding on a
        // coordination scope still needs durability / operations / backend /
        // epoch, and a namespace still needs its own degradation fields.
        ...detail,
        ...(reason === undefined ? {} : { reason }),
      })
    }

    if (typeof existing === 'function') {
      return (...args) => {
        let raw
        try {
          raw = existing(...args)
          // Availability getters that resolve to the owner availability function.
          if (typeof raw === 'function') raw = raw()
        } catch {
          return fallback()
        }
        if (raw != null && typeof raw.then === 'function') {
          const key = asyncKeyOf(capabilityPath, args)
          if (asyncResolutions.has(key)) return asyncResolutions.get(key)
          const pending = Promise.resolve(raw).then(
            (value) => {
              const settled = normalized(value)
              asyncResolutions.set(key, settled)
              return settled
            },
            () => {
              // A rejected resolution must not be cached as a verdict; the
              // probe keeps reporting the descriptor fallback.
              asyncResolutions.delete(key)
              return fallback()
            },
          )
          pending.catch(() => {})
          // The synchronous probe reports the descriptor fallback until the
          // first resolution settles, then reads the cached verdict.
          return fallback()
        }
        return normalized(raw)
      }
    }
    if (isPlainRecord(existing)) {
      // Domain-provided availability detail object (e.g. a degradation map):
      // normalize it under the standard status vocabulary.
      return () => normalized(existing)
    }
    return fallback
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