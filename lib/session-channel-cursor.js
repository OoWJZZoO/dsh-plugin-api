/**
 * Session-scoped cursor/replay log for the B facade.
 *
 * Bounded retention (by event count and age), stable event ids and dedupe
 * keys, at-least-once delivery semantics, and `resync-required` when a cursor
 * falls outside the retained window. Pure module (zero harness dependencies).
 *
 * @module
 */
import { DEFAULT_REPLAY_WINDOW_EVENTS, DEFAULT_REPLAY_WINDOW_MS } from './session-channel-shared.js'

/**
 * Create a session-scoped cursor log.
 * @param {object} [options]
 * @param {number} [options.windowEvents]
 * @param {number} [options.windowMs]
 */
export function createSessionCursorLog({ windowEvents = DEFAULT_REPLAY_WINDOW_EVENTS, windowMs = DEFAULT_REPLAY_WINDOW_MS } = {}) {
  const events = []

  const append = (record) => {
    events.push({
      eventId: record.eventId,
      dedupeKey: record.dedupeKey,
      cursor: record.cursor,
      kind: record.kind,
      payload: record.payload,
      emittedAt: record.emittedAt,
    })
    // Bounded retention by event count.
    if (events.length > windowEvents) events.splice(0, events.length - windowEvents)
    // Bounded retention by age.
    const cutoff = Date.now() - windowMs
    while (events.length > 0 && events[0].emittedAt < cutoff) events.shift()
  }

  const findCursor = (cursor) => events.findIndex((event) => event.cursor === cursor)

  const isInWindow = (cursor) => findCursor(cursor) >= 0

  const after = (cursor) => {
    const idx = findCursor(cursor)
    if (idx < 0) return undefined
    return events.slice(idx + 1)
  }

  const size = () => events.length

  const clear = () => { events.length = 0 }

  return Object.freeze({ append, findCursor, isInWindow, after, size, clear })
}