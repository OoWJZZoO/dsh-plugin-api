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
    /**
     * Read-only declaration view of one slot key.
     *
     * `status` separates the three cases a caller must be able to tell apart:
     * `declared` (the official runtime declares the slot — the view may still
     * hold no entries), `missing` (the official runtime answered and declares
     * nothing for this key) and `unavailable` (the official runtime cannot
     * answer at all). The remaining fields are the official declaration facts,
     * cloned and frozen; `spec` / `specDynamic` / `declarationEpoch` /
     * `snapshot` appear only when the official service exposes them.
     *
     * This is a projection over the official runtime: it declares nothing and
     * registers nothing. It is the single slot read entry — one standard query
     * verb for one fact.
     */
    inspect(key) { assertActive(isActive); validateKey(key); return declarationOf(key) },
    subscribe(key, listener) { assertActive(isActive); validateKey(key); return slots.subscribe(key, listener) },
    dispose() { return stopNativeObserver() },
  })

  function declarationOf(key) {
    const hasSpec = typeof slots.spec === 'function'
    let spec
    let specDynamic
    let epoch
    let snapshot
    let specUnavailable = false
    // A declaration query that throws means the runtime cannot answer, which is
    // not the same claim as "the runtime declares nothing for this key": the
    // first is `unavailable`, the second `missing`, and never the reverse.
    try { if (hasSpec) spec = slots.spec(key) } catch { specUnavailable = true }
    try { if (typeof slots.specDynamic === 'function') specDynamic = slots.specDynamic(key) } catch { specDynamic = undefined }
    try { if (typeof slots.declarationEpoch === 'function') epoch = slots.declarationEpoch(key) } catch { epoch = undefined }
    try { if (typeof slots.snapshot === 'function') snapshot = slots.snapshot(key) } catch { snapshot = undefined }
    const entries = immutableEntries(slots.entries(key))
    let status
    if (specUnavailable) status = 'unavailable'
    else if (hasSpec) status = spec === undefined ? 'missing' : 'declared'
    else if (typeof epoch === 'number') status = epoch > 0 ? 'declared' : 'missing'
    else status = entries.length > 0 ? 'declared' : 'unavailable'
    return Object.freeze({
      key,
      status,
      ...(spec !== undefined ? { spec: frozenClone(spec) } : {}),
      ...(specDynamic !== undefined ? { specDynamic: frozenClone(specDynamic) } : {}),
      ...(epoch !== undefined ? { declarationEpoch: epoch } : {}),
      ...(snapshot !== undefined ? { snapshot: frozenClone(snapshot) } : {}),
      entries,
    })
  }
}

function frozenClone(value) {
  return deepFreeze(cloneEntry(value))
}

export function createDisabledClientSlots(active = true, reason = 'official slots service is unavailable') {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const fail = () => { if (!isActive()) throw new PluginApiInactiveError(); throw new PluginApiFeatureDisabledError(CLIENT_SLOTS_FEATURE, reason) }
  return Object.freeze({ isActive: false, register: fail, inject: fail, entries: fail, inspect: fail, subscribe: fail, dispose() {} })
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

/**
 * Slot admission belongs to the official runtime: the facade only rejects a
 * value that cannot be a slot key at all, and hands every plausible key to the
 * official declaration/registration answer. A maintainer-guessed prefix set
 * must never reject a real slot the official runtime has declared.
 */
function validateKey(key) {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new TypeError(`slot key "${String(key)}" must be a non-empty string`)
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
