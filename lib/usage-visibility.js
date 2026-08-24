/**
 * Usage visibility/redaction owner for the pluginApi.usage surface.
 *
 * Applies audience-specific redaction to usage records/projections before
 * ledger projection, threshold notification, log or client publication.
 * Default minimum exposure: model/tool output omits internal usage
 * diagnostics; UI omits secret-bearing fields; logs carry only bounded
 * usage/cost summaries. Non-secret fields exposed to a permitted audience
 * retain source, timestamp, certainty, pricing revision and scope metadata.
 *
 * Redaction is fail-closed: a classification/redaction failure degrades the
 * value to an explicit unavailable marker and never reveals a secret. A single
 * `register(policy)` face follows the api-shape policy-registry contract: a
 * pure function (explicit inputs, no private state reads, no side effects)
 * carrying ownerId + generation, returning an identity-bound disposer; a
 * policy throw degrades only that decision point to the default.
 *
 * The ledger deliberately stores only metrics/metadata (no prompts, raw tool
 * arguments, credentials or provider authorization data); a defensive nested
 * classifier still drops any secret-shaped field if one ever reaches this
 * owner.
 */

import { deepFreeze } from './deep-freeze.js'

const SECRET_KEY_HINT = /(authori[sz]ation|password|passwd|token|api[_-]?key|secret|credential|private[_-]?key)/i

const AUDIENCES = Object.freeze(['model', 'tool', 'ui', 'log'])

// Per-audience allowlist of non-secret usage fields (minimum default exposure).
const DEFAULT_ALLOWLIST = {
  model: ['scope', 'source', 'provisional', 'totals', 'pricing', 'createdAt', 'settledAt'],
  tool: ['scope', 'source', 'provisional', 'totals', 'pricing', 'createdAt', 'settledAt'],
  ui: ['scope', 'source', 'provisional', 'totals', 'pricing', 'executionId', 'samples', 'createdAt', 'settledAt', 'hasLate'],
  log: ['scope', 'source', 'provisional', 'totals', 'pricing'],
}

const LOG_KEYS = ['scope', 'source', 'provisional', 'totals', 'pricing']
const MODEL_KEYS = ['scope', 'source', 'provisional', 'totals', 'pricing', 'createdAt', 'settledAt']

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Defensive nested classifier: true when the node or any nested key hints at a secret. */
function containsSecret(node, seen = new WeakSet()) {
  if (node === null || typeof node !== 'object') return false
  if (seen.has(node)) return false
  seen.add(node)
  if (Array.isArray(node)) return node.some((item) => containsSecret(item, seen))
  for (const key of Object.keys(node)) {
    if (SECRET_KEY_HINT.test(key)) return true
    if (containsSecret(node[key], seen)) return true
  }
  return false
}

function redactSecrets(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(redactSecrets)
  const out = {}
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_HINT.test(key) || containsSecret(child)) {
      out[key] = deepFreeze({ redacted: true })
    } else {
      out[key] = redactSecrets(child)
    }
  }
  return out
}

export function createUsageVisibility() {
  const policies = new Map() // token -> pure function
  let disposed = false

  function redact(record, { audience } = {}) {
    try {
      if (record === undefined || record === null) {
        return deepFreeze({ unavailable: true, audience })
      }
      const target = AUDIENCES.includes(audience) ? audience : 'tool'
      const keys = target === 'log' ? LOG_KEYS : target === 'model' || target === 'tool' ? MODEL_KEYS : DEFAULT_ALLOWLIST[target]

      // Start from the default allowlist view, then apply registered
      // non-secret policies; any failure fails closed to unavailable.
      let view = buildView(record, keys)
      for (const entry of policies.values()) {
        if (typeof entry.policy !== 'function') continue
        const next = entry.policy(view, { audience: target })
        if (next !== undefined && next !== null) {
          if (containsSecret(next)) throw new Error('policy attempted to expose secret material')
          view = next
        }
      }
      view = redactSecrets(view)
      return deepFreeze(view)
    } catch {
      return deepFreeze({ unavailable: true, audience })
    }
  }

  function buildView(record, keys) {
    const out = {}
    for (const key of keys) {
      if (key in record && record[key] !== undefined) out[key] = record[key]
    }
    return out
  }

  /**
   * register() registers one pure non-secret visibility policy. The policy
   * receives the current redacted view and may re-expose additional non-secret
   * fields; it must not read private state or cause side effects.
   */
  function register(policy, { ownerId, generation } = {}) {
    if (disposed) return () => false
    if (typeof policy !== 'function') throw new TypeError('usage visibility policy must be a function')
    if (typeof ownerId !== 'string' || ownerId.length === 0) {
      throw new TypeError('usage visibility policy requires an ownerId')
    }
    const token = Symbol('usage-visibility-policy')
    const entry = { policy, ownerId, generation: generation ?? null }
    policies.set(token, entry)
    let active = true
    return () => {
      if (!active) return false
      active = false
      policies.delete(token)
      return true
    }
  }

  function dispose() {
    if (disposed) return false
    disposed = true
    policies.clear()
    return true
  }

  return {
    redact,
    register,
    dispose,
    get size() {
      return policies.size
    },
    get disposed() {
      return disposed
    },
  }
}
