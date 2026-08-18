import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientRemoteContribution } from '../lib/client-remote-contribution.js'

const contribution = { package: 'example', descriptors: [{ id: 'example#settings/get', service: 'settings', namespace: 'settings', method: 'get' }] }

test('remote contribution validates then mounts once and preserves official disposer ownership', async () => {
  let mounts = 0
  let disposals = 0
  const remote = { async $mount(value) { mounts += 1; assert.equal(value, contribution); this.settings = {}; return () => { disposals += 1 } } }
  const api = createClientRemoteContribution({ remote })
  const first = api.mountRemote(contribution)
  const second = api.mountRemote(contribution)
  assert.equal(first, second)
  const dispose = await first
  assert.equal(mounts, 1)
  assert.equal(await dispose(), true)
  assert.equal(await dispose(), false)
  assert.equal(disposals, 1)
})

test('malformed and mismatched faces fail without publishing an owner', async () => {
  const remote = { async $mount() { return () => {} } }
  const api = createClientRemoteContribution({ remote })
  assert.throws(() => api.mountRemote({ package: '', descriptors: [] }), /package/)
  await assert.rejects(() => api.mountRemote(contribution), /did not publish namespace/)
})
