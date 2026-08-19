import test from 'node:test'
import assert from 'node:assert/strict'
import { composeCatalogs } from '../lib/catalog-compose.js'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { agentEventsCatalog } from '../lib/agent-events-catalog.js'
import { llmEventsCatalog } from '../lib/llm-events-catalog.js'
import { systemPromptEventsCatalog } from '../lib/system-prompt-events-catalog.js'
import { settingsEventsCatalog } from '../lib/settings-events-catalog.js'
import { sessionLifecycleEventsCatalog } from '../lib/session-events-catalog.js'
import { toolsEventsCatalog } from '../lib/tools-events-catalog.js'
import { DURABLE_EVENT_DESCRIPTORS, DURABLE_EVENT_TYPES } from '../lib/session-durable-catalog.js'
import { SERVICES_NAMESPACE_KEYS } from '../lib/services.js'

// These are deliberately separate approved sets. Their counts must never be
// inferred from each other: Cordis events (47), durable records (5), and
// services namespace keys (21) have distinct ownership and boundaries.
const M1_CORDIS_EVENT_NAMES = [
  'agent/created',
  'agent/disposed',
  'agent/error',
  'agent/inbox/claimed',
  'agent/inbox/discarded',
  'agent/inbox/inserted',
  'agent/pre-step',
  'agent/request',
  'agent/request-error',
  'agent/session-start',
  'agent/status',
  'agent/turn-stopping',
  'approval/request',
  'commands/change',
  'credentials/updated',
  'fs/edit-intent',
  'fs/observed',
  'fs/write-intent',
  'goal/changed',
  'llm/adapters-updated',
  'llm/stream',
  'session-telemetry/record',
  'session/created',
  'session/disposed',
  'session/event',
  'session/flush',
  'settings/document-updated',
  'settings/updated',
  'skills/change',
  'subagent/end',
  'subagent/provider-added',
  'subagent/provider-removed',
  'subagent/start',
  'system-prompt/assemble',
  'system-prompt/change',
  'tools/change',
  'tools/code-dispatch-log',
  'tools/execute',
  'tools/post-execute',
  'tools/pre-execute',
  'tools/result',
  'workflow/agent-end',
  'workflow/agent-start',
  'workflow/end',
  'workflow/log',
  'workflow/phase',
  'workflow/start',
]

const DURABLE_KIND_NAMES = [
  'approval/asked',
  'approval/decided',
  'approval/policy',
  'schedule/change',
  'subagent/descriptor',
]

const SERVICES_KEYS = [
  'fs',
  'codeRuntime',
  'workspaces',
  'subagents',
  'workflows',
  'approval',
  'userQuestions',
  'attachments',
  'skills',
  'storage',
  'sessionProjections',
  'sessionQuery',
  'sessionTitle',
  'sessionTelemetry',
  'sessionReferences',
  'tokenMeter',
  'agentDefaultModel',
  'web',
  'compaction',
  'jobs',
  'shellEnv',
]

test('M1 Cordis catalog remains the exact 47-name frozen union with no M2 synthetic event', () => {
  const catalog = composeCatalogs(
    baseEventsCatalog,
    agentEventsCatalog,
    llmEventsCatalog,
    systemPromptEventsCatalog,
    settingsEventsCatalog,
    sessionLifecycleEventsCatalog,
    toolsEventsCatalog,
  )

  assert.equal(Object.keys(catalog).length, 47)
  assert.deepEqual(Object.keys(catalog).sort(), M1_CORDIS_EVENT_NAMES)
  assert.ok(Object.isFrozen(catalog))
  for (const entry of Object.values(catalog)) {
    assert.ok(Object.isFrozen(entry), `${entry.name} stays frozen`)
    assert.equal(typeof entry.scopeFiltered, 'boolean', `${entry.name} scope schema`)
    assert.ok('scopeKey' in entry, `${entry.name} scope key schema`)
    // M1 intentionally permits either an explicit policy or its documented
    // default (`fault` absent => contain; `freeze` absent => all).
    assert.ok(entry.fault === undefined || ['contain', 'created', 'propagate'].includes(entry.fault), `${entry.name} fault schema`)
    assert.ok(entry.freeze === undefined || entry.freeze === 'all' || entry.freeze === 'except-signal' || Array.isArray(entry.freeze?.deep), `${entry.name} freeze schema`)
  }
  for (const nonEvent of [
    'llm/request',
    'llm/admission',
    'exec.route',
    'agent/create',
    ...DURABLE_KIND_NAMES,
    'compaction/started',
    'jobs/started',
    'jobs/changed',
    'shellEnv/register',
    'shellEnv/changed',
  ]) {
    assert.equal(catalog[nonEvent], undefined, `${nonEvent} is not a Cordis catalog entry`)
  }
  assert.throws(
    () => composeCatalogs(baseEventsCatalog, { 'goal/changed': { name: 'goal/changed' } }),
    /duplicate catalog entry "goal\/changed"/,
  )
})

test('durable observation retains its independent exact five-kind catalog', () => {
  assert.equal(DURABLE_EVENT_TYPES.length, 5)
  assert.deepEqual(DURABLE_EVENT_TYPES, DURABLE_KIND_NAMES)
  assert.equal(Object.keys(DURABLE_EVENT_DESCRIPTORS).length, 5)
  assert.deepEqual(Object.keys(DURABLE_EVENT_DESCRIPTORS), DURABLE_KIND_NAMES)
})

test('services namespace retains its independent exact 21-key static allowlist', () => {
  assert.equal(SERVICES_NAMESPACE_KEYS.length, 21)
  assert.deepEqual(SERVICES_NAMESPACE_KEYS, SERVICES_KEYS)
})
