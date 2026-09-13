/**
 * Client half of the selection face.
 *
 * The coordinated mutation keeps its compare-and-set on the host: the client
 * forwards the caller's observed snapshot as `expected`, so a client can never
 * commit a value it did not observe, and the typed outcome (committed /
 * conflict / rejected / unavailable) arrives as-is. A malformed payload from
 * the host becomes typed `unavailable`, never a fabricated selection.
 */
import { boundedText } from './session-interaction-operation-normalize.js'

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function unavailable(reason) {
  return Object.freeze({ ok: false, code: 'unavailable', reason: boundedText(reason ?? 'unavailable') })
}

function validView(value) {
  return isPlainObject(value)
    && typeof value.sessionId === 'string'
    && (value.provider === null || typeof value.provider === 'string')
    && (value.model === null || typeof value.model === 'string')
    && typeof value.revision === 'number'
}

/**
 * Create the client selection face.
 *
 * @param {object} [options]
 * @param {{request: (method: string, payload: object, opts?: object) => Promise<object>}} [options.transport]
 * @param {() => number} [options.epoch] connection/lifecycle generation
 * @param {object} [options.logger]
 * @param {string} [options.featureName]
 */
export function createClientSessionsSelection(options = {}) {
  const transport = options.transport ?? null
  const epochOf = options.epoch ?? (() => 0)
  const logger = options.logger
  const featureName = options.featureName ?? 'sessions.selection'

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

  const get = async (input) => {
    const raw = await call('sessions.selection.get', input)
    if (!isPlainObject(raw)) return unavailable('malformed selection from host')
    if (raw.ok === true) {
      if (!validView(raw.view)) return unavailable('malformed selection from host')
      return Object.freeze({ ok: true, view: Object.freeze({ ...raw.view }) })
    }
    if (typeof raw.code === 'string') return Object.freeze({ ...raw })
    return unavailable('malformed selection from host')
  }

  const set = async (input, opts) => {
    const raw = await call('sessions.selection.set', input, opts)
    if (!isPlainObject(raw) || typeof raw.ok !== 'boolean' || typeof raw.code !== 'string') {
      return unavailable('malformed selection outcome from host')
    }
    if (raw.ok === true && !validView(raw.view)) return unavailable('malformed selection outcome from host')
    return Object.freeze({ ...raw, ...(raw.view === undefined ? {} : { view: Object.freeze({ ...raw.view }) }) })
  }

  /**
   * Availability is the host's own self-description, not a probe guess: the
   * host reports whether the read/submit seams are actually servable, so a
   * degraded host can never be displayed as an active one.
   */
  const availability = async () => {
    const raw = await call('sessions.selection.availability', {})
    if (isPlainObject(raw) && (raw.status === 'active' || raw.status === 'degraded' || raw.status === 'unavailable')) {
      return Object.freeze({ status: raw.status, ...(typeof raw.reason === 'string' ? { reason: boundedText(raw.reason) } : {}) })
    }
    return Object.freeze({ status: 'unavailable', reason: 'the selection availability probe is unavailable' })
  }

  return Object.freeze({ get, set, availability })
}
