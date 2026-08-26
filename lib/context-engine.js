/**
 * Context provenance engine — the facade's own explanation-layer state
 * machine.
 *
 * The engine owns ONLY this feature's interpretation state:
 * - per-owner contribution registry (in-memory, session scoped),
 * - persistent node transitions driven by external events (assembled-context
 *   evidence -> sent; compaction/prune mappings -> archived/superseded;
 *   redaction failure -> redacted),
 * - bounded evidence ring, bounded replacement mappings, bounded per-session
 *   dropped records,
 * - observer epoch with stale-callback guard.
 *
 * Projection purity (api-shape): compose/inspect never touch node or registry
 * state. Compose's only write is the session's latest composed-graph snapshot
 * (latest-wins, used to derive the served classification); inspect performs no
 * writes except fail-closed redaction transitions. `served` is a DERIVED
 * classification (a node included in the session's latest compose graph is
 * reported as served); the only persistent state writes are the transition
 * paths above. Compose never triggers retry, route, approval, mutation, or
 * prompt-injection bypass.
 *
 * Presentation discipline: every domain outcome is a frozen typed result
 * (never throws through plugin callbacks, never escapes apply); programming
 * misuse (non-function policy/listener) degrades to a logged fail-safe
 * no-op, consistent with the facade's never-throw posture.
 */
import { randomUUID } from 'node:crypto'
import { deepFreeze } from './deep-freeze.js'
import {
  DEFAULT_PHASE,
  MAX_EVIDENCE_RING,
  MAX_MAPPING_HISTORY,
  MAX_NODES_PER_SESSION,
  applyBudget,
  compareNodes,
  normalizeAssembledEvidence,
  normalizeBudget,
  normalizeContribution,
  normalizeInspectOptions,
  normalizeReplacementMapping,
} from './context-normalize.js'

const MAX_EVICTED_DROPPED_PER_SESSION = 200
const MAX_STALE_EVIDENCE_DIAGNOSTICS = 50

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function safeNow(now) {
  try {
    const value = now()
    return value instanceof Date ? value : new Date(value)
  } catch {
    return new Date()
  }
}

function isoNow(now) {
  const date = safeNow(now)
  return Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString()
}

function frozenResult(value) {
  return deepFreeze(value)
}

/**
 * Create the context provenance engine.
 *
 * @param {object} options
 * @param {object} [options.sources] - per-source adapters (systemPrompt,
 *   sessionSurface, attachment, toolExposure, skillExposure, compaction,
 *   memory); each may expose `status()` returning
 *   'available'|'unavailable'|'degraded' and optional seam capabilities
 *   (e.g. sessionSurface.verifySeqBounds).
 * @param {object} [options.evidenceSource] - assembled-evidence adapter with
 *   `status()` and `subscribe(listener)` (may be null when the evidence
 *   slice is absent/inactive).
 * @param {(ownerId: string, detail: string) => void} [options.reportDiagnostics]
 * @param {() => Date} [options.now]
 * @param {() => string} [options.idFactory]
 * @param {(sessionRef: unknown) => {ok: boolean, sessionId?: string}} [options.sessionResolver]
 *   - resolves a session reference for inspect scope; `{ok:false}` yields a
 *   typed unavailable result without disclosing existence.
 * @param {number} [options.evidenceRingLimit]
 */
export function createContextEngine({
  sources = {},
  reportDiagnostics = () => {},
  now = () => new Date(),
  idFactory = randomUUID,
  sessionResolver = () => ({ ok: false }),
  evidenceSource = null,
  evidenceRingLimit = MAX_EVIDENCE_RING,
} = {}) {
  let disposed = false
  let registrationSeq = 0
  let composeSeq = 0
  let observerSeq = 0
  let policySeq = 0

  const registry = new Map() // owner -> Map<id, NodeRecord>
  const sessionNodes = new Map() // session key -> NodeRecord[] (registration order)
  const lastGraphs = new Map() // session key -> frozen composed graph record
  const composeGenerations = new Map() // session key -> per-session compose counter
  const evidenceGenerations = new Map() // session key -> latest applied evidence generation
  const evidenceRing = [] // bounded global ring
  const staleEvidence = new Map() // session key -> bounded diagnostic list
  const mappings = [] // bounded global history
  const evictedDropped = new Map() // session key -> bounded dropped records
  const policies = [] // { fn, name, priority, seq }
  const observers = new Map() // seq -> listener

  const sessionKeyOf = (node) => node.scope.key
  const registrationsFor = (sessionKey) => sessionNodes.get(sessionKey) ?? []

  const report = (ownerId, detail) => {
    try {
      reportDiagnostics(ownerId, detail)
    } catch {
      // diagnostics must never change engine outcomes
    }
  }

  function listSessionNodes(sessionKey) {
    const list = sessionNodes.get(sessionKey)
    return list === undefined ? [] : list
  }

  function createNode(contribution) {
    const observedAt = isoNow(now)
    const node = {
      id: contribution.id,
      owner: contribution.owner,
      scope: { kind: contribution.scope.kind, key: contribution.scope.key },
      phase: contribution.phase,
      priority: contribution.priority,
      source: { kind: contribution.source.kind, owner: contribution.source.owner },
      ...(contribution.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: [...contribution.sourceEventSeqs] }),
      ...(contribution.content === undefined ? {} : { content: contribution.content }),
      ...(contribution.refs === undefined ? {} : { refs: [...contribution.refs] }),
      ...(contribution.sectionKey === undefined ? {} : { sectionKey: contribution.sectionKey }),
      ...(contribution.expiresAt === undefined ? {} : { expiresAt: contribution.expiresAt }),
      ...(contribution.supersedes === undefined ? {} : { supersedes: contribution.supersedes }),
      audience: { model: contribution.audience.model, ui: contribution.audience.ui, diagnostic: contribution.audience.diagnostic },
      registrationSeq: ++registrationSeq,
      observedAt,
      state: 'contributed',
      stateReason: null,
      transitions: [],
      sentBy: null,
      droppedReason: null,
      droppedObservedAt: null,
    }
    return node
  }

  function findNodeById(sessionKey, id) {
    return listSessionNodes(sessionKey).find((node) => node.id === id)
  }

  function transition(node, state, reason, observedAt) {
    if (node.state !== 'contributed') return false // committed states are never rewritten
    node.state = state
    node.stateReason = reason
    node.transitions.push(frozenResult({ state, reason, observedAt }))
    return true
  }

  function evictOldestContributed(sessionKey) {
    const list = listSessionNodes(sessionKey)
    const index = list.findIndex((node) => node.state === 'contributed')
    if (index < 0) return null
    const [node] = list.splice(index, 1)
    const ownerMap = registry.get(node.owner)
    if (ownerMap?.get(node.id) === node) ownerMap.delete(node.id)
    const observedAt = isoNow(now)
    node.droppedReason = { code: 'registry-capacity', detail: 'per-session node capacity exceeded' }
    node.droppedObservedAt = observedAt
    // Bounded per-session dropped record (the dropped vocabulary is a
    // per-node reason record, not a sixth node state).
    const records = evictedDropped.get(sessionKey) ?? []
    records.push(frozenResult({ nodeId: node.id, reason: node.droppedReason, observedAt }))
    if (records.length > MAX_EVICTED_DROPPED_PER_SESSION) records.shift()
    evictedDropped.set(sessionKey, records)
    return node
  }

  function policyOrder() {
    const rank = { lowest: 0, low: 1, normal: 2, high: 3, highest: 4, monitor: 5 }
    return [...policies].sort((a, b) => (rank[b.priority] ?? 2) - (rank[a.priority] ?? 2) || a.seq - b.seq)
  }

  function notifyObservers(payload) {
    if (disposed) return
    const snapshot = frozenResult(payload)
    for (const listener of [...observers.values()]) {
      try {
        listener(snapshot)
      } catch (error) {
        report(`<observer:${observerSeq}>`, `context observer listener failed: ${error?.message ?? error}`)
      }
    }
  }

  function nodeProjection(node, { state, degraded = [] } = {}) {
    return {
      id: node.id,
      owner: node.owner,
      scope: node.scope,
      phase: node.phase,
      priority: node.priority,
      source: node.source,
      ...(node.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: node.sourceEventSeqs }),
      ...(node.sectionKey === undefined ? {} : { sectionKey: node.sectionKey }),
      ...(node.refs === undefined ? {} : { refs: node.refs }),
      ...(node.supersedes === undefined ? {} : { supersedes: node.supersedes }),
      ...(node.expiresAt === undefined ? {} : { expiresAt: node.expiresAt }),
      registrationSeq: node.registrationSeq,
      observedAt: node.observedAt,
      state,
      stateReason: node.stateReason,
      ...(node.sentBy === null ? {} : { sentBy: node.sentBy }),
      ...(node.droppedReason === null ? {} : { droppedReason: node.droppedReason }),
      ...(degraded.length > 0 ? { degraded } : {}),
    }
  }

  function derivedState(node) {
    return node.state
  }

  function sourceStatuses(includeEvidence = false) {
    const result = {}
    for (const key of Object.keys(sources)) {
      const adapter = sources[key]
      let status = 'unavailable'
      let detail
      try {
        if (adapter && typeof adapter.status === 'function') {
          const value = adapter.status()
          status = value === 'degraded' || value === 'available' ? value : 'unavailable'
          if (typeof value === 'object' && value !== null && typeof value.detail === 'string') detail = value.detail
        } else if (adapter) {
          status = 'available'
        }
      } catch {
        status = 'unavailable'
      }
      result[key] = detail === undefined ? status : { status, detail }
    }
    if (includeEvidence) {
      let sentReachable = false
      try {
        sentReachable = Boolean(evidenceSource && typeof evidenceSource.status === 'function' && evidenceSource.status() === 'available')
      } catch {
        sentReachable = false
      }
      result.sentReachable = sentReachable
    }
    return result
  }

  function contribute(spec) {
    if (disposed) return frozenResult({ ok: false, code: 'INACTIVE', detail: 'context engine is disposed' })
    const normalized = normalizeContribution(spec)
    if (!normalized.ok) {
      return frozenResult({
        ok: false,
        code: 'CONTRIBUTION_INVALID',
        detail: 'contribution registration is invalid',
        problems: normalized.problems,
      })
    }
    const contribution = normalized.contribution
    const ownerMap = registry.get(contribution.owner) ?? new Map()
    if (ownerMap.has(contribution.id)) {
      return frozenResult({
        ok: false,
        code: 'CONTRIBUTION_CONFLICT',
        detail: `a contribution with id "${contribution.id}" already exists in owner namespace "${contribution.owner}"`,
        existingId: contribution.id,
      })
    }
    const sessionKey = contribution.scope.key
    let capacityDropped = null
    if (listSessionNodes(sessionKey).length >= MAX_NODES_PER_SESSION) {
      capacityDropped = evictOldestContributed(sessionKey)
    }
    const node = createNode(contribution)
    ownerMap.set(node.id, node)
    registry.set(node.owner, ownerMap)
    const list = sessionNodes.get(sessionKey) ?? []
    list.push(node)
    sessionNodes.set(sessionKey, list)
    const generation = String(node.registrationSeq)
    let released = false
    const handle = Object.freeze({
      id: node.id,
      owner: node.owner,
      generation,
      dispose: () => {
        if (disposed) return frozenResult({ ok: false, code: 'INACTIVE', detail: 'context engine is disposed' })
        if (released) return frozenResult({ ok: true, already: true })
        const current = registry.get(node.owner)?.get(node.id)
        if (current !== node) {
          return frozenResult({ ok: false, code: 'CONTRIBUTION_UNKNOWN', detail: 'contribution is no longer registered (already disposed or replaced)' })
        }
        const sessionKeyCurrent = sessionKeyOf(node)
        const sessionList = sessionNodes.get(sessionKeyCurrent)
        const index = sessionList?.indexOf(node) ?? -1
        if (index >= 0) sessionList.splice(index, 1)
        registry.get(node.owner)?.delete(node.id)
        released = true
        return frozenResult({ ok: true, already: false })
      },
    })
    const result = { ok: true, handle }
    if (capacityDropped !== null) {
      notifyObservers({
        kind: 'node-dropped',
        sessionId: sessionKey,
        nodeId: capacityDropped.id,
        reason: capacityDropped.droppedReason,
        observedAt: capacityDropped.droppedObservedAt,
      })
    }
    return frozenResult(result)
  }

  function compose(request, options = {}) {
    if (disposed) return frozenResult({ ok: false, code: 'INACTIVE', detail: 'context engine is disposed' })
    const signal = options?.signal
    const aborted = () => frozenResult(signal?.aborted ? { ok: false, code: 'COMPOSE_ABORTED', reason: signal.reason instanceof Error ? signal.reason.message : String(signal.reason) } : null)
    if (!isPlainRecord(request) || typeof request.sessionId !== 'string' || request.sessionId.length === 0) {
      return frozenResult({ ok: false, code: 'COMPOSE_SCOPE_UNRESOLVED', detail: 'compose requires a request with a non-empty sessionId' })
    }
    const abortedAtEntry = aborted()
    if (abortedAtEntry) return abortedAtEntry
    const sessionId = request.sessionId
    const phase = typeof request.phase === 'string' && request.phase.length > 0 ? request.phase : DEFAULT_PHASE
    const budgetProvided = options?.budget !== undefined && options?.budget !== null
    let budgetMeta
    let normalizedBudget = null
    if (budgetProvided) {
      const budgetResult = normalizeBudget(options.budget)
      if (budgetResult.ok) {
        normalizedBudget = budgetResult.budget
        budgetMeta = { applied: true, maxNodes: budgetResult.budget.maxNodes }
      } else {
        budgetMeta = { applied: false, reason: budgetResult.reason }
      }
    } else {
      budgetMeta = { applied: false }
    }
    const dropped = []
    const eligible = []
    const observedAt = isoNow(now)
    for (const node of listSessionNodes(sessionId)) {
      const isRequestTier = node.scope.kind === 'request'
      if (isRequestTier && node.phase !== phase) continue
      if (node.expiresAt !== undefined && Date.parse(node.expiresAt) <= Date.parse(observedAt)) {
        dropped.push(frozenResult({ nodeId: node.id, reason: { code: 'expired', detail: 'contribution expired before composition' } }))
        continue
      }
      eligible.push(node)
    }
    eligible.sort(compareNodes)
    let kept = eligible
    if (normalizedBudget !== null) {
      const truncated = applyBudget(eligible, normalizedBudget)
      kept = truncated.kept
      for (const entry of truncated.dropped) dropped.push(frozenResult({ nodeId: entry.nodeId, reason: entry.reason }))
    }
    const policyDegraded = []
    let policyOrdered = policyOrder()
    if (policyOrdered.length > 0) {
      const frozenInput = deepFreeze(kept.map((node) => nodeProjection(node)))
      const context = deepFreeze({ sessionId, phase, observedAt })
      for (const policy of policyOrdered) {
        let result
        try {
          result = policy.fn(frozenInput, context)
        } catch (error) {
          policyDegraded.push({ name: policy.name, reason: 'threw' })
          report(`<policy:${policy.name}>`, `context compose policy threw: ${error?.message ?? error}`)
          continue
        }
        if (!Array.isArray(result)) {
          policyDegraded.push({ name: policy.name, reason: 'invalid-result' })
          continue
        }
        const byId = new Map(kept.map((node) => [node.id, node]))
        const next = []
        const seen = new Set()
        for (const entry of result) {
          const id = isPlainRecord(entry) && typeof entry.id === 'string' ? entry.id : undefined
          if (id === undefined || seen.has(id) || !byId.has(id)) continue
          seen.add(id)
          next.push(byId.get(id))
        }
        for (const node of kept) {
          if (seen.has(node.id)) continue
          dropped.push(frozenResult({ nodeId: node.id, reason: { code: 'policy-excluded', detail: `excluded by policy "${policy.name}"` } }))
        }
        kept = next
      }
    }
    // Per-node degraded evidence from the session-surface seam (bounded,
    // projection-level; never blocks composition).
    const degradedByNode = new Map()
    const surfaceAdapter = sources.sessionSurface
    if (surfaceAdapter && typeof surfaceAdapter.verifySeqBounds === 'function') {
      for (const node of kept) {
        if (!Array.isArray(node.sourceEventSeqs) || node.sourceEventSeqs.length === 0) continue
        let verified
        try {
          verified = surfaceAdapter.verifySeqBounds(sessionId, node.sourceEventSeqs)
        } catch {
          verified = { ok: false, outOfRange: node.sourceEventSeqs }
        }
        if (verified && verified.ok === false && Array.isArray(verified.outOfRange) && verified.outOfRange.length > 0) {
          degradedByNode.set(node.id, [{ part: 'sourceEventSeqs', reason: 'out-of-range' }])
        }
      }
    }
    const nodes = kept.map((node) => nodeProjection(node, {
      state: node.state === 'contributed' ? 'served' : node.state,
      degraded: degradedByNode.get(node.id) ?? [],
    }))
    const generation = (composeGenerations.get(sessionId) ?? 0) + 1
    const graph = frozenResult({
      sessionId,
      phase,
      generation,
      observedAt,
      budget: budgetMeta,
      nodes,
      dropped,
      sources: sourceStatuses(false),
      ...(policyDegraded.length > 0 ? { policyDegraded } : {}),
    })
    const abortedAtExit = aborted()
    if (abortedAtExit) return abortedAtExit
    composeGenerations.set(sessionId, generation)
    lastGraphs.set(sessionId, graph)
    return graph
  }

  function inspect(sessionRef, options = {}) {
    if (disposed) return frozenResult({ ok: false, code: 'INACTIVE', detail: 'context engine is disposed' })
    if (typeof sessionRef !== 'string' || sessionRef.length === 0) {
      return frozenResult({ ok: false, code: 'INSPECT_UNAVAILABLE', detail: 'inspect requires a session id string' })
    }
    let resolved
    try {
      resolved = sessionResolver(sessionRef)
    } catch {
      resolved = { ok: false }
    }
    if (!resolved || resolved.ok !== true) {
      return frozenResult({ ok: false, code: 'INSPECT_UNAVAILABLE', detail: 'session is missing or out of scope' })
    }
    const sessionId = resolved.sessionId ?? sessionRef
    const signal = options?.signal
    if (signal?.aborted) {
      return frozenResult({ sessionId, aborted: true, reason: signal.reason instanceof Error ? signal.reason.message : String(signal.reason) })
    }
    const { limit, cursor } = normalizeInspectOptions(options)
    const audience = options?.audience
    const observedAt = isoNow(now)
    const nowMs = Date.parse(observedAt)
    const rows = [] // unified pagination rows: { id, bucket, payload, observedAt }
    const droppedSeen = new Set()
    const nodeSeen = new Set()

    const pushDropped = (nodeId, reason, at) => {
      if (droppedSeen.has(nodeId)) return
      droppedSeen.add(nodeId)
      rows.push({ id: nodeId, bucket: 'dropped', payload: { nodeId, reason, observedAt: at }, observedAt: at })
    }

    const graph = lastGraphs.get(sessionId)
    if (graph !== undefined && Array.isArray(graph.nodes)) {
      for (const projection of graph.nodes) {
        if (nodeSeen.has(projection.id)) continue
        nodeSeen.add(projection.id)
        const node = findNodeById(sessionId, projection.id)
        if (node === undefined) continue
        const persistent = node.state !== 'contributed' ? node.state : undefined
        const state = persistent ?? projection.state ?? 'served'
        if (node.expiresAt !== undefined && Date.parse(node.expiresAt) <= nowMs) {
          pushDropped(node.id, { code: 'expired', detail: 'contribution expired' }, observedAt)
          continue
        }
        if (state === 'archived' || state === 'redacted' || state === 'superseded') {
          rows.push({
            id: node.id,
            bucket: 'archived',
            payload: { node: nodeProjection(node, { state }), reason: node.stateReason ?? { code: 'archived', detail: 'archived' } },
            observedAt: node.observedAt,
          })
          continue
        }
        rows.push({
          id: node.id,
          bucket: 'served',
          payload: { node: nodeProjection(node, { state: state === 'sent' ? 'sent' : 'served' }), reason: { code: 'served', detail: 'included in the latest composed graph' } },
          observedAt: node.observedAt,
        })
      }
    }
    for (const node of listSessionNodes(sessionId)) {
      if (nodeSeen.has(node.id)) continue
      nodeSeen.add(node.id)
      const state = derivedState(node)
      if (node.droppedReason !== null) {
        pushDropped(node.id, node.droppedReason, node.droppedObservedAt ?? observedAt)
        continue
      }
      if (state === 'archived' || state === 'redacted' || state === 'superseded') {
        rows.push({
          id: node.id,
          bucket: 'archived',
          payload: { node: nodeProjection(node, { state }), reason: node.stateReason ?? { code: 'archived', detail: 'archived' } },
          observedAt: node.observedAt,
        })
        continue
      }
      // registered but never part of a composed graph
      rows.push({
        id: node.id,
        bucket: 'archived',
        payload: { node: nodeProjection(node, { state }), reason: { code: 'contributed', detail: 'registered but never composed' } },
        observedAt: node.observedAt,
      })
    }
    for (const record of evictedDropped.get(sessionId) ?? []) {
      pushDropped(record.nodeId, record.reason, record.observedAt)
    }
    if (graph !== undefined && Array.isArray(graph.dropped)) {
      for (const entry of graph.dropped) pushDropped(entry.nodeId, entry.reason, graph.observedAt)
    }
    for (const node of listSessionNodes(sessionId)) {
      if (node.droppedReason !== null) pushDropped(node.id, node.droppedReason, node.droppedObservedAt ?? observedAt)
    }

    // Content inclusion is an explicit audience decision (default deny).
    if (audience === 'ui' || audience === 'diagnostic') {
      const includeContent = (row) => {
        const entry = row.payload
        const node = findNodeById(sessionId, entry.node.id)
        if (node === undefined || node.audience[audience] !== true || node.content === undefined) return row
        try {
          row.payload = { ...entry, content: deepFreeze(structuredClone(node.content)) }
          return row
        } catch (error) {
          const at = isoNow(now)
          if (node.state === 'contributed' && transition(node, 'redacted', { code: 'redaction-failed', detail: error?.message ?? 'content projection failed' }, at)) {
            notifyObservers({ kind: 'node-state', sessionId, nodeId: node.id, state: 'redacted', reason: node.stateReason, observedAt: at })
          }
          row.redactionFailed = true
          return row
        }
      }
      for (const row of rows) {
        if (row.bucket === 'served' || row.bucket === 'archived') includeContent(row)
      }
    }

    // Deterministic pagination across fixed bucket order served -> archived -> dropped.
    let start = 0
    if (cursor !== undefined) {
      const index = rows.findIndex((row) => row.id === cursor)
      start = index < 0 ? rows.length : index + 1
    }
    const page = rows.slice(start, start + limit)
    const truncated = start + page.length < rows.length
    let nextCursor
    if (truncated && page.length > 0) nextCursor = page[page.length - 1].id
    const served = page.filter((row) => row.bucket === 'served' && row.redactionFailed !== true).map((row) => row.payload)
    const archived = page.filter((row) => row.bucket === 'archived' && row.redactionFailed !== true).map((row) => row.payload)
    const dropped = page.filter((row) => row.bucket === 'dropped').map((row) => row.payload)
    const redactionFailures = rows.filter((row) => row.redactionFailed === true).map((row) => ({ nodeId: row.id, code: 'REDACTION_FAILED' }))
    return frozenResult({
      sessionId,
      limit,
      served,
      archived,
      dropped,
      truncated,
      ...(nextCursor === undefined ? {} : { nextCursor }),
      ...(cursor === undefined ? {} : { cursor }),
      ...(redactionFailures.length > 0 ? { redactionFailures } : {}),
    })
  }

  function mapping(query = {}) {
    if (disposed) return frozenResult({ ok: false, code: 'INACTIVE', detail: 'context engine is disposed' })
    const compaction = sources.compaction
    let compactionAvailable = false
    try {
      compactionAvailable = Boolean(compaction && typeof compaction.status === 'function' && (compaction.status() === 'available' || compaction.status() === 'degraded'))
    } catch {
      compactionAvailable = false
    }
    if (!compactionAvailable && mappings.length === 0) {
      return frozenResult({ ok: false, code: 'MAPPING_UNAVAILABLE', detail: 'compaction seam is unavailable; no fabricated mappings' })
    }
    const sessionId = typeof query.sessionId === 'string' ? query.sessionId : undefined
    const nodeId = typeof query.nodeId === 'string' ? query.nodeId : undefined
    const entries = mappings.filter((entry) => {
      if (sessionId !== undefined && entry.sessionId !== sessionId) return false
      if (nodeId !== undefined && !entry.oldNodeIds.includes(nodeId) && entry.newNodeId !== nodeId) return false
      return true
    })
    return frozenResult({ ok: true, entries, truncated: mappings.length >= MAX_MAPPING_HISTORY })
  }

  function recordMapping({ sessionId, oldNodeIds, newNodeId, reason, generation, observedAt } = {}) {
    if (disposed) return frozenResult({ ok: false, code: 'INACTIVE', detail: 'context engine is disposed' })
    const normalized = normalizeReplacementMapping({ oldNodeIds, newNodeId, reason, generation, observedAt })
    if (!normalized.ok) {
      report('<compaction>', `context replacement mapping rejected: ${normalized.problems.map((p) => `${p.field}: ${p.reason}`).join('; ')}`)
      return frozenResult({ ok: false, code: 'MAPPING_UNAVAILABLE', detail: 'replacement mapping is invalid' })
    }
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return frozenResult({ ok: false, code: 'MAPPING_UNAVAILABLE', detail: 'mapping requires a session id' })
    }
    const applied = registerMapping(sessionId, normalized.mapping)
    return frozenResult({ ok: true, ...applied })
  }

  /**
   * Compaction intake: resolves the compaction shadowed seq ranges to the
   * registered session-surface node ids (never fabricates ids the registry
   * did not produce), then records the bounded replacement mapping and
   * archives/supersedes the matching nodes.
   */
  function recordCompactionMapping({ sessionId, seqs, newNodeId, reason, generation, observedAt } = {}) {
    if (disposed) return frozenResult({ ok: false, code: 'INACTIVE', detail: 'context engine is disposed' })
    if (typeof sessionId !== 'string' || sessionId.length === 0 || !Array.isArray(seqs) || seqs.length === 0) {
      return frozenResult({ ok: false, code: 'MAPPING_UNAVAILABLE', detail: 'compaction mapping requires a session id and seq ranges' })
    }
    const shadowed = new Set(seqs.filter((seq) => typeof seq === 'number'))
    const oldNodeIds = listSessionNodes(sessionId)
      .filter((node) => node.source.kind === 'sessionSurface' && Array.isArray(node.sourceEventSeqs) && node.sourceEventSeqs.some((seq) => shadowed.has(seq)))
      .map((node) => node.id)
    if (oldNodeIds.length === 0) {
      report('<compaction>', 'compaction completed for a session with no registered session-surface nodes; mapping skipped')
      return frozenResult({ ok: true, transitionsApplied: 0, matched: 0 })
    }
    const normalized = normalizeReplacementMapping({ oldNodeIds, newNodeId, reason, generation, observedAt })
    if (!normalized.ok) {
      return frozenResult({ ok: false, code: 'MAPPING_UNAVAILABLE', detail: 'compaction mapping is invalid' })
    }
    const applied = registerMapping(sessionId, normalized.mapping)
    return frozenResult({ ok: true, ...applied })
  }

  function registerMapping(sessionId, mapping) {
    let transitionsApplied = 0
    for (const oldNodeId of mapping.oldNodeIds) {
      const node = findNodeById(sessionId, oldNodeId)
      if (node === undefined || node.scope.key !== sessionId) continue
      const targetState = mapping.reason === 'superseded' ? 'superseded' : 'archived'
      if (transition(node, targetState, { code: mapping.reason, detail: `replaced by ${mapping.newNodeId}` }, mapping.observedAt)) {
        transitionsApplied += 1
        notifyObservers({ kind: 'node-state', sessionId, nodeId: node.id, state: targetState, reason: node.stateReason, observedAt: mapping.observedAt })
      }
    }
    const entry = frozenResult({ sessionId, ...mapping, transitionsApplied })
    mappings.push(entry)
    if (mappings.length > MAX_MAPPING_HISTORY) mappings.shift()
    notifyObservers({ kind: 'mapping', sessionId, newNodeId: mapping.newNodeId, observedAt: mapping.observedAt })
    return { transitionsApplied }
  }

  function intakeEvidence(payload) {
    if (disposed) return frozenResult({ ok: false, code: 'INACTIVE', detail: 'context engine is disposed' })
    const normalized = normalizeAssembledEvidence(payload)
    if (!normalized.ok) {
      report('<assembled-evidence>', `context evidence rejected: ${normalized.problems.map((p) => `${p.field}: ${p.reason}`).join('; ')}`)
      return frozenResult({ ok: false, code: 'EVIDENCE_UNAVAILABLE', detail: 'assembled-context evidence is invalid' })
    }
    const evidence = normalized.evidence
    const sessionId = evidence.sessionId
    const latest = evidenceGenerations.get(sessionId) ?? 0
    if (evidence.generation <= latest) {
      const diagnostics = staleEvidence.get(sessionId) ?? []
      diagnostics.push(frozenResult({ generation: evidence.generation, observedAt: evidence.observedAt }))
      if (diagnostics.length > MAX_STALE_EVIDENCE_DIAGNOSTICS) diagnostics.shift()
      staleEvidence.set(sessionId, diagnostics)
      return frozenResult({ ok: true, stale: true, reason: 'stale-generation' })
    }
    evidenceGenerations.set(sessionId, evidence.generation)
    const nodes = listSessionNodes(sessionId)
    // dropped refs first: a dropped section never transitions to sent.
    const droppedRefs = new Map(evidence.dropped.map((entry) => [entry.ref, entry.reason]))
    for (const node of nodes) {
      if (node.state !== 'contributed' || node.droppedReason !== null) continue
      if (node.sectionKey === undefined || !droppedRefs.has(node.sectionKey)) continue
      node.droppedReason = frozenResult({ code: 'evidence-dropped', detail: droppedRefs.get(node.sectionKey) })
      node.droppedObservedAt = evidence.observedAt
    }
    const sectionKeys = new Set(evidence.systemSections.map((entry) => entry.sectionKey))
    const ranges = evidence.messageRanges
    const seqInRanges = new Set()
    for (const range of ranges) {
      for (let seq = range.fromSeq; seq <= range.toSeq; seq += 1) seqInRanges.add(seq)
    }
    let transitionsApplied = 0
    for (const node of nodes) {
      if (node.state !== 'contributed' || node.droppedReason !== null) continue
      let matched = false
      if (node.source.kind === 'systemPrompt' && node.sectionKey !== undefined && sectionKeys.has(node.sectionKey)) matched = true
      if (!matched && node.source.kind === 'sessionSurface' && Array.isArray(node.sourceEventSeqs) && node.sourceEventSeqs.length > 0) {
        matched = node.sourceEventSeqs.every((seq) => seqInRanges.has(seq))
      }
      if (!matched) continue
      if (transition(node, 'sent', { code: 'evidence', detail: `matched assembled-context evidence generation ${evidence.generation}` }, evidence.observedAt)) {
        node.sentBy = frozenResult({ evidenceId: String(evidence.generation), observedAt: evidence.observedAt })
        transitionsApplied += 1
        notifyObservers({ kind: 'node-state', sessionId, nodeId: node.id, state: 'sent', reason: node.stateReason, observedAt: evidence.observedAt })
      }
    }
    const ringLimit = Number.isSafeInteger(evidenceRingLimit) && evidenceRingLimit > 0 ? evidenceRingLimit : MAX_EVIDENCE_RING
    evidenceRing.push(frozenResult({ ...evidence, evidenceId: String(evidence.generation) }))
    if (evidenceRing.length > ringLimit) evidenceRing.shift()
    notifyObservers({ kind: 'evidence', sessionId, generation: evidence.generation, observedAt: evidence.observedAt, transitionsApplied })
    return frozenResult({ ok: true, stale: false, transitionsApplied })
  }

  function observe(listener) {
    if (disposed) return frozenResult({ ok: false, code: 'INACTIVE', detail: 'context engine is disposed' })
    if (typeof listener !== 'function') {
      report('<observe>', 'context observer listener is not a function; subscription ignored')
      return frozenResult({ ok: false, code: 'CONTRIBUTION_INVALID', detail: 'observer listener must be a function' })
    }
    const seq = ++observerSeq
    observers.set(seq, listener)
    return frozenResult({
      ok: true,
      disposer: () => {
        const existed = observers.delete(seq)
        return frozenResult({ ok: true, already: !existed })
      },
    })
  }

  function registerPolicy(fn, options = {}) {
    if (disposed) return frozenResult({ ok: false, code: 'INACTIVE', detail: 'context engine is disposed' })
    if (typeof fn !== 'function') {
      report('<policy>', 'context compose policy is not a function; registration ignored')
      return frozenResult({ ok: false, code: 'CONTRIBUTION_INVALID', detail: 'compose policy must be a function' })
    }
    const priority = typeof options?.priority === 'string' ? options.priority : 'normal'
    const name = typeof options?.name === 'string' && options.name.length > 0 ? options.name : `policy-${++policySeq}`
    const entry = { fn, name, priority, seq: ++policySeq }
    policies.push(entry)
    return frozenResult({
      ok: true,
      disposer: () => {
        const index = policies.indexOf(entry)
        if (index >= 0) policies.splice(index, 1)
        return frozenResult({ ok: true, already: index < 0 })
      },
    })
  }

  function availability() {
    if (disposed) return frozenResult({ active: false, sentReachable: false })
    return frozenResult({ active: true, ...sourceStatuses(true) })
  }

  function dispose() {
    if (disposed) return
    disposed = true
    observers.clear()
    policies.length = 0
    registry.clear()
    sessionNodes.clear()
    lastGraphs.clear()
    composeGenerations.clear()
    evidenceGenerations.clear()
    evidenceRing.length = 0
    staleEvidence.clear()
    mappings.length = 0
    evictedDropped.clear()
  }

  return Object.freeze({
    contribute,
    compose,
    inspect,
    mapping,
    policy: Object.freeze({ register: registerPolicy }),
    observe,
    intakeEvidence,
    recordMapping,
    recordCompactionMapping,
    availability,
    dispose,
  })
}