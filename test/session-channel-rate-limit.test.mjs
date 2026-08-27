import test from 'node:test'
import assert from 'node:assert/strict'
import { createRateLimiter } from '../lib/session-channel-rate-limit.js'
import { CODE_RATE_LIMITED } from '../lib/session-channel-shared.js'

test('rate limit: default bounds apply per method', () => {
  const limiter = createRateLimiter()
  // open has maxCalls 10 per 60s
  let last
  for (let i = 0; i < 10; i++) {
    last = limiter.check('open')
    assert.ok(last.ok, `call ${i + 1} must pass`)
  }
  const exceeded = limiter.check('open')
  assert.equal(exceeded.ok, false)
  assert.equal(exceeded.error.code, CODE_RATE_LIMITED)
})

test('rate limit: undefined method uses documented default, never fail-open', () => {
  const limiter = createRateLimiter()
  // observe default is 120 per 60s
  let exceeded
  for (let i = 0; i < 121; i++) {
    const r = limiter.check('observe')
    if (!r.ok) exceeded = r
  }
  assert.ok(exceeded, 'observe must be rate-limited after its default bound')
  assert.equal(exceeded.error.code, CODE_RATE_LIMITED)
})

test('rate limit: custom limits override defaults', () => {
  const limiter = createRateLimiter({ open: { windowMs: 60000, maxCalls: 2 } })
  assert.ok(limiter.check('open').ok)
  assert.ok(limiter.check('open').ok)
  const exceeded = limiter.check('open')
  assert.equal(exceeded.ok, false)
})

test('rate limit: windows reset after the window elapses', () => {
  const limiter = createRateLimiter({ open: { windowMs: 1, maxCalls: 1 } })
  assert.ok(limiter.check('open').ok)
  const exceeded = limiter.check('open')
  assert.equal(exceeded.ok, false)
  // Wait for the window to elapse
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.ok(limiter.check('open').ok, 'window must reset after elapse')
      resolve()
    }, 5)
  })
})

test('rate limit: reset clears windows', () => {
  const limiter = createRateLimiter({ open: { windowMs: 60000, maxCalls: 1 } })
  assert.ok(limiter.check('open').ok)
  assert.equal(limiter.check('open').ok, false)
  limiter.reset()
  assert.ok(limiter.check('open').ok, 'reset must clear the window')
})