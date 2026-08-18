import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientSettingsRemote } from '../lib/client-settings-remote.js'

const contribution = { package: 'settings-panel', descriptors: [{ id: 'settings#get', service: 'settings', namespace: 'settings', method: 'get', invocation: { kind: 'direct' }, parameters: [], result: { mode: 'strict' } }] }
const codec = { validateInvocation(descriptor) { if (descriptor?.result?.mode !== 'strict') throw new TypeError('invalid') } }

test('settings remote reuses C2 mount owner and exposes the published face', async () => {
  let mounts = 0
  let disposals = 0
  const remote = { settings: { get() {} } }
  const api = createClientSettingsRemote({ remote, codec, remoteContribution: { async mountRemote(value) { mounts += 1; assert.equal(value, contribution); return () => { disposals += 1 } } } })
  const result = await api.mountRemoteContribution(contribution, { namespace: 'settings', render: (face) => face === remote.settings })
  assert.equal(result.status, 'active'); assert.equal(result.render, true); assert.equal(mounts, 1)
  assert.equal(await result.dispose(), true); assert.equal(await result.dispose(), false); assert.equal(disposals, 1)
})

test('settings remote returns a visible degraded result for host mismatch or absence', async () => {
  const api = createClientSettingsRemote({ remote: {}, codec, remoteContribution: { async mountRemote() { return () => {} } } })
  const missing = await api.mountRemoteContribution(contribution, { namespace: 'settings' })
  assert.equal(missing.status, 'degraded'); assert.equal(missing.reason, 'remote-unavailable'); assert.equal(typeof missing.dispose, 'function')
  assert.equal((await api.mountRemoteContribution({ package: 'x', descriptors: [] }, { namespace: 'settings' })).status, 'degraded')
})

test('settings remote rejects unvalidated descriptors and allows a disposed owner to remount', async () => {
  let mounts = 0
  const remote = { settings: { get() {} } }
  const api = createClientSettingsRemote({ remote, codec, remoteContribution: { async mountRemote() { mounts += 1; return () => {} } } })
  const invalid = await api.mountRemoteContribution({ ...contribution, descriptors: [{ ...contribution.descriptors[0], result: { mode: 'forged' } }] }, { namespace: 'settings' })
  assert.equal(invalid.status, 'degraded')
  const first = await api.mountRemoteContribution(contribution, { namespace: 'settings' })
  await first.dispose()
  const second = await api.mountRemoteContribution(contribution, { namespace: 'settings' })
  assert.equal(second.status, 'active')
  assert.equal(mounts, 2)
})

test('settings remote refuses a different active contribution with the same package', async () => {
  let mounts = 0
  const remote = { settings: { get() {}, set() {} } }
  const api = createClientSettingsRemote({ remote, codec, remoteContribution: { async mountRemote() { mounts += 1; return () => {} } } })
  const first = api.mountRemoteContribution(contribution, { namespace: 'settings' })
  const conflicting = await api.mountRemoteContribution({ ...contribution, descriptors: [{ ...contribution.descriptors[0], method: 'set' }] }, { namespace: 'settings' })
  assert.equal((await first).status, 'active')
  assert.equal(conflicting.status, 'degraded')
  assert.equal(conflicting.reason, 'duplicate-mount')
  assert.equal(mounts, 1)
})
