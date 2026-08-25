import { deepFreeze } from './deep-freeze.js'
import { RecoveryPolicyBoundaryError } from './errors.js'

const MAX_STRING = 160
const MAX_ID = 120
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

function read(value, key) {
  try {
    return value?.[key]
  } catch {
    return undefined
  }
}

function text(value, max = MAX_STRING) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const result = String(value).trim()
  return result ? result.slice(0, max) : undefined
}

function observedAt(payload) {
  const value = text(read(read(payload, 'source'), 'observedAt') ?? read(payload, 'observedAt'))
  return value && !Number.isNaN(Date.parse(value)) ? value : new Date().toISOString()
}

function explicitExecution(payload) {
  const value = read(payload, 'execution')
  if (!value || typeof value !== 'object') return undefined
  const executionId = text(read(value, 'executionId'), MAX_ID)
  if (!executionId) return undefined
  const attemptId = text(read(value, 'attemptId'), MAX_ID)
  return {
    executionId,
    ...(attemptId ? { attemptId } : {}),
    ...(typeof read(value, 'active') === 'boolean' ? { active: read(value, 'active') } : {}),
    ...(typeof read(value, 'cancellable') === 'boolean' ? { cancellable: read(value, 'cancellable') } : {}),
  }
}

function safeFailure(value) {
  if (!value || typeof value !== 'object') return {}
  const result = {}
  for (const key of ['class', 'classification', 'code', 'name', 'status', 'category', 'retryable', 'aborted', 'superseded', 'replaced', 'detail']) {
    const current = read(value, key)
    if (typeof current === 'boolean') result[key] = current
    else {
      const valueText = text(current)
      if (valueText) result[key] = valueText
    }
  }
  const reason = read(value, 'reason')
  if (reason && typeof reason === 'object') {
    const reasonResult = {}
    for (const key of ['class', 'code', 'category', 'detail', 'boundedDetail']) {
      const valueText = text(read(reason, key))
      if (valueText) reasonResult[key] = valueText
    }
    if (Object.keys(reasonResult).length) result.reason = reasonResult
  } else {
    const reasonText = text(reason)
    if (reasonText) result.reason = reasonText
  }
  return result
}

function source(kind, payload) {
  return { kind, observedAt: observedAt(payload), certainty: 'observed' }
}

function boundaryKind(payload) {
  const requested = text(read(payload, 'requestedCapability'), 80)
    ?? text(read(payload, 'capabilityKind'), 80)
  if (!requested) return undefined
  if (OUT_OF_BOUNDARY.has(requested)) {
    return requested
  }
  return undefined
}

export function unsupportedRecoveryRequest(kind) {
  throw new RecoveryPolicyBoundaryError(`recovery capability "${text(kind, 80) ?? 'unknown'}" is not a public policy surface`)
}

export function fromAgentRequestError(payload = {}) {
  const sourceValue = source('agent-request', payload)
  const unsupported = boundaryKind(payload)
  const result = {
    failure: safeFailure(read(payload, 'failure') ?? read(payload, 'error') ?? payload),
    evidence: {
      source: sourceValue,
      route: { status: 'unavailable', provenance: { source: 'route', certainty: 'unavailable' } },
    },
    ...(explicitExecution(payload) ? { execution: explicitExecution(payload) } : {}),
    ...(text(read(payload, 'scope'), 20) ? { scope: text(read(payload, 'scope'), 20) } : {}),
    ...(text(read(payload, 'turn'), 40) ? { turn: text(read(payload, 'turn'), 40) } : {}),
    ...(text(read(payload, 'step'), 40) ? { step: text(read(payload, 'step'), 40) } : {}),
  }
  if (unsupported) {
    result.unsupported = { kind: unsupported, reason: 'public-seam-unavailable' }
  }
  return deepFreeze(result)
}

export function fromToolResult(exec, result = {}) {
  const payload = result && typeof result === 'object' ? result : {}
  const sourceValue = source('tool-call', payload)
  const unsupported = boundaryKind(payload)
  const value = {
    failure: safeFailure(read(payload, 'failure') ?? read(payload, 'error') ?? payload),
    evidence: {
      source: sourceValue,
      route: { status: 'unavailable', provenance: { source: 'route', certainty: 'unavailable' } },
    },
    ...(exec && typeof exec === 'object' && explicitExecution(exec) ? { execution: explicitExecution(exec) } : {}),
    ...(text(read(payload, 'scope'), 20) ? { scope: text(read(payload, 'scope'), 20) } : {}),
  }
  if (unsupported) value.unsupported = { kind: unsupported, reason: 'public-seam-unavailable' }
  return deepFreeze(value)
}

export function createRecoveryAdapters() {
  return Object.freeze({
    fromAgentRequestError,
    fromToolResult,
    unsupported: unsupportedRecoveryRequest,
  })
}
