/**
 * Bounded audit log for the B facade.
 *
 * Appends bounded entries (who/what/when/generation). No raw tokens or
 * session content. Pure functions, zero harness dependencies.
 */
import { DEFAULT_REPLAY_WINDOW_EVENTS } from './session-channel-shared.js'

/**
 * Create a bounded audit log.
 * @param {number} [maxEntries = 1000]
 * @returns {object} { append, entries, snapshot, clear }
 */
export function createAuditLog(maxEntries = 1000) {
  const log = []

  const append = (entry) => {
    if (!entry || typeof entry !== 'object') return
    log.push({
      who: typeof entry.who === 'string' ? entry.who : 'unknown',
      what: typeof entry.what === 'string' ? entry.what.slice(0, 128) : 'unknown action',
      when: Date.now(),
      generation: typeof entry.generation === 'string' ? entry.generation : undefined,
    })
    if (log.length > maxEntries) log.shift()
  }

  const entries = () => [...log]

  const snapshot = (limit = 100) => {
    const items = log.length > limit ? log.slice(-limit) : [...log]
    return items
  }

  const clear = () => { log.length = 0 }

  return Object.freeze({ append, entries, snapshot, clear })
}