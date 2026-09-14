/**
 * image admission constrained image admission policy registry — pluginApi.llm.admission.
 *
 * Harness-free by design: no Cordis, no DSH imports. The registry accepts only
 * the image policy contract `{ id, match, input: 'image', process, validate }`,
 * rejects the legacy `{ id, match, project }` shape, and returns the standard
 * policy handle `{ id, ownerId, generation, dispose() }`. The owner is derived
 * from the caller's context (root token when the caller is untraceable) and the
 * generation is minted here, so a caller never declares either. Same owner +
 * same id is latest-wins; the same id under a different owner is a typed owner
 * conflict.
 *
 * The registry never receives request messages and never determines image
 * presence. Match evaluation happens in the request owner (stream boundary)
 * and in the admission gateway (RPC boundary) from frozen identity snapshots;
 * this module only stores and validates registrations.
 */

import { LlmInputPolicyRegistrationError } from './errors.js'
import { createResourceHandle } from './contract-kernel.js'
import { callerIdentityOf } from './profile-mutation.js'

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

export function createLlmInputPolicyRegistry() {
  const entries = new Map() // token -> entry
  const slots = new Map() // `${ownerId}\u0000${id}` -> token (latest registration)
  const ownerById = new Map() // id -> Set(ownerId) for cross-owner conflict detection
  const mountEpoch = {}
  let sequence = 0
  let generation = 0
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
      // The legacy projection path `{ id, match, project }` is superseded;
      // no compatibility projector path is retained.
      throw new LlmInputPolicyRegistrationError('admission policy must not declare a legacy project callback')
    }
    return { id, input, match, process, validate }
  }

  function register(policy, callerCtx) {
    if (closed) {
      throw new LlmInputPolicyRegistrationError('admission policy registry is disposed')
    }
    const data = validatePolicy(policy)
    const ownerId = callerIdentityOf(callerCtx)
    const owners = ownerById.get(data.id)
    if (owners && owners.size > 0 && !owners.has(ownerId)) {
      throw new LlmInputPolicyRegistrationError(
        `admission policy id "${data.id}" is already registered by another owner`,
      )
    }
    const token = {}
    const entry = Object.freeze({
      ...data,
      ownerId,
      generation: `${ownerId}:${++generation}`,
      token,
      sequence: sequence++,
      epoch: mountEpoch,
    })
    const slotKey = `${ownerId}\u0000${data.id}`
    const previous = slots.get(slotKey)
    if (previous) removeToken(previous)
    slots.set(slotKey, token)
    const currentOwners = ownerById.get(data.id)
    if (currentOwners) currentOwners.add(ownerId)
    else ownerById.set(data.id, new Set([ownerId]))
    entries.set(token, entry)

    return createResourceHandle({
      id: data.id,
      ownerId,
      generation: entry.generation,
      revoke: () => removeToken(token),
    })
  }

  function removeToken(token) {
    const entry = entries.get(token)
    if (!entry) return false
    const slotKey = `${entry.ownerId}\u0000${entry.id}`
    if (slots.get(slotKey) === token) {
      slots.delete(slotKey)
      const owners = ownerById.get(entry.id)
      if (owners) {
        owners.delete(entry.ownerId)
        if (owners.size === 0) ownerById.delete(entry.id)
      }
    }
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
      slots.clear()
      ownerById.clear()
    },
    get size() {
      return entries.size
    },
  }
}
