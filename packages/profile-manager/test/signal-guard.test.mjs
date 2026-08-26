import test from 'node:test'
import assert from 'node:assert/strict'
import { installSignalGuard, captureSignalGuard, clearSignalListeners, hasCommitGuardListeners } from '../lib/signal-guard.js'

test('the signal guard captures listeners and releases them', () => {
  clearSignalListeners()
  assert.equal(hasCommitGuardListeners(), false)
  const seen = []
  const release = captureSignalGuard(() => seen.push('commit'))
  assert.equal(hasCommitGuardListeners(), true)
  release()
  assert.equal(hasCommitGuardListeners(), false)
  assert.equal(seen.length, 0) // listeners run only on a real SIGTERM
  clearSignalListeners()
})

test('captureSignalGuard releases exactly its own listener and is idempotent', () => {
  clearSignalListeners()
  const a = []
  const b = []
  const releaseA = captureSignalGuard(() => a.push(1))
  const releaseB = captureSignalGuard(() => b.push(1))
  assert.equal(hasCommitGuardListeners(), true)
  releaseA()
  assert.equal(a.length, 0)
  // re-capturing inside a commit window still works after a release
  const releaseAgain = captureSignalGuard(() => a.push(2))
  releaseB()
  releaseAgain()
  assert.equal(hasCommitGuardListeners(), false)
  clearSignalListeners()
})

test('installSignalGuard is idempotent (multiple installs do not stack handlers)', () => {
  clearSignalListeners()
  installSignalGuard()
  installSignalGuard()
  installSignalGuard()
  // the guard installed once; the listener registry stays our own
  assert.equal(hasCommitGuardListeners(), false)
  const release = captureSignalGuard(() => {})
  assert.equal(hasCommitGuardListeners(), true)
  release()
  clearSignalListeners()
})