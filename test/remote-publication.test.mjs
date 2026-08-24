import test from 'node:test'
import assert from 'node:assert/strict'
import * as protocol from '@deepseek-ai/dsh-typert-protocol'
import {
  createRemoteOwner,
  publishRemotePublication,
  rehomeService,
  isRehomedService,
  collectProtoMethods,
  readPublishedService,
  validateRemoteSegment,
  markRemoteMethod,
  isJsonValue,
  assertJsonValue,
  cloneJsonValue,
  isPlainObject,
} from '../lib/remote-publication.js'
import { PluginApiRemoteError } from '../lib/errors.js'

/** Build a minimal harmonised host with an owner-name-visible service map. */
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
        // The official provider disposer is idempotent and returns a boolean.
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

test('error class: PluginApiRemoteError carries code and optional serviceKey', () => {
  const e = new PluginApiRemoteError('boom', { serviceKey: 'svc' })
  assert.ok(e instanceof Error)
  assert.equal(e.code, 'PLUGIN_API_REMOTE_INVALID')
  assert.equal(e.serviceKey, 'svc')
  const bare = new PluginApiRemoteError('plain')
  assert.equal(bare.serviceKey, undefined)
})

test('owner map: remote and settingsRemote keep separate records per ctx', () => {
  const { ctx } = makeHost()
  const remoteOwner = createRemoteOwner({ ctx, ownerName: 'remote' })
  const settingsOwner = createRemoteOwner({ ctx, ownerName: 'settingsRemote' })
  const anotherHost = makeHost().ctx
  const remoteOther = createRemoteOwner({ ctx: anotherHost, ownerName: 'remote' })

  assert.notEqual(remoteOwner, settingsOwner)
  assert.notEqual(remoteOwner, remoteOther)
  assert.equal(remoteOwner, createRemoteOwner({ ctx, ownerName: 'remote' }), 'owner resolve is stable')
})

test('publish registers official binding, typertRemote and stable descriptors', async () => {
  const { ctx, provided } = makeHost()
  const owner = createRemoteOwner({ ctx, ownerName: 'remote' })
  const service = makeService(['hello'])
  const disposer = publishRemotePublication({
    ctx,
    protocol,
    service,
    serviceKey: 'extraproAnchorConfig',
    methods: ['hello'],
    owner,
  })
  assert.equal(typeof disposer, 'function')
  assert.equal(provided.has('extraproAnchorConfig'), true)
  assert.equal(provided.get('extraproAnchorConfig'), service)
  assert.deepEqual(service.typertRemote, { service, serviceKey: 'extraproAnchorConfig', namespace: 'extraproAnchorConfig' })
  assert.deepEqual(protocol.remoteMethods(service).map((e) => e.method), ['hello'])
  await disposer()
  assert.equal(provided.has('extraproAnchorConfig'), false)
})

test('markers never leak onto Object.prototype', () => {
  assert.deepEqual(protocol.remoteMethods({}), [])
  assert.deepEqual(protocol.remoteMethods(Object.create(null)), [])
})

test('re-home moves same function references onto a dedicated prototype', () => {
  const service = makeService(['hello', 'ping'])
  const helloRef = service.hello
  const originalProto = Object.getPrototypeOf(service)
  const out = rehomeService({ service, methods: ['hello', 'ping'] })
  assert.equal(out, service)
  assert.notEqual(Object.getPrototypeOf(service), originalProto)
  assert.ok(isRehomedService(service))
  assert.equal(service.hello, helloRef, 'same function reference preserved')
  assert.deepEqual(collectProtoMethods(service).sort(), ['hello', 'ping'])
  // Object.prototype has no markers after re-home either.
  assert.deepEqual(protocol.remoteMethods({}), [])
})

test('isJsonValue rejects cycles, functions, undefined, non-finite, class/host objects', () => {
  assert.equal(isJsonValue(null), true)
  assert.equal(isJsonValue({ a: [1, 2, { b: 'x' }] }), true)
  assert.equal(isJsonValue(undefined), false)
  assert.equal(isJsonValue(() => {}), false)
  assert.equal(isJsonValue(NaN), false)
  assert.equal(isJsonValue(Infinity), false)
  assert.equal(isJsonValue(1n), false)
  const cyclic = {}
  cyclic.self = cyclic
  assert.equal(isJsonValue(cyclic), false)
  assert.equal(isJsonValue(new Date()), false)
})

test('assertJsonValue throws typed error on non-finite / cycle; cloneJsonValue detaches', () => {
  assert.throws(() => assertJsonValue(NaN, 'x'), PluginApiRemoteError)
  const orig = { a: { b: 1 } }
  const copy = cloneJsonValue(orig)
  copy.a.b = 2
  assert.equal(orig.a.b, 1)
})

test('conflict: same key different service throws and leaves existing owner', async () => {
  const { ctx, provided } = makeHost()
  const owner = createRemoteOwner({ ctx, ownerName: 'remote' })
  const first = makeService()
  const second = makeService()
  const d1 = publishRemotePublication({ ctx, protocol, service: first, serviceKey: 'k', methods: ['hello'], owner })
  assert.throws(
    () => publishRemotePublication({ ctx, protocol, service: second, serviceKey: 'k', methods: ['hello'], owner }),
    PluginApiRemoteError,
  )
  assert.equal(provided.get('k'), first, 'existing owner unchanged')
  await d1()
})

test('idempotence: same key same reference returns existing disposer without re-registration', async () => {
  const { ctx, provided } = makeHost()
  const owner = createRemoteOwner({ ctx, ownerName: 'remote' })
  const service = makeService()
  const d1 = publishRemotePublication({ ctx, protocol, service, serviceKey: 'k', methods: ['hello'], owner })
  const d2 = publishRemotePublication({ ctx, protocol, service, serviceKey: 'k', methods: ['hello'], owner })
  assert.equal(d2, d1, 'same disposer returned')
  await d1()
  assert.equal(provided.has('k'), false)
})

test('stale disposer: old disposer does not remove a later provider', async () => {
  const { ctx, provided } = makeHost()
  const ownerA = createRemoteOwner({ ctx, ownerName: 'remote' })
  const ownerB = createRemoteOwner({ ctx, ownerName: 'remote' })
  // ownerA publishes, then disposes through a stale handle, then ownerB takes over.
  const serviceA = makeService()
  const dispatchA = publishRemotePublication({
    ctx,
    protocol,
    service: serviceA,
    serviceKey: 'k',
    methods: ['hello'],
    owner: ownerA,
  })
  await dispatchA()
  assert.equal(provided.has('k'), false)
  // A second owner does NOT inherit a live key automatically; the probe treats
  // absence as no owner, so a new publication is fine. Then the stale disposer
  // (already invoked) stays a no-op.
  const serviceB = makeService()
  const dispatchB = publishRemotePublication({
    ctx,
    protocol,
    service: serviceB,
    serviceKey: 'k',
    methods: ['hello'],
    owner: ownerB,
  })
  assert.equal(typeof dispatchB, 'function')
  assert.equal(provided.get('k'), serviceB)
  assert.equal(await dispatchA(), false)
  assert.equal(provided.get('k'), serviceB, 'later provider untouched by stale disposer')
  await dispatchB()
})

test('AC 4.3 stale guard: live owner record must not unregister a foreign later provider', () => {
  // Owner record is still live, but the official registry has been replaced by
  // a DIFFERENT service under the same key. The record's disposer must skip the
  // key-based unregister rather than retract the later provider.
  const provided = new Map()
  let ownUnregisterCalled = false
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
          ownUnregisterCalled = ownUnregisterCalled || value === own
          return true
        }
      },
    },
  }
  const owner = createRemoteOwner({ ctx, ownerName: 'remote' })
  const own = makeService()
  const disposer = publishRemotePublication({
    ctx,
    protocol,
    service: own,
    serviceKey: 'k',
    methods: ['hello'],
    owner,
  })
  // Registry still points at our own service → disposer unregisters correctly.
  assert.equal(disposer(), true)
  assert.equal(provided.has('k'), false)
  assert.equal(ownUnregisterCalled, true)
  // Re-publish, then let a FOREIGN provider replace the registry under the key
  // while our owner record is still live. The stale guard must skip unregister.
  const disposer2 = publishRemotePublication({
    ctx,
    protocol,
    service: own,
    serviceKey: 'k',
    methods: ['hello'],
    owner,
  })
  const foreign = makeService()
  provided.set('k', foreign)
  assert.equal(disposer2(), false, 'stale guard returns false')
  assert.equal(provided.get('k'), foreign, 'foreign later provider is NOT retracted')
})

test('disposer idempotence: repeated runs are no-ops', async () => {
  const { ctx, provided } = makeHost()
  const owner = createRemoteOwner({ ctx, ownerName: 'remote' })
  const service = makeService()
  const disposer = publishRemotePublication({
    ctx,
    protocol,
    service,
    serviceKey: 'k',
    methods: ['hello'],
    owner,
  })
  assert.equal(disposer(), true)
  assert.equal(provided.has('k'), false)
  assert.equal(disposer(), false)
  assert.equal(disposer(), false)
})

test('publication failure (reflect.provide throws) rolls back and does not throw through apply', async () => {
  const calls = []
  const ctx = {
    get() {
      return undefined
    },
    reflect: {
      provide(name, value) {
        calls.push({ name, value })
        throw new Error('provider exploded')
        // no disposer is ever returned
      },
    },
  }
  const owner = createRemoteOwner({ ctx, ownerName: 'remote' })
  const service = makeService()
  // bind/mark succeed; only provide fails.
  assert.throws(
    () =>
      publishRemotePublication({
        ctx,
        protocol,
        service,
        serviceKey: 'k',
        methods: ['hello'],
        owner,
        logger: undefined,
      }),
    PluginApiRemoteError,
  )
  assert.equal(calls.length, 1)
  assert.equal(owner.size, 0, 'no owner record committed')
})

test('recovery: re-publish after mid-publication failure recovers methods from dedicated proto', () => {
  const calls = []
  const { provided, ctx } = makeHost()
  ctx.reflect.provide = (name, value) => {
    if (calls.length === 0) {
      calls.push('fail')
      throw new Error('transient failure')
    }
    calls.push('ok')
    provided.set(name, value)
    return async () => {
      if (provided.get(name) !== value) return false
      provided.delete(name)
      return true
    }
  }
  const owner = createRemoteOwner({ ctx, ownerName: 'remote' })
  const service = makeService(['hello', 'ping'])
  // First attempt: re-home happens, then provide throws → no owner record.
  assert.throws(
    () =>
      publishRemotePublication({
        ctx,
        protocol,
        service,
        serviceKey: 'k',
        methods: ['hello', 'ping'],
        owner,
        rehome: true,
      }),
    PluginApiRemoteError,
  )
  assert.equal(owner.size, 0)
  // Object is now re-homed: methods no longer list as own `Object.keys`
  // (typertRemote binding may remain as a legitimate own prop from the failed
  // binding step), but the method functions still resolve via the prototype.
  assert.equal(Object.keys(service).includes('hello'), false)
  assert.ok(isRehomedService(service))
  assert.deepEqual(collectProtoMethods(service).sort(), ['hello', 'ping'])
  // Second attempt with the SAME object must recover methods from the proto.
  const disposer = publishRemotePublication({
    ctx,
    protocol,
    service,
    serviceKey: 'k',
    methods: ['hello', 'ping'],
    owner,
    rehome: true,
  })
  assert.equal(typeof disposer, 'function')
  assert.equal(provided.get('k'), service)
  assert.ok([...protocol.remoteMethods(service)].some((e) => e.method === 'hello'))
  assert.deepEqual(owner.get('k').service, service)
})

test('validateRemoteSegment rejects malformed segments', () => {
  assert.throws(() => validateRemoteSegment(protocol, '..', 'key'), PluginApiRemoteError)
  assert.throws(() => validateRemoteSegment(protocol, 'a b', 'method'), PluginApiRemoteError)
  assert.doesNotThrow(() => validateRemoteSegment(protocol, 'extraproAnchorConfig.get', 'key'))
})

test('markRemoteMethod works without decorator syntax and keeps stable order', () => {
  // Mark against a re-homed service so markers never touch Object.prototype.
  const service = rehomeService({ service: makeService(['a', 'b']), methods: ['a', 'b'] })
  markRemoteMethod(protocol, service, 'a')
  markRemoteMethod(protocol, service, 'b')
  assert.deepEqual(protocol.remoteMethods(service).map((e) => e.method), ['a', 'b'])
  assert.throws(() => markRemoteMethod({}, service, 'a'), PluginApiRemoteError)
})

test('fail-safe: publication with malformed protocol reports contained error', () => {
  const { ctx, provided } = makeHost()
  const owner = createRemoteOwner({ ctx, ownerName: 'remote' })
  const service = makeService()
  assert.throws(
    () => publishRemotePublication({ ctx, protocol: {}, service, serviceKey: 'k', methods: ['hello'], owner }),
    PluginApiRemoteError, // bindTypertRemote unavailable
  )
  assert.equal(provided.size, 0)
  assert.equal(owner.size, 0)
})

test('rehomeService rejects an object that cannot be re-homed', () => {
  assert.throws(() => rehomeService({ service: null, methods: ['a'] }), PluginApiRemoteError)
  const noMethods = {}
  assert.throws(() => rehomeService({ service: noMethods, methods: [] }), PluginApiRemoteError)
  const missing = { a: 1 }
  assert.throws(() => rehomeService({ service: missing, methods: ['b'] }), PluginApiRemoteError)
})

test('isPlainObject is plain-only', () => {
  assert.equal(isPlainObject({}), true)
  assert.equal(isPlainObject(Object.create(null)), true)
  assert.equal(isPlainObject([]), false)
  assert.equal(isPlainObject(new (class {})()), false)
  assert.equal(isPlainObject(null), false)
})
