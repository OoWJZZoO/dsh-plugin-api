/**
 * image admission constrained image admission policy registry — pluginApi.llm.admission.
 *
 * Harness-free by design: no Cordis, no DSH imports. The registry accepts only
 * the image policy contract `{ id, match, input: 'image', process, validate }`,
 * rejects duplicate ids and the legacy `{ id, match, project }` shape, and
 * returns identity-bound disposers whose first call returns `true`.
 *
 * The registry never receives request messages and never determines image
 * presence. Match evaluation happens in the request owner (stream boundary)
 * and in the admission gateway (RPC boundary) from frozen identity snapshots;
 * this module only stores and validates registrations.
 */

import { LlmInputPolicyRegistrationError } from './errors.js'

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

export function createLlmInputPolicyRegistry() {
  const entries = new Map() // token -> entry
  const byId = new Map() // id -> token (latest registration)
  const mountEpoch = {}
  let sequence = 0
  let closed = false

  function validatePolicy(policy) {
    if (!isObject(policy)) {
      throw new LlmInputPolicyRegistrationError('admission policy must be an object')
    }
    const { id, input, match, process, validate } = policy
    if (typeof id !== 'string' || id.trim() === '') {
      throw new LlmInputPolicyRegistrationError('admission policy id must be a non-empty string')
    }
    if (input !== 'image') {
      throw new LlmInputPolicyRegistrationError('admission policy input must be exactly "image"')
    }
    if (typeof match !== 'function' || typeof process !== 'function' || typeof validate !== 'function') {
      throw new LlmInputPolicyRegistrationError('admission policy match, process, and validate must be functions')
    }
    if (policy.detector !== undefined || policy.inspector !== undefined) {
      throw new LlmInputPolicyRegistrationError('admission policy must not declare a detector or inspector')
    }
    if (policy.project !== undefined) {
      // The legacy L1 `{ id, match, project }` projection path is superseded;
      // no compatibility projector path is retained.
      throw new LlmInputPolicyRegistrationError('admission policy must not declare a legacy project callback')
    }
    return { id, input, match, process, validate }
  }

  function register(policy) {
    if (closed) {
      throw new LlmInputPolicyRegistrationError('admission policy registry is disposed')
    }
    const data = validatePolicy(policy)
    if (byId.has(data.id)) {
      throw new LlmInputPolicyRegistrationError(`duplicate admission policy id "${data.id}"`)
    }
    const token = {}
    const entry = Object.freeze({
      ...data,
      token,
      sequence: sequence++,
      epoch: mountEpoch,
    })
    byId.set(data.id, token)
    entries.set(token, entry)

    let disposed = false
    return () => {
      if (disposed) return false
      disposed = true
      return removeToken(token)
    }
  }

  function removeToken(token) {
    const entry = entries.get(token)
    if (!entry) return false
    if (byId.get(entry.id) === token) byId.delete(entry.id)
    return entries.delete(token)
  }

  /** Frozen identity list in successful-registration order (op-start snapshot). */
  function snapshot() {
    return [...entries.values()]
      .sort((a, b) => a.sequence - b.sequence)
      .map((entry) => entry)
  }

  function isAvailable(token) {
    const entry = entries.get(token)
    return Boolean(entry && entry.epoch === mountEpoch)
  }

  return {
    register,
    snapshot,
    isAvailable,
    dispose() {
      if (closed) return
      closed = true
      entries.clear()
      byId.clear()
    },
    get size() {
      return entries.size
    },
  }
}