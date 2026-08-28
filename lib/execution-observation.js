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

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

/**
 * @param {{ ctx: object, logger?: object }} [options]
 * @returns {{ api: object, dispose: () => boolean, availability: Record<string,string> }}
 */
export function createExecutionObservation({ ctx, logger } = {}) {
  const reducer = createExecutionReducer()
  const historyQuery = createExecutionHistory({ reducer })
  const visibility = createExecutionVisibility()
  const observers = new Set()
  const changeListeners = new Set()
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
    for (const observer of observers) {
      let next
      try {
        next = snapshotsFor(observer)
      } catch {
        next = deepFreeze([])
      }
      for (const listener of [...observer.listeners]) {
        try {
          listener(next)
        } catch {
          // observer listener failures are contained
        }
      }
    }
    if (snapshot !== undefined) {
      for (const listener of [...changeListeners]) {
        try {
          listener(snapshot)
        } catch {
          // change listener failures are contained
        }
      }
    }
  }

  function observe(options = {}) {
    const opts = isObject(options) ? options : {}
    const observer = {
      epoch: `epoch:${++epochSeq}`,
      sessionId: opts.sessionId,
      since: opts.since,
      listeners: new Set(),
      disposed: false,
      abortHandler: null,
      signal: opts.signal,
    }
    observer.current = () => snapshotsFor(observer)
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
        observer.signal.addEventListener('abort', observer.abortHandler, { once: true })
      } catch {
        // an invalid signal only degrades this observer
      }
    }
    observers.add(observer)
    return observer
  }

  function get(executionId, { audience = 'ui' } = {}) {
    if (disposed) return undefined
    const raw = reducerView.get(executionId)
    return raw ? redacted(raw, audience) : undefined
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

  function onChange(listener) {
    if (typeof listener !== 'function') throw new TypeError('onChange listener must be a function')
    changeListeners.add(listener)
    let active = true
    return () => {
      if (!active) return false
      active = false
      return changeListeners.delete(listener)
    }
  }

  const api = Object.freeze({
    observe,
    get,
    history,
    onChange,
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
    changeListeners.clear()
    return true
  }

  return { api, dispose, availability: sources.availability }
}
