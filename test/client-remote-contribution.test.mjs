import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientRemoteContribution } from '../lib/client-remote-contribution.js'

const strict = { mode: 'strict', typeSymbol: 'example.Json', schema: { parse(value) { return value } } }
const contribution = { package: 'example', descriptors: [{ id: 'example#settings/get', service: 'settings', namespace: 'settings', method: 'get', invocation: { kind: 'direct' }, parameters: [], result: strict }] }

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
  const replacement = await api.mountRemote(contribution)
  assert.equal(mounts, 2)
  await replacement()
})

test('malformed and mismatched faces fail without publishing an owner', async () => {
  const remote = { async $mount() { return () => {} } }
  const api = createClientRemoteContribution({ remote })
  assert.throws(() => api.mountRemote({ package: '', descriptors: [] }), /package/)
  await assert.rejects(() => api.mountRemote(contribution), /did not publish namespace/)
})

test('post-mount face validation rolls back the official disposer', async () => {
  let disposals = 0
  const api = createClientRemoteContribution({ remote: { async $mount() { return () => { disposals += 1 } } } })
  await assert.rejects(() => api.mountRemote(contribution), /did not publish namespace/)
  assert.equal(disposals, 1)
})

test('rejects descriptor shapes outside the official invocation contract', () => {
  const api = createClientRemoteContribution({ remote: { async $mount() { return () => {} } } })
  assert.throws(() => api.mountRemote({ package: 'example', descriptors: [{ ...contribution.descriptors[0], result: { mode: 'strict' } }] }), /malformed/)
  assert.throws(() => api.mountRemote({ package: 'example', descriptors: [{ ...contribution.descriptors[0], parameters: [{ name: 'input', wire: 'input', source: 'json', codec: { mode: 'strict' } }] }] }), /malformed/)
})
