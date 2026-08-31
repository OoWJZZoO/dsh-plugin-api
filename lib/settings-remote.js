/**
 * Settings remote host leaf: publish one registered settings namespace through the public
 * Typert remote binding contract.  The integration owner mounts this leaf as
 * `pluginApi.settings.remote`; this module owns no shared facade composition.
 *
 * Shared binding refactor (recorded deviation): the generic binding / marking / registration
 * / rollback / disposer machinery now delegates to the shared core
 * `remote-publication.js` (owner name `settingsRemote`), so the settings and generic
 * `pluginApi.remotes.publish` share one binding/rollback implementation with fully
 * independent owner semantics. Only the settings-specific construction stays local:
 * the get/set service class, `assertNamespace`, and `validateSetRequest`.
 */
import {
  PluginApiFeatureDisabledError,
  PluginApiInactiveError,
  PluginApiRemoteError,
  PluginApiSettingsNamespaceError,
} from './errors.js'
import {
  createRemoteOwner,
  publishRemotePublication,
  validateRemoteSegment,
  assertJsonValue,
  cloneJsonValue,
  isPlainObject,
  report,
} from './remote-publication.js'

export const SETTINGS_REMOTE_FEATURE = 'settingsRemote'

const REQUIRED_METHODS = Object.freeze(['get', 'set'])
const namespaceByKey = new WeakMap()

/**
 * @param {{ ctx?: object, settings?: object, protocol?: object, active?: boolean|(() => boolean), logger?: object }} options
 */
export function createSettingsRemoteApi({ ctx, settings, protocol, active = true, logger } = {}) {
  const isActive = normalizeActive(active)
  if (settings === undefined) {
    try {
      settings = typeof ctx?.get === 'function' ? ctx.get('settings') : undefined
    } catch (error) {
      report(logger, `dsh-plugin-api feature "${SETTINGS_REMOTE_FEATURE}" could not resolve settings`, error)
      settings = undefined
    }
  }
  const disabledReason = validatePrimitives(ctx, settings, protocol)
  if (disabledReason) return createDisabledSettingsRemoteApi(isActive, disabledReason)

  // One shared per-(ctx, ownerName) record map, exactly like the generic core:
  // The settings surface publishes through `ownerName:'settingsRemote'` so its owner semantics are
  // fully independent from `pluginApi.remotes.publish`.
  const localOwners = createRemoteOwner({ ctx, ownerName: SETTINGS_REMOTE_FEATURE })
  const ownedDisposers = new Set()

  function contribute(namespace, serviceKey = namespace) {
    return remote(namespace, serviceKey)
  }

  function remote(namespace, serviceKey = namespace) {
    if (!isActive()) throw new PluginApiInactiveError()
    validateRemoteSegment(protocol, namespace, 'settings namespace')
    validateRemoteSegment(protocol, serviceKey, 'Typert service key')
    assertNamespace(settings, namespace)

    // Namespace-aware idempotence / conflict: the settings face
    // keys on (namespace, serviceKey). The generic core keys on serviceKey only,
    // so this leaf tracks the namespace that claimed each key and short-circuits
    // the same (namespace, serviceKey) pair to the existing owner disposer.
    // Only an ACTIVE owner participates — a disposed record releases the key so a
    // later (namespace, serviceKey) call can publish a fresh owner.
    const existing = localOwners.get(serviceKey)
    if (existing && !existing.disposed) {
      const priorNamespace = namespaceByKey.get(ctx)?.get(serviceKey)
      if (priorNamespace === namespace) return existing.disposer
      throw new PluginApiRemoteError(`Typert service key "${serviceKey}" is already active`, { serviceKey })
    }

    const service = createSettingsService({ settings, protocol, namespace })
    const disposer = publishRemotePublication({
      ctx,
      protocol,
      logger,
      owner: localOwners,
      ownerName: SETTINGS_REMOTE_FEATURE,
      serviceKey,
      service,
      methods: REQUIRED_METHODS,
      rehome: false,
    })
    const byKey = namespaceByKey.get(ctx) ?? namespaceByKey.set(ctx, new Map()).get(ctx)
    byKey.set(serviceKey, namespace)
    ownedDisposers.add(disposer)
    return disposer
  }

  return Object.freeze({
    isActive: true,
    remote,
    contribute,
    dispose() {
      for (const disposer of [...ownedDisposers]) disposer()
      ownedDisposers.clear()
    }
  })
}

export function createDisabledSettingsRemoteApi(active = true, reason = 'required host primitive is unavailable') {
  const isActive = normalizeActive(active)
  const fail = () => {
    if (!isActive()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError(SETTINGS_REMOTE_FEATURE, reason)
  }
  return Object.freeze({ isActive: false, remote: fail, contribute: fail, dispose() {} })
}

/**
 * Build the settings-specific remote service. Only the business semantics are
 * local: `get()` returns a redacted JSON-safe snapshot, `set()` validates the
 * request and builds official settings mutation operations. Binding / marking /
 * registration are the shared core's responsibility.
 */
function createSettingsService({ settings, protocol, namespace }) {
  // Remote() records metadata against the live object's prototype. A literal
  // would therefore mark Object.prototype and leak get/set markers into every
  // unrelated plain object in this process. Each publication gets its own
  // service prototype instead.
  const RemoteSettingsService = class {
    get() {
      const raw = settings.get(namespace)
      assertJsonValue(raw, 'settings snapshot')
      const descriptor = assertNamespace(settings, namespace)
      if (!Object.hasOwn(descriptor, 'value')) {
        throw new PluginApiRemoteError('settings namespace descriptor is missing its value')
      }
      assertJsonValue(descriptor.value, 'redacted settings snapshot')
      return { value: cloneJsonValue(descriptor.value) }
    }

    async set(request) {
      const ops = validateSetRequest(request)
      const result = await settings.mutate(namespace, ops)
      if (result !== undefined) assertJsonValue(result, 'settings mutation result')
      return { ok: true }
    }
  }
  // Harden the shared class prototype against post-publication mutation (the
  // official marker table is a WeakMap keyed by prototype, so freezing the
  // prototype does not prevent marking; the service INSTANCE is deliberately NOT
  // frozen because the shared core binds `typertRemote` onto it after this
  // factory returns — shared-core delegation).
  Object.freeze(RemoteSettingsService.prototype)
  return new RemoteSettingsService()
}

function assertNamespace(settings, namespace) {
  let descriptors
  try {
    descriptors = settings.describe({ redactSecrets: true })
  } catch (error) {
    throw new PluginApiSettingsNamespaceError(namespace)
  }
  if (!Array.isArray(descriptors)) throw new PluginApiRemoteError('settings.describe must return an array')
  const descriptor = descriptors.find((candidate) => candidate?.ns === namespace)
  if (!descriptor || !isPlainObject(descriptor)) {
    throw new PluginApiSettingsNamespaceError(namespace)
  }
  return descriptor
}

function validateSetRequest(request) {
  if (!isPlainObject(request)) throw new PluginApiRemoteError('settings remote set request must be a plain object')
  for (const key of Object.keys(request)) {
    if (key !== 'patch' && key !== 'unset') throw new PluginApiRemoteError(`settings remote set request has unknown field "${key}"`)
  }
  const ops = []
  if (request.unset !== undefined) {
    if (!Array.isArray(request.unset)) throw new PluginApiRemoteError('settings remote unset must be an array')
    for (const field of request.unset) {
      if (typeof field !== 'string' || field.length === 0) throw new PluginApiRemoteError('settings remote unset fields must be non-empty strings')
      ops.push({ op: 'unset', path: [field] })
    }
  }
  if (request.patch !== undefined) {
    if (!isPlainObject(request.patch)) throw new PluginApiRemoteError('settings remote patch must be a plain object')
    for (const [field, value] of Object.entries(request.patch)) {
      if (field.length === 0) throw new PluginApiRemoteError('settings remote patch fields must be non-empty strings')
      assertJsonValue(value, `settings patch field "${field}"`)
      ops.push({ op: 'set', path: [field], value: cloneJsonValue(value) })
    }
  }
  return ops
}

function validatePrimitives(ctx, settings, protocol) {
  if (typeof ctx?.reflect?.provide !== 'function') return 'ctx.reflect.provide is unavailable'
  if (
    settings == null ||
    typeof settings.describe !== 'function' ||
    typeof settings.get !== 'function' ||
    typeof settings.mutate !== 'function'
  ) return 'official settings service is unavailable or malformed'
  if (
    typeof protocol?.TypertRemoteService !== 'function' ||
    typeof protocol?.isTypertRemoteSegment !== 'function' ||
    typeof protocol?.bindTypertRemote !== 'function' ||
    typeof protocol?.remoteMethods !== 'function' ||
    typeof protocol?.Remote !== 'function'
  ) return 'official Typert remote protocol is unavailable or malformed'
  return null
}

function normalizeActive(active) {
  return typeof active === 'function' ? active : () => Boolean(active)
}
