import test from 'node:test'
import assert from 'node:assert/strict'
import {
  KNOWN_SESSION_EVENT_TYPES,
  isSurfaceEligibleType,
} from '@deepseek-ai/dsh-session'
import { createSessionTypeCatalogs } from '../lib/session-catalog.js'

test('sessionEventTypes agrees with the official known session log vocabulary', () => {
  const catalogs = createSessionTypeCatalogs({
    knownSessionEventTypes: KNOWN_SESSION_EVENT_TYPES,
    isSurfaceEligibleType,
  })

  assert.equal(catalogs.ok, true)
  assert.ok(Array.isArray(catalogs.sessionEventTypes))
  assert.ok(Object.isFrozen(catalogs.sessionEventTypes), 'sessionEventTypes must be frozen')
  assert.deepEqual(catalogs.sessionEventTypes, [...KNOWN_SESSION_EVENT_TYPES].sort())
  assert.ok(catalogs.sessionEventTypes.includes('session/end-seed'))
  assert.ok(catalogs.sessionEventTypes.includes('session/title'))
  assert.ok(!catalogs.sessionEventTypes.includes('session/created'))
  assert.ok(!catalogs.sessionEventTypes.includes('session/disposed'))
  assert.ok(!catalogs.sessionEventTypes.includes('session/event'))
  assert.ok(!catalogs.sessionEventTypes.includes('session/flush'))
})

test('surfaceEventTypes is exactly the official surface-eligible subset, sorted', () => {
  const catalogs = createSessionTypeCatalogs({
    knownSessionEventTypes: KNOWN_SESSION_EVENT_TYPES,
    isSurfaceEligibleType,
  })

  assert.deepEqual(catalogs.surfaceEventTypes, [
    'assistant/message',
    'tool/result',
    'user/message',
  ])
  assert.ok(Object.isFrozen(catalogs.surfaceEventTypes), 'surfaceEventTypes must be frozen')
  for (const type of catalogs.surfaceEventTypes) {
    assert.equal(isSurfaceEligibleType(type), true, `${type} must be surface-eligible`)
  }
})

test('type guards are total and correct', () => {
  const catalogs = createSessionTypeCatalogs({
    knownSessionEventTypes: KNOWN_SESSION_EVENT_TYPES,
    isSurfaceEligibleType,
  })

  for (const value of [null, undefined, 42, {}, [], false]) {
    assert.equal(catalogs.isSessionEventType(value), false, `isSessionEventType(${String(value)}) must be false`)
    assert.equal(catalogs.isSurfaceEventType(value), false, `isSurfaceEventType(${String(value)}) must be false`)
  }

  assert.equal(catalogs.isSessionEventType('user/message'), true)
  assert.equal(catalogs.isSessionEventType('session/end-seed'), true)
  assert.equal(catalogs.isSessionEventType('not-a-real-type'), false)

  assert.equal(catalogs.isSurfaceEventType('user/message'), true)
  assert.equal(catalogs.isSurfaceEventType('assistant/message'), true)
  assert.equal(catalogs.isSurfaceEventType('tool/result'), true)
  assert.equal(catalogs.isSurfaceEventType('turn/start'), false)
  assert.equal(catalogs.isSurfaceEventType('not-a-real-type'), false)
})

test('invalid inputs degrade to empty frozen catalogs and always-false guards', () => {
  const matrix = [
    {},
    { knownSessionEventTypes: null, isSurfaceEligibleType },
    { knownSessionEventTypes: ['user/message'], isSurfaceEligibleType },
    { knownSessionEventTypes: KNOWN_SESSION_EVENT_TYPES, isSurfaceEligibleType: null },
    { knownSessionEventTypes: KNOWN_SESSION_EVENT_TYPES },
  ]

  for (const input of matrix) {
    const catalogs = createSessionTypeCatalogs(input)
    assert.equal(catalogs.ok, false)
    assert.deepEqual(catalogs.sessionEventTypes, [])
    assert.deepEqual(catalogs.surfaceEventTypes, [])
    assert.ok(Object.isFrozen(catalogs.sessionEventTypes))
    assert.ok(Object.isFrozen(catalogs.surfaceEventTypes))
    for (const value of ['user/message', 'session/end-seed', null, undefined, 42]) {
      assert.equal(catalogs.isSessionEventType(value), false)
      assert.equal(catalogs.isSurfaceEventType(value), false)
    }
  }
})
