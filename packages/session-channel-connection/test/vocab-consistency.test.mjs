import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as mainVocab from '../../../lib/session-channel-shared.js'
import * as connVocab from '../lib/shared-vocab.js'

test('shared vocabulary: three copies are value-consistent', async () => {
  // Check that all named exports from the main copy are present in the
  // package copy with the same frozen values.
  const mainKeys = Object.keys(mainVocab).sort()
  const pkgKeys = Object.keys(connVocab).sort()
  assert.deepEqual(mainKeys, pkgKeys, 'main and package copy must export the same named keys')

  for (const key of mainKeys) {
    const mainVal = mainVocab[key]
    const pkgVal = connVocab[key]
    if (typeof mainVal === 'function') {
      // Function equality: same source text (they should be byte-identical).
      assert.equal(mainVal.toString(), pkgVal.toString(), `function ${key} must be byte-identical across copies`)
    } else {
      assert.deepEqual(mainVal, pkgVal, `value ${key} must be deep-equal across copies`)
    }
  }
})

test('shared vocabulary: terminal outcomes are exactly five', () => {
  assert.equal(mainVocab.TERMINAL_OUTCOMES.length, 5)
  assert.ok(mainVocab.TERMINAL_OUTCOMES.includes(mainVocab.TERMINAL_SUCCESS))
  assert.ok(mainVocab.TERMINAL_OUTCOMES.includes(mainVocab.TERMINAL_ERROR))
  assert.ok(mainVocab.TERMINAL_OUTCOMES.includes(mainVocab.TERMINAL_ABORTED))
  assert.ok(mainVocab.TERMINAL_OUTCOMES.includes(mainVocab.TERMINAL_DENIED))
  assert.ok(mainVocab.TERMINAL_OUTCOMES.includes(mainVocab.TERMINAL_SUPERSEDED))
})

test('shared vocabulary: typed codes are exactly 16', () => {
  assert.equal(mainVocab.TYPED_CODES.length, 16)
})

test('shared vocabulary: terminalOutcomeFor maps 1:1 without second category', () => {
  for (const code of mainVocab.TYPED_CODES) {
    const outcome = mainVocab.terminalOutcomeFor(code)
    assert.ok(mainVocab.TERMINAL_OUTCOMES.includes(outcome), `code ${code} maps to valid terminal outcome ${outcome}`)
  }
  // Denied variants map to denied
  for (const code of mainVocab.DENIED_VARIANTS) {
    assert.equal(mainVocab.terminalOutcomeFor(code), mainVocab.TERMINAL_DENIED)
  }
  // Superseded/aborted map 1:1
  assert.equal(mainVocab.terminalOutcomeFor(mainVocab.CODE_SUPERSEDED), mainVocab.TERMINAL_SUPERSEDED)
  assert.equal(mainVocab.terminalOutcomeFor(mainVocab.CODE_ABORTED), mainVocab.TERMINAL_ABORTED)
  // Everything else maps to error
  for (const code of mainVocab.TYPED_CODES) {
    if (mainVocab.DENIED_VARIANTS.includes(code)) continue
    if (code === mainVocab.CODE_SUPERSEDED || code === mainVocab.CODE_ABORTED) continue
    assert.equal(mainVocab.terminalOutcomeFor(code), mainVocab.TERMINAL_ERROR)
  }
})

test('shared vocabulary: typed helpers produce correct shapes', () => {
  const err = mainVocab.typedError(mainVocab.CODE_TIMEOUT, 'timed out', { elapsedMs: 5000 })
  assert.equal(err.ok, false)
  assert.equal(err.error.code, mainVocab.CODE_TIMEOUT)
  assert.equal(err.error.message, 'timed out')
  assert.equal(err.error.details.elapsedMs, 5000)

  const denied = mainVocab.typedDenied(mainVocab.CODE_DEVICE_DENIED, 'device not authorized')
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, mainVocab.CODE_DEVICE_DENIED)
  assert.equal(denied.error.message, 'device not authorized')

  const unavailable = mainVocab.typedUnavailable()
  assert.equal(unavailable.ok, false)
  assert.equal(unavailable.error.code, 'unavailable')
})

test('shared vocabulary: default rate limits cover all channel methods', () => {
  const methods = ['open', 'subscribe', 'ack', 'resume', 'revoke', 'observe']
  for (const method of methods) {
    const limit = mainVocab.DEFAULT_RATE_LIMITS[method]
    assert.ok(limit, `rate limit defined for ${method}`)
    assert.equal(typeof limit.windowMs, 'number')
    assert.equal(typeof limit.maxCalls, 'number')
    assert.ok(limit.maxCalls > 0)
  }
})

test('shared vocabulary: contract symbols are same references', () => {
  // Symbol.for returns the same symbol across modules
  assert.equal(mainVocab.CONTRACT_SYMBOL, Symbol.for('dsh-plugin-api.session-channel.contract'))
  assert.equal(mainVocab.CONNECTION_OWNER_SYMBOL, Symbol.for('dsh-plugin-api.session-channel-connection.contract'))
  assert.equal(mainVocab.GATEWAY_OWNER_SYMBOL, Symbol.for('dsh-plugin-api.session-channel-gateway.contract'))
})