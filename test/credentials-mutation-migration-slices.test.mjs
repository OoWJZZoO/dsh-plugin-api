/**
 * Consumer migration slices for the controlled credential mutation face.
 *
 * The original consumer (`dsh-vision-toolkit`'s settings page) validates the
 * revision and ref in its own settings descriptor and then calls the official
 * `credentials.set` directly — the very seam the public contract removed. This
 * feature gives it one supported path: `pluginApi.credentials.set` /
 * `.unset`. The consumer repositories are not present in this workspace, so
 * each slice executes the call shapes those consumers will migrate to, against
 * the mounted facade and the real official provider.
 *
 * | slice | original consumer behavior | migrated public call | observed result |
 * |---|---|---|---|
 * | A | a settings page saves a user API key after validating its own descriptor | `credentials.set(ref, value, { expectedRevision })` plus the documented result-code branches | the key persists through the official provider, the page can render committed/unchanged/conflict/read-only truthfully, and the value never comes back |
 * | B | a provider plugin clears its key on teardown or on user request | `credentials.unset(ref)` | removal commits through the same authority, a repeat is the declared `unchanged`, and the official fallback hierarchy takes over |
 *
 * Non-functional, recorded instead of approximated: the consumer's own settings
 * descriptor, its UI components and its remote contract are not part of this
 * contract; the external repository is not migrated here (its migration is a
 * consumer-side change, no new release is required for this milestone).
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createHarness } from './credentials-mutation-test-kit.mjs'

const REF = 'DSH_VISION_TOOLKIT_KEY'

test('slice A: a settings page saves a key through the supported write path', async () => {
  const kit = await createHarness()
  try {
    const panel = await kit.caller('vision-toolkit-settings')
    const face = panel.credentials

    // First save: nothing observed yet, so the page submits without an
    // expectedRevision (the declared bootstrap rule) and renders the result.
    const first = await face.set(REF, 'user-api-key-1')
    assert.equal(first.code, 'committed')
    assert.equal(typeof first.revision, 'number', 'the page receives a revision to store for the next save')
    assert.equal(JSON.stringify(first).includes('user-api-key-1'), false)

    // Second save with the observed revision: an optimistic compare, not a
    // silent overwrite.
    const second = await face.set(REF, 'user-api-key-2', { expectedRevision: first.revision })
    assert.equal(second.code, 'committed')

    // Saving the same value again is the declared idempotent result.
    const repeat = await face.set(REF, 'user-api-key-2', { expectedRevision: second.revision })
    assert.equal(repeat.code, 'unchanged')

    // A stale revision (another surface saved in between) is refused with
    // bounded context and no value.
    const stale = await face.set(REF, 'user-api-key-3', { expectedRevision: first.revision })
    assert.equal(stale.code, 'conflict')
    assert.equal(typeof stale.currentRevision, 'number')
    assert.equal(JSON.stringify(stale).includes('user-api-key'), false)

    // The later provider read sees the saved key.
    assert.equal((await kit.resolveOfficial(REF)).value, 'user-api-key-2')
  } finally {
    await kit.cleanup()
  }
})

test('slice B: a provider plugin clears its key through the same authority', async () => {
  const kit = await createHarness()
  try {
    const plugin = await kit.caller('provider-plugin')
    const face = plugin.credentials
    await face.set(REF, 'user-api-key-1')

    const cleared = await face.unset(REF)
    assert.equal(cleared.code, 'committed')
    assert.equal(await kit.resolveOfficial(REF), undefined, 'the official resolution falls back after removal')

    const repeat = await face.unset(REF)
    assert.equal(repeat.code, 'unchanged', 'a repeat is the declared idempotent removal')
    assert.match(repeat.reason, /nothing to remove/)
  } finally {
    await kit.cleanup()
  }
})
