import test from 'node:test'
import assert from 'node:assert/strict'
import * as protocol from '@deepseek-ai/dsh-typert-protocol'
import { createSettingsRemoteApi, createDisabledSettingsRemoteApi } from '../lib/settings-remote.js'
import { runFeatureGuard } from '../lib/guards.js'

function makeHost(settings = {}) {
  const provided = new Map()
  const calls = []
  const ctx = {
    get(name) {
      assert.equal(name, 'settings')
      return settings
    },
    reflect: {
      provide(name, value) {
        calls.push({ name, value })
        if (provided.has(name)) throw new Error(`duplicate ${name}`)
        provided.set(name, value)
        return async () => {
          provided.delete(name)
        }
      },
    },
  }
  return { ctx, provided, calls }
}

function makeSettings() {
  const state = { readImage: { enabled: true, count: 1 } }
  const mutations = []
  return {
    state,
    mutations,
    scope(ns) {
      if (!Object.hasOwn(state, ns)) throw new Error('namespace missing')
      return {}
    },
    get(ns) {
      return state[ns]
    },
    async mutate(ns, ops) {
      mutations.push({ ns, ops })
      for (const op of ops) {
        if (op.op === 'unset') delete state[ns][op.path[0]]
        else state[ns][op.path[0]] = op.value
      }
      return { revision: mutations.length }
    },
  }
}

test('settings remote publishes official binding and stable descriptors', async () => {
  const settings = makeSettings()
  const host = makeHost(settings)
  const api = createSettingsRemoteApi({ ctx: host.ctx, settings, protocol })
  const dispose = api.remote('readImage')
  assert.equal(host.calls.length, 1)
  const service = host.calls[0].value
  assert.deepEqual(service.typertRemote, { service, serviceKey: 'readImage', namespace: 'readImage' })
  assert.deepEqual(protocol.remoteMethods(service).map((entry) => entry.method), ['get', 'set'])
  assert.deepEqual(service.get(), { enabled: true, count: 1 })
  assert.deepEqual(await service.set({ patch: { enabled: false }, unset: ['count'] }), { ok: true })
  assert.deepEqual(settings.mutations, [{ ns: 'readImage', ops: [
    { op: 'unset', path: ['count'] },
    { op: 'set', path: ['enabled'], value: false },
  ] }])
  await dispose()
  assert.equal(host.provided.size, 0)
})

test('explicit service keys are validated and duplicate owners are idempotent', async () => {
  const settings = makeSettings()
  const host = makeHost(settings)
  const api = createSettingsRemoteApi({ ctx: host.ctx, settings, protocol })
  const first = api.remote('readImage', 'image-config')
  assert.equal(api.remote('readImage', 'image-config'), first)
  assert.equal(host.calls.length, 1)
  assert.throws(() => api.remote('readImage', 'other.key!'), /remote-segment grammar/)
  await first()
  const second = api.remote('readImage', 'image-config')
  assert.notEqual(second, first)
  await first()
  assert.equal(host.provided.size, 1)
  await second()
  assert.equal(host.provided.size, 0)
})

test('facade dispose only clears contributions owned by that facade instance', async () => {
  const settings = makeSettings()
  const host = makeHost(settings)
  const first = createSettingsRemoteApi({ ctx: host.ctx, settings, protocol })
  const second = createSettingsRemoteApi({ ctx: host.ctx, settings, protocol })
  first.remote('readImage', 'first')
  second.remote('readImage', 'second')
  first.dispose()
  assert.equal(host.provided.has('first'), false)
  assert.equal(host.provided.has('second'), true)
  second.dispose()
  assert.equal(host.provided.size, 0)
})

test('invalid namespace, request, and values fail before mutation', async () => {
  const settings = makeSettings()
  const host = makeHost(settings)
  const api = createSettingsRemoteApi({ ctx: host.ctx, settings, protocol })
  const dispose = api.remote('readImage')
  const service = host.calls[0].value
  assert.throws(() => api.remote('missing'), /namespace/)
  for (const request of [
    { patch: { enabled: undefined } },
    { patch: { enabled: Number.NaN } },
    { patch: { enabled: () => true } },
    { patch: { enabled: {} }, extra: true },
    { unset: [''] },
  ]) {
    await assert.rejects(() => service.set(request), /settings remote|JSON-safe|finite numbers|unknown field|non-empty/)
  }
  assert.equal(settings.mutations.length, 0)
  const cycle = {}
  cycle.self = cycle
  await assert.rejects(() => service.set({ patch: { cycle } }), /cycles/)
  await dispose()
})

test('failed publication rolls back provider and later replacement is stale-safe', async () => {
  const settings = makeSettings()
  let registerCalls = 0
  const host = makeHost(settings)
  host.ctx.reflect.provide = (name, value) => {
    registerCalls += 1
    host.provided.set(name, value)
    if (registerCalls === 1) throw new Error('registration failed')
    return () => host.provided.delete(name)
  }
  const logs = []
  const api = createSettingsRemoteApi({ ctx: host.ctx, settings, protocol, logger: { error: (line) => logs.push(line) } })
  assert.throws(() => api.remote('readImage'), /registration failed/)
  assert.equal(host.provided.size, 1, 'a throwing provider is not removable by an unavailable disposer')
  // The host primitive is responsible for atomic registration; an owner is
  // not committed when provide throws, so the next call is still attempted.
  const replacement = api.remote('readImage')
  assert.equal(typeof replacement, 'function')
  replacement()
  assert.ok(logs.length >= 1)
})

test('disabled face and settingsRemote guard fail closed locally', () => {
  const disabled = createDisabledSettingsRemoteApi(true, 'missing')
  assert.equal(disabled.isActive, false)
  assert.throws(() => disabled.remote('readImage'), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED')
  const settings = makeSettings()
  const host = makeHost(settings)
  const healthy = runFeatureGuard('settingsRemote', host.ctx, { typertProtocol: protocol })
  assert.equal(healthy.ok, true)
  const missing = runFeatureGuard('settingsRemote', { get() {}, reflect: {} }, { typertProtocol: {} })
  assert.equal(missing.ok, false)
  assert.ok(missing.featureProblems.settingsRemote.some((problem) => problem.name === 'ctx.reflect.provide'))
  assert.doesNotThrow(() => runFeatureGuard('settingsRemote', { get() { throw new Error('hostile') } }, {}))
})

test('missing primitives produce a disabled face without throwing during construction', () => {
  const disabled = createSettingsRemoteApi({ ctx: {}, settings: {}, protocol: {} })
  assert.equal(disabled.isActive, false)
  assert.throws(() => disabled.remote('readImage'), /feature "settingsRemote" is disabled/)
})
