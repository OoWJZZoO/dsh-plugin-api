/**
 * Pure validation and normalization helpers for the tool discovery catalog.
 *
 * This module carries no harness dependencies and no official-service calls:
 * every function is a pure transformation or a fail-safe normalization. The
 * engine composes these helpers and is responsible for freezing projected
 * data and for owner-attributed failure reporting.
 *
 * The structured-clone guarantee matters: the official system-prompt assemble
 * performs `structuredClone(parameters)` on each provider-emitted schema
 * OUTSIDE the provider call, with no try/catch. Normalizing to a verified
 * clone here is what keeps one bad definition from breaking an assembly.
 */
export const CODES = Object.freeze({
  REGISTRATION_INVALID: 'DISCOVERY_REGISTRATION_INVALID',
  ENTRY_CONFLICT: 'DISCOVERY_ENTRY_CONFLICT',
  ENTRY_UNKNOWN: 'DISCOVERY_ENTRY_UNKNOWN',
  ENTRY_DISPOSED: 'DISCOVERY_ENTRY_DISPOSED',
  ENTRY_DEACTIVATED: 'DISCOVERY_ENTRY_DEACTIVATED',
  ENTRY_FAILED: 'DISCOVERY_ENTRY_FAILED',
  SCOPE_UNRESOLVED: 'DISCOVERY_SCOPE_UNRESOLVED',
  GENERATION_STALE: 'DISCOVERY_GENERATION_STALE',
  ACTIVATION_SUPERSEDED: 'DISCOVERY_ACTIVATION_SUPERSEDED',
})

export const SOURCE_KINDS = Object.freeze(['plugin', 'skill', 'mcp', 'builtin-ref'])

export const MAX_SUMMARY_LENGTH = 200
export const MAX_CAPABILITIES = 16
export const MAX_TOOL_NAMES = 16
export const DEFAULT_AUDIT_LIMIT = 500
export const DEFAULT_PAGE_SIZE = 100

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function invalid(code, detail) {
  return { ok: false, code, detail }
}

/**
 * Normalize and validate one catalog registration spec.
 * @returns {{ ok: true, value: { id, owner, summary, capabilities, sourceKind, toolNames } } | { ok: false, code, detail }}
 */
export function normalizeDescriptorSpec(spec) {
  if (!isObject(spec)) return invalid(CODES.REGISTRATION_INVALID, 'registration spec must be an object')
  const { id, owner, summary, capabilities, activate } = spec
  if (!isNonEmptyString(id)) return invalid(CODES.REGISTRATION_INVALID, 'entry id must be a non-empty string')
  if (!isNonEmptyString(owner)) return invalid(CODES.REGISTRATION_INVALID, 'owner id must be a non-empty string')
  if (typeof summary !== 'string') return invalid(CODES.REGISTRATION_INVALID, 'summary must be a string')
  if (summary.length > MAX_SUMMARY_LENGTH) {
    return invalid(CODES.REGISTRATION_INVALID, `summary must be at most ${MAX_SUMMARY_LENGTH} characters`)
  }
  if (!Array.isArray(capabilities)) return invalid(CODES.REGISTRATION_INVALID, 'capabilities must be an array')
  if (capabilities.length > MAX_CAPABILITIES) {
    return invalid(CODES.REGISTRATION_INVALID, `capabilities must be at most ${MAX_CAPABILITIES} items`)
  }
  for (const entry of capabilities) {
    if (!isNonEmptyString(entry)) return invalid(CODES.REGISTRATION_INVALID, 'each capability must be a non-empty string')
  }
  let toolNames
  if (spec.toolNames !== undefined) {
    if (!Array.isArray(spec.toolNames)) return invalid(CODES.REGISTRATION_INVALID, 'toolNames must be an array')
    if (spec.toolNames.length > MAX_TOOL_NAMES) {
      return invalid(CODES.REGISTRATION_INVALID, `toolNames must be at most ${MAX_TOOL_NAMES} items`)
    }
    for (const entry of spec.toolNames) {
      if (!isNonEmptyString(entry)) return invalid(CODES.REGISTRATION_INVALID, 'each toolNames entry must be a non-empty string')
    }
    toolNames = [...spec.toolNames]
  }
  const sourceKind = spec.sourceKind === undefined ? 'plugin' : spec.sourceKind
  if (!SOURCE_KINDS.includes(sourceKind)) {
    return invalid(CODES.REGISTRATION_INVALID, `sourceKind must be one of ${SOURCE_KINDS.join('|')}`)
  }
  if (typeof activate !== 'function') return invalid(CODES.REGISTRATION_INVALID, 'activate must be a function')
  return {
    ok: true,
    value: { id, owner, summary, capabilities: [...capabilities], sourceKind, toolNames, activate },
  }
}

/**
 * Normalize an activation output into clone-safe tool schemas.
 * One malformed or non-cloneable element fails the whole activation so a
 * broken definition can never leak into the official assembly.
 * @returns {{ ok: true, tools: Array<{ name, description, parameters }> } | { ok: false, code, detail }}
 */
export function normalizeToolDefinitions(output) {
  if (!Array.isArray(output)) return invalid(CODES.ENTRY_FAILED, 'activate output must be an array of tool definitions')
  const tools = []
  for (let index = 0; index < output.length; index += 1) {
    const definition = output[index]
    if (!isObject(definition)) return invalid(CODES.ENTRY_FAILED, `tool definition ${index} is not an object`)
    const name = definition.name
    if (!isNonEmptyString(name)) return invalid(CODES.ENTRY_FAILED, `tool definition ${index} has no non-empty name`)
    if (definition.description !== undefined && typeof definition.description !== 'string') {
      return invalid(CODES.ENTRY_FAILED, `tool definition ${index} description must be a string`)
    }
    const rawParameters = definition.parameters === undefined ? {} : definition.parameters
    if (!isObject(rawParameters)) return invalid(CODES.ENTRY_FAILED, `tool definition ${index} parameters must be an object`)
    let parameters
    try {
      parameters = structuredClone(rawParameters)
    } catch (error) {
      return invalid(CODES.ENTRY_FAILED, `tool definition ${index} parameters are not structured-clone safe: ${error?.message ?? error}`)
    }
    tools.push({ name, description: definition.description ?? '', parameters })
  }
  return { ok: true, tools }
}

/**
 * Resolve the owning agent scope key from an activation target.
 * @returns {{ ok: true, scopeKey: string } | { ok: false, code: 'DISCOVERY_SCOPE_UNRESOLVED' }}
 */
export function resolveScopeKey({ session, execution } = {}) {
  if (isObject(session) && isNonEmptyString(session.id)) return { ok: true, scopeKey: String(session.id) }
  if (isObject(execution) && isObject(execution.agent) && isObject(execution.agent.session) && isNonEmptyString(execution.agent.session.id)) {
    return { ok: true, scopeKey: String(execution.agent.session.id) }
  }
  if (isObject(execution) && isNonEmptyString(execution.sessionId)) return { ok: true, scopeKey: String(execution.sessionId) }
  return invalid(CODES.SCOPE_UNRESOLVED, 'activation scope cannot be resolved from session or execution')
}

/** Resolve the scope key visible inside one system-prompt assemble context. */
export function scopeKeyOfContext(context) {
  if (!isObject(context)) return undefined
  const scope = isObject(context.scope) ? context.scope : undefined
  const agent = isObject(context.agent) ? context.agent : undefined
  if (scope && isObject(scope.session) && isNonEmptyString(scope.session.id)) return String(scope.session.id)
  if (agent && isObject(agent.session) && isNonEmptyString(agent.session.id)) return String(agent.session.id)
  return undefined
}

/** Best-effort execution reference for audit records; undefined when absent. */
export function executionIdOf({ execution } = {}) {
  if (isObject(execution) && isNonEmptyString(execution.id)) return String(execution.id)
  return undefined
}

/** Optional free-text reasons survive only as non-empty strings. */
export function normalizeReason(reason) {
  return isNonEmptyString(reason) ? reason : undefined
}

/** Case-insensitive substring match over id, summary, and every capability. */
export function matchesQuery(descriptor, query) {
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (needle === '') return true
  if (String(descriptor.id).toLowerCase().includes(needle)) return true
  if (String(descriptor.summary).toLowerCase().includes(needle)) return true
  return descriptor.capabilities.some((entry) => String(entry).toLowerCase().includes(needle))
}

/**
 * Defensive normalization for a scope-constraint source result. Any malformed
 * or unknown state degrades to a safe, non-blocking value: search continues.
 */
export function normalizeConstraintResult(value) {
  if (!isObject(value)) return { status: 'none', forbidden: [] }
  const status = value.status === 'applied' ? 'applied' : value.status === 'none' ? 'none' : 'unknown'
  const forbidden = []
  if (Array.isArray(value.forbidden)) {
    for (const entry of value.forbidden) {
      if (isObject(entry) && isNonEmptyString(entry.entryId)) {
        forbidden.push({ entryId: entry.entryId, reason: normalizeReason(entry.reason) })
      }
    }
  }
  const result = { status, forbidden }
  if (status !== 'none') {
    if (isNonEmptyString(value.source)) result.source = value.source
    if (isNonEmptyString(value.reason)) result.reason = value.reason
    if (isNonEmptyString(value.detail)) result.detail = value.detail
  }
  return result
}

/** Normalize audit query pagination; never allows an unbounded read. */
export function normalizeAuditQuery(filter = {}) {
  const entryId = isNonEmptyString(filter.entryId) ? filter.entryId : undefined
  const owner = isNonEmptyString(filter.owner) ? filter.owner : undefined
  const kind = isNonEmptyString(filter.kind) ? filter.kind : undefined
  const limit = Number.isInteger(Number(filter.limit)) && Number(filter.limit) > 0
    ? Math.min(Number(filter.limit), DEFAULT_AUDIT_LIMIT)
    : DEFAULT_PAGE_SIZE
  const cursor = Number.isInteger(Number(filter.cursor)) && Number(filter.cursor) >= 0
    ? Number(filter.cursor)
    : 0
  const result = { limit, cursor }
  if (entryId !== undefined) result.entryId = entryId
  if (owner !== undefined) result.owner = owner
  if (kind !== undefined) result.kind = kind
  return result
}