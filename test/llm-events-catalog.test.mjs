import test from 'node:test'
import assert from 'node:assert/strict'
import { llmEventsCatalog } from '../lib/llm-events-catalog.js'

test('llm slice contains exactly the L3/L6 event names', () => {
  assert.deepEqual(Object.keys(llmEventsCatalog).sort(), ['llm/adapters-updated', 'llm/stream'])
  assert.ok(Object.isFrozen(llmEventsCatalog), 'catalog must be frozen')
})

test('llm/stream entry matches the confirmed waterfall metadata', () => {
  const stream = llmEventsCatalog['llm/stream']
  assert.equal(stream.mode, 'waterfall')
  assert.equal(stream.scopeFiltered, false)
  assert.equal(stream.scopeKey, undefined)
  assert.equal(stream.fault, 'contain')
  assert.equal(stream.freeze, 'all')
  assert.match(stream.payload, /GenerateOptions/)
  assert.equal(stream.args, '(options, next)')
  assert.equal(stream.source, 'L3')
  assert.equal(stream.type, 'A')
})

test('llm/adapters-updated entry matches the confirmed emit metadata', () => {
  const updated = llmEventsCatalog['llm/adapters-updated']
  assert.equal(updated.mode, 'emit')
  assert.equal(updated.scopeFiltered, false)
  assert.equal(updated.scopeKey, undefined)
  assert.equal(updated.fault, 'contain')
  assert.equal(updated.freeze, 'all')
  assert.equal(updated.payload, 'none')
  assert.equal(updated.args, '()')
  assert.equal(updated.source, 'L6')
  assert.equal(updated.type, 'A')
})
