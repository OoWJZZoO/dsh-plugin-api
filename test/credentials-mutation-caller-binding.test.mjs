/**
 * Caller-binding regression for the credential mutation face, on real cordis
 * trees.
 *
 * `credentials.set`/`unset` derive their owner from the calling plugin's fiber,
 * which only works when cordis hands the accessing context to the namespace
 * accessor as its receiver — the `credentials` getter is method-style for
 * exactly that reason. Two independent plugin trees over the same official
 * credential document must attribute their writes to themselves, and a context
 * without plugin identity must be refused.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createHarness } from './credentials-mutation-test-kit.mjs'

const REF = 'DSH_SHARED_PROBE'

test('two trees over one credential document attribute each write to its own plugin', async () => {
  const first = await createHarness()
  let second = null
  try {
    second = await createHarness({ sharedDocument: first.documentPath })

    // Registration order A then B, action order reversed: B writes first.
    const a = await first.caller('CallerA')
    const b = await second.caller('CallerB')
    assert.notEqual(a.credentials, b.credentials, 'each caller receives its own materialized sub-surface')
    assert.deepEqual(Object.keys(a.credentials).sort(), ['availability', 'set', 'unset'])

    const written = await b.credentials.set(REF, 'from-b')
    assert.equal(written.code, 'committed')
    assert.equal(second.feature.authority.audit().records.at(-1).ownerId, 'CallerB', 'ownership is derived from the accessing plugin')

    const updated = await a.credentials.set(REF, 'from-a')
    assert.equal(updated.code, 'committed')
    assert.equal(first.feature.authority.audit().records.at(-1).ownerId, 'CallerA')
    assert.equal((await a.credentials.set(REF, 'from-a')).code, 'unchanged')

    // A context without plugin identity is refused typed and changes nothing.
    const anonymous = first.service._credentialsSlot.api.surfaceFor({})
    const denied = await anonymous.unset(REF)
    assert.equal(denied.code, 'denied')
    // Each tree keeps its own in-memory snapshot; the durable document is the
    // shared authority, and the denied write left it untouched.
    assert.match(await second.readDocument(), /from-a/, 'a denied write leaves the document alone')
  } finally {
    if (second) await second.cleanup()
    await first.cleanup()
  }
})
