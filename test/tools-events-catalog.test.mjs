import test from 'node:test'
import assert from 'node:assert/strict'
import { toolsCatalogEntryOf, toolsEventsCatalog } from '../lib/tools-events-catalog.js'

const EXPECTED_NAMES = [
  'tools/change',
  'tools/pre-execute',
  'tools/execute',
  'tools/post-execute',
  'tools/result',
  'tools/code-dispatch-log',
]

test('tools catalog contains exactly the six in-scope tool event names', () => {
  assert.deepEqual(Object.keys(toolsEventsCatalog).sort(), [...EXPECTED_NAMES].sort())
})

test('every tools catalog entry has the required metadata fields', () => {
  for (const name of EXPECTED_NAMES) {
    const entry = toolsEventsCatalog[name]
    assert.ok(entry, `missing entry: ${name}`)
    assert.ok(typeof entry.name === 'string', `${name}: name`)
    assert.ok(['on', 'emit', 'serial', 'parallel', 'bail', 'waterfall'].includes(entry.mode), `${name}: mode`)
    assert.ok(typeof entry.scopeFiltered === 'boolean', `${name}: scopeFiltered`)
    assert.ok('subject' in entry, `${name}: subject field`)
    assert.ok(['all', 'except-signal'].includes(entry.freeze), `${name}: freeze`)
    assert.ok(typeof entry.payload === 'string', `${name}: payload`)
    assert.ok(typeof entry.args === 'string', `${name}: args`)
    assert.ok(typeof entry.source === 'string', `${name}: source`)
    assert.ok(['A', 'B'].includes(entry.type), `${name}: type`)
  }
})

test('tools catalog entries match the confirmed mode/scope/subject/freeze matrix', () => {
  const matrix = {
    'tools/change': ['emit', false, undefined, 'all', 'T2'],
    'tools/pre-execute': ['waterfall', true, 'args[0].agent', 'all', 'T3'],
    'tools/execute': ['waterfall', true, 'args[0].agent', 'except-signal', 'T4'],
    'tools/post-execute': ['waterfall', true, 'args[0].agent', 'all', 'T5'],
    'tools/result': ['emit', true, 'args[0].agent', 'all', 'T6'],
    'tools/code-dispatch-log': ['waterfall', true, 'args[0].agent', 'all', 'T7'],
  }
  for (const [name, [mode, scopeFiltered, subject, freeze, source]] of Object.entries(matrix)) {
    const entry = toolsCatalogEntryOf(name)
    assert.equal(entry.mode, mode, `${name}: mode`)
    assert.equal(entry.scopeFiltered, scopeFiltered, `${name}: scopeFiltered`)
    assert.equal(entry.subject, subject, `${name}: subject`)
    assert.equal(entry.freeze, freeze, `${name}: freeze`)
    assert.equal(entry.source, source, `${name}: source`)
    assert.equal(entry.type, 'A', `${name}: type`)
  }
})

test('tools catalog and every entry are frozen', () => {
  assert.ok(Object.isFrozen(toolsEventsCatalog), 'tools catalog is frozen')
  for (const entry of Object.values(toolsEventsCatalog)) {
    assert.ok(Object.isFrozen(entry), `${entry.name} entry is frozen`)
  }
})

test('toolsCatalogEntryOf returns the entry for known names and undefined otherwise', () => {
  assert.equal(toolsCatalogEntryOf('tools/execute')?.name, 'tools/execute')
  assert.equal(toolsCatalogEntryOf('tools/change')?.scopeFiltered, false)
  assert.equal(toolsCatalogEntryOf('tools/pre-execute')?.subject, 'args[0].agent')
  assert.equal(toolsCatalogEntryOf('not-a-real-tool-event'), undefined)
})
