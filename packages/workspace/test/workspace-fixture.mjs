/**
 * Contract-faithful in-memory stand-in for the official
 * `@deepseek-ai/dsh-workspace@0.1.0-rc.6` `WorkspaceRegistry` service +
 * entity face (test-only). Implements the exact member surface enumerated in
 * the probe evidence document so parity and reconstruction tests run without
 * a live cordis boot.
 */

import { randomUUID } from 'node:crypto'

export function createOfficialRegistryFixture(initial = {}) {
  const records = new Map()
  const entities = new Map()
  const knownAttached = new Set()
  let order = []
  let archived = []
  const sessionsBelongingTo = (record, path) => {
    // Membership follows the record accounting; the official implementation
    // filters by canonical-cwd index — the fixture keeps it direct.
    return [...record.sessionIds]
  }
  for (const [id, record] of Object.entries(initial.records ?? {})) {
    records.set(id, { ...record, sessionIds: [...(record.sessionIds ?? [])] })
    if (!order.includes(id)) order.push(id)
  }
  archived = [...(initial.archivedSessionIds ?? [])]
  if (initial.workspaceIds) order = [...initial.workspaceIds]

  const registry = {
    create: async (path, title) => {
      for (const entity of registry.list()) {
        if (entity.path === path) return entity
      }
      const id = `workspace-${randomUUID()}`
      const now = new Date().toISOString()
      const record = { path, title: title ?? path.split('/').pop(), sessionIds: [], createdAt: now, updatedAt: now }
      records.set(id, record)
      order.unshift(id)
      return entityOf(id)
    },
    get: (id) => (records.has(id) ? entityOf(id) : undefined),
    list: () => order.map((id) => entityOf(id)),
    delete: async (id) => {
      if (!records.has(id)) return false
      records.delete(id)
      order = order.filter((entry) => entry !== id)
      return true
    },
    insertBefore: async (id, beforeId) => {
      if (!records.has(id)) throw Object.assign(new Error(`cannot reorder unknown workspace '${id}'`), { name: 'WorkspaceOrderInvalidError' })
      if (beforeId !== undefined && !records.has(beforeId)) throw Object.assign(new Error(`cannot reorder unknown workspace '${beforeId}'`), { name: 'WorkspaceOrderInvalidError' })
      const without = order.filter((entry) => entry !== id)
      const at = beforeId === undefined ? without.length : without.indexOf(beforeId)
      order = [...without.slice(0, at), id, ...without.slice(at)]
      return [...order]
    },
    archiveSession: async (sessionId) => {
      if (archived.includes(sessionId)) return
      if (!registry.sessionKnown(sessionId)) throw Object.assign(new Error(`cannot archive session '${sessionId}'`), { name: 'WorkspaceUnknownSessionError' })
      archived.push(sessionId)
    },
    sessionKnown: async (sessionId) => Boolean((initial.knownSessions ?? []).includes(sessionId) || (registry.liveSessions ?? []).includes(sessionId) || knownAttached.has(sessionId)),
    resolveByPath: async (path) => {
      for (const entity of registry.list()) if (entity.path === path) return entity
      return undefined
    },
    get archivedSessionIds() {
      return [...archived]
    },
    // fixture-only helpers
    liveSessions: [],
    _records: records,
    _order: () => [...order],
  }

  function entityOf(id) {
    const cached = entities.get(id)
    if (cached) return cached
    const record = records.get(id)
    if (!record) return undefined
    const entity = {
      id,
      get path() { return record.path },
      get title() { return record.title },
      get createdAt() { return record.createdAt },
      get updatedAt() { return record.updatedAt },
      get sessionIds() { return sessionsBelongingTo(record, record.path) },
      setTitle: async (title) => { record.title = title; record.updatedAt = new Date().toISOString() },
      attachSession: async (sessionId) => {
        if (!record.sessionIds.includes(sessionId)) record.sessionIds.unshift(sessionId)
        knownAttached.add(sessionId)
        record.updatedAt = new Date().toISOString()
      },
      insertSessionBefore: async (sessionId, beforeSessionId) => {
        if (!record.sessionIds.includes(sessionId)) throw Object.assign(new Error(`cannot move session '${sessionId}'`), { name: 'WorkspaceMoveInvalidError' })
        if (beforeSessionId !== undefined && !record.sessionIds.includes(beforeSessionId)) throw Object.assign(new Error(`cannot move session '${sessionId}' before '${beforeSessionId}'`), { name: 'WorkspaceMoveInvalidError' })
        const without = record.sessionIds.filter((entry) => entry !== sessionId)
        const at = beforeSessionId === undefined ? without.length : without.indexOf(beforeSessionId)
        record.sessionIds = [...without.slice(0, at), sessionId, ...without.slice(at)]
        record.updatedAt = new Date().toISOString()
      },
      detachSession: async (sessionId) => {
        record.sessionIds = record.sessionIds.filter((entry) => entry !== sessionId)
        record.updatedAt = new Date().toISOString()
      },
      status: async () => 'ok',
    }
    entities.set(id, entity)
    return entity
  }

  return registry
}

/** In-memory storage-domain facility shaped like the official facility (open + domain tables). */
export function createSnapshotStateFacilityFixture() {
  const tables = new Map()
  const domains = new Map()
  return {
    open: async (spec) => {
      if (domains.has(spec.name)) return { ok: false, code: 'already-open', reason: 'domain already open' }
      const tableMap = new Map()
      for (const name of Object.keys(spec.tables ?? {})) tables.set(`${spec.name}:${name}`, new Map())
      const domain = {
        name: spec.name,
        table: (name) => {
          const map = tables.get(`${spec.name}:${name}`)
          if (!map) return undefined
          return {
            get: (key) => (map.has(key) ? map.get(key) : undefined),
            put: async (key, value) => { map.set(key, value) },
            delete: async (key) => { map.delete(key) },
            keys: () => [...map.keys()],
            entries: () => [...map.entries()],
          }
        },
        close: async () => {},
      }
      domains.set(spec.name, domain)
      return { ok: true, ...domain }
    },
    get: (name) => domains.get(name),
    tables,
  }
}