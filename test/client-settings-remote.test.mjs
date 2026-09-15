/**
 * Client `settings.remote.contribute` answers the contribution idiom: a frozen
 * discriminated result plus a pending handle whose `status()` reports the
 * settlement, with the mounted `face` and its `render` projection as lazily
 * resolved domain members.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientSettingsRemote } from '../lib/client-settings-remote.js'

const contribution = { package: 'settings-panel', descriptors: [{ id: 'settings#get', service: 'settings', namespace: 'settings', method: 'get', invocation: { kind: 'direct' }, parameters: [], result: { mode: 'strict' } }] }
const codec = { validate(descriptor) { if (descriptor?.result?.mode !== 'strict') throw new TypeError('invalid') } }

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('settings remote reuses the remote mount owner and exposes the published face', async () => {
  let mounts = 0
  let disposals = 0
  const remote = { settings: { get() {} } }
  const api = createClientSettingsRemote({ remote, codec, remoteContribution: { async mountRemote(value) { mounts += 1; assert.equal(value, contribution); return () => { disposals += 1 } } } })
  const result = api.contribute(contribution, { namespace: 'settings', render: (face) => face === remote.settings })

  assert.equal(result.ok, true)
  assert.equal(result.code, 'contributed')
  assert.equal(result.handle.status().state, 'pending', 'the mount is asynchronous, so the handle starts pending')
  assert.equal(result.handle.face, undefined, 'the face is not published before the settlement')
  assert.ok(Object.isFrozen(result.handle))

  await settle()
  assert.equal(result.handle.status().state, 'active')
  assert.equal(result.handle.face, remote.settings)
  assert.equal(result.handle.render, true, 'the render projection is resolved from the mounted face')
  assert.equal(mounts, 1)

  assert.equal(result.handle.dispose().code, 'revoked')
  assert.equal(result.handle.dispose().code, 'stale')
  assert.equal(result.handle.face, undefined, 'a revoked handle publishes no face')
  assert.equal(disposals, 1)
})

test('an unmountable or mismatched host leaves an observable failed state, never a silent success', async () => {
  const api = createClientSettingsRemote({ remote: {}, codec, remoteContribution: { async mountRemote() { return () => {} } } })
  const missing = api.contribute(contribution, { namespace: 'settings' })
  assert.equal(missing.ok, true)
  await settle()
  const failed = missing.handle.status()
  assert.equal(failed.state, 'failed')
  assert.match(failed.reason, /settings/)
  assert.equal(missing.handle.face, undefined)
  assert.equal(missing.handle.dispose().code, 'stale', 'a contribution that never took effect is a typed stale no-op')
})

test('invalid input, descriptor mismatch and duplicate mounts are typed failures', () => {
  const api = createClientSettingsRemote({ remote: { settings: { get() {} } }, codec, remoteContribution: { async mountRemote() { return () => {} } } })

  assert.equal(api.contribute({ package: 'x', descriptors: [] }, { namespace: 'settings' }).code, 'invalid-input')
  assert.equal(api.contribute({ ...contribution, descriptors: [{ ...contribution.descriptors[0], result: { mode: 'forged' } }] }, { namespace: 'settings' }).code, 'invalid-input')
  assert.equal(api.contribute(contribution, { namespace: 'other' }).code, 'invalid-input')

  const first = api.contribute(contribution, { namespace: 'settings' })
  const conflicting = api.contribute({ ...contribution, descriptors: [{ ...contribution.descriptors[0], method: 'set' }] }, { namespace: 'settings' })
  assert.equal(conflicting.ok, false)
  assert.equal(conflicting.code, 'conflict')
  const same = api.contribute(contribution, { namespace: 'settings' })
  assert.equal(same.handle, first.handle, 'the same mount answers the same handle instead of mounting twice')
})

test('an unavailable remote mount owner answers a typed unavailable code', () => {
  const api = createClientSettingsRemote({})
  assert.equal(api.isActive, false)
  const result = api.contribute(contribution, { namespace: 'settings' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'unavailable')
})

test('a contribution withdrawn while its mount is pending is rolled back, not resurrected', async () => {
  let mounts = 0
  let disposals = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const remote = { settings: { get() {} } }
  const api = createClientSettingsRemote({ remote, codec, remoteContribution: { async mountRemote() { mounts += 1; await gate; return () => { disposals += 1 } } } })

  const pending = api.contribute(contribution, { namespace: 'settings' })
  assert.equal(pending.handle.status().state, 'pending')
  assert.equal(pending.handle.dispose().code, 'revoked', 'withdrawing before the settlement is a safe revoke')
  assert.equal(pending.handle.status().state, 'revoked')

  release()
  await settle()
  await settle()
  assert.equal(disposals, 1, 'the committed mount is cleaned up exactly once')
  assert.equal(pending.handle.face, undefined, 'a withdrawn contribution never publishes its face')
  assert.equal(mounts, 1)
})

test('disposing the whole adapter releases every mounted contribution', async () => {
  let disposals = 0
  const remote = { settings: { get() {} } }
  const api = createClientSettingsRemote({ remote, codec, remoteContribution: { async mountRemote() { return () => { disposals += 1 } } } })
  const result = api.contribute(contribution, { namespace: 'settings' })
  await settle()
  assert.equal(result.handle.status().state, 'active')
  await api.dispose()
  assert.equal(disposals, 1)
  assert.equal(result.handle.status().state, 'active', 'the handle state is the contribution lifecycle, not the adapter lifetime')
})
