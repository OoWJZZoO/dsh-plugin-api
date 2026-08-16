/**
 * pluginApi.events — stabilized typed event bus over the Cordis context.
 *
 * This module is host-side only. It keeps an ordered registry of facade
 * listeners per cataloged event and re-registers them as native Cordis hooks
 * so the official dispatch modes (emit/serial/parallel/bail/waterfall) are
 * preserved exactly. Non-cataloged event names are passed through to `ctx`
 * as untyped, unsupported subscriptions.
 */
import { carrierKeyOf } from '@deepseek-ai/dsh-scope'
import { freezeByPolicy } from './deep-freeze.js'
import { PluginApiEventPriorityError } from './errors.js'

export const EVENT_PRIORITIES = Object.freeze(['lowest', 'low', 'normal', 'high', 'highest', 'monitor'])

let nextEntryId = 1

function priorityIndex(priority) {
  return EVENT_PRIORITIES.indexOf(priority)
}

function sortEntries(entries) {
  entries.sort((a, b) => priorityIndex(a.priority) - priorityIndex(b.priority) || a.order - b.order)
}

function createState() {
  const states = new Map()

  const stateOf = (name) => {
    let state = states.get(name)
    if (!state) {
      state = { entries: [], hooks: [] }
      states.set(name, state)
    }
    return state
  }

  const removeEntry = (state, entry) => {
    const index = state.entries.findIndex((candidate) => candidate.id === entry.id)
    if (index >= 0) state.entries.splice(index, 1)
    return index >= 0
  }

  return { states, stateOf, removeEntry }
}

/**
 * @param {object} options
 * @param {object} options.ctx - Cordis-like context with on/once/emit/serial/parallel/bail/waterfall
 * @param {object} options.catalog - frozen event catalog
 * @param {{ warn: (message: string) => void, error?: (message: string) => void }} [options.logger]
 */
export function createEventsBus({ ctx, catalog, logger = { warn() {}, error() {} } } = {}) {
  const { states, stateOf, removeEntry } = createState()
  const catalogEntryOf = (name) => catalog[name]

  /**
   * Re-register all facade hooks for one cataloged event in entry order.
   * Any previously installed facade hooks for that event are disposed first.
   */
  function reconcile(name) {
    const state = stateOf(name)

    for (const dispose of state.hooks.splice(0)) {
      try {
        dispose()
      } catch {
        // disposal must never break subscription management
      }
    }

    const installed = []
    try {
      for (const entry of state.entries) {
        const wrapped = createWrappedListener(entry)
        const dispose = ctx.on(name, wrapped, {})
        installed.push(dispose)
      }
    } catch (error) {
      for (const dispose of installed.splice(0)) {
        try {
          dispose()
        } catch {
          // rollback disposal is best-effort
        }
      }
      throw error
    }

    state.hooks = installed
  }

  /**
   * Create the Cordis hook for one facade listener entry.
   *
   * The wrapper is a regular function (not an arrow) so `this` stays bound to
   * the dispatch `thisArg` (the scope carrier for scope-filtered events).
   *
   * Actual dispatch mode is inferred from the trailing `next` function
   * (waterfall) vs. its absence (emit/bail/serial/parallel), so one hook works
   * in every Cordis dispatch mode.
   */
  function createWrappedListener(entry) {
    const meta = catalogEntryOf(entry.name)

    return function wrapped(...args) {
      if (entry.once) {
        const state = stateOf(entry.name)
        removeEntry(state, entry)
        reconcile(entry.name)
      }

      for (const arg of args) freezeByPolicy(arg, meta.freeze)

      const maybeNext = args[args.length - 1]
      const isWaterfall = typeof maybeNext === 'function'

      // Scope gate: only for scope-filtered catalog events with opts.scope set.
      if (entry.scope !== undefined && meta.scopeFiltered) {
        const subject = meta.scopeKey === 'args[0].agent'
          ? args[0]?.agent
          : meta.scopeKey === 'args[1].scope'
            ? args[1]?.scope
            : meta.scopeKey === null
              ? carrierKeyOf(this)
              : undefined
        if (subject !== entry.scope) {
          if (isWaterfall) return maybeNext()
          return undefined
        }
      }

      if (isWaterfall) {
        return runWaterfallListener.call(this, entry, args, maybeNext, meta)
      }

      if (entry.priority === 'monitor') {
        try {
          const returned = entry.listener.apply(this, args)
          if (returned != null && typeof returned.then === 'function') {
            Promise.resolve(returned).catch((error) => contain(error))
          }
        } catch (error) {
          contain(error)
        }
        return undefined
      }

      if (meta.fault === 'propagate') {
        // Official Cordis semantics: a throwing/rejecting listener reaches the
        // official dispatcher unchanged. No facade containment, no thenable wrap.
        return entry.listener.apply(this, args)
      }

      if (meta.fault === 'created') {
        // Official agent/created semantics: synchronous throw vetoes
        // publication (propagate), async rejection is reported (contain).
        const returned = entry.listener.apply(this, args)
        if (returned != null && typeof returned.then === 'function') {
          return Promise.resolve(returned).then(
            (value) => value,
            (error) => {
              contain(error)
              return undefined
            },
          )
        }
        return returned
      }

      try {
        const returned = entry.listener.apply(this, args)
        if (returned != null && typeof returned.then === 'function') {
          return Promise.resolve(returned).then(
            (value) => value,
            (error) => {
              contain(error)
              return undefined
            },
          )
        }
        return returned
      } catch (error) {
        contain(error)
        return undefined
      }
    }
  }

  function runWaterfallListener(entry, args, next, meta) {
    let called = false
    let chainResult

    const guardedNext = () => {
      called = true
      chainResult = next()
      return chainResult
    }

    const callArgs = args.slice(0, -1)
    callArgs.push(guardedNext)

    const continueIfNeeded = () => {
      if (!called) return next()
      return chainResult
    }

    if (entry.priority === 'monitor') {
      try {
        const returned = entry.listener.apply(this, callArgs)
        if (returned != null && typeof returned.then === 'function') {
          return Promise.resolve(returned).then(
            () => continueIfNeeded(),
            (error) => {
              contain(error)
              return continueIfNeeded()
            },
          )
        }
        return continueIfNeeded()
      } catch (error) {
        contain(error)
        return continueIfNeeded()
      }
    }

    if (meta.fault === 'propagate') {
      // Official Cordis waterfall semantics: listener throw/rejection reaches
      // the official dispatcher. The facade only provides the guarded `next`.
      return entry.listener.apply(this, callArgs)
    }

    // 'contain' (and defensive fallback for any other value): keep the
    // events-m1 behavior — contain the listener and continue the chain with
    // the current input when the listener did not call next().
    try {
      const returned = entry.listener.apply(this, callArgs)
      if (returned != null && typeof returned.then === 'function') {
        return Promise.resolve(returned).then(
          (value) => value,
          (error) => {
            contain(error)
            return continueIfNeeded()
          },
        )
      }
      return returned
    } catch (error) {
      contain(error)
      return continueIfNeeded()
    }
  }

  function contain(error) {
    try {
      logger.warn(`dsh-plugin-api events: facade listener failure contained: ${String(error)}`)
    } catch {
      // logging must never turn a contained listener failure into a dispatch failure
    }
  }

  /**
   * @param {string} name
   * @param {Function} listener
   * @param {{ priority?: string, scope?: unknown }} [opts]
   * @param {boolean} once
   */
  function subscribe(name, listener, opts = {}, once) {
    const meta = catalogEntryOf(name)
    if (!meta) {
      return once ? ctx.once(name, listener) : ctx.on(name, listener)
    }

    const priority = opts?.priority ?? 'normal'
    if (!EVENT_PRIORITIES.includes(priority)) {
      throw new PluginApiEventPriorityError(priority)
    }

    const state = stateOf(name)
    const entry = {
      id: nextEntryId++,
      name,
      listener,
      priority,
      scope: opts?.scope,
      once: Boolean(once),
      order: nextEntryId, // insertion order; priority tiers are layered on top of it
    }
    state.entries.push(entry)
    sortEntries(state.entries)

    try {
      reconcile(name)
    } catch (error) {
      // Roll back the new entry and restore the previous hook set.
      removeEntry(state, entry)
      try {
        reconcile(name)
      } catch {
        // previous set could not be restored; keep the error from the failed registration
      }
      throw error
    }

    let removed = false
    return function dispose() {
      if (removed) return false
      removed = true
      const changed = removeEntry(state, entry)
      reconcile(name)
      return changed
    }
  }

  function disposeAll() {
    for (const state of states.values()) {
      for (const dispose of state.hooks.splice(0)) {
        try {
          dispose()
        } catch {
          // disposal must never break facade teardown
        }
      }
      state.entries.length = 0
    }
  }

  return {
    catalog,

    on(name, listener, opts) {
      return subscribe(name, listener, opts, false)
    },

    once(name, listener, opts) {
      return subscribe(name, listener, opts, true)
    },

    emit(name, ...args) {
      return ctx.emit(name, ...args)
    },

    serial(name, ...args) {
      return ctx.serial(name, ...args)
    },

    parallel(name, ...args) {
      return ctx.parallel(name, ...args)
    },

    bail(name, ...args) {
      return ctx.bail(name, ...args)
    },

    waterfall(name, ...args) {
      return ctx.waterfall(name, ...args)
    },

    dispose() {
      disposeAll()
    },
  }
}
