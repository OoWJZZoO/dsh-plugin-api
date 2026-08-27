import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import * as mainVocab from '../lib/session-channel-shared.js'
import * as connVocab from '../packages/session-channel-connection/lib/shared-vocab.js'
import * as gatewayVocab from '../packages/session-channel-gateway/lib/shared-vocab.js'

test('all three copies of the shared vocabulary are value-consistent', async () => {
  const mainKeys = Object.keys(mainVocab).sort()
  const connKeys = Object.keys(connVocab).sort()
  const gatewayKeys = Object.keys(gatewayVocab).sort()
  assert.deepEqual(mainKeys, connKeys, 'main and connection copy export the same named keys')
  assert.deepEqual(mainKeys, gatewayKeys, 'main and gateway copy export the same named keys')

  for (const key of mainKeys) {
    const mainVal = mainVocab[key]
    for (const [label, vocab] of [['connection', connVocab], ['gateway', gatewayVocab]]) {
      const pkgVal = vocab[key]
      if (typeof mainVal === 'function') {
        assert.equal(mainVal.toString(), pkgVal.toString(), `function ${key} must be byte-identical in ${label} copy`)
      } else {
        assert.deepEqual(mainVal, pkgVal, `value ${key} must be deep-equal in ${label} copy`)
      }
    }
  }
})

test('vocabulary: terminal outcome vocabulary has no second category', () => {
  assert.equal(new Set(mainVocab.TERMINAL_OUTCOMES).size, 5)
  for (const code of mainVocab.TYPED_CODES) {
    const outcome = mainVocab.terminalOutcomeFor(code)
    assert.ok(mainVocab.TERMINAL_OUTCOMES.includes(outcome))
  }
})

test('vocabulary: symbol keys are identical strings across copies', () => {
  assert.equal(
    mainVocab.CONTRACT_SYMBOL,
    connVocab.CONTRACT_SYMBOL,
    'CONTRACT_SYMBOL is a shared Symbol.for registry entry',
  )
  assert.equal(mainVocab.CONNECTION_OWNER_SYMBOL, connVocab.CONNECTION_OWNER_SYMBOL)
  assert.equal(mainVocab.GATEWAY_OWNER_SYMBOL, gatewayVocab.GATEWAY_OWNER_SYMBOL)
})