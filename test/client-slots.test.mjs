import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientSlots } from '../lib/client-slots.js'
import { createClientSlotEvents } from '../lib/client-slot-events.js'

test('slots preserve official ownership and emit changed after committed mutations', () => {
  const listeners = new Set()
  const emitChanged = (key) => {
    for (const listener of [...listeners]) listener(key)
  }
  const events = createClientSlotEvents({
    ctx: {
      on(name, listener) {
        assert.equal(name, 'slots/changed')
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  })
  const changed = []
  events.on('slots/changed', (key) => changed.push(key))
  const entries = [{ name: 'one', options: { nested: { stable: true } } }]
  let observer
  const slots = {
    register(options) { emitChanged(options.name); return () => { emitChanged(options.name) } }, inject() {}, entries() { return entries }, subscribe() { return () => {} }, onMutate(listener) { observer = listener; return () => { observer = undefined } },
  }
  const api = createClientSlots({ slots, notifyChanged: emitChanged })
  const dispose = api.register({ name: 'settings.panel' }, {})
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

test('slots hand key admission to the official runtime and still validate their own declarations', () => {
  const registered = []
  const api = createClientSlots({
    slots: { register(options) { registered.push(options.name); return () => {} }, inject() {}, entries() { return [] }, subscribe() {} },
  })
  // A real officially declared slot must reach the official runtime: the facade
  // no longer rejects keys against a maintainer-guessed prefix set.
  assert.doesNotThrow(() => api.register({ name: 'tool.call.toolview' }, {}))
  assert.deepEqual(registered, ['tool.call.toolview'])
  // Values that cannot be a slot key at all are still rejected up front.
  assert.throws(() => api.register({ name: '' }, {}), /non-empty string/)
  assert.throws(() => api.entries(''), /non-empty string/)
  // The child-declaration grammar the facade owns is still validated.
  assert.throws(() => api.register({ name: 'details', children: { 'settings.panel': { kind: 'panel', scope: 'root' } } }, {}), /kind/)
  assert.throws(() => api.register({ name: 'details', children: { 'settings.panel': { kind: 'single', scope: 'global' } } }, {}), /scope/)
})
