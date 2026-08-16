import test from 'node:test'
import assert from 'node:assert/strict'
import { runFeatureGuard } from '../lib/guards.js'

function ctxWithSessions(sessions) {
  return {
    get(name) {
      if (name === 'sessions') return sessions
      return undefined
    },
  }
}

test('session guard passes when sessions.get/list/fork are functions', () => {
  const result = runFeatureGuard('session', ctxWithSessions({
    get() {},
    list() {},
    fork() {},
  }))

  assert.equal(result.ok, true)
  assert.equal(result.skipped, false)
  assert.deepEqual(result.problems, [])
})

test('session guard fails individually for missing get/list/fork', () => {
  const missing = runFeatureGuard('session', ctxWithSessions(undefined))
  assert.equal(missing.ok, false)
  assert.deepEqual(missing.problems.map((p) => p.name), ['sessions.get', 'sessions.list', 'sessions.fork'])

  const noGet = runFeatureGuard('session', ctxWithSessions({ list() {}, fork() {} }))
  assert.equal(noGet.ok, false)
  assert.deepEqual(noGet.problems.map((p) => p.name), ['sessions.get'])

  const noList = runFeatureGuard('session', ctxWithSessions({ get() {}, fork() {} }))
  assert.equal(noList.ok, false)
  assert.deepEqual(noList.problems.map((p) => p.name), ['sessions.list'])

  const noFork = runFeatureGuard('session', ctxWithSessions({ get() {}, list() {} }))
  assert.equal(noFork.ok, false)
  assert.deepEqual(noFork.problems.map((p) => p.name), ['sessions.fork'])
})

test('session guard never throws on a hostile ctx', () => {
  const result = runFeatureGuard('session', {
    get() {
      throw new Error('hostile get')
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.problems.length, 3)
})

test('unknown features still fail with the unknown-feature problem', () => {
  const result = runFeatureGuard('not-a-real-feature', ctxWithSessions({ get() {}, list() {}, fork() {} }))
  assert.equal(result.ok, false)
  assert.deepEqual(result.problems, [
    { name: 'feature', detail: 'unknown feature "not-a-real-feature"' },
  ])
})
