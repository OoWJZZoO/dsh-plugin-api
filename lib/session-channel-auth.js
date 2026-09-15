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

/** Registrations carry no caller context here; the root token is the honest owner. */
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

  const registerVerifier = ({ id, verify }) => {
    if (typeof id !== 'string' || id.length === 0 || typeof verify !== 'function') {
      throw new PluginApiError('PLUGIN_API_CHANNEL_AUTH_SPEC_INVALID', 'a verifier registration needs a non-empty id and a verify function')
    }
    verifiers.set(id, verify)
    return createResourceHandle({
      id,
      ownerId: REGISTRATION_OWNER,
      generation: `${REGISTRATION_OWNER}:${id}:${++registrationSequence}`,
      revoke: () => verifiers.delete(id),
    })
  }

  const registerPairingProvider = ({ id, initiate, approve, reject }) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new PluginApiError('PLUGIN_API_CHANNEL_AUTH_SPEC_INVALID', 'a pairing provider registration needs a non-empty id')
    }
    pairingProviders.set(id, { initiate, approve, reject })
    return createResourceHandle({
      id,
      ownerId: REGISTRATION_OWNER,
      generation: `${REGISTRATION_OWNER}:${id}:${++registrationSequence}`,
      revoke: () => pairingProviders.delete(id),
    })
  }

  const registerAuthorizer = ({ id, authorize }) => {
    if (typeof id !== 'string' || id.length === 0 || typeof authorize !== 'function') {
      throw new PluginApiError('PLUGIN_API_CHANNEL_AUTH_SPEC_INVALID', 'an authorizer registration needs a non-empty id and an authorize function')
    }
    authorizers.set(id, authorize)
    return createResourceHandle({
      id,
      ownerId: REGISTRATION_OWNER,
      generation: `${REGISTRATION_OWNER}:${id}:${++registrationSequence}`,
      revoke: () => authorizers.delete(id),
    })
  }

  const hasVerifier = () => verifiers.size > 0

  const verifyDevice = (deviceCredential, context) => {
    let lastPassing = null
    for (const [, verify] of verifiers) {
      const result = safeVerify(verify, deviceCredential, context)
      if (result == null) continue
      if (result.denied === true) return { denied: true, reason: result.reason ?? 'device verification denied' }
      if (result.deviceId != null) lastPassing = result
    }
    if (lastPassing) return lastPassing
    return { denied: true, reason: 'no verifier accepted the device credential' }
  }

  const authorize = (request) => {
    for (const [, authorizeFn] of authorizers) {
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
