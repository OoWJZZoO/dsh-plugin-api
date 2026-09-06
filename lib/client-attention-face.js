/**
 * Main facade client face for the attention domain.
 *
 * `ctx.pluginApi.attention` (web profile) is the public API outlet: it presents
 * the same frozen projection semantics as the host hub for items whose
 * `audience` includes this client, and forwards `contribute`/`dismiss`/`invoke`
 * requests to the host hub (the single item authority) through the browser
 * attention runtime.
 *
 * This module is a pure face: it consumes the internal runtime contract
 * exposed by the client-runtime slice and performs shape-only validation plus
 * the client-side audience filter. It is mounted into the client bundle at the
 * integration wave and is tested here as a pure module against a fake runtime
 * implementing the same contract.
 *
 * @module
 */

import { ATTENTION_AUDIENCE } from './attention-hub.js'

function deepFreezeValue(value, seen = new WeakSet()) {
  try {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
    if (seen.has(value)) return value
    if (Object.isFrozen(value)) return value
    seen.add(value)
    for (const key of Object.keys(value)) deepFreezeValue(value[key], seen)
    return Object.freeze(value)
  } catch {
    return value
  }
}

/** The client kinds an item is visible to. */
function audienceOf(item) {
  if (item === null || item === undefined) return []
  if (item.audience === 'all') return ATTENTION_AUDIENCE
  return Array.isArray(item.audience) ? item.audience : []
}

function visibleForKind(item, kind) {
  return audienceOf(item).includes(kind)
}

function applyFilters(items, filters, kind) {
  return items.filter((item) => {
    if (!visibleForKind(item, kind)) return false
    if (filters === null || filters === undefined) return true
    if (filters.audience !== undefined && filters.audience !== 'all') {
      const wanted = Array.isArray(filters.audience) ? filters.audience : [filters.audience]
      if (!audienceOf(item).some((entry) => wanted.includes(entry))) return false
    }
    if (filters.scope !== undefined && filters.scope !== null) {
      if (filters.scope.sessionId !== undefined && item.scope?.sessionId !== filters.scope.sessionId) return false
      if (filters.scope.workspaceId !== undefined && item.scope?.workspaceId !== filters.scope.workspaceId) return false
    }
    return true
  })
}

/**
 * Create the client attention face.
 *
 * @param {object} options
 * @param {string} [options.kind] - this client's audience kind.
 * @param {object} options.runtime - the browser attention runtime (internal
 *   contract: current/observe/contribute/dismiss/invoke/availability/epoch).
 * @returns {object} the `ctx.pluginApi.attention` surface.
 */
export function createClientAttentionFace({ kind = 'web', runtime }) {
  const unavailable = (reason) => deepFreezeValue({ status: 'unavailable', reason })

  const viewFor = () => runtime.current()

  function visible() {
    const items = viewFor()
    if (!Array.isArray(items)) return []
    return applyFilters(items, null, kind)
  }

  function filtered(filters) {
    const items = viewFor()
    if (!Array.isArray(items)) return []
    return applyFilters(items, filters, kind)
  }

  const face = Object.freeze({
    current() {
      return deepFreezeValue(visible())
    },

    list(filters) {
      const items = filtered(filters)
      const limit = filters && filters.limit !== undefined ? Math.max(1, Math.floor(filters.limit)) : 50
      const cursor = filters && filters.cursor !== undefined ? filters.cursor : undefined
      const offset = cursor === undefined ? 0 : items.findIndex((item) => item.seq === cursor) + 1
      const page = items.slice(offset, offset + limit)
      const nextCursor = offset + page.length < items.length ? page[page.length - 1].seq : undefined
      return deepFreezeValue({ items: page.slice(), nextCursor })
    },

    observe(filters) {
      let disposed = false
      let unsubscribeRuntime = () => {}
      const epoch = typeof runtime.epoch === 'function' ? runtime.epoch() : 0
      const handle = Object.freeze({
        current() {
          if (disposed) return Object.freeze([])
          return deepFreezeValue(filtered(filters))
        },
        subscribe(listener) {
          if (typeof listener !== 'function') {
            throw new TypeError('attention observe: listener must be a function')
          }
          if (disposed) return () => {}
          unsubscribeRuntime = runtime.observe((change) => {
            if (disposed) return
            // shape-only + audience filter on the change path
            if (change === null || typeof change !== 'object') return
            let payload
            if (change.op === 'remove') {
              payload = { op: 'remove', id: change.id, reason: change.reason }
            } else if (change.item !== undefined && change.item !== null) {
              if (!visibleForKind(change.item, kind)) return
              if (filters && filters.scope) {
                if (filters.scope.sessionId !== undefined && change.item.scope?.sessionId !== filters.scope.sessionId) return
                if (filters.scope.workspaceId !== undefined && change.item.scope?.workspaceId !== filters.scope.workspaceId) return
              }
              payload = { op: change.op, item: change.item, id: change.id }
            } else {
              return
            }
            try {
              listener(deepFreezeValue(payload))
            } catch {
              // containment: one faulty listener never breaks the others
            }
          })
          return () => unsubscribeRuntime()
        },
        dispose() {
          if (disposed) return
          disposed = true
          unsubscribeRuntime()
        },
        epoch,
      })
      return handle
    },

    contribute(spec) {
      if (runtime === null || runtime === undefined) {
        return Promise.resolve({ ok: false, code: 'unavailable', reason: 'attention runtime is unavailable' })
      }
      return Promise.resolve(runtime.contribute({ ...spec }))
    },

    dismiss(itemId, by) {
      if (runtime === null || runtime === undefined) {
        return Promise.resolve({ ok: false, code: 'unavailable', reason: 'attention runtime is unavailable' })
      }
      return Promise.resolve(runtime.dismiss(itemId, { ...by }))
    },

    invoke(itemId, actionId) {
      if (runtime === null || runtime === undefined) {
        return Promise.resolve({ ok: false, code: 'unavailable', reason: 'attention runtime is unavailable' })
      }
      return Promise.resolve(runtime.invoke(itemId, actionId))
    },

    availability() {
      if (runtime === null || runtime === undefined) return unavailable('attention runtime is unavailable')
      const state = runtime.availability()
      return deepFreezeValue(state)
    },
  })

  return face
}