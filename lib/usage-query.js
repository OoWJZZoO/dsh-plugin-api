/**
 * Read-only query projection owner for the pluginApi.usage surface.
 *
 * Queries the durable ledger by execution, scope (session/workspace/profile),
 * date and provider/model. Each returned record identifies the scope it
 * belongs to; a cross-scope report combines separately owned records but no
 * single record claims multiple scopes. Missing/truncated/provisional states
 * are surfaced explicitly so an incomplete total is never presented as final.
 *
 * This owner is a pure projection: it never writes, never registers pricing,
 * never mutates the ledger, and always returns deep-frozen results. Any query
 * failure is contained and reported as an explicit `unavailable` lacking the
 * data, never thrown through callers.
 */

import { deepFreeze } from './deep-freeze.js'

const MAX_QUERY_ITEMS = 1000

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function matchesDay(record, day) {
  const prefix = record.createdAt.slice(0, 10)
  if (prefix === day) return true
  return record.settledAt !== undefined && record.settledAt.slice(0, 10) === day
}

function matchesProviderModel(record, provider, model) {
  if (provider === undefined && model === undefined) return true
  const samples = record.samples ?? []
  const pricing = record.pricing
  const providerOk =
    provider === undefined ||
    pricing?.provider === provider ||
    samples.some((s) => s.provider === provider)
  const modelOk =
    model === undefined ||
    pricing?.model === model ||
    samples.some((s) => s.model === model)
  return providerOk && modelOk
}

export function createUsageQuery({ ledger }) {
  function allRecords() {
    return ledger.all()
  }

  function select({ executionId, scopes }) {
    const wanted = scopes.length === 0 ? undefined : new Set(scopes)
    return allRecords().filter((r) => {
      if (wanted !== undefined && !wanted.has(r.scope)) return false
      if (executionId !== undefined && r.executionId !== executionId) return false
      return true
    })
  }

  /**
   * query() returns only records authorized for the requested scope(s) and
   * identifies each record's scope. Specifying more than one scope id builds a
   * cross-scope report from separately owned records.
   */
  function query({ executionId, sessionId, workspaceId, profileId, day, provider, model, limit } = {}) {
    try {
      if (ledger.disposed) {
        return deepFreeze({ items: [], scopes: [], truncated: false, provisional: false, unavailable: true })
      }
      const scopes = []
      if (sessionId !== undefined) scopes.push('session')
      if (workspaceId !== undefined) scopes.push('workspace')
      if (profileId !== undefined) scopes.push('profile')
      if (scopes.length === 0 && !executionId) {
        return deepFreeze({ items: [], scopes: [], truncated: false, provisional: false, unavailable: false })
      }

      let items = select({ executionId, scopes })
      if (day !== undefined) items = items.filter((r) => matchesDay(r, day))
      if (provider !== undefined || model !== undefined) {
        items = items.filter((r) => matchesProviderModel(r, provider, model))
      }

      const cap = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : MAX_QUERY_ITEMS
      const truncated = items.length > cap
      const boundedItems = truncated ? items.slice(0, cap) : items
      const provisional = boundedItems.some((r) => r.provisional)

      return deepFreeze({
        items: deepFreeze(boundedItems),
        scopes: deepFreeze([...scopes]),
        truncated,
        provisional,
        unavailable: false,
      })
    } catch {
      return deepFreeze({ items: [], scopes: [], truncated: false, provisional: false, unavailable: true })
    }
  }

  return { query }
}
