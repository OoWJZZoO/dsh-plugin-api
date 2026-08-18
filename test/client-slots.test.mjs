import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientSlots } from '../lib/client-slots.js'
import { createClientSlotEvents } from '../lib/client-slot-events.js'

test('slots preserve official ownership and emit changed after committed mutations', () => {
  const events = createClientSlotEvents()
  const changed = []
  events.on('slots/changed', (key) => changed.push(key))
  const entries = [{ name: 'one', options: { nested: { stable: true } } }]
  let observer
  const slots = {
    register(options) { observer?.(options.key); return () => { observer?.(options.key) } }, inject() {}, entries() { return entries }, subscribe() { return () => {} }, onMutate(listener) { observer = listener; return () => { observer = undefined } },
  }
  const api = createClientSlots({ slots, notifyChanged: events.emitChanged })
  const dispose = api.register({ key: 'settings.panel', kind: 'single', scope: 'root' }, {})
  assert.deepEqual(changed, ['settings.panel'])
  const snapshot = api.entries('settings.panel')
  assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot[0]))
  assert.ok(Object.isFrozen(snapshot[0].options.nested))
  assert.throws(() => { snapshot[0].options.nested.stable = false }, TypeError)
  dispose()
  assert.deepEqual(changed, ['settings.panel', 'settings.panel'])
  observer('details')
  assert.deepEqual(changed, ['settings.panel', 'settings.panel', 'details'])
})

test('slots reject invalid keys and SlotEntryDef fields before official calls', () => {
  const api = createClientSlots({ slots: { register() {}, inject() {}, entries() { return [] }, subscribe() {} } })
  assert.throws(() => api.register({ key: 'arbitrary', kind: 'single', scope: 'root' }, {}), /canonical/)
  assert.throws(() => api.register({ key: 'details', kind: 'panel' }, {}), /kind/)
  assert.throws(() => api.register({ key: 'details', kind: 'single', scope: 'global' }, {}), /scope/)
  assert.throws(() => api.entries('x'), /canonical/)
})
