/**
 * Shared-vocabulary consistency: the replacement package's copy of the
 * attention wire vocabulary must agree 1:1 with the main facade's copy
 * (`lib/attention-wire.js`) so the host hub and the forwarding slice speak
 * the same wire language.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as shared from '../lib/shared-vocab.js'
import * as mainWire from '../../../lib/attention-wire.js'

test('shared-vocab: wire vocabulary is 1:1 with the main facade copy', () => {
  assert.equal(shared.ATTENTION_UPDATE_EVENT, mainWire.ATTENTION_UPDATE_EVENT)
  assert.equal(shared.ATTENTION_SNAPSHOT, mainWire.ATTENTION_SNAPSHOT)
  assert.equal(shared.ATTENTION_DELTA, mainWire.ATTENTION_DELTA)
  assert.deepEqual([...shared.ATTENTION_KINDS], [...mainWire.ATTENTION_KINDS])
  assert.deepEqual([...shared.ATTENTION_OPS], [...mainWire.ATTENTION_OPS])
})

test('shared-vocab: marker symbols are fixed and neutral', () => {
  assert.equal(typeof shared.FORWARDER_OWNER_SYMBOL, 'symbol')
  assert.equal(typeof shared.ATTENTION_RECEIVER_SYMBOL, 'symbol')
  assert.equal(shared.OFFICIAL_ROW_ID, 'api-remotes')
  assert.equal(shared.OFFICIAL_OWNER_PACKAGE, '@deepseek-ai/dsh-api-remotes')
  assert.equal(shared.REPLACEMENT_ROW_ID, 'plugin-api-api-remotes')
  assert.match(shared.REPLACEMENT_PACKAGE_NAME, /^@deepseek-ai\/dsh-plugin-api-api-remotes$/)
})

test('per-stream audience trim agrees with the host payload trim semantics', async () => {
  const { trimItemForKind } = await import('../lib/attention-forwarder.js')
  const { buildRedactedItemPayload } = await import('../../../lib/attention-redaction.js')
  const cases = [
    { id: 'a', audience: 'all', title: 'x' },
    { id: 'b', audience: ['web'], title: 'y' },
    { id: 'c', audience: ['desktop'], title: 'z' },
  ]
  for (const item of cases) {
    for (const kind of ['web', 'desktop', 'tui', 'all']) {
      const ours = trimItemForKind(item, kind) !== null
      const reference = buildRedactedItemPayload(item, { kind }) !== null
      assert.equal(ours, reference, `trim disagreement for ${item.id} @ ${kind}`)
    }
  }
})