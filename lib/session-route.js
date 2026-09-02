/**
 * Host-only committed session-route observation owner.
 *
 * This deliberately observes the public session/event surface only.  It is
 * not a catalog slice and never reads session history or private fields.
 */
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from './errors.js'

function error(code, message) {
  const value = new TypeError(message)
  value.code = code
  return value
}

export function invalidTargetSession() {
  return error('invalid-target-session', 'invalid target session')
}

export function invalidListener() {
  return error('invalid-listener', 'invalid route listener')
}

export function invalidOptions() {
  return error('invalid-options', 'invalid routing wait options')
}

export function disposedTargetSession() {
  return error('target-session-disposed', 'target session was disposed')
}

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function validRoute(provider, model) {
  return typeof provider === 'string' && provider.trim() !== ''
    && typeof model === 'string' && model.trim() !== ''
}

function sameRoute(a, b) {
  return a?.provider === b?.provider && a?.model === b?.model
}

function warn(logger, message) {
  try {
    if (typeof logger?.error === 'function') logger.error(message)
    else logger?.warn?.(message)
  } catch {}
}

function report(logger, seen, category) {
  if (seen.has(category)) return
  seen.add(category)
  warn(logger, `dsh-plugin-api sessionRoute: ${category}`)
}

function isAbortSignal(signal) {
  try {
    if (typeof AbortSignal === 'function' && signal instanceof AbortSignal) return true
  } catch {}
  return false
}

const ROUTE_READ_FAILED = Symbol('route-read-failed')

/**
 * @param {{ sessions: object, eventsApi?: object, ctx?: object, logger?: object,
 *   coreActive?: () => boolean }} options
 */
export function createSessionRouteOwner({ sessions, eventsApi, ctx, logger, coreActive = () => true } = {}) {
  let current = true
  let disposed = false
  const cache = new WeakMap()
  const entries = new Map()
  const bySession = new Map()
  // A disposed identity is quarantined for this owner epoch.  If a broken
  // substrate puts the same object back in its registry, it must not revive
  // the previous cache or observer set.
  const disposedTargets = new WeakSet()
  const diagnostics = new Set()
  const nativeDisposers = []

  function diagnose(category) {
    report(logger, diagnostics, category)
  }

  function targetIdentity(target) {
    if (!isObject(target)) throw invalidTargetSession()
    if (disposedTargets.has(target)) throw invalidTargetSession()
    let id
    try { id = target.id } catch {
      diagnose('routing-live-target-read-failed')
      throw invalidTargetSession()
    }
    if (typeof sessions?.get === 'function') {
      let found
      try { found = sessions.get(id) } catch {
        diagnose('routing-live-target-read-failed')
        throw invalidTargetSession()
      }
      if (found !== target) throw invalidTargetSession()
      return target
    }
    if (typeof sessions?.list === 'function') {
      let list
      try { list = sessions.list() } catch {
        diagnose('routing-live-target-read-failed')
        throw invalidTargetSession()
      }
      if (!Array.isArray(list) || !list.includes(target)) throw invalidTargetSession()
      return target
    }
    diagnose('routing-live-target-read-failed')
    throw invalidTargetSession()
  }

  function contextRoute(session, category = 'routing-current-read-failed') {
    let context
    try {
      if (typeof session?.requestContext !== 'function') return undefined
      context = session.requestContext()
    } catch {
      diagnose(category)
      return ROUTE_READ_FAILED
    }
    try {
      if (!validRoute(context?.provider, context?.model)) return undefined
      return { provider: context.provider, model: context.model }
    } catch {
      diagnose(category)
      return ROUTE_READ_FAILED
    }
  }

  function makeSnapshot(route) {
    return Object.freeze({ provider: route.provider, model: route.model })
  }

  function detachEntry(entry) {
    if (!entry?.attached) return false
    entry.attached = false
    entries.delete(entry.token)
    const set = bySession.get(entry.session)
    set?.delete(entry)
    if (set?.size === 0) bySession.delete(entry.session)
    if (entry.abort && entry.signal) {
      try { entry.signal.removeEventListener('abort', entry.abort) } catch {}
    }
    return true
  }

  function settleWait(entry, route, rejection) {
    if (!entry?.attached) return false
    detachEntry(entry)
    if (rejection) entry.reject(rejection)
    else entry.resolve(route)
    return true
  }

  function disposeSession(session, reason = disposedTargetSession()) {
    if (isObject(session)) {
      disposedTargets.add(session)
      cache.delete(session)
    }
    const set = bySession.get(session)
    if (!set) return false
    for (const entry of [...set]) {
      if (entry.wait) settleWait(entry, undefined, reason)
      else detachEntry(entry)
    }
    return true
  }

  function live(session) {
    try {
      return targetIdentity(session)
    } catch (cause) {
      // An already-observed target that is no longer publicly live is a
      // disposal transition, not merely a failed query.  Detach all exact
      // target entries before rethrowing the synchronous validation error.
      if (isObject(session) && bySession.has(session)) disposeSession(session)
      throw cause
    }
  }

  function proveLiveForDelivery(session) {
    try {
      targetIdentity(session)
      return true
    } catch {
      disposeSession(session)
      return false
    }
  }

  function currentRoute(session) {
    live(session)
    const previous = cache.get(session)
    const route = contextRoute(session)
    if (route === ROUTE_READ_FAILED) return undefined
    if (!route) return previous
    if (previous && sameRoute(previous, route)) return previous
    const snapshot = makeSnapshot(route)
    cache.set(session, snapshot)
    return snapshot
  }

  function addEntry(session, listener, once, wait = false) {
    const token = {}
    const entry = { token, session, listener, once, wait, attached: true }
    entries.set(token, entry)
    let set = bySession.get(session)
    if (!set) bySession.set(session, set = new Set())
    set.add(entry)
    return entry
  }

  function invoke(entry, route, detached = false) {
    if (!current || disposed || (!entry.attached && !detached)) return
    try {
      const result = entry.listener(route)
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).catch(() => report(logger, diagnostics, 'routing-listener-failed'))
      }
    } catch {
      report(logger, diagnostics, 'routing-listener-failed')
    }
  }

  function publish(session, event) {
    let type
    try { type = event?.type } catch { diagnose('routing-observation-invalid'); return }
    if (!current || disposed || type !== 'request/context') return
    let firstLiveSeq
    let sequence
    try { firstLiveSeq = session.firstLiveSeq } catch { diagnose('routing-observation-invalid'); return }
    try { sequence = event.seq } catch { diagnose('routing-observation-invalid'); return }
    if (!Number.isSafeInteger(sequence) || !Number.isSafeInteger(firstLiveSeq) || sequence < firstLiveSeq) {
      diagnose('routing-observation-invalid')
      return
    }
    try { live(session) } catch {
      // A replacement/disposed target must detach pending observers and must
      // never publish a route for an identity that is no longer live.
      disposeSession(session)
      return
    }
    let data
    try { data = event.data } catch { diagnose('routing-observation-invalid'); return }
    let provider
    let model
    try {
      provider = data?.provider
      model = data?.model
      if (!validRoute(provider, model)) throw new Error('invalid route')
    } catch {
      diagnose('routing-observation-invalid')
      return
    }
    const corroborated = contextRoute(session, 'routing-observation-invalid')
    let matches = false
    try {
      matches = corroborated !== ROUTE_READ_FAILED && Boolean(corroborated)
        && corroborated.provider === provider && corroborated.model === model
    } catch {}
    if (!matches) {
      diagnose('routing-observation-invalid')
      return
    }
    const previous = cache.get(session)
    const route = { provider, model }
    if (previous && sameRoute(previous, route)) return
    const snapshot = previous && sameRoute(previous, route) ? previous : makeSnapshot(route)
    cache.set(session, snapshot)
    const set = bySession.get(session)
    if (!set) return
    for (const entry of [...set]) {
      if (!entry.attached || entry.session !== session) continue
      // Re-prove liveness immediately before every callback or wait settle.
      // A prior listener may synchronously replace/dispose this identity.
      if (!proveLiveForDelivery(session)) break
      const wasOnce = entry.once
      if (wasOnce) detachEntry(entry)
      if (entry.wait) settleWait(entry, snapshot)
      else invoke(entry, snapshot, wasOnce)
    }
  }

  function addNative(name, listener) {
    let disposer
    if (typeof eventsApi?.observe === 'function') {
      const feed = eventsApi.observe(name)
      feed.subscribe((payload) => {
        const args = Array.isArray(payload) ? payload : [payload]
        listener(...args)
      })
      disposer = () => {
        try {
          feed.dispose()
        } catch {
          // native release is best-effort
        }
        return true
      }
    } else if (typeof ctx?.on === 'function') {
      disposer = ctx.on(name, listener)
    }
    if (typeof disposer !== 'function') throw new TypeError('sessionRoute requires an event registration surface')
    nativeDisposers.push(disposer)
  }

  function assertAvailable() {
    let active = false
    try { active = Boolean(coreActive()) } catch {}
    if (!active) throw new PluginApiInactiveError()
    if (!current || disposed) throw new PluginApiFeatureDisabledError('llm.routing')
  }

  try {
    addNative('session/event', publish)
    addNative('session/disposed', (session) => disposeSession(session))
  } catch (cause) {
    for (const disposer of nativeDisposers.splice(0)) {
      try { disposer() } catch {}
    }
    throw cause
  }

  const api = {
    current(session) {
      assertAvailable()
      return currentRoute(session)
    },
    on(session, listener) {
      assertAvailable()
      live(session)
      if (typeof listener !== 'function') throw invalidListener()
      const entry = addEntry(session, listener, false)
      return () => detachEntry(entry)
    },
    once(session, listener) {
      assertAvailable()
      live(session)
      if (typeof listener !== 'function') throw invalidListener()
      const entry = addEntry(session, listener, true)
      return () => detachEntry(entry)
    },
    wait(session, options) {
      assertAvailable()
      if (options !== undefined && (options === null || typeof options !== 'object')) throw invalidOptions()
      let signal
      try { signal = options?.signal } catch { throw invalidOptions() }
      if (signal !== undefined && !isAbortSignal(signal)) throw invalidOptions()
      live(session)
      if (signal?.aborted) return Promise.reject(signal.reason)
      const existing = currentRoute(session)
      if (existing) {
        // Keep the current-read winner over a later abort, but re-prove the
        // target and epoch at the actual promise settlement boundary.
        return new Promise((resolve, reject) => {
          queueMicrotask(() => {
            if (!current || disposed) {
              let coreIsActive = false
              try { coreIsActive = Boolean(coreActive()) } catch {}
              reject(coreIsActive
                ? new PluginApiFeatureDisabledError('llm.routing')
                : new PluginApiInactiveError())
              return
            }
            if (!proveLiveForDelivery(session)) {
              reject(disposedTargetSession())
              return
            }
            resolve(existing)
          })
        })
      }
      return new Promise((resolve, reject) => {
        const entry = addEntry(session, null, false, true)
        entry.resolve = resolve
        entry.reject = reject
        entry.signal = signal
        if (signal) {
          entry.abort = () => settleWait(entry, undefined, signal.reason)
          try { signal.addEventListener('abort', entry.abort, { once: true }) } catch {
            settleWait(entry, undefined, invalidOptions())
            return
          }
          if (signal.aborted) entry.abort()
        }
      })
    },
    dispose() {
      if (!current) return false
      current = false
      disposed = true
      let coreIsActive = false
      try { coreIsActive = Boolean(coreActive()) } catch {}
      const reason = coreIsActive ? new PluginApiFeatureDisabledError('llm.routing') : new PluginApiInactiveError()
      for (const entry of [...entries.values()]) {
        if (entry.wait) settleWait(entry, undefined, reason)
        else detachEntry(entry)
      }
      for (const disposer of nativeDisposers.splice(0)) {
        try { disposer() } catch { warn(logger, 'dsh-plugin-api sessionRoute: native disposer failed') }
      }
      return true
    },
  }

  return { api, dispose: api.dispose }
}
