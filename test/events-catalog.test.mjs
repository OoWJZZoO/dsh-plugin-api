import test from 'node:test'
import assert from 'node:assert/strict'
import { baseEventsCatalog, catalogEntryOf } from '../lib/events-catalog.js'
import { composeCatalogs } from '../lib/catalog-compose.js'
import { agentEventsCatalog } from '../lib/agent-events-catalog.js'
import { llmEventsCatalog } from '../lib/llm-events-catalog.js'
import { systemPromptEventsCatalog } from '../lib/system-prompt-events-catalog.js'
import { settingsEventsCatalog } from '../lib/settings-events-catalog.js'
import { sessionLifecycleEventsCatalog } from '../lib/session-events-catalog.js'
import { toolsEventsCatalog } from '../lib/tools-events-catalog.js'

const BASE_NAMES = [
  'fs/write-intent',
  'fs/edit-intent',
  'fs/observed',
  'subagent/start',
  'subagent/end',
  'subagent/provider-added',
  'subagent/provider-removed',
  'workflow/start',
  'workflow/phase',
  'workflow/log',
  'workflow/agent-start',
  'workflow/agent-end',
  'workflow/end',
  'approval/request',
  'commands/change',
  'skills/change',
  'credentials/updated',
  'goal/changed',
  'session-telemetry/record',
]

test('base catalog contains exactly the 19 events-m1 event names', () => {
  assert.deepEqual(Object.keys(baseEventsCatalog).sort(), [...BASE_NAMES].sort())
})

test('every base entry has the required unified-schema metadata fields', () => {
  for (const name of BASE_NAMES) {
    const entry = baseEventsCatalog[name]
    assert.ok(entry, `missing entry: ${name}`)
    assert.ok(typeof entry.name === 'string', `${name}: name`)
    assert.ok(['on', 'emit', 'serial', 'parallel', 'bail', 'waterfall'].includes(entry.mode), `${name}: mode`)
    assert.ok(typeof entry.scopeFiltered === 'boolean', `${name}: scopeFiltered`)
    assert.ok(entry.scopeKey === undefined || entry.scopeKey === null
      || entry.scopeKey === 'args[0].agent' || entry.scopeKey === 'args[1].scope', `${name}: scopeKey domain`)
    assert.ok(typeof entry.payload === 'string', `${name}: payload`)
    assert.ok(typeof entry.args === 'string', `${name}: args`)
    assert.ok(typeof entry.source === 'string', `${name}: source`)
    assert.ok(entry.type === 'A' || entry.type === 'B', `${name}: type`)
  }
})

test('base entries keep the events-m1 behavior (fault contain, freeze all)', () => {
  for (const name of BASE_NAMES) {
    const entry = baseEventsCatalog[name]
    assert.equal(entry.fault, 'contain', `${name}: fault defaults to contain`)
    assert.equal(entry.freeze, 'all', `${name}: freeze defaults to all`)
  }
})

test('base catalog and every entry are deeply frozen', () => {
  assert.ok(Object.isFrozen(baseEventsCatalog), 'catalog is frozen')
  for (const entry of Object.values(baseEventsCatalog)) {
    assert.ok(Object.isFrozen(entry), `${entry.name} entry is frozen`)
  }
})

test('composing all M1 slices yields exactly the 47 stabilized event names', () => {
  const composed = composeCatalogs(
    baseEventsCatalog,
    agentEventsCatalog,
    llmEventsCatalog,
    systemPromptEventsCatalog,
    settingsEventsCatalog,
    sessionLifecycleEventsCatalog,
    toolsEventsCatalog,
  )
  const expected = [
    ...BASE_NAMES,
    ...Object.keys(agentEventsCatalog),
    ...Object.keys(llmEventsCatalog),
    ...Object.keys(systemPromptEventsCatalog),
    ...Object.keys(settingsEventsCatalog),
    ...Object.keys(sessionLifecycleEventsCatalog),
    ...Object.keys(toolsEventsCatalog),
  ]
  assert.deepEqual(Object.keys(composed).sort(), expected.sort())
  assert.equal(Object.keys(composed).length, 47)
  assert.ok(Object.isFrozen(composed), 'composed catalog is frozen')
})

test('composition fails loud on duplicate event names', () => {
  assert.throws(
    () => composeCatalogs(baseEventsCatalog, { 'goal/changed': { name: 'goal/changed' } }),
    /duplicate catalog entry "goal\/changed"/,
  )
})

test('catalogEntryOf resolves base entries and returns undefined otherwise', () => {
  assert.equal(catalogEntryOf('goal/changed')?.name, 'goal/changed')
  assert.equal(catalogEntryOf('agent/created'), undefined, 'slice entries are not base-cataloged')
  assert.equal(catalogEntryOf('not-a-real-event'), undefined)
})
