/**
 * Decision participation registries (host side).
 *
 * The public decision-participation face is a set of domain registries
 * (`agents.decisions`, `tools.executionPolicies`, `prompts.assemblyPolicies`,
 * `events.decisions`) whose entries are installed at the official dispatch
 * points through the events bus participation substrate. This module owns the
 * registry mechanics (owner derivation, per-owner opaque generations,
 * same-owner latest-wins, cross-owner typed conflict, identity-bound
 * disposal) and the per-point typed decision classifiers.
 *
 * The classifier vocabulary for each point mirrors the official producer's
 * consumption semantics (contract probes recorded in the feature spec):
 * an `undefined` return is always "no decision" (handled by the bus substrate
 * before classification); everything else must satisfy the point's vocabulary
 * or it is treated as malformed (no decision + bounded diagnostic).
 *
 * Zero harness dependencies beyond the facade error types: the registry is
 * dependency-injected with its install path, owner resolver and logger.
 */
import { PARTICIPATION_PRIORITIES } from './events-bus.js'
import { PluginApiError } from './errors.js'
import { releasedResult, staleResult } from './contract-kernel.js'

const ROOT_OWNER = 'root'

/** Typed error for a cross-owner same-id registration (policy outer contract). */
export class DecisionOwnerConflictError extends PluginApiError {
  constructor(message) {
    super('PLUGIN_API_DECISION_OWNER_CONFLICT', message)
    this.name = 'DecisionOwnerConflictError'
  }
}

/** Typed error raised from a participation slot when a deny decision applies. */
export class FsIntentDeniedError extends PluginApiError {
  constructor(reason) {
    super('PLUGIN_API_FS_INTENT_DENIED', typeof reason === 'string' && reason.length > 0 ? reason : 'fs intent denied by a decision policy')
    this.name = 'FsIntentDeniedError'
  }
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isThenable(value) {
  return value != null && typeof value.then === 'function'
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

/**
 * Normalize a participation spec: `{ id, priority?, decide, scope? }`.
 * Throws a typed error on contract violations (registration errors are
 * expressed as typed errors, not ok:false results).
 */
export function validateDecisionSpec(spec) {
  if (!isPlainRecord(spec)) {
    throw new PluginApiError('PLUGIN_API_DECISION_SPEC_INVALID', 'decision participation spec must be an object')
  }
  if (!isNonEmptyString(spec.id)) {
    throw new PluginApiError('PLUGIN_API_DECISION_SPEC_INVALID', 'decision participation id must be a non-empty string')
  }
  if (typeof spec.decide !== 'function') {
    throw new PluginApiError('PLUGIN_API_DECISION_SPEC_INVALID', 'decision participation decide must be a function')
  }
  const priority = spec.priority === undefined ? 'normal' : spec.priority
  if (!PARTICIPATION_PRIORITIES.includes(priority)) {
    throw new PluginApiError('PLUGIN_API_DECISION_SPEC_INVALID', `unsupported decision participation priority ${JSON.stringify(spec.priority)}`)
  }
  if (spec.scope !== undefined && spec.scope === null) {
    throw new PluginApiError('PLUGIN_API_DECISION_SPEC_INVALID', 'decision participation scope must not be null')
  }
  return { id: spec.id, priority, decide: spec.decide, ...(spec.scope !== undefined ? { scope: spec.scope } : {}) }
}

// ---------------------------------------------------------------------------
// Per-point decision classifiers. Verdicts: 'decision' | 'undecided' | 'malformed'.
// `undefined` never reaches a classifier (the substrate treats it as undecided).
// ---------------------------------------------------------------------------

/** `agent/pre-step`: official consumption short-circuits on reject; enter carries messages. */
export function classifyAgentPreStepDecision(value) {
  if (isPlainRecord(value) && value.kind === 'reject') {
    return value.reason === undefined || typeof value.reason === 'string' ? 'decision' : 'malformed'
  }
  if (isPlainRecord(value) && value.kind === 'enter' && Array.isArray(value.messages)) return 'decision'
  return 'malformed'
}

/** `agent/request`: official consumption reads provider/model off the config object. */
export function classifyAgentRequestDecision(value) {
  if (isPlainRecord(value) && isNonEmptyString(value.provider) && isNonEmptyString(value.model)) return 'decision'
  return 'malformed'
}

/** `agent/request-error`: official consumption only checks `kind === 'retry'`. */
export function classifyAgentRequestErrorDecision(value) {
  if (isPlainRecord(value) && value.kind === 'retry') return 'decision'
  return 'malformed'
}

/**
 * `agent/turn-stopping`: proceed (explicit) or continue with a message that
 * satisfies the official next-step pending inbox contract (a user-message
 * shaped record; thenables are malformed, matching the session-title family
 * precedent).
 */
export function classifyTurnStoppingDecision(value) {
  if (isPlainRecord(value) && value.kind === 'proceed') return 'undecided'
  if (isPlainRecord(value) && value.kind === 'continue' && isPlainRecord(value.message) && !isThenable(value.message)) {
    return 'decision'
  }
  return 'malformed'
}

/** `system-prompt/assemble`: a rewritten assembly value (record with sections). */
export function classifyAssemblyDecision(value) {
  if (isPlainRecord(value) && Array.isArray(value.sections)) return 'decision'
  return 'malformed'
}

/** `tools/execute` around: any defined return value is the chain result. */
export function classifyExecutionAroundDecision() {
  return 'decision'
}

/** `tools/post-execute`: official PostToolDecision algebra (content/value are mutually exclusive). */
export function classifyPostExecuteDecision(value) {
  if (!isPlainRecord(value)) return 'malformed'
  const additionalContextsInvalid = value.additionalContexts !== undefined && !Array.isArray(value.additionalContexts)
  if (value.kind === 'accept') {
    const hasContent = Object.hasOwn(value, 'content')
    const hasValue = Object.hasOwn(value, 'value')
    if (hasContent && hasValue) return 'malformed'
    return additionalContextsInvalid ? 'malformed' : 'decision'
  }
  if (value.kind === 'block') {
    if (value.feedback === undefined) return 'malformed'
    return additionalContextsInvalid ? 'malformed' : 'decision'
  }
  return 'malformed'
}

/** `fs/write-intent` | `fs/edit-intent`: proceed or deny (the only official deny channel). */
export function classifyFsIntentDecision(value) {
  if (isPlainRecord(value) && value.kind === 'deny') {
    return value.reason === undefined || typeof value.reason === 'string' ? 'decision' : 'malformed'
  }
  return 'malformed'
}

/** Denial error factory for the fs intent points. */
export function fsIntentDenialErrorOf(value) {
  return new FsIntentDeniedError(value?.reason)
}

/** `compaction/request`: reject or a flat inclusive replace-range (owning producer contract). */
export function classifyCompactionRequestDecision(value) {
  if (isPlainRecord(value) && value.kind === 'reject') {
    return value.reason === undefined || typeof value.reason === 'string' ? 'decision' : 'malformed'
  }
  if (isPlainRecord(value) && value.kind === 'replace-range') {
    const { start, end } = value
    if (Number.isInteger(start) && Number.isInteger(end) && start <= end) return 'decision'
  }
  return 'malformed'
}

/** `session-title/candidate`: exclude or replace referencing a candidate seq (owning producer contract). */
export function classifySessionTitleCandidateDecision(value) {
  if (isThenable(value)) return 'malformed'
  if (isPlainRecord(value) && value.kind === 'exclude') {
    return value.reason === undefined || typeof value.reason === 'string' ? 'decision' : 'malformed'
  }
  if (isPlainRecord(value) && value.kind === 'replace') {
    const seq = value.message?.seq
    const reasonOk = value.reason === undefined || typeof value.reason === 'string'
    if (Number.isSafeInteger(seq) && seq >= 0 && reasonOk) return 'decision'
  }
  return 'malformed'
}

// ---------------------------------------------------------------------------
// Registry factory
// ---------------------------------------------------------------------------

function diagnosticOf(logger, message) {
  try {
    logger?.warn?.(message)
  } catch {
    // diagnostics must never change registry outcomes
  }
}

/**
 * Create one decision registry for a single point.
 *
 * @param {object} options
 * @param {string} options.label - point label used in diagnostics
 * @param {(value: unknown) => 'decision' | 'undecided' | 'malformed'} options.classify - point decision classifier
 * @param {({ decide: Function, priority: string, scope?: unknown }) => () => boolean} options.install -
 *   installs the policy at the official dispatch point and returns an
 *   identity-bound disposer (the bus participation path, or the turn-stopping
 *   chain's no-op registration).
 * @param {(callerCtx: unknown) => string | undefined} options.resolveOwnerId - caller-bound owner derivation
 * @param {{ warn?: (message: string) => void }} [options.logger]
 */
export function createDecisionRegistry({ label, classify, install, resolveOwnerId, logger = {} }) {
  if (typeof classify !== 'function' || typeof install !== 'function') {
    throw new PluginApiError('PLUGIN_API_DECISION_REGISTRY_INVALID', 'a decision registry requires a classifier and an install path')
  }

  const records = new Map() // token -> record
  const byId = new Map() // id -> token (latest registration)
  const ownerGenerations = new Map() // ownerId -> last generation counter
  let sequence = 0
  let disposed = false

  function nextGeneration(ownerId) {
    const next = (ownerGenerations.get(ownerId) ?? 0) + 1
    ownerGenerations.set(ownerId, next)
    // Owner-specific opaque token: generations are comparable only within one
    // owner, never across owners.
    return `g${next}`
  }

  function removeRecord(record) {
    records.delete(record.token)
    if (byId.get(record.id) === record.token) byId.delete(record.id)
    try {
      record.disposer?.()
    } catch {
      // disposer failures never break registry state
    }
  }

  /**
   * Register one policy. Caller identity is derived from the injected
   * resolver (never accepted from the caller). Same owner + same id follows
   * the policy latest-wins rule; a different owner with the same id raises a
   * typed conflict.
   *
   * @param {unknown} callerCtx - the caller's context (from the traced surface)
   * @param {object} spec - `{ id, priority?, decide, scope? }`
   * @returns {Readonly<{ id: string, ownerId: string, generation: string, dispose: () => boolean }>}
   */
  function register(callerCtx, spec) {
    if (disposed) {
      throw new PluginApiError('PLUGIN_API_DECISION_REGISTRY_DISPOSED', `decision registry "${label}" is disposed`)
    }
    const normalized = validateDecisionSpec(spec)

    let ownerId
    try {
      ownerId = resolveOwnerId(callerCtx)
    } catch {
      ownerId = undefined
    }
    if (!isNonEmptyString(ownerId)) ownerId = ROOT_OWNER

    const existingToken = byId.get(normalized.id)
    if (existingToken !== undefined) {
      const existing = records.get(existingToken)
      if (existing && existing.ownerId !== ownerId) {
        throw new DecisionOwnerConflictError(
          `decision point "${label}" id "${normalized.id}" is already registered by another owner`,
        )
      }
    }

    // Install the new entry first: an install failure leaves the registry
    // (and any previous same-id entry) untouched.
    let disposer
    try {
      disposer = install({ decide: normalized.decide, priority: normalized.priority, scope: normalized.scope })
    } catch (error) {
      if (error instanceof PluginApiError) throw error
      throw new PluginApiError('PLUGIN_API_DECISION_INSTALL_FAILED', `decision point "${label}" could not install the policy: ${String(error?.message ?? error)}`)
    }

    const existingRecord = existingToken !== undefined ? records.get(existingToken) : undefined
    if (existingRecord) {
      // Same owner latest-wins: the new entry replaces the still-active one
      // and the old handle becomes a typed stale no-op.
      existingRecord.stale = true
      removeRecord(existingRecord)
    }

    const token = {}
    const record = {
      token,
      id: normalized.id,
      ownerId,
      generation: nextGeneration(ownerId),
      priority: normalized.priority,
      decide: normalized.decide,
      scope: normalized.scope,
      order: 0,
      stale: false,
      disposer,
    }
    sequence += 1
    record.order = sequence
    records.set(token, record)
    byId.set(normalized.id, token)

    let handleDisposed = false
    const handle = Object.freeze({
      id: normalized.id,
      ownerId,
      generation: record.generation,
      dispose() {
        if (handleDisposed) return staleResult('the registration is already released')
        handleDisposed = true
        if (record.stale || records.get(record.token) !== record) return staleResult('the registration was superseded')
        removeRecord(record)
        return releasedResult()
      },
    })
    return handle
  }

  /**
   * Active entries ordered by fixed priority tier then successful
   * registration order (the point's declared precedence).
   */
  function entries() {
    const active = [...records.values()].filter((record) => !record.stale)
    const priorityIndex = (priority) => PARTICIPATION_PRIORITIES.indexOf(priority)
    return active.sort((a, b) => priorityIndex(a.priority) - priorityIndex(b.priority) || a.order - b.order)
  }

  function disposeAll() {
    if (disposed) return
    disposed = true
    for (const record of [...records.values()]) {
      record.stale = true
      removeRecord(record)
    }
  }

  return { register, entries, classify, disposeAll, get size() { return records.size } }
}

/**
 * Turn-stopping participation chain (the one point whose backing is the
 * agent-loop replacement slice instead of a facade-wrapped waterfall).
 *
 * The chain applies the point's cross-cutting semantics inside the facade
 * registry: fixed priority + registration order, agent scope filtering,
 * payload freezing per the catalog policy, per-participant containment
 * (a failing slot takes the documented default = proceed), and last-decision
 * convergence (only explicit `continue` decisions count; a malformed decision
 * is treated as no decision with a bounded diagnostic).
 *
 * @param {object} options
 * @param {object} options.registry - the turn-stopping decision registry
 * @param {{ warn?: (message: string) => void }} [options.logger]
 */
export function createTurnStoppingChain({ registry, logger = {} }) {
  return {
    /**
     * Invoke the participation chain for one turn-stopping dispatch.
     *
     * @param {{ agent: unknown, turn: unknown, signal: unknown }} payload
     * @returns {Promise<{ kind: 'continue', message: object } | null>} the
     *   converged decision, or null for official-equivalent behavior (stop
     *   as officially determined).
     */
    async invoke({ agent, turn, signal }) {
      const payload = Object.freeze({ agent, turn, signal })
      let converged = null
      for (const record of registry.entries()) {
        if (record.scope !== undefined && record.scope !== agent) continue
        let decided
        try {
          decided = await record.decide(payload)
        } catch (error) {
          diagnosticOf(logger, `dsh-plugin-api decisions: turn-stopping participant "${record.id}" failed and was contained: ${String(error?.message ?? error)}`)
          continue
        }
        if (decided === undefined) continue
        let verdict
        try {
          verdict = registry.classify(decided)
        } catch {
          verdict = 'malformed'
        }
        if (verdict === 'decision') {
          converged = decided
        } else if (verdict === 'malformed') {
          diagnosticOf(logger, `dsh-plugin-api decisions: turn-stopping participant "${record.id}" returned a malformed decision treated as no decision`)
        }
      }
      return converged
    },
  }
}

/**
 * Shared contract marker installed on the pluginApi service so the agent-loop
 * replacement row can route its turn-stopping dispatch point into the facade
 * participation chain (contract-symbol probing, same pattern as the other
 * replacement-row slices). The replacement row must not import this module;
 * both sides resolve the same global symbol key.
 */
export const TURN_STOPPING_PARTICIPATION_SYMBOL = Symbol.for('dsh-plugin-api.agents.decisions.turn-stopping')
export const TURN_STOPPING_PARTICIPATION_CONTRACT_VERSION = 1
