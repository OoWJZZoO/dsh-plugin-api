/**
 * Generic host-side Typert Remote publication entry (`pluginApi.remotes`).
 *
 * `pluginApi.remotes.publish(serviceKey, service)` lets any community plugin
 * publish its own JSON-safe config/state service as an official Typert Remote.
 * This leaf owns validation (shape / method names / signatures / conflict),
 * the publication-dedicated prototype re-homing (so markers never touch
 * `Object.prototype`), and delegates the binding / registration / rollback /
 * disposer machinery to the shared core `remote-publication.js`.
 *
 * Consumes only official public protocol APIs and `ctx.reflect.provide`; never
 * imports official private modules; all failure paths are fail-safe (typed
 * errors at publish time, never thrown through host `apply`).
 */
import {
  PluginApiInactiveError,
  PluginApiFeatureDisabledError,
  PluginApiRemoteError,
} from './errors.js'
import {
  createRemoteOwner,
  publishRemotePublication,
  rehomeService,
  isRehomedService,
  collectProtoMethods,
  readPublishedService,
  validateRemoteSegment,
  report,
} from './remote-publication.js'

export const HOST_REMOTE_FEATURE = 'remote'

const IDENTIFIER_PATTERN = /^[$A-Z_a-z][$\w]*$/u

/**
 * @param {{ ctx?: object, protocol?: object, active?: boolean|(() => boolean), logger?: object }} options
 */
export function createHostRemoteApi({ ctx, protocol, active = true, logger } = {}) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const disabledReason = validatePrimitives(ctx, protocol)
  if (disabledReason) return createDisabledHostRemoteApi(isActive, disabledReason)

  const owner = createRemoteOwner({ ctx, ownerName: HOST_REMOTE_FEATURE })

  function publish(serviceKey, service) {
    if (!isActive()) throw new PluginApiInactiveError()

    // Service key grammar.
    validateRemoteSegment(protocol, serviceKey, 'Typert service key')

    // Owner idempotence: same key + same reference → existing disposer,
    // before any shape re-validation / re-home (so an already re-homed object is
    // never mis-rejected as a non-plain object, remote publication).
    const existing = owner.get(serviceKey)
    if (existing?.service === service && !existing.disposed) return existing.disposer

    // Shape determination (remote publication joint contract + narrowing).
    const methods = determineMethods(service, serviceKey)
    if (methods.length === 0) {
      throw new PluginApiRemoteError('service exposes no callable members', { serviceKey })
    }

    // Method-name segment grammar.
    for (const method of methods) {
      validateRemoteSegment(protocol, method, `service method "${method}"`)
    }

    // Signature check: the official gateway derives wire
    // parameter names from `Function.prototype.toString`; a list the gateway
    // cannot parse (destructuring / defaults / rest / duplicates / non-identifier)
    // or a non-final `signal` fails closed here, before registration.
    for (const method of methods) {
      methodParameterNames(service, method, serviceKey)
    }

    // Read-only conflict pre-check BEFORE re-home, so a doomed
    // publication never mutates the caller's object (client). The shared core
    // re-probes as a second safety layer under the same key.
    conflictPreCheck(ctx, owner, serviceKey, service)

    // Publication-dedicated prototype (same function refs).
    if (!isRehomedService(service)) {
      rehomeService({ service, methods })
    }

    // Delegate binding / registration / rollback / disposer to the shared core.
    // `rehome:false` — this leaf already installed the dedicated prototype; the
    // core's plain-object safety net does not re-run (dedicated proto ≠ Object.prototype).
    return publishRemotePublication({
      ctx,
      protocol,
      logger,
      owner,
      serviceKey,
      service,
      methods,
      rehome: false,
    })
  }

  function dispose() {
    for (const record of [...owner.values()]) {
      try {
        record.disposer?.()
      } catch (error) {
        report(logger, `dsh-plugin-api feature "${HOST_REMOTE_FEATURE}" dispose failed`, error)
      }
    }
    owner.clear()
  }

  return Object.freeze({ isActive: true, publish, dispose })
}

/**
 * Disabled face. The shape stays visible (`isActive`, `publish`, `dispose`) so
 * callers can inspect availability; `publish` fails with the standard disabled
 * contract (or the core-inactive error when the core is inactive).
 */
export function createDisabledHostRemoteApi(active = true, reason = 'required host primitive is unavailable') {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const fail = () => {
    if (!isActive()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('remotes', reason)
  }
  return Object.freeze({ isActive: false, publish: fail, dispose() {} })
}

/**
 * Determine the publishable method set.
 *
 * Accepted shapes: a plain object literal, a foreign/shared-
 * prototype object with own callable members, or an object this feature already
 * re-homed (methods recovered from the dedicated prototype). Rejected:
 * `null`, arrays, objects with no callable own members (including a class
 * instance whose methods live only on the class prototype — the remote publication narrowing),
 * and objects that cannot be re-homed (`preventExtensions` / non-extensible).
 *
 * @param {unknown} service
 * @param {string} serviceKey
 * @returns {string[]} own callable member names (or recovered, in stable order)
 */
function determineMethods(service, serviceKey) {
  if (!isObjectLike(service) || Array.isArray(service)) {
    throw new PluginApiRemoteError('service must be an object with callable members', { serviceKey })
  }
  if (Object.isExtensible(service) === false && !isRehomedService(service)) {
    throw new PluginApiRemoteError('service cannot be published: the object is non-extensible', { serviceKey })
  }

  const own = Object.keys(service).filter((name) => typeof service[name] === 'function')
  if (own.length > 0) return own
  if (isRehomedService(service)) {
    const recovered = collectProtoMethods(service)
    if (recovered.length > 0) return recovered
  }
  // Plain object with no callable members, or class-prototype-only instance.
  throw new PluginApiRemoteError('service exposes no callable own members', { serviceKey })
}

/**
 * Static signature check mirroring the official gateway's SRC methodParameterNames
 * contract. Throws a typed error before registration when the gateway would
 * reject the signature at invocation time (`signature-invalid`).
 */
function methodParameterNames(service, method, serviceKey) {
  let fn
  try {
    fn = service[method]
  } catch {
    fn = undefined
  }
  if (typeof fn !== 'function') {
    throw new PluginApiRemoteError(`service method "${method}" is not callable`, { serviceKey })
  }
  const source = Function.prototype.toString.call(fn)
  const open = source.indexOf('(')
  const close = source.indexOf(')', open + 1)
  if (open < 0 || close < 0) {
    throw new PluginApiRemoteError(`service method "${method}" has an invalid signature`, { serviceKey })
  }
  const body = source.slice(open + 1, close).trim()
  if (body.length === 0) return []
  const parts = body.split(',').map((part) => part.trim())
  const names = new Set()
  for (const part of parts) {
    if (!IDENTIFIER_PATTERN.test(part) || names.has(part)) {
      throw new PluginApiRemoteError(
        `service method "${method}" must use unique identifier parameters without destructuring, defaults, or rest`,
        { serviceKey },
      )
    }
    names.add(part)
  }
  const signalIndex = [...names].indexOf('signal')
  if (signalIndex >= 0 && signalIndex !== names.size - 1) {
    throw new PluginApiRemoteError(
      `service method "${method}" must place the signal parameter last`,
      { serviceKey },
    )
  }
  return [...names]
}

/**
 * Read-only conflict detection: a live owner under the same key
 * that is not this exact service is a peer conflict; detection happens before
 * any object mutation.
 */
function conflictPreCheck(ctx, owner, serviceKey, service) {
  const existing = owner.get(serviceKey)
  if (existing && existing.service !== service && !existing.disposed) {
    throw new PluginApiRemoteError(`Typert service key "${serviceKey}" is already active`, { serviceKey })
  }
  const published = readPublishedService(ctx, serviceKey)
  if (published !== undefined && published !== service) {
    throw new PluginApiRemoteError(`Typert service key "${serviceKey}" is already active`, { serviceKey })
  }
}

function validatePrimitives(ctx, protocol) {
  if (typeof ctx?.reflect?.provide !== 'function') return 'ctx.reflect.provide is unavailable'
  if (
    typeof protocol?.isTypertRemoteSegment !== 'function' ||
    typeof protocol?.bindTypertRemote !== 'function' ||
    typeof protocol?.remoteMethods !== 'function' ||
    typeof protocol?.Remote !== 'function'
  ) return 'official Typert remote protocol is unavailable or malformed'
  return null
}

function isObjectLike(value) {
  return typeof value === 'object' && value !== null
}
