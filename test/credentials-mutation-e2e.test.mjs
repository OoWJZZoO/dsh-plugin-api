/**
 * End-to-end acceptance for the controlled credential mutation face
 * (`credentials.set` / `credentials.unset`) through the public facade only.
 *
 * The harness mounts the **real** official file-backed provider over a
 * temporary document, so "success means real persistence" and the failure
 * paths (read-only document, absent refs, hierarchy) are exercised against the
 * real write chain rather than a double.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { stat, writeFile } from 'node:fs/promises'

import { createHarness } from './credentials-mutation-test-kit.mjs'

const REF = 'DSH_PROBE_KEY'

test('a committed set persists through the real provider and reads back', async () => {
  const kit = await createHarness()
  try {
    const caller = await kit.caller('CallerA')
    assert.equal(caller.credentials.availability().status, 'active')

    const result = await caller.credentials.set(REF, 'secret-value-1')
    assert.equal(result.ok, true)
    assert.equal(result.code, 'committed')
    assert.equal(result.commitState, 'success')
    assert.equal(result.ref, REF)
    assert.equal(typeof result.revision, 'number')
    assert.equal(JSON.stringify(result).includes('secret-value-1'), false, 'the result never echoes the value')

    const official = await kit.resolveOfficial(REF)
    assert.deepEqual({ value: official.value, source: official.source }, { value: 'secret-value-1', source: 'file' })
    const document = await kit.readDocument()
    assert.match(document, /DSH_PROBE_KEY: secret-value-1/)
    assert.equal(kit.dispatches.filter((ref) => ref === REF).length >= 1, true, 'the official fact was dispatched')

    // Update: a second committed write replaces the stored value.
    const updated = await caller.credentials.set(REF, 'secret-value-2')
    assert.equal(updated.code, 'committed')
    assert.equal(updated.revision > result.revision, true, 'the observed revision advanced with the official fact')
    assert.equal((await kit.resolveOfficial(REF)).value, 'secret-value-2')
  } finally {
    await kit.cleanup()
  }
})

test('the management layer governs idempotency and the fallback hierarchy', async () => {
  const kit = await createHarness()
  try {
    const caller = await kit.caller('CallerA')
    await caller.credentials.set(REF, 'v1')

    const repeat = await caller.credentials.set(REF, 'v1')
    assert.equal(repeat.code, 'unchanged', 'the same value is the declared idempotent result')
    assert.equal(kit.dispatches.filter((ref) => ref === REF).length, 1, 'no duplicate change fact was dispatched')

    const removed = await caller.credentials.unset(REF)
    assert.equal(removed.code, 'committed')
    assert.equal(await kit.resolveOfficial(REF), undefined, 'the official resolution follows the fallback hierarchy')

    const again = await caller.credentials.unset(REF)
    assert.equal(again.code, 'unchanged')
    assert.match(again.reason, /nothing to remove/)
  } finally {
    await kit.cleanup()
  }
})

test('a ref supplied by the launching environment is refused as read-only before the seam', async () => {
  const kit = await createHarness()
  try {
    const caller = await kit.caller('CallerA')
    // The inherited process environment is the read-only winning layer.
    const ref = 'DSH_INHERITED_PROBE'
    const previous = process.env[ref]
    process.env[ref] = 'from-env'
    try {
      const result = await caller.credentials.set(ref, 'v1')
      assert.equal(result.code, 'read-only')
      assert.equal(JSON.stringify(result).includes('from-env'), false)
      assert.equal(await kit.readDocument(), null, 'no document was written')
    } finally {
      if (previous === undefined) delete process.env[ref]
      else process.env[ref] = previous
    }
  } finally {
    await kit.cleanup()
  }
})

test('a write failure keeps the previous value and reports honestly', async () => {
  const kit = await createHarness({ seedDocument: 'DSH_PROBE_KEY: original\n' })
  try {
    const caller = await kit.caller('CallerA')
    assert.equal((await kit.resolveOfficial(REF)).value, 'original')

    // Inject a failing official write seam: the failure must be typed, the
    // value must stay, and nothing may be reported as committed.
    const provider = kit.root.credentials
    const originalSet = provider.set.bind(provider)
    provider.set = async () => { throw new Error('injected backend failure') }
    const failed = await caller.credentials.set(REF, 'replacement')
    assert.equal(failed.ok, false)
    assert.equal(failed.code, 'internal')
    assert.equal(JSON.stringify(failed).includes('replacement'), false, 'the failure never echoes the value')
    assert.equal((await kit.resolveOfficial(REF)).value, 'original', 'the previous value remains in effect')
    assert.match(await kit.readDocument(), /original/, 'the document keeps the previous value')

    // The face stays usable once the backend recovers.
    provider.set = originalSet
    const recovered = await caller.credentials.set(REF, 'replacement')
    assert.equal(recovered.code, 'committed')
    assert.equal((await kit.resolveOfficial(REF)).value, 'replacement')
  } finally {
    await kit.cleanup()
  }
})

test('conflicts are explicit: stale revisions are refused and racing writes cannot interleave', async () => {
  const kit = await createHarness()
  try {
    const caller = await kit.caller('CallerA')
    assert.equal((await caller.credentials.set(REF, 'v1', { expectedRevision: 1 })).code, 'revision-unknown', 'no observed revision yet')

    const first = await caller.credentials.set(REF, 'v1')
    const observed = first.revision
    const stale = await caller.credentials.set(REF, 'v2', { expectedRevision: observed + 5 })
    assert.equal(stale.code, 'conflict')
    assert.equal('value' in stale, false, 'the conflict context carries no value')

    const fresh = await caller.credentials.set(REF, 'v2', { expectedRevision: observed })
    assert.equal(fresh.code, 'committed')
    assert.equal((await kit.resolveOfficial(REF)).value, 'v2')
  } finally {
    await kit.cleanup()
  }
})

test('two independent trees with reverse registration order own their writes', async () => {
  const kit = await createHarness()
  try {
    const a = await kit.caller('CallerA')
    const b = await kit.caller('CallerB')
    assert.notEqual(a.credentials, b.credentials, 'each caller receives its own materialized sub-surface')

    const first = await b.credentials.set(REF, 'from-b')
    assert.equal(first.code, 'committed')
    const owners = kit.feature.authority.audit().records.map((record) => record.ownerId)
    assert.equal(owners.includes('CallerB'), true, 'ownership is derived from the accessing plugin')

    const second = await a.credentials.set(REF, 'from-a')
    assert.equal(second.code, 'committed')
    assert.equal((await kit.resolveOfficial(REF)).value, 'from-a')
    assert.equal(kit.feature.authority.audit().records.at(-1).ownerId, 'CallerA')

    // A caller context with no plugin identity is refused typed.
    const anonymous = kit.service._credentialsSlot.api.surfaceFor({})
    const denied = await anonymous.set(REF, 'from-nobody')
    assert.equal(denied.code, 'denied')
    assert.equal((await kit.resolveOfficial(REF)).value, 'from-a', 'a denied write changes nothing')
  } finally {
    await kit.cleanup()
  }
})

test('no declared outlet carries the credential value', async () => {
  const kit = await createHarness()
  try {
    const caller = await kit.caller('CallerA')
    const secret = 'sk-live-abcdefghijklmnopqrstuvwxyz0123456789'
    const committed = await caller.credentials.set(REF, secret)
    const unchanged = await caller.credentials.set(REF, secret)

    const surfaces = [
      committed,
      unchanged,
      caller.credentials.availability(),
      kit.service.capabilities.get('credentials'),
      kit.feature.authority.audit(),
      kit.feature.authority.inspection(),
    ]
    for (const surface of surfaces) {
      assert.equal(JSON.stringify(surface).includes(secret), false, 'no outlet serializes the value')
    }
    const document = await kit.readDocument()
    assert.equal(document.includes(secret), true, 'the official store is the only holder of the value')

    // A malformed request and an empty value are refused before any side
    // effect, and the durable document stays exactly as it was.
    const documentBefore = await kit.readDocument()
    const malformed = await caller.credentials.set('bad-ref', secret)
    assert.equal(malformed.code, 'invalid-input')
    assert.equal(JSON.stringify(malformed).includes(secret), false)
    const empty = await caller.credentials.set(REF, '')
    assert.equal(empty.code, 'invalid-input')
    assert.equal(JSON.stringify(empty).includes(secret), false)
    assert.equal(await kit.readDocument(), documentBefore, 'no refusal touched the document')
    assert.equal((await caller.credentials.unset('bad-ref')).code, 'invalid-input')
    const mode = (await stat(kit.documentPath)).mode & 0o777
    assert.equal(mode, 0o600, 'the official document keeps its owner-only mode')
  } finally {
    await kit.cleanup()
  }
})

test('a document changed outside the facade is refused by a stale expectedRevision', async () => {
  const kit = await createHarness()
  try {
    const caller = await kit.caller('CallerA')
    const initial = await caller.credentials.set(REF, 'v1')

    // An external edit (another process, the user's editor) reaches the facade
    // as an official `credentials/updated` fact (the provider hot-publishes it;
    // here the same fact is delivered directly so the scenario does not depend
    // on watcher timing). The caller's now-stale marker must not silently
    // overwrite the edit.
    await writeFile(kit.documentPath, 'DSH_PROBE_KEY: edited-outside\n', { mode: 0o600 })
    kit.feature.authority.observeUpdated(REF)
    const stale = await caller.credentials.set(REF, 'v2', { expectedRevision: initial.revision })
    assert.equal(stale.code, 'conflict', 'the facade refuses to overwrite an externally changed ref')
    assert.match(await kit.readDocument(), /edited-outside/, 'the refused write left the durable document untouched')

    // Re-reading the current revision and retrying deliberately succeeds.
    const current = kit.feature.authority.revisionOf(REF).revision
    assert.equal((await caller.credentials.set(REF, 'v2', { expectedRevision: current })).code, 'committed')
  } finally {
    await kit.cleanup()
  }
})

test('a rejection after the write committed is reported as committed (real chain)', async () => {
  const kit = await createHarness({ invariantListener: true })
  try {
    const caller = await kit.caller('CallerA')
    // The official observer invariant listener makes the write promise reject
    // after the document was already committed.
    const result = await caller.credentials.set(REF, 'committed-then-threw')
    assert.equal(result.ok, true, 'the management layer proves the commit')
    assert.equal(result.code, 'committed')
    assert.match(await kit.readDocument(), /committed-then-threw/, 'the value really persisted')
    assert.equal((await kit.resolveOfficial(REF)).value, 'committed-then-threw')

    const removal = await caller.credentials.unset(REF)
    assert.equal(removal.code, 'committed', 'the removal committed even though the observer failed')
    assert.equal(await kit.resolveOfficial(REF), undefined)
  } finally {
    await kit.cleanup()
  }
})

test('racing submissions carrying the same expectedRevision are decided deterministically', async () => {
  const kit = await createHarness()
  try {
    const caller = await kit.caller('CallerA')
    const first = await caller.credentials.set(REF, 'v1')
    const observed = first.revision

    // Two submissions in one synchronous span with the same observed revision:
    // the first holds the per-ref gate, the second is refused typed.
    const racing = caller.credentials.set(REF, 'v2', { expectedRevision: observed })
    const refused = await caller.credentials.set(REF, 'v3', { expectedRevision: observed })
    assert.equal(refused.code, 'conflict')
    assert.match(refused.reason, /racing write/)
    const settled = await racing
    assert.equal(settled.code, 'committed')
    assert.equal((await kit.resolveOfficial(REF)).value, 'v2', 'the winner is the first submission')
  } finally {
    await kit.cleanup()
  }
})

test('a missing write seam degrades this feature alone', async () => {
  const kit = await createHarness({ noProvider: true })
  try {
    const caller = await kit.caller('CallerA')
    assert.equal(caller.credentials.availability().status, 'unavailable')
    const refused = await caller.credentials.set(REF, 'v1')
    assert.equal(refused.code, 'unavailable')
    assert.equal((await caller.credentials.unset(REF)).code, 'unavailable')
    // Unrelated capabilities keep working.
    assert.equal(typeof kit.root.pluginApi.tools.register, 'function')
    assert.equal(typeof kit.root.pluginApi.capabilities.get('tools').status, 'string')
  } finally {
    await kit.cleanup()
  }
})
