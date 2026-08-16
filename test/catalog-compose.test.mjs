import test from 'node:test'
import assert from 'node:assert/strict'
import { composeCatalogs } from '../lib/catalog-compose.js'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { sessionLifecycleEventsCatalog } from '../lib/session-events-catalog.js'

test('composeCatalogs merges base events and session lifecycle catalogs', () => {
  const composed = composeCatalogs(baseEventsCatalog, sessionLifecycleEventsCatalog)

  assert.equal(Object.keys(composed).length, 23)
  for (const name of Object.keys(baseEventsCatalog)) {
    assert.ok(name in composed, `${name} must be present`)
    assert.equal(composed[name], baseEventsCatalog[name], `${name} entry must be preserved`)
  }
  for (const name of Object.keys(sessionLifecycleEventsCatalog)) {
    assert.ok(name in composed, `${name} must be present`)
    assert.equal(composed[name], sessionLifecycleEventsCatalog[name], `${name} entry must be preserved`)
  }
})

test('composed catalog and every entry are deeply frozen', () => {
  const composed = composeCatalogs(baseEventsCatalog, sessionLifecycleEventsCatalog)
  assert.ok(Object.isFrozen(composed), 'composed catalog must be frozen')
  for (const entry of Object.values(composed)) {
    assert.ok(Object.isFrozen(entry), 'each entry must be frozen')
  }
})

test('duplicate event names fail loud', () => {
  const dup = {
    'session/created': { name: 'session/created' },
  }
  assert.throws(
    () => composeCatalogs(sessionLifecycleEventsCatalog, dup),
    (error) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /duplicate catalog entry "session\/created"/)
      return true
    },
  )
})

test('empty input returns an empty frozen catalog', () => {
  const composed = composeCatalogs()
  assert.deepEqual(Object.keys(composed), [])
  assert.ok(Object.isFrozen(composed))
})

test('a single catalog returns an equivalent frozen copy, not the same object', () => {
  const composed = composeCatalogs(sessionLifecycleEventsCatalog)
  assert.notEqual(composed, sessionLifecycleEventsCatalog)
  assert.deepEqual(composed, sessionLifecycleEventsCatalog)
  assert.ok(Object.isFrozen(composed))
})
