/**
 * Checkpoint projection — `list` / `inspect` (Requirement 4).
 *
 * Read-only, frozen, host-redacted views over the append-only store. Missing
 * records and missing scope resources are typed absences (never thrown);
 * unknown future schemas surface as `unsupported-schema` (never fabricated).
 * Filtering follows the record's single declared scope — one filter never
 * returns cross-scope results.
 */

import { deepFreeze } from './deep-freeze.js'
import { normalizeScope, redactRecord } from './checkpoint-record.js'

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

/**
 * Build the checkpoint projection.
 * @param {{ store: object, now?: Function }} options
 */
export function createCheckpointProjection({ store, now } = {}) {
  const clock = typeof now === 'function' ? now : () => new Date()

  const api = {
    /** Frozen ordered page with cursor continuation (Requirement 4 AC1). */
    list: async (query = {}) => {
      if (!isObject(query)) {
        return deepFreeze({ ok: false, code: 'invalid-input', reason: 'list query must be an object' })
      }
      const { scope, resourceId, cursor, limit } = query
      let scopeKind
      if (scope !== undefined) {
        if (!['session', 'workspace', 'profile'].includes(scope)) {
          return deepFreeze({ ok: false, code: 'invalid-input', reason: `scope must be one of session, workspace, profile` })
        }
        scopeKind = scope
      }
      if (scopeKind === 'profile') {
        return deepFreeze({ ok: true, code: 'listed', items: [], observedAt: clock().toISOString() })
      }
      if (resourceId !== undefined && typeof resourceId !== 'string') {
        return deepFreeze({ ok: false, code: 'invalid-input', reason: 'resourceId must be a string' })
      }
      const page = await store.list({ scopeKind, resourceId, cursor, limit })
      if (!page.ok) {
        return deepFreeze({ ok: false, code: page.code === 'unsupported-schema' ? 'unsupported-schema' : 'unavailable', reason: page.reason, observedAt: clock().toISOString() })
      }
      return deepFreeze({
        ok: true,
        code: 'listed',
        items: page.items,
        ...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
        observedAt: clock().toISOString(),
      })
    },

    /** Full frozen record view (Requirement 4 AC1/AC5, Requirement 2 AC3). */
    inspect: async (checkpointId) => {
      if (typeof checkpointId !== 'string' || !checkpointId) {
        return deepFreeze({ ok: false, code: 'invalid-input', reason: 'checkpointId must be a non-empty string' })
      }
      const found = await store.get(checkpointId)
      if (!found.ok) {
        if (found.code === 'unsupported-schema') {
          return deepFreeze({ ok: false, code: 'unsupported-schema', reason: found.reason, observedAt: clock().toISOString() })
        }
        return deepFreeze({ ok: false, code: found.code === 'missing' ? 'missing' : 'unavailable', reason: found.reason, observedAt: clock().toISOString() })
      }
      return deepFreeze({
        ok: true,
        code: 'inspected',
        record: redactRecord(found.record),
        observedAt: clock().toISOString(),
      })
    },

    availability: () => {
      const session = store.availability('session')
      const workspace = store.availability('workspace')
      if (session.status === 'active' || workspace.status === 'active') {
        const degraded = session.status !== 'active' || workspace.status !== 'active'
        return deepFreeze({
          status: degraded ? 'degraded' : 'active',
          ...(degraded ? { reason: session.status !== 'active' ? session.reason : workspace.reason } : {}),
        })
      }
      return deepFreeze({ status: 'unavailable', reason: session.reason ?? 'durable record backend is unavailable' })
    },
  }
  return api
}