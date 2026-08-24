/**
 * Audience-specific visibility and redaction for execution projections, plus
 * the policy-registry face.
 *
 * The visibility face is an independent owner from the projection face (they
 * share no private state). Defaults are fail-closed: fields stay omitted unless
 * the audience default or an explicit policy allows them, and secret fields
 * are denied unless an explicit secret policy is present. A policy throw or a
 * redaction failure degrades only that decision point to the default denial.
 */
import { deepFreeze } from './deep-freeze.js'

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

const DEFAULT_ALLOW = {
  model: ['executionId', 'outcome', 'outcomeReason', 'phase', 'settled', 'closed', 'disposed'],
  ui: ['executionId', 'sessionId', 'outcome', 'outcomeReason', 'phase', 'settled', 'closed', 'disposed', 'sourceAvailability', 'provenance'],
  log: ['executionId', 'outcome', 'phase', 'settled'],
  debug: ['executionId', 'sessionId', 'agentId', 'parentExecutionId', 'cause', 'outcome', 'outcomeReason', 'phase', 'attempt', 'settled', 'closed', 'disposed', 'sourceAvailability', 'provenance', 'observerEpoch'],
}

const SECRET_FIELD = /(secret|credential|token|authorization|auth|password|private)/i

/**
 * Create the visibility registry.
 *
 * @returns {{ register: (spec: object) => () => boolean, redact: (projection: object, options?: object) => object }}
 */
export function createExecutionVisibility() {
  const entries = new Map() // token -> entry
  const byId = new Map() // id -> token

  function register(spec) {
    if (!isObject(spec)) throw new TypeError('visibility policy must be an object')
    const { id, ownerId, generation, filter } = spec
    if (!isNonEmptyString(id)) throw new TypeError('visibility policy id is required')
    if (!isNonEmptyString(ownerId)) throw new TypeError('visibility policy ownerId is required')
    if (typeof filter !== 'function') throw new TypeError('visibility policy filter must be a pure function')
    if (byId.has(id)) throw new TypeError(`duplicate visibility policy id "${id}"`)
    const token = {}
    const entry = Object.freeze({
      id,
      ownerId,
      generation: isNonEmptyString(generation) ? generation : '1',
      secret: spec.secret === true,
      filter,
    })
    byId.set(id, token)
    entries.set(token, entry)

    let disposed = false
    return () => {
      if (disposed) return false
      disposed = true
      if (byId.get(entry.id) === token) byId.delete(entry.id)
      return entries.delete(token)
    }
  }

  function policyAllows(field, value) {
    for (const entry of entries.values()) {
      let allowed = false
      try {
        allowed = entry.filter(field, value, { ownerId: entry.ownerId, generation: entry.generation }) === true
      } catch {
        allowed = false
      }
      if (allowed) return { allowed: true, secret: entry.secret }
    }
    return { allowed: false }
  }

  function redact(projection, { audience = 'ui' } = {}) {
    if (!isObject(projection)) return deepFreeze({ redacted: true })
    const normAudience = DEFAULT_ALLOW[audience] ? audience : 'ui'
    const defaults = DEFAULT_ALLOW[normAudience]
    const out = {}
    for (const field of Object.keys(projection)) {
      const isSecret = SECRET_FIELD.test(field)
      const decision = policyAllows(field, projection[field])
      let allowed = defaults.includes(field)
      if (!allowed && decision.allowed) allowed = true
      if (allowed && isSecret && decision.allowed !== true) allowed = false
      if (allowed && isSecret && decision.allowed && decision.secret !== true) allowed = false
      if (!allowed) continue
      try {
        out[field] = projection[field]
      } catch {
        // redaction failure: fail-closed, omit the field
      }
    }
    if (Object.keys(out).length === 0) out.redacted = true
    return deepFreeze(out)
  }

  return { register, redact }
}
