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

test('the declaration projection separates undeclared, declared-but-empty and unknowable keys', () => {
  const specs = new Map([['details', { kind: 'list', scope: 'root', declaredBy: 'shell' }]])
  const epochs = new Map([['details', 3]])
  const api = createClientSlots({
    slots: {
      register() { return () => {} },
      inject() {},
      subscribe() {},
      entries: (key) => (key === 'details' ? [] : []),
      spec: (key) => specs.get(key),
      specDynamic: (key) => specs.get(key),
      declarationEpoch: (key) => epochs.get(key) ?? 0,
      snapshot: (key) => (specs.has(key) ? [{ name: key, kind: 'list', scope: 'root' }] : []),
    },
  })

  const declared = api.declaration('details')
  assert.equal(declared.status, 'declared', 'a declared slot with no entries is still declared')
  assert.deepEqual(declared.entries, [], 'declared but empty is not the same as undeclared')
  assert.deepEqual(declared.spec, { kind: 'list', scope: 'root', declaredBy: 'shell' })
  assert.equal(declared.declarationEpoch, 3)
  assert.deepEqual(declared.snapshot, [{ name: 'details', kind: 'list', scope: 'root' }])
  assert.ok(Object.isFrozen(declared) && Object.isFrozen(declared.spec) && Object.isFrozen(declared.snapshot))

  assert.equal(api.declaration('never-declared').status, 'missing')
  assert.equal(api.list('never-declared').status, 'missing')
  assert.deepEqual(api.list('never-declared').entries, [])

  // The list view answers the same status as the projection it derives from.
  assert.equal(api.list('details').status, 'declared')
  assert.equal(Object.isFrozen(api.list('details')), true)
})

test('a runtime that cannot answer declares the key unknowable instead of guessing', () => {
  const api = createClientSlots({
    slots: { register() { return () => {} }, inject() {}, subscribe() {}, entries: () => [] },
  })
  const view = api.declaration('details')
  assert.equal(view.status, 'unavailable', 'without a declaration accessor the answer is unknowable, not "missing"')
  assert.equal('spec' in view, false, 'no official fact is fabricated')
  assert.equal(api.list('details').status, 'unavailable')

  const withEntries = createClientSlots({
    slots: { register() { return () => {} }, inject() {}, subscribe() {}, entries: (key) => (key === 'details' ? [{ name: 'one' }] : []) },
  })
  assert.equal(withEntries.declaration('details').status, 'declared', 'occupied entries prove a declaration exists')

  // A declaration accessor that throws is a runtime that cannot answer, not a
  // runtime that answered "nothing is declared for this key".
  const failing = createClientSlots({
    slots: {
      register() { return () => {} },
      inject() {},
      subscribe() {},
      entries: () => [],
      spec() { throw new Error('declaration source is broken') },
    },
  })
  assert.equal(failing.declaration('details').status, 'unavailable', 'a throwing declaration query is unknowable, never "missing"')
  assert.equal('spec' in failing.declaration('details'), false, 'a failed query contributes no official fact')
  assert.equal(failing.list('details').status, 'unavailable', 'the list view carries the same status')
})
