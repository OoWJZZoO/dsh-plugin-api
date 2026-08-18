import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const CLIENT_SLOTS_FEATURE = 'clientSlots'

export function createClientSlots({ ctx, slots, active = true, notifyChanged } = {}) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  if (slots === undefined) {
    try { slots = typeof ctx?.get === 'function' ? ctx.get('slots') : ctx?.slots } catch { slots = undefined }
  }
  if (!isSlots(slots)) return createDisabledClientSlots(isActive)
  const changed = typeof notifyChanged === 'function' ? notifyChanged : () => {}
  return Object.freeze({
    isActive: true,
    register(options, component) {
      assertActive(isActive)
      validateOptions(options)
      const disposer = slots.register(options, component)
      if (typeof disposer !== 'function') throw new TypeError('official slots.register did not return a disposer')
      changed(options.key)
      let disposed = false
      return () => {
        if (disposed) return false
        disposed = true
        const result = disposer()
        changed(options.key)
        return result === undefined ? true : result
      }
    },
    inject(key, callback) { assertActive(isActive); validateKey(key); return slots.inject(key, callback) },
    entries(key) { assertActive(isActive); validateKey(key); return immutableEntries(slots.entries(key)) },
    subscribe(key, listener) { assertActive(isActive); validateKey(key); return slots.subscribe(key, listener) },
    dispose() {},
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
  if (typeof entry.kind !== 'string' || entry.kind.length === 0) throw new TypeError('slot entry kind is required')
  if (typeof entry.scope !== 'string' || entry.scope.length === 0) throw new TypeError('slot entry scope is required')
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
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })))
}

function assertActive(isActive) { if (!isActive()) throw new PluginApiInactiveError() }
