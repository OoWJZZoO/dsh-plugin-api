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
 *
 * The observer records tracked here are hub-private bookkeeping: the caller
 * only ever receives the frozen projection handle built by the shared kernel
 * (`{ current, subscribe, dispose, epoch }`), never the mutable record.
 */
import { createObserverHandle } from './contract-kernel.js'

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
    if (observer.stale || !observer.live()) return
    const fallback = deepFreezeFallback()
    let payload
    try {
      payload = renderFor(sessionId, fallback)
    } catch {
      payload = fallback
    }
    observer.publish(payload)
  }

  /**
   * Subscribe to one session's activity projection.
   *
   * @param {{ sessionId: string, owner?: unknown, signal?: AbortSignal }} [options]
   * @returns {Readonly<{ current: () => object, subscribe: (listener: Function) => Function,
   *   dispose: () => object, epoch: string }>} the frozen projection handle;
   *   subscribing after release is a no-op and its `dispose()` answers the
   *   shared discriminated result.
   */
  function observe(options = {}) {
    const opts = isObject(options) ? options : {}
    if (!isNonEmptyString(opts.sessionId)) {
      // an observer without a session is not a supported shape; refuse with a
      // typed invalid-input error without corrupting any other subscription
      throw new TypeError('observe requires a sessionId')
    }
    const sessionId = opts.sessionId
    const ownerId = opts.owner !== undefined ? String(opts.owner) : undefined
    // Hub-private record: the mutable fields never leave this closure.
    const record = {
      epoch: `epoch:${++epochSeq}`,
      sessionId,
      ownerId,
      stale: false,
      publish: () => {},
      live: () => false,
      dispose: () => {},
    }
    let abortHandler = null
    const detachAbort = () => {
      if (!record.signal || !abortHandler) return
      try {
        record.signal.removeEventListener('abort', abortHandler)
      } catch {
        // best-effort detach
      }
      abortHandler = null
    }
    const created = createObserverHandle({
      epoch: record.epoch,
      current: (live) => (live && !record.stale ? renderFor(sessionId, deepFreezeFallback()) : deepFreezeFallback()),
      onDispose: () => {
        record.stale = true
        observers.delete(record)
        detachAbort()
      },
      // A listener that throws (or rejects) only degrades that listener; the
      // kernel reports the failure here and the hub never rethrows it.
      reportError: () => {},
    })
    record.publish = created.publish
    record.live = created.live
    record.dispose = created.handle.dispose
    if (opts.signal) {
      record.signal = opts.signal
      abortHandler = () => created.handle.dispose()
      try {
        opts.signal.addEventListener('abort', abortHandler, { once: true })
      } catch {
        // an invalid signal only degrades this observer
      }
    }
    observers.add(record)
    return created.handle
  }

  function notify(sessionId) {
    for (const observer of [...observers]) {
      if (observer.stale || !observer.live()) continue
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
      observer.dispose()
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