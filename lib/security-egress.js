/**
 * Egress check + lease core for `pluginApi.security.egress`.
 *
 * opt-in consultation/lease API: `check(target)` evaluates the egress policy
 * registry and returns a converged decision (default deny, fail-closed default);
 * `acquire(target, ttl)` performs the check and, when allowed, mints a
 * time-bounded lease scoped to EXACTLY that target description (lease scope).
 * An active lease authorizes its granted target; expiry or revocation makes
 * subsequent checks fail closed again and never extends retroactively
 * (lease expiry/revocation). Proxy environment configuration is never consulted as an
 * allowance (proxy neutrality); mandatory interception of official outbound paths is
 * an upstream-required boundary that this facade only discloses, never
 * emulates (upstream interception boundary).
 */
import { SecurityEgressDeniedError } from './security-errors.js'
import { createSecurityRegistry, describeTarget, validateEgressSpec, SECURITY_POINTS } from './security-policy.js'
import { deepFreeze } from './deep-freeze.js'

const DEFAULT_DENY_REASON = 'no egress policy allows this target'

function sameTarget(left, right) {
  return left.kind === right.kind && left.destination === right.destination
}

function opaque(rng) {
  return typeof rng === 'function'
    ? rng()
    : `opaque-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function createSecurityEgress({ now = Date.now, rng, onPolicyError } = {}) {
  const registry = createSecurityRegistry({
    validateSpec: validateEgressSpec,
    point: SECURITY_POINTS.egress,
    now,
    rng,
    onPolicyError,
  })
  const leases = [] // { target, generation, expiresAt, revoked, auditId }
  const nowValue = () => (typeof now === 'function' ? now() : now)

  const activeLeaseFor = (target) => {
    const at = nowValue()
    return leases.find(
      (lease) => !lease.revoked && lease.expiresAt > at && sameTarget(lease.target, target),
    )
  }

  // A target that once held a lease is shadowed after expiry/revocation:
  // subsequent checks fail closed (lease expiry/revocation) instead of silently re-authorizing
  // through the policy registry; the caller must re-acquire a fresh grant.
  const deadLeaseFor = (target) => {
    const at = nowValue()
    return leases.find(
      (lease) => sameTarget(lease.target, target) && (lease.revoked || lease.expiresAt <= at),
    )
  }

  /** Build the fail-closed default decision for a denied target. */
  const defaultDeny = (target) => {
    const auditId = `d-${opaque(rng)}`
    const decision = {
      decisionId: auditId,
      auditId,
      point: SECURITY_POINTS.egress,
      outcome: 'deny',
      winner: undefined,
      consulted: [],
      reason: DEFAULT_DENY_REASON,
      expiresAt: undefined,
      executionRef: undefined,
      sessionId: undefined,
      at: nowValue(),
      provenance: 'unknown',
    }
    Object.defineProperty(decision, 'ownerIds', { value: [], enumerable: false })
    return deepFreeze(decision)
  }

  /**
   * Check one outbound target. Returns a converged decision carrying
   * `policyId`/`reason`/`expiresAt`/`auditId` (check). Default is deny;
   * only a policy allow or an active lease for the exact target can allow.
   */
  const check = (target) => {
    const described = describeTarget(target)
    const lease = activeLeaseFor(described)
    if (lease) {
      const auditId = `d-${opaque(rng)}`
      const decision = {
        decisionId: auditId,
        auditId,
        point: SECURITY_POINTS.egress,
        outcome: 'allow',
        winner: undefined,
        consulted: [],
        reason: 'active-lease',
        expiresAt: lease.expiresAt,
        executionRef: undefined,
        sessionId: undefined,
        at: nowValue(),
        provenance: 'unknown',
      }
      Object.defineProperty(decision, 'ownerIds', { value: [], enumerable: false })
      return deepFreeze(decision)
    }
    const dead = deadLeaseFor(described)
    if (dead) {
      const auditId = `d-${opaque(rng)}`
      const decision = {
        decisionId: auditId,
        auditId,
        point: SECURITY_POINTS.egress,
        outcome: 'deny',
        winner: undefined,
        consulted: [],
        reason: dead.revoked ? 'lease-revoked' : 'lease-expired',
        expiresAt: undefined,
        executionRef: undefined,
        sessionId: undefined,
        at: nowValue(),
        provenance: 'unknown',
      }
      Object.defineProperty(decision, 'ownerIds', { value: [], enumerable: false })
      return deepFreeze(decision)
    }
    const decision = registry.evaluate({
      point: SECURITY_POINTS.egress,
      context: { target: described, kind: described.kind, destination: described.destination, provenance: 'resolved' },
    })
    if (decision) return decision
    return defaultDeny(described)
  }

  /**
   * Acquire a time-bounded lease for one target. Runs a fresh policy
   * evaluation (a dead lease never blocks re-acquisition, and the new grant
   * supersedes any prior lease of the same target without retroactive
   * extension); a denied target fails closed with a typed rejection. The
   * returned lease carries the check decision's auditId so grants can reuse
   * it for audit (grant accounting).
   */
  const acquire = (target, ttl) => {
    if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0) {
      throw new SecurityEgressDeniedError('lease ttl must be a positive finite number')
    }
    const described = describeTarget(target)
    const decision = registry.evaluate({
      point: SECURITY_POINTS.egress,
      context: { target: described, kind: described.kind, destination: described.destination, provenance: 'resolved' },
    }) ?? defaultDeny(described)
    if (decision.outcome !== 'allow') {
      throw new SecurityEgressDeniedError(
        `egress denied for ${described.kind} destination "${described.destination}": ${decision.reason ?? DEFAULT_DENY_REASON}`,
      )
    }
    // supersede any prior lease of the same target (fresh, non-retroactive grant)
    for (const lease of leases) {
      if (sameTarget(lease.target, described)) lease.revoked = true
    }
    const lease = {
      target: described,
      generation: `lease:${opaque(rng)}`,
      expiresAt: nowValue() + ttl,
      revoked: false,
      auditId: decision.auditId,
    }
    leases.push(lease)
    let revoked = false
    const revoke = () => {
      if (revoked || lease.revoked) return false
      revoked = true
      lease.revoked = true
      return true
    }
    return {
      lease: Object.freeze({ target: { ...lease.target }, generation: lease.generation, expiresAt: lease.expiresAt }),
      decision,
      revoke,
    }
  }

  /** Retract every active lease (owner teardown). */
  const dispose = () => {
    let count = 0
    for (const lease of leases) {
      if (!lease.revoked) count += 1
      lease.revoked = true
    }
    leases.length = 0
    registry.disposeAll()
    return count
  }

  return Object.freeze({ registry, check, acquire, dispose })
}