import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SESSION_LIFECYCLE_EVENT_NAMES,
  sessionLifecycleEventsCatalog,
} from '../lib/session-events-catalog.js'

test('SESSION_LIFECYCLE_EVENT_NAMES contains exactly the four S1 lifecycle events', () => {
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
      subject: null,
      payload: 'Session',
      args: '(session)',
      source: 'S1',
      type: 'A',
    },
    'session/disposed': {
      mode: 'emit',
      scopeFiltered: true,
      subject: null,
      payload: 'Session',
      args: '(session)',
      source: 'S1',
      type: 'A',
    },
    'session/event': {
      mode: 'emit',
      scopeFiltered: true,
      subject: null,
      payload: 'Session, SessionEvent',
      args: '(session, event)',
      source: 'S1',
      type: 'A',
    },
    'session/flush': {
      mode: 'parallel',
      scopeFiltered: true,
      subject: null,
      payload: 'Session',
      args: '(session)',
      source: 'S1',
      type: 'A',
    },
  }

  for (const [name, entry] of Object.entries(expected)) {
    assert.equal(sessionLifecycleEventsCatalog[name].name, name)
    assert.deepEqual(
      {
        mode: sessionLifecycleEventsCatalog[name].mode,
        scopeFiltered: sessionLifecycleEventsCatalog[name].scopeFiltered,
        subject: sessionLifecycleEventsCatalog[name].subject,
        payload: sessionLifecycleEventsCatalog[name].payload,
        args: sessionLifecycleEventsCatalog[name].args,
        source: sessionLifecycleEventsCatalog[name].source,
        type: sessionLifecycleEventsCatalog[name].type,
      },
      entry,
    )
    assert.ok(Object.isFrozen(sessionLifecycleEventsCatalog[name]), `${name} entry must be frozen`)
  }
})
