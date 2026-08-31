import test from 'node:test'
import assert from 'node:assert/strict'
import * as protocol from '@deepseek-ai/dsh-typert-protocol'
import { createHostRemoteApi, createDisabledHostRemoteApi } from '../lib/host-remote.js'
import { PluginApiInactiveError, PluginApiFeatureDisabledError, PluginApiRemoteError } from '../lib/errors.js'
import { isRehomedService } from '../lib/remote-publication.js'

function makeHost() {
  const provided = new Map()
  const ctx = {
    get(name) {
      return provided.get(name)
    },
    reflect: {
      provide(name, value) {
        if (provided.has(name)) throw new PluginApiRemoteError(`duplicate ${name}`, { serviceKey: name })
        provided.set(name, value)
        return () => {
          if (provided.get(name) !== value) return false
          provided.delete(name)
          return true
        }
      },
    },
  }
  return { ctx, provided }
}

function makeService(methods = ['hello']) {
  const service = {}
  for (const method of methods) service[method] = (arg) => ({ ok: true, arg })
  return service
}

test('publish returns a disposer and registers through official boundary', () => {
  const { ctx, provided } = makeHost()
  const { api } = createHostRemoteApi({ ctx, protocol, active: true })
  const service = makeService(['hello'])
  const dispose = api.register('extraproAnchorConfig', service)
  assert.equal(typeof dispose, 'function')
  assert.equal(provided.get('extraproAnchorConfig'), service)
  assert.deepEqual(protocol.remoteMethods(service).map((e) => e.method), ['hello'])
  dispose()
  assert.equal(provided.has('extraproAnchorConfig'), false)
})

test('plain-object service is re-homed; markers never leak onto Object.prototype', () => {
  const { ctx } = makeHost()
  const { api } = createHostRemoteApi({ ctx, protocol, active: true })
  const service = makeService(['hello', 'ping'])
  const dispose = api.register('k', service)
  assert.ok(isRehomedService(service))
  assert.ok(Object.getPrototypeOf(service) !== Object.prototype)
  assert.deepEqual(protocol.remoteMethods(Object.create(null)), [])
  assert.deepEqual(protocol.remoteMethods({}), [])
  dispose()
})

test('publish rejects null / array / no-callable-own member / non-extensible', () => {
  const { ctx } = makeHost()
  const { api } = createHostRemoteApi({ ctx, protocol, active: true })
  assert.throws(() => api.register('k', null), PluginApiRemoteError)
  assert.throws(() => api.register('k', []), PluginApiRemoteError)
  assert.throws(() => api.register('k', {}), PluginApiRemoteError)
  assert.throws(() => api.register('k', Object.preventExtensions({ a: 1 })), PluginApiRemoteError)
  // class instance whose methods only live on the class prototype → remote publication narrowing
  class Foo {
    hi() {
      return 1
    }
  }
  assert.throws(() => api.register('k', new Foo()), PluginApiRemoteError)
})

test('method-name segment grammar is validated before registration', () => {
  const { ctx, provided } = makeHost()
  const { api } = createHostRemoteApi({ ctx, protocol, active: true })
  const service = {}
  service['bad name'] = () => true
  assert.throws(() => api.register('k', service), PluginApiRemoteError)
  assert.equal(provided.size, 0)
})

test('signature contract: destructuring/defaults/rest/duplicates and non-final signal are rejected pre-registration', () => {
  const { ctx, provided } = makeHost()
  const { api } = createHostRemoteApi({ ctx, protocol, active: true })
  assert.throws(
    () => api.register('k', { m({ a }) { return a } }),
    PluginApiRemoteError,
    'destructuring rejected',
  )
  assert.throws(
    () => api.register('k', { m(a = 1) { return a } }),
    PluginApiRemoteError,
    'defaults rejected',
  )
  assert.throws(
    () => api.register('k', { m(...args) { return args } }),
    PluginApiRemoteError,
    'rest rejected',
  )
  assert.throws(
    () => api.register('k', { m(signal, a) { return a } }),
    PluginApiRemoteError,
    'non-final signal rejected',
  )
  assert.equal(provided.size, 0)
})

test('idempotence: same key + same reference returns the same disposer without re-registration', () => {
  const { ctx, provided } = makeHost()
  const { api } = createHostRemoteApi({ ctx, protocol, active: true })
  const service = makeService(['hello'])
  const d1 = api.register('k', service)
  const d2 = api.register('k', service)
  assert.equal(d2, d1)
  assert.equal(provided.get('k'), service)
  d1()
  assert.equal(provided.has('k'), false)
})

test('conflict: same key + different service throws and does not mutate the passed object', () => {
  const { ctx, provided } = makeHost()
  const { api } = createHostRemoteApi({ ctx, protocol, active: true })
  const first = makeService(['hello'])
  const second = makeService(['hello'])
  const d1 = api.register('k', first)
  const protoBefore = Object.getPrototypeOf(second)
  assert.throws(() => api.register('k', second), PluginApiRemoteError)
  assert.equal(Object.getPrototypeOf(second), protoBefore, 'conflicted object is not mutated (client)')
  assert.equal(isRehomedService(second), false, 'conflicted object is not re-homed')
  assert.equal(provided.get('k'), first)
  d1()
})

test('conflict: same key already published by another instance (shared owner map) throws', () => {
  const { ctx, provided } = makeHost()
  // Two createHostRemoteApi instances on the same ctx resolve the SAME owner
  // map (ownerName:'remote'), so a second instance's different service conflicts
  // via the owner record.
  const { api: apiA } = createHostRemoteApi({ ctx, protocol, active: true })
  const { api: apiB } = createHostRemoteApi({ ctx, protocol, active: true })
  const s1 = makeService(['hello'])
  apiA.register('k', s1)
  const s2 = makeService(['hello'])
  assert.throws(() => apiB.register('k', s2), PluginApiRemoteError)
  assert.equal(provided.get('k'), s1)
})

test('conflict: live official-registry owner with no owner record throws', () => {
  // A service occupies the key in the official registry (as the settings remote
  // or another plugin would) with NO record in our owner map; the read-only
  // registry probe must reject the publication without touching it.
  const { ctx, provided } = makeHost()
  const { api } = createHostRemoteApi({ ctx, protocol, active: true })
  const foreign = makeService(['hello'])
  provided.set('k', foreign)
  const mine = makeService(['hello'])
  assert.throws(() => api.register('k', mine), PluginApiRemoteError)
  assert.equal(provided.get('k'), foreign, 'foreign registry owner untouched')
})

test('core-inactive: inactive api throws PluginApiInactiveError on publish', () => {
  const { ctx } = makeHost()
  const { api } = createHostRemoteApi({ ctx, protocol, active: false })
  // Runtime core-inactive gating happens inside register() via the supplied
  // active() predicate; the availability projection reports the live state.
  assert.equal(api.availability().status, 'active')
  assert.throws(() => api.register('k', makeService()), PluginApiInactiveError)
})

test('feature-disabled disabled face: missing protocol → publish throws PluginApiFeatureDisabledError', () => {
  const { ctx } = makeHost()
  const api = createHostRemoteApi({ ctx, protocol: undefined, active: true })
  // The disabled face is the surface itself (no { api, dispose } wrapper).
  assert.equal(api.availability().status, 'unavailable')
  assert.throws(() => api.register('k', makeService()), PluginApiFeatureDisabledError)
})

test('disabled factory: same disabled contract shape', () => {
  const api = createDisabledHostRemoteApi(true, 'missing')
  assert.equal(api.availability().status, 'unavailable')
  assert.throws(() => api.register('k', {}), PluginApiFeatureDisabledError)
  const inactive = createDisabledHostRemoteApi(false)
  assert.throws(() => inactive.register('k', {}), PluginApiInactiveError)
})

test('dispose() clears all owned records and unregisters providers', () => {
  const { ctx, provided } = makeHost()
  const { api, dispose } = createHostRemoteApi({ ctx, protocol, active: true })
  const s1 = makeService(['hello'])
  const s2 = makeService(['hello'])
  api.register('a', s1)
  api.register('b', s2)
  assert.equal(provided.size, 2)
  dispose()
  assert.equal(provided.size, 0)
})

test('pro-ex-shaped service: get/set plain methods publish with stable wire identity', async () => {
  const { ctx, provided } = makeHost()
  const { api } = createHostRemoteApi({ ctx, protocol, active: true })
  const store = { enabled: true }
  const service = {
    get() {
      return { value: { ...store } }
    },
    async set(settings) {
      Object.assign(store, settings)
      return { ok: true }
    },
  }
  const dispose = api.register('extraproAnchorConfig', service)
  const fn = provided.get('extraproAnchorConfig')
  assert.equal(fn, service, 'identity preserved through publication')
  assert.deepEqual(protocol.remoteMethods(service).map((e) => e.method), ['get', 'set'])
  // Wire-name derivation: the `set` method's single parameter is `settings`
  //.
  const setSource = Function.prototype.toString.call(service.set)
  assert.match(setSource, /^async set\(settings\)/)
  const snapshot = service.get()
  assert.deepEqual(snapshot.value, { enabled: true })
  assert.deepEqual(await service.set({ enabled: false }), { ok: true })
  assert.equal(store.enabled, false)
  dispose()
})
