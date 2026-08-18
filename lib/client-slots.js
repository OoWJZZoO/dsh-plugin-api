import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'
import { deepFreeze } from './deep-freeze.js'

export const CLIENT_SLOTS_FEATURE = 'clientSlots'

export function createClientSlots({ ctx, slots, active = true, notifyChanged } = {}) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  if (slots === undefined) {
    try { slots = typeof ctx?.get === 'function' ? ctx.get('slots') : ctx?.slots } catch { slots = undefined }
  }
  if (!isSlots(slots)) return createDisabledClientSlots(isActive)
  let stopNativeObserver = () => {}
  if (typeof notifyChanged === 'function' && typeof slots.onMutate === 'function') {
    const dispose = slots.onMutate((key) => {
      try { notifyChanged(key) } catch {}
    })
    if (typeof dispose === 'function') stopNativeObserver = dispose
  }
  return Object.freeze({
    isActive: true,
    register(options, component) {
      assertActive(isActive)
      validateOptions(options)
      // The official runtime owns declaration lifetime, ordering and the
      // native slots/changed event. Preserve its exact disposer identity.
      return slots.register(options, component)
    },
    inject(key, callback) { assertActive(isActive); validateKey(key); return slots.inject(key, callback) },
    entries(key) { assertActive(isActive); validateKey(key); return immutableEntries(slots.entries(key)) },
    subscribe(key, listener) { assertActive(isActive); validateKey(key); return slots.subscribe(key, listener) },
    dispose() { return stopNativeObserver() },
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
  validateKey(options.name)
  if (options.id !== undefined && (typeof options.id !== 'string' || options.id.length === 0)) throw new TypeError('slot registration id must be a non-empty string when provided')
  if (options.key !== undefined && (typeof options.key !== 'string' || options.key.length === 0)) throw new TypeError('slot registration key must be a non-empty string when provided')
  if (options.order !== undefined && !Number.isFinite(options.order)) throw new TypeError('slot registration order must be a finite number when provided')
  if (options.priority !== undefined && !Number.isFinite(options.priority)) throw new TypeError('slot registration priority must be a finite number when provided')
  if (options.children !== undefined && (typeof options.children !== 'object' || options.children === null || Array.isArray(options.children))) throw new TypeError('slot registration children must be an object when provided')
  if (options.children) {
    for (const [key, entry] of Object.entries(options.children)) {
      validateKey(key)
      validateSlotEntryDef(entry)
    }
  }
}

function validateSlotEntryDef(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('slot child declaration must be a SlotEntryDef object')
  if (!['single', 'list', 'keyed', 'chain'].includes(entry.kind)) throw new TypeError('slot child declaration kind is invalid')
  if (!['root', 'session-maybe', 'session'].includes(entry.scope)) throw new TypeError('slot child declaration scope is invalid')
  for (const key of ['owner', 'inject']) {
    if (entry[key] !== undefined && (typeof entry[key] !== 'object' || entry[key] === null || Array.isArray(entry[key]))) {
      throw new TypeError(`slot child declaration ${key} must be an object when provided`)
    }
  }
  if (entry.keyProps !== undefined) {
    if (typeof entry.keyProps !== 'object' || entry.keyProps === null || Array.isArray(entry.keyProps)) {
      throw new TypeError('slot child declaration keyProps must be an object when provided')
    }
    if (Object.values(entry.keyProps).some((value) => typeof value !== 'object' || value === null || Array.isArray(value))) {
      throw new TypeError('slot child declaration keyProps values must be objects')
    }
  }
}

function validateKey(key) {
  if (typeof key !== 'string' || !(/^(?:root|details|shell\.overlay|settings(?:\.[\w.-]+)?|sidebar(?:\.[\w.-]+)?|conversation(?:\.[\w.-]+)?)$/.test(key))) {
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

function assertActive(isActive) { if (!isActive()) throw new PluginApiInactiveError() }
