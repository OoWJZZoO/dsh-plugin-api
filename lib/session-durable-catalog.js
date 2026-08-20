/**
 * Immutable source-audit metadata for the session durable capability.
 *
 * This module is deliberately pure: it holds the narrow public contract that
 * was reviewed against one exact DSH runtime, but does not resolve packages,
 * subscribe to Cordis, or append session records. Runtime construction and
 * fail-closed validation are added by the session durable feature.
 */
import { deepFreeze } from './deep-freeze.js'

/**
 * Exact public package identities reviewed for finite append + durable observation.
 *
 * This is an internal compatibility gate, not a public semver range. A DSH
 * upgrade must receive a fresh source audit and spec approval before the
 * feature can activate.
 */
export const SESSION_DURABLE_AUDIT = deepFreeze({
  runtimeVersion: '0.1.0-rc.6',
  packages: {
    '@deepseek-ai/dsh-llm': '0.1.0-rc.6',
    '@deepseek-ai/dsh-session': '0.1.0-rc.6',
    '@deepseek-ai/dsh-user-approval': '0.1.0-rc.6',
    '@deepseek-ai/dsh-schedule': '0.1.0-rc.6',
    '@deepseek-ai/dsh-subagent': '0.1.0-rc.6',
    '@deepseek-ai/dsh-subagent-in-process-driver': '0.1.0-rc.6',
    '@deepseek-ai/dsh-agent-loop': '0.1.0-rc.6',
  },
})

/** The complete, lexical ordered set of supported durable session-log types. */
export const DURABLE_EVENT_TYPES = deepFreeze([
  'approval/asked',
  'approval/decided',
  'approval/policy',
  'schedule/change',
  'subagent/descriptor',
])

/**
 * Declarative audit metadata only. These descriptors never authorize a caller
 * to append one of their record types.
 */
export const DURABLE_EVENT_DESCRIPTORS = deepFreeze({
  'approval/asked': {
    kind: 'approval/asked',
    logSource: 'official-session-log',
    observationSource: 'session/event',
    surfaceEligible: false,
    payload: {
      version: null,
      shape: '{ id: string, toolName: string, callId?: string, reason?: string }',
    },
  },
  'approval/decided': {
    kind: 'approval/decided',
    logSource: 'official-session-log',
    observationSource: 'session/event',
    surfaceEligible: false,
    payload: {
      version: null,
      shape: "{ id: string, outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable' }",
    },
  },
  'approval/policy': {
    kind: 'approval/policy',
    logSource: 'official-session-log',
    observationSource: 'session/event',
    surfaceEligible: false,
    payload: {
      version: null,
      shape: "{ policy: 'ask' | 'never', source?: 'delegation' }",
    },
  },
  'schedule/change': {
    kind: 'schedule/change',
    logSource: 'official-session-log',
    observationSource: 'session/event',
    surfaceEligible: false,
    payload: {
      version: 1,
      shape: "create: { version: 1, operation: 'create', schedule: After | At | Every }; delete: { version: 1, operation: 'delete', id }; dispatch: { version: 1, operation: 'dispatch', id } | { version: 1, operation: 'dispatch', id, acceptedAt }",
    },
  },
  'subagent/descriptor': {
    kind: 'subagent/descriptor',
    logSource: 'official-session-log',
    observationSource: 'session/event',
    surfaceEligible: false,
    payload: {
      version: 2,
      shape: "one-shot: { version: 2, mode: 'one-shot', provider, label? }; continuable: { version: 2, mode: 'continuable', provider, label, agentProvider?, agentModel?, persona?, toolFilter? }",
    },
  },
})

const DURABLE_EVENT_TYPE_SET = new Set(DURABLE_EVENT_TYPES)
const SURFACE_MESSAGE_KINDS = deepFreeze([
  'assistant/message',
  'tool/result',
  'user/message',
])
const SURFACE_MESSAGE_CONTRACTS = deepFreeze({
  'assistant/message': {
    kind: 'assistant/message',
    surfaceOp: 'append',
    sourceEventSeqs: 'optional-matching-assistant-chunks-or-empty-without-candidates',
  },
  'tool/result': {
    kind: 'tool/result',
    surfaceOp: 'append',
    sourceEventSeqs: 'exactly-one-matching-tool-call',
  },
  'user/message': {
    kind: 'user/message',
    surfaceOp: 'append',
    sourceEventSeqs: 'forbidden',
  },
})

/** @param {unknown} value */
export function isDurableEventType(value) {
  return typeof value === 'string' && DURABLE_EVENT_TYPE_SET.has(value)
}

/** @param {unknown} kind */
export function getDurableEventDescriptor(kind) {
  if (typeof kind !== 'string' || !Object.hasOwn(DURABLE_EVENT_DESCRIPTORS, kind)) {
    return undefined
  }
  return DURABLE_EVENT_DESCRIPTORS[kind]
}

/**
 * Builds the finite public runtime contract required by the durable feature.
 *
 * This is intentionally not a general session-event validator. A false result
 * means the audited runtime cannot be established and the feature must remain
 * unavailable.
 *
 * @param {unknown} dependencies
 */
export function buildSessionDurableContracts(dependencies) {
  try {
    const {
      Session,
      isJsonValue,
      snapshotJsonValue,
      knownSessionEventTypes,
      isSurfaceEligibleType,
    } = asRecord(dependencies) || {}
    if (
      typeof Session !== 'function'
      || typeof isJsonValue !== 'function'
      || typeof snapshotJsonValue !== 'function'
      || !hasAllKnownTypes(knownSessionEventTypes)
      || typeof isSurfaceEligibleType !== 'function'
      || !hasExpectedSurfaceEligibility(isSurfaceEligibleType)
    ) {
      return unavailableContracts()
    }

    return deepFreeze({
      available: true,
      Session,
      isJsonValue,
      snapshotJsonValue,
      surfaceMessageContracts: SURFACE_MESSAGE_CONTRACTS,
      surfaceMessageKinds: SURFACE_MESSAGE_KINDS,
      isSurfaceEligibleType,
      isAuditedDurableRecord,
    })
  } catch {
    return unavailableContracts()
  }
}

function unavailableContracts() {
  return deepFreeze({ available: false })
}

function hasAllKnownTypes(knownSessionEventTypes) {
  if (!knownSessionEventTypes || typeof knownSessionEventTypes.has !== 'function') return false
  return [...DURABLE_EVENT_TYPES, ...SURFACE_MESSAGE_KINDS].every((kind) => knownSessionEventTypes.has(kind))
}

function hasExpectedSurfaceEligibility(isSurfaceEligibleType) {
  return DURABLE_EVENT_TYPES.every((kind) => isSurfaceEligibleType(kind) === false)
    && SURFACE_MESSAGE_KINDS.every((kind) => isSurfaceEligibleType(kind) === true)
}

/** @param {unknown} kind @param {unknown} event */
function isAuditedDurableRecord(kind, event) {
  try {
    if (!isDurableEventType(kind) || !isExactRecord(event, ['data', 'seq', 'time', 'type'])) return false
    if (event.type !== kind || !isNonNegativeSafeInteger(event.seq) || !Number.isSafeInteger(event.time)) return false
    return isDurablePayload(kind, event.data)
  } catch {
    return false
  }
}

function isDurablePayload(kind, data) {
  switch (kind) {
    case 'approval/asked':
      return isExactRecord(data, ['id', 'toolName'], ['callId', 'reason'])
        && isString(data.id) && isString(data.toolName)
        && optionalString(data, 'callId') && optionalString(data, 'reason')
    case 'approval/decided':
      return isExactRecord(data, ['id', 'outcome'])
        && isString(data.id)
        && ['allowed-once', 'rejected', 'cancelled', 'unavailable'].includes(data.outcome)
    case 'approval/policy':
      return isExactRecord(data, ['policy'], ['source'])
        && ['ask', 'never'].includes(data.policy)
        && (!Object.hasOwn(data, 'source') || data.source === 'delegation')
    case 'schedule/change':
      return isScheduleChange(data)
    case 'subagent/descriptor':
      return isSubagentDescriptor(data)
    default:
      return false
  }
}

function isScheduleChange(data) {
  if (!isRecord(data) || data.version !== 1) return false
  if (data.operation === 'create' && isExactRecord(data, ['version', 'operation', 'schedule'])) return isSchedule(data.schedule)
  if (data.operation === 'delete' && isExactRecord(data, ['version', 'operation', 'id'])) return isTrimmedString(data.id)
  if (data.operation !== 'dispatch' || !isTrimmedString(data.id)) return false
  return isExactRecord(data, ['version', 'operation', 'id'])
    || (isExactRecord(data, ['version', 'operation', 'id', 'acceptedAt']) && isCanonicalUtcInstant(data.acceptedAt))
}

function isSchedule(schedule) {
  if (!isRecord(schedule) || !isTrimmedString(schedule.id) || !isTrimmedString(schedule.prompt) || !isCanonicalUtcInstant(schedule.scheduledAt)) return false
  if (schedule.kind === 'after') return isExactRecord(schedule, ['id', 'kind', 'prompt', 'afterSeconds', 'scheduledAt']) && isPositiveSafeInteger(schedule.afterSeconds)
  if (schedule.kind === 'at') return isExactRecord(schedule, ['id', 'kind', 'prompt', 'scheduledAt'])
  return schedule.kind === 'every'
    && isExactRecord(schedule, ['id', 'kind', 'prompt', 'everySeconds', 'scheduledAt'])
    && Number.isSafeInteger(schedule.everySeconds)
    && schedule.everySeconds >= 300
    && Number.isSafeInteger(schedule.everySeconds * 1000)
}

function isSubagentDescriptor(data) {
  if (!isRecord(data) || data.version !== 2 || !isString(data.provider)) return false
  if (data.mode === 'one-shot') {
    return isExactRecord(data, ['version', 'mode', 'provider'], ['label']) && optionalString(data, 'label')
  }
  return data.mode === 'continuable'
    && isExactRecord(data, ['version', 'mode', 'provider', 'label'], ['agentProvider', 'agentModel', 'persona', 'toolFilter'])
    && isString(data.label)
    && optionalString(data, 'agentProvider')
    && optionalString(data, 'agentModel')
    && optionalString(data, 'persona')
    && (!Object.hasOwn(data, 'toolFilter') || isToolFilter(data.toolFilter))
}

function isToolFilter(value) {
  return isExactRecord(value, [], ['allow', 'deny'])
    && (Object.hasOwn(value, 'allow') || Object.hasOwn(value, 'deny'))
    && (!Object.hasOwn(value, 'allow') || isStringArray(value.allow))
    && (!Object.hasOwn(value, 'deny') || isStringArray(value.deny))
}

function isExactRecord(value, requiredKeys, optionalKeys = []) {
  if (!isRecord(value)) return false
  const keys = Reflect.ownKeys(value)
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys])
  return requiredKeys.every((key) => Object.hasOwn(value, key))
    && keys.length === requiredKeys.length + optionalKeys.filter((key) => Object.hasOwn(value, key)).length
    && keys.every((key) => typeof key === 'string' && allowedKeys.has(key) && Object.prototype.propertyIsEnumerable.call(value, key))
}

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function asRecord(value) {
  return isRecord(value) ? value : undefined
}

function optionalString(value, key) {
  return !Object.hasOwn(value, key) || isString(value[key])
}

function isString(value) {
  return typeof value === 'string'
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(isString)
}

function isTrimmedString(value) {
  return isString(value) && value.length > 0 && value.trim() === value
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function isCanonicalUtcInstant(value) {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}
