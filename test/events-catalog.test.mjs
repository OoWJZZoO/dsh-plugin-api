import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogEntryOf, eventsCatalog } from '../lib/events-catalog.js'

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
  'settings/updated',
  'settings/document-updated',
]

test('catalog contains exactly the 21 in-scope event names', () => {
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
    'settings/updated': ['emit', false, undefined],
    'settings/document-updated': ['emit', false, undefined],
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

test('settings event entries carry ST3 payload metadata and settings feature gate', () => {
  const updated = catalogEntryOf('settings/updated')
  assert.equal(updated.source, 'ST3')
  assert.equal(updated.type, 'A')
  assert.equal(updated.feature, 'settings')
  assert.equal(updated.args, '(ns, next, prev, source)')
  assert.match(updated.payload, /source/)

  const documentUpdated = catalogEntryOf('settings/document-updated')
  assert.equal(documentUpdated.source, 'ST3')
  assert.equal(documentUpdated.type, 'A')
  assert.equal(documentUpdated.feature, 'settings')
  assert.equal(documentUpdated.args, '(ns, revision)')
  assert.match(documentUpdated.payload, /revision/)
})

test('catalogEntryOf returns the entry for known names and undefined otherwise', () => {
  assert.equal(catalogEntryOf('goal/changed')?.name, 'goal/changed')
  assert.equal(catalogEntryOf('not-a-real-event'), undefined)
})
