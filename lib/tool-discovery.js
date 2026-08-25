/**
 * Tool discovery engine: descriptor catalog, scoped activation, generation
 * replacement, bounded audit, and the per-assemble exposure provider.
 *
 * This module is the internal state machine behind the public discovery
 * surface. It performs no official-service calls: the host wiring registers
 * the `provider` and `hintText` functions into the system-prompt seam and
 * routes diagnostics, audit storage and the scope-constraint source through
 * the injected options. Every public-facing failure is a typed rejection;
 * every projection is frozen; the engine never throws through an official
 * hook (provider/hint swallow their own errors and return empty output).
 *
 * Concurrency contract: same-owner same-scope activation is latest-wins.
 * A pending activation is superseded the moment a newer claim lands; its
 * late-arriving definitions lose submission qualification and are retained
 * only as audit/diagnostics (never published).
 */
import { randomUUID } from 'node:crypto'
import { deepFreeze } from './deep-freeze.js'
import { PluginApiInactiveError } from './errors.js'
import {
  CODES,
  DEFAULT_AUDIT_LIMIT,
  executionIdOf,
  matchesQuery,
  normalizeAuditQuery,
  normalizeConstraintResult,
  normalizeDescriptorSpec,
  normalizeReason,
  normalizeToolDefinitions,
  resolveScopeKey,
  scopeKeyOfContext,
} from './tool-discovery-normalize.js'
import {
  ToolDiscoveryActivationSupersededError,
  ToolDiscoveryEntryConflictError,
  ToolDiscoveryEntryDeactivatedError,
  ToolDiscoveryEntryDisposedError,
  ToolDiscoveryEntryFailedError,
  ToolDiscoveryRegistrationError,
  ToolDiscoveryEntryUnknownError,
  ToolDiscoveryScopeUnresolvedError,
  staleGenerationOutcome,
} from './tool-discovery-errors.js'

/**
 * @param {object} [options]
 * @param {() => string} [options.idFactory] opaque token minting (defaults to uuid)
 * @param {() => Date} [options.now] clock (defaults to Date)
 * @param {(ownerId: string, detail: string) => void} [options.reportDiagnostics] owner-attributed diagnostics
 * @param {number} [options.auditLimit] bounded audit ring size (default 500)
 * @param {(record: object) => boolean} [options.appendAudit] audit storage seam; returning false or throwing marks an explicit gap and drops the record
 * @param {(scopeKey: string) => object} [options.scopeConstraint] optional scope-constraint source (route-policy consumption)
 * @param {() => boolean} [options.isActive] facade core-active predicate
 */
export function createToolDiscoveryEngine(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => new Date()
  const idFactory = typeof options.idFactory === 'function' ? options.idFactory : () => randomUUID()
  const reportDiagnostics = typeof options.reportDiagnostics === 'function' ? options.reportDiagnostics : () => {}
  const auditLimit = Number.isInteger(options.auditLimit) && options.auditLimit > 0 ? options.auditLimit : DEFAULT_AUDIT_LIMIT
  const scopeConstraint = typeof options.scopeConstraint === 'function' ? options.scopeConstraint : null
  const appendAudit = typeof options.appendAudit === 'function' ? options.appendAudit : null
  const isActive = typeof options.isActive === 'function' ? options.isActive : () => true

  const entries = new Map()
  const disposedIds = new Set()
  const toolsets = new Map()
  const audit = { records: [], seq: 0, truncated: false, gap: false }
  let tornDown = false

  const isoAt = () => {
    const value = now()
    return value instanceof Date ? value.toISOString() : String(value)
  }

  function assertActive() {
    if (tornDown || !isActive()) throw new PluginApiInactiveError()
  }

  function writeAudit(record) {
    const entry = { seq: ++audit.seq, at: isoAt(), ...record }
    let accepted = true
    if (appendAudit) {
      try {
        accepted = appendAudit(entry) !== false
      } catch {
        accepted = false
      }
    }
    if (!accepted) {
      audit.gap = true
      return
    }
    audit.records.push(deepFreeze(entry))
    if (audit.records.length > auditLimit) {
      audit.records.splice(0, audit.records.length - auditLimit)
      audit.truncated = true
    }
  }

  function failEntry(entry, detail) {
    entry.state = 'failed'
    entry.failedReason = detail
    const descriptor = entry.descriptor
    writeAudit({
      kind: 'fail',
      entryId: descriptor.id,
      sourceKind: descriptor.sourceKind,
      owner: descriptor.owner,
      generation: entry.generation,
      reason: detail,
    })
    reportDiagnostics(descriptor.owner, `catalog entry "${descriptor.id}" failed: ${detail}`)
    // An entry failure invalidates every in-flight activation of that entry:
    // pending toolsets lose submission qualification (stale-result guard) so
    // a concurrent activation can never publish after the entry failed.
    for (const [scopeKey, scopeToolsets] of toolsets) {
      const pending = scopeToolsets.get(descriptor.id)
      if (pending && pending.state === 'pending') {
        scopeToolsets.delete(descriptor.id)
        if (scopeToolsets.size === 0) toolsets.delete(scopeKey)
        writeAudit({
          kind: 'revoke',
          entryId: descriptor.id,
          sourceKind: descriptor.sourceKind,
          owner: descriptor.owner,
          generation: pending.generation,
          reason: 'entry-failed',
        })
      }
    }
  }

  function reclaimPending(scopeKey, entryId, generation) {
    const scopeToolsets = toolsets.get(scopeKey)
    const current = scopeToolsets?.get(entryId)
    if (current && current.generation === generation && current.state === 'pending') {
      scopeToolsets.delete(entryId)
      if (scopeToolsets.size === 0) toolsets.delete(scopeKey)
    }
  }

  function makeEntryDisposer(record) {
    return () => {
      if (record.state === 'disposed') return false
      record.state = 'disposed'
      entries.delete(record.descriptor.id)
      disposedIds.add(record.descriptor.id)
      for (const [scopeKey, scopeToolsets] of toolsets) {
        if (!scopeToolsets.has(record.descriptor.id)) continue
        scopeToolsets.delete(record.descriptor.id)
        if (scopeToolsets.size === 0) toolsets.delete(scopeKey)
      }
      writeAudit({
        kind: 'deactivate',
        entryId: record.descriptor.id,
        sourceKind: record.descriptor.sourceKind,
        owner: record.descriptor.owner,
        generation: record.generation,
        reason: 'entry-disposed',
      })
      return true
    }
  }

  function entryOf(id) {
    if (disposedIds.has(id)) {
      throw new ToolDiscoveryEntryDisposedError(id)
    }
    const entry = entries.get(id)
    if (!entry) throw new ToolDiscoveryEntryUnknownError(id)
    return entry
  }

  function disposeToolset(scopeKey, toolset) {
    const scopeToolsets = toolsets.get(scopeKey)
    if (!scopeToolsets || scopeToolsets.get(toolset.entryId) !== toolset) {
      return staleGenerationOutcome('no active toolset matches this generation')
    }
    scopeToolsets.delete(toolset.entryId)
    if (scopeToolsets.size === 0) toolsets.delete(scopeKey)
    const entry = entries.get(toolset.entryId)
    writeAudit({
      kind: 'deactivate',
      entryId: toolset.entryId,
      sourceKind: toolset.sourceKind,
      owner: entry?.descriptor.owner ?? toolset.owner,
      generation: toolset.generation,
      reason: 'handle-dispose',
    })
    return deepFreeze({ ok: true, entryId: toolset.entryId, generation: toolset.generation })
  }

  // --- catalog -------------------------------------------------------------

  function register(spec) {
    assertActive()
    const normalized = normalizeDescriptorSpec(spec)
    if (!normalized.ok) {
      reportDiagnostics(String(spec?.owner ?? '<unknown>'), `catalog registration rejected: ${normalized.detail}`)
      throw new ToolDiscoveryRegistrationError(normalized.detail)
    }
    const { id, owner, summary, capabilities, sourceKind, toolNames, activate: activateCallback } = normalized.value
    if (entries.has(id)) {
      reportDiagnostics(owner, `duplicate catalog entry id "${id}"`)
      throw new ToolDiscoveryEntryConflictError(id)
    }
    // A previously disposed id may be re-registered as a fresh lifecycle
    // (dispose + register is the documented recovery path); the tombstone is
    // cleared so the new registration is the live entry again.
    disposedIds.delete(id)
    const descriptor = deepFreeze({
      id,
      owner,
      summary,
      capabilities: [...capabilities],
      sourceKind,
      ...(toolNames === undefined ? {} : { toolNames: [...toolNames] }),
    })
    const record = {
      descriptor,
      generation: `${owner}:${idFactory()}`,
      activate: activateCallback,
      state: 'registered',
      failedReason: undefined,
    }
    entries.set(id, record)
    return deepFreeze({ generation: record.generation, dispose: makeEntryDisposer(record) })
  }

  // --- activation ----------------------------------------------------------

  async function activate(id, { session, execution, reason } = {}) {
    assertActive()
    const entry = entryOf(id)
    if (entry.state === 'failed') throw new ToolDiscoveryEntryFailedError(id, entry.failedReason)
    if (entry.state === 'offline') throw new ToolDiscoveryEntryDeactivatedError(id)
    const scope = resolveScopeKey({ session, execution })
    if (!scope.ok) throw new ToolDiscoveryScopeUnresolvedError(scope.detail)
    const scopeKey = scope.scopeKey
    const generation = `${entry.descriptor.owner}:${idFactory()}`
    const reasonText = normalizeReason(reason)
    const toolset = {
      entryId: id,
      generation,
      scopeKey,
      state: 'pending',
      tools: null,
      toolNames: entry.descriptor.toolNames,
      activatedAt: null,
      sourceKind: entry.descriptor.sourceKind,
      owner: entry.descriptor.owner,
      reason: reasonText,
      executionId: executionIdOf({ session, execution }),
    }
    let scopeToolsets = toolsets.get(scopeKey)
    if (!scopeToolsets) {
      scopeToolsets = new Map()
      toolsets.set(scopeKey, scopeToolsets)
    }
    const previous = scopeToolsets.get(id)
    if (previous && previous.state === 'pending') {
      previous.superseded = true
      writeAudit({
        kind: 'revoke',
        entryId: id,
        sourceKind: entry.descriptor.sourceKind,
        owner: entry.descriptor.owner,
        generation: previous.generation,
        reason: 'superseded',
      })
    }
    scopeToolsets.set(id, toolset)

    let output
    try {
      output = await entry.activate({ id, scopeKey, generation, reason: reasonText })
    } catch (error) {
      failEntry(entry, error?.message ?? String(error))
      reclaimPending(scopeKey, id, generation)
      throw new ToolDiscoveryEntryFailedError(id, error?.message ?? String(error))
    }
    const definitions = normalizeToolDefinitions(output)
    if (!definitions.ok) {
      failEntry(entry, definitions.detail)
      reclaimPending(scopeKey, id, generation)
      throw new ToolDiscoveryEntryFailedError(id, definitions.detail)
    }

    // Submission qualification: only the current generation may publish, and
    // only while the entry is still registered (an entry that failed while
    // this activation was in flight never publishes).
    const current = toolsets.get(scopeKey)?.get(id)
    if (!current || current.generation !== generation || current.state !== 'pending' || current.superseded) {
      writeAudit({
        kind: 'revoke',
        entryId: id,
        sourceKind: entry.descriptor.sourceKind,
        owner: entry.descriptor.owner,
        generation,
        reason: 'superseded',
      })
      reportDiagnostics(entry.descriptor.owner, `activation of "${id}" was superseded before its definitions arrived; retained as diagnostics`)
      throw new ToolDiscoveryActivationSupersededError(id)
    }
    if (entry.state === 'failed') {
      reclaimPending(scopeKey, id, generation)
      writeAudit({
        kind: 'revoke',
        entryId: id,
        sourceKind: entry.descriptor.sourceKind,
        owner: entry.descriptor.owner,
        generation,
        reason: 'entry-failed',
      })
      throw new ToolDiscoveryEntryFailedError(id, entry.failedReason)
    }

    current.state = 'active'
    current.tools = deepFreeze(definitions.tools)
    current.activatedAt = isoAt()
    writeAudit({
      kind: 'activate',
      entryId: id,
      sourceKind: entry.descriptor.sourceKind,
      owner: entry.descriptor.owner,
      generation,
      reason: reasonText,
      ...(toolset.executionId === undefined ? {} : { executionId: toolset.executionId }),
      ...(toolset.toolNames === undefined ? {} : { toolNames: [...toolset.toolNames] }),
    })
    return deepFreeze({
      generation,
      dispose: () => disposeToolset(scopeKey, current),
    })
  }

  function deactivate(id, { reason } = {}) {
    assertActive()
    const entry = entryOf(id)
    if (entry.state === 'offline') return deepFreeze({ ok: true, entryId: id })
    entry.state = 'offline'
    writeAudit({
      kind: 'deactivate',
      entryId: id,
      sourceKind: entry.descriptor.sourceKind,
      owner: entry.descriptor.owner,
      generation: entry.generation,
      reason: normalizeReason(reason) ?? 'deactivated',
    })
    return deepFreeze({ ok: true, entryId: id })
  }

  // --- search --------------------------------------------------------------

  function resolveSearchScope(scope) {
    if (typeof scope === 'string' && scope.trim() !== '') return { ok: true, scopeKey: scope }
    return resolveScopeKey({ session: scope?.session, execution: scope?.execution })
  }

  function evaluateConstraint(scopeKey) {
    if (!scopeConstraint || scopeKey === undefined) return { status: 'none', forbidden: [] }
    try {
      return normalizeConstraintResult(scopeConstraint(scopeKey))
    } catch (error) {
      reportDiagnostics('<facade>', `scope constraint source failed: ${error?.message ?? error}`)
      return { status: 'unknown', detail: 'constraint-source-error', forbidden: [] }
    }
  }

  function search(query, { scope } = {}) {
    assertActive()
    const resolved = resolveSearchScope(scope)
    const constraint = resolved.ok ? evaluateConstraint(resolved.scopeKey) : { status: 'none', forbidden: [] }
    const forbiddenById = new Map(constraint.forbidden.map((entry) => [entry.entryId, entry.reason]))
    const descriptors = []
    const exclusions = []
    for (const record of entries.values()) {
      const descriptor = record.descriptor
      if (!matchesQuery(descriptor, query)) continue
      const forbiddenReason = forbiddenById.get(descriptor.id)
      if (forbiddenReason !== undefined) {
        exclusions.push(deepFreeze({ entryId: descriptor.id, reason: forbiddenReason }))
        writeAudit({
          kind: 'exclude',
          entryId: descriptor.id,
          sourceKind: descriptor.sourceKind,
          owner: descriptor.owner,
          reason: forbiddenReason,
        })
        continue
      }
      descriptors.push(deepFreeze({
        id: descriptor.id,
        summary: descriptor.summary,
        capabilities: [...descriptor.capabilities],
        sourceKind: descriptor.sourceKind,
      }))
    }
    const constraintMeta = { status: constraint.status }
    if (constraint.source !== undefined) constraintMeta.source = constraint.source
    if (constraint.reason !== undefined) constraintMeta.reason = constraint.reason
    if (constraint.detail !== undefined) constraintMeta.detail = constraint.detail
    return deepFreeze({ descriptors, exclusions, constraint: deepFreeze(constraintMeta) })
  }

  // --- audit ---------------------------------------------------------------

  function queryAudit(filter = {}) {
    assertActive()
    const params = normalizeAuditQuery(filter)
    const filtered = audit.records.filter((record) =>
      (params.entryId === undefined || record.entryId === params.entryId)
      && (params.owner === undefined || record.owner === params.owner)
      && (params.kind === undefined || record.kind === params.kind))
    const page = filtered.slice(params.cursor, params.cursor + params.limit)
    const truncated = params.cursor + page.length < filtered.length
    return deepFreeze({
      items: page,
      truncated,
      ...(truncated ? { nextCursor: String(params.cursor + page.length) } : {}),
    })
  }

  // --- exposure ------------------------------------------------------------

  function provider(context) {
    try {
      const scopeKey = scopeKeyOfContext(context)
      if (scopeKey === undefined) return { schemas: [], knownNames: [] }
      const scopeToolsets = toolsets.get(scopeKey)
      if (!scopeToolsets) return { schemas: [], knownNames: [] }
      const schemas = []
      for (const toolset of scopeToolsets.values()) {
        if (toolset.state !== 'active' || !toolset.tools) continue
        for (const tool of toolset.tools) {
          schemas.push({ name: tool.name, description: tool.description, parameters: tool.parameters })
        }
      }
      return { schemas, knownNames: schemas.map((tool) => tool.name) }
    } catch (error) {
      reportDiagnostics('<facade>', `exposure provider evaluation failed: ${error?.message ?? error}`)
      return { schemas: [], knownNames: [] }
    }
  }

  function hintText(context) {
    try {
      const scopeKey = scopeKeyOfContext(context)
      if (scopeKey === undefined) return ''
      const scopeToolsets = toolsets.get(scopeKey)
      if (!scopeToolsets) return ''
      const lines = []
      for (const toolset of scopeToolsets.values()) {
        if (toolset.state !== 'active') continue
        const descriptor = entries.get(toolset.entryId)?.descriptor
        if (!descriptor) continue
        const names = (toolset.tools ?? []).map((tool) => tool.name)
        const parts = [`- ${descriptor.id}: ${descriptor.summary}`, `(${descriptor.capabilities.join(', ')})`, `[source=${descriptor.sourceKind}]`]
        if (names.length > 0) parts.push(`activated tools: ${names.join(', ')}`)
        lines.push(parts.join(' '))
      }
      return lines.join('\n')
    } catch (error) {
      reportDiagnostics('<facade>', `discovery hint evaluation failed: ${error?.message ?? error}`)
      return ''
    }
  }

  // --- availability & teardown ---------------------------------------------

  function availability(extras = {}) {
    const catalog = { registered: entries.size, failed: 0, offline: 0 }
    for (const record of entries.values()) {
      if (record.state === 'failed') catalog.failed += 1
      if (record.state === 'offline') catalog.offline += 1
    }
    let toolsetCount = 0
    for (const scopeToolsets of toolsets.values()) toolsetCount += scopeToolsets.size
    return deepFreeze({
      active: isActive() && !tornDown,
      catalog,
      toolsets: toolsetCount,
      audit: { limit: auditLimit, count: audit.records.length, truncated: audit.truncated, gap: audit.gap },
      constraint: { status: scopeConstraint ? 'wired' : 'none' },
      ...extras,
    })
  }

  function dispose() {
    if (tornDown) return false
    tornDown = true
    entries.clear()
    toolsets.clear()
    return true
  }

  return deepFreeze({
    catalog: deepFreeze({ register }),
    search,
    activate,
    deactivate,
    audit: deepFreeze({ query: queryAudit }),
    availability,
    provider,
    hintText,
    dispose,
  })
}