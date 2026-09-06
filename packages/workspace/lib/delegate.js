/**
 * Thin member-by-member delegation over the official
 * `@deepseek-ai/dsh-workspace@0.1.0-rc.6` `WorkspaceRegistry` (web profile),
 * plus the additive workspace snapshot slice (managed-state capture and a
 * fail-closed official-API reconstruction restore path).
 *
 * # Replication baseline (verified in `docs/specs/checkpoint-restore-contract/workspace-slice-probe.md`):
 * - `WorkspaceRegistry extends Service`, constructor `super(ctx,
 *   'workspaceRegistry')`; startup waits for `storageDomain` +
 *   `sessionPersistence`, completes the one-time history bootstrap, then
 *   becomes active. The replacement instantiates the official registry and
 *   swaps the exposed ctx value to this delegate: every official member
 *   forwards 1:1 with receiver, timing, and typed error identity preserved
 *   (zero re-implementation, no double-run).
 * - Official service face: `create/get/list/delete/insertBefore/
 *   archiveSession/sessionKnown/resolveByPath` + `archivedSessionIds`.
 *   Official entity face: `path/title/createdAt/updatedAt/sessionIds/
 *   setTitle/attachSession/insertSessionBefore/detachSession/status`
 *   (entities are passed through unchanged — they are official objects).
 * - Event face: the official row dispatches NO events; the delegate adds none.
 * - Additive face (this bundle only): `snapshot.capture/get/apply/
 *   availability`. Capture records the authoritative workspace-managed state
 *   (order + records + archive set + per-record directory status) with
 *   per-component statuses. Apply reconstructs the captured state through the
 *   official API queue under the restore operation's fencing, is fail-closed
 *   on anything the official API cannot express (deleted-after-capture
 *   identities are never recreated, unarchiving is unavailable), and never
 *   touches state the workspace row does not own.
 */

import { randomUUID } from 'node:crypto'
import { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'

/** Sole contract symbol between this bundle and the main facade. */
export const WORKSPACE_SLICE_MARKER = Symbol.for('dsh-plugin-api.workspace.contract')

export const SNAPSHOT_SCHEMA = 'workspace.snapshot.state'
export const SNAPSHOT_VERSION = 1

function isObject(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function boundedString(value, max = 160) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  return text ? text.slice(0, max) : undefined
}

/** Canonical fingerprint of a workspace state (stable field subset). */
export function stateFingerprint(state) {
  if (!isObject(state)) return undefined
  const records = Object.keys(state.records ?? {})
    .sort()
    .map((id) => {
      const record = state.records[id] ?? {}
      return { id, path: record.path, title: record.title, sessionIds: record.sessionIds ?? [], createdAt: record.createdAt, updatedAt: record.updatedAt }
    })
  return JSON.stringify({
    workspaceIds: state.workspaceIds ?? [],
    records,
    archivedSessionIds: state.archivedSessionIds ?? [],
  })
}

/**
 * Instantiate the official workspace registry. It self-registers
 * `ctx.workspaceRegistry` (fiber-owned); the caller replaces the exposed
 * value with the delegate.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {InstanceType<typeof WorkspaceRegistry>}
 */
export function createOfficialWorkspaceRegistry(ctx) {
  return new WorkspaceRegistry(ctx)
}

function resolveStorageDomain(ctx) {
  // The official `storage-domain` row is a web-profile row; availability of
  // the snapshot states unit depends on it (headless has no workspace row at
  // all, so this path is only reached in web profiles).
  try {
    const domain = ctx?.storageDomain ?? ctx?.get?.('storageDomain')
    return domain && typeof domain.open === 'function' ? domain : undefined
  } catch {
    return undefined
  }
}

function passThroughSchema() {
  return { parse: (value) => value }
}

/**
 * Snapshot states store over the official storage-domain facility (one
 * owner-scoped unit; states are append-only audit records written once per
 * snapshot id).
 * @param {{ ctx?: object, facility?: object }} options
 */
export function createSnapshotStateStore({ ctx, facility } = {}) {
  let unit
  const openUnit = async () => {
    if (unit) return unit
    const face = facility ?? resolveStorageDomain(ctx)
    if (!face) {
      unit = { ok: false, code: 'unavailable', reason: 'storage domain facility is unavailable' }
      return unit
    }
    try {
      const opened = await face.open({
        name: 'workspace-snapshot-states',
        version: SNAPSHOT_VERSION,
        tables: { states: { valueSchema: passThroughSchema() }, applied: { valueSchema: passThroughSchema() } },
      })
      if (!opened || !opened.table) {
        unit = { ok: false, code: 'unavailable', reason: 'snapshot states unit could not be opened' }
        return unit
      }
      unit = { ok: true, domain: opened }
      return unit
    } catch (error) {
      unit = { ok: false, code: 'unavailable', reason: `snapshot states unit could not be opened: ${error instanceof Error ? error.message : String(error)}` }
      return unit
    }
  }
  return {
    put: async (snapshotId, state) => {
      const opened = await openUnit()
      if (!opened.ok) return opened
      try {
        const table = opened.domain.table('states')
        if (table.get(snapshotId) !== undefined) {
          return { ok: false, code: 'conflict', reason: `snapshot '${snapshotId}' already exists` }
        }
        await table.put(snapshotId, state)
        return { ok: true, code: 'written' }
      } catch (error) {
        return { ok: false, code: 'unavailable', reason: `snapshot state write failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
    get: async (snapshotId) => {
      const opened = await openUnit()
      if (!opened.ok) return opened
      const table = opened.domain.table('states')
      const raw = table.get(snapshotId)
      if (raw === undefined) return { ok: false, code: 'missing', reason: `snapshot '${snapshotId}' does not exist` }
      return { ok: true, state: raw }
    },
    markApplied: async (snapshotId, outcome) => {
      const opened = await openUnit()
      if (!opened.ok) return
      try {
        const table = opened.domain.table('applied')
        await table.put(snapshotId, { snapshotId, ...outcome, appliedAt: new Date().toISOString() })
      } catch {
        // the applied marker is best-effort audit; a failure never changes the result
      }
    },
    availability: () => {
      if (unit === undefined) return { status: 'active' }
      if (unit.ok) return { status: 'active' }
      return { status: 'unavailable', reason: unit.reason }
    },
  }
}

/**
 * Build the workspace delegate over an official (or contract-faithful)
 * registry instance.
 * @param {{
 *   ctx?: object,
 *   official: object,
 *   logger?: object,
 *   store?: object,
 *   idFactory?: Function,
 * }} options
 */
export function buildWorkspaceDelegate({ ctx, official, logger, store, idFactory } = {}) {
  const snapshotStore = store ?? createSnapshotStateStore({ ctx })
  const makeSnapshotId = typeof idFactory === 'function' ? idFactory : () => `snapshot-${randomUUID()}`

  const readCurrent = () => {
    const entries = official.list()
    const records = {}
    for (const entity of entries) {
      records[entity.id] = {
        path: entity.path,
        title: entity.title,
        sessionIds: entity.sessionIds ?? [],
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
      }
    }
    return {
      workspaceIds: entries.map((entity) => entity.id),
      records,
      archivedSessionIds: official.archivedSessionIds ?? [],
    }
  }

  const snapshot = {
    availability: () => {
      try {
        official.list()
      } catch (error) {
        return { status: 'unavailable', reason: `workspace registry is not started: ${error instanceof Error ? error.message : String(error)}` }
      }
      return { status: 'active' }
    },

    /** Capture-point: authoritative workspace-managed state with per-component statuses. */
    capture: async ({ workspaceId, owner } = {}) => {
      try {
        const current = readCurrent()
        const components = [
          { name: 'registry-order', status: 'captured' },
          { name: 'records', status: 'captured' },
          { name: 'archived', status: 'captured' },
        ]
        const snapshotId = makeSnapshotId()
        const state = {
          snapshotId,
          ...(workspaceId ? { workspaceId } : {}),
          ...current,
          ...(owner ? { owner } : {}),
          capturedAt: new Date().toISOString(),
        }
        const written = await snapshotStore.put(snapshotId, state)
        if (!written.ok) {
          return {
            ok: false,
            code: written.code === 'conflict' ? 'conflict' : 'unavailable',
            reason: written.reason ?? 'snapshot state could not be persisted',
            components: [{ name: 'snapshot-state', status: 'unavailable', detail: written.reason }],
          }
        }
        return {
          ok: true,
          anchor: { snapshotId, ...(workspaceId ? { workspaceId } : {}) },
          components,
          capturedAt: state.capturedAt,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          ok: false,
          code: /not started/.test(message) ? 'unavailable' : 'unavailable',
          reason: message,
          components: [{ name: 'workspace-state', status: 'unavailable', detail: message }],
        }
      }
    },

    /** Read one persisted snapshot state. */
    get: async (snapshotId) => {
      const found = await snapshotStore.get(snapshotId)
      if (!found.ok) return found
      return { ok: true, state: found.state }
    },

    /**
     * Apply path (fail-closed official-API reconstruction). Requires the
     * restore operation fencing; validates the state shape; reconstructs the
     * captured state strictly through the official registry queue. Anything
     * the official API cannot express (deleted-after-capture identities,
     * unarchiving) is reported typed partial/unavailable and is never
     * claimed as restored.
     */
    apply: async ({ state, fence, signal } = {}) => {
      if (!isObject(state) || !isObject(state.records) || !Array.isArray(state.workspaceIds)) {
        return { ok: false, code: 'invalid-input', reason: 'a well-formed workspace snapshot state is required' }
      }
      if (!isObject(fence) || typeof fence.fencingToken !== 'string' || !fence.fencingToken) {
        return { ok: false, code: 'denied', reason: 'applying a workspace snapshot requires the restore operation fencing' }
      }
      let current
      try {
        current = readCurrent()
      } catch (error) {
        return { ok: false, code: 'unavailable', reason: `workspace registry is not started: ${error instanceof Error ? error.message : String(error)}` }
      }
      const components = []
      const currentIds = new Set(current.workspaceIds)

      // Order reconstruction (insertBefore is idempotent per target order).
      let orderOk = true
      try {
        for (const id of state.workspaceIds) {
          if (signal?.aborted) break
          const beforeIndex = state.workspaceIds.indexOf(id) + 1
          const beforeId = state.workspaceIds[beforeIndex]
          const entity = official.get(id)
          if (!entity) continue
          const order = await official.insertBefore(id, beforeId)
          if (order.includes(id) !== true) orderOk = false
        }
      } catch (error) {
        orderOk = false
        components.push({ name: 'registry-order', status: 'partial', detail: error instanceof Error ? error.message : String(error) })
      }
      if (orderOk) components.push({ name: 'registry-order', status: 'captured' })

      // Deleted-after-capture identities are never recreated (fail-closed).
      const restorable = []
      const unavailableIds = []
      for (const id of state.workspaceIds) {
        const entity = official.get(id)
        if (!entity) unavailableIds.push(id)
        else restorable.push(entity)
      }
      const recordsComponent = { name: 'records', status: 'captured', ...(unavailableIds.length > 0 ? { status: 'partial', detail: `workspace identities deleted after capture are not recreated: ${unavailableIds.join(', ').slice(0, 120)}` } : {}) }
      components.push(recordsComponent)

      // Records: title + membership reconstruction through the official entity API.
      for (const entity of restorable) {
        if (signal?.aborted) break
        const record = state.records[entity.id]
        if (!record) continue
        try {
          if (entity.title !== record.title) await entity.setTitle(record.title)
          const wanted = record.sessionIds ?? []
          const have = entity.sessionIds ?? []
          for (const sessionId of have) {
            if (!wanted.includes(sessionId)) await entity.detachSession(sessionId)
          }
          for (const [index, sessionId] of wanted.entries()) {
            if (have.includes(sessionId)) continue
            await entity.attachSession(sessionId)
            if (index < wanted.length - 1) await entity.insertSessionBefore(sessionId, wanted[index + 1])
          }
        } catch (error) {
          recordsComponent.status = 'partial'
          recordsComponent.detail = `record '${entity.id}' reconstruction incomplete: ${error instanceof Error ? error.message : String(error)}`
        }
      }

      // Workspaces registered after capture are removed (rewind semantics;
      // directory and session logs are retained by the official delete).
      for (const id of currentIds) {
        if (signal?.aborted) break
        if (state.workspaceIds.includes(id)) continue
        try {
          await official.delete(id)
        } catch (error) {
          recordsComponent.status = 'partial'
          recordsComponent.detail = `workspace '${id}' removal incomplete: ${error instanceof Error ? error.message : String(error)}`
        }
      }

      // Archived set: additions are expressible; removal (unarchive) is NOT an
      // official API capability — a differing archive set is typed partial.
      let archivedOk = true
      try {
        for (const sessionId of state.archivedSessionIds ?? []) {
          const archived = official.archivedSessionIds ?? []
          if (!archived.includes(sessionId)) await official.archiveSession(sessionId)
        }
        const archivedAfter = official.archivedSessionIds ?? []
        const extra = archivedAfter.filter((sessionId) => !(state.archivedSessionIds ?? []).includes(sessionId))
        if (extra.length > 0) {
          archivedOk = false
          components.push({ name: 'archived', status: 'partial', detail: `unarchive is unavailable for: ${extra.join(', ').slice(0, 120)}` })
        } else {
          components.push({ name: 'archived', status: 'captured' })
        }
      } catch (error) {
        archivedOk = false
        components.push({ name: 'archived', status: 'partial', detail: error instanceof Error ? error.message : String(error) })
      }

      const overall = components.some((component) => component.status !== 'captured') ? 'partial' : 'applied'
      const outcome = {
        ok: true,
        code: overall,
        state: stateFingerprint(state),
        components,
        appliedAt: new Date().toISOString(),
      }
      await snapshotStore.markApplied(state.snapshotId ?? 'unknown', outcome)
      return outcome
    },
  }

  const delegate = {
    [WORKSPACE_SLICE_MARKER]: true,
    create: (...args) => official.create(...args),
    get: (id) => official.get(id),
    list: () => official.list(),
    delete: (...args) => official.delete(...args),
    insertBefore: (...args) => official.insertBefore(...args),
    archiveSession: (...args) => official.archiveSession(...args),
    sessionKnown: (...args) => official.sessionKnown(...args),
    resolveByPath: (...args) => official.resolveByPath(...args),
    get archivedSessionIds() {
      return official.archivedSessionIds
    },
    snapshot,
  }
  return delegate
}