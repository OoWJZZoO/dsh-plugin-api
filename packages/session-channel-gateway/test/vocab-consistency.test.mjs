import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import * as gatewayVocab from '../lib/shared-vocab.js'
import * as mainVocab from '../../../lib/session-channel-shared.js'

test('gateway shared vocabulary: three copies are value-consistent', async () => {
  const mainKeys = Object.keys(mainVocab).sort()
  const pkgKeys = Object.keys(gatewayVocab).sort()
  assert.deepEqual(mainKeys, pkgKeys, 'main and gateway copy must export the same named keys')

  for (const key of mainKeys) {
    const mainVal = mainVocab[key]
    const pkgVal = gatewayVocab[key]
    if (typeof mainVal === 'function') {
      assert.equal(mainVal.toString(), pkgVal.toString(), `function ${key} must be byte-identical across copies`)
    } else {
      assert.deepEqual(mainVal, pkgVal, `value ${key} must be deep-equal across copies`)
    }
  }
})

test('gateway shared vocabulary: terminal outcomes are exactly five', () => {
  assert.equal(gatewayVocab.TERMINAL_OUTCOMES.length, 5)
})

test('gateway shared vocabulary: typed codes are exactly 16', () => {
  assert.equal(gatewayVocab.TYPED_CODES.length, 16)
})

test('gateway shared vocabulary: denied variants are four', () => {
  assert.equal(gatewayVocab.DENIED_VARIANTS.length, 4)
})

test('gateway shared vocabulary: consumption results are two', () => {
  assert.equal(gatewayVocab.CONSUMPTION_RESULTS.length, 2)
})