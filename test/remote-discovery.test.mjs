import test from 'node:test'
import assert from 'node:assert/strict'
import * as protocol from '@deepseek-ai/dsh-typert-protocol'
import { createHostRemoteApi } from '../lib/host-remote.js'

/**
 * ACC 2.5 — end-to-end source-mode discovery, faithful to the official gateway.
 *
 * The official `dsh-api-gateway` discovers a host service by:
 *   1. iterating `ctx.reflect.props` for `type: 'service'` definitions
 *   2. resolving the receiver via `ctx.get(serviceKey)` (unwrapping the Cordis
 *      origin, which for a plain provided service is the same object)
 *   3. reading the visible `typertRemote` binding (namespace)
 *   4. iterating `remoteMethods(original)` to build endpoint claims
 *      `namespace/exportName||method`
 * (dsh-api-gateway/lib/index.js:75-88,143-156). We reproduce that traversal
 * here against a mock reflect registry so discovery is proven without touching
 * the official packages.
 */

function makeGatewayHost() {
  const props = new Map()
  const provided = new Map()
  const calls = []
  const ctx = {
    get(name) {
      return provided.get(name)
    },
    reflect: {
      props, // official reflect registry (props map) as the gateway iterates it
      provide(name, value) {
        calls.push({ name, value })
        if (provided.has(name)) throw new Error(`duplicate ${name}`)
        provided.set(name, value)
        props.set(name, { type: 'service' })
        return () => {
          provided.delete(name)
          props.delete(name)
          return true
        }
      },
    },
  }
  return { ctx, props, provided, calls }
}

/** Mirror of gateway `collectSrcClaims` + `resolveSrcDescriptor` endpoint set. */
function sourceModeClaims(ctx) {
  const claims = new Set()
  for (const [serviceKey, definition] of ctx.reflect.props) {
    if (definition?.type !== 'service') continue
    const receiver = typeof ctx.get === 'function' ? ctx.get(serviceKey) : undefined
    if (receiver === null || typeof receiver !== 'object') continue
    const original = receiver
    const binding = original?.typertRemote
    if (!binding || typeof binding.namespace !== 'string') continue
    for (const marker of protocol.remoteMethods(original)) {
      claims.add(`${binding.namespace}/${marker.exportName ?? marker.method}`)
    }
  }
  return claims
}

/** Mirror of gateway `methodParameterNames` (prototype-chain, toString-based). */
function wireParameterNames(service, method) {
  let fn
  let prototype = Object.getPrototypeOf(service)
  while (prototype !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, method)
    if (descriptor !== undefined) {
      if ('value' in descriptor && typeof descriptor.value === 'function') fn = descriptor.value
      break
    }
    prototype = Object.getPrototypeOf(prototype)
  }
  if (fn === undefined) return []
  const source = Function.prototype.toString.call(fn)
  const open = source.indexOf('(')
  const close = source.indexOf(')', open + 1)
  if (open < 0 || close < 0) return []
  const body = source.slice(open + 1, close).trim()
  if (body.length === 0) return []
  return body.split(',').map((part) => part.trim())
}

test('AC 2.5: published service is discoverable via official source-mode traversal', () => {
  const { ctx } = makeGatewayHost()
  const api = createHostRemoteApi({ ctx, protocol, active: true })
  const service = {
    get() {
      return { value: { enabled: true } }
    },
    async set(settings) {
      return { ok: true, settings }
    },
  }
  api.publish('extraproAnchorConfig', service)
  const claims = sourceModeClaims(ctx)
  assert.ok(claims.has('extraproAnchorConfig/get'), 'get endpoint claim present')
  assert.ok(claims.has('extraproAnchorConfig/set'), 'set endpoint claim present')
  assert.equal(claims.size, 2, 'no stray endpoints')
  // Wire-name derivation: the set method's real parameter name becomes the wire
  // field (methodParameterNames semantics) — unchanged by re-home.
  assert.deepEqual(wireParameterNames(service, 'get'), [])
  assert.deepEqual(wireParameterNames(service, 'set'), ['settings'])
})

test('AC 2.5: endpoint resolves to the exact registered service and is callable', async () => {
  const { ctx, provided } = makeGatewayHost()
  const api = createHostRemoteApi({ ctx, protocol, active: true })
  const service = {
    get() {
      return { value: { count: 7 } }
    },
    async set(settings) {
      return { ok: true, settings }
    },
  }
  api.publish('statek', service)
  const receiver = provided.get('statek')
  assert.equal(receiver, service, 'registry resolves the exact published service')
  // Direct source-mode invocation (gateway resolveReceiverContext → Reflect.apply).
  const result = await Reflect.apply(service.set, receiver, [{ count: 9 }])
  assert.deepEqual(result, { ok: true, settings: { count: 9 } })
  assert.deepEqual(service.get().value, { count: 7 })
})

test('AC 2.5: discovery needs no modification of dsh-api-remotes hard-coded contributions', () => {
  // Endpoint claims arise purely from the service's own binding + markers; the
  // client side continues to consume via delivered ST5/C2 (AC 5.1) — nothing in
  // this feature adds to dsh-api-remotes (which we cannot modify anyway).
  const { ctx } = makeGatewayHost()
  const api = createHostRemoteApi({ ctx, protocol, active: true })
  api.publish('extraproAnchorConfig', {
    get() { return { value: {} } },
    set() { return { ok: true } },
  })
  const claims = sourceModeClaims(ctx)
  assert.equal(claims.size, 2)
  // The claim set is derived entirely from runtime state (props + methods),
  // i.e. self-discovering — no static allowlist needed.
  assert.ok([...claims].every((c) => c.startsWith('extraproAnchorConfig/')))
})

test('AC 2.5: non-service props and binding-less entries are excluded from claims', () => {
  const { ctx, props } = makeGatewayHost()
  const api = createHostRemoteApi({ ctx, protocol, active: true })
  const service = {
    get() { return { value: {} } },
    set() { return { ok: true } },
  }
  api.publish('svc', service)
  assert.equal(sourceModeClaims(ctx).size, 2)
  // A gateway-skipped non-service prop (e.g. a lookup def) must NOT contribute.
  props.set('not-a-service', { type: 'lookup' })
  assert.equal(sourceModeClaims(ctx).size, 2, 'non-service entry excluded')
  // A binding-less service entry is likewise skipped (dead-exclusion branch live).
  props.set('bindless', { type: 'service' })
  assert.equal(sourceModeClaims(ctx).size, 2, 'binding-less entry excluded')
})

test('AC 7.1 contract lock: pro-ex-shaped get/set publishes with stable wire identity', async () => {
  // Reproduces the dsh-pro-ex-ability-anchor bridge contract at the facade level
  // (no dependency on the consumer repo): plain object with `get()` + `set(settings)`,
  // JSON-safe snapshot, `settings` as the wire parameter, replace-one-full-document
  // atomic set semantics.
  const { ctx, provided } = makeGatewayHost()
  const api = createHostRemoteApi({ ctx, protocol, active: true })
  const store = { enabled: true, gitBashInstalled: true, draft: 'abc' }
  const service = {
    get() {
      return { value: { ...store } }
    },
    // pro-ex `store.update(settings)`: replace the whole settings document after
    // validation — NOT a partial merge.
    async set(settings) {
      if (!settings || typeof settings !== 'object') throw new TypeError('invalid panel config')
      const value = { ...settings }
      Object.keys(store).forEach((key) => delete store[key])
      Object.assign(store, value)
      return { ok: true, value }
    },
  }
  const disposer = api.publish('extraproAnchorConfig', service)
  assert.equal(provided.get('extraproAnchorConfig'), service)
  // remoteMethods descriptors: get then set, both direct.
  const descriptors = protocol.remoteMethods(service)
  assert.deepEqual(descriptors.map((d) => d.method), ['get', 'set'])
  assert.ok(descriptors.every((d) => d.invocation?.kind === 'direct'))
  // Wire parameter names (AC 7.1: the `settings` parameter name IS the wire name;
  // panel contribution declares { name: "settings", wire: "settings" }).
  assert.deepEqual(wireParameterNames(service, 'set'), ['settings'])
  // JSON-safe snapshot survives (no leak of host-only fields — contract asserted).
  const snapshot = service.get()
  assert.deepEqual(snapshot.value, { enabled: true, gitBashInstalled: true, draft: 'abc' })
  // Replace-one-full-document: a partial document replaces the whole store; fields
  // absent from the incoming document are dropped (not merged).
  const result = await service.set({ enabled: false })
  assert.deepEqual(result, { ok: true, value: { enabled: false } })
  assert.deepEqual(store, { enabled: false }, 'full document replaced atomically')
  disposer()
})
