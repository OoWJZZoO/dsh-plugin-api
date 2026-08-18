import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'
import { deepFreeze } from './deep-freeze.js'

export const CLIENT_SLOTS_FEATURE = 'clientSlots'

export function createClientSlots({ ctx, slots, active = true, notifyChanged, logger } = {}) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  if (slots === undefined) {
    try { slots = typeof ctx?.get === 'function' ? ctx.get('slots') : ctx?.slots } catch { slots = undefined }
  }
  if (!isSlots(slots)) return createDisabledClientSlots(isActive)
  const changed = typeof notifyChanged === 'function' ? notifyChanged : () => {}
  const nativeMutations = typeof slots.onMutate === 'function'
  const unsubscribeMutations = nativeMutations
    ? slots.onMutate((key) => safelyNotify(changed, key, logger))
    : undefined
  return Object.freeze({
    isActive: true,
    register(options, component) {
      assertActive(isActive)
      validateOptions(options)
      const disposer = slots.register(options, component)
      if (typeof disposer !== 'function') throw new TypeError('official slots.register did not return a disposer')
      if (!nativeMutations) safelyNotify(changed, options.key, logger)
      let disposed = false
      return () => {
        if (disposed) return false
        disposed = true
        const result = disposer()
        if (!nativeMutations) safelyNotify(changed, options.key, logger)
        return result === undefined ? true : result
      }
    },
    inject(key, callback) { assertActive(isActive); validateKey(key); return slots.inject(key, callback) },
    entries(key) { assertActive(isActive); validateKey(key); return immutableEntries(slots.entries(key)) },
    subscribe(key, listener) { assertActive(isActive); validateKey(key); return slots.subscribe(key, listener) },
    dispose() { try { unsubscribeMutations?.() } catch {} },
  })
}

export function createDisabledClientSlots(active = true, reason = 'official slots service is unavailable') {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const fail = () => { if (!isActive()) throw new PluginApiInactiveError(); throw new PluginApiFeatureDisabledError(CLIENT_SLOTS_FEATURE, reason) }
  return Object.freeze({ isActive: false, register: fail, inject: fail, entries: fail, subscribe: fail, dispose() {} })
}

export function validateSlotKey(key) { validateKey(key); return key }

function isSlots(value) {
  try { return value != null && ['register', 'inject', 'entries', 'subscribe'].every((name) => typeof value[name] === 'function') } catch { return false }
}

function validateOptions(options) {
  if (!options || typeof options !== 'object') throw new TypeError('slot registration options must be an object')
  validateKey(options.key)
  const entry = options.entry ?? options
  if (!['single', 'list', 'keyed', 'chain'].includes(entry.kind)) throw new TypeError('slot entry kind must be single, list, keyed, or chain')
  if (!['root', 'session-maybe', 'session'].includes(entry.scope)) throw new TypeError('slot entry scope must be root, session-maybe, or session')
  for (const key of ['owner', 'inject']) if (entry[key] !== undefined && (typeof entry[key] !== 'object' || entry[key] === null)) throw new TypeError(`slot entry ${key} must be an object`)
  if (entry.keyProps !== undefined && (typeof entry.keyProps !== 'object' || entry.keyProps === null || Object.values(entry.keyProps).some((value) => typeof value !== 'object' || value === null))) throw new TypeError('slot entry keyProps must be Record<string, object>')
}

function validateKey(key) {
  if (typeof key !== 'string' || !(/^(settings\.[\w.-]+|sidebar\.[\w.-]+|shell\.overlay|conversation|details)$/.test(key))) {
    throw new TypeError(`slot key "${String(key)}" is not a canonical client slot id`)
  }
}

function immutableEntries(entries) {
  if (!Array.isArray(entries)) throw new TypeError('official slots.entries returned a malformed result')
  return Object.freeze(entries.map((entry) => deepFreeze(cloneEntry(entry))))
}

function cloneEntry(entry) {
  if (entry === null || typeof entry !== 'object') return entry
  if (Array.isArray(entry)) return entry.map(cloneEntry)
  const copy = {}
  for (const [key, value] of Object.entries(entry)) copy[key] = cloneEntry(value)
  return copy
}

function safelyNotify(changed, key, logger) {
  try { changed(key) } catch { try { logger?.error?.('dsh-plugin-api client slots/changed listener failed') } catch {} }
}

function assertActive(isActive) { if (!isActive()) throw new PluginApiInactiveError() }
