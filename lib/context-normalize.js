/**
 * Pure normalization, ordering, and budget helpers for the context
 * provenance facade. Zero harness dependencies: no Cordis, no official
 * service, no facade service import — every function is a pure
 * validator/composer over plain data so the engine and sources can share
 * one vocabulary without environment coupling.
 *
 * Vocabulary (neutral, capability-facing):
 * - contribution: { id, owner, scope{kind,key}, phase, priority, source{kind,
 *   owner}, sourceEventSeqs?, content?, refs?, sectionKey?, expiresAt?,
 *   supersedes?, audience{model,ui,diagnostic} }
 * - node lifecycle/visibility states: contributed | served | sent | archived |
 *   redacted | superseded (visibility/lifecycle vocabulary, not terminal
 *   outcome vocabulary)
 * - assembled-context evidence payload:
 *   { sessionId, generation, systemSections[{sectionKey,sourceTags}],
 *     messageRanges[{fromSeq,toSeq,count}], dropped[{ref,reason}], observedAt }
 *   — identifiers/seq ranges/reasons only; NEVER content or secret values.
 * - replacement mapping: { oldNodeIds[], newNodeId, reason, generation,
 *   observedAt }
 *
 * The ordering contract (documented tie-breaking for compose): session-tier
 * before request-tier, phase lexicographic ascending, priority rank
 * descending (highest first), registration sequence ascending, id
 * lexicographic ascending as the final tie-break.
 */

export const CONTEXT_SOURCE_KINDS = Object.freeze([
  'systemPrompt',
  'sessionSurface',
  'attachment',
  'toolExposure',
  'skillExposure',
  'memory',
  'compaction',
  'assembledEvidence',
])

export const NODE_STATES = Object.freeze([
  'contributed',
  'served',
  'sent',
  'archived',
  'redacted',
  'superseded',
])

export const PRIORITIES = Object.freeze(['lowest', 'low', 'normal', 'high', 'highest', 'monitor'])

/** Priority rank: lowest=0 … monitor=5 (highest value sorts first). */
export const PRIORITY_RANK = Object.freeze(Object.fromEntries(PRIORITIES.map((name, index) => [name, index])))

export const SCOPE_KINDS = Object.freeze(['request', 'session'])

export const DEFAULT_PHASE = 'default'

/** Bounded provenance references: sequence numbers the source actually provided. */
export const MAX_SOURCE_EVENT_SEQS = 64

/** Bounded free-form reference identifiers carried by a contribution. */
export const MAX_REFS = 64

export const DEFAULT_INSPECT_LIMIT = 50
export const MAX_INSPECT_LIMIT = 200

/** Bounded in-memory evidence ring (never durable). */
export const MAX_EVIDENCE_RING = 200

/** Bounded replacement mapping history. */
export const MAX_MAPPING_HISTORY = 200

/** Per-session registered-node capacity; overflow drops the oldest contributed node. */
export const MAX_NODES_PER_SESSION = 1000

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function isIsoString(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isEventSeq(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Recursively detect content-bearing keys ('content', 'secret') so evidence
 * normalization can enforce the identifiers-only invariant.
 */
export function hasContentLikeKeys(value, seen = new Set()) {
  if (!isPlainRecord(value) && !Array.isArray(value)) return false
  if (seen.has(value)) return false
  seen.add(value)
  for (const key of Object.keys(value)) {
    if (key === 'content' || key === 'secret') return true
    if (hasContentLikeKeys(value[key], seen)) return true
  }
  return false
}

function problem(field, reason) {
  return { field, reason }
}

function hasExtraKeys(value, allowed) {
  return Object.keys(value).some((key) => !allowed.includes(key))
}

/**
 * Validate and normalize one contribution registration.
 *
 * @param {unknown} spec
 * @returns {{ok: true, contribution: object} | {ok: false, problems: Array<{field:string, reason:string}>}}
 */
export function normalizeContribution(spec) {
  if (!isPlainRecord(spec)) return { ok: false, problems: [problem('spec', 'contribution must be a plain object')] }
  const problems = []
  const { id, owner, scope, phase, priority, source, audience } = spec
  if (!isNonEmptyString(id)) problems.push(problem('id', 'a unique non-empty id is required'))
  if (typeof owner !== 'string' || owner.trim().length === 0) problems.push(problem('owner', 'a non-empty owner is required'))
  if (!isPlainRecord(scope)) {
    problems.push(problem('scope', 'a single scope tier { kind, key } is required'))
  } else {
    if (!SCOPE_KINDS.includes(scope.kind)) problems.push(problem('scope.kind', `scope.kind must be one of ${SCOPE_KINDS.join(', ')}`))
    if (!isNonEmptyString(scope.key)) problems.push(problem('scope.key', 'scope.key must be a non-empty string'))
  }
  if (phase !== undefined && !isNonEmptyString(phase)) problems.push(problem('phase', 'phase must be a non-empty string'))
  if (priority !== undefined && !PRIORITIES.includes(priority)) {
    problems.push(problem('priority', `priority must be one of ${PRIORITIES.join(', ')}`))
  }
  if (!isPlainRecord(source)) {
    problems.push(problem('source', 'source { kind, owner } is required'))
  } else {
    if (!CONTEXT_SOURCE_KINDS.includes(source.kind)) {
      problems.push(problem('source.kind', `source.kind must be one of ${CONTEXT_SOURCE_KINDS.join(', ')}`))
    }
    if (typeof source.owner !== 'string' || source.owner.trim().length === 0) {
      problems.push(problem('source.owner', 'source.owner must be a non-empty string'))
    }
  }
  if (!isPlainRecord(audience)) {
    problems.push(problem('audience', 'an audience envelope { model, ui, diagnostic } is required'))
  } else {
    for (const key of ['model', 'ui', 'diagnostic']) {
      if (typeof audience[key] !== 'boolean') problems.push(problem(`audience.${key}`, `audience.${key} must be a boolean`))
    }
  }
  const sourceEventSeqs = spec.sourceEventSeqs
  if (sourceEventSeqs !== undefined) {
    if (!Array.isArray(sourceEventSeqs) || sourceEventSeqs.length > MAX_SOURCE_EVENT_SEQS || !sourceEventSeqs.every(isEventSeq)) {
      problems.push(problem('sourceEventSeqs', `sourceEventSeqs must be an array of at most ${MAX_SOURCE_EVENT_SEQS} non-negative event sequences`))
    }
  }
  const refs = spec.refs
  if (refs !== undefined) {
    if (!Array.isArray(refs) || refs.length > MAX_REFS || !refs.every(isNonEmptyString)) {
      problems.push(problem('refs', `refs must be an array of at most ${MAX_REFS} non-empty strings`))
    }
  }
  if (spec.sectionKey !== undefined && !isNonEmptyString(spec.sectionKey)) {
    problems.push(problem('sectionKey', 'sectionKey must be a non-empty string'))
  }
  if (spec.expiresAt !== undefined && !isIsoString(spec.expiresAt)) {
    problems.push(problem('expiresAt', 'expiresAt must be an ISO date-time string'))
  }
  if (spec.supersedes !== undefined && !isNonEmptyString(spec.supersedes)) {
    problems.push(problem('supersedes', 'supersedes must be a non-empty node id'))
  }
  if (problems.length > 0) return { ok: false, problems }

  return {
    ok: true,
    contribution: {
      id,
      owner,
      scope: { kind: scope.kind, key: scope.key },
      phase: phase === undefined ? DEFAULT_PHASE : phase,
      priority: priority === undefined ? 'normal' : priority,
      source: { kind: source.kind, owner: source.owner },
      ...(sourceEventSeqs === undefined ? {} : { sourceEventSeqs: [...sourceEventSeqs] }),
      ...(spec.content === undefined ? {} : { content: spec.content }),
      ...(refs === undefined ? {} : { refs: [...refs] }),
      ...(spec.sectionKey === undefined ? {} : { sectionKey: spec.sectionKey }),
      ...(spec.expiresAt === undefined ? {} : { expiresAt: spec.expiresAt }),
      ...(spec.supersedes === undefined ? {} : { supersedes: spec.supersedes }),
      audience: { model: audience.model, ui: audience.ui, diagnostic: audience.diagnostic },
    },
  }
}

/**
 * Normalize a compose budget. Malformed budgets are rejected (the caller sees
 * `budget.applied: false` instead of a silent unbounded composition).
 *
 * @param {unknown} budget
 * @returns {{ok: true, budget: {maxNodes: number}} | {ok: false, reason: string}}
 */
export function normalizeBudget(budget) {
  if (budget === undefined || budget === null) return { ok: true, budget: { maxNodes: Number.MAX_SAFE_INTEGER } }
  if (!isPlainRecord(budget) || !Number.isSafeInteger(budget.maxNodes) || budget.maxNodes < 1) {
    return { ok: false, reason: 'budget.maxNodes must be a positive safe integer' }
  }
  return { ok: true, budget: { maxNodes: budget.maxNodes } }
}

/**
 * Deterministic node ordering (scope tier, phase, priority, registration
 * sequence, id — see module header for the documented tie-breaking).
 */
export function compareNodes(a, b) {
  const scopeA = a.scope.kind === 'session' ? 0 : 1
  const scopeB = b.scope.kind === 'session' ? 0 : 1
  if (scopeA !== scopeB) return scopeA - scopeB
  if (a.phase !== b.phase) return a.phase < b.phase ? -1 : 1
  const priorityA = PRIORITY_RANK[a.priority] ?? 0
  const priorityB = PRIORITY_RANK[b.priority] ?? 0
  if (priorityA !== priorityB) return priorityB - priorityA
  if (a.registrationSeq !== b.registrationSeq) return a.registrationSeq - b.registrationSeq
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  return 0
}

/**
 * Apply a normalized budget to an ordered node list. Returns the kept nodes
 * plus per-node dropped reasons (never silently over-budget).
 *
 * @param {Array<object>} nodes - ordered nodes (each carries `id`)
 * @param {{maxNodes: number}} budget
 * @returns {{kept: Array<object>, dropped: Array<{nodeId: string, reason: {code: string, detail: string}}>}}
 */
export function applyBudget(nodes, budget) {
  const maxNodes = budget?.maxNodes
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1) return { kept: nodes, dropped: [] }
  if (nodes.length <= maxNodes) return { kept: nodes, dropped: [] }
  const kept = nodes.slice(0, maxNodes)
  const dropped = nodes.slice(maxNodes).map((node) => ({
    nodeId: node.id,
    reason: { code: 'budget-exceeded', detail: `composition budget of ${maxNodes} nodes exceeded` },
  }))
  return { kept, dropped }
}

/**
 * Validate one assembled-context evidence payload (frozen schema vocabulary).
 * Enforces the identifiers-only invariant (no content/secret anywhere) and
 * range consistency (count === toSeq - fromSeq + 1).
 *
 * @param {unknown} payload
 * @returns {{ok: true, evidence: object} | {ok: false, problems: Array<{field: string, reason: string}>}}
 */
export function normalizeAssembledEvidence(payload) {
  if (!isPlainRecord(payload)) return { ok: false, problems: [problem('payload', 'evidence payload must be a plain object')] }
  const problems = []
  const topLevelKeys = ['sessionId', 'generation', 'systemSections', 'messageRanges', 'dropped', 'observedAt']
  if (hasExtraKeys(payload, topLevelKeys)) {
    problems.push(problem('payload', `evidence payload allows only ${topLevelKeys.join(', ')} fields`))
  }
  if (!isNonEmptyString(payload.sessionId)) problems.push(problem('sessionId', 'sessionId must be a non-empty string'))
  if (payload.generation === undefined || typeof payload.generation !== 'number' || !Number.isSafeInteger(payload.generation) || payload.generation < 1) {
    problems.push(problem('generation', 'generation must be a positive safe integer assembly sequence'))
  }
  if (!Array.isArray(payload.systemSections) || payload.systemSections.some((entry) => {
    return !isPlainRecord(entry) || hasExtraKeys(entry, ['sectionKey', 'sourceTags']) || !isNonEmptyString(entry.sectionKey) || !Array.isArray(entry.sourceTags) || !entry.sourceTags.every(isNonEmptyString)
  })) {
    problems.push(problem('systemSections', 'systemSections must be [{ sectionKey, sourceTags }] entries'))
  }
  if (!Array.isArray(payload.messageRanges) || payload.messageRanges.some((range) => {
    return !isPlainRecord(range) || hasExtraKeys(range, ['fromSeq', 'toSeq', 'count'])
      || !isEventSeq(range.fromSeq) || !isEventSeq(range.toSeq) || range.fromSeq > range.toSeq
      || !Number.isSafeInteger(range.count) || range.count !== range.toSeq - range.fromSeq + 1
  })) {
    problems.push(problem('messageRanges', 'messageRanges must be [{ fromSeq, toSeq, count }] with count === toSeq - fromSeq + 1'))
  }
  if (!Array.isArray(payload.dropped) || payload.dropped.some((entry) => {
    return !isPlainRecord(entry) || hasExtraKeys(entry, ['ref', 'reason']) || !isNonEmptyString(entry.ref) || !isNonEmptyString(entry.reason)
  })) {
    problems.push(problem('dropped', 'dropped must be [{ ref, reason }] entries'))
  }
  if (!isIsoString(payload.observedAt)) problems.push(problem('observedAt', 'observedAt must be an ISO date-time string'))
  if (hasContentLikeKeys(payload)) problems.push(problem('content', 'evidence payload must not carry content or secret values (identifiers/seq ranges only)'))
  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    evidence: {
      sessionId: payload.sessionId,
      generation: payload.generation,
      systemSections: payload.systemSections.map((entry) => ({ sectionKey: entry.sectionKey, sourceTags: [...entry.sourceTags] })),
      messageRanges: payload.messageRanges.map((range) => ({ fromSeq: range.fromSeq, toSeq: range.toSeq, count: range.count })),
      dropped: payload.dropped.map((entry) => ({ ref: entry.ref, reason: entry.reason })),
      observedAt: payload.observedAt,
    },
  }
}

/**
 * Validate one replacement mapping record (compaction/prune lineage).
 *
 * @param {unknown} record
 * @returns {{ok: true, mapping: object} | {ok: false, problems: Array<{field: string, reason: string}>}}
 */
export function normalizeReplacementMapping(record) {
  if (!isPlainRecord(record)) return { ok: false, problems: [problem('record', 'mapping record must be a plain object')] }
  const problems = []
  if (!Array.isArray(record.oldNodeIds) || record.oldNodeIds.length === 0 || !record.oldNodeIds.every(isNonEmptyString)) {
    problems.push(problem('oldNodeIds', 'oldNodeIds must be a non-empty array of non-empty node ids'))
  }
  if (!isNonEmptyString(record.newNodeId)) problems.push(problem('newNodeId', 'newNodeId must be a non-empty string'))
  if (!isNonEmptyString(record.reason)) problems.push(problem('reason', 'reason must be a non-empty string'))
  if (record.generation === undefined || typeof record.generation !== 'string' || record.generation.length === 0) {
    problems.push(problem('generation', 'generation must be a non-empty owner-specific token string'))
  }
  if (!isIsoString(record.observedAt)) problems.push(problem('observedAt', 'observedAt must be an ISO date-time string'))
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, mapping: record }
}

/**
 * Validate one skill-exposure record against the frozen skill-exposure
 * record vocabulary shared with the sibling skill feature: structural shape, types,
 * and bounded arrays only — enum semantics are owned by the skill feature.
 *
 * @param {unknown} record
 * @returns {{ok: true, record: object} | {ok: false, problems: Array<{field: string, reason: string}>}}
 */
export function normalizeSkillExposureRecord(record) {
  if (!isPlainRecord(record)) return { ok: false, problems: [problem('record', 'exposure record must be a plain object')] }
  const problems = []
  if (!isNonEmptyString(record.skillId)) problems.push(problem('skillId', 'skillId must be a non-empty string'))
  if (!isNonEmptyString(record.owner)) problems.push(problem('owner', 'owner must be a non-empty string'))
  if (!isNonEmptyString(record.sourceKind)) problems.push(problem('sourceKind', 'sourceKind must be a non-empty string'))
  if (!isPlainRecord(record.scope) || !isNonEmptyString(record.scope.kind) || !isNonEmptyString(record.scope.key)) {
    problems.push(problem('scope', 'scope must be { kind, key } with non-empty strings'))
  }
  if (!isNonEmptyString(record.generation)) problems.push(problem('generation', 'generation must be a non-empty owner token string'))
  if (!Array.isArray(record.tools) || record.tools.length > 256 || record.tools.some((entry) => {
    return !isPlainRecord(entry) || !isNonEmptyString(entry.entryId) || !isNonEmptyString(entry.generation)
  })) {
    problems.push(problem('tools', 'tools must be bounded [{ entryId, generation }] entries'))
  }
  if (!Array.isArray(record.promptSections) || record.promptSections.length > 64 || !record.promptSections.every(isNonEmptyString)) {
    problems.push(problem('promptSections', 'promptSections must be a bounded array of non-empty section keys'))
  }
  if (!Array.isArray(record.resources) || record.resources.length > 64 || record.resources.some((entry) => {
    return !isPlainRecord(entry) || !isNonEmptyString(entry.resourceId)
  })) {
    problems.push(problem('resources', 'resources must be bounded [{ resourceId, metadata }] entries'))
  }
  if (!Array.isArray(record.degraded) || record.degraded.length > 16 || record.degraded.some((entry) => {
    return !isPlainRecord(entry) || !isNonEmptyString(entry.part) || !isNonEmptyString(entry.reason)
  })) {
    problems.push(problem('degraded', 'degraded must be a bounded [{ part, reason }] list'))
  }
  const availability = record.availability
  if (!isPlainRecord(availability) || !isNonEmptyString(availability.status)
    || !Array.isArray(availability.degradedParts) || availability.degradedParts.length > 16 || !availability.degradedParts.every(isNonEmptyString)
    || !isNonEmptyString(availability.seamStatus)) {
    problems.push(problem('availability', 'availability must be { status, degradedParts, seamStatus }'))
  }
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, record }
}

/**
 * Clamp inspect pagination options to the bounded defaults.
 *
 * @param {{limit?: number, cursor?: string}} options
 * @returns {{limit: number, cursor: string | undefined}}
 */
export function normalizeInspectOptions(options = {}) {
  const rawLimit = options?.limit
  let limit = DEFAULT_INSPECT_LIMIT
  if (Number.isSafeInteger(rawLimit) && rawLimit > 0) limit = Math.min(rawLimit, MAX_INSPECT_LIMIT)
  const cursor = typeof options?.cursor === 'string' && options.cursor.length > 0 ? options.cursor : undefined
  return { limit, cursor }
}