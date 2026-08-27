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
 */

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
