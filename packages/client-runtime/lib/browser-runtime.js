/**
 * Browser attention runtime for `@deepseek-ai/dsh-plugin-api-client-runtime`.
 *
 * Owns the browser-side attention state machine (the main facade client face
 * is the consumer of the internal runtime contract this module exposes):
 * - reconciles forwarded `attention.snapshot` / `attention.delta` messages
 *   delivered by the api-remotes slice over the official host→browser stream;
 * - dedupes by item `id`/`seq` (no double render);
 * - rebuilds its projection on `connection/reset`/HMR through a host snapshot
 *   refetch with a fresh view epoch (old epoch items are never carried);
 * - forwards `contribute`/`dismiss`/`invoke` requests through the client→host
 *   request channel, never queueing (missing channel = typed `unavailable`);
 * - exposes frozen views and shape-only validation of inbound payloads.
 *
 * Pure module, zero harness dependencies; the bundle build inlines it (stripped
 * of `export`) so the browser wrapper can construct it in script scope.
 *
 * @module
 */

const SNAPSHOT = 'attention.snapshot'
const DELTA = 'attention.delta'

/**
 * Shape-check an inbound attention message (shape-only; host redaction is
 * already applied before this module ever sees the payload).
 * @param {unknown} message
 * @returns {boolean}
 */
export function isValidAttentionMessage(message) {
  if (message === null || typeof message !== 'object') return false
  if (message.kind !== SNAPSHOT && message.kind !== DELTA) return false
  if (typeof message.epoch !== 'number' || typeof message.seq !== 'number') return false
  if (message.kind === SNAPSHOT) return Array.isArray(message.items)
  if (!Array.isArray(message.changes)) return false
  return message.changes.every((entry) => entry !== null
    && typeof entry === 'object'
    && typeof entry.id === 'string'
    && ['add', 'update', 'remove'].includes(entry.op))
}

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

/**
 * Create the browser attention runtime.
 *
 * @param {object} [options]
 * @param {{ subscribe: (listener) => () => void } | null} [options.receive] - attention messages channel.
 * @param {((request: object) => (Promise<object> | object)) | null} [options.send] - client→host requests.
 * @param {(() => (Promise<{items: object[], epoch: number, seq: number} | null> | {items: object[], epoch: number, seq: number} | null)) | null} [options.fetchSnapshot]
 * @param {{ subscribe: (listener) => () => void } | null} [options.onReset] - connection/reset channel.
 * @param {object} [options.logger]
 * @returns {object}
 */
export function createBrowserAttentionRuntime(options = {}) {
  const receive = options.receive ?? null
  const send = options.send ?? null
  const fetchSnapshot = options.fetchSnapshot ?? null
  const onReset = options.onReset ?? null
  const logger = options.logger

  /** @type {Map<string, object>} item id → redacted public item (with seq) */
  const items = new Map()
  const listeners = new Set()

  let viewEpoch = 0
  let hostEpoch = 0
  let disposed = false
  let lastError = null

  function log(message) {
    try {
      logger?.debug?.(`client-runtime: ${message}`)
    } catch {
      // diagnostics never change outcomes
    }
  }

  function statusOf() {
    if (disposed) return { status: 'unavailable', reason: 'runtime disposed' }
    if (receive === null || receive === undefined) {
      return { status: 'unavailable', reason: 'attention delivery pipeline is not active' }
    }
    if (send === null || send === undefined) {
      return { status: 'degraded', reason: 'client-to-host request channel is missing' }
    }
    if (lastError !== null) return { status: 'degraded', reason: lastError }
    return { status: 'active' }
  }

  function sortedItems() {
    return [...items.values()].sort((a, b) => a.seq - b.seq)
  }

  function snapshotView() {
    return deepFreezeValue(sortedItems().map((item) => ({ ...item })))
  }

  function notify(change) {
    const frozen = deepFreezeValue(change)
    for (const listener of [...listeners]) {
      try {
        listener(frozen)
      } catch {
        // one faulty listener never breaks the others
      }
    }
  }

  function applyDelta(message) {
    // A stale host epoch must not overwrite the current face.
    if (message.epoch < hostEpoch) {
      log(`dropping delta from stale host epoch ${message.epoch}`)
      return
    }
    for (const change of message.changes) {
      if (change.op === 'remove') {
        if (!items.delete(change.id)) continue
        notify({ op: 'remove', id: change.id, reason: change.reason })
        continue
      }
      if (change.item === null || change.item === undefined) continue
      const item = { ...change.item }
      const existing = items.get(change.id)
      // dedupe by item id/seq: an already-rendered sequence must not render twice
      if (existing !== undefined && existing.seq === item.seq) continue
      items.set(change.id, item)
      notify({ op: change.op, item: deepFreezeValue(item), id: change.id })
    }
  }

  function ingestSnapshot(message) {
    hostEpoch = message.epoch
    items.clear()
    for (const item of message.items) {
      if (item !== null && typeof item === 'object' && typeof item.id === 'string') {
        items.set(item.id, { ...item })
      }
    }
  }

  /** Rebuild the projection from the host snapshot with a fresh view epoch. */
  async function reload() {
    viewEpoch += 1
    items.clear()
    if (fetchSnapshot === null || fetchSnapshot === undefined) return { ok: true, code: 'rebuilt-empty' }
    try {
      const snapshot = await fetchSnapshot()
      if (snapshot === null || snapshot === undefined) {
        lastError = 'host snapshot refetch returned nothing'
        return { ok: true, code: 'rebuilt-empty', reason: lastError }
      }
      ingestSnapshot({
        kind: SNAPSHOT,
        epoch: snapshot.epoch ?? hostEpoch,
        seq: snapshot.seq ?? 0,
        items: Array.isArray(snapshot.items) ? snapshot.items : [],
      })
      lastError = null
      return { ok: true, code: 'rebuilt' }
    } catch (error) {
      lastError = `host snapshot refetch failed: ${error?.name ?? 'Error'}`
      log(lastError)
      return { ok: true, code: 'rebuilt-empty', reason: lastError }
    }
  }

  // ── subscriptions ─────────────────────────────────────────────────────────
  const unsubscribeHandles = []
  let receiveUnsub = null
  let resetUnsub = null

  function attach() {
    if (disposed) return Promise.resolve({ ok: true, code: 'noop' })
    if (receive !== null && typeof receive.subscribe === 'function') {
      receiveUnsub = receive.subscribe((message) => {
        if (!isValidAttentionMessage(message)) {
          log('dropping malformed attention message')
          return
        }
        if (message.kind === SNAPSHOT) {
          ingestSnapshot(message)
          return
        }
        applyDelta(message)
      })
      if (typeof receiveUnsub === 'function') unsubscribeHandles.push(receiveUnsub)
    }
    if (onReset !== null && typeof onReset.subscribe === 'function') {
      resetUnsub = onReset.subscribe(() => {
        // connection/reset: rebuild from the host snapshot (rebind discipline)
        reload()
      })
      if (typeof resetUnsub === 'function') unsubscribeHandles.push(resetUnsub)
    }
    // an initial rebuild lets the runtime surface existing state immediately
    return reload()
  }

  function dispose() {
    disposed = true
    for (const unsub of unsubscribeHandles) {
      try {
        unsub()
      } catch {
        // idempotent teardown
      }
    }
    unsubscribeHandles.length = 0
    receiveUnsub = null
    resetUnsub = null
    listeners.clear()
    items.clear()
  }

  // ── request forwarding (never queued) ─────────────────────────────────────
  function forward(request) {
    if (disposed) return Promise.resolve({ ok: false, code: 'unavailable', reason: 'runtime disposed' })
    if (send === null || send === undefined) {
      return Promise.resolve({ ok: false, code: 'unavailable', reason: 'client-to-host request channel is missing' })
    }
    try {
      return Promise.resolve(send(request))
    } catch (error) {
      return Promise.resolve({
        ok: false,
        code: 'unavailable',
        reason: `request channel failed: ${error?.name ?? 'Error'}`,
      })
    }
  }

  return {
    current() {
      return snapshotView()
    },

    observe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('attention runtime observe: listener must be a function')
      }
      if (disposed) return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    contribute(spec) {
      return forward({ kind: 'attention.request', op: 'contribute', spec })
    },

    dismiss(itemId, by) {
      return forward({ kind: 'attention.request', op: 'dismiss', itemId, by })
    },

    invoke(itemId, actionId) {
      return forward({ kind: 'attention.request', op: 'invoke', itemId, actionId })
    },

    availability() {
      return deepFreezeValue(statusOf())
    },

    epoch() {
      return viewEpoch
    },

    reload,
    attach,
    dispose,
  }
}