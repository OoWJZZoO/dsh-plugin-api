/**
 * Shared host publication core for Typert Remote services.
 *
 * Owner-parameterized binding / marking / registration / rollback / disposer
 * machinery shared by the generic `pluginApi.remote.publish` (host-remote)
 * and the settings remote `pluginApi.settings.remote` bridge. Every feature gets its own
 * per-context record map keyed by `ownerName`, so `settingsRemote` and `remote`
 * keep fully independent owner semantics.
 *
 * This module consumes only official public protocol APIs
 * (`isTypertRemoteSegment` / `bindTypertRemote` / `Remote` / `remoteMethods`
 * from @deepseek-ai/dsh-typert-protocol) and `ctx.reflect.provide`. It never
 * imports official private modules and never modifies an official package.
 */
import { PluginApiRemoteError } from './errors.js'

const ownersByCtx = new WeakMap()
const dedicatedProtos = new WeakSet()

/**
 * Resolve (or create) the per-owner record map for one context.
 * @param {{ ctx: object, ownerName: string }} options
 * @returns {Map<string, object>} owner records keyed by serviceKey
 */
export function createRemoteOwner({ ctx, ownerName }) {
  if (!isObject(ctx)) throw new TypeError('remote publication requires a Cordis context')
  if (typeof ownerName !== 'string' || ownerName.length === 0) {
    throw new TypeError('remote publication owner name must be a non-empty string')
  }
  let byOwner = ownersByCtx.get(ctx)
  if (!byOwner) {
    byOwner = new Map()
    ownersByCtx.set(ctx, byOwner)
  }
  let records = byOwner.get(ownerName)
  if (!records) {
    records = new Map()
    byOwner.set(ownerName, records)
  }
  return records
}

/**
 * Publish one Typert Remote service contribution.
 *
 * Executes, in order: owner idempotence short-circuit → read-only conflict
 * probe → (optional re-home) → binding → marking/verification → registration →
 * owner-record commit. Any failure rolls back only the registrations completed
 * by this call and is contained at the host boundary (never thrown through
 * host `apply`).
 *
 * @param {{
 *   ctx: object,
 *   protocol: object,
 *   logger?: object,
 *   owner: Map<string, object>,
 *   serviceKey: string,
 *   service: object,
 *   methods: string[],
 *   rehome?: boolean,
 * }} options
 * @returns {() => boolean} owner-scoped, idempotent, stale-safe disposer
 */
export function publishRemotePublication({
  ctx,
  protocol,
  logger,
  owner,
  serviceKey,
  service,
  methods,
  rehome = false,
}) {
  if (!owner || typeof owner.get !== 'function' || typeof owner.set !== 'function' || typeof owner.delete !== 'function') {
    throw new PluginApiRemoteError('publication owner is unavailable')
  }
  validateRemoteSegment(protocol, serviceKey, 'Typert service key')
  if (!isObject(service)) throw new PluginApiRemoteError('service must be an object', { serviceKey })
  if (!Array.isArray(methods) || methods.length === 0 || !methods.every(isNonEmptyName)) {
    throw new PluginApiRemoteError('publication requires a non-empty method name list', { serviceKey })
  }
  if (typeof ctx?.reflect?.provide !== 'function') {
    throw new PluginApiRemoteError('ctx.reflect.provide is unavailable', { serviceKey })
  }

  // Step 1 — owner idempotence short-circuit: same key + reference-equal
  // service returns the existing disposer.
  const existing = owner.get(serviceKey)
  if (existing?.service === service && !existing.disposed) return existing.disposer

  // Step 2 — read-only conflict probe: the official service registry
  // (guarded ctx.get) is the shared same-key view across features. A live owner
  // that is not this exact service is a peer conflict.
  const published = readPublishedService(ctx, serviceKey)
  if (published !== undefined && published !== service) {
    throw new PluginApiRemoteError(`Typert service key "${serviceKey}" is already active`, { serviceKey })
  }
  // Same owner, different service object under the same key — duplicate conflict.
  if (existing && existing.service !== service) {
    throw new PluginApiRemoteError(`Typert service key "${serviceKey}" is already active`, { serviceKey })
  }

  // Re-home onto a publication-dedicated prototype only after the conflict
  // checks, so a doomed publication never mutates the caller's object (client).
  // Safety net: even when the caller passes `rehome:false` (host-remote/settings remote
  // already installed a dedicated prototype), a service whose prototype is
  // `Object.prototype`/`null` must never be marked in place — markers would
  // leak into every unrelated plain object.
  let effectiveMethods = methods
  if (rehome || isPlainObject(service)) {
    if (isRehomedService(service)) {
      // Recovery: an already-re-homed object no longer exposes its methods
      // as own `Object.keys`; recover them from the dedicated prototype instead
      // of treating the object as having an empty method set.
      effectiveMethods = collectProtoMethods(service)
      if (effectiveMethods.length === 0) {
        throw new PluginApiRemoteError('service exposes no callable members after re-home recovery', { serviceKey })
      }
    } else {
      rehomeService({ service, methods })
    }
  }

  let binding
  let unregister
  try {
    // Step 3 — binding. Idempotent: an already-consistent binding from
    // a failed prior attempt is reused instead of redefined on a
    // non-configurable own property. A consistent binding for a DIFFERENT key is
    // a distinct fail-fast case (one object is single-binding-bound).
    const existingBinding = service.typertRemote
    if (existingBinding) {
      if (
        existingBinding.service === service &&
        existingBinding.serviceKey === serviceKey &&
        existingBinding.namespace === serviceKey
      ) {
        binding = existingBinding
      } else if (
        existingBinding.service === service &&
        existingBinding.namespace === existingBinding.serviceKey
      ) {
        throw new PluginApiRemoteError(
          `service is already bound under serviceKey "${existingBinding.serviceKey}"`,
          { serviceKey },
        )
      } else {
        throw new PluginApiRemoteError('malformed existing typertRemote binding', { serviceKey })
      }
    } else {
      binding = protocol.bindTypertRemote(service, serviceKey)
      if (
        !binding ||
        binding.service !== service ||
        binding.serviceKey !== serviceKey ||
        binding.namespace !== serviceKey
      ) {
        throw new PluginApiRemoteError('bindTypertRemote returned a malformed binding', { serviceKey })
      }
      Object.defineProperty(service, 'typertRemote', { value: binding, enumerable: true })
    }

    // Step 4 — mark every published method and verify the official metadata
    //. Markers live on the dedicated prototype only.
    for (const method of effectiveMethods) markRemoteMethod(protocol, service, method)
    const runtimeMethods = protocol.remoteMethods(service)
    if (!Array.isArray(runtimeMethods)) throw new PluginApiRemoteError('remoteMethods returned malformed descriptors', { serviceKey })
    const actual = runtimeMethods.map((entry) => entry.method)
    if (
      actual.length !== effectiveMethods.length ||
      effectiveMethods.some((method, index) => actual[index] !== method)
    ) {
      throw new PluginApiRemoteError('remoteMethods returned an unexpected method set', { serviceKey })
    }

    // Step 5 — register through the official provider boundary.
    unregister = ctx.reflect.provide(serviceKey, service)
    if (typeof unregister !== 'function') {
      throw new PluginApiRemoteError('ctx.reflect.provide did not return a disposer', { serviceKey })
    }
  } catch (error) {
    report(logger, `dsh-plugin-api remote could not publish "${serviceKey}"`, error)
    // Roll back only this call's completed registration.
    if (typeof unregister === 'function') {
      try {
        unregister()
      } catch (rollbackError) {
        report(logger, `dsh-plugin-api remote rollback failed for "${serviceKey}"`, rollbackError)
      }
    }
    if (error instanceof PluginApiRemoteError) throw error
    const detail = error instanceof Error && error.message ? `: ${error.message}` : ''
    throw new PluginApiRemoteError(`publication failed${detail}`, { serviceKey })
  }

  // Step 6 — commit the owner record and return a stable disposer.
  const record = { serviceKey, service, methods: effectiveMethods, binding, disposer: null, disposed: false }
  const disposer = () => {
    if (record.disposed) return false
    if (owner.get(serviceKey) !== record) {
      record.disposed = true
      return false
    }
    record.disposed = true
    owner.delete(serviceKey)
    // A delayed cleanup must never retract a later provider (stale-disposer
    // protection).
    const live = readPublishedService(ctx, serviceKey)
    if (live !== undefined && live !== record.service) return false
    try {
      return unregister()
    } catch (error) {
      report(logger, `dsh-plugin-api remote disposer failed for "${serviceKey}"`, error)
      return false
    }
  }
  record.disposer = disposer
  owner.set(serviceKey, record)
  return disposer
}

/**
 * Re-home a service's callable members onto a publication-dedicated prototype.
 *
 * The official Remote marker table is keyed by `Object.getPrototypeOf(service)`
 * and the gateway derives wire parameter names from `Function.prototype.toString`
 * of the method found via that prototype. Moving the SAME function references
 * onto a dedicated prototype therefore preserves wire identity while keeping
 * markers off `Object.prototype` / any shared/foreign prototype.
 *
 * @param {{ service: object, methods: string[] }} options
 * @returns {object} the (same reference) service with its dedicated prototype
 */
export function rehomeService({ service, methods }) {
  if (!isObject(service)) throw new PluginApiRemoteError('re-home requires a service object')
  if (isRehomedService(service)) return service
  if (!Array.isArray(methods) || methods.length === 0) {
    throw new PluginApiRemoteError('re-home requires a method list')
  }
  const proto = Object.create(Object.prototype)
  for (const method of methods) {
    if (typeof service[method] !== 'function') {
      throw new PluginApiRemoteError(`service has no callable member "${method}"`)
    }
    proto[method] = service[method]
    // Move the own enumerable copies off the object so resolution goes through
    // the dedicated prototype (the gateway walks the prototype chain from
    // Object.getPrototypeOf(service) and markers key on that prototype).
    try {
      delete service[method]
    } catch {
      // Best effort; an undeletable own prop still resolves for the caller and
      // the prototype walk hits the dedicated copy first.
    }
  }
  try {
    Object.setPrototypeOf(service, proto)
  } catch {
    // A proxy/exotic object whose setPrototypeOf trap throws must fail as a
    // typed error, never
    // surface a raw engine TypeError from a non-facade boundary.
    throw new PluginApiRemoteError('service cannot be re-homed: the object rejected a prototype change')
  }
  dedicatedProtos.add(proto)
  return service
}

/** True when `service`'s direct prototype is one this core created. */
export function isRehomedService(service) {
  return isObject(service) && dedicatedProtos.has(Object.getPrototypeOf(service))
}

/** Own callable members of a service's dedicated prototype for recovery. */
export function collectProtoMethods(service) {
  const proto = Object.getPrototypeOf(service)
  if (!isObject(proto)) return []
  return Object.keys(proto).filter((name) => typeof proto[name] === 'function')
}

/**
 * Ground-truth read of the official service registry (guarded `ctx.get`).
 * `ctx.get` returns `undefined` for an unregistered key and does not throw on
 * absence; an unavailable probe is treated as "no existing owner".
 * @param {object} ctx
 * @param {string} serviceKey
 * @returns {unknown} the live service for `serviceKey`, or `undefined`
 */
export function readPublishedService(ctx, serviceKey) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(serviceKey) : undefined
  } catch {
    return undefined
  }
}

/** Validate a service key / method name against the Typert segment grammar. */
export function validateRemoteSegment(protocol, value, subject) {
  if (
    typeof value !== 'string' ||
    typeof protocol?.isTypertRemoteSegment !== 'function' ||
    !protocol.isTypertRemoteSegment(value)
  ) {
    throw new PluginApiRemoteError(`${subject} must satisfy the official Typert remote-segment grammar`)
  }
}

/** Attach the official Remote marker to one method (no decorator syntax). */
export function markRemoteMethod(protocol, instance, method) {
  const remote = protocol?.Remote
  if (typeof remote !== 'function') throw new PluginApiRemoteError('the official Remote marker is unavailable')
  const decorator = remote(method)
  if (typeof decorator !== 'function') throw new PluginApiRemoteError('the official Remote marker is malformed')
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

/** JSON-safe boundary predicates / helpers (shared with the settings bridge). */
export function isJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || seen.has(value)) return false
  if (!isPlainObject(value) && !Array.isArray(value)) return false
  seen.add(value)
  const ok = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.entries(value).every(([key, item]) => typeof key === 'string' && isJsonValue(item, seen))
  seen.delete(value)
  return ok
}

export function assertJsonValue(value, label, seen = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw new PluginApiRemoteError(`${label} must contain only finite numbers`)
  }
  if (typeof value !== 'object') throw new PluginApiRemoteError(`${label} is not JSON-safe`)
  if (seen.has(value)) throw new PluginApiRemoteError(`${label} must not contain cycles`)
  if (!isPlainObject(value) && !Array.isArray(value)) throw new PluginApiRemoteError(`${label} is not JSON-safe`)
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, label, seen)
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (typeof key !== 'string') throw new PluginApiRemoteError(`${label} has an invalid key`)
      assertJsonValue(item, label, seen)
    }
  }
  seen.delete(value)
}

export function cloneJsonValue(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(cloneJsonValue)
  const copy = {}
  for (const [key, item] of Object.entries(value)) copy[key] = cloneJsonValue(item)
  return copy
}

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Fail-safe diagnostics; must never escape the host boundary. */
export function report(logger, message, error) {
  try {
    const detail = error instanceof Error && error.message ? `: ${error.message}` : ''
    logger?.error?.(`${message}${detail}`)
  } catch {
    // Diagnostics are best effort.
  }
}

function isNonEmptyName(value) {
  return typeof value === 'string' && value.length > 0
}

function isObject(value) {
  return typeof value === 'object' && value !== null
}
