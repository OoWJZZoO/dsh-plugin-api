/**
 * Client half of the session request/cancel operation facade.
 *
 * The browser/plugin client face mirrors the host face shapes: `request`,
 * `cancel`, `availability` over the supported client transport. Host-side
 * redaction is completed before serialization; this module only validates the
 * wire shapes (fail-closed: a malformed payload becomes typed `unavailable`,
 * never a fabricated result). The concrete channel entry and wire revision are
 * fixed by the integration wave (the `sessions.channels` transport precedent);
 * absent transport methods degrade to typed `unavailable` and the client never
 * silently queues or drops a request.
 */
import {
  boundedText,
  CANCEL_BY_VALUES,
  CANCEL_OUTCOME_CODES,
  REQUEST_OUTCOME_CODES,
} from './session-interaction-operation-normalize.js'

/** Client-side copy of the shared correlation confidence vocabulary. */
const CORRELATION_CONFIDENCE = Object.freeze(['unknown', 'unavailable'])

function unavailable(reason) {
  return Object.freeze({ ok: false, code: 'unavailable', reason: boundedText(reason ?? 'unavailable') })
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validRequestOutcome(value) {
  if (!isPlainObject(value) || typeof value.ok !== 'boolean') return false
  if (value.ok === true) {
    if (value.code === 'accepted') {
      return isPlainObject(value.operation) && typeof value.operation.id === 'string'
    }
    if (value.code === 'duplicate' || value.code === 'already-running') {
      return isPlainObject(value.operationRef) && typeof value.operationRef.id === 'string'
    }
    return false
  }
  return REQUEST_OUTCOME_CODES.slice(3).includes(value.code) && typeof value.reason === 'string'
}

function validCancelOutcome(value) {
  return isPlainObject(value) && typeof value.ok === 'boolean' && CANCEL_OUTCOME_CODES.includes(value.code)
}

/**
 * Create the client face.
 *
 * @param {object} [options]
 * @param {object} [options.transport]
 *   Client transport seam. Strongly recommended shape:
 *   - `request(method: string, payload: object, opts?: {signal?: AbortSignal}) => Promise<object>`
 *   - `operation: { status(operationId), observe(operationId, listener) }` (optional)
 *   Absent methods degrade to typed unavailable.
 * @param {() => {status: 'active'|'degraded'|'unavailable', reason?: string}} [options.availabilityProbe]
 * @param {() => number} [options.epoch]
 *   Connection/lifecycle generation. Callback/handle sides are stale-guarded
 *   against a changed epoch (rebind produces a new generation).
 * @param {object} [options.logger]
 * @param {string} [options.featureName]
 */
export function createClientSessionInteractionOperation(options = {}) {
  const transport = options.transport ?? null
  const availabilityProbe = options.availabilityProbe ?? (() => (transport?.request ? { status: 'active' } : { status: 'unavailable', reason: 'client transport is not wired' }))
  const epochOf = options.epoch ?? (() => 0)
  const logger = options.logger
  const featureName = options.featureName ?? 'sessions'

  const log = (message) => {
    try {
      logger?.warn?.(`dsh-plugin-api ${featureName} client: ${message}`)
    } catch {
      // diagnostics are best-effort
    }
  }

  const request = async (spec, opts) => {
    if (transport === null || typeof transport.request !== 'function') {
      log('request without a wired client transport; returning typed unavailable')
      return unavailable('client transport is not wired')
    }
    const epochAtCall = epochOf()
    try {
      const raw = await transport.request('sessions.request', spec, { signal: opts?.signal })
      if (!validRequestOutcome(raw)) {
        log('host returned a malformed request outcome; not fabricating a result')
        return unavailable('malformed request outcome from host')
      }
      if (epochOf() !== epochAtCall) {
        // A rebind occurred mid-call: honest unavailable, never a stale write.
        return unavailable('connection generation changed during the request')
      }
      if (raw.ok === true && isPlainObject(raw.operation)) {
        return Object.freeze({
          ...raw,
          operation: Object.freeze({
            id: raw.operation.id,
            ownerId: raw.operation.ownerId ?? null,
            status: () => operationStatus(raw.operation.id, epochAtCall),
            observe: (listener) => observeOperation(raw.operation.id, listener, epochAtCall),
            dispose: () => cancelWith({ sessionId: raw.operation.sessionId, operationId: raw.operation.id, by: 'owner', reason: 'disposed' }, epochAtCall),
          }),
        })
      }
      return Object.freeze({ ...raw })
    } catch (error) {
      log(`request transport failed: ${error?.name ?? 'Error'}`)
      return unavailable('client transport request failed')
    }
  }

  const operationStatus = (operationId, epochAtCall) => {
    if (transport?.operation?.status === undefined || epochOf() !== epochAtCall) {
      return Object.freeze({ phase: 'terminal', terminal: { outcome: 'error', classification: 'unavailable' }, attempt: null, activity: null, observedAt: null })
    }
    try {
      const raw = transport.operation.status(operationId)
      return isPlainObject(raw) ? Object.freeze({ ...raw }) : unavailable('operation status unavailable')
    } catch {
      return unavailable('operation status unavailable')
    }
  }

  const observeOperation = (operationId, listener, epochAtCall) => {
    if (typeof listener !== 'function') return () => false
    if (transport?.operation?.observe === undefined || epochOf() !== epochAtCall) {
      return () => false
    }
    const disposer = transport.operation.observe(operationId, (snapshot) => {
      if (epochOf() !== epochAtCall) return
      try {
        listener(snapshot)
      } catch (error) {
        log(`operation observer threw: ${error?.name ?? 'Error'}`)
      }
    })
    return () => {
      try {
        disposer?.()
      } catch {
        // disposer is best-effort; stale disposers never touch a newer generation
      }
    }
  }

  const cancelWith = (input, epochAtCall) => {
    if (transport === null || typeof transport.request !== 'function') return unavailable('client transport is not wired')
    return transport.request('sessions.cancel', input, {}).then((raw) => {
      if (!validCancelOutcome(raw)) return unavailable('malformed cancel outcome from host')
      if (epochOf() !== epochAtCall) return unavailable('connection generation changed during the cancel')
      return Object.freeze({ ...raw })
    }).catch(() => unavailable('client transport cancel failed'))
  }

  const cancel = (input, opts) => {
    if (transport === null || typeof transport.request !== 'function') return unavailable('client transport is not wired')
    return cancelWith(input, epochOf())
  }

  const availability = () => {
    try {
      const probe = availabilityProbe()
      const status = probe?.status
      if (status === 'active' || status === 'degraded' || status === 'unavailable') {
        return Object.freeze({ status, reason: probe?.reason })
      }
      return Object.freeze({ status: 'unavailable', reason: 'host returned an unknown availability status' })
    } catch {
      return Object.freeze({ status: 'unavailable', reason: 'availability probe failed' })
    }
  }

  return Object.freeze({ request, cancel, availability, availabilityProbe })
}

export { CANCEL_BY_VALUES, CANCEL_OUTCOME_CODES, CORRELATION_CONFIDENCE }