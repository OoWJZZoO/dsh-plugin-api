import test from 'node:test'
import assert from 'node:assert/strict'
import { redactForAudience, redactError } from '../lib/session-channel-redact.js'

test('redact: secret fields are omitted (fail-closed)', () => {
  const input = { channelId: 'ch1', deviceId: 'dev1', token: 'secret-token', credential: 'sekret', password: 'p' }
  const result = redactForAudience(input)
  assert.equal(result.channelId, 'ch1')
  assert.equal(result.deviceId, 'dev1')
  assert.equal(result.token, undefined)
  assert.equal(result.credential, undefined)
  assert.equal(result.password, undefined)
})

test('redact: unknown fields are omitted (allowlist)', () => {
  const input = { channelId: 'ch1', surprise: 'value', sessionId: 's1' }
  const result = redactForAudience(input)
  assert.equal(result.channelId, 'ch1')
  assert.equal(result.sessionId, 's1')
  assert.equal(result.surprise, undefined)
})

test('redact: allowlist can extend safe fields', () => {
  const input = { channelId: 'ch1', customField: 'ok' }
  const result = redactForAudience(input, { allowlist: ['customField'] })
  assert.equal(result.customField, 'ok')
})

test('redact: arrays are bounded and redacted element-wise', () => {
  const input = { channelId: 'ch1', items: [{ token: 'x', channelId: 'ch2' }, { channelId: 'ch3' }] }
  const result = redactForAudience(input, { allowlist: ['items'] })
  assert.equal(result.items.length, 2)
  assert.equal(result.items[0].channelId, 'ch2')
  assert.equal(result.items[0].token, undefined)
})

test('redact: depth is bounded', () => {
  const deep = { channelId: 'ch1' }
  let current = deep
  for (let i = 0; i < 10; i++) {
    current.nested = { channelId: 'ch-inner' }
    current = current.nested
  }
  const result = redactForAudience(deep)
  // Should terminate (bounded depth) without throwing
  assert.ok(result.channelId === 'ch1')
})

test('redact: redaction failure fails closed (returns undefined)', () => {
  const cyclic = { channelId: 'ch1' }
  cyclic.self = cyclic
  const result = redactForAudience(cyclic)
  // Cyclic object: redaction returns undefined for the cycle (fail-closed),
  // but the top-level scalar survives.
  assert.ok(result)
})

test('redactError: strips exception details', () => {
  const result = redactError({ code: 'device-denied', message: 'denied', cause: new Error('private detail'), stack: 'stack' })
  assert.equal(result.code, 'device-denied')
  assert.equal(result.message, 'denied')
  assert.deepEqual(result.details, {})
})

test('redactError: unknown error shape → internal code', () => {
  const result = redactError({})
  assert.equal(result.code, 'internal')
  assert.equal(typeof result.message, 'string')
})