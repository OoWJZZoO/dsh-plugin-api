import test from 'node:test'
import assert from 'node:assert/strict'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { composeCatalogs } from '../lib/catalog-compose.js'
import { agentEventsCatalog } from '../lib/agent-events-catalog.js'
import { llmEventsCatalog } from '../lib/llm-events-catalog.js'
import { settingsEventsCatalog } from '../lib/settings-events-catalog.js'
import { sessionLifecycleEventsCatalog } from '../lib/session-events-catalog.js'
import { systemPromptEventsCatalog } from '../lib/system-prompt-events-catalog.js'
import { toolsEventsCatalog } from '../lib/tools-events-catalog.js'
import { createSessionTypeCatalogs } from '../lib/session-catalog.js'
import {
  DURABLE_EVENT_DESCRIPTORS,
  DURABLE_EVENT_TYPES,
  SESSION_DURABLE_AUDIT,
  buildSessionDurableContracts,
  getDurableEventDescriptor,
  isDurableEventType,
} from '../lib/session-durable-catalog.js'

import {
  KNOWN_SESSION_EVENT_TYPES,
  Session,
  isJsonValue,
  isSurfaceEligibleType,
  snapshotJsonValue,
} from '@deepseek-ai/dsh-session'

const DURABLE_TYPES = [
  'approval/asked',
  'approval/decided',
  'approval/policy',
  'schedule/change',
  'subagent/descriptor',
]

const AUDITED_PACKAGES = {
  '@deepseek-ai/dsh-llm': '0.1.0-rc.6',
  '@deepseek-ai/dsh-session': '0.1.0-rc.6',
  '@deepseek-ai/dsh-user-approval': '0.1.0-rc.6',
  '@deepseek-ai/dsh-schedule': '0.1.0-rc.6',
  '@deepseek-ai/dsh-subagent': '0.1.0-rc.6',
  '@deepseek-ai/dsh-subagent-in-process-driver': '0.1.0-rc.6',
  '@deepseek-ai/dsh-agent-loop': '0.1.0-rc.6',
}

test('session durable audit pins the complete reviewed runtime identity', () => {
  assert.deepEqual(SESSION_DURABLE_AUDIT, {
    runtimeVersion: '0.1.0-rc.6',
    packages: AUDITED_PACKAGES,
  })
  assert.ok(Object.isFrozen(SESSION_DURABLE_AUDIT))
  assert.ok(Object.isFrozen(SESSION_DURABLE_AUDIT.packages))
})

test('durable catalog exposes exactly the five audited types in lexical order', () => {
  assert.deepEqual(DURABLE_EVENT_TYPES, DURABLE_TYPES)
  assert.ok(Object.isFrozen(DURABLE_EVENT_TYPES))
  assert.ok(Object.isFrozen(DURABLE_EVENT_DESCRIPTORS))
  assert.deepEqual(Object.keys(DURABLE_EVENT_DESCRIPTORS), DURABLE_TYPES)

  assert.throws(() => {
    DURABLE_EVENT_TYPES.push('user/message')
  }, TypeError)
  assert.throws(() => {
    DURABLE_EVENT_DESCRIPTORS['approval/asked'].payload.shape = 'changed'
  }, TypeError)
  assert.equal(DURABLE_EVENT_DESCRIPTORS['approval/asked'].payload.shape, '{ id: string, toolName: string, callId?: string, reason?: string }')
})

test('durable descriptors publish the exact non-surface audited metadata', () => {
  assert.deepEqual(DURABLE_EVENT_DESCRIPTORS['approval/policy'], {
    kind: 'approval/policy',
    logSource: 'official-session-log',
    observationSource: 'session/event',
    surfaceEligible: false,
    payload: {
      version: null,
      shape: "{ policy: 'ask' | 'never', source?: 'delegation' }",
    },
  })
  assert.deepEqual(DURABLE_EVENT_DESCRIPTORS['approval/asked'], {
    kind: 'approval/asked',
    logSource: 'official-session-log',
    observationSource: 'session/event',
    surfaceEligible: false,
    payload: {
      version: null,
      shape: '{ id: string, toolName: string, callId?: string, reason?: string }',
    },
  })
  assert.deepEqual(DURABLE_EVENT_DESCRIPTORS['approval/decided'], {
    kind: 'approval/decided',
    logSource: 'official-session-log',
    observationSource: 'session/event',
    surfaceEligible: false,
    payload: {
      version: null,
      shape: "{ id: string, outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable' }",
    },
  })
  assert.deepEqual(DURABLE_EVENT_DESCRIPTORS['schedule/change'], {
    kind: 'schedule/change',
    logSource: 'official-session-log',
    observationSource: 'session/event',
    surfaceEligible: false,
    payload: {
      version: 1,
      shape: "create: { version: 1, operation: 'create', schedule: After | At | Every }; delete: { version: 1, operation: 'delete', id }; dispatch: { version: 1, operation: 'dispatch', id } | { version: 1, operation: 'dispatch', id, acceptedAt }",
    },
  })
  assert.deepEqual(DURABLE_EVENT_DESCRIPTORS['subagent/descriptor'], {
    kind: 'subagent/descriptor',
    logSource: 'official-session-log',
    observationSource: 'session/event',
    surfaceEligible: false,
    payload: {
      version: 2,
      shape: "one-shot: { version: 2, mode: 'one-shot', provider, label? }; continuable: { version: 2, mode: 'continuable', provider, label, agentProvider?, agentModel?, persona?, toolFilter? }",
    },
  })

  for (const descriptor of Object.values(DURABLE_EVENT_DESCRIPTORS)) {
    assert.ok(Object.isFrozen(descriptor))
    assert.ok(Object.isFrozen(descriptor.payload))
  }
})

test('durable type helpers are total and do not widen the catalog', () => {
  for (const kind of DURABLE_TYPES) {
    assert.equal(isDurableEventType(kind), true)
    assert.equal(getDurableEventDescriptor(kind), DURABLE_EVENT_DESCRIPTORS[kind])
  }

  for (const value of [null, undefined, 0, false, {}, [], 'approval', 'user/message', 'toString', 'constructor', '__proto__']) {
    assert.equal(isDurableEventType(value), false)
    assert.equal(getDurableEventDescriptor(value), undefined)
  }
})

test('static durable metadata does not alter M1 session or event catalogs', () => {
  const sessionCatalogs = createSessionTypeCatalogs({
    knownSessionEventTypes: new Set(['user/message', 'session/title']),
    isSurfaceEligibleType: (type) => type === 'user/message',
  })
  const composedEvents = composeCatalogs(
    baseEventsCatalog,
    agentEventsCatalog,
    llmEventsCatalog,
    systemPromptEventsCatalog,
    settingsEventsCatalog,
    sessionLifecycleEventsCatalog,
    toolsEventsCatalog,
  )

  assert.equal(Object.keys(baseEventsCatalog).length, 19)
  assert.equal(Object.keys(composedEvents).length, 47)
  for (const kind of DURABLE_TYPES) {
    assert.equal(composedEvents[kind], undefined, `${kind} must not become a Cordis catalog entry`)
  }
  assert.deepEqual(sessionCatalogs.sessionEventTypes, ['session/title', 'user/message'])
  assert.deepEqual(sessionCatalogs.surfaceEventTypes, ['user/message'])
})

const contracts = buildSessionDurableContracts({
  Session,
  isJsonValue,
  snapshotJsonValue,
  knownSessionEventTypes: KNOWN_SESSION_EVENT_TYPES,
  isSurfaceEligibleType,
})

const envelope = (type, data, extra = {}) => ({
  type,
  seq: 7,
  time: 0,
  data,
  ...extra,
})

function validPayload(kind) {
  switch (kind) {
    case 'approval/asked':
      return { id: 'approval-1', toolName: 'shell', callId: 'call-1', reason: 'needs approval' }
    case 'approval/decided':
      return { id: 'approval-1', outcome: 'allowed-once' }
    case 'approval/policy':
      return { policy: 'ask', source: 'delegation' }
    case 'schedule/change':
      return {
        version: 1,
        operation: 'create',
        schedule: {
          id: 'schedule-1',
          kind: 'after',
          prompt: 'inspect status',
          afterSeconds: 30,
          scheduledAt: '2026-08-17T00:00:00.000Z',
        },
      }
    case 'subagent/descriptor':
      return { version: 2, mode: 'one-shot', provider: 'in-process', label: 'inspect' }
  }
}

test('installed public session exports build the exact finite durable contracts', () => {
  assert.equal(contracts.available, true)
  assert.equal(contracts.Session, Session)
  assert.equal(contracts.snapshotJsonValue, snapshotJsonValue)
  assert.equal(Object.isFrozen(contracts.surfaceMessageKinds), true)
  assert.equal(Object.isFrozen(contracts.surfaceMessageContracts), true)
  assert.deepEqual(contracts.surfaceMessageKinds, ['assistant/message', 'tool/result', 'user/message'])
  assert.deepEqual(contracts.surfaceMessageContracts, {
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

  for (const kind of DURABLE_TYPES) {
    assert.equal(contracts.isAuditedDurableRecord(kind, envelope(kind, validPayload(kind))), true)
    assert.equal(contracts.isSurfaceEligibleType(kind), false)
  }
  for (const kind of contracts.surfaceMessageKinds) {
    assert.equal(contracts.isSurfaceEligibleType(kind), true)
  }
})

test('durable predicates accept every audited schedule and descriptor variant', () => {
  const schedules = [
    { version: 1, operation: 'create', schedule: { id: 'a', kind: 'after', prompt: 'run', afterSeconds: 1, scheduledAt: '2026-08-17T00:00:00.000Z' } },
    { version: 1, operation: 'create', schedule: { id: 'b', kind: 'at', prompt: 'run', scheduledAt: '2026-08-17T00:00:00.000Z' } },
    { version: 1, operation: 'create', schedule: { id: 'c', kind: 'every', prompt: 'run', everySeconds: 300, scheduledAt: '2026-08-17T00:00:00.000Z' } },
    { version: 1, operation: 'delete', id: 'a' },
    { version: 1, operation: 'dispatch', id: 'a' },
    { version: 1, operation: 'dispatch', id: 'c', acceptedAt: '2026-08-17T00:05:00.000Z' },
  ]
  const descriptors = [
    { version: 2, mode: 'one-shot', provider: 'in-process' },
    { version: 2, mode: 'one-shot', provider: 'in-process', label: '' },
    { version: 2, mode: 'continuable', provider: 'in-process', label: 'child' },
    {
      version: 2,
      mode: 'continuable',
      provider: 'in-process',
      label: 'child',
      agentProvider: 'deepseek',
      agentModel: 'chat',
      persona: 'reviewer',
      toolFilter: { allow: ['read'], deny: [] },
    },
  ]

  for (const data of schedules) {
    assert.equal(contracts.isAuditedDurableRecord('schedule/change', envelope('schedule/change', data)), true)
  }
  for (const data of descriptors) {
    assert.equal(contracts.isAuditedDurableRecord('subagent/descriptor', envelope('subagent/descriptor', data)), true)
  }
})

test('durable predicates fail closed for malformed envelopes, metadata, and payload variants', () => {
  assert.equal(contracts.isAuditedDurableRecord('approval/policy', envelope('approval/policy', { policy: 'ask' }, { surfaceOp: 'append' })), false)
  assert.equal(contracts.isAuditedDurableRecord('approval/policy', envelope('approval/policy', { policy: 'ask' }, { sourceEventSeqs: [] })), false)
  assert.equal(contracts.isAuditedDurableRecord('approval/policy', { ...envelope('approval/policy', { policy: 'ask' }), extra: true }), false)
  assert.equal(contracts.isAuditedDurableRecord('approval/policy', envelope('approval/policy', { policy: 'sometimes' })), false)
  assert.equal(contracts.isAuditedDurableRecord('approval/asked', envelope('approval/asked', { id: 'a', toolName: 'x', extra: true })), false)
  assert.equal(contracts.isAuditedDurableRecord('approval/decided', envelope('approval/decided', { id: 'a', outcome: 'yes' })), false)
  assert.equal(contracts.isAuditedDurableRecord('schedule/change', envelope('schedule/change', { version: 2, operation: 'delete', id: 'a' })), false)
  assert.equal(contracts.isAuditedDurableRecord('schedule/change', envelope('schedule/change', { version: 1, operation: 'dispatch', id: 'a', acceptedAt: 'not-an-instant' })), false)
  assert.equal(contracts.isAuditedDurableRecord('subagent/descriptor', envelope('subagent/descriptor', { version: 2, mode: 'one-shot', provider: 'x', agentModel: 'wrong' })), false)
  assert.equal(contracts.isAuditedDurableRecord('subagent/descriptor', envelope('subagent/descriptor', { version: 2, mode: 'continuable', provider: 'x', label: 'x', toolFilter: {} })), false)
  assert.equal(contracts.isAuditedDurableRecord('subagent/descriptor', envelope('subagent/descriptor', { version: 2, mode: 'continuable', provider: 'x', label: 'x', toolFilter: { allow: ['read', 1] } })), false)
  assert.equal(contracts.isAuditedDurableRecord('approval/policy', { type: 'approval/policy', seq: -1, time: 0, data: { policy: 'ask' } }), false)
  assert.equal(contracts.isAuditedDurableRecord('approval/policy', { type: 'approval/policy', seq: 1, time: Infinity, data: { policy: 'ask' } }), false)
  const hiddenEnvelope = envelope('approval/policy', { policy: 'ask' })
  Object.defineProperty(hiddenEnvelope, 'hidden', { value: true })
  assert.equal(contracts.isAuditedDurableRecord('approval/policy', hiddenEnvelope), false)
  const symbolPayload = { policy: 'ask', [Symbol('hidden')]: true }
  assert.equal(contracts.isAuditedDurableRecord('approval/policy', envelope('approval/policy', symbolPayload)), false)
  const hiddenSchedule = { version: 1, operation: 'delete', id: 'a' }
  Object.defineProperty(hiddenSchedule, 'hidden', { value: true })
  assert.equal(contracts.isAuditedDurableRecord('schedule/change', envelope('schedule/change', hiddenSchedule)), false)
  const symbolDescriptor = { version: 2, mode: 'one-shot', provider: 'x', [Symbol('hidden')]: true }
  assert.equal(contracts.isAuditedDurableRecord('subagent/descriptor', envelope('subagent/descriptor', symbolDescriptor)), false)
})

test('contract builder returns a non-throwing unavailable result for hostile dependencies', () => {
  for (const dependencies of [
    {},
    { Session, isJsonValue, snapshotJsonValue, knownSessionEventTypes: new Set(DURABLE_TYPES), isSurfaceEligibleType: () => false },
    { Session, isJsonValue, snapshotJsonValue, knownSessionEventTypes: new Set([...DURABLE_TYPES, 'user/message', 'assistant/message', 'tool/result']), isSurfaceEligibleType: () => { throw new Error('hostile') } },
    new Proxy({}, { get() { throw new Error('hostile') } }),
  ]) {
    assert.doesNotThrow(() => buildSessionDurableContracts(dependencies))
    assert.equal(buildSessionDurableContracts(dependencies).available, false)
  }
})
