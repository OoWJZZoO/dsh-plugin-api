import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

function loadClientBundle() {
  let handoff
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { handoff = value } } },
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    TextEncoder,
    TextDecoder,
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(bundle, sandbox, { filename: 'client.js' })
  assert.equal(handoff?.id, '@deepseek-ai/dsh-plugin-api')
  assert.equal(typeof handoff?.factory, 'function')
  return handoff.factory(() => { throw new Error('the bundled facade has no cross-plugin runtime imports') })
}

function createCtx() {
  const services = new Map()
  const listeners = new Map()
  const remote = {
    $on(name, listener) {
      const bucket = listeners.get(name) ?? new Set()
      bucket.add(listener)
      listeners.set(name, bucket)
      return () => bucket.delete(listener)
    },
    $dispatch(name, args) {
      for (const listener of [...(listeners.get(name) ?? [])]) listener(...args)
    },
    async $mount(contribution) {
      for (const descriptor of contribution.descriptors) remote[descriptor.namespace] ??= { [descriptor.method]: () => ({ ok: true }) }
      return () => true
    },
  }
  services.set('connection', {
    rpc: { call(_base, endpoint, body, signal) { return Promise.resolve({ endpoint, body, signal }) } },
    api: { settings: { describe() {} } },
  })
  services.set('remote', remote)
  services.set('settingsScope', { bind() { return { getSnapshot() {}, subscribe() {}, set() {}, unset() {} } } })
  services.set('slots', { register() { return () => {} }, inject() { return () => {} }, entries() { return [] }, subscribe() { return () => {} } })
  return {
    logger: { error() {} },
    get(name) { return services.get(name) },
    on(name, listener) {
      const bucket = listeners.get(name) ?? new Set()
      bucket.add(listener)
      listeners.set(name, bucket)
      return () => bucket.delete(listener)
    },
    reflect: {
      provide(name, value) {
        services.set(name, value)
        return () => services.get(name) === value && services.delete(name)
      },
    },
  }
}

test('official client artifact registers, composes all M3 leaves, and supports reapply cleanup', async () => {
  const artifact = loadClientBundle()
  assert.deepEqual([...artifact.CLIENT_MOUNTERS], [
    'clientManifest', 'clientConnection', 'clientCodec', 'clientRemoteContribution',
    'clientSettingsRemote', 'clientSettingsScope', 'clientSlots', 'clientSlotEvents', 'clientRemoteEvents',
  ])
  const ctx = createCtx()
  const dispose = artifact.apply(ctx)
  assert.equal(typeof dispose, 'function')
  const api = ctx.get('pluginApi')
  assert.ok(api?.client)
  assert.equal(api.client.codec.zod, api.client.codec.zod, 'one zod value is shared by the public bundle')
  assert.equal(api.client.connection.isActive, true)
  assert.equal(typeof api.client.slots.on, 'function')
  assert.equal(artifact.apply(ctx), dispose, 'reapply reuses the active client facade')
  assert.equal(await dispose(), true)
  assert.equal(ctx.get('pluginApi'), undefined)
})
