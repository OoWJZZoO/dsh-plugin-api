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
    assert.ok('scopeKey' in entry, `${name}: scopeKey field`)
    assert.ok(['all', 'except-signal'].includes(entry.freeze), `${name}: freeze`)
    assert.ok(typeof entry.payload === 'string', `${name}: payload`)
    assert.ok(typeof entry.args === 'string', `${name}: args`)
    assert.ok(!('source' in entry), `${name}: governance source ids must not leak`)
    assert.ok(!('type' in entry), `${name}: governance class letters must not leak`)
  }
})

test('tools catalog entries match the confirmed mode/scopeKey/freeze matrix', () => {
  const matrix = {
    'tools/change': ['emit', false, undefined, 'all'],
    'tools/pre-execute': ['waterfall', true, 'args[0].agent', 'all'],
    'tools/execute': ['waterfall', true, 'args[0].agent', 'except-signal'],
    'tools/post-execute': ['waterfall', true, 'args[0].agent', 'all'],
    'tools/result': ['emit', true, 'args[0].agent', 'all'],
    'tools/code-dispatch-log': ['waterfall', true, 'args[0].agent', 'all'],
  }
  for (const [name, [mode, scopeFiltered, subject, freeze]] of Object.entries(matrix)) {
    const entry = toolsCatalogEntryOf(name)
    assert.equal(entry.mode, mode, `${name}: mode`)
    assert.equal(entry.scopeFiltered, scopeFiltered, `${name}: scopeFiltered`)
    assert.equal(entry.scopeKey, subject, `${name}: subject`)
    assert.equal(entry.freeze, freeze, `${name}: freeze`)
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
  assert.equal(toolsCatalogEntryOf('tools/pre-execute')?.scopeKey, 'args[0].agent')
  assert.equal(toolsCatalogEntryOf('not-a-real-tool-event'), undefined)
})
