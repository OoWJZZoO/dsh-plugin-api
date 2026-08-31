import { deepFreeze } from './deep-freeze.js'
import { classifyFailure, isClassification, FAILURE_CLASSES } from './recovery-classifier.js'
import {
  RecoveryPolicyBoundaryError,
  RecoveryPolicyDecisionError,
  RecoveryPolicyRegistrationError,
} from './errors.js'

export const RECOVERY_ACTIONS = Object.freeze([
  'retry',
  'abort',
  'fallback',
  'fork',
  'stop',
])

const ACTION_SET = new Set(RECOVERY_ACTIONS)
const SCOPE_SET = new Set(['session', 'workspace', 'profile'])
const SIDE_EFFECT_SET = new Set(['none', 'read-only', 'external', 'non-idempotent'])
const OUTCOME_SET = new Set(['success', 'error', 'aborted', 'denied', 'superseded'])
const PRIORITY = new Map([
  ['lowest', 0],
  ['low', 1],
  ['normal', 2],
  ['high', 3],
  ['highest', 4],
  ['monitor', 5],
])
const ACTION_PRECEDENCE = new Map([
  ['no-op', 0],
  ['retry', 1],
  ['fork', 2],
  ['fallback', 3],
  ['abort', 4],
  ['stop', 5],
])
const MAX_STRING = 160
const MAX_ID = 120
const MAX_COLLECTION = 32
const MAX_DIAGNOSTICS = 64
const MAX_DECISIONS = 128
const SECRET_KEY = /(?:prompt|credential|password|secret|token|authorization|request.?body|private.?cause|stack)/i
const OUT_OF_BOUNDARY = new Set([
  'automatic-route-selection',
  'provider-billing',
  'approval-bypass',
  'boot-mutation',
  'checkpoint-restore',
  'workspace-transaction',
  'lease-cas',
  'automatic-compensation',
  'scheduler',
])

function isObject(value) {
  return value !== null && typeof value === 'object'
}

function read(value, key) {
  try {
    return value?.[key]
  } catch {
    return undefined
  }
}

function boundedString(value, max = MAX_STRING) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  return text ? text.slice(0, max) : undefined
}

function identity(value, label) {
  const text = boundedString(value, MAX_ID)
  if (!text) throw new RecoveryPolicyRegistrationError(`${label} must be a non-empty string`)
  return text
}

function finiteNumber(value, { integer = false, min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (integer && !Number.isInteger(value)) return undefined
  if (value < min || value > max) return undefined
  return value
}

function safeReadKeys(value) {
  try {
    return Object.keys(value)
  } catch {
    return []
  }
}

/** Clone only bounded, JSON-like public data. It intentionally drops secrets. */
export function clonePublicValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return value.slice(0, MAX_STRING)
  if (depth > 5 || typeof value !== 'object' || seen.has(value)) return undefined
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString()
  seen.add(value)
  if (Array.isArray(value)) {
    const array = []
    for (const item of value.slice(0, MAX_COLLECTION)) {
      const cloned = clonePublicValue(item, depth + 1, seen)
      if (cloned !== undefined) array.push(cloned)
    }
    seen.delete(value)
    return array
  }
  const result = {}
  for (const key of safeReadKeys(value).slice(0, MAX_COLLECTION)) {
    if (SECRET_KEY.test(key)) continue
    const cloned = clonePublicValue(read(value, key), depth + 1, seen)
    if (cloned !== undefined) result[key.slice(0, MAX_ID)] = cloned
  }
  seen.delete(value)
  return result
}

function safeIso(value, fallback) {
  const text = boundedString(value, MAX_STRING)
  if (text && !Number.isNaN(Date.parse(text))) return text
  return fallback
}

function nowIso(now) {
  try {
    const value = typeof now === 'function' ? now() : new Date()
    const date = value instanceof Date ? value : new Date(value)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  } catch {
    // Fall through to a local timestamp.
  }
  return new Date().toISOString()
}

function normalizePriority(value) {
  if (value === undefined) return { name: 'normal', value: 2 }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5) {
    const name = [...PRIORITY.entries()].find(([, number]) => number === value)?.[0] ?? 'normal'
    return { name, value }
  }
  const name = boundedString(value, 20)
  if (!name || !PRIORITY.has(name)) {
    throw new RecoveryPolicyRegistrationError('policy priority is invalid')
  }
  return { name, value: PRIORITY.get(name) }
}

function normalizeAllowedActions(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > RECOVERY_ACTIONS.length) {
    throw new RecoveryPolicyRegistrationError('capability allowedActions must be a non-empty array')
  }
  const values = []
  for (const action of value) {
    const normalized = boundedString(action, 20)
    if (!ACTION_SET.has(normalized) || values.includes(normalized)) {
      throw new RecoveryPolicyRegistrationError('capability allowedActions contains an invalid action')
    }
    values.push(normalized)
  }
  return values
}

function normalizeCapability(input) {
  if (!isObject(input)) throw new RecoveryPolicyRegistrationError('capability must be an object')
  const operationId = identity(read(input, 'operationId'), 'operationId')
  const ownerId = identity(read(input, 'ownerId'), 'ownerId')
  const generation = identity(read(input, 'generation'), 'generation')
  const scope = boundedString(read(input, 'scope'), 20)
  if (!SCOPE_SET.has(scope)) throw new RecoveryPolicyRegistrationError('capability scope is invalid')
  if (typeof read(input, 'idempotent') !== 'boolean' || typeof read(input, 'retryable') !== 'boolean') {
    throw new RecoveryPolicyRegistrationError('capability idempotent and retryable must be boolean')
  }
  const sideEffectClass = boundedString(read(input, 'sideEffectClass'), 30)
  if (!SIDE_EFFECT_SET.has(sideEffectClass)) {
    throw new RecoveryPolicyRegistrationError('capability sideEffectClass is invalid')
  }
  const allowedActions = normalizeAllowedActions(read(input, 'allowedActions'))
  const deadlineMs = read(input, 'deadlineMs') === undefined
    ? undefined
    : finiteNumber(read(input, 'deadlineMs'), { min: 0, max: 86_400_000 })
  if (read(input, 'deadlineMs') !== undefined && deadlineMs === undefined) {
    throw new RecoveryPolicyRegistrationError('capability deadlineMs is invalid')
  }
  let retryBudget
  const rawBudget = read(input, 'retryBudget')
  if (rawBudget !== undefined) {
    const maxAttempts = finiteNumber(read(rawBudget, 'maxAttempts'), { integer: true, min: 1, max: 10_000 })
    if (maxAttempts === undefined) throw new RecoveryPolicyRegistrationError('capability retryBudget is invalid')
    retryBudget = { maxAttempts }
  }
  if (read(input, 'forkRequiresApproval') !== undefined && typeof read(input, 'forkRequiresApproval') !== 'boolean') {
    throw new RecoveryPolicyRegistrationError('capability forkRequiresApproval must be boolean')
  }
  if (read(input, 'allowNonIdempotentRetry') !== undefined && typeof read(input, 'allowNonIdempotentRetry') !== 'boolean') {
    throw new RecoveryPolicyRegistrationError('capability allowNonIdempotentRetry must be boolean')
  }
  return deepFreeze({
    operationId,
    ownerId,
    generation,
    scope,
    idempotent: read(input, 'idempotent'),
    retryable: read(input, 'retryable'),
    allowedActions,
    sideEffectClass,
    ...(deadlineMs === undefined ? {} : { deadlineMs }),
    ...(retryBudget === undefined ? {} : { retryBudget }),
    forkRequiresApproval: read(input, 'forkRequiresApproval') === true,
    allowNonIdempotentRetry: read(input, 'allowNonIdempotentRetry') === true,
  })
}

function normalizeEvidence(rawEvidence, observedAt) {
  const source = read(rawEvidence, 'source')
  const sourceKind = boundedString(typeof source === 'string' ? source : read(source, 'kind'), 80) ?? 'other'
  const sourceTime = safeIso(read(source, 'observedAt'), observedAt)
  const certainty = ['observed', 'inferred', 'unavailable'].includes(read(source, 'certainty'))
    ? read(source, 'certainty')
    : 'unavailable'
  const result = {
    source: { kind: sourceKind, observedAt: sourceTime, certainty },
  }
  for (const name of ['budget', 'route', 'diagnostics', 'checkpoint', 'branch']) {
    const value = read(rawEvidence, name)
    if (value === undefined) {
      result[name] = { status: 'unavailable', provenance: { source: name, certainty: 'unavailable' } }
      continue
    }
    const copy = clonePublicValue(value)
    result[name] = {
      ...(isObject(copy) ? copy : { value: copy }),
      provenance: isObject(copy?.provenance)
        ? copy.provenance
        : { source: name, certainty: 'observed' },
    }
  }
  return deepFreeze(result)
}

function normalizeExecution(value) {
  if (!isObject(value)) return undefined
  const executionId = boundedString(read(value, 'executionId'), MAX_ID)
  if (!executionId) return undefined
  const attemptId = boundedString(read(value, 'attemptId'), MAX_ID)
  const terminalOutcome = boundedString(read(value, 'terminalOutcome') ?? read(value, 'outcome'), 30)
  return deepFreeze({
    executionId,
    ...(attemptId ? { attemptId } : {}),
    ...(terminalOutcome && OUTCOME_SET.has(terminalOutcome) ? { terminalOutcome } : {}),
    ...(boundedString(read(value, 'parentExecutionId'), MAX_ID)
      ? { parentExecutionId: boundedString(read(value, 'parentExecutionId'), MAX_ID) }
      : {}),
    ...(typeof read(value, 'active') === 'boolean' ? { active: read(value, 'active') } : {}),
    ...(typeof read(value, 'cancellable') === 'boolean' ? { cancellable: read(value, 'cancellable') } : {}),
    ...(typeof read(value, 'external') === 'boolean' ? { external: read(value, 'external') } : {}),
  })
}

function normalizeReason(value, fallbackCode, source = 'policy') {
  const raw = isObject(value) ? value : {}
  const code = boundedString(read(raw, 'code'), 80)?.toLowerCase() ?? fallbackCode
  const category = boundedString(read(raw, 'category'), 80)
  const result = {
    code,
    source: boundedString(read(raw, 'source'), 80) ?? source,
  }
  if (category) result.category = category
  return deepFreeze(result)
}

function normalizeBackoff(value) {
  if (!isObject(value)) return undefined
  const kind = boundedString(read(value, 'kind'), 30)
  if (!['immediate', 'fixed', 'exponential-jitter'].includes(kind)) return undefined
  const ms = read(value, 'ms') === undefined
    ? undefined
    : finiteNumber(read(value, 'ms'), { min: 0, max: 86_400_000 })
  if (read(value, 'ms') !== undefined && ms === undefined) return undefined
  return { kind, ...(ms === undefined ? {} : { ms }) }
}

function clonePolicyInput(input) {
  return deepFreeze(input)
}

function isThenable(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    && typeof value.then === 'function'
}

function actionAllowed(capability, action) {
  if (action === 'stop') return true
  if (!capability) return action === 'abort'
  return capability.allowedActions.includes(action)
}

function safeArray(value) {
  return Array.isArray(value) ? value.slice(0, MAX_COLLECTION) : []
}

function hasOwn(value, key) {
  try {
    return Object.prototype.hasOwnProperty.call(value, key)
  } catch {
    return false
  }
}

function defaultWindowKey(execution, raw) {
  const explicit = boundedString(read(raw, 'decisionWindowId'), MAX_ID)
  if (explicit) return `window:${explicit}`
  if (!execution?.executionId) return undefined
  return `execution:${execution.executionId}:${execution.attemptId ?? 'current'}`
}

function makeId(factory, prefix, sequence) {
  try {
    const value = factory?.(prefix)
    const id = boundedString(value, MAX_ID)
    if (id) return id
  } catch {
    // The local fallback below is deterministic enough for an in-process
    // decision ledger and never becomes an execution identity.
  }
  return `${prefix}-${Date.now().toString(36)}-${sequence}`
}

function isUnknownClassification(classification) {
  return classification?.reason?.code === 'classification-unavailable'
    || classification?.reason?.code === 'classification-contradictory'
}

function makeEvidenceProvenance(evidence) {
  return Object.freeze([
    evidence.source,
    ...['budget', 'route', 'diagnostics', 'checkpoint', 'branch'].map((name) => {
      const value = evidence[name]
      return {
        source: name,
        observedAt: evidence.source.observedAt,
        certainty: value?.provenance?.certainty ?? 'unavailable',
      }
    }),
  ].map((value) => deepFreeze({
    source: boundedString(value?.source ?? value?.kind, 80) ?? 'other',
    observedAt: safeIso(value?.observedAt, evidence.source.observedAt),
    certainty: ['observed', 'inferred', 'unavailable'].includes(value?.certainty)
      ? value.certainty
      : 'unavailable',
  })))
}

/**
 * Create the in-process recovery policy owner. The owner has no Cordis or
 * official-package dependency; the host facade supplies only lifecycle and
 * logging callbacks.
 */
export function createRecoveryPolicyOwner({ logger, now, idFactory } = {}) {
  const capabilities = new Map()
  const policies = new Map()
  const decisions = new Map()
  const windows = new Map()
  const visibilityPolicies = new Map()
  const diagnostics = []
  let sequence = 0
  let disposed = false

  const currentTime = () => nowIso(now)
  const log = (code) => {
    const item = { code: boundedString(code, 80) ?? 'recovery-error', observedAt: currentTime() }
    diagnostics.push(item)
    if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.shift()
    try { logger?.warn?.(`dsh-plugin-api recovery: ${item.code}`) } catch {}
  }

  const unavailable = () => disposed

  const capabilityKey = (ownerId, operationId) => `${ownerId}\u0000${operationId}`
  const capabilityLookup = (value) => {
    if (!isObject(value)) return undefined
    const operationId = boundedString(read(value, 'operationId'), MAX_ID)
    const ownerId = boundedString(read(value, 'ownerId'), MAX_ID)
    const generation = boundedString(read(value, 'generation'), MAX_ID)
    if (!operationId || !ownerId || !generation) return undefined
    const record = capabilities.get(capabilityKey(ownerId, operationId))
    if (!record || !record.current || record.public.generation !== generation) return undefined
    return record.public
  }

  const declareCapability = (input) => {
    if (unavailable()) throw new RecoveryPolicyRegistrationError('recovery owner is unavailable')
    const publicRecord = normalizeCapability(input)
    const key = capabilityKey(publicRecord.ownerId, publicRecord.operationId)
    const previous = capabilities.get(key)
    if (previous) previous.current = false
    const record = { public: publicRecord, current: true }
    capabilities.set(key, record)
    let active = true
    return () => {
      if (!active) return false
      active = false
      if (capabilities.get(key) !== record) return false
      record.current = false
      capabilities.delete(key)
      return true
    }
  }

  const policyKey = (id) => id
  const registerPolicy = (input) => {
    if (unavailable()) throw new RecoveryPolicyRegistrationError('recovery owner is unavailable')
    if (!isObject(input)) throw new RecoveryPolicyRegistrationError('policy must be an object')
    const id = identity(read(input, 'id'), 'policy id')
    const ownerId = identity(read(input, 'ownerId'), 'policy ownerId')
    const generation = identity(read(input, 'generation'), 'policy generation')
    const decide = read(input, 'decide')
    const match = read(input, 'match')
    if (typeof decide !== 'function') throw new RecoveryPolicyRegistrationError('policy decide must be a function')
    if (match !== undefined && typeof match !== 'function') throw new RecoveryPolicyRegistrationError('policy match must be a function')
    const priority = normalizePriority(read(input, 'priority'))
    const scope = boundedString(read(input, 'scope'), 30)
    if (scope && !SCOPE_SET.has(scope) && scope !== 'unknown') {
      throw new RecoveryPolicyRegistrationError('policy scope is invalid')
    }
    const key = policyKey(id)
    const previous = policies.get(key)
    if (previous) previous.current = false
    const record = {
      id,
      ownerId,
      generation,
      scope,
      priority: priority.value,
      priorityName: priority.name,
      sequence: ++sequence,
      match: match ?? (() => true),
      decide,
      current: true,
    }
    policies.set(key, record)
    let active = true
    return () => {
      if (!active) return false
      active = false
      if (policies.get(key) !== record) return false
      record.current = false
      policies.delete(key)
      return true
    }
  }

  const baseDecision = ({ input, action, reason, proposedAttemptId, parent, bounds, consumed = false }) => {
    const execution = input.execution
    const decision = {
      decisionId: makeId(idFactory, 'decision', ++sequence),
      action,
      reason,
      ...(execution ? { execution } : {}),
      ...(parent ? { parent } : {}),
      ...(proposedAttemptId ? { proposedAttemptId } : {}),
      ...(bounds ? { bounds } : {}),
      capabilityEvidence: input.capability ? [input.capability] : [],
      evidenceProvenance: makeEvidenceProvenance(input.evidence),
      ...(consumed ? { consumed: true } : {}),
      observedAt: currentTime(),
    }
    return deepFreeze(decision)
  }

  const safeDecision = (input, code = 'safe-default', category = 'safety') => baseDecision({
    input,
    action: 'stop',
    reason: normalizeReason({ code, category }, code, 'recovery'),
  })

  const boundaryRequest = (raw) => {
    const requested = boundedString(read(raw, 'requestedCapability'), MAX_STRING)
      ?? boundedString(read(raw, 'capabilityKind'), MAX_STRING)
    return requested && OUT_OF_BOUNDARY.has(requested) ? requested : undefined
  }

  const normalizeInput = (raw) => {
    if (!isObject(raw)) {
      const observedAt = currentTime()
      return {
        raw: {},
        classification: classifyFailure(undefined, { observedAt }),
        capability: undefined,
        execution: undefined,
        scope: 'unknown',
        evidence: normalizeEvidence({}, observedAt),
        policyInput: clonePolicyInput({
          classification: classifyFailure(undefined, { observedAt }),
          scope: 'unknown',
          evidence: normalizeEvidence({}, observedAt),
        }),
      }
    }
    const observedAt = currentTime()
    let classification
    try {
      const supplied = read(raw, 'classification')
      classification = isClassification(supplied)
        ? deepFreeze(clonePublicValue(supplied))
        : classifyFailure(read(raw, 'failure') ?? read(raw, 'error'), {
            class: read(raw, 'class'),
            aborted: read(raw, 'aborted'),
            superseded: read(raw, 'superseded'),
            deadlineExpired: read(raw, 'deadlineExpired'),
            signal: read(raw, 'signal'),
            source: read(read(raw, 'evidence'), 'source'),
            observedAt,
          })
    } catch {
      classification = classifyFailure(undefined, { observedAt })
    }
    const execution = normalizeExecution(read(raw, 'execution'))
    const capability = capabilityLookup(read(raw, 'capability'))
    const scope = boundedString(read(raw, 'scope'), 20)
    const normalizedScope = SCOPE_SET.has(scope) ? scope : 'unknown'
    const evidence = normalizeEvidence(read(raw, 'evidence') ?? {}, observedAt)
    const policyInput = {
      classification,
      ...(capability ? { capability } : {}),
      ...(execution ? { execution } : {}),
      scope: normalizedScope,
      evidence,
      ...(typeof read(raw, 'cancellable') === 'boolean' ? { cancellable: read(raw, 'cancellable') } : {}),
      ...(typeof read(raw, 'approvalGranted') === 'boolean' ? { approvalGranted: read(raw, 'approvalGranted') } : {}),
      ...(typeof read(raw, 'attemptsRemaining') === 'number' ? { attemptsRemaining: read(raw, 'attemptsRemaining') } : {}),
      ...(typeof read(raw, 'deadlineExpired') === 'boolean' ? { deadlineExpired: read(raw, 'deadlineExpired') } : {}),
    }
    return { raw, classification, capability, execution, scope: normalizedScope, evidence, policyInput: clonePolicyInput(policyInput) }
  }

  const validateBounds = (candidate, input, capability) => {
    const rawBounds = read(candidate, 'bounds')
    const reason = read(candidate, 'reason')
    const immediate = boundedString(read(reason, 'code'), 80)?.toLowerCase() === 'immediate'
    const bounds = isObject(rawBounds) ? rawBounds : {}
    const attemptsRemaining = finiteNumber(
      read(bounds, 'attemptsRemaining') ?? read(input.raw, 'attemptsRemaining') ?? read(capability?.retryBudget, 'maxAttempts'),
      { integer: true, min: 1, max: 10_000 },
    )
    if (attemptsRemaining === undefined) return { error: 'retry-bounds-missing' }
    const deadlineAt = safeIso(
      read(bounds, 'deadlineAt') ?? read(input.raw, 'deadlineAt'),
      capability?.deadlineMs === undefined
        ? undefined
        : new Date(Date.now() + capability.deadlineMs).toISOString(),
    )
    if (!deadlineAt || Date.parse(deadlineAt) <= Date.now()) return { error: 'retry-deadline-exhausted' }
    const backoff = normalizeBackoff(read(bounds, 'backoff'))
    if (!backoff && !immediate) return { error: 'retry-backoff-missing' }
    return {
      value: deepFreeze({
        attemptsRemaining,
        deadlineAt,
        backoff: backoff ?? { kind: 'immediate' },
        ...(typeof read(bounds, 'approvalRequired') === 'boolean'
          ? { approvalRequired: read(bounds, 'approvalRequired') }
          : {}),
      }),
    }
  }

  const validateCandidate = (candidate, input) => {
    if (!isObject(candidate)) return { error: 'decision-invalid' }
    const action = boundedString(read(candidate, 'action'), 30)
    if (action === 'no-op') return { value: null }
    if (!ACTION_SET.has(action)) return { error: 'decision-action-invalid' }
    if (action === 'retry' && !input.capability) return { error: 'retry-capability-missing' }
    if (!actionAllowed(input.capability, action)) return { error: 'action-not-authorized' }
    if (action === 'retry') {
      if (!input.capability?.retryable) return { error: 'retry-capability-missing' }
      if (!input.capability.idempotent && !input.capability.allowNonIdempotentRetry) {
        return { error: 'retry-non-idempotent' }
      }
      if (['aborted', 'denied', 'superseded'].includes(input.classification.class)) {
        return { error: 'retry-terminal-class' }
      }
      if (!input.execution?.executionId || input.execution.terminalOutcome) return { error: 'retry-execution-unavailable' }
      if (read(input.raw, 'deadlineExpired') === true) return { error: 'retry-deadline-exhausted' }
      if (read(input.raw, 'budgetExhausted') === true || read(input.raw, 'usageBudgetExhausted') === true) {
        return { error: 'retry-budget-exhausted' }
      }
      const bounds = validateBounds(candidate, input, input.capability)
      if (bounds.error) return bounds
      const suppliedAttempt = boundedString(read(candidate, 'proposedAttemptId'), MAX_ID)
      let proposedAttemptId = suppliedAttempt ?? makeId(idFactory, 'attempt', ++sequence)
      if (proposedAttemptId === input.execution.attemptId) proposedAttemptId = `${proposedAttemptId}-next`
      if (proposedAttemptId === input.execution.attemptId) return { error: 'attempt-boundary-not-distinct' }
      return { value: { action, bounds: bounds.value, proposedAttemptId } }
    }
    if (action === 'fallback') {
      if (!input.execution?.executionId || input.execution.terminalOutcome) return { error: 'fallback-execution-unavailable' }
      if (read(candidate, 'provider') !== undefined || read(candidate, 'model') !== undefined
        || read(candidate, 'candidateId') !== undefined || read(candidate, 'route') !== undefined) {
        return { error: 'fallback-route-selection-forbidden' }
      }
      let proposedAttemptId = boundedString(read(candidate, 'proposedAttemptId'), MAX_ID)
        ?? makeId(idFactory, 'attempt', ++sequence)
      if (proposedAttemptId === input.execution.attemptId) proposedAttemptId = `${proposedAttemptId}-next`
      if (proposedAttemptId === input.execution.attemptId) return { error: 'attempt-boundary-not-distinct' }
      return { value: { action, proposedAttemptId } }
    }
    if (action === 'fork') {
      if (!input.capability?.allowedActions.includes('fork')) return { error: 'fork-capability-missing' }
      if (input.capability.forkRequiresApproval && read(input.raw, 'approvalGranted') !== true) {
        return { error: 'fork-approval-required' }
      }
      if (!input.execution?.executionId || input.execution.terminalOutcome) return { error: 'fork-execution-unavailable' }
      return { value: { action } }
    }
    if (action === 'abort') {
      const cancellable = hasOwn(input.raw, 'cancellable')
        ? read(input.raw, 'cancellable') === true
        : input.execution?.cancellable === true
      if (!cancellable || input.execution?.executionId === undefined || input.execution?.active !== true) {
        return { error: 'abort-operation-inactive' }
      }
      return { value: { action } }
    }
    return { value: { action } }
  }

  const makeCandidateDecision = (candidate, input, validation) => {
    const action = validation.value.action
    const parent = ['fallback', 'fork'].includes(action) && input.execution
      ? {
          executionId: input.execution.executionId,
          ...(input.execution.attemptId ? { attemptId: input.execution.attemptId } : {}),
        }
      : undefined
    return baseDecision({
      input,
      action,
      reason: normalizeReason(read(candidate, 'reason'), `policy-${action}`),
      proposedAttemptId: validation.value.proposedAttemptId,
      parent,
      bounds: validation.value.bounds,
    })
  }

  const betterDecision = (current, candidate) => {
    if (!current) return candidate
    const currentRank = ACTION_PRECEDENCE.get(current.action) ?? 0
    const candidateRank = ACTION_PRECEDENCE.get(candidate.action) ?? 0
    return candidateRank > currentRank ? candidate : current
  }

  const terminalSafeCode = (input, lastError) => {
    if (input.execution?.terminalOutcome) return 'terminal-outcome-committed'
    if (isUnknownClassification(input.classification)) return input.classification.reason.code
    if (read(input.raw, 'budgetExhausted') === true || read(input.raw, 'usageBudgetExhausted') === true) return 'retry-budget-exhausted'
    if (read(input.raw, 'deadlineExpired') === true) return 'retry-deadline-exhausted'
    return lastError ?? 'safe-default'
  }

  const evaluate = async (rawInput) => {
    const input = normalizeInput(rawInput)
    if (disposed) return safeDecision(input, 'recovery-unavailable')
    const windowKey = defaultWindowKey(input.execution, rawInput)
    if (windowKey && windows.has(windowKey)) {
      const existing = decisions.get(windows.get(windowKey))
      if (existing) return existing.public
    }
    if (input.execution?.terminalOutcome) {
      const decision = safeDecision(input, 'terminal-outcome-committed')
      if (windowKey) rememberDecision(windowKey, decision)
      return decision
    }
    const signal = read(rawInput, 'signal')
    const cancelled = () => {
      try { return signal?.aborted === true } catch { return true }
    }
    if (cancelled()) {
      const decision = safeDecision(input, 'recovery-cancelled', 'cancellation')
      if (windowKey) rememberDecision(windowKey, decision)
      return decision
    }
    const boundary = boundaryRequest(rawInput)
    if (boundary) {
      log(`unsupported-boundary:${boundary}`)
      const decision = safeDecision(input, 'unsupported-boundary', 'boundary')
      if (windowKey) rememberDecision(windowKey, decision)
      return decision
    }
    if (read(rawInput, 'budgetExhausted') === true || read(rawInput, 'usageBudgetExhausted') === true
      || read(rawInput, 'attemptsRemaining') === 0) {
      const decision = safeDecision(input, 'retry-budget-exhausted', 'budget')
      if (windowKey) rememberDecision(windowKey, decision)
      return decision
    }
    if (read(rawInput, 'deadlineExpired') === true) {
      const decision = safeDecision(input, 'retry-deadline-exhausted', 'deadline')
      if (windowKey) rememberDecision(windowKey, decision)
      return decision
    }

    let selected
    let lastError
    const ordered = [...policies.values()]
      .filter((record) => record.current)
      .sort((left, right) => left.priority - right.priority || left.sequence - right.sequence)
    for (const policy of ordered) {
      if (!policy.current) {
        log('stale-policy-result')
        continue
      }
      if (policy.scope && policy.scope !== input.scope) continue
      let matches
      try {
        matches = policy.match(input.policyInput)
        if (isThenable(matches)) matches = await matches
      } catch {
        log('policy-match-failed')
        continue
      }
      if (cancelled()) {
        lastError = 'recovery-cancelled'
        break
      }
      if (!policy.current) {
        log('stale-policy-result')
        continue
      }
      if (matches !== true) continue
      let result
      try {
        result = policy.decide(input.policyInput)
        if (isThenable(result)) result = await result
      } catch {
        log('policy-decision-failed')
        continue
      }
      if (cancelled()) {
        lastError = 'recovery-cancelled'
        break
      }
      if (!policy.current) {
        log('stale-policy-result')
        continue
      }
      const validation = validateCandidate(result, input)
      if (validation.error) {
        lastError = validation.error
        log(validation.error)
        continue
      }
      if (!validation.value) continue
      const candidate = makeCandidateDecision(result, input, validation)
      selected = betterDecision(selected, candidate)
    }
    const decision = selected ?? safeDecision(input, terminalSafeCode(input, lastError))
    if (windowKey) rememberDecision(windowKey, decision)
    return decision
  }

  function rememberDecision(windowKey, decision) {
    decisions.set(decision.decisionId, { public: decision, consumed: false, expectedAttemptId: decision.proposedAttemptId })
    windows.set(windowKey, decision.decisionId)
    while (decisions.size > MAX_DECISIONS) {
      const first = decisions.keys().next().value
      decisions.delete(first)
      for (const [key, decisionId] of windows) if (decisionId === first) windows.delete(key)
    }
  }

  const registerVisibility = (input) => {
    if (!isObject(input)) throw new RecoveryPolicyRegistrationError('visibility policy must be an object')
    const id = identity(read(input, 'id'), 'visibility policy id')
    const ownerId = identity(read(input, 'ownerId'), 'visibility policy ownerId')
    const generation = identity(read(input, 'generation'), 'visibility policy generation')
    const fields = Array.isArray(read(input, 'fields'))
      ? read(input, 'fields').filter((field) => ['action', 'reason', 'source', 'observedAt', 'uncertainty', 'evidenceProvenance'].includes(field))
      : []
    const key = id
    const previous = visibilityPolicies.get(key)
    if (previous) previous.current = false
    const record = { id, ownerId, generation, fields: Object.freeze([...new Set(fields)]), current: true }
    visibilityPolicies.set(key, record)
    let active = true
    return () => {
      if (!active) return false
      active = false
      if (visibilityPolicies.get(key) !== record) return false
      record.current = false
      visibilityPolicies.delete(key)
      return true
    }
  }

  const availability = () => deepFreeze({
    status: disposed ? 'unavailable' : 'active',
    hostOnly: true,
    capabilities: capabilities.size,
    policies: policies.size,
    decisions: decisions.size,
    diagnostics: diagnostics.length,
  })

  const api = Object.freeze({
    capability: Object.freeze({ register: declareCapability }),
    policy: Object.freeze({ register: registerPolicy }),
    evaluate,
    visibility: Object.freeze({ register: registerVisibility }),
    availability,
  })

  return {
    api,
    dispose() {
      if (disposed) return false
      disposed = true
      for (const record of capabilities.values()) record.current = false
      for (const record of policies.values()) record.current = false
      for (const record of visibilityPolicies.values()) record.current = false
      capabilities.clear()
      policies.clear()
      visibilityPolicies.clear()
      windows.clear()
      decisions.clear()
      return true
    },
    diagnostics() {
      return deepFreeze(diagnostics.map((entry) => ({ ...entry })))
    },
  }
}

export { FAILURE_CLASSES }
