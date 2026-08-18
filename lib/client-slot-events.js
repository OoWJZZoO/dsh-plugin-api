import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const CLIENT_SLOT_EVENTS_FEATURE = 'clientSlotEvents'

export function createClientSlotEvents({ active = true, logger } = {}) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const listeners = []
  const on = (event, listener) => {
    if (!isActive()) throw new PluginApiInactiveError()
    if (event !== 'slots/changed' || typeof listener !== 'function') throw new TypeError('client slot event must be slots/changed with a listener')
    const record = { listener, disposed: false }
    listeners.push(record)
    return () => {
      if (record.disposed) return false
      record.disposed = true
      const index = listeners.indexOf(record)
      if (index >= 0) listeners.splice(index, 1)
      return index >= 0
    }
  }
  const emitChanged = (key) => {
    for (const record of [...listeners]) if (!record.disposed) {
      try { record.listener(key) } catch { try { logger?.error?.('dsh-plugin-api client slots/changed listener failed') } catch {} }
    }
  }
  return Object.freeze({ isActive: true, on, emitChanged, dispose() { listeners.length = 0 } })
}

export function createDisabledClientSlotEvents(active = true, reason = 'official slots event source is unavailable') {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const fail = () => { if (!isActive()) throw new PluginApiInactiveError(); throw new PluginApiFeatureDisabledError(CLIENT_SLOT_EVENTS_FEATURE, reason) }
  return Object.freeze({ isActive: false, on: fail, emitChanged() {}, dispose() {} })
}
