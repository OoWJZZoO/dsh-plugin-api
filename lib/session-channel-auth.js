/**
 * Channel authentication abstraction for the B facade.
 *
 * Pluggable verifier, pairing provider, and authorizer registration.
 * Fail-closed AND composition: all registered verifiers must accept before a
 * device is verified; no verifier registration → `open` returns `unavailable`
 * (the verifier chain is fail-closed). The authorizer chain is optional: when
 * no authorizer is registered every possession-gated method is authorized.
 * Paradigm-agnostic: approval, PIN, QR, token, custom flows are all
 * representable through the three registration interfaces.
 *
 * Failure presentation: callbacks that throw surface only fixed generic
 * denial messages to remote callers; exception details go to the host-side
 * diagnostic sink (`onError`) and never onto the wire.
 *
 * Registration presentation: each `register*` member answers with the standard
 * resource handle and throws a typed error on invalid input (registration
 * idiom); the callbacks' own failures stay contained as described above.
 */
import { PluginApiError } from './errors.js'
import { createResourceHandle } from './contract-kernel.js'

/** The owner token a registration carries when the caller cannot be traced. */
const REGISTRATION_OWNER = 'root'
let registrationSequence = 0

/**
 * Create the auth registry.
 * @param {object} [options]
 * @param {({ stage: string, error: unknown }) => void} [options.onError]
 *   host-side diagnostic sink for plugin callback failures.
 * @returns {object} { registerVerifier, registerPairingProvider, registerAuthorizer,
 *   hasVerifier, verifyDevice, authorize, initiatePairing, approvePairing,
 *   rejectPairing, dispose }
 */
export function createAuthRegistry({ onError } = {}) {
  const verifiers = new Map()
  const pairingProviders = new Map()
  const authorizers = new Map()

  const report = (stage, error) => {
    try { onError?.({ stage, error }) } catch { /* diagnostics never change outcomes */ }
  }

  // Fixed wire-safe denial text; the real message stays host-side via onError.
  const DENIED = (stage) => {
    return { denied: true, reason: `${stage} failed`, code: 'device-denied' }
  }

  const safeVerify = (verify, credential, context) => {
    try {
      return verify(credential, context)
    } catch (error) {
      report('verify', error)
      return DENIED('device verification')
    }
  }

  const safeAuthorize = (authorizeFn, request) => {
    try {
      return authorizeFn(request)
    } catch (error) {
      report('authorize', error)
      return { deny: true, reason: 'authorization denied' }
    }
  }

  /**
   * Claim one slot for one owner.
   *
   * The identity comes from the caller (the facade passes the derived owner,
   * or the root token when the caller cannot be traced); a slot another owner
   * already holds is refused typed rather than taken silently, and the same
   * owner registering again replaces its own entry.
   * @returns {{ ownerId: string } | undefined} undefined when the slot is free
   *   for this owner.
   */
  const claimSlot = (slots, id, ownerId, what) => {
    const previous = slots.get(id)
    if (previous === undefined) return undefined
    if (previous.ownerId !== ownerId) {
      throw new PluginApiError('PLUGIN_API_CHANNEL_AUTH_OWNER_CONFLICT', `${what} "${id}" is owned by another plugin`)
    }
    return undefined
  }

  // Every registration entry normalizes its spec before destructuring: a
  // missing or non-object spec is an illegal input and must fail typed
  // (PLUGIN_API_CHANNEL_AUTH_SPEC_INVALID), never as a bare destructuring
  // TypeError.
  const asSpec = (spec) => (spec !== null && typeof spec === 'object' ? spec : {})

  const registerVerifier = (spec, owner) => {
    const { id, verify } = asSpec(spec)
    if (typeof id !== 'string' || id.length === 0 || typeof verify !== 'function') {
      throw new PluginApiError('PLUGIN_API_CHANNEL_AUTH_SPEC_INVALID', 'a verifier registration needs a non-empty id and a verify function')
    }
    const ownerId = typeof owner === 'string' && owner.length > 0 ? owner : REGISTRATION_OWNER
    claimSlot(verifiers, id, ownerId, 'the verifier')
    const generation = `${ownerId}:${id}:${++registrationSequence}`
    verifiers.set(id, { verify, ownerId, generation })
    return createResourceHandle({
      id,
      ownerId,
      generation,
      revoke: () => (verifiers.get(id)?.generation === generation ? verifiers.delete(id) : false),
    })
  }

  const registerPairingProvider = (spec, owner) => {
    const { id, initiate, approve, reject } = asSpec(spec)
    if (typeof id !== 'string' || id.length === 0) {
      throw new PluginApiError('PLUGIN_API_CHANNEL_AUTH_SPEC_INVALID', 'a pairing provider registration needs a non-empty id')
    }
    const ownerId = typeof owner === 'string' && owner.length > 0 ? owner : REGISTRATION_OWNER
    claimSlot(pairingProviders, id, ownerId, 'the pairing provider')
    const generation = `${ownerId}:${id}:${++registrationSequence}`
    pairingProviders.set(id, { initiate, approve, reject, ownerId, generation })
    return createResourceHandle({
      id,
      ownerId,
      generation,
      revoke: () => (pairingProviders.get(id)?.generation === generation ? pairingProviders.delete(id) : false),
    })
  }

  const registerAuthorizer = (spec, owner) => {
    const { id, authorize } = asSpec(spec)
    if (typeof id !== 'string' || id.length === 0 || typeof authorize !== 'function') {
      throw new PluginApiError('PLUGIN_API_CHANNEL_AUTH_SPEC_INVALID', 'an authorizer registration needs a non-empty id and an authorize function')
    }
    const ownerId = typeof owner === 'string' && owner.length > 0 ? owner : REGISTRATION_OWNER
    claimSlot(authorizers, id, ownerId, 'the authorizer')
    const generation = `${ownerId}:${id}:${++registrationSequence}`
    authorizers.set(id, { authorize, ownerId, generation })
    return createResourceHandle({
      id,
      ownerId,
      generation,
      revoke: () => (authorizers.get(id)?.generation === generation ? authorizers.delete(id) : false),
    })
  }

  const hasVerifier = () => verifiers.size > 0

  const verifyDevice = (deviceCredential, context) => {
    let lastPassing = null
    for (const [, { verify }] of verifiers) {
      const result = safeVerify(verify, deviceCredential, context)
      if (result == null) continue
      if (result.denied === true) return { denied: true, reason: result.reason ?? 'device verification denied' }
      if (result.deviceId != null) lastPassing = result
    }
    if (lastPassing) return lastPassing
    return { denied: true, reason: 'no verifier accepted the device credential' }
  }

  const authorize = (request) => {
    for (const [, { authorize: authorizeFn }] of authorizers) {
      const result = safeAuthorize(authorizeFn, request)
      if (result == null) continue
      if (result.deny === true) return { deny: true, reason: result.reason ?? 'authorization denied' }
    }
    return { allow: true }
  }

  const initiatePairing = (device, context) => {
    for (const [, provider] of pairingProviders) {
      if (typeof provider.initiate !== 'function') continue
      let result
      try {
        result = provider.initiate(device, context)
      } catch (error) {
        report('initiate', error)
        continue
      }
      if (result == null) continue
      if (result.denied === true) return { denied: true, reason: result.reason ?? 'pairing initiation denied' }
      if (result.pendingToken != null) return result
    }
    return { denied: true, reason: 'no pairing provider accepted the pairing request' }
  }

  const approvePairing = (pendingToken) => {
    for (const [, provider] of pairingProviders) {
      if (typeof provider.approve !== 'function') continue
      let result
      try {
        result = provider.approve(pendingToken)
      } catch (error) {
        report('approve', error)
        continue
      }
      if (result != null && result.deviceCredential != null) return result
    }
    return { denied: true, reason: 'pairing approval rejected' }
  }

  const rejectPairing = (pendingToken) => {
    for (const [, provider] of pairingProviders) {
      if (typeof provider.reject === 'function') {
        try { provider.reject(pendingToken) } catch (error) { report('reject', error) }
      }
    }
  }

  const dispose = () => {
    verifiers.clear()
    pairingProviders.clear()
    authorizers.clear()
  }

  return Object.freeze({
    registerVerifier, registerPairingProvider, registerAuthorizer,
    hasVerifier, verifyDevice, authorize, initiatePairing, approvePairing, rejectPairing,
    dispose,
  })
}
