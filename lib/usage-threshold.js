/**
 * Budget threshold projection owner for the pluginApi.usage surface.
 *
 * Emits one deterministic crossing notification per threshold generation when
 * a committed usage projection for a single budget scope crosses a declared
 * threshold. The same threshold remaining crossed across duplicate samples or
 * repeated reconciliations does not emit an unbounded duplicate; a new
 * generation (or an explicit reset) may emit a new crossing. Notification
 * payloads are frozen, identify scope/source/generation, and when the total is
 * provisional (estimated/late/incomplete) explicitly state that uncertainty —
 * they never claim a provider-confirmed bill.
 *
 * Observational only: this owner has no policy/call surface and can never
 * deny, reroute, retry or auto-degrade an execution. It is a read-only
 * projection over the totals it is fed; listener failures are contained to the
 * offending listener; disposers are idempotent and identity-bound.
 */

import { deepFreeze } from './deep-freeze.js'

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

export function createUsageThreshold({ logger } = {}) {
  const watchers = new Set()
  let disposed = false

  /**
   * observe() registers a listener notified on a deterministic crossing for
   * one budget scope. Returns an idempotent, identity-bound disposer.
   */
  function observe({ scope, thresholdId, limit, unit, generation }, listener) {
    if (disposed) return () => false
    if (!['session', 'workspace', 'profile'].includes(scope)) {
      throw new TypeError('threshold scope must be session, workspace, or profile')
    }
    if (!isNonEmptyString(thresholdId) || !isNonEmptyString(unit) || !isNonEmptyString(generation)) {
      throw new TypeError('thresholdId, unit and generation are required')
    }
    if (!safeNumber(limit) || limit < 0) throw new TypeError('threshold limit must be a finite non-negative number')
    if (typeof listener !== 'function') throw new TypeError('threshold listener must be a function')

    const watcher = {
      scope,
      thresholdId,
      limit,
      unit,
      generation,
      listener,
      crossed: false,
      lastCrossedGeneration: null,
      active: true,
    }
    watchers.add(watcher)
    let active = true
    return () => {
      if (!active) return false
      active = false
      watcher.active = false
      watchers.delete(watcher)
      return true
    }
  }

  /**
   * reconcile() feeds the current committed total for one budget scope and
   * evaluates registered watchers deterministically. Emits at most one
   * crossing per threshold generation until the crossing resets or a new
   * generation arrives.
   */
  function reconcile({ scope, total, currency, certainty, provisional }) {
    if (disposed) return false
    if (!safeNumber(total)) return false
    let emitted = 0
    for (const watcher of watchers) {
      if (watcher.scope !== scope || !watcher.active) continue
      const crossed = total >= watcher.limit
      const generationChanged = watcher.lastCrossedGeneration !== watcher.generation
      if (crossed) {
        if (!watcher.crossed || generationChanged) {
          emit(watcher, { scope, total, currency, certainty, provisional })
          watcher.crossed = true
          watcher.lastCrossedGeneration = watcher.generation
          emitted += 1
        }
      } else {
        watcher.crossed = false
      }
    }
    return emitted
  }

  function emit(watcher, { scope, total, currency, certainty, provisional }) {
    const notification = deepFreeze({
      scope,
      thresholdId: watcher.thresholdId,
      observedTotal: total,
      currency: currency ?? watcher.unit,
      sourceCertainty: certainty ?? 'unknown',
      generation: watcher.generation,
      observedAt: new Date().toISOString(),
      provisional: provisional === true,
    })
    try {
      watcher.listener(notification)
    } catch {
      // a throwing listener degrades only itself; other watchers and the
      // ledger are unaffected
    }
  }

  /** Explicit budget reset: a new crossing may be emitted for the same generation. */
  function reset(scope) {
    if (disposed) return false
    let touched = 0
    for (const watcher of watchers) {
      if (watcher.scope !== scope) continue
      watcher.crossed = false
      watcher.lastCrossedGeneration = null
      touched += 1
    }
    return touched > 0
  }

  function dispose() {
    if (disposed) return false
    disposed = true
    watchers.clear()
    return true
  }

  return {
    observe,
    reconcile,
    reset,
    dispose,
    get size() {
      return watchers.size
    },
    get disposed() {
      return disposed
    },
  }
}
