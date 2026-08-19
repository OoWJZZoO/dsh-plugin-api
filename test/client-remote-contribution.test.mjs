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

test('resolves namespaces through the official dynamic-service accessor, not `in`/own-property', async () => {
  let disposals = 0
  // The gateway exposes `remote.<ns>` as a Cordis dynamic service: property read
  // succeeds while `in`/own-property reports false. Old `namespace in remote`
  // would reject the mount; `remote[namespace]` must accept it.
  const remote = {
    async $mount() { return () => { disposals += 1 } },
  }
  const dynamicRemote = new Proxy(remote, {
    get(target, prop) {
      if (prop === 'settings') return { get() {} }
      return Reflect.get(target, prop)
    },
    has() { return false },
  })
  const api = createClientRemoteContribution({ remote: dynamicRemote })
  const dispose = await api.mountRemote(contribution) // must not reject
  assert.equal(disposals, 0)
  assert.equal(await dispose(), true)
  assert.equal(disposals, 1)
})

test('disposing a pending mount defers official cleanup and allows a replacement mount', async () => {
  let mounts = 0
  let disposals = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const remote = {
    async $mount() {
      mounts += 1
      if (mounts === 1) await gate
      this.settings = {}
      return () => { disposals += 1 }
    },
  }
  const api = createClientRemoteContribution({ remote })
  const first = api.mountRemote(contribution)
  await api.dispose() // dispose while the first $mount is pending
  const second = api.mountRemote(contribution) // replacement proceeds
  assert.equal(mounts, 2)
  const disposeSecond = await second
  assert.equal(disposals, 0) // neither disposer yet; the stale first is still pending
  release() // let the stale first settle
  await first
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(disposals, 1) // the stale committer disposes exactly once
  assert.equal(await disposeSecond(), true)
  assert.equal(disposals, 2)
})

test('a late pending rejection preserves a newer owner', async () => {
  let mounts = 0
  const remote = {
    async $mount() {
      mounts += 1
      if (mounts === 1) throw new Error('gateway mount failed')
      this.settings = {}
      return () => true
    },
  }
  const api = createClientRemoteContribution({ remote })
  const first = api.mountRemote(contribution)
  await api.dispose()
  const second = api.mountRemote(contribution)
  const disposeSecond = await second
  await assert.rejects(() => first, /gateway mount failed/)
  // The newer owner must remain addressable and disposable after the late rejection.
  assert.equal(await disposeSecond(), true)
})
