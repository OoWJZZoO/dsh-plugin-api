/**
 * Epoch-local observer hub for the session activity projection.
 *
 * Handle shape: `{ current(), subscribe(listener), dispose(), epoch }`.
 * Subscriptions are additive and independent; registration order never
 * encodes business semantics. Delivery follows the projection's stable seq
 * order because renders are invoked synchronously after each store change
 * (single-threaded, ordered).
 *
 * Containment and ownership:
 * - listener exceptions are contained per listener;
 * - dispose is idempotent and a stale disposer never removes another
 *   observer or a rebuilt epoch's observer;
 * - epoch rollover invalidates every old observer: old-epoch callbacks are
 *   never delivered on the new epoch and never mutate the current view;
 * - `cleanupOwner(ownerId)` removes only that owner's observers (plugin
 *   dispose / reload / owner context end), never affecting others.
 */
function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Create the epoch-local observer hub.
 *
 * @param {{ store: object, render?: (sessionId: string) => object }} options
 */
export function createSessionActivityObserverHub({ store, render } = {}) {
  const observers = new Set()
  let epochSeq = 0
  let disposed = false

  function renderFor(sessionId, fallback) {
    if (typeof render === 'function') {
      try {
        const snapshot = render(sessionId)
        return snapshot === undefined ? fallback : snapshot
      } catch {
        return fallback
      }
    }
    return fallback
  }

function deliver(observer, sessionId) {
  if (observer.disposed || observer.stale) return
  const fallback = deepFreezeFallback()
  let payload
  try {
    payload = renderFor(sessionId, fallback)
  } catch {
    payload = fallback
  }
  for (const listener of [...observer.listeners]) {
    try {
      listener(payload)
    } catch {
      // listener failures are contained per observer
    }
  }
}

function observe(options = {}) {
  const opts = isObject(options) ? options : {}
  if (!isNonEmptyString(opts.sessionId)) {
    // an observer without a session is not a supported shape; refuse with a
    // typed invalid-input error without corrupting any other subscription
    throw new TypeError('observe requires a sessionId')
  }
  const observer = {
    epoch: `epoch:${++epochSeq}`,
    sessionId: opts.sessionId,
    ownerId: opts.owner !== undefined ? String(opts.owner) : undefined,
    listeners: new Set(),
    disposed: false,
    stale: false,
    signal: opts.signal,
    abortHandler: null,
  }
  observer.current = () => {
    if (observer.disposed || observer.stale) return deepFreezeFallback()
    return renderFor(observer.sessionId, deepFreezeFallback())
  }
    observer.subscribe = (listener) => {
      if (observer.disposed) throw new TypeError('observer is disposed')
      if (typeof listener !== 'function') throw new TypeError('observer listener must be a function')
      observer.listeners.add(listener)
      let active = true
      return () => {
        if (!active) return false
        active = false
        return observer.listeners.delete(listener)
      }
    }
    observer.dispose = () => {
      if (observer.disposed) return false
      observer.disposed = true
      observers.delete(observer)
      if (observer.signal && observer.abortHandler) {
        try {
          observer.signal.removeEventListener('abort', observer.abortHandler)
        } catch {
          // best-effort detach
        }
      }
      return true
    }
    if (opts.signal) {
      observer.abortHandler = () => observer.dispose()
      try {
        opts.signal.addEventListener('abort', observer.abortHandler, { once: true })
      } catch {
        // an invalid signal only degrades this observer
      }
    }
    observers.add(observer)
    return observer
  }

  function notify(sessionId) {
    for (const observer of [...observers]) {
      if (observer.disposed || observer.stale) continue
      if (observer.sessionId !== undefined && observer.sessionId !== sessionId) continue
      deliver(observer, sessionId)
    }
  }

  /** Remove only the observers owned by `ownerId`; returns the count removed. */
  function cleanupOwner(ownerId) {
    if (ownerId === undefined) return 0
    const key = String(ownerId)
    let removed = 0
    for (const observer of [...observers]) {
      if (observer.ownerId === key) {
        observer.dispose()
        removed += 1
      }
    }
    return removed
  }

  /** Epoch rollover: invalidate every old observer; new handles get a new epoch. */
  function rollEpoch() {
    epochSeq += 1
    for (const observer of [...observers]) {
      observer.stale = true
    }
    observers.clear()
    return epochSeq
  }

  const dispose = () => {
    if (disposed) return false
    disposed = true
    for (const observer of [...observers]) {
      try {
        observer.dispose()
      } catch {
        // observer disposal is best-effort
      }
    }
    observers.clear()
    return true
  }

  return {
    observe,
    notify,
    cleanupOwner,
    rollEpoch,
    dispose,
    get epoch() {
      return epochSeq
    },
    get size() {
      return observers.size
    },
  }
}

function deepFreezeFallback() {
  return Object.freeze({ snapshot: undefined, sessionQueue: null, gap: null, unavailable: [] })
}