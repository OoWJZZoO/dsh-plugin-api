import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientSlots } from '../lib/client-slots.js'
import { createClientSlotEvents } from '../lib/client-slot-events.js'

test('slots preserve official ownership and emit changed after committed mutations', () => {
  const events = createClientSlotEvents()
  const changed = []
  events.on('slots/changed', (key) => changed.push(key))
  const entries = [{ name: 'one' }]
  const slots = {
    register() { return () => undefined }, inject() {}, entries() { return entries }, subscribe() { return () => {} },
  }
  const api = createClientSlots({ slots, notifyChanged: events.emitChanged })
  const dispose = api.register({ key: 'settings.panel', kind: 'panel', scope: 'global' }, {})
  assert.deepEqual(changed, ['settings.panel'])
  const snapshot = api.entries('settings.panel')
  assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot[0]))
  dispose()
  assert.deepEqual(changed, ['settings.panel', 'settings.panel'])
})

test('slots reject invalid keys and SlotEntryDef fields before official calls', () => {
  const api = createClientSlots({ slots: { register() {}, inject() {}, entries() { return [] }, subscribe() {} } })
  assert.throws(() => api.register({ key: 'arbitrary', kind: 'panel', scope: 'global' }, {}), /canonical/)
  assert.throws(() => api.register({ key: 'details', kind: 'panel' }, {}), /scope/)
  assert.throws(() => api.entries('x'), /canonical/)
})
