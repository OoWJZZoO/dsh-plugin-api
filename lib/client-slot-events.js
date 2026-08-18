import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const CLIENT_SLOT_EVENTS_FEATURE = 'clientSlotEvents'

export function createClientSlotEvents({ ctx, active = true, logger } = {}) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  if (typeof ctx?.on !== 'function') return createDisabledClientSlotEvents(isActive)
  const disposers = new Set()
  const on = (event, listener) => {
    if (!isActive()) throw new PluginApiInactiveError()
    if (event !== 'slots/changed' || typeof listener !== 'function') throw new TypeError('client slot event must be slots/changed with a listener')
    const nativeDispose = ctx.on('slots/changed', (key) => {
      try { listener(key) } catch { try { logger?.error?.('dsh-plugin-api client slots/changed listener failed') } catch {} }
    })
    if (typeof nativeDispose !== 'function') throw new TypeError('official ctx.on did not return a disposer')
    const record = { nativeDispose, disposed: false }
    disposers.add(record)
    return () => {
      if (record.disposed) return false
      record.disposed = true
      disposers.delete(record)
      const result = nativeDispose()
      return result === undefined ? true : result
    }
  }
  return Object.freeze({ isActive: true, on, dispose() {
    for (const record of [...disposers]) {
      record.disposed = true
      disposers.delete(record)
      try { record.nativeDispose() } catch { try { logger?.error?.('dsh-plugin-api client slots event cleanup failed') } catch {} }
    }
  } })
}

export function createDisabledClientSlotEvents(active = true, reason = 'official slots event source is unavailable') {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const fail = () => { if (!isActive()) throw new PluginApiInactiveError(); throw new PluginApiFeatureDisabledError(CLIENT_SLOT_EVENTS_FEATURE, reason) }
  return Object.freeze({ isActive: false, on: fail, dispose() {} })
}
