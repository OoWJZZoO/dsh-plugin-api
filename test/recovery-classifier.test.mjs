import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyFailure, isClassification } from '../lib/recovery-classifier.js'

test('classifier returns one bounded class with timeout as an error reason', () => {
  const value = classifyFailure({ code: 'timeout', detail: 'bounded detail' }, { source: 'tool-call', observedAt: '2026-08-25T00:00:00.000Z' })
  assert.equal(value.class, 'transient')
  assert.equal(value.outcome, 'error')
  assert.equal(value.reason.code, 'timeout')
  assert.equal(value.reason.boundedDetail, 'bounded detail')
  assert.equal(value.source.kind, 'tool-call')
  assert.equal(isClassification(value), true)
  assert.equal(Object.isFrozen(value), true)
  assert.equal(classifyFailure({ code: 'provider-error' }, { deadlineExpired: true }).reason.code, 'timeout')
})

test('abort and supersession signals override a late provider error', () => {
  assert.equal(classifyFailure({ class: 'permanent', code: 'provider-error' }, { aborted: true }).class, 'aborted')
  assert.equal(classifyFailure({ class: 'transient', code: 'provider-error' }, { superseded: true }).class, 'superseded')
  const controller = new AbortController()
  controller.abort()
  assert.equal(classifyFailure({ code: 'provider-error' }, { signal: controller.signal }).class, 'aborted')
})

test('missing and contradictory classifications produce bounded fail-closed markers', () => {
  const missing = classifyFailure(undefined, { observedAt: '2026-08-25T00:00:00.000Z' })
  assert.equal(missing.reason.code, 'classification-unavailable')
  const contradictory = classifyFailure({ class: 'transient', classification: 'permanent' })
  assert.equal(contradictory.reason.code, 'classification-contradictory')
  assert.equal(contradictory.reason.boundedDetail, undefined)
})

test('hostile getters and oversized details never throw or leak stack/cause text', () => {
  const hostile = {}
  Object.defineProperty(hostile, 'class', { get() { throw new Error('private') } })
  Object.defineProperty(hostile, 'detail', { get() { return 'x'.repeat(1000) } })
  const value = classifyFailure(hostile)
  assert.equal(isClassification(value), true)
  assert.ok((value.reason.boundedDetail?.length ?? 0) <= 160)
})
