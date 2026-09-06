/**
 * Availability probe for the session activity projection.
 *
 * Contract shape: `{ status: 'active' | 'degraded' | 'unavailable',
 * reason?: string }`, frozen, never throws, health information never mixed
 * in.
 *
 * Fidelity layering:
 * - slice inactive         => degraded + reason `terminal-evidence=reconstructed`
 * - slice version-mismatch => degraded + reason `attempt-facts=version-mismatch`
 * - per-source missing     => degraded with the missing source listed; the
 *   projection stays active for the sources it can serve.
 * - no reachable evidence source at all (neither the live firehose nor a
 *   re-readable durable log) => unavailable.
 */
import { deepFreeze } from './deep-freeze.js'

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

/**
 * Create the availability probe.
 *
 * @param {{ enabled?: boolean, adapters?: object, sliceState?: () => object }} options
 */
export function createSessionActivityAvailability({ enabled = true, adapters, sliceState } = {}) {
  function sample() {
    const reasons = []
    let status = 'active'
    if (enabled !== true) {
      return deepFreeze({ status: 'unavailable', reason: 'feature-disabled' })
    }
    const adaptersAvailability = isObject(adapters?.availability) ? adapters.availability : {}
    const durableUnreachable = adaptersAvailability.durable === 'missing' || adaptersAvailability.durable === undefined
    if (adaptersAvailability.session === 'missing' && durableUnreachable) {
      // neither the live firehose nor a re-readable durable log is reachable:
      // the projection cannot observe anything
      return { status: 'unavailable', reason: 'evidence-sources-unavailable' }
    }
    const degradedGroups = ['session', 'agent', 'tools', 'approval'].filter(
      (group) => adaptersAvailability[group] === 'missing' || adaptersAvailability[group] === 'degraded'
    )
    if (degradedGroups.length > 0) {
      status = 'degraded'
      reasons.push(`sources=${degradedGroups.join(',')}`)
    }
    const slice = typeof sliceState === 'function' ? sliceState() : { active: false, versionMatched: false }
    if (slice.active === true && slice.versionMatched !== true) {
      status = 'degraded'
      reasons.push('attempt-facts=version-mismatch')
    } else if (slice.active !== true) {
      status = 'degraded'
      reasons.push('terminal-evidence=reconstructed')
    }
    return deepFreeze({
      status,
      ...(reasons.length > 0 ? { reason: reasons.join('; ') } : {}),
    })
  }

  return {
    availability: sample,
  }
}