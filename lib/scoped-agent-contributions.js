import { PluginApiInactiveError, PluginApiFeatureDisabledError } from './errors.js'

/**
 * Scoped agent contributions registry (target-dimension contributions).
 *
 * Official `tools` and `systemPrompt` are host-singleton services whose
 * per-agent behavior comes from scoped layers keyed by the agent's own
 * context (`scopeOf(ctx)`), so a contribution for ONE agent is installed by
 * invoking the official service through the target agent's context. The
 * scope handle captures the target identity (a stable session id, not the
 * agent object); the target context is re-resolved lazily at every install
 * so an in-process resume of the same identity re-installs into the new
 * agent instance's scoped layer.
 *
 * The registry holds runtime records only (no durable agent scope tier):
 * `agent/created` re-installs dormant/live records for a re-announced
 * identity, `agent/disposed` evicts the target's records — the official
 * scoped registrations die with the old agent fiber, the facade bookkeeping
 * goes dormant (zero assembly effect for the dead target) and stays as the
 * resume re-installation source, because the official in-process resume path
 * drains the old identity (agent/disposed AND session/disposed) before it
 * re-announces the same id, so a disposal-time purge would make Requirement
 * 5.2 unreachable. Bookkeeping is physically removed by the contribution
 * handle dispose, the scope handle dispose, or the owner's fiber teardown
 * (the scope handle itself is bound to the contributor fiber), so per-owner
 * state is bounded by the owner's live scope handles. Every internal
 * lifecycle listener contains its own faults — a synchronous throw from an
 * `agent/created` listener vetoes official agent publication, and this
 * registry must never become that veto source.
 */

export const SCOPED_PROMPT_KINDS = Object.freeze({
  section: { member: 'section', args: (spec) => [spec.section ?? spec] },
  context: { member: 'context', args: (spec) => [spec.context ?? spec] },
  variable: { member: 'variable', args: (spec) => [spec.name, spec.provider] },
  tools: { member: 'tools', args: (spec) => [spec.provider ?? spec] },
  suppressRuntimeContext: { member: 'suppressRuntimeContext', args: () => [] },
})

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const recordKeyOf = (ownerId, kind, contributionId) => `${ownerId}\u0000${kind}\u0000${contributionId}`

export function createScopedAgentContributionRegistry({
  active,
  agentsProvider,
  resolveOwnerId,
  reportDiagnostics = () => {},
}) {
  let sequence = 0
  /** handleId → { ownerId, targetId, generation, disposed, handle } */
  const scopes = new Map()
  /** minted handle objects (opaque token validation without private Symbols) */
  const handleTokens = new WeakSet()
  /** targetId → Map(recordKey → record) */
  const records = new Map()
  /** targetId → { current, assembled, captureDispose, captureAgentId } */
  const snapshotCells = new Map()

  const gates = () => {
    if (typeof active === 'function' && !active()) throw new PluginApiInactiveError()
  }

  const officialAgents = () => {
    try {
      const agents = agentsProvider?.()
      return agents && typeof agents.get === 'function' ? agents : null
    } catch {
      return null
    }
  }

  const liveTargetCtx = (targetId) => {
    const agents = officialAgents()
    if (!agents) return null
    try {
      const agent = agents.get(targetId)
      return agent && typeof agent.ctx === 'object' && agent.ctx !== null ? agent.ctx : null
    } catch {
      return null
    }
  }

  const targetRefOf = (agent) => {
    if (isNonEmptyString(agent)) return agent
    if (isPlainObject(agent) && isNonEmptyString(agent.id)) return agent.id
    return null
  }

  const removeRecord = (record) => {
    const byTarget = records.get(record.targetId)
    if (byTarget) {
      byTarget.delete(recordKeyOf(record.ownerId, record.kind, record.contributionId))
      if (byTarget.size === 0) records.delete(record.targetId)
    }
    const disposer = record.officialDisposer
    record.officialDisposer = null
    if (typeof disposer === 'function') {
      try {
        disposer()
      } catch (error) {
        reportDiagnostics(`scoped contribution disposal failed: ${String(error?.message ?? error)}`)
      }
    }
  }

  // Owner-unload cleanup has exactly one path: the `callerCtx.effect`
  // teardown registered per installation (and per scope handle), so there is
  // deliberately no second owner-purge sweep here.

  const installSnapshotCapture = (targetId, cell) => {
    const targetCtx = liveTargetCtx(targetId)
    if (!targetCtx || typeof targetCtx.on !== 'function') return false
    try {
      cell.captureDispose = targetCtx.on('system-prompt/assemble', (payload, context, next) => {
        // Per-step snapshot capture, official installModelSelection timing:
        // read the step's selection at listener entry, publish it as the
        // step's assembled value. Pure bookkeeping — the chain is forwarded.
        try {
          cell.assembled = cell.current
        } catch (error) {
          reportDiagnostics(`snapshot capture failed: ${String(error?.message ?? error)}`)
        }
        const forward = typeof next === 'function' ? next : typeof context === 'function' ? context : undefined
        if (typeof forward === 'function') return forward()
        return undefined
      })
      cell.captureAgentId = targetId
      return true
    } catch (error) {
      reportDiagnostics(`snapshot capture install failed: ${String(error?.message ?? error)}`)
      return false
    }
  }

  /**
   * One scoped installation: resolve the target context, run the install
   * closure through it, record the result for identity-bound cleanup and
   * resume re-installation. Returns the official disposer, or null when the
   * target context is gone (typed failure is the caller's decision).
   */
  const installThroughTarget = (record) => {
    const targetCtx = liveTargetCtx(record.targetId)
    if (!targetCtx) return null
    const officialDisposer = record.install(targetCtx)
    record.officialDisposer = typeof officialDisposer === 'function' ? officialDisposer : null
    record.dormant = false
    return record.officialDisposer
  }

  // Official emit listeners receive (carrier, name, payload); the payload is
  // the trailing argument.
  const reannounce = (...args) => {
    const payload = args[args.length - 1]
    try {
      const agent = payload?.agent
      const targetId = typeof agent?.id === 'string' ? agent.id : null
      if (!targetId) return
      const byTarget = records.get(targetId)
      const hasRecords = byTarget && byTarget.size > 0
      const cell = snapshotCells.get(targetId)
      const needsCapture = cell && (!cell.captureDispose || cell.captureAgentId !== targetId)
      if (!hasRecords && !needsCapture) return
      const agents = officialAgents()
      if (!agents) return
      let live = false
      try {
        live = agents.get(targetId) !== undefined
      } catch {
        live = false
      }
      if (!live) return
      if (hasRecords) {
        for (const record of [...byTarget.values()]) {
          // The previous official registration died with the old agent
          // fiber; re-install into the new instance's scoped layer. A
          // re-install failure degrades that one record — never vetoes
          // the official announcement.
          try {
            const disposer = installThroughTarget(record)
            if (disposer === null) {
              record.dormant = true
              reportDiagnostics(`scoped contribution "${record.contributionId}" for "${targetId}" stays dormant: target context unavailable`)
            }
          } catch (error) {
            record.dormant = true
            reportDiagnostics(`scoped contribution re-install failed: ${String(error?.message ?? error)}`)
          }
        }
      }
      if (needsCapture) installSnapshotCapture(targetId, cell)
    } catch (error) {
      reportDiagnostics(`scoped contribution lifecycle handling failed: ${String(error?.message ?? error)}`)
    }
  }

  const retired = (...args) => {
    const payload = args[args.length - 1]
    try {
      const targetId = payload?.agent?.id
      if (!isNonEmptyString(targetId)) return
      const byTarget = records.get(targetId)
      if (byTarget) {
        for (const record of byTarget.values()) {
          // The official scoped registration dies with the agent fiber on
          // its own; drop the stale disposer reference and mark the record
          // dormant. Records stay as bookkeeping so a same-id resume can
          // re-install; they never reach any assembly while dormant.
          record.officialDisposer = null
          record.dormant = true
        }
      }
      const cell = snapshotCells.get(targetId)
      if (cell) {
        const captureDispose = cell.captureDispose
        cell.captureDispose = null
        if (typeof captureDispose === 'function') {
          try {
            captureDispose()
          } catch {
            // the old fiber is going away anyway
          }
        }
      }
    } catch (error) {
      reportDiagnostics(`scoped contribution retire handling failed: ${String(error?.message ?? error)}`)
    }
  }

  /**
   * Release the per-target snapshot cell once no live scope handle binds the
   * target any more (bounded bookkeeping; a later handle recreates it).
   */
  const releaseTargetCellIfUnused = (targetId) => {
    for (const entry of scopes.values()) {
      if (entry.disposed !== true && entry.targetId === targetId) return
    }
    const cell = snapshotCells.get(targetId)
    if (!cell) return
    snapshotCells.delete(targetId)
    const captureDispose = cell.captureDispose
    cell.captureDispose = null
    if (typeof captureDispose === 'function') {
      try {
        captureDispose()
      } catch {
        // the capture listener lives on the target context; teardown is best-effort
      }
    }
  }

  return Object.freeze({
    /** Host wiring: attach the internal lifecycle listeners (self-containing). */
    attachLifecycle(onCreated, onDisposed) {
      const createdDisposer = typeof onCreated === 'function' ? onCreated(reannounce) : null
      const disposedDisposer = typeof onDisposed === 'function' ? onDisposed(retired) : null
      return () => {
        for (const disposer of [createdDisposer, disposedDisposer]) {
          if (typeof disposer === 'function') {
            try {
              disposer()
            } catch {
              // teardown must never throw through the host path
            }
          }
        }
      }
    },

    /**
     * Scope-bound handle (resourceRegistry entry with the recorded target /
     * status() extension members): owner and target are expressed apart.
     */
    registerScope(spec, callerCtx) {
      gates()
      if (!isPlainObject(spec)) {
        return Object.freeze({ ok: false, code: 'invalid-input', reason: 'agents.scopes.register requires a spec object' })
      }
      const targetId = targetRefOf(spec.agent)
      if (targetId === null) {
        return Object.freeze({ ok: false, code: 'invalid-input', reason: 'spec.agent must be a session id string or an agent reference with an id' })
      }
      const ownerId = resolveOwnerId?.(callerCtx)
      if (!isNonEmptyString(ownerId)) {
        return Object.freeze({ ok: false, code: 'unavailable', reason: 'scope owner is unavailable' })
      }
      const agents = officialAgents()
      if (!agents) {
        return Object.freeze({ ok: false, code: 'unavailable', reason: 'the official agents backing is unavailable' })
      }
      let live = false
      try {
        live = agents.get(targetId) !== undefined
      } catch (error) {
        return Object.freeze({ ok: false, code: 'unavailable', reason: `target resolution failed: ${String(error?.message ?? error)}` })
      }
      if (!live) {
        return Object.freeze({ ok: false, code: 'unavailable', reason: `target agent "${targetId}" cannot be resolved (nonexistent or disposed)` })
      }
      const id = `scope:${++sequence}`
      const handleId = id
      const generation = 1
      const handleRecord = { ownerId, targetId, generation, disposed: false, handle: null }
      // Identity-bound teardown: only the contributions installed through
      // this handle are removed; other owners and other handles survive.
      const disposeHandleRecord = () => {
        if (handleRecord.disposed) return false
        handleRecord.disposed = true
        const byTarget = records.get(targetId)
        if (byTarget) {
          for (const record of [...byTarget.values()]) {
            if (record.handleId === handleId) removeRecord(record)
          }
          if (records.get(targetId)?.size === 0) records.delete(targetId)
        }
        scopes.delete(handleId)
        releaseTargetCellIfUnused(targetId)
        return true
      }
      const handle = Object.freeze({
        id,
        ownerId,
        generation,
        target: Object.freeze({ id: targetId, resolvedAt: new Date().toISOString() }),
        status() {
          let alive = false
          try {
            alive = officialAgents()?.get(targetId) !== undefined
          } catch {
            alive = false
          }
          return Object.freeze({ status: alive ? 'usable' : 'destroyed', targetId })
        },
        dispose() {
          if (!disposeHandleRecord()) {
            return Object.freeze({ status: 'stale', reason: 'scope handle already disposed' })
          }
          return Object.freeze({ status: 'ok' })
        },
      })
      handleRecord.handle = handle
      handleTokens.add(handle)
      scopes.set(handleId, handleRecord)
      // Owner-bound bookkeeping: the handle dies with the contributor's fiber
      // (owner unload, including a plugin that forgets to dispose it), so
      // per-owner state stays bounded by the owners that are still loaded.
      try {
        if (typeof callerCtx?.effect === 'function') {
          callerCtx.effect(() => () => {
            try {
              disposeHandleRecord()
            } catch {
              // owner teardown must never throw
            }
          })
        }
      } catch {
        // an unusable effect channel degrades to the dispose-driven lifetime
      }
      return Object.freeze({ ok: true, code: 'registered', handle })
    },

    /** Validate a scope reference carried in a contribution spec. */
    resolveScopeToken(scope) {
      if (!isPlainObject(scope) || !handleTokens.has(scope)) return null
      const record = scopes.get(scope.id)
      if (!record || record.disposed) return null
      return record
    },

    /** Whether (owner, kind, id) is already active for one target. */
    hasRecord(ownerId, targetId, kind, contributionId) {
      return records.get(targetId)?.has(recordKeyOf(ownerId, kind, contributionId)) === true
    },

    /**
     * Install one scoped contribution through the target context. `install`
     * receives the target context and returns the official disposer.
     * `bindOwner` (callerCtx.effect) makes the installation identity-bound
     * to the contributor's fiber; a missing effect rolls the install back.
     */
    installScoped({ ownerId, targetId, kind, contributionId, handleId, install }, callerCtx) {
      gates()
      if (records.get(targetId)?.has(recordKeyOf(ownerId, kind, contributionId))) {
        return { ok: false, code: 'conflict' }
      }
      const record = {
        ownerId,
        targetId,
        kind,
        contributionId,
        handleId,
        generation: 1,
        dormant: false,
        install,
        officialDisposer: null,
      }
      const disposer = installThroughTarget(record)
      if (disposer === null) {
        return Object.freeze({ ok: false, code: 'unavailable', reason: `target agent "${targetId}" is not live` })
      }
      let teardownBound = false
      try {
        if (typeof callerCtx?.effect === 'function') {
          callerCtx.effect(() => () => {
            try {
              removeRecord(record)
            } catch {
              // owner teardown must never throw
            }
          })
          teardownBound = true
        }
      } catch {
        teardownBound = false
      }
      if (!teardownBound) {
        removeRecord(record)
        return Object.freeze({ ok: false, code: 'unavailable', reason: 'caller fiber teardown is unavailable' })
      }
      if (!records.has(targetId)) records.set(targetId, new Map())
      records.get(targetId).set(recordKeyOf(ownerId, kind, contributionId), record)
      // The record object itself is the generation token: a stale handle's
      // removal never revokes a newer generation's re-installation under
      // the same (owner, target, kind, id) key.
      return Object.freeze({ ok: true, code: 'installed', record })
    },

    /**
     * Drop one scoped record (identity-bound contribution disposal). The
     * record token must still be the live generation under its key; stale
     * removals are typed no-ops that never touch other owners or targets.
     */
    removeScoped(recordToken, ownerId) {
      if (!recordToken || recordToken.ownerId !== ownerId) {
        return Object.freeze({ status: 'stale', reason: 'no active scoped record under this identity' })
      }
      const live = records.get(recordToken.targetId)?.get(recordKeyOf(recordToken.ownerId, recordToken.kind, recordToken.contributionId))
      if (live !== recordToken) {
        return Object.freeze({ status: 'stale', reason: 'superseded by a newer generation' })
      }
      removeRecord(recordToken)
      return Object.freeze({ status: 'ok' })
    },

    /**
     * Per-step selection snapshot cell (consumption side of the model
     * selection; the external selection writer belongs to the interactive
     * session access feature). Readers see `current` (the writer's latest)
     * and `assembled` (the value captured for the step in flight).
     */
    snapshotCellOf(scopeHandle) {
      gates()
      const record = this.resolveScopeToken(scopeHandle)
      if (!record) {
        return Object.freeze({ ok: false, code: 'unavailable', reason: 'scope handle is stale or foreign' })
      }
      const targetId = record.targetId
      let cell = snapshotCells.get(targetId)
      if (!cell) {
        cell = { current: undefined, assembled: undefined, captureDispose: null, captureAgentId: null }
        snapshotCells.set(targetId, cell)
        if (!installSnapshotCapture(targetId, cell)) {
          // No live capture channel: the cell still exists so a reader sees
          // the writer's current value; capture attaches on the next
          // re-announcement of the identity.
          reportDiagnostics(`snapshot capture for "${targetId}" is pending: target context unavailable`)
        }
      }
      const reader = cell
      return Object.freeze({
        ok: true,
        code: 'active',
        snapshot: Object.freeze({
          current: () => reader.current,
          assembled: () => reader.assembled,
        }),
      })
    },

    /**
     * Writer seam for the per-step selection (the external selection state
     * belongs to the interactive session access feature; this registry only
     * carries the consumption side). Not part of the public agents.scopes
     * surface.
     */
    writeSnapshotCurrent(scopeHandle, value) {
      const record = this.resolveScopeToken(scopeHandle)
      if (!record) {
        return Object.freeze({ ok: false, code: 'unavailable', reason: 'scope handle is stale or foreign' })
      }
      const cell = snapshotCells.get(record.targetId)
      if (!cell) {
        return Object.freeze({ ok: false, code: 'unavailable', reason: 'snapshot cell is not open for this target' })
      }
      cell.current = value
      return Object.freeze({ ok: true, code: 'written' })
    },

    /** Test/lifecycle seam: current record counts, honest runtime state. */
    inspection() {
      let count = 0
      let dormant = 0
      for (const byTarget of records.values()) {
        count += byTarget.size
        for (const record of byTarget.values()) if (record.dormant === true) dormant += 1
      }
      return Object.freeze({
        scopes: scopes.size,
        records: count,
        // evicted (dormant) bookkeeping: zero assembly effect for a dead
        // target, retained only as the same-identity resume re-install source
        dormant,
        targets: records.size,
        snapshotCells: snapshotCells.size,
      })
    },
  })
}
