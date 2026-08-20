import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SESSION_LIFECYCLE_EVENT_NAMES,
  sessionLifecycleEventsCatalog,
} from '../lib/session-events-catalog.js'

test('SESSION_LIFECYCLE_EVENT_NAMES contains exactly the four lifecycle events', () => {
  assert.deepEqual([...SESSION_LIFECYCLE_EVENT_NAMES], [
    'session/created',
    'session/disposed',
    'session/event',
    'session/flush',
  ])
  assert.ok(Object.isFrozen(SESSION_LIFECYCLE_EVENT_NAMES), 'names array must be frozen')
})

test('sessionLifecycleEventsCatalog contains exactly four entries', () => {
  assert.deepEqual(Object.keys(sessionLifecycleEventsCatalog).sort(), [
    'session/created',
    'session/disposed',
    'session/event',
    'session/flush',
  ].sort())
  assert.ok(Object.isFrozen(sessionLifecycleEventsCatalog), 'catalog must be frozen')
})

test('each session lifecycle catalog entry matches the design matrix', () => {
  const expected = {
    'session/created': {
      mode: 'emit',
      scopeFiltered: true,
      scopeKey: null,
      fault: 'contain',
      freeze: 'all',
      payload: 'Session',
      args: '(session)',
    },
    'session/disposed': {
      mode: 'emit',
      scopeFiltered: true,
      scopeKey: null,
      fault: 'contain',
      freeze: 'all',
      payload: 'Session',
      args: '(session)',
    },
    'session/event': {
      mode: 'emit',
      scopeFiltered: true,
      scopeKey: null,
      fault: 'contain',
      freeze: 'all',
      payload: 'Session, SessionEvent',
      args: '(session, event)',
    },
    'session/flush': {
      mode: 'parallel',
      scopeFiltered: true,
      scopeKey: null,
      fault: 'contain',
      freeze: 'all',
      payload: 'Session',
      args: '(session)',
    },
  }

  for (const [name, entry] of Object.entries(expected)) {
    const actual = sessionLifecycleEventsCatalog[name]
    assert.equal(actual.name, name)
    assert.deepEqual(
      {
        mode: actual.mode,
        scopeFiltered: actual.scopeFiltered,
        scopeKey: actual.scopeKey,
        fault: actual.fault,
        freeze: actual.freeze,
        payload: actual.payload,
        args: actual.args,
      },
      entry,
    )
    assert.ok(!('source' in actual), `${name}: governance source ids must not leak`)
    assert.ok(!('type' in actual), `${name}: governance class letters must not leak`)
    assert.ok(Object.isFrozen(actual), `${name} entry must be frozen`)
  }
})
