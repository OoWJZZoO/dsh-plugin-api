/**
 * Channel authentication abstraction for the B facade.
 *
 * Pluggable verifier, pairing provider, and authorizer registration.
 * Fail-closed AND composition: all registered verifiers must accept before a
 * device is verified; no verifier registration → `open` returns `unavailable`
 * (the verifier chain is fail-closed). The authorizer chain is optional: when
 * no authorizer is registered every method is authorized. Paradigm-agnostic:
 * approval, PIN, QR, token, custom flows are all representable through the
 * three registration interfaces.
 */
import { CODE_PAIRING_REQUIRED, CODE_DEVICE_DENIED, CODE_SESSION_DENIED, CODE_RESUME_REJECTED, CODE_INTERNAL, typedDenied, DENIED_VARIANTS } from './session-channel-shared.js'

/**
 * Create the auth registry.
 * @returns {object} { registerVerifier, registerPairingProvider, registerAuthorizer, hasVerifier, verifyDevice, authorize, initiatePairing, approvePairing, rejectPairing, dispose }
 */
export function createAuthRegistry() {
  const verifiers = new Map()
  const pairingProviders = new Map()
  const authorizers = new Map()

  const safeCall = (fn, ...args) => {
    try {
      return fn(...args)
    } catch (error) {
      return { denied: true, reason: `verifier error: ${error?.message ?? 'unknown'}` }
    }
  }

  const registerVerifier = ({ id, verify }) => {
    if (typeof id !== 'string' || typeof verify !== 'function') return () => false
    verifiers.set(id, verify)
    return () => { verifiers.delete(id); return true }
  }

  const registerPairingProvider = ({ id, initiate, approve, reject }) => {
    if (typeof id !== 'string') return () => false
    pairingProviders.set(id, { initiate, approve, reject })
    return () => { pairingProviders.delete(id); return true }
  }

  const registerAuthorizer = ({ id, authorize }) => {
    if (typeof id !== 'string' || typeof authorize !== 'function') return () => false
    authorizers.set(id, authorize)
    return () => { authorizers.delete(id); return true }
  }

  const hasVerifier = () => verifiers.size > 0

  const verifyDevice = (deviceCredential, context) => {
    let lastPassing = null
    for (const [id, verify] of verifiers) {
      const result = safeCall(verify, deviceCredential, context)
      if (result == null) continue
      if (result.denied === true) return { denied: true, reason: result.reason ?? 'device verification denied', code: CODE_DEVICE_DENIED }
      if (result.deviceId != null) lastPassing = result
    }
    if (lastPassing) return lastPassing
    return { denied: true, reason: 'no verifier accepted the device credential', code: CODE_DEVICE_DENIED }
  }

  const authorize = (request) => {
    for (const [id, authorizeFn] of authorizers) {
      const result = safeCall(authorizeFn, request)
      if (result == null) continue
      if (result.deny === true) return { deny: true, reason: result.reason ?? 'authorization denied', code: CODE_SESSION_DENIED }
    }
    return { allow: true }
  }

  const initiatePairing = (device, context) => {
    for (const [, provider] of pairingProviders) {
      if (typeof provider.initiate !== 'function') continue
      const result = safeCall(provider.initiate, device, context)
      if (result == null) continue
      if (result.denied === true) return { denied: true, reason: result.reason ?? 'pairing initiation denied', code: CODE_PAIRING_REQUIRED }
      if (result.pendingToken != null) return result
    }
    return { denied: true, reason: 'no pairing provider accepted the pairing request', code: CODE_PAIRING_REQUIRED }
  }

  const approvePairing = (pendingToken) => {
    for (const [, provider] of pairingProviders) {
      if (typeof provider.approve !== 'function') continue
      const result = safeCall(provider.approve, pendingToken)
      if (result != null && result.deviceCredential != null) return result
    }
    return { denied: true, reason: 'pairing approval rejected', code: CODE_PAIRING_REQUIRED }
  }

  const rejectPairing = (pendingToken) => {
    for (const [, provider] of pairingProviders) {
      if (typeof provider.reject === 'function') {
        try { provider.reject(pendingToken) } catch { /* best effort */ }
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