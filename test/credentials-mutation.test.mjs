/**
 * Unit acceptance for the credential mutation core module (harness-free).
 *
 * The module owns the declared result mapping, the preflight order, the
 * management-layer commit verification, the optimistic revision simulation
 * with its per-ref single-flight gate, the audit ring and the redaction
 * discipline. Everything here drives the authority through its seams; the
 * real-provider behaviour lives in the e2e file.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CREDENTIAL_AUDIT_CAPACITY,
  CREDENTIAL_REF_PATTERN,
  classifyWriteFailure,
  createCredentialAuditRing,
  createCredentialMutationAuthority,
} from '../lib/credentials-mutation.js'
import { PluginApiInactiveError } from '../lib/errors.js'

const REF = 'DSH_PROBE_KEY'

/** Official-shaped provider double with the four operations and switches. */
function harness(options = {}) {
  const calls = { set: 0, unset: 0, describe: 0, resolve: 0, owner: 0 }
  const state = {
    stored: { ...(options.stored ?? {}) },
    fallback: { ...(options.fallback ?? {}) },
    inherited: { ...(options.inherited ?? {}) },
  }
  const official = {
    async set(ref, value) {
      calls.set += 1
      if (options.setThrows) throw new Error(options.setThrows)
      if (options.setCommitsThenThrows) {
        state.stored[ref] = value
        throw new Error(options.setCommitsThenThrows)
      }
      if (options.setApplies !== false) state.stored[ref] = value
    },
    async unset(ref) {
      calls.unset += 1
      if (options.unsetThrows) throw new Error(options.unsetThrows)
      if (options.unsetCommitsThenThrows) {
        delete state.stored[ref]
        throw new Error(options.unsetCommitsThenThrows)
      }
      delete state.stored[ref]
    },
    async describe(ref) {
      calls.describe += 1
      if (options.describeThrows) throw new Error(options.describeThrows)
      if (state.inherited[ref] !== undefined) return { configured: true, source: 'env', writable: false }
      if (state.stored[ref] !== undefined) return { configured: true, source: 'file', writable: true }
      if (state.fallback[ref] !== undefined) return { configured: true, source: 'project-env', writable: true }
      return { configured: false, writable: true }
    },
    async resolve(ref) {
      calls.resolve += 1
      if (options.resolveThrows) throw new Error(options.resolveThrows)
      if (state.inherited[ref] !== undefined) return { value: state.inherited[ref], source: 'env' }
      if (state.stored[ref] !== undefined) return { value: state.stored[ref], source: 'file' }
      if (state.fallback[ref] !== undefined) return { value: state.fallback[ref], source: 'project-env' }
      return undefined
    },
  }
  const authority = createCredentialMutationAuthority({
    active: () => options.inactive !== true,
    resolveCredentials: () => (options.noService === true ? undefined : official),
    resolveOwnerId: () => {
      calls.owner += 1
      return options.owner === undefined ? 'plugin-a' : options.owner
    },
    logger: options.logger,
    clock: options.clock ?? (() => new Date('2026-01-01T00:00:00.000Z')),
    observeAvailable: options.observeAvailable ?? true,
  })
  return { authority, calls, state, official }
}

test('the ref pattern and the failure classifier follow the official contract', () => {
  assert.equal(CREDENTIAL_REF_PATTERN.test('DSH_PROBE_KEY'), true)
  assert.equal(CREDENTIAL_REF_PATTERN.test('1BAD'), false)
  assert.equal(CREDENTIAL_REF_PATTERN.test('bad-ref'), false)
  assert.equal(classifyWriteFailure('credentials-local is disposed: cannot set "X"'), 'unavailable')
  assert.equal(classifyWriteFailure('"X" is supplied read-only by the launching environment'), 'read-only')
  assert.equal(classifyWriteFailure('disk on fire'), 'internal')
})

test('the audit ring keeps metadata only, bounded and gap-marked', () => {
  const ring = createCredentialAuditRing({ capacity: 2 })
  assert.equal(CREDENTIAL_AUDIT_CAPACITY, 512)
  const first = ring.record({ ownerId: 'plugin-a', action: 'credential.set', ref: REF, outcome: 'attempt' })
  assert.equal(first.ok, true)
  assert.equal(first.record.ownerId, 'plugin-a')
  assert.equal(first.record.action, 'credential.set')
  assert.equal(first.record.ref, REF)
  assert.equal(first.record.outcome, 'attempt')
  assert.equal('reason' in first.record, false, 'a clean outcome carries no reason key')
  assert.equal('value' in first.record, false, 'the ring has no value field at all')
  ring.record({ ownerId: 'plugin-a', action: 'credential.set', ref: REF, outcome: 'committed' })
  ring.record({ ownerId: 'plugin-a', action: 'credential.unset', ref: REF, outcome: 'committed' })
  const view = ring.view()
  assert.equal(view.records.length, 2)
  assert.equal(view.truncated, true)
  assert.equal(view.gapSince, null)

  const hostile = Object.defineProperty({}, 'ref', { get() { throw new Error('boom') } })
  assert.equal(ring.record(hostile).ok, false)
  assert.equal(typeof ring.view().gapSince, 'string')

  const huge = 'X'.repeat(50000)
  const boundedRecord = ring.record({ ownerId: huge, action: 'credential.set', ref: huge, outcome: huge, reason: huge })
  assert.ok(boundedRecord.record.ref.length <= 240 && boundedRecord.record.reason.length <= 240)
})

test('set commits against the official seam and reports the observed revision', async () => {
  const { authority, calls, state } = harness()
  authority.observeUpdated(REF) // baseline revision 1
  const result = await authority.set(REF, 'v1', {}, {})
  assert.equal(result.ok, true)
  assert.equal(result.code, 'committed')
  assert.equal(result.commitState, 'success')
  assert.equal(result.ref, REF)
  assert.equal(result.revision, 1, 'the write itself does not advance the marker; the official fact does')
  assert.equal(calls.set, 1)
  assert.equal(state.stored[REF], 'v1')
  assert.deepEqual(authority.audit().records.map((record) => record.outcome), ['attempt', 'committed'])
})

test('the preflight refuses in the declared order before any side effect', async () => {
  const value = 'v1'
  const unavailable = harness({ noService: true })
  assert.equal((await unavailable.authority.set(REF, value, {}, {})).code, 'unavailable')

  const unowned = harness({ owner: null })
  assert.equal((await unowned.authority.set(REF, value, {}, {})).code, 'denied')
  assert.equal(unowned.calls.set, 0)

  const malformed = harness()
  assert.equal((await malformed.authority.set('bad-ref', value, {}, {})).code, 'invalid-input')
  assert.equal((await malformed.authority.set('1BAD', value, {}, {})).code, 'invalid-input')
  assert.equal((await malformed.authority.set(REF, '', {}, {})).code, 'invalid-input')
  assert.equal((await malformed.authority.set(REF, 42, {}, {})).code, 'invalid-input')
  assert.equal(malformed.calls.set, 0, 'no refusal reached the official seam')

  const shadowed = harness({ inherited: { [REF]: 'from-env' } })
  const readOnly = await shadowed.authority.set(REF, value, {}, {})
  assert.equal(readOnly.code, 'read-only')
  assert.match(readOnly.reason, /read-only/)
  assert.equal(shadowed.calls.set, 0, 'an env-shadowed ref never reaches the write seam')

  const describeFails = harness({ describeThrows: 'no describe' })
  assert.equal((await describeFails.authority.set(REF, value, {}, {})).code, 'unavailable')
  assert.equal(describeFails.calls.set, 0)
})

test('an unconfigured ref is writable: storing ahead of configuration is the official order', async () => {
  const { authority, calls } = harness()
  const result = await authority.set('DSH_FUTURE_KEY', 'v1', {}, {})
  assert.equal(result.code, 'committed')
  assert.equal(calls.set, 1)
})

test('same-value submissions are the declared idempotent result and skip the seam', async () => {
  const { authority, calls } = harness({ stored: { [REF]: 'v1' } })
  const result = await authority.set(REF, 'v1', {}, {})
  assert.equal(result.ok, false)
  assert.equal(result.code, 'unchanged')
  assert.equal(calls.set, 0, 'the official write seam is skipped')
  assert.equal(authority.audit().records.length, 0, 'a skip is not an attempt')

  // A fallback-layer value does not count as management storage.
  const fallback = harness({ fallback: { [REF]: 'v1' } })
  assert.equal((await fallback.authority.set(REF, 'v1', {}, {})).code, 'committed')
  assert.equal(fallback.calls.set, 1)
})

test('write failures keep the previous value and never report a fake commit', async () => {
  const { authority, calls, state } = harness({ stored: { [REF]: 'old' }, setThrows: 'disk on fire' })
  const result = await authority.set(REF, 'new', {}, {})
  assert.equal(result.code, 'internal')
  assert.equal(state.stored[REF], 'old', 'the previous value remains in effect')
  assert.equal(calls.set, 1)
  assert.equal(authority.audit().records.at(-1).outcome, 'internal')
})

test('a rejection after the write committed is verified against the management layer', async () => {
  // Committed then threw (the official observer invariant exception).
  const committed = harness({ setCommitsThenThrows: 'observer invariant' })
  const result = await committed.authority.set(REF, 'v1', {}, {})
  assert.equal(result.ok, true, 'the management layer proves the commit')
  assert.equal(result.code, 'committed')
  assert.equal(committed.state.stored[REF], 'v1')

  // The same value only in the fallback layer must never fake a commit.
  const fallbackOnly = harness({ fallback: { [REF]: 'v1' }, setThrows: 'disk on fire' })
  const fake = await fallbackOnly.authority.set(REF, 'v1', {}, {})
  assert.equal(fake.ok, false, 'a fallback value proves nothing about this write')
  assert.equal(fake.code, 'internal')

  // Committed removal then threw.
  const removed = harness({ stored: { [REF]: 'v1' }, unsetCommitsThenThrows: 'observer invariant' })
  const unset = await removed.authority.unset(REF, {}, {})
  assert.equal(unset.code, 'committed')
  assert.equal(removed.state.stored[REF], undefined)

  // Rejected without a commit: the previous value stays.
  const kept = harness({ stored: { [REF]: 'v1' }, unsetThrows: 'disk on fire' })
  const failed = await kept.authority.unset(REF, {}, {})
  assert.equal(failed.code, 'internal')
  assert.equal(kept.state.stored[REF], 'v1')
})

test('unset of an absent ref is the declared idempotent result', async () => {
  const { authority } = harness()
  const result = await authority.unset(REF, {}, {})
  assert.equal(result.ok, false)
  assert.equal(result.code, 'unchanged')
  assert.match(result.reason, /nothing to remove/)

  // A fallback-only ref is absent from managed storage too.
  const fallback = harness({ fallback: { [REF]: 'v1' } })
  assert.equal((await fallback.authority.unset(REF, {}, {})).code, 'unchanged')

  const managed = harness({ stored: { [REF]: 'v1' } })
  assert.equal((await managed.authority.unset(REF, {}, {})).code, 'committed')
  assert.equal(managed.state.stored[REF], undefined)
})

test('the optimistic compare refuses stale and unknown revisions, and the gate refuses races', async () => {
  const { authority, calls } = harness({ stored: { [REF]: 'v1' } })
  assert.equal((await authority.set(REF, 'v2', { expectedRevision: 1 }, {})).code, 'revision-unknown', 'no observed revision yet')

  authority.observeUpdated(REF) // revision 1
  const stale = await authority.set(REF, 'v2', { expectedRevision: 7 }, {})
  assert.equal(stale.code, 'conflict')
  assert.equal(stale.expectedRevision, 7)
  assert.equal(stale.currentRevision, 1)
  assert.equal('value' in stale, false, 'the conflict context never carries a value')

  // The bootstrap rule: no expectedRevision means the submit is allowed.
  assert.equal((await authority.set(REF, 'v2', {}, {})).code, 'committed')
  assert.equal(calls.set, 1)

  // A racing write for the same ref is refused while one is unsettled.
  const slow = harness({ stored: { [REF]: 'v1' } })
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const original = slow.official.set
  slow.official.set = async (ref, value) => { await gate; return original(ref, value) }
  const racing = slow.authority.set(REF, 'v2', {}, {})
  const refused = await slow.authority.set(REF, 'v3', {}, {})
  assert.equal(refused.code, 'conflict')
  assert.match(refused.reason, /racing write/)
  release()
  assert.equal((await racing).code, 'committed')
  assert.equal(slow.calls.set, 1, 'the refused race never reached the official seam')
})

test('a marker propagation failure invalidates the marker so stale revisions cannot match', async () => {
  const { authority } = harness({ stored: { [REF]: 'v1' } })
  authority.observeUpdated(REF) // revision 1
  assert.deepEqual({ ...authority.revisionOf(REF) }, { known: true, invalid: false, revision: 1 })

  authority.invalidateRevision(REF) // the declared propagation-failure outcome
  assert.deepEqual({ ...authority.revisionOf(REF) }, { known: false, invalid: true })

  const result = await authority.set(REF, 'v2', { expectedRevision: 1 }, {})
  assert.equal(result.code, 'revision-unknown', 'a stale marker must never "match"')
  assert.equal(result.ok, false)

  // Without an expectedRevision the bootstrap path still works and the
  // following official fact re-establishes the baseline.
  assert.equal((await authority.set(REF, 'v2', {}, {})).code, 'committed')
  assert.equal(authority.revisionOf(REF).invalid, true, 'a failed propagation keeps the marker invalid until the fact arrives')
})

test('revisions advance only through observed official facts', () => {
  const { authority } = harness()
  assert.deepEqual({ ...authority.revisionOf(REF) }, { known: false, invalid: false })
  authority.observeUpdated(REF)
  authority.observeUpdated(REF)
  assert.equal(authority.revisionOf(REF).revision, 2)
  authority.observeUpdated(undefined)
  assert.equal(authority.revisionOf(REF).revision, 2, 'a malformed fact is ignored')
})

test('availability reflects the write seam and the fact stream, and never throws', () => {
  assert.equal(harness().authority.availability().status, 'active')
  assert.equal(harness({ noService: true }).authority.availability().status, 'unavailable')
  assert.equal(harness({ observeAvailable: false }).authority.availability().status, 'degraded')
  assert.match(harness({ observeAvailable: false }).authority.availability().reason, /revision tracking/)

  const hostile = createCredentialMutationAuthority({
    active: () => true,
    resolveCredentials: () => { throw new Error('boom') },
    resolveOwnerId: () => 'plugin-a',
  })
  assert.equal(hostile.availability().status, 'unavailable')
})

test('the core-inactive gate is the single typed-throw path', async () => {
  const { authority } = harness({ inactive: true })
  await assert.rejects(() => authority.set(REF, 'v1', {}, {}), PluginApiInactiveError)
  await assert.rejects(() => authority.unset(REF, {}, {}), PluginApiInactiveError)
  assert.equal(authority.availability().status, 'active', 'availability never throws')
})

test('no credential value ever reaches a result, the audit or the diagnostics', async () => {
  const diagnostics = []
  const secret = 'sk-live-abcdefghijklmnopqrstuvwxyz0123456789'
  const { authority } = harness({
    stored: { [REF]: 'old' },
    setThrows: `disk failure while storing ${secret}`,
    logger: { warn: (message) => diagnostics.push(message) },
  })
  const failure = await authority.set(REF, secret, {}, {})
  assert.equal(JSON.stringify(failure).includes(secret), false, 'the result never carries the value')
  const records = authority.audit().records
  assert.equal(JSON.stringify(records).includes(secret), false, 'the audit never carries the value')
  assert.equal(diagnostics.some((message) => message.includes(secret)), false, 'diagnostics are redacted')

  const success = await harness().authority.set(REF, secret, {}, {})
  assert.equal(JSON.stringify(success).includes(secret), false)
})

test('submissions carrying the same expectedRevision resolve deterministically', async () => {
  const { authority, calls } = harness({ stored: { [REF]: 'v1' } })
  authority.observeUpdated(REF) // revision 1

  // First submission with the observed revision commits and settles.
  const first = await authority.set(REF, 'v2', { expectedRevision: 1 }, {})
  assert.equal(first.code, 'committed')
  assert.equal(calls.set, 1)

  // The same revision submitted again after settlement no longer matches: the
  // marker advanced with the official fact, so the second submission is a
  // typed conflict rather than a second commit.
  authority.observeUpdated(REF) // revision 2, as the official fact would
  const second = await authority.set(REF, 'v3', { expectedRevision: 1 }, {})
  assert.equal(second.code, 'conflict')
  assert.equal(second.currentRevision, 2)
  assert.equal(calls.set, 1, 'the losing submission never reached the official seam')
})

test('caller input never appears in a refusal result, bounded or otherwise', async () => {
  const secretRef = `sk-live-${'a'.repeat(60)}`
  const hugeRef = 'X'.repeat(50000)

  const noService = harness({ noService: true })
  const unavailable = await noService.authority.set(secretRef, 'v')
  assert.equal(unavailable.code, 'unavailable')
  assert.equal('ref' in unavailable, false, 'an unvalidated ref is never echoed')
  assert.equal(JSON.stringify(unavailable).includes('sk-live-'), false)

  const unowned = harness({ owner: null })
  const denied = await unowned.authority.set(hugeRef, 'v')
  assert.equal(denied.code, 'denied')
  assert.equal('ref' in denied, false)
  assert.equal(JSON.stringify(denied).length < 400, true, 'the refusal stays small')

  // A structurally valid but oversized ref is bounded before it can appear.
  const valid = harness()
  const boundedRef = await valid.authority.set(hugeRef, 'v')
  assert.notEqual(boundedRef.code, 'invalid-input')
  assert.ok(boundedRef.ref.length <= 240, 'a validated ref is bounded in the result')
})
