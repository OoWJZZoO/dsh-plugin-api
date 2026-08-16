import test from 'node:test'
import assert from 'node:assert/strict'
import { deepFreeze, freezeByPolicy } from '../lib/deep-freeze.js'

test('deepFreeze freezes plain objects and arrays recursively', () => {
  const value = { a: { b: [1, 2, { c: 3 }] } }
  const out = deepFreeze(value)
  assert.equal(out, value)
  assert.ok(Object.isFrozen(value))
  assert.ok(Object.isFrozen(value.a))
  assert.ok(Object.isFrozen(value.a.b))
  assert.ok(Object.isFrozen(value.a.b[2]))
})

test('deepFreeze handles circular references without infinite recursion', () => {
  const value = { name: 'loop' }
  value.self = value
  const out = deepFreeze(value)
  assert.equal(out, value)
  assert.ok(Object.isFrozen(value))
})

test('deepFreeze short-circuits already frozen roots without re-traversing them', () => {
  const value = Object.freeze({ a: Object.freeze({ b: 1 }) })
  assert.doesNotThrow(() => deepFreeze(value))
  assert.ok(Object.isFrozen(value))

  // A proxy that counts ownKeys proves the short-circuit: Object.isFrozen
  // performs one ownKeys probe, but Object.keys must not run afterwards.
  const target = Object.freeze({ nested: Object.freeze({ ok: true }) })
  let ownKeysCalls = 0
  const proxy = new Proxy(target, {
    ownKeys(t) {
      ownKeysCalls += 1
      return Reflect.ownKeys(t)
    },
    getOwnPropertyDescriptor(t, key) {
      return Reflect.getOwnPropertyDescriptor(t, key)
    },
    isExtensible(t) {
      return Reflect.isExtensible(t)
    },
    get(t, key, receiver) {
      return Reflect.get(t, key, receiver)
    },
  })
  const out = deepFreeze(proxy)
  assert.equal(out, proxy)
  assert.equal(ownKeysCalls, 1, 'already-frozen object must not be re-walked')
})

test('deepFreeze returns functions and primitives unchanged', () => {
  const fn = () => {}
  assert.equal(deepFreeze(fn), fn)
  assert.equal(deepFreeze(42), 42)
  assert.equal(deepFreeze('x'), 'x')
  assert.equal(deepFreeze(null), null)
  assert.equal(deepFreeze(undefined), undefined)
})

test('deepFreeze never throws for exotic objects', () => {
  const exotic = { get x() { throw new Error('boom') } }
  // Freezing an object with a throwing getter must not break the caller.
  const out = deepFreeze(exotic)
  assert.equal(out, exotic)
})

test('freezeByPolicy with "all" behaves like deepFreeze', () => {
  const value = { a: { b: [1, { c: 3 }] } }
  const out = freezeByPolicy(value, 'all')
  assert.equal(out, value)
  assert.ok(Object.isFrozen(value))
  assert.ok(Object.isFrozen(value.a))
  assert.ok(Object.isFrozen(value.a.b))
  assert.ok(Object.isFrozen(value.a.b[1]))
})

test('freezeByPolicy with field policy shallow-freezes top level and deep-freezes only listed fields', () => {
  const value = {
    agent: { id: 'agent-1', status: 'running' },
    signal: { aborted: false },
    messages: [{ role: 'user', content: 'hi' }],
  }
  const out = freezeByPolicy(value, { deep: ['messages'] })
  assert.equal(out, value)
  assert.ok(Object.isFrozen(value), 'top-level payload is shallow frozen')
  assert.ok(!Object.isFrozen(value.agent), 'agent is not deep-frozen')
  assert.ok(!Object.isFrozen(value.signal), 'signal is not deep-frozen')
  assert.ok(Object.isFrozen(value.messages), 'messages array is deep-frozen')
  assert.ok(Object.isFrozen(value.messages[0]), 'message objects are deep-frozen')
})

test('freezeByPolicy with empty deep list shallow-freezes only the top level', () => {
  const value = { agent: { id: 'agent-1' }, turn: 1 }
  freezeByPolicy(value, { deep: [] })
  assert.ok(Object.isFrozen(value))
  assert.ok(!Object.isFrozen(value.agent), 'agent is not deep-frozen')
})

test('freezeByPolicy returns functions and primitives unchanged', () => {
  const fn = () => {}
  assert.equal(freezeByPolicy(fn, { deep: [] }), fn)
  assert.equal(freezeByPolicy(42, { deep: [] }), 42)
  assert.equal(freezeByPolicy('x', 'all'), 'x')
  assert.equal(freezeByPolicy(null, { deep: [] }), null)
  assert.equal(freezeByPolicy(undefined, 'all'), undefined)
})

test('freezeByPolicy never throws for exotic objects or missing fields', () => {
  const exotic = { get x() { throw new Error('boom') }, messages: [] }
  const out = freezeByPolicy(exotic, { deep: ['messages'] })
  assert.equal(out, exotic)

  const noField = { agent: {} }
  assert.doesNotThrow(() => freezeByPolicy(noField, { deep: ['missing'] }))
  assert.ok(Object.isFrozen(noField))
})

test('freezeByPolicy never throws for circular objects', () => {
  const value = { agent: {}, messages: [] }
  value.messages.push(value)
  const out = freezeByPolicy(value, { deep: ['messages'] })
  assert.equal(out, value)
  assert.ok(Object.isFrozen(value))
  assert.ok(Object.isFrozen(value.messages))
})
