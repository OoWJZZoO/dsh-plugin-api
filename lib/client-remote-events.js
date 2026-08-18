import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const CLIENT_REMOTE_EVENTS_FEATURE = 'clientRemoteEvents'

export const FORWARDED_REMOTE_EVENTS = Object.freeze([
  'agent-preset/selected', 'commands/change', 'credentials/updated',
  'cordis/request-run', 'cordis/request-run-resolved', 'cordis/dynamic-package',
  'cordis/dynamic-retract', 'cordis/inspect-query', 'cordis/inspect-query-resolved',
  'llm/adapters-updated', 'settings/document-updated',
])

const allowed = new Set(FORWARDED_REMOTE_EVENTS)

export function createClientRemoteEvents({ active = true, logger } = {}) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const listeners = new Map()
  const on = (event, listener) => {
    assertActive(isActive)
    if (!allowed.has(event)) throw new TypeError(`remote event "${String(event)}" is not forwarded by the official gateway allowlist`)
    if (typeof listener !== 'function') throw new TypeError('remote event listener must be a function')
    const list = listeners.get(event) ?? []
    listeners.set(event, list)
    const record = { listener, disposed: false }
    list.push(record)
    return () => {
      if (record.disposed) return false
      record.disposed = true
      const current = listeners.get(event)
      if (!current) return false
      const index = current.indexOf(record)
      if (index < 0) return false
      current.splice(index, 1)
      if (current.length === 0) listeners.delete(event)
      return true
    }
  }
  const dispatch = (event, args) => {
    if (!allowed.has(event) || !Array.isArray(args)) return
    for (const record of [...(listeners.get(event) ?? [])]) {
      if (record.disposed) continue
      try {
        record.listener(...args)
      } catch {
        report(logger, `dsh-plugin-api client remote event listener failed for "${event}"`)
      }
    }
  }
  return Object.freeze({ isActive: true, $on: on, $dispatch: dispatch, dispose() { listeners.clear() } })
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
