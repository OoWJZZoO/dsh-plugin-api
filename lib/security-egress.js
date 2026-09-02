/**
 * Egress policy core for `pluginApi.security.egress`.
 *
 * The cooperative surface is an asynchronous coordination entry returning a
 * typed `Outcome<Lease>`; the lease credential is frozen with `id` /
 * `resource` / `generation` / `fencingToken` / `expiresAt` and carries no
 * `dispose()` and no legacy `revoke()`. Give-back is the idempotent
 * `release(handle)` verb; a stale handle returns a typed `code: 'conflict'`
 * with the stale condition in `reason`.
 *
 * Internal automatic enforcement uses `admit(target, context)`: it normalizes
 * the target, evaluates the policy registry and returns a bounded internal
 * authorization suitable for the owning official component. The face is a
 * **denylist**: an empty registry (and therefore the initial state, which
 * registers no policy at all) allows every outbound target exactly as the
 * official runtime does; only an explicit deny policy blocks. Proxy
 * environment configuration is never consulted as an allowance (proxy
 * neutrality).
 */
import { SecurityEgressRegistrationError } from './security-errors.js'
import { createSecurityRegistry, describeTarget, validateEgressSpec, SECURITY_POINTS } from './security-policy.js'
import { deepFreeze } from './deep-freeze.js'

const DEFAULT_ALLOW_REASON = 'no egress policy denies this target'

function sameTarget(left, right) {
  return left.kind === right.kind && left.destination === right.destination
}

function opaque(rng) {
  return typeof rng === 'function'
    ? rng()
    : `opaque-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function observedAt(now) {
  try {
    const value = typeof now === 'function' ? now() : new Date()
    const date = value instanceof Date ? value : new Date(value)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  } catch {
    // Fall through to a local timestamp.
  }
  return new Date().toISOString()
}

function read(value, key) {
  try {
    return value?.[key]
  } catch {
    return undefined
  }
}

function boundedString(value, max = 160) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  return text ? text.slice(0, max) : undefined
}

export function createSecurityEgress({ now = Date.now, rng, onPolicyError } = {}) {
  const registry = createSecurityRegistry({
    validateSpec: validateEgressSpec,
    point: SECURITY_POINTS.egress,
    now,
    rng,
    onPolicyError,
  })
  // { id, resource, target, generation, fencingToken, expiresAt, revoked }
  const leases = []
  const nowValue = () => (typeof now === 'function' ? now() : now)

  const resourceOf = (described) => `egress:${described.kind}:${described.destination}`

  const activeLeaseFor = (target) => {
    const at = nowValue()
    return leases.find(
      (lease) => !lease.revoked && lease.expiresAt > at && sameTarget(lease.target, target),
    )
  }

  /**
   * Build the denylist baseline decision: no policy denies the target, so the
   * outbound behaves exactly as the official runtime does (allow).
   */
  const defaultAllow = (target) => {
    const auditId = `d-${opaque(rng)}`
    const decision = {
      decisionId: auditId,
      auditId,
      point: SECURITY_POINTS.egress,
      outcome: 'allow',
      winner: undefined,
      consulted: [],
      reason: DEFAULT_ALLOW_REASON,
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
   * `policyId`/`reason`/`expiresAt`/`auditId` (check). The face is a denylist:
   * an active lease for the exact target allows, and otherwise only an
   * explicit deny policy blocks; a target that survives the registry falls
   * back to the allow baseline.
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
    const decision = registry.evaluate({
      point: SECURITY_POINTS.egress,
      context: { target: described, kind: described.kind, destination: described.destination, provenance: 'resolved' },
    })
    if (decision) return decision
    return defaultAllow(described)
  }

  const evaluatedDecision = (described) => registry.evaluate({
    point: SECURITY_POINTS.egress,
    context: { target: described, kind: described.kind, destination: described.destination, provenance: 'resolved' },
  }) ?? defaultAllow(described)

  /**
   * Cooperative coordination entry. `request` carries `{ target, ttlMs }`.
   * Runs a fresh policy evaluation; a target denied by policy returns a typed
   * denied outcome. A successful acquire returns a frozen lease credential
   * bound to the exact normalized target.
   */
  const acquire = async (request) => {
    const at = observedAt(now)
    const ttl = read(request, 'ttlMs')
    if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0) {
      return deepFreeze({
        ok: false,
        code: 'invalid-input',
        reason: 'lease ttlMs must be a positive finite number',
        operation: 'acquire',
        observedAt: at,
      })
    }
    let described
    try {
      described = describeTarget(read(request, 'target'))
    } catch (error) {
      return deepFreeze({
        ok: false,
        code: 'invalid-input',
        reason: boundedString(error?.message ?? 'egress target is invalid', 240) ?? 'egress target is invalid',
        operation: 'acquire',
        observedAt: at,
      })
    }
    const resource = resourceOf(described)
    const decision = evaluatedDecision(described)
    if (decision.outcome !== 'allow') {
      return deepFreeze({
        ok: false,
        code: 'denied',
        resource,
        reason: decision.reason ?? 'egress policy denied this target',
        operation: 'acquire',
        decisionId: decision.auditId,
        observedAt: at,
      })
    }
    // Supersede any prior lease of the same target (fresh, non-retroactive grant).
    for (const lease of leases) {
      if (sameTarget(lease.target, described)) lease.revoked = true
    }
    const id = `lease:${opaque(rng)}`
    const lease = {
      id,
      resource,
      target: described,
      generation: `lease:${opaque(rng)}`,
      fencingToken: `fence:${opaque(rng)}`,
      expiresAt: nowValue() + ttl,
      revoked: false,
      decisionId: decision.auditId,
    }
    leases.push(lease)
    const handle = deepFreeze({
      id: lease.id,
      resource: lease.resource,
      generation: lease.generation,
      fencingToken: lease.fencingToken,
      expiresAt: new Date(lease.expiresAt).toISOString(),
    })
    return deepFreeze({
      ok: true,
      code: 'acquired',
      resource,
      operation: 'acquire',
      handle,
      decisionId: decision.auditId,
      observedAt: at,
    })
  }

  /**
   * Cooperative give-back verb. Idempotent: an unknown, already-released or
   * expired handle is a typed `conflict` outcome with the stale condition in
   * `reason`; a stale release never touches a newer generation.
   */
  const release = async (handle) => {
    const at = observedAt(now)
    const id = boundedString(read(handle, 'id'), 160)
    if (!id) {
      return deepFreeze({
        ok: false,
        code: 'invalid-input',
        reason: 'lease handle must carry an id',
        operation: 'release',
        observedAt: at,
      })
    }
    const lease = leases.find((entry) => entry.id === id)
    if (!lease) {
      return deepFreeze({
        ok: false,
        code: 'conflict',
        reason: 'unknown or stale lease handle',
        operation: 'release',
        observedAt: at,
      })
    }
    if (lease.revoked) {
      return deepFreeze({
        ok: false,
        code: 'conflict',
        reason: 'lease already released',
        resource: lease.resource,
        operation: 'release',
        observedAt: at,
      })
    }
    if (lease.expiresAt <= nowValue()) {
      return deepFreeze({
        ok: false,
        code: 'conflict',
        reason: 'lease expired',
        resource: lease.resource,
        operation: 'release',
        observedAt: at,
      })
    }
    lease.revoked = true
    return deepFreeze({
      ok: true,
      code: 'released',
      resource: lease.resource,
      operation: 'release',
      observedAt: at,
    })
  }

  /**
   * Internal automatic enforcement entry. Normalizes the target, evaluates the
   * current egress policy generation and returns a bounded authorization bound
   * to the exact normalized target. Denylist: only an explicit deny blocks the
   * outbound; a policy callback failure falls back to the same allow baseline
   * an empty registry would produce, so the official outbound behavior is
   * never tightened by a broken policy.
   */
  const admit = (target, context) => {
    let described
    try {
      described = describeTarget(target)
    } catch (error) {
      // An unnormalizable target cannot match a deny policy either, so it
      // falls back to the same allow baseline instead of tightening the
      // official outbound path.
      return deepFreeze({
        ok: true,
        outcome: 'allow',
        resource: undefined,
        reason: boundedString(error?.message ?? 'egress target is invalid', 240) ?? 'egress target is invalid',
        decisionId: undefined,
      })
    }
    const resource = resourceOf(described)
    let decision
    try {
      decision = evaluatedDecision(described)
    } catch {
      decision = defaultAllow(described)
    }
    if (decision.outcome === 'deny') {
      return deepFreeze({
        ok: false,
        outcome: 'deny',
        resource,
        reason: decision.reason ?? 'egress policy denied this target',
        decisionId: decision.auditId,
      })
    }
    const internal = deepFreeze({
      ok: true,
      outcome: 'allow',
      resource,
      decisionId: decision.auditId,
      // The authorization is bound to the exact normalized target; a redirect,
      // reconnect, retry or new child process must re-admit. No expiry here:
      // automatic enforcement is checked per action at the decision point.
      expiresAt: undefined,
      component: boundedString(read(context, 'component'), 80),
    })
    return internal
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

  return Object.freeze({ registry, check, acquire, release, admit, dispose })
}
