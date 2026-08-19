import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const CLIENT_REMOTE_EVENTS_FEATURE = 'clientRemoteEvents'

export const FORWARDED_REMOTE_EVENTS = Object.freeze([
  'agent-preset/selected', 'commands/change', 'credentials/updated',
  'cordis/request-run', 'cordis/request-run-resolved', 'cordis/dynamic-package',
  'cordis/dynamic-retract', 'cordis/inspect-query', 'cordis/inspect-query-resolved',
  'llm/adapters-updated', 'settings/document-updated',
])

const allowed = new Set(FORWARDED_REMOTE_EVENTS)

export function createClientRemoteEvents({ ctx, remote, active = true, logger } = {}) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  if (remote === undefined) {
    try { remote = typeof ctx?.get === 'function' ? ctx.get('remote') : ctx?.remote } catch { remote = undefined }
  }
  if (!remote || typeof remote.$on !== 'function' || typeof remote.$dispatch !== 'function') {
    return createDisabledClientRemoteEvents(isActive)
  }
  const disposers = new Set()
  const on = (event, listener) => {
    assertActive(isActive)
    if (!allowed.has(event)) throw new TypeError(`remote event "${String(event)}" is not forwarded by the official gateway allowlist`)
    if (typeof listener !== 'function') throw new TypeError('remote event listener must be a function')
    const officialDispose = remote.$on(event, (...args) => {
      let result
      try { result = listener(...args) } catch { report(logger, `dsh-plugin-api client remote event listener failed for "${event}"`); return }
      try {
        if (result && typeof result.then === 'function') {
          Promise.resolve(result).catch(() => report(logger, `dsh-plugin-api client remote event listener rejected for "${event}"`))
        }
      } catch { report(logger, `dsh-plugin-api client remote event listener rejected for "${event}"`) }
    })
    if (typeof officialDispose !== 'function') throw new TypeError('official remote.$on did not return a disposer')
    const record = { disposed: false, officialDispose }
    disposers.add(record)
    return () => {
      if (record.disposed) return false
      record.disposed = true
      disposers.delete(record)
      const result = officialDispose()
      return result === undefined ? true : result
    }
  }
  const dispatch = (event, args) => {
    if (!Array.isArray(args)) throw new TypeError('remote event carrier arguments must be an array')
    // This is only the official host-frame carrier. The gateway owns dispatch
    // eligibility and listener iteration; consumers subscribe through $on.
    return remote.$dispatch(event, args)
  }
  return Object.freeze({ isActive: true, $on: on, $dispatch: dispatch, dispose() {
    for (const record of [...disposers]) {
      record.disposed = true
      disposers.delete(record)
      try { record.officialDispose() } catch { report(logger, 'dsh-plugin-api client remote event cleanup failed') }
    }
  } })
}

export function createDisabledClientRemoteEvents(active = true, reason = 'official remote event bridge is unavailable') {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const fail = () => {
    if (!isActive()) throw new PluginApiInactiveError()
    throw new PluginApiFeatureDisabledError(CLIENT_REMOTE_EVENTS_FEATURE, reason)
  }
  return Object.freeze({ isActive: false, $on: fail, $dispatch() {}, dispose() {} })
}

function assertActive(isActive) {
  if (!isActive()) throw new PluginApiInactiveError()
}

function report(logger, message) {
  try { logger?.error?.(message) } catch {}
}
