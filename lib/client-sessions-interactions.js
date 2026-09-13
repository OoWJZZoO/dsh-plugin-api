/**
 * Client half of the pending-interaction face.
 *
 * Mirrors the host shapes over the supported client transport: the same
 * discriminated results, the same restricted view fields, and the same honest
 * degradation. The client validates the wire shape only — host-side redaction
 * completes before serialization — and a malformed payload becomes typed
 * `unavailable` rather than a fabricated view. A rebind mid-call degrades to
 * `unavailable` so an older generation never writes into a newer one.
 */
import { boundedText } from './session-interaction-operation-normalize.js'

const OUTCOME_CODES = Object.freeze(['accepted', 'stale', 'rejected', 'denied', 'unavailable'])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function unavailable(reason) {
  return Object.freeze({ ok: false, code: 'unavailable', reason: boundedText(reason ?? 'unavailable') })
}

function validView(value) {
  return isPlainObject(value)
    && typeof value.id === 'string'
    && (value.kind === 'approval' || value.kind === 'question')
    && typeof value.sessionId === 'string'
    && typeof value.summary === 'string'
}

/**
 * Create the client pending-interaction face.
 *
 * @param {object} [options]
 * @param {{request: (method: string, payload: object, opts?: object) => Promise<object>}} [options.transport]
 * @param {() => number} [options.epoch] connection/lifecycle generation
 * @param {object} [options.logger]
 * @param {string} [options.featureName]
 */
export function createClientSessionsInteractions(options = {}) {
  const transport = options.transport ?? null
  const epochOf = options.epoch ?? (() => 0)
  const logger = options.logger
  const featureName = options.featureName ?? 'sessions.interactions'

  const log = (message) => {
    try {
      logger?.warn?.(`dsh-plugin-api ${featureName} client: ${message}`)
    } catch {
      // diagnostics are best-effort
    }
  }

  const call = async (method, payload, opts) => {
    if (transport === null || typeof transport.request !== 'function') {
      log(`${method} without a wired client transport; returning typed unavailable`)
      return { ok: false, code: 'unavailable', reason: 'client transport is not wired' }
    }
    const epochAtCall = epochOf()
    try {
      const raw = await transport.request(method, payload ?? {}, { signal: opts?.signal })
      if (epochOf() !== epochAtCall) return { ok: false, code: 'unavailable', reason: 'connection generation changed during the call' }
      return raw
    } catch (error) {
      log(`${method} transport failed: ${error?.name ?? 'Error'}`)
      return { ok: false, code: 'unavailable', reason: 'client transport request failed' }
    }
  }

  const list = async (input) => {
    const raw = await call('sessions.interactions.list', input)
    if (!isPlainObject(raw) || raw.ok !== true) {
      if (isPlainObject(raw) && raw.ok === false && typeof raw.code === 'string') return Object.freeze({ ...raw })
      return unavailable('malformed interactions list from host')
    }
    const items = Array.isArray(raw.items) ? raw.items : []
    if (!items.every(validView)) return unavailable('malformed interactions list from host')
    return Object.freeze({
      ok: true,
      items: Object.freeze(items.map((view) => Object.freeze({ ...view }))),
      nextCursor: raw.nextCursor ?? null,
      sources: isPlainObject(raw.sources) ? Object.freeze({ ...raw.sources }) : undefined,
    })
  }

  const get = async (input) => {
    const raw = await call('sessions.interactions.get', input)
    if (!isPlainObject(raw)) return unavailable('malformed interaction from host')
    if (raw.ok === true) {
      if (!validView(raw.view)) return unavailable('malformed interaction from host')
      return Object.freeze({ ok: true, view: Object.freeze({ ...raw.view }) })
    }
    if (typeof raw.code === 'string') return Object.freeze({ ...raw })
    return unavailable('malformed interaction from host')
  }

  const respond = async (input, opts) => {
    const raw = await call('sessions.interactions.respond', input, opts)
    if (!isPlainObject(raw) || typeof raw.ok !== 'boolean' || !OUTCOME_CODES.includes(raw.code)) {
      return unavailable('malformed respond outcome from host')
    }
    return Object.freeze({ ...raw })
  }

  /**
   * Availability is the host's own self-description (including the per-kind
   * source states), never a probe guess: an empty page can never be displayed
   * as a healthy source.
   */
  const availability = async () => {
    const raw = await call('sessions.interactions.availability', {})
    if (isPlainObject(raw) && (raw.status === 'active' || raw.status === 'degraded' || raw.status === 'unavailable')) {
      return Object.freeze({
        status: raw.status,
        ...(typeof raw.reason === 'string' ? { reason: boundedText(raw.reason) } : {}),
        ...(isPlainObject(raw.sources) ? { sources: Object.freeze({ ...raw.sources }) } : {}),
      })
    }
    return Object.freeze({ status: 'unavailable', reason: 'the pending-interaction source is unreachable' })
  }

  return Object.freeze({ list, get, respond, availability })
}

export { OUTCOME_CODES as RESPOND_OUTCOME_CODES }
