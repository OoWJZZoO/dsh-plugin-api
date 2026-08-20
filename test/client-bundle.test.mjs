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
  assert.equal(handoff?.id, '@deepseek-ai/dsh-plugin-api-main')
  assert.equal(typeof handoff?.factory, 'function')
  return handoff.factory(() => { throw new Error('the bundled facade has no cross-plugin runtime imports') })
}

function createCtx({ omit = [], throwGet = [] } = {}) {
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
  for (const name of omit) services.delete(name)
  return {
    logger: { error() {} },
    get(name) {
      if (throwGet.includes(name)) throw new Error(`get(${name}) failed`)
      return services.get(name)
    },
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

test('official client artifact registers, composes all client leaves, and supports reapply cleanup', async () => {
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

test('bundle mountRemote mounts through gateway-style dynamic namespace publication', async () => {
  const artifact = loadClientBundle()
  const ctx = createCtx()
  artifact.apply(ctx)
  const api = ctx.get('pluginApi')
  const contribution = {
    package: 'example',
    descriptors: [{
      id: 'example#settings/get', service: 'settings', namespace: 'settings', method: 'get',
      invocation: { kind: 'direct' }, parameters: [],
      result: { mode: 'strict', typeSymbol: 'example.Json', schema: { parse(value) { return value } } },
    }],
  }
  // The bundle fixture's $mount publishes remote[namespace] as a dynamic
  // property (the gateway exposes Cordis dynamic services, not own properties).
  const dispose = await api.client.mountRemote(contribution)
  assert.equal(typeof dispose, 'function')
  assert.equal(await dispose(), true)
  assert.equal(await dispose(), false)
})

const FEATURE_TO_LEAF = {
  clientConnection: 'connection',
  clientRemoteContribution: 'remoteContribution',
  clientSettingsRemote: 'settingsRemote',
  clientSettingsScope: 'settingsScope',
  clientSlots: 'slots',
  clientSlotEvents: 'slotEvents',
  clientRemoteEvents: 'remoteEvents',
}

function leafState(api) {
  const state = {}
  for (const { name, isActive } of api.client.features) state[FEATURE_TO_LEAF[name] ?? name] = isActive
  return state
}

test('missing an optional browser service disables only its owning leaf while the client facade still publishes', () => {
  const artifact = loadClientBundle()
  const cases = [
    { service: 'connection', leaf: 'connection' },
    { service: 'remote', leaf: 'remoteContribution', extraDisabled: ['remoteEvents'] },
    { service: 'settingsScope', leaf: 'settingsScope' },
    { service: 'slots', leaf: 'slots' },
  ]
  for (const { service, leaf, extraDisabled = [] } of cases) {
    const ctx = createCtx({ omit: [service] })
    const dispose = artifact.apply(ctx)
    const api = ctx.get('pluginApi')
    assert.ok(api?.client, `missing ${service} must not prevent the facade from publishing`)
    assert.equal(api.client.features.find((f) => f.name === 'clientManifest').isActive, true)
    const state = leafState(api)
    assert.equal(state[leaf], false, `leaf ${leaf} should be disabled when ${service} is missing`)
    for (const other of ['connection', 'remoteContribution', 'settingsRemote', 'settingsScope', 'slots', 'slotEvents', 'remoteEvents']) {
      const expected = other === leaf || extraDisabled.includes(other) ? false : true
      assert.equal(state[other], expected, `leaf ${other} unexpected state when ${service} is missing`)
    }
    dispose()
  }
})

test('malformed or throwing optional services also disable only the owning leaf', () => {
  const artifact = loadClientBundle()
  const malformed = { connection: {}, remote: {}, settingsScope: { bind: 'nope' }, slots: {} }
  const affected = {
    connection: ['connection'],
    remote: ['remoteContribution', 'remoteEvents'],
    settingsScope: ['settingsScope'],
    slots: ['slots'],
  }
  for (const [service, value] of Object.entries(malformed)) {
    const ctx = createCtx()
    const get = ctx.get
    ctx.get = (name) => (name === service ? value : get(name))
    const dispose = artifact.apply(ctx)
    const api = ctx.get('pluginApi')
    assert.ok(api?.client, `malformed ${service} must not block facade publication`)
    const state = leafState(api)
    for (const leaf of affected[service]) assert.equal(state[leaf], false, `leaf ${leaf} should be disabled for malformed ${service}`)
    assert.equal(state.connection, service === 'connection' ? false : true)
    dispose()
  }
  // A throwing ctx.get must also leave unrelated leaves mountable.
  const ctx = createCtx({ throwGet: ['slots'] })
  const dispose = artifact.apply(ctx)
  const api = ctx.get('pluginApi')
  assert.ok(api?.client)
  assert.equal(api.client.features.find((f) => f.name === 'clientSlots').isActive, false)
  assert.equal(api.client.features.find((f) => f.name === 'clientConnection').isActive, true)
  dispose()
})
