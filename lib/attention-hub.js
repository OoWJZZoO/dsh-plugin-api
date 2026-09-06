/**
 * Host attention hub — the single item authority for the attention domain.
 *
 * Facade class B (design §Components And Interfaces §2): every attention item
 * lives here and only here. The hub owns item registration, the monotonic
 * `seq`, the hub `epoch`, dedupe, expiry, capacity eviction, owner-tied
 * disposers, action handlers and the host-side frozen projection. It is
 * deliberately non-durable: nothing ever leaves hub memory (Requirements R9).
 *
 * Ownership is derived from the caller context and is not caller-reportable;
 * the `resolveOwner` seam is injected by the face when the hub is mounted into
 * the gate (integration wave), and by tests directly.
 *
 * Pure module, zero harness dependencies. Imports only the frozen shared
 * freeze helper and the attention redaction / wire modules.
 *
 * @module
 */

import { deepFreeze } from './deep-freeze.js'
import {
  attentionLogSummary,
  buildRedactedItemPayload,
  contentBoundsViolation,
  redactionViolation,
} from './attention-redaction.js'
import { buildAttentionUpdate } from './attention-wire.js'

// ── Vocabulary (M9 contract §2 consumed, not redefined) ──────────────────────
export const ATTENTION_LEVELS = Object.freeze(['info', 'warning', 'error'])
export const ATTENTION_AUDIENCE = Object.freeze(['web', 'tui', 'desktop', 'host'])
export const ATTENTION_REMOVAL_REASONS = Object.freeze([
  'expired',
  'dismissed',
  'withdrawn',
  'evicted-capacity',
])

// ── Typed result codes (contract §6 failure vocabulary) ──────────────────────
export const CODE_REGISTERED = 'registered'
export const CODE_CONFLICT = 'conflict'
export const CODE_OWNER_CONFLICT = 'owner-conflict'
export const CODE_INVALID_INPUT = 'invalid-input'
export const CODE_CAPACITY = 'capacity'
export const CODE_DUPLICATE = 'duplicate'
export const CODE_NOOP = 'noop'
export const CODE_STALE = 'stale'
export const CODE_NOT_FOUND = 'not-found'
export const CODE_INVOKED = 'invoked'
export const CODE_UNAVAILABLE = 'unavailable'
export const CODE_DISMISSED = 'dismissed'

const DEFAULT_CAPACITY = 1000

/** Idempotency boundary: a removed id can be re-used by a new contribution. */

/**
 * Create the attention hub.
 *
 * @param {object} [options]
 * @param {() => number} [options.now] - time source (ms epoch).
 * @param {number} [options.capacity] - live item cap before observable eviction.
 * @param {object} [options.bounds] - content bounds passed to the redaction module.
 * @param {(caller: unknown) => { ownerId: string, generation: number }} [options.resolveOwner]
 * @param {(caller: unknown) => string|string[]} [options.kindOf] - default 'host'.
 * @param {(caller: unknown) => { sessions?: Set|null, workspaces?: Set|null, unscoped?: boolean }|null} [options.scopesOf]
 * @param {(executionId: string) => boolean|undefined} [options.isCurrentExecution] - activity fact-source seam.
 * @param {{ status?: string, reason?: string }} [options.availability] - initial hub availability.
 * @returns {object} the attention hub surface.
 */
export function createAttentionHub(options = {}) {
  const now = options.now ?? (() => Date.now())
  const capacity = options.capacity ?? DEFAULT_CAPACITY
  const bounds = options.bounds ?? {}
  const resolveOwner = options.resolveOwner ?? ((caller) => ({
    ownerId: (caller && typeof caller === 'object' && 'ownerId' in caller) ? caller.ownerId : 'unknown',
    generation: 0,
  }))
  const kindOf = options.kindOf ?? ((caller) => (caller && 'kind' in caller ? caller.kind : 'host'))
  const scopesOf = options.scopesOf ?? ((caller) => (caller && 'scopes' in caller ? caller.scopes : null))
  const isCurrentExecution = options.isCurrentExecution

  /** @type {Map<string, object>} */
  const items = new Map()
  /** @type {Map<string, number>} generator tokens per owner */
  const generations = new Map()
  /** @type {Set<object>} active observation records */
  const observers = new Set()
  /** @type {Set<(message: object) => void>} update listeners (pipeline wiring) */
  const updateListeners = new Set()

  let seq = 0
  let epoch = 1
  let availability = { status: options.availability?.status ?? 'active' }
  if (options.availability?.reason !== undefined) availability.reason = options.availability.reason

  // ── internal helpers ─────────────────────────────────────────────────────

  const ownerOf = resolveOwner

  function currentGeneration(ownerId) {
    return generations.get(ownerId) ?? 0
  }

  function isLive(item) {
    return item !== null && item !== undefined && item.live === true
  }

  function visibleFor(item, caller) {
    const kinds = Array.isArray(kindOf(caller)) ? kindOf(caller) : [kindOf(caller)]
    const audienceOk = item.audience === 'all' || item.audience.some((kind) => kinds.includes(kind))
    if (!audienceOk) return false
    const scopes = scopesOf(caller)
    if (scopes === null || scopes === undefined) return true
    if (item.scope.sessionId !== undefined) {
      if (scopes.sessions === null || scopes.sessions === undefined) return true
      return typeof scopes.sessions.has === 'function' && scopes.sessions.has(item.scope.sessionId)
    }
    if (item.scope.workspaceId !== undefined) {
      if (scopes.workspaces === null || scopes.workspaces === undefined) return true
      return typeof scopes.workspaces.has === 'function' && scopes.workspaces.has(item.scope.workspaceId)
    }
    return scopes.unscoped !== false
  }

  function emitUpdate(message) {
    for (const listener of updateListeners) {
      try {
        listener(message)
      } catch {
        // a wiring listener failure must never break hub emission
      }
    }
  }

  /** Typed degraded/unavailable view; queries and subscriptions never throw. */
  function availabilityView() {
    return Object.freeze({ ...availability })
  }

  function hubNotActive() {
    return availability.status !== 'active'
  }

  /** @type {Array<object>} change entries pending one external broadcast */
  const pendingChanges = []

  function notifyObservers(change) {
    for (const observer of observers) {
      if (observer.disposed || observer.stale) continue
      // deliver only changes visible to the observer's caller (removals keep
      // the item reference so visibility stays leak-free)
      if (change.item !== undefined && change.item !== null) {
        if (!visibleFor(change.item, observer.caller)) continue
      }
      let payload
      if (change.op === 'remove') {
        payload = { op: 'remove', id: change.id, reason: change.reason }
      } else {
        const redacted = buildRedactedItemPayload(change.item)
        if (redacted === null) continue
        payload = { op: change.op, item: redacted, id: change.item.id }
      }
      const frozen = deepFreeze(payload)
      for (const listener of observer.listeners) {
        try {
          listener(frozen)
        } catch {
          // listener containment: one faulty listener never breaks the others
        }
      }
    }
  }

  function recordRemoval(item, reason) {
    item.live = false
    item.removedAt = now()
    notifyObservers({ op: 'remove', id: item.id, item, reason })
    pendingChanges.push({ op: 'remove', id: item.id, reason })
  }

  function sweepExpiredLocked() {
    const cutoff = now()
    let changed = false
    for (const item of items.values()) {
      if (isLive(item) && item.expiresAt !== undefined && item.expiresAt <= cutoff) {
        recordRemoval(item, 'expired')
        items.delete(item.id)
        changed = true
      }
    }
    return changed
  }

  function validateSpec(spec) {
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
      return 'invalid input: expected an object'
    }
    if (typeof spec.id !== 'string' || spec.id.length === 0) {
      return 'invalid input: id must be a non-empty string'
    }
    if (typeof spec.title !== 'string' || spec.title.length === 0) {
      return 'invalid input: title must be a non-empty string'
    }
    if (spec.level !== undefined && !ATTENTION_LEVELS.includes(spec.level)) {
      return 'invalid input: unsupported level vocabulary'
    }
    if (spec.body !== undefined && typeof spec.body !== 'string') {
      return 'invalid input: body must be a string'
    }
    if (spec.audience !== undefined) {
      if (spec.audience === 'all') {
        // accepted
      } else if (Array.isArray(spec.audience)) {
        if (spec.audience.length === 0 || spec.audience.some((kind) => !ATTENTION_AUDIENCE.includes(kind))) {
          return 'invalid input: unsupported audience vocabulary'
        }
      } else {
        return 'invalid input: audience must be a client-kind list or "all"'
      }
    }
    if (spec.dedupeKey !== undefined && typeof spec.dedupeKey !== 'string') {
      return 'invalid input: dedupeKey must be a string'
    }
    if (spec.expiresAt !== undefined && (typeof spec.expiresAt !== 'number' || !Number.isFinite(spec.expiresAt))) {
      return 'invalid input: expiresAt must be a finite epoch ms timestamp'
    }
    if (spec.scope !== undefined && spec.scope !== null) {
      if (typeof spec.scope !== 'object') return 'invalid input: scope must be an object'
      if (spec.scope.sessionId !== undefined && typeof spec.scope.sessionId !== 'string') {
        return 'invalid input: scope.sessionId must be a string'
      }
      if (spec.scope.workspaceId !== undefined && typeof spec.scope.workspaceId !== 'string') {
        return 'invalid input: scope.workspaceId must be a string'
      }
      if (spec.scope.sessionId !== undefined && spec.scope.workspaceId !== undefined) {
        return 'invalid input: scope must be a single session or workspace association'
      }
    }
    if (spec.correlation !== undefined && spec.correlation !== null) {
      if (typeof spec.correlation !== 'object') return 'invalid input: correlation must be an object'
      if (spec.correlation.activityId !== undefined && typeof spec.correlation.activityId !== 'string') {
        return 'invalid input: correlation.activityId must be a string'
      }
      if (spec.correlation.executionId !== undefined && typeof spec.correlation.executionId !== 'string') {
        return 'invalid input: correlation.executionId must be a string'
      }
    }
    if (spec.actions !== undefined) {
      if (!Array.isArray(spec.actions)) return 'invalid input: actions must be a list'
      if (spec.actions.some((entry) => entry === null || typeof entry !== 'object'
        || typeof entry.id !== 'string' || entry.id.length === 0
        || typeof entry.label !== 'string' || entry.label.length === 0)) {
        return 'invalid input: actions must carry string id/label pairs'
      }
      const ids = new Set(spec.actions.map((entry) => entry.id))
      if (ids.size !== spec.actions.length) return 'invalid input: actions ids must be unique'
    }
    // correlation vocabulary from the shared projection (M9 contract §2.1)
    const redactionReason = redactionViolation(spec)
    if (redactionReason !== null) return redactionReason
    const boundsReason = contentBoundsViolation(spec, bounds)
    if (boundsReason !== null) return boundsReason
    return null
  }

  function publicItem(item) {
    return buildRedactedItemPayload(item)
  }

  /** Mark a reference `unknown` when the shared projection cannot verify it. */
  function normalizeCorrelation(correlation, ownerId, caller, isCurrent) {
    if (correlation === null || correlation === undefined) return undefined
    const out = {}
    if (correlation.activityId !== undefined) out.activityId = correlation.activityId
    if (correlation.executionId !== undefined) out.executionId = correlation.executionId
    if (Object.keys(out).length === 0) return undefined
    // Verification against the shared projection vocabulary (Requirements
    // R2 AC3): when no fact-source seam is registered the reference is merely
    // `unknown`, never a durable claim and never a fabrication.
    if (out.executionId !== undefined && typeof isCurrent === 'function') {
      out.verification = 'verified'
    } else {
      out.verification = 'unknown'
    }
    return out
  }

  // ── public surface ───────────────────────────────────────────────────────

  const hub = Object.freeze({
    /** @returns {string} hub identity used in diagnostics only */
    name: 'attention-hub',

    contribute(spec, caller) {
      sweepAndFlush()
      if (hubNotActive()) {
        return { ok: false, code: CODE_UNAVAILABLE, reason: 'hub unavailable' }
      }
      const reason = validateSpec(spec)
      if (reason !== null) {
        return { ok: false, code: CODE_INVALID_INPUT, reason }
      }
      const { ownerId, generation } = ownerOf(caller)
      const liveItem = items.get(spec.id)
      if (isLive(liveItem)) {
        if (liveItem.ownerId === ownerId) {
          return { ok: false, code: CODE_CONFLICT, reason: 'same-owner same-id contribution is already live' }
        }
        return { ok: false, code: CODE_OWNER_CONFLICT, reason: 'another owner holds that id' }
      }
      // dedupe key (active window = a live item with the same key under this owner)
      if (typeof spec.dedupeKey === 'string' && spec.dedupeKey.length > 0) {
        for (const item of items.values()) {
          if (isLive(item) && item.ownerId === ownerId && item.dedupeKey === spec.dedupeKey) {
            const reference = publicItem(item)
            return { ok: false, code: CODE_DUPLICATE, item: reference, reason: 'duplicate contribution inside the live window' }
          }
        }
      }
      // capacity: evict the oldest removable item observably, or report capacity
      if (items.size >= capacity) {
        if (!evictOldestForCapacity()) {
          return { ok: false, code: CODE_CAPACITY, reason: 'contribution capacity is exhausted and nothing is removable' }
        }
      }
      seq += 1
      const item = {
        id: spec.id,
        ownerId,
        ownerGeneration: generation,
        seq,
        scope: normalizeScope(spec.scope),
        level: spec.level ?? 'info',
        title: spec.title,
        body: spec.body ?? '',
        dedupeKey: spec.dedupeKey,
        expiresAt: spec.expiresAt,
        audience: normalizeAudience(spec.audience),
        actions: (spec.actions ?? []).map(({ id, label }) => ({ id, label })),
        correlation: normalizeCorrelation(
          spec.correlation,
          ownerId,
          caller,
          isCurrentExecution,
        ),
        observedAt: now(),
        meta: spec.meta !== undefined && spec.meta !== null ? { ...spec.meta } : undefined,
        handlers: new Map(),
        live: true,
        epoch: hubEpoch(),
      }
      if (spec.handlers !== null && spec.handlers !== undefined && typeof spec.handlers === 'object') {
        for (const [actionId, handler] of Object.entries(spec.handlers)) {
          if (typeof handler === 'function' && item.actions.some((action) => action.id === actionId)) {
            item.handlers.set(actionId, handler)
          }
        }
      }
      items.set(spec.id, item)
      const change = { op: 'add', item }
      notifyObservers(change)
      pendingChanges.push({ op: 'add', id: item.id, item: publicItem(item) })
      let disposed = false
      const handle = Object.freeze({
        id: item.id,
        ownerId: item.ownerId,
        seq: item.seq,
        dispose() {
          if (disposed) return { ok: true, code: CODE_NOOP, reason: 'already disposed' }
          return disposeLocked(item.id, item.ownerId, item.ownerGeneration, () => {
            disposed = true
          })
        },
      })
      flushPending()
      return { ok: true, code: CODE_REGISTERED, handle }
    },

    dispose(id, caller) {
      // host-internal path (the returned handle's dispose uses disposeLocked)
      return disposeLocked(id, ownerOf(caller).ownerId, currentGeneration(ownerOf(caller).ownerId))
    },

    dismiss(itemId, by, caller) {
      sweepAndFlush()
      if (hubNotActive()) {
        return { ok: false, code: CODE_UNAVAILABLE, reason: 'hub unavailable' }
      }
      const item = items.get(itemId)
      if (!isLive(item) || !visibleFor(item, caller)) {
        return { ok: false, code: CODE_NOT_FOUND, reason: 'item is not present or not visible to the caller' }
      }
      recordRemoval(item, 'dismissed')
      items.delete(item.id)
      return { ok: true, code: CODE_DISMISSED, reason: 'dismissed' }
    },

    invoke(itemId, actionId, caller) {
      sweepAndFlush()
      if (hubNotActive()) {
        return { ok: false, code: CODE_UNAVAILABLE, reason: 'hub unavailable' }
      }
      const item = items.get(itemId)
      if (!isLive(item) || !visibleFor(item, caller)) {
        return { ok: false, code: CODE_NOT_FOUND, reason: 'item is not present or not visible to the caller' }
      }
      const action = item.actions.some((entry) => entry.id === actionId)
      if (!action) {
        return { ok: false, code: CODE_NOT_FOUND, reason: 'action is not declared on the item' }
      }
      // An action targeting a session/activity that has moved on must not run
      // (Requirements R7 AC3); the fact source is consumed, never judged here.
      let executionCurrent = undefined
      if (
        item.correlation !== undefined
        && item.correlation.executionId !== undefined
        && typeof isCurrentExecution === 'function'
      ) {
        try {
          executionCurrent = isCurrentExecution(item.correlation.executionId)
        } catch {
          executionCurrent = undefined
        }
      }
      if (executionCurrent === false) {
        return { ok: false, code: CODE_CONFLICT, reason: 'the correlated execution has moved on' }
      }
      const handler = item.handlers.get(actionId)
      if (typeof handler !== 'function') {
        return { ok: false, code: CODE_UNAVAILABLE, reason: 'the owner has not registered a handler for this action' }
      }
      const byKind = kindOf(caller)
      const context = Object.freeze({
        item: publicItem(item),
        by: Object.freeze({ kind: Array.isArray(byKind) ? byKind[0] : byKind }),
      })
      try {
        handler(context)
        return { ok: true, code: CODE_INVOKED, reason: 'invoked' }
      } catch {
        return {
          ok: false,
          code: CODE_CONFLICT,
          reason: 'the action handler failed',
          attribution: item.ownerId,
        }
      }
    },

    current(caller, filters) {
      sweepAndFlush()
      if (hubNotActive()) return availabilityView()
      const visible = visibleItems(caller)
      const filtered = applyFilters(visible, filters)
      return Object.freeze(filtered.map((item) => publicItem(item)))
    },

    list(caller, filters) {
      sweepAndFlush()
      if (hubNotActive()) return availabilityView()
      const visible = applyFilters(visibleItems(caller), filters)
      const limit = filters && filters.limit !== undefined ? Math.max(1, Math.floor(filters.limit)) : 50
      const cursor = filters && filters.cursor !== undefined ? filters.cursor : undefined
      const offset = cursor === undefined ? 0 : visible.findIndex((item) => item.seq === cursor) + 1
      const page = visible.slice(offset, offset + limit)
      const nextCursor = offset + page.length < visible.length
        ? (page[page.length - 1].seq)
        : undefined
      return Object.freeze({
        items: Object.freeze(page.map((item) => publicItem(item))),
        nextCursor,
      })
    },

    observe(caller, filters) {
      sweepAndFlush()
      if (hubNotActive()) {
        const epochValue = hubEpoch()
        return Object.freeze({
          current: () => availabilityView(),
          subscribe: () => () => {},
          dispose() {},
          epoch: epochValue,
        })
      }
      const observer = {
        caller,
        listeners: new Set(),
        disposed: false,
        stale: false,
        epoch: hubEpoch(),
        applyFilters: filters,
      }
      observers.add(observer)
      const handle = Object.freeze({
        current() {
          if (observer.disposed || observer.stale) return Object.freeze([])
          return Object.freeze(
            applyFilters(visibleItems(caller), observer.applyFilters)
              .map((item) => publicItem(item)),
          )
        },
        subscribe(listener) {
          if (typeof listener !== 'function') {
            throw new TypeError('attention observe: listener must be a function')
          }
          if (observer.disposed || observer.stale) return () => {}
          observer.listeners.add(listener)
          return () => observer.listeners.delete(listener)
        },
        dispose() {
          if (observer.disposed) return
          observer.disposed = true
          observers.delete(observer)
          observer.listeners.clear()
        },
        epoch: observer.epoch,
      })
      return handle
    },

    availability() {
      return deepFreeze({ ...availability })
    },

    /** Set hub availability (facade/tests); never throws, frozen on read. */
    setAvailability(next) {
      availability = { status: next.status }
      if (next.reason !== undefined) availability.reason = next.reason
    },

    /** Whitelisted sweep used by facade/tests; removal is observable. */
    sweep() {
      const changed = sweepExpiredLocked()
      if (changed) {
        const message = buildAttentionUpdate({
          kind: 'attention.delta',
          epoch,
          seq,
          changes: pendingChanges.splice(0, pendingChanges.length),
        })
        if (message !== null) emitUpdate(message)
      }
      return changed
    },

    withdrawOwner(ownerId) {
      return withdrawOwnerLocked(ownerId)
    },

    reloadOwner(ownerId) {
      generations.set(ownerId, currentGeneration(ownerId) + 1)
      withdrawOwnerLocked(ownerId)
    },

    resetEpoch() {
      epoch += 1
      for (const observer of observers) observer.stale = true
      observers.clear()
    },

    onUpdate(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('attention hub onUpdate: listener must be a function')
      }
      updateListeners.add(listener)
      return () => updateListeners.delete(listener)
    },

    /** @returns {number} current hub epoch */
    currentEpoch() {
      return epoch
    },

    /** @returns {number} next-seq peek, diagnostic only */
    peekSeq() {
      return seq
    },
  })

  // ── closure helpers referenced above ──────────────────────────────────────

  function hubEpoch() {
    return epoch
  }

  function withdrawOwnerLocked(ownerId) {
    let changed = false
    for (const item of items.values()) {
      if (isLive(item) && item.ownerId === ownerId) {
        recordRemoval(item, 'withdrawn')
        items.delete(item.id)
        changed = true
      }
    }
    flushPending()
    return changed
  }

  function sweepAndFlush() {
    if (sweepExpiredLocked()) flushPending()
  }

  function normalizeAudience(audience) {
    if (audience === undefined || audience === null) return 'all'
    if (audience === 'all') return 'all'
    return [...audience]
  }

  function normalizeScope(scope) {
    if (scope === undefined || scope === null) return {}
    return { ...scope }
  }

  function visibleItems(caller) {
    return [...items.values()]
      .filter((item) => isLive(item))
      .filter((item) => visibleFor(item, caller))
      .sort((a, b) => a.seq - b.seq)
  }

  function applyFilters(visible, filters) {
    if (filters === undefined || filters === null) return visible
    return visible.filter((item) => {
      if (filters.audience !== undefined && filters.audience !== 'all') {
        const wanted = Array.isArray(filters.audience) ? filters.audience : [filters.audience]
        const audienceOk = item.audience === 'all' || item.audience.some((kind) => wanted.includes(kind))
        if (!audienceOk) return false
      }
      if (filters.scope !== undefined && filters.scope !== null) {
        if (filters.scope.sessionId !== undefined && item.scope.sessionId !== filters.scope.sessionId) return false
        if (filters.scope.workspaceId !== undefined && item.scope.workspaceId !== filters.scope.workspaceId) return false
        if (filters.scope.sessionId === undefined && filters.scope.workspaceId === undefined) return false
      }
      return true
    })
  }

  function evictOldestForCapacity() {
    let oldest = null
    for (const item of items.values()) {
      if (!isLive(item)) continue
      if (oldest === null || item.seq < oldest.seq) oldest = item
    }
    if (oldest === null) return false
    recordRemoval(oldest, 'evicted-capacity')
    items.delete(oldest.id)
    return true
  }

  function disposeLocked(id, ownerId, ownerGeneration, onDone) {
    sweepAndFlush()
    const item = items.get(id)
    if (!isLive(item)) {
      return { ok: true, code: CODE_NOOP, reason: 'already removed' }
    }
    // Cross-owner or stale-generation disposers lose commit eligibility
    // (Requirements R4 AC4, R6 AC2): generation is owner-specific and opaque.
    if (item.ownerId !== ownerId || currentGeneration(ownerId) !== ownerGeneration) {
      return { ok: false, code: CODE_STALE, reason: 'stale or cross-owner disposer' }
    }
    recordRemoval(item, 'withdrawn')
    items.delete(id)
    if (typeof onDone === 'function') onDone()
    flushPending()
    return { ok: true, code: CODE_WITHDRAWN, reason: 'withdrawn' }
  }

  function flushPending() {
    if (pendingChanges.length === 0) return
    const message = buildAttentionUpdate({
      kind: 'attention.delta',
      epoch,
      seq,
      changes: pendingChanges.splice(0, pendingChanges.length),
    })
    if (message !== null) emitUpdate(message)
  }

  return hub
}

// ── module-level exports for status codes (dispose outcome) ─────────────────
export const CODE_WITHDRAWN = 'withdrawn'
export { attentionLogSummary }