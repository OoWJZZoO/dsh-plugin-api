import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientSettingsRemote } from '../lib/client-settings-remote.js'

const contribution = { package: 'settings-panel', descriptors: [{ namespace: 'settings', result: { mode: 'strict' } }] }

test('settings remote reuses C2 mount owner and exposes the published face', async () => {
  let mounts = 0
  let disposals = 0
  const remote = { settings: { get() {} } }
  const api = createClientSettingsRemote({ remote, codec: {}, remoteContribution: { async mountRemote(value) { mounts += 1; assert.equal(value, contribution); return () => { disposals += 1 } } } })
  const result = await api.mountRemoteContribution(contribution, { namespace: 'settings', render: (face) => face === remote.settings })
  assert.equal(result.status, 'active'); assert.equal(result.render, true); assert.equal(mounts, 1)
  assert.equal(await result.dispose(), true); assert.equal(await result.dispose(), false); assert.equal(disposals, 1)
})

test('settings remote returns a visible degraded result for host mismatch or absence', async () => {
  const api = createClientSettingsRemote({ remote: {}, codec: {}, remoteContribution: { async mountRemote() { return () => {} } } })
  const missing = await api.mountRemoteContribution(contribution, { namespace: 'settings' })
  assert.equal(missing.status, 'degraded'); assert.equal(missing.reason, 'remote-unavailable'); assert.equal(typeof missing.dispose, 'function')
  assert.equal((await api.mountRemoteContribution({ package: 'x', descriptors: [] }, { namespace: 'settings' })).status, 'degraded')
})
