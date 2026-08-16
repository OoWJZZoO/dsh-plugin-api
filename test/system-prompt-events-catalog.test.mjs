import test from 'node:test'
import assert from 'node:assert/strict'
import { systemPromptEventsCatalog } from '../lib/system-prompt-events-catalog.js'

test('system-prompt slice contains exactly the P6/P7 event names', () => {
  assert.deepEqual(Object.keys(systemPromptEventsCatalog).sort(), ['system-prompt/assemble', 'system-prompt/change'])
  assert.ok(Object.isFrozen(systemPromptEventsCatalog), 'catalog must be frozen')
})

test('system-prompt/assemble entry matches the confirmed waterfall metadata', () => {
  const assemble = systemPromptEventsCatalog['system-prompt/assemble']
  assert.equal(assemble.mode, 'waterfall')
  assert.equal(assemble.scopeFiltered, true)
  assert.equal(assemble.scopeKey, 'args[1].scope')
  assert.equal(assemble.fault, 'contain')
  assert.equal(assemble.freeze, 'all')
  assert.match(assemble.payload, /assembly/)
  assert.equal(assemble.args, '(assembly, context, next)')
  assert.equal(assemble.source, 'P6')
  assert.equal(assemble.type, 'A')
})

test('system-prompt/change entry matches the confirmed emit metadata', () => {
  const change = systemPromptEventsCatalog['system-prompt/change']
  assert.equal(change.mode, 'emit')
  assert.equal(change.scopeFiltered, false)
  assert.equal(change.scopeKey, undefined)
  assert.equal(change.fault, 'contain')
  assert.equal(change.freeze, 'all')
  assert.equal(change.payload, 'none')
  assert.equal(change.args, '()')
  assert.equal(change.source, 'P7')
  assert.equal(change.type, 'A')
})
