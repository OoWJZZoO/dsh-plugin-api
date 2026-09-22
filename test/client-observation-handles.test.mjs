/**
 * Client observation entries.
 *
 * Every client namespace that offers a subscription enters through `observe`
 * and answers the standard observation handle `{ current(), subscribe(listener),
 * dispose(), epoch }` — never a bare unsubscribe function, and never an
 * internal listener table. The handle is a subscription in its own right, so
 * `current()` is a real read face and a released handle stops delivering.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { bootFixture, settleAll } from './official-passthrough-fixture.mjs'
import { apply } from '../lib/client-runtime.js'

const HANDLE_MEMBERS = ['current', 'dispose', 'epoch', 'subscribe']

function isStandardHandle(value) {
  return value !== null && typeof value === 'object'
    && Object.isFrozen(value)
    && Object.keys(value).sort().join(',') === HANDLE_MEMBERS.join(',')
}

test('slots.observe answers the standard observation handle for the slot change channel', async () => {
  const { ctx } = bootFixture()
  const dispose = apply(ctx)
  const api = ctx.get('pluginApi')
  await settleAll()

  assert.throws(
    () => api.slots.observe('slots/other'),
    (error) => error.code === 'PLUGIN_API_SLOT_EVENT_INVALID_INPUT',
    'only the slot change channel is observable, refused as a typed input error',
  )
  const observation = api.slots.observe('slots/changed')
  assert.ok(isStandardHandle(observation), 'slots.observe answers the frozen four-member handle')
  assert.equal(observation.current(), undefined, 'nothing has changed yet')

  const seen = []
  const unsubscribe = observation.subscribe((key) => seen.push(key))
  ctx.emit('slots/changed', 'details')
  assert.deepEqual(seen, ['details'], 'the listener receives the changed key')
  assert.equal(observation.current(), 'details', 'current() reads the last changed key')

  unsubscribe()
  ctx.emit('slots/changed', 'other')
  assert.deepEqual(seen, ['details'], 'the released listener stops receiving')

  assert.equal(observation.dispose().ok, true)
  assert.equal(observation.dispose().ok, false, 'a second release is a no-op rather than a throw')
  ctx.emit('slots/changed', 'after-release')
  assert.equal(observation.current(), undefined, 'a released observation reports no current value')
  await dispose()
})

test('remotes.observe answers the standard observation handle and keeps the forwarded allowlist', async () => {
  const { ctx } = bootFixture()
  const dispose = apply(ctx)
  const api = ctx.get('pluginApi')
  await settleAll()

  assert.throws(
    () => api.remotes.observe('private/event'),
    (error) => error.code === 'PLUGIN_API_REMOTE_EVENT_NOT_FORWARDED',
    'a non-forwarded event is refused as a typed input error, not silently subscribed',
  )
  const observation = api.remotes.observe('llm/adapters-updated')
  assert.ok(isStandardHandle(observation), 'remotes.observe answers the frozen four-member handle')

  const seen = []
  const unsubscribe = observation.subscribe((payload) => seen.push(payload))
  ctx.get('remote').$dispatch('llm/adapters-updated', [{ adapters: [] }])
  assert.deepEqual(seen, [{ adapters: [] }])
  assert.deepEqual(observation.current(), { adapters: [] }, 'current() reads the last delivered payload')

  unsubscribe()
  assert.equal(observation.dispose().ok, true)
  await dispose()
})

test('lifecycle.observe answers the standard handle over the face set and its epoch follows the changes', async () => {
  const { ctx } = bootFixture()
  const dispose = apply(ctx)
  const api = ctx.get('pluginApi')
  await settleAll()

  const observation = api.lifecycle.observe()
  assert.ok(isStandardHandle(observation), 'lifecycle.observe answers the frozen four-member handle')
  assert.deepEqual(observation.current(), api.lifecycle.list(), 'current() reads the same face set as list()')
  const startingEpoch = observation.epoch

  const seen = []
  observation.subscribe((notification) => seen.push(notification))
  const handle = api.lifecycle.register({
    faceId: 'observed-face',
    scope: 'client',
    kind: 'settings',
    settingsScope: { namespace: 'observed', bind: () => ({ getSnapshot: () => ({}), subscribe: () => () => {}, set: () => {}, unset: () => {} }) },
    bind: () => () => {},
  })
  await settleAll()
  assert.equal(seen.length > 0, true, 'a face change reaches the observation')
  assert.equal(observation.current().length, 1, 'the current face set follows the registration')

  const later = api.lifecycle.observe()
  assert.equal(later.epoch > startingEpoch, true, 'a later observation reports a later epoch')

  handle.dispose()
  assert.equal(observation.dispose().ok, true)
  assert.deepEqual(observation.current(), [], 'a released observation reports no face set')
  await dispose()
})

test('a namespace without its official service refuses the observation instead of handing out a dead one', async () => {
  const withheld = new Set(['slots'])
  const { ctx } = bootFixture({
    override(context) {
      const get = context.get.bind(context)
      context.get = (name) => (withheld.has(name) ? undefined : get(name))
    },
  })
  const dispose = apply(ctx)
  const api = ctx.get('pluginApi')
  await settleAll()

  assert.equal(api.slots.availability().status, 'unavailable')
  assert.throws(() => api.slots.observe('slots/changed'), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED',
    'the observation is refused with the namespace typed state, never a silent dead handle')
  await dispose()
})

test('lifecycle.register answers a typed failure for an illegal declaration', async () => {
  const { ctx } = bootFixture()
  const dispose = apply(ctx)
  const api = ctx.get('pluginApi')
  await settleAll()
  const typed = (error) => error.code === 'PLUGIN_API_CLIENT_LIFECYCLE_INVALID_INPUT'
  assert.throws(() => api.lifecycle.register(), typed, 'a missing declaration')
  assert.throws(() => api.lifecycle.register(null), typed, 'a null declaration')
  assert.throws(() => api.lifecycle.register({}), typed, 'a declaration without faceId')
  assert.throws(() => api.lifecycle.register({ faceId: 'face', scope: 'client', kind: 'nope' }), typed, 'an unknown face kind')
  await dispose()
})
