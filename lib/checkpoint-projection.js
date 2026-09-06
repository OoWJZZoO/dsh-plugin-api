/**
 * Checkpoint projection — `list` / `inspect` (requirements §4).
 *
 * Read-only, frozen, host-redacted views over the append-only store. Missing
 * records and missing scope resources are typed absences (never thrown);
 * unknown future schemas surface as `unsupported-schema` (never fabricated).
 * Filtering follows the record's single declared scope — one filter never
 * returns cross-scope results. Records never rewrite history: when the scope
 * resource (session/workspace) is gone or unreachable, the record stays
 * inspectable and the view marks the scope resource `unavailable`
 * (requirements §1).
 */

import { deepFreeze } from './deep-freeze.js'
import { redactRecord } from './checkpoint-record.js'

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

/**
 * Build the checkpoint projection.
 * @param {{ store: object, now?: Function, confirmScopeResource?: Function }} options
 */
export function createCheckpointProjection({ store, now, confirmScopeResource } = {}) {
  const clock = typeof now === 'function' ? now : () => new Date()

  const confirmScope = async (record) => {
    if (typeof confirmScopeResource !== 'function') return { status: 'unknown' }
    try {
      const outcome = await confirmScopeResource(record)
      if (outcome?.status === 'reachable' || outcome?.status === 'unavailable' || outcome?.status === 'unknown') {
        return outcome
      }
    } catch {
      // containment: a probe failure marks unknown, never throws
    }
    return { status: 'unknown' }
  }

  const viewOf = async (record) => {
    const redacted = redactRecord(record)
    const resourceState = await confirmScope(record)
    return deepFreeze({
      ...redacted,
      scope: deepFreeze({
        ...(redacted.scope ?? {}),
        resourceStatus: resourceState.status,
        ...(resourceState.reason ? { resourceReason: String(resourceState.reason).slice(0, 160) } : {}),
      }),
    })
  }

  const api = {
    /** Frozen ordered page with cursor continuation (requirements §4). */
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
      const items = []
      for (const item of page.items) {
        items.push(await viewOf(item))
      }
      return deepFreeze({
        ok: true,
        code: 'listed',
        items,
        ...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
        observedAt: clock().toISOString(),
      })
    },

    /** Full frozen record view (requirements §4 and §2). */
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
      const view = await viewOf(found.record)
      return deepFreeze({
        ok: true,
        code: 'inspected',
        record: view,
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