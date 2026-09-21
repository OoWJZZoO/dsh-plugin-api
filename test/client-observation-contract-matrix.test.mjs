/**
 * Client observation contract matrix.
 *
 * The client half of the observation matrix: every client observation entry
 * answers the same frozen four-member handle contract — a discriminated
 * release, no-op subscriptions after release, a non-function listener that
 * never throws, and a read face that never throws — with and without the
 * attention runtime installed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { bootFixture, settleAll } from './official-passthrough-fixture.mjs'
import { apply } from '../lib/client-runtime.js'
import { createClientAttentionFace } from '../lib/client-attention-face.js'
import { createBrowserAttentionRuntime } from '../packages/client-runtime/lib/browser-runtime.js'

const HANDLE_MEMBERS = ['current', 'dispose', 'epoch', 'subscribe']

const assertObservationContract = (handle) => {
  assert.ok(Object.isFrozen(handle), 'the handle is frozen')
  for (const key of HANDLE_MEMBERS) assert.ok(key in handle, `the handle carries ${key}`)
  assert.equal(typeof handle.current, 'function')
  assert.equal(typeof handle.subscribe, 'function')
  assert.equal(typeof handle.dispose, 'function')
  const released = handle.dispose()
  assert.equal(released.ok, true, 'the first release is a success')
  assert.equal(released.code, 'revoked')
  const stale = handle.dispose()
  assert.equal(stale.ok, false, 'the second release is a typed no-op')
  assert.equal(stale.code, 'stale')
  assert.equal(typeof handle.subscribe(() => {}), 'function', 'subscribing after release is a no-op')
  assert.equal(typeof handle.subscribe('not-a-function'), 'function', 'a non-function listener never throws')
  assert.doesNotThrow(() => handle.current())
}

test('client observation matrix: attention.observe answers one contract with and without the runtime', async () => {
  // The runtime-absent path degrades to the same-shape kernel handle.
  const { ctx } = bootFixture()
  const dispose = apply(ctx)
  await settleAll()
  const degraded = ctx.get('pluginApi').attention.observe()
  assert.deepEqual(degraded.current(), [], 'the degraded read face is a frozen empty view')
  assertObservationContract(degraded)
  await dispose()

  // The installed path answers the same contract.
  const receive = { subscribe: () => () => {}, emit() {} }
  const runtime = createBrowserAttentionRuntime({ receive, send: null, fetchSnapshot: null, onReset: null })
  const face = createClientAttentionFace({ runtime })
  assertObservationContract(face.observe())
})

test('client observation matrix: slots / remotes / events / lifecycle answer the handle contract', async () => {
  const { ctx } = bootFixture()
  const dispose = apply(ctx)
  await settleAll()
  const api = ctx.get('pluginApi')

  assertObservationContract(api.slots.observe('slots/changed'))
  assert.throws(
    () => api.slots.observe('slots/other'),
    (error) => error.code === 'PLUGIN_API_SLOT_EVENT_INVALID_INPUT',
    'an unobservable slot event is a typed input error, never a bare TypeError',
  )

  assertObservationContract(api.remotes.observe('llm/adapters-updated'))
  assert.throws(
    () => api.remotes.observe('private/event'),
    (error) => error.code === 'PLUGIN_API_REMOTE_EVENT_NOT_FORWARDED',
    'a non-forwarded remote event is a typed input error, never a bare TypeError',
  )

  const envelope = api.events.observe('locale/change')
  assert.equal(envelope.ok, true)
  assert.equal(envelope.code, 'observed')
  assertObservationContract(envelope.handle)
  // The canonical subject is the same single argument the host entry takes:
  // `{ name }` and the bare event name are two forms of one subject.
  const canonical = api.events.observe({ name: 'locale/change' })
  assert.equal(canonical.ok, true)
  assert.equal(canonical.code, 'observed')
  assertObservationContract(canonical.handle)
  const unknown = api.events.observe('not-a-client-event')
  assert.equal(unknown.ok, false)
  assert.equal(unknown.code, 'unsupported')
  assert.ok(Array.isArray(unknown.names), 'the unknown-name result names the queryable directory')

  assertObservationContract(api.lifecycle.observe())
  await dispose()
})
