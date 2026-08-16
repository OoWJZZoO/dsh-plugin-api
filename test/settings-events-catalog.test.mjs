import test from 'node:test'
import assert from 'node:assert/strict'
import { settingsEventsCatalog } from '../lib/settings-events-catalog.js'

test('settings slice contains exactly the ST3 event names', () => {
  assert.deepEqual(Object.keys(settingsEventsCatalog).sort(), ['settings/document-updated', 'settings/updated'])
  assert.ok(Object.isFrozen(settingsEventsCatalog), 'catalog must be frozen')
})

test('settings/updated entry matches the confirmed emit metadata', () => {
  const updated = settingsEventsCatalog['settings/updated']
  assert.equal(updated.mode, 'emit')
  assert.equal(updated.scopeFiltered, false)
  assert.equal(updated.scopeKey, undefined)
  assert.equal(updated.fault, 'contain')
  assert.equal(updated.freeze, 'all')
  assert.equal(updated.source, 'ST3')
  assert.equal(updated.type, 'A')
  assert.equal(updated.args, '(ns, next, prev, source)')
  assert.match(updated.payload, /source/)
  // NOTE: the transitional `feature` gating field is removed by task 2.4.
  assert.equal(updated.feature, 'settings')
})

test('settings/document-updated entry matches the confirmed emit metadata', () => {
  const documentUpdated = settingsEventsCatalog['settings/document-updated']
  assert.equal(documentUpdated.mode, 'emit')
  assert.equal(documentUpdated.scopeFiltered, false)
  assert.equal(documentUpdated.scopeKey, undefined)
  assert.equal(documentUpdated.fault, 'contain')
  assert.equal(documentUpdated.freeze, 'all')
  assert.equal(documentUpdated.source, 'ST3')
  assert.equal(documentUpdated.type, 'A')
  assert.equal(documentUpdated.args, '(ns, revision)')
  assert.match(documentUpdated.payload, /revision/)
  assert.equal(documentUpdated.feature, 'settings')
})
