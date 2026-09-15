import { createObserverHandle } from './contract-kernel.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const CLIENT_SLOT_EVENTS_FEATURE = 'clientSlotEvents'

/** The single slot change channel the official browser runtime dispatches. */
const SLOT_CHANGED_EVENT = 'slots/changed'

export function createClientSlotEvents({ ctx, active = true, logger, epoch } = {}) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const epochOf = typeof epoch === 'function' ? epoch : () => (typeof epoch === 'number' ? epoch : 0)
  if (typeof ctx?.on !== 'function') return createDisabledClientSlotEvents(isActive)
  const disposers = new Set()
  const on = (event, listener) => {
    if (!isActive()) throw new PluginApiInactiveError()
    if (event !== SLOT_CHANGED_EVENT || typeof listener !== 'function') throw new TypeError('client slot event must be slots/changed with a listener')
    const nativeDispose = ctx.on(SLOT_CHANGED_EVENT, (key) => {
      let result
      try { result = listener(key) } catch { try { logger?.error?.('dsh-plugin-api client slots/changed listener failed') } catch {}; return }
      try {
        if (result && typeof result.then === 'function') {
          Promise.resolve(result).catch(() => { try { logger?.error?.('dsh-plugin-api client slots/changed listener rejected') } catch {} })
        }
      } catch { try { logger?.error?.('dsh-plugin-api client slots/changed listener rejected') } catch {} }
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
  /**
   * Standard observation handle for the slot change channel.
   *
   * The subscription entry of this namespace answers `{ current(),
   * subscribe(listener), dispose(), epoch }` rather than a bare unsubscribe
   * function: `current()` is the most recent changed key (a real read face, not
   * a fabricated empty view), `subscribe` registers one listener, and the
   * native source is bound for the handle's lifetime.
   */
  const observe = (event) => {
    if (!isActive()) throw new PluginApiInactiveError()
    if (event !== SLOT_CHANGED_EVENT) throw new TypeError('client slot event must be slots/changed')
    let lastKey
    let release = () => {}
    const created = createObserverHandle({
      epoch: epochOf(),
      current: (live) => (live ? lastKey : undefined),
      onDispose: () => release(),
      reportError: () => { try { logger?.error?.('dsh-plugin-api client slots/changed observer failed') } catch {} },
    })
    release = on(SLOT_CHANGED_EVENT, (key) => {
      lastKey = key
      created.publish(key)
    })
    return created.handle
  }

  return Object.freeze({ isActive: true, on, observe, dispose() {
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
  return Object.freeze({ isActive: false, on: fail, observe: fail, dispose() {} })
}
