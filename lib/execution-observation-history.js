/**
 * Bounded, session-scoped history query for execution projections.
 *
 * History is read-only, ordered by reducer insertion order (explicit ordering
 * metadata, never identity), and may be truncated with a next cursor. It never
 * synthesizes missing lifecycle events and never claims an incomplete history
 * is complete.
 */

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function normalizeLimit(limit) {
  const parsed = Number.isSafeInteger(limit) && limit > 0 ? limit : 50
  return Math.min(parsed, 1000)
}

/**
 * @param {{ reducer: object }} options
 * @returns {{ query: (sessionId: string, options?: { limit?: number, cursor?: string }) => object }}
 */
export function createExecutionHistory({ reducer } = {}) {
  function query(sessionId, options = {}) {
    const id = isNonEmptyString(sessionId) ? sessionId : undefined
    let items = id ? (typeof reducer?.sessionHistory === 'function' ? reducer.sessionHistory(id) : []) : []
    const limit = normalizeLimit(options?.limit)

    if (isNonEmptyString(options?.cursor)) {
      const start = items.findIndex((entry) => entry.executionId === options.cursor)
      if (start !== -1) items = items.slice(start + 1)
    }
    const hasMore = items.length > limit
    const page = hasMore ? items.slice(0, limit) : items
    const nextCursor = hasMore ? page[page.length - 1].executionId : undefined

    return {
      items: page,
      truncated: hasMore,
      nextCursor,
      unavailable: [],
    }
  }

  return { query }
}
