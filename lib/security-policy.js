/**
 * Shared security policy registry: identity, generation, and decision
 * convergence for the `pluginApi.security` faces (policy / redaction /
 * egress). Three face instances reuse this module (design Components 1).
 *
 * Registry contract:
 * - `register(ownerId, spec)` -> `{ generation, dispose }`: typed validation
 *   runs before the entry becomes eligible; disposal is idempotent and
 *   identity-bound (only the caller's current generation is removed). Re-
 *   registering the same owner + id is latest-wins: the older generation is
 *   retired (replaced; historical audit attribution is untouched because
 *   audit records carry the stable policy id, never a mutable snapshot).
 * - `evaluate({ point, context })` -> SecurityDecision | null: freezes the
 *   input snapshot, evaluates matching active policies in insertion order,
 *   converges by `deny > ask > allow`, degrades a throwing/malformed policy
 *   to the point default (never allow), tolerates missing provenance
 *   (provenance-tolerant). Returns null when nothing was consulted (seams then delegate
 *   to the official flow unchanged, no-policy pass-through).
 *
 * Defaults are fail-closed: egress=deny; approval-context=ask;
 * tool-before=ask; model-request-before=ask; redaction=noop (fail-closed defaults).
 */
import { deepFreeze } from './deep-freeze.js'
import {
  SecurityPolicyRegistrationError,
  SecurityRedactionRegistrationError,
  SecurityEgressRegistrationError,
} from './security-errors.js'

export const SECURITY_POINTS = Object.freeze({
  approvalBefore: 'approval-before',
  toolBefore: 'tool-before',
  toolAfter: 'tool-after',
  modelRequestBefore: 'model-request-before',
  egress: 'egress',
})

export const SECURITY_OUTCOMES = Object.freeze(['allow', 'deny', 'ask'])
const OUTCOME_PRECEDENCE = Object.freeze({ allow: 1, ask: 2, deny: 3 })

export const POINT_DEFAULTS = Object.freeze({
  [SECURITY_POINTS.approvalBefore]: 'ask',
  [SECURITY_POINTS.toolBefore]: 'ask',
  [SECURITY_POINTS.toolAfter]: 'noop',
  [SECURITY_POINTS.modelRequestBefore]: 'ask',
  [SECURITY_POINTS.egress]: 'deny',
})

export const POLICY_POINTS = Object.freeze([
  SECURITY_POINTS.approvalBefore,
  SECURITY_POINTS.toolBefore,
  SECURITY_POINTS.modelRequestBefore,
])

export const REDACTION_POINTS = Object.freeze([SECURITY_POINTS.toolAfter])
export const EGRESS_POINT = SECURITY_POINTS.egress

export const REDACTION_AUDIENCES = Object.freeze(['model', 'ui', 'log', 'debug'])
export const REDACTION_ACTIONS = Object.freeze(['redact', 'expose'])
export const EGRESS_KINDS = Object.freeze(['subprocess', 'http', 'mcp', 'remote'])

const MAX_ID = 120
const MAX_REASON = 200
const MAX_DESTINATION = 240
const DEFAULT_ID = '__default__'
const DEFAULT_REASON = 'no policy supplied a reason'

function boundedString(value, label, { max = MAX_ID, optional = true } = {}) {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string') {
    throw new SecurityPolicyRegistrationError(`${label} must be a string`)
  }
  const text = value.trim()
  if (!text) throw new SecurityPolicyRegistrationError(`${label} must not be empty`)
  return text.slice(0, max)
}

function requireFunction(value, label, ErrorClass = SecurityPolicyRegistrationError) {
  if (typeof value !== 'function') {
    throw new ErrorClass(`${label} must be a function`)
  }
  return value
}

function optionalFunction(value, label, ErrorClass = SecurityPolicyRegistrationError) {
  if (value === undefined) return undefined
  if (typeof value !== 'function') {
    throw new ErrorClass(`${label} must be a function when provided`)
  }
  return value
}

function expiresAtOf(spec, ErrorClass = SecurityPolicyRegistrationError) {
  if (spec.expiresAt === undefined) return undefined
  if (typeof spec.expiresAt !== 'number' || !Number.isFinite(spec.expiresAt)) {
    throw new ErrorClass('expiresAt must be a finite number when provided')
  }
  return spec.expiresAt
}

/** Face validator: decision policies bound to the three facade decision points. */
export function validatePolicySpec(spec) {
  if (spec === null || typeof spec !== 'object') {
    throw new SecurityPolicyRegistrationError('policy spec must be an object')
  }
  const point = spec.point
  if (!POLICY_POINTS.includes(point)) {
    throw new SecurityPolicyRegistrationError(
      `policy point must be one of: ${POLICY_POINTS.join(', ')}`,
    )
  }
  const decide = requireFunction(spec.decide, 'policy decide')
  const match = optionalFunction(spec.match, 'policy match')
  return {
    id: boundedString(spec.id, 'policy id'),
    point,
    match,
    decide,
    expiresAt: expiresAtOf(spec),
  }
}

/** Face validator: redaction rules with explicit audience sets. */
export function validateRedactionSpec(spec) {
  if (spec === null || typeof spec !== 'object') {
    throw new SecurityRedactionRegistrationError('redaction rule spec must be an object')
  }
  const audiences = spec.audiences
  if (!Array.isArray(audiences) || audiences.length === 0) {
    throw new SecurityRedactionRegistrationError('audiences must be a non-empty array')
  }
  const set = new Set()
  for (const audience of audiences) {
    if (!REDACTION_AUDIENCES.includes(audience)) {
      throw new SecurityRedactionRegistrationError(
        `audience must be one of: ${REDACTION_AUDIENCES.join(', ')}`,
      )
    }
    set.add(audience)
  }
  if (set.size !== audiences.length) {
    throw new SecurityRedactionRegistrationError('audiences must not contain duplicates')
  }
  const action = spec.action ?? 'redact'
  if (!REDACTION_ACTIONS.includes(action)) {
    throw new SecurityRedactionRegistrationError(
      `redaction action must be one of: ${REDACTION_ACTIONS.join(', ')}`,
    )
  }
  if (spec.mayTouchSecret !== undefined && typeof spec.mayTouchSecret !== 'boolean') {
    throw new SecurityRedactionRegistrationError('mayTouchSecret must be a boolean when provided')
  }
  return {
    id: boundedString(spec.id, 'rule id'),
    audiences: Object.freeze([...set]),
    match: requireFunction(spec.match, 'rule match', SecurityRedactionRegistrationError),
    action,
    mayTouchSecret: spec.mayTouchSecret === true,
  }
}

/** Face validator: egress target match + allowance decision (default deny). */
export function validateEgressSpec(spec) {
  if (spec === null || typeof spec !== 'object') {
    throw new SecurityEgressRegistrationError('egress policy spec must be an object')
  }
  const match = requireFunction(spec.match, 'egress match', SecurityEgressRegistrationError)
  const decide = requireFunction(spec.decide, 'egress decide', SecurityEgressRegistrationError)
  return {
    id: boundedString(spec.id, 'egress policy id'),
    match,
    decide,
    expiresAt: expiresAtOf(spec, SecurityEgressRegistrationError),
  }
}

/** Describe a bounded, JSON-safe egress target (lease scope scoping key). */
export function describeTarget(target) {
  if (target === null || typeof target !== 'object') {
    throw new SecurityEgressRegistrationError('egress target must be an object')
  }
  const kind = target.kind
  if (!EGRESS_KINDS.includes(kind)) {
    throw new SecurityEgressRegistrationError(`egress kind must be one of: ${EGRESS_KINDS.join(', ')}`)
  }
  const destination = target.destination
  if (typeof destination !== 'string' || !destination.trim()) {
    throw new SecurityEgressRegistrationError('egress destination must be a non-empty string')
  }
  return {
    kind,
    destination: destination.trim().slice(0, MAX_DESTINATION),
  }
}

function opaque(rng) {
  return typeof rng === 'function'
    ? rng()
    : `opaque-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function degradeReason(message) {
  const text = String(message ?? 'policy evaluation failed')
  return `degraded: ${text.slice(0, MAX_REASON)}`
}

/**
 * Create one registry instance (shared by the three faces).
 *
 * @param {object} options
 * @param {(spec: unknown) => object} options.validateSpec face validator
 * @param {string} [options.point] registry-bound point for faces whose specs
 *   carry no explicit point (redaction -> tool-after, egress -> egress)
 * @param {() => number} [options.now] timestamp source (default Date.now)
 * @param {() => string} [options.rng] opaque token source
 * @param {(ownerId: string, policyId: string, error: unknown) => void} [options.onPolicyError]
 */
export function createSecurityRegistry({ validateSpec, point, now = Date.now, rng, onPolicyError } = {}) {
  if (typeof validateSpec !== 'function') {
    throw new SecurityPolicyRegistrationError('validateSpec is required')
  }
  const boundPoint = point === undefined ? undefined : point // registry-bound face point
  const entries = new Map() // key -> record
  const order = [] // insertion order of keys
  const resolveKey = (ownerId, policyId) => `${ownerId}\u0000${policyId}`
  const nowValue = () => (typeof now === 'function' ? now() : now)

  const register = (ownerId, spec) => {
    if (typeof ownerId !== 'string' || !ownerId.trim()) {
      throw new SecurityPolicyRegistrationError('ownerId must be a non-empty string')
    }
    const owner = ownerId.trim().slice(0, MAX_ID)
    const normalized = validateSpec(spec)
    const policyId = normalized.id ?? DEFAULT_ID
    const key = resolveKey(owner, policyId)
    const generation = `${owner}:${opaque(rng)}`

    const prior = entries.get(key)
    if (prior) {
      // latest-wins: the older generation is retired now; historical audit
      // attribution is preserved because records carry the stable policy id.
      prior.active = false
    } else {
      order.push(key)
    }
    const record = {
      key,
      ownerId: owner,
      policyId,
      generation,
      spec: normalized,
      active: true,
    }
    entries.set(key, record)

    let disposed = false
    const dispose = () => {
      if (disposed) return false
      const current = entries.get(key)
      if (!current || current !== record || !current.active) return false
      disposed = true
      record.active = false
      entries.delete(key)
      const idx = order.indexOf(key)
      if (idx !== -1) order.splice(idx, 1)
      return true
    }
    return { generation, dispose }
  }

  /**
   * Evaluate one decision point: freeze the input snapshot, consult matching
   * active policies in insertion order, converge deny > ask > allow, degrade
   * a throwing policy to the point default. Returns null when nothing was
   * consulted (seams keep the official flow unchanged).
   */
  const evaluate = ({ point, context } = {}) => {
    if (point === undefined) {
      throw new SecurityPolicyRegistrationError('evaluate requires a point')
    }
    const snapshot = deepFreeze(context ?? {})
    const consulted = [] // { record, outcome, reason }
    const at = nowValue()

    for (const key of order) {
      const record = entries.get(key)
      if (!record || !record.active) continue
      const spec = record.spec
      // face-bound registries (redaction/egress) have no per-spec point;
      // policy-face specs declare their own point
      const specPoint = spec.point !== undefined ? spec.point : boundPoint
      if (specPoint !== point) continue
      if (spec.expiresAt !== undefined && at >= spec.expiresAt) continue
      try {
        if (typeof spec.match === 'function' && spec.match(snapshot) !== true) continue
        const result = spec.decide(snapshot)
        const outcome = result?.outcome
        if (!SECURITY_OUTCOMES.includes(outcome)) {
          // malformed result: degrade this policy to the point default
          throw new SecurityPolicyRegistrationError('policy decide must return { outcome }')
        }
        const reason = typeof result.reason === 'string' ? result.reason.slice(0, MAX_REASON) : undefined
        consulted.push({ record, outcome, reason })
      } catch (error) {
        // degrade only this policy to the point default; the rest of
        // the evaluation and the hosting operation stay alive.
        try {
          onPolicyError?.(record.ownerId, record.policyId, error)
        } catch {
          // diagnostics must never break decision evaluation (diagnostics reporting)
        }
        consulted.push({
          record,
          outcome: POINT_DEFAULTS[point] ?? POINT_DEFAULTS[SECURITY_POINTS.modelRequestBefore],
          reason: degradeReason(error?.message),
          degraded: true,
        })
      }
    }

    if (consulted.length === 0) return null

    let outcome = 'allow'
    for (const vote of consulted) {
      if (OUTCOME_PRECEDENCE[vote.outcome] > OUTCOME_PRECEDENCE[outcome]) outcome = vote.outcome
    }
    // the winner is the first policy that produced the winning outcome; a
    // degraded policy never wins (its vote was the point default)
    const winnerVote = consulted.find((vote) => vote.outcome === outcome && !vote.degraded)
    const degradedVote = consulted.find((vote) => vote.degraded)

    const auditId = `d-${opaque(rng)}`
    const decision = {
      decisionId: auditId,
      auditId,
      point,
      outcome,
      winner: winnerVote?.record.policyId,
      consulted: consulted.map((vote) => vote.record.policyId),
      reason: winnerVote?.reason ?? degradedVote?.reason ?? DEFAULT_REASON,
      expiresAt: winnerVote?.record.spec.expiresAt ?? undefined,
      executionRef: snapshot.executionRef,
      sessionId: snapshot.sessionId,
      at,
      provenance: snapshot.provenance === 'resolved' ? 'resolved' : 'unknown',
    }
    // Non-enumerable audit attribution: owner ids of every consulted policy
    // (kept off the public decision shape).
    Object.defineProperty(decision, 'ownerIds', {
      value: [...new Set(consulted.map((vote) => vote.record.ownerId))],
      enumerable: false,
    })
    return deepFreeze(decision)
  }

  /** Snapshot of currently active entries (ownerId, id, spec) for engines. */
  const snapshot = () => {
    const out = []
    for (const key of order) {
      const record = entries.get(key)
      if (record && record.active) {
        out.push({ ownerId: record.ownerId, id: record.policyId, spec: record.spec })
      }
    }
    return out
  }

  /** Dispose every entry (owner teardown). Returns the removed count. */
  const disposeAll = () => {
    let count = 0
    for (const key of [...order]) {
      const record = entries.get(key)
      if (record?.active) count += 1
      entries.delete(key)
      if (record) record.active = false
    }
    order.length = 0
    return count
  }

  return Object.freeze({
    register,
    evaluate,
    snapshot,
    disposeAll,
  })
}