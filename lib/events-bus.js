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
import { composeCatalogs } from './catalog-compose.js'
import { freezeByPolicy } from './deep-freeze.js'
import { PluginApiError, PluginApiEventPriorityError } from './errors.js'

export const EVENT_PRIORITIES = Object.freeze(['lowest', 'low', 'normal', 'high', 'highest', 'monitor'])

// Caller tracker marker used by the platform service proxy: a surface carrying
// this symbol is traced back to the consuming plugin context, so a dispatched
// `define` can derive the caller-bound owner identity for registration and
// lifecycle. Without tracing the owner falls back to the root token.
const CORDIS_TRACKER = Symbol.for('cordis.tracker')
const FALLBACK_OWNER = 'root'

let nextEntryId = 1

// Feed identity for the observe projection: object/function scope values are
// keyed by object identity (String(object) collides across distinct scopes).
const observeScopeIds = new WeakMap()
let nextObserveScopeId = 0

function observeScopeKey(scope) {
  if (scope === undefined) return 'undefined'
  if (scope === null) return 'null'
  if (typeof scope === 'object' || typeof scope === 'function') {
    let id = observeScopeIds.get(scope)
    if (id === undefined) {
      id = `object:${++nextObserveScopeId}`
      observeScopeIds.set(scope, id)
    }
    return id
  }
  return `${typeof scope}:${String(scope)}`
}

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
 * @param {(callerCtx: unknown) => string | undefined} [options.resolveOwnerId] - caller-bound owner derivation for
 *   custom event definitions; a caller context without derivable identity falls back to the root token.
 */
export function createEventsBus({ ctx, catalog, rSlices = [], logger = { warn() {}, error() {} }, resolveOwnerId = () => undefined } = {}) {
  const { states, stateOf, removeEntry } = createState()

  // Separate custom-definition registry: canonical event authority, priority
  // vocabulary, freeze and fault-containment semantics stay untouched. Custom
  // and canonical event catalogs remain separate semantic categories even
  // though both dispatch through the same bus substrate.
  const customDefinitions = new Map() // name -> definition record
  let nextCustomId = 1
  let nextCustomGeneration = 1

  const freezePolicyOf = (value) => {
    return value === 'all' ||
      value === 'except-signal' ||
      value === 'waterfall' ||
      (value !== null && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.deep))
  }

  const keyedSlice = (slice) => Object.fromEntries(slice.entries.map((entry) => [entry.name, entry]))

  // Static full set for subscription metadata: base + every R slice, regardless
  // of the current guard. A duplicate R event name is a coding error and must
  // fail loud.
  const fullCatalog = composeCatalogs(catalog, ...rSlices.map(keyedSlice))
  const catalogEntryOf = (name) => fullCatalog[name]

  // Public catalog accessor: only slices whose `isActive(ctx)` guard is true are
  // visible in the snapshot; each read recomposes and deep-freezes.
  function catalogAccessor() {
    const activeSlices = rSlices.filter((slice) => {
      try {
        return Boolean(slice.isActive?.(ctx))
      } catch {
        return false
      }
    })
    return composeCatalogs(catalog, ...activeSlices.map(keyedSlice))
  }

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

      // Waterfall mode is identified by the trailing `next` dispatcher before
      // any argument freeze policy is applied, so the `next` function is never
      // treated as a payload argument.
      const maybeNext = args[args.length - 1]
      const isWaterfall = typeof maybeNext === 'function'
      if (isWaterfall) {
        for (const arg of args.slice(0, -1)) freezeByPolicy(arg, meta.freeze)
      } else {
        for (const arg of args) freezeByPolicy(arg, meta.freeze)
      }

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

  /**
   * Standard projection subscription entry.
   *
   * The returned handle exposes `current()`, `subscribe(listener)`,
   * `dispose()`, and `epoch`. One monitor-priority feed per event and scope
   * backs every handle; each handle fans out to its own listeners with
   * per-listener containment, so a throwing listener never affects its peers.
   *
   * @param {string} name
   * @param {{ scope?: unknown, priority?: string }} [opts]
   */
  function observe(name, opts = {}) {
    const state = stateOf(name)
    const feedKey = `${name}|${observeScopeKey(opts?.scope)}`
    state.feeds ??= new Map()

    let feed = state.feeds.get(feedKey)
    if (!feed) {
      const handlers = new Set()
      const detach = subscribe(name, (...args) => {
        for (const handler of [...handlers]) {
          try {
            handler(args)
          } catch (error) {
            contain(error)
          }
        }
      }, { priority: 'monitor', scope: opts?.scope }, false)
      feed = { detach, handlers, refs: 0 }
      state.feeds.set(feedKey, feed)
    }
    feed.refs += 1

    let disposed = false
    let epoch = 0
    let hasValue = false
    let currentValue = null
    const listeners = new Set()

    const deliver = (args) => {
      if (disposed) return
      const payload = args.length <= 1 ? args[0] : Object.freeze([...args])
      currentValue = payload
      hasValue = true
      epoch += 1
      for (const listener of [...listeners]) {
        try {
          const returned = listener(payload)
          if (returned != null && typeof returned.then === 'function') {
            Promise.resolve(returned).catch((error) => contain(error))
          }
        } catch (error) {
          contain(error)
        }
      }
    }
    feed.handlers.add(deliver)

    return Object.freeze({
      current() {
        return hasValue ? currentValue : null
      },

      subscribe(listener) {
        if (typeof listener !== 'function') {
          throw new PluginApiError(
            'PLUGIN_API_INVALID_LISTENER',
            `dsh-plugin-api events: events.observe(${JSON.stringify(name)}) requires a listener function`,
          )
        }
        if (disposed) return () => false
        listeners.add(listener)
        let removed = false
        return () => {
          if (removed) return false
          removed = true
          return listeners.delete(listener)
        }
      },

      dispose() {
        if (disposed) return false
        disposed = true
        listeners.clear()
        feed.handlers.delete(deliver)
        feed.refs -= 1
        if (feed.refs <= 0) {
          try {
            feed.detach()
          } catch {
            // feed disposal must never break handle teardown
          }
          state.feeds.delete(feedKey)
        }
        return true
      },

      get epoch() {
        return epoch
      },
    })
  }

  /**
   * Dispatch helper for the operation dispatch variant.
   *
   * One dispatch has no independent operation identity and is never retried,
   * so the outcome is a frozen discriminated result rather than `undefined`.
   */
  function dispatch(mode, name, args) {
    const meta = catalogEntryOf(name)
    if (!meta) {
      return Object.freeze({
        ok: false,
        code: 'unsupported',
        reason: `event ${String(name)} is not part of the facade event vocabulary`,
      })
    }
    // Async dispatch modes (serial/parallel/bail) resolve the discriminated
    // result with the chain's final value; synchronous modes return it
    // directly, so callers keep native await semantics either way.
    const dispatched = (value) => Object.freeze({
      ok: true,
      code: 'dispatched',
      outcome: value === undefined ? null : value,
    })
    try {
      const returned = ctx[mode](name, ...args)
      if (returned != null && typeof returned.then === 'function') {
        return Promise.resolve(returned).then(dispatched, (error) => Object.freeze({
          ok: false,
          code: 'error',
          reason: String(error?.message ?? error),
        }))
      }
      return dispatched(returned)
    } catch (error) {
      return Object.freeze({ ok: false, code: 'error', reason: String(error?.message ?? error) })
    }
  }

  /**
   * Cooperative custom event definition entry.
   *
   * Registers a caller-owned custom event identity in the separate custom
   * definition registry. The returned frozen publisher handle can only emit
   * its own declared identity; a canonical event name or an already-active
   * custom identity under the same name is rejected deterministically before
   * any registration replaces an owner. Owner identity is derived from the
   * caller context when the platform traces it (cooperative ownership, not
   * adversarial isolation); an untraceable caller falls back to the root
   * token.
   *
   * @param {{ name: string, validate?: (payload: unknown) => boolean, freeze?: 'all' | 'except-signal' | 'waterfall' | { deep: string[] }, scope?: unknown }} spec
   * @returns {Readonly<{ id: string, ownerId: string, generation: string, name: string, emit: (payload: unknown) => object, dispose: () => boolean }>}
   */
  function define(spec) {
    if (spec === null || typeof spec !== 'object') {
      throw new PluginApiError(
        'PLUGIN_API_EVENT_DEFINITION_INVALID',
        'dsh-plugin-api events: events.define requires a definition object',
      )
    }
    const name = spec.name
    if (typeof name !== 'string' || name.length === 0) {
      throw new PluginApiError(
        'PLUGIN_API_EVENT_DEFINITION_INVALID',
        'dsh-plugin-api events: custom event name must be a non-empty string',
      )
    }
    if (catalogEntryOf(name)) {
      throw new PluginApiError(
        'PLUGIN_API_EVENT_DEFINITION_INVALID',
        `dsh-plugin-api events: "${name}" is a canonical event and cannot be redefined as a custom event`,
      )
    }
    if (customDefinitions.has(name)) {
      throw new PluginApiError(
        'PLUGIN_API_EVENT_DEFINITION_CONFLICT',
        `dsh-plugin-api events: custom event "${name}" is already defined by another owner`,
      )
    }
    if (spec.validate !== undefined && typeof spec.validate !== 'function') {
      throw new PluginApiError(
        'PLUGIN_API_EVENT_DEFINITION_INVALID',
        'dsh-plugin-api events: custom event validate must be a function',
      )
    }
    if (spec.freeze !== undefined && !freezePolicyOf(spec.freeze)) {
      throw new PluginApiError(
        'PLUGIN_API_EVENT_DEFINITION_INVALID',
        'dsh-plugin-api events: custom event freeze must be a declared freeze policy',
      )
    }

    const callerCtx = this?.ctx ?? this
    let ownerId
    try {
      ownerId = resolveOwnerId(callerCtx)
    } catch {
      ownerId = undefined
    }
    if (typeof ownerId !== 'string' || ownerId.length === 0) ownerId = FALLBACK_OWNER

    const id = `custom-event:${nextCustomId++}`
    const generation = String(nextCustomGeneration++)
    const record = {
      id,
      name,
      ownerId,
      generation,
      validate: spec.validate,
      freeze: spec.freeze,
      scope: spec.scope,
      active: true,
    }
    customDefinitions.set(name, record)

    const handle = Object.freeze({
      id,
      ownerId,
      generation,
      name,

      /**
       * Emit the declared custom event once. The payload is validated and
       * frozen per the declared contract, then dispatched through the shared
       * bus substrate. One dispatch has no independent operation identity and
       * is never retried, so the outcome is the frozen discriminated dispatch
       * shape with operation identity and retry entries not applicable.
       */
      emit(payload) {
        if (!record.active || customDefinitions.get(name) !== record) {
          return Object.freeze({
            ok: false,
            code: 'stale',
            reason: `custom event "${name}" publisher is stale after dispose or reload`,
          })
        }
        if (typeof record.validate === 'function') {
          let valid = false
          try {
            valid = Boolean(record.validate(payload))
          } catch {
            valid = false
          }
          if (!valid) {
            return Object.freeze({
              ok: false,
              code: 'rejected',
              reason: `payload failed the declared validation of custom event "${name}"`,
            })
          }
        }
        const frozenPayload = freezeByPolicy(payload, record.freeze)
        try {
          ctx.emit(name, frozenPayload)
        } catch (error) {
          return Object.freeze({
            ok: false,
            code: 'error',
            reason: String(error?.message ?? error),
          })
        }
        return Object.freeze({ ok: true, code: 'dispatched', outcome: null })
      },

      /**
       * Remove this definition from future dispatch. Idempotent: a stale
       * handle (already disposed, replaced by a newer definition, or from a
       * previous reload) neither dispatches nor removes the newer definition.
       */
      dispose() {
        if (record.active && customDefinitions.get(name) === record) {
          record.active = false
          customDefinitions.delete(name)
          return true
        }
        return false
      },
    })
    return handle
  }

  function disposeAll() {
    customDefinitions.clear()
    for (const state of states.values()) {
      for (const dispose of state.hooks.splice(0)) {
        try {
          dispose()
        } catch {
          // disposal must never break facade teardown
        }
      }
      if (state.feeds) {
        for (const feed of state.feeds.values()) {
          try {
            feed.detach()
          } catch {
            // feed disposal is best-effort
          }
        }
        state.feeds.clear()
      }
      state.entries.length = 0
    }
  }

  const bus = {
    /**
     * Frozen self-description of the facade event vocabulary: a pure query,
     * free of side effects and never a getter.
     */
    catalog() {
      return Object.freeze(catalogAccessor())
    },

    observe(name, opts) {
      return observe(name, opts)
    },

    define(spec) {
      return define.call(this, spec)
    },

    emit(name, ...args) {
      return dispatch('emit', name, args)
    },

    serial(name, ...args) {
      return dispatch('serial', name, args)
    },

    parallel(name, ...args) {
      return dispatch('parallel', name, args)
    },

    bail(name, ...args) {
      return dispatch('bail', name, args)
    },

    waterfall(name, ...args) {
      return dispatch('waterfall', name, args)
    },

    availability() {
      return Object.freeze({ status: 'active' })
    },
  }
  // The bus teardown is an internal fail-safe cleanup: it is reachable by
  // the host feature wiring through the non-enumerable member and never
  // shows in the walked public surface (internalize).
  Object.defineProperty(bus, 'dispose', { value: disposeAll, enumerable: false })
  // The composed events surface carries the platform caller tracker (the
  // client-runtime precedent uses the same marker) so a traced `define`
  // dispatches with `this.ctx` bound to the consuming plugin context.
  Object.defineProperty(bus, CORDIS_TRACKER, { value: { property: 'ctx' }, enumerable: false })
  return bus
}
