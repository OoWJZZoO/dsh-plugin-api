/**
 * ST4 host leaf: publish one registered settings namespace through the public
 * Typert remote binding contract.  The integration owner mounts this leaf as
 * `pluginApi.settings.remote`; this module owns no shared facade composition.
 */
import {
  PluginApiFeatureDisabledError,
  PluginApiInactiveError,
  PluginApiSettingsNamespaceError,
} from './errors.js'

export const SETTINGS_REMOTE_FEATURE = 'settingsRemote'

const REQUIRED_METHODS = Object.freeze(['get', 'set'])
const owners = new WeakMap()

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

  const localOwners = getOwners(ctx)
  const ownedRecords = new Set()

  function remote(namespace, serviceKey = namespace) {
    if (!isActive()) throw new PluginApiInactiveError()
    validateSegment(protocol, namespace, 'settings namespace')
    validateSegment(protocol, serviceKey, 'Typert service key')
    assertNamespace(settings, namespace)

    const previous = localOwners.get(serviceKey)
    if (previous) {
      if (previous.namespace === namespace) return previous.disposer
      throw new TypeError(`dsh-plugin-api settings: Typert service key "${serviceKey}" is already active`)
    }

    let service
    let unregister
    try {
      service = createRemoteService({ settings, protocol, namespace, serviceKey })
      unregister = ctx.reflect.provide(serviceKey, service)
      if (typeof unregister !== 'function') throw new TypeError('ctx.reflect.provide did not return a disposer')
    } catch (error) {
      report(logger, `dsh-plugin-api feature "${SETTINGS_REMOTE_FEATURE}" could not publish "${serviceKey}"`, error)
      try {
        if (typeof unregister === 'function') unregister()
      } catch (rollbackError) {
        report(logger, `dsh-plugin-api feature "${SETTINGS_REMOTE_FEATURE}" rollback failed`, rollbackError)
      }
      throw error
    }

    const record = { namespace, serviceKey, service, disposer: null, disposed: false }
    const disposer = () => {
      if (record.disposed) return false
      if (localOwners.get(serviceKey) !== record) {
        record.disposed = true
        return false
      }
      record.disposed = true
      ownedRecords.delete(record)
      localOwners.delete(serviceKey)
      try {
        return unregister()
      } catch (error) {
        report(logger, `dsh-plugin-api feature "${SETTINGS_REMOTE_FEATURE}" disposer failed`, error)
        return false
      }
    }
    record.disposer = disposer
    localOwners.set(serviceKey, record)
    ownedRecords.add(record)
    return disposer
  }

  return Object.freeze({
    isActive: true,
    remote,
    dispose() {
      for (const record of [...ownedRecords]) record.disposer()
      ownedRecords.clear()
    }
  })
}

export function createDisabledSettingsRemoteApi(active = true, reason = 'required host primitive is unavailable') {
  const isActive = normalizeActive(active)
  const fail = () => {
    if (!isActive()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError(SETTINGS_REMOTE_FEATURE, reason)
  }
  return Object.freeze({ isActive: false, remote: fail, dispose() {} })
}

function createRemoteService({ settings, protocol, namespace, serviceKey }) {
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
        throw new TypeError('settings namespace descriptor is missing its value')
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
  const service = new RemoteSettingsService()

  const binding = protocol.bindTypertRemote(service, serviceKey, { namespace: serviceKey })
  if (!binding || binding.service !== service || binding.serviceKey !== serviceKey || binding.namespace !== serviceKey) {
    throw new TypeError('bindTypertRemote returned a malformed binding')
  }
  Object.defineProperty(service, 'typertRemote', { value: binding, enumerable: true })

  for (const method of REQUIRED_METHODS) markRemote(protocol, service, method)
  const descriptors = protocol.remoteMethods(service)
  if (!Array.isArray(descriptors) || descriptors.length !== REQUIRED_METHODS.length) {
    throw new TypeError('remoteMethods returned malformed settings descriptors')
  }
  for (let index = 0; index < REQUIRED_METHODS.length; index += 1) {
    const descriptor = descriptors[index]
    if (descriptor?.method !== REQUIRED_METHODS[index] || descriptor.invocation?.kind !== 'direct') {
      throw new TypeError('remoteMethods returned an unexpected settings descriptor')
    }
  }
  Object.freeze(RemoteSettingsService.prototype)
  return Object.freeze(service)
}

function markRemote(protocol, instance, method) {
  const remote = protocol.Remote
  if (typeof remote !== 'function') throw new TypeError('official Remote marker is unavailable')
  const decorator = remote(method)
  if (typeof decorator !== 'function') throw new TypeError('official Remote marker is malformed')
  decorator(instance[method], {
    kind: 'method',
    name: method,
    static: false,
    private: false,
    addInitializer(initializer) {
      if (typeof initializer === 'function') initializer.call(instance)
    },
  })
}

function assertNamespace(settings, namespace) {
  let descriptors
  try {
    descriptors = settings.describe({ redactSecrets: true })
  } catch (error) {
    throw new PluginApiSettingsNamespaceError(namespace)
  }
  if (!Array.isArray(descriptors)) throw new TypeError('settings.describe must return an array')
  const descriptor = descriptors.find((candidate) => candidate?.ns === namespace)
  if (!descriptor || !isPlainObject(descriptor)) {
    throw new PluginApiSettingsNamespaceError(namespace)
  }
  return descriptor
}

function validateSetRequest(request) {
  if (!isPlainObject(request)) throw new TypeError('settings remote set request must be a plain object')
  for (const key of Object.keys(request)) {
    if (key !== 'patch' && key !== 'unset') throw new TypeError(`settings remote set request has unknown field "${key}"`)
  }
  const ops = []
  if (request.unset !== undefined) {
    if (!Array.isArray(request.unset)) throw new TypeError('settings remote unset must be an array')
    for (const field of request.unset) {
      if (typeof field !== 'string' || field.length === 0) throw new TypeError('settings remote unset fields must be non-empty strings')
      ops.push({ op: 'unset', path: [field] })
    }
  }
  if (request.patch !== undefined) {
    if (!isPlainObject(request.patch)) throw new TypeError('settings remote patch must be a plain object')
    for (const [field, value] of Object.entries(request.patch)) {
      if (field.length === 0) throw new TypeError('settings remote patch fields must be non-empty strings')
      assertJsonValue(value, `settings patch field "${field}"`)
      ops.push({ op: 'set', path: [field], value: cloneJsonValue(value) })
    }
  }
  return ops
}

function assertJsonValue(value, label, seen = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw new TypeError(`${label} must contain only finite numbers`)
  }
  if (typeof value !== 'object') throw new TypeError(`${label} is not JSON-safe`)
  if (seen.has(value)) throw new TypeError(`${label} must not contain cycles`)
  if (!isPlainObject(value) && !Array.isArray(value)) throw new TypeError(`${label} is not JSON-safe`)
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, label, seen)
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (typeof key !== 'string') throw new TypeError(`${label} has an invalid key`)
      assertJsonValue(item, label, seen)
    }
  }
  seen.delete(value)
}

function cloneJsonValue(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(cloneJsonValue)
  const copy = {}
  for (const [key, item] of Object.entries(value)) copy[key] = cloneJsonValue(item)
  return copy
}

function validateSegment(protocol, value, subject) {
  if (typeof value !== 'string' || typeof protocol.isTypertRemoteSegment !== 'function' || !protocol.isTypertRemoteSegment(value)) {
    throw new TypeError(`${subject} must satisfy the official Typert remote-segment grammar`)
  }
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

function getOwners(ctx) {
  let local = owners.get(ctx)
  if (!local) {
    local = new Map()
    owners.set(ctx, local)
  }
  return local
}

function normalizeActive(active) {
  return typeof active === 'function' ? active : () => Boolean(active)
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function report(logger, message, error) {
  try {
    const detail = error instanceof Error && error.message ? `: ${error.message}` : ''
    logger?.error?.(`${message}${detail}`)
  } catch {
    // Diagnostics are best effort and must not escape the host boundary.
  }
}
