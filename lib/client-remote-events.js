import { createObserverHandle } from './contract-kernel.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

export const CLIENT_REMOTE_EVENTS_FEATURE = 'clientRemoteEvents'

export const FORWARDED_REMOTE_EVENTS = Object.freeze([
  'agent-preset/selected', 'commands/change', 'credentials/updated',
  'cordis/request-run', 'cordis/request-run-resolved', 'cordis/dynamic-package',
  'cordis/dynamic-retract', 'cordis/inspect-query', 'cordis/inspect-query-resolved',
  'llm/adapters-updated', 'settings/document-updated',
])

const allowed = new Set(FORWARDED_REMOTE_EVENTS)

export function createClientRemoteEvents({ ctx, remote, active = true, logger, epoch } = {}) {
  const isActive = typeof active === 'function' ? active : () => Boolean(active)
  const epochOf = typeof epoch === 'function' ? epoch : () => (typeof epoch === 'number' ? epoch : 0)
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
  /**
   * Dispatch is the carrier variant of the operation idiom: it has no
   * independent operation identity, is never retried, and answers a
   * discriminated result so containment is expressible — the official outcome
   * rides `outcome` and a refusing carrier is reported rather than thrown.
   * This is only the official host-frame carrier; the gateway owns dispatch
   * eligibility and listener iteration, and consumers subscribe through
   * `observe`.
   */
  const dispatch = (event, args) => {
    if (!Array.isArray(args)) throw new TypeError('remote event carrier arguments must be an array')
    assertActive(isActive)
    try {
      const outcome = remote.$dispatch(event, args)
      return outcome === undefined
        ? Object.freeze({ ok: true, code: 'dispatched' })
        : Object.freeze({ ok: true, code: 'dispatched', outcome })
    } catch (error) {
      return Object.freeze({ ok: false, code: 'error', reason: error instanceof Error ? error.message : String(error) })
    }
  }
  /**
   * Standard observation handle for one forwarded remote event.
   *
   * The subscription entry answers `{ current(), subscribe(listener),
   * dispose(), epoch }` instead of a bare unsubscribe function: `current()` is
   * the most recent delivered payload, `subscribe` registers one listener, and
   * the official channel is bound for the handle's lifetime. The forwarded
   * allowlist still decides admission, so an event the gateway does not forward
   * is refused rather than silently subscribed.
   */
  const observe = (event) => {
    assertActive(isActive)
    if (!allowed.has(event)) throw new TypeError(`remote event "${String(event)}" is not forwarded by the official gateway allowlist`)
    let last
    let release = () => {}
    const created = createObserverHandle({
      epoch: epochOf(),
      current: (live) => (live ? last : undefined),
      onDispose: () => release(),
      reportError: () => report(logger, `dsh-plugin-api client remote observer failed for "${event}"`),
    })
    release = on(event, (...args) => {
      // Forwarded events carry one payload; a multi-argument delivery is
      // published as the argument tuple so no part of it is dropped.
      const payload = args.length === 1 ? args[0] : args
      last = payload
      created.publish(payload)
    })
    return created.handle
  }
  return Object.freeze({ isActive: true, on, observe, dispatch, dispose() {
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
  // A missing carrier refuses dispatch with the typed state rather than
  // silently swallowing a frame the caller believes it sent.
  return Object.freeze({ isActive: false, on: fail, observe: fail, dispatch: fail, dispose() {} })
}

function assertActive(isActive) {
  if (!isActive()) throw new PluginApiInactiveError()
}

function report(logger, message) {
  try { logger?.error?.(message) } catch {}
}
