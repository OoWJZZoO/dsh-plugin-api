/**
 * Wire message family for the attention domain.
 *
 * These messages ride the official host→browser event stream extended by the
 * api-remotes replacement module; they never enter the consumer-side
 * `ctx.remote.$on` legal key set (kept at the reproduced official allowlist).
 * Third-party consumers reach attention content only through
 * `ctx.pluginApi.attention`.
 *
 * Pure declarations; zero harness dependencies.
 *
 * @module
 */

/** Host event name produced by the attention hub and forwarded by the slice. */
export const ATTENTION_UPDATE_EVENT = 'attention/update'

/** Host event name for a hub-originated full snapshot (rebind/refetch path). */
export const ATTENTION_SNAPSHOT = 'attention.snapshot'

/** Host event name for a hub-originated incremental change. */
export const ATTENTION_DELTA = 'attention.delta'

/** Message kinds of an attention update. */
export const ATTENTION_KINDS = Object.freeze([ATTENTION_SNAPSHOT, ATTENTION_DELTA])

/** Change operations inside a delta message. */
export const ATTENTION_OPS = Object.freeze(['add', 'update', 'remove'])

/**
 * Build a typed update message frame. Returns null when the payload cannot be
 * produced cleanly (fail-closed).
 * @param {object} args
 * @param {'attention.snapshot'|'attention.delta'} args.kind
 * @param {number} args.epoch - hub epoch at emission time.
 * @param {number} args.seq - hub monotonic sequence at emission time.
 * @param {Array} [args.changes] - `{op, item?, id?, reason?}` delta entries.
 * @param {Array} [args.items] - snapshot items (frozen, redacted payloads).
 * @returns {object | null}
 */
export function buildAttentionUpdate({ kind, epoch, seq, changes, items }) {
  try {
    if (!ATTENTION_KINDS.includes(kind)) return null
    const message = {
      kind,
      epoch: Number(epoch),
      seq: Number(seq),
    }
    if (kind === ATTENTION_SNAPSHOT) {
      if (!Array.isArray(items)) return null
      message.items = items.map((item) => ({ ...item }))
    } else if (Array.isArray(changes)) {
      message.changes = changes.map((change) => {
        const entry = { op: change.op, id: String(change.id) }
        if (change.item !== undefined) entry.item = { ...change.item }
        if (change.reason !== undefined) entry.reason = change.reason
        return entry
      })
    }
    const json = JSON.stringify(message)
    if (typeof json !== 'string') return null
    return deepFreezeWire(message)
  } catch {
    return null
  }
}

/**
 * Best-effort deep freeze that never throws.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepFreezeWire(value, seen = new WeakSet()) {
  try {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
    if (seen.has(value)) return value
    if (Object.isFrozen(value)) return value
    seen.add(value)
    for (const key of Object.keys(value)) deepFreezeWire(value[key], seen)
    return Object.freeze(value)
  } catch {
    return value
  }
}

/**
 * Shape-check an inbound attention update message (browser-side validation is
 * shape-only validation).
 * @param {unknown} message
 * @returns {boolean}
 */
export function isValidAttentionUpdate(message) {
  if (message === null || typeof message !== 'object') return false
  const kind = message.kind
  if (kind !== ATTENTION_SNAPSHOT && kind !== ATTENTION_DELTA) return false
  if (typeof message.epoch !== 'number' || typeof message.seq !== 'number') return false
  if (kind === ATTENTION_SNAPSHOT) return Array.isArray(message.items)
  return Array.isArray(message.changes) && message.changes.every((entry) => {
    if (entry === null || typeof entry !== 'object') return false
    if (!ATTENTION_OPS.includes(entry.op)) return false
    return typeof entry.id === 'string'
  })
}