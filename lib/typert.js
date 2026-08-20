/**
 * typert facade host leaf: a typed, read-only forwarding face for the official Typert
 * registry. The registry owns all live state, validation, ordering, and
 * disposal. This module owns no registry state and never imports private DSH
 * implementation modules.
 */
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const TYPERT_FEATURE = 'typert'

// Empty but valid host artifact for the official Typert loader boundary.
export const TYPERT = Object.freeze({
  package: '@deepseek-ai/dsh-plugin-api-main',
  face: 'host',
  schemas: Object.freeze([]),
  model: Object.freeze({ services: Object.freeze([]), events: Object.freeze([]), objects: Object.freeze([]) }),
  invocations: Object.freeze([]),
})

const TOP_LEVEL_METHODS = [
  'register',
  'get',
  'resolve',
  'list',
  'getPackage',
  'listPackages',
  'toJSONSchema',
]

const NESTED_METHODS = Object.freeze({
  local: ['get', 'hasSeen', 'list', 'subscribe'],
  remotes: ['register', 'get', 'list', 'subscribe'],
  lookups: ['register', 'configure', 'get', 'definitions', 'keys', 'subscribe'],
  contexts: ['registerHost', 'configureHost', 'registerClient', 'getHost', 'getClient', 'subscribe'],
})

/**
 * Probe only the official public registry contract.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isTypertRegistry(value) {
  if (!isObject(value)) return false
  try {
    if (TOP_LEVEL_METHODS.some((name) => typeof value[name] !== 'function')) return false
    for (const [key, methods] of Object.entries(NESTED_METHODS)) {
      const nested = value[key]
      if (!isObject(nested) || methods.some((name) => typeof nested[name] !== 'function')) return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * Create the active typert facade facade from the official service in `ctx`.
 *
 * @param {{ ctx?: object, active?: boolean|(() => boolean), logger?: object }} options
 * @returns {object}
 */
export function createTypertFacade({ ctx, active = true, logger } = {}) {
  let registry
  try {
    registry = typeof ctx?.get === 'function' ? ctx.get('typert') : undefined
  } catch (error) {
    report(logger, `dsh-plugin-api feature "${TYPERT_FEATURE}" could not resolve the official registry`, error)
    return createDisabledTypertFacade(active, 'official Typert registry is unavailable')
  }

  if (!isTypertRegistry(registry)) {
    report(logger, `dsh-plugin-api feature "${TYPERT_FEATURE}" has a malformed official registry`)
    return createDisabledTypertFacade(active, 'official Typert registry is missing or malformed')
  }

  return buildFacade(registry, normalizeActive(active))
}

/**
 * Build the standard disabled typert facade face. The shape remains visible so callers
 * can inspect availability without accidentally reaching an absent service.
 */
export function createDisabledTypertFacade(active = true, reason = 'official Typert registry is unavailable') {
  const isActive = normalizeActive(active)
  const fail = () => {
    if (!isActive()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError('services.typert', reason)
  }

  const facade = { isActive: false }
  for (const name of TOP_LEVEL_METHODS) facade[name] = fail
  for (const [key, methods] of Object.entries(NESTED_METHODS)) {
    const nested = {}
    for (const name of methods) nested[name] = fail
    facade[key] = Object.freeze(nested)
  }
  return Object.freeze(facade)
}

function buildFacade(registry, isActive) {
  const facade = { isActive: true }
  for (const name of TOP_LEVEL_METHODS) {
    facade[name] = (...args) => {
      if (!isActive()) throw new PluginApiInactiveError()
      return registry[name](...args)
    }
  }
  for (const [key, methods] of Object.entries(NESTED_METHODS)) {
    const nested = {}
    for (const name of methods) {
      nested[name] = (...args) => {
        if (!isActive()) throw new PluginApiInactiveError()
        const nestedTarget = registry[key]
        return nestedTarget[name](...args)
      }
    }
    facade[key] = Object.freeze(nested)
  }
  return Object.freeze(facade)
}

function normalizeActive(active) {
  return typeof active === 'function' ? active : () => Boolean(active)
}

function isObject(value) {
  return typeof value === 'object' && value !== null
}

function report(logger, message, error) {
  try {
    logger?.error?.(error instanceof Error ? `${message} (error)` : message)
  } catch {
    // Logging is part of the fail-safe boundary.
  }
}
