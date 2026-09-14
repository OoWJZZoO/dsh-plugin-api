/**
 * Facade assembly for the read-only execution observation surface.
 *
 * This module wires the pure reducer, the four source adapters, the bounded
 * session history and the visibility face into the public `pluginApi.executions`
 * projection surface. The projection is authoritative only on the host; it
 * never creates, settles, retries or mutates an execution, and it never throws
 * through apply.
 */
import { createExecutionReducer } from './execution-observation-reducer.js'
import { createExecutionSources } from './execution-observation-sources.js'
import { createExecutionHistory } from './execution-observation-history.js'
import { createExecutionVisibility } from './execution-visibility.js'
import { deepFreeze } from './deep-freeze.js'
import { createObserverHandle } from './contract-kernel.js'

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

/** Absence vocabulary: a definitely-absent target answers `missing`. */
const MISSING_EXECUTION = deepFreeze({
  ok: false,
  code: 'missing',
  reason: 'the execution projection has no such execution',
})

/** Absence vocabulary: existence cannot be determined once the projection is gone. */
const UNAVAILABLE_VIEW = deepFreeze({
  ok: false,
  code: 'unavailable',
  reason: 'the execution projection is disposed',
})

/**
 * @param {{ ctx: object, logger?: object }} [options]
 * @returns {{ api: object, dispose: () => boolean, availability: Record<string,string> }}
 */
export function createExecutionObservation({ ctx, logger } = {}) {
  const reducer = createExecutionReducer()
  const historyQuery = createExecutionHistory({ reducer })
  const visibility = createExecutionVisibility()
  const observers = new Set()
  let epochSeq = 0
  let disposed = false

  const reducerView = {
    ingest(fragment) {
      const result = reducer.ingest(fragment)
      if (result?.executionId) notify(result.executionId)
      return result
    },
    get: (id) => reducer.get(id),
    sessionHistory: (sessionId) => reducer.sessionHistory(sessionId),
    allHistory: () => reducer.allHistory(),
    get size() {
      return reducer.size
    },
  }
  const sources = createExecutionSources({ ctx, reducer: reducerView, logger })
  const hostAvailability = Object.freeze({ ...sources.availability })

  function redacted(projection, audience) {
    try {
      return visibility.redact(projection, { audience })
    } catch {
      return deepFreeze({ redacted: true })
    }
  }

  function snapshotsFor(observer) {
    let items = reducerView.allHistory()
    if (observer.sessionId !== undefined) {
      items = reducerView.sessionHistory(observer.sessionId)
    }
    if (observer.since !== undefined) {
      items = items.filter((entry) => entry.start.observedAt >= observer.since)
    }
    return deepFreeze(items.map((entry) => redacted(entry, 'ui')))
  }

  function notify(executionId) {
    let snapshot
    try {
      const raw = reducerView.get(executionId)
      snapshot = raw ? redacted(raw, 'ui') : undefined
    } catch {
      snapshot = undefined
    }
    for (const observer of [...observers]) {
      if (!observer.live()) continue
      let next
      try {
        next = snapshotsFor(observer)
      } catch {
        next = deepFreeze([])
      }
      observer.publish(next)
    }
  }

  /**
   * Subscribe to the read-only execution projection.
   *
   * @param {{ sessionId?: string, since?: string, signal?: AbortSignal }} [options]
   * @returns {Readonly<{ current: () => object, subscribe: (listener: Function) => Function,
   *   dispose: () => object, epoch: string }>} the frozen projection handle;
   *   subscribing after release is a no-op and its `dispose()` answers the
   *   shared discriminated result.
   */
  function observe(options = {}) {
    const opts = isObject(options) ? options : {}
    // Owner-private record: the mutable fields never leave this closure.
    const record = {
      epoch: `epoch:${++epochSeq}`,
      sessionId: opts.sessionId,
      since: opts.since,
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
      current: (live) => {
        if (!live) return deepFreeze([])
        try {
          return snapshotsFor(record)
        } catch {
          return deepFreeze([])
        }
      },
      onDispose: () => {
        observers.delete(record)
        detachAbort()
      },
      // A listener that throws (or rejects) only degrades that listener.
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

  /**
   * Read one execution projection.
   *
   * The successful view stays a frozen read-only projection; a target the
   * projection has never observed answers the typed absence code, and a
   * disposed projection answers `unavailable` because existence can no longer
   * be determined.
   */
  function get(executionId, { audience = 'ui' } = {}) {
    if (disposed) return UNAVAILABLE_VIEW
    const raw = reducerView.get(executionId)
    return raw ? redacted(raw, audience) : MISSING_EXECUTION
  }

  function history(sessionId, options = {}) {
    if (disposed) return { items: [], truncated: false, nextCursor: undefined, unavailable: [] }
    const page = historyQuery.query(sessionId, options)
    const audience = options?.audience ?? 'ui'
    return deepFreeze({
      ...page,
      items: deepFreeze(page.items.map((entry) => redacted(entry, audience))),
    })
  }

  const api = Object.freeze({
    observe,
    get,
    history,
    visibility: Object.freeze({
      register: (spec) => visibility.register(spec),
    }),
    get availability() {
      const liveEpoch = `epoch:${epochSeq}`
      return Object.freeze({ sources: { ...hostAvailability }, epoch: liveEpoch })
    },
  })

  const dispose = () => {
    if (disposed) return false
    disposed = true
    try {
      sources.dispose()
    } catch {
      // disposal never escapes the fail-safe path
    }
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

  return { api, dispose, availability: sources.availability }
}
