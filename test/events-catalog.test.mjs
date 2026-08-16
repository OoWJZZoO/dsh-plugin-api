import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogEntryOf, eventsCatalog, mergeEventCatalogs } from '../lib/events-catalog.js'
import { toolsEventsCatalog } from '../lib/tools-events-catalog.js'

const EXPECTED_NAMES = [
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

test('catalog contains exactly the 19 in-scope event names', () => {
  assert.deepEqual(Object.keys(eventsCatalog).sort(), [...EXPECTED_NAMES].sort())
})

test('every catalog entry has the required metadata fields', () => {
  for (const name of EXPECTED_NAMES) {
    const entry = eventsCatalog[name]
    assert.ok(entry, `missing entry: ${name}`)
    assert.ok(typeof entry.name === 'string', `${name}: name`)
    assert.ok(['on', 'emit', 'serial', 'parallel', 'bail', 'waterfall'].includes(entry.mode), `${name}: mode`)
    assert.ok(typeof entry.scopeFiltered === 'boolean', `${name}: scopeFiltered`)
    assert.ok('subject' in entry, `${name}: subject field`)
    assert.ok(typeof entry.payload === 'string', `${name}: payload`)
    assert.ok(typeof entry.args === 'string', `${name}: args`)
    assert.ok(typeof entry.source === 'string', `${name}: source`)
    assert.ok(['A', 'B'].includes(entry.type), `${name}: type`)
  }
})

test('catalog entries match the confirmed mode/scope/subject matrix', () => {
  const matrix = {
    'fs/write-intent': ['waterfall', false, undefined],
    'fs/edit-intent': ['waterfall', false, undefined],
    'fs/observed': ['emit', false, undefined],
    'subagent/start': ['emit', true, null],
    'subagent/end': ['emit', true, null],
    'subagent/provider-added': ['emit', false, undefined],
    'subagent/provider-removed': ['emit', false, undefined],
    'workflow/start': ['emit', false, undefined],
    'workflow/phase': ['emit', false, undefined],
    'workflow/log': ['emit', false, undefined],
    'workflow/agent-start': ['emit', false, undefined],
    'workflow/agent-end': ['emit', false, undefined],
    'workflow/end': ['emit', false, undefined],
    'approval/request': ['waterfall', true, 'args[0].agent'],
    'commands/change': ['emit', false, undefined],
    'skills/change': ['emit', false, undefined],
    'credentials/updated': ['emit', false, undefined],
    'goal/changed': ['emit', true, 'args[0].agent'],
    'session-telemetry/record': ['waterfall', false, undefined],
  }
  for (const [name, [mode, scopeFiltered, subject]] of Object.entries(matrix)) {
    const entry = catalogEntryOf(name)
    assert.equal(entry.mode, mode, `${name}: mode`)
    assert.equal(entry.scopeFiltered, scopeFiltered, `${name}: scopeFiltered`)
    assert.equal(entry.subject, subject, `${name}: subject`)
    assert.equal(entry.type, 'A', `${name}: type`)
  }
})

test('catalog and every entry are frozen', () => {
  assert.ok(Object.isFrozen(eventsCatalog), 'catalog is frozen')
  for (const entry of Object.values(eventsCatalog)) {
    assert.ok(Object.isFrozen(entry), `${entry.name} entry is frozen`)
  }
})

test('catalogEntryOf returns the entry for known names and undefined otherwise', () => {
  assert.equal(catalogEntryOf('goal/changed')?.name, 'goal/changed')
  assert.equal(catalogEntryOf('not-a-real-event'), undefined)
})

test('mergeEventCatalogs combines base and tools catalogs into a frozen 25-entry catalog', () => {
  const merged = mergeEventCatalogs(eventsCatalog, toolsEventsCatalog)
  assert.deepEqual(Object.keys(merged).sort(), [...EXPECTED_NAMES, ...Object.keys(toolsEventsCatalog)].sort())
  assert.ok(Object.isFrozen(merged), 'merged catalog is frozen')
  for (const entry of Object.values(merged)) {
    assert.ok(Object.isFrozen(entry), `${entry.name} entry is frozen`)
  }
  assert.equal(merged['tools/execute']?.freeze, 'except-signal')
  assert.equal(merged['goal/changed']?.mode, 'emit')
})

test('mergeEventCatalogs with only the base catalog is equivalent to the base catalog', () => {
  const merged = mergeEventCatalogs(eventsCatalog)
  assert.deepEqual(Object.keys(merged).sort(), [...EXPECTED_NAMES].sort())
  assert.ok(Object.isFrozen(merged))
})

test('mergeEventCatalogs does not mutate the base catalogs', () => {
  const before = Object.keys(eventsCatalog).length
  mergeEventCatalogs(eventsCatalog, toolsEventsCatalog)
  assert.equal(Object.keys(eventsCatalog).length, before)
  assert.equal(eventsCatalog['tools/execute'], undefined)
  assert.ok(Object.isFrozen(eventsCatalog))
  assert.ok(Object.isFrozen(toolsEventsCatalog))
})
