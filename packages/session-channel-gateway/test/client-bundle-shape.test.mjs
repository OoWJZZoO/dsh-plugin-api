/**
 * Shape and behavior tests for the built gateway client bundle.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const bundlePath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const bundleSrc = readFileSync(bundlePath, 'utf8')

test('client bundle: exports["./client"] resolves', () => {
  assert.doesNotThrow(() => import.meta.resolve('@deepseek-ai/dsh-plugin-api-session-channel-gateway/client'))
})

test('client bundle: contains both module registrations', () => {
  assert.match(bundleSrc, /id: "@deepseek-ai\/dsh-api-gateway"/, 'official module id must be registered')
  assert.match(bundleSrc, /id: '@deepseek-ai\/dsh-plugin-api-session-channel-gateway'/, 'replacement module id must be registered')
  assert.match(bundleSrc, /require\('@deepseek-ai\/dsh-api-gateway'\)/, 'replacement factory must require the official module')
})

test('client bundle: official code inlined verbatim (not hand-modified)', () => {
  const officialPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-api-gateway/client'))
  const officialSrc = readFileSync(officialPath, 'utf8')
  const officialRegistration = officialSrc.replace(/\n\/\/# sourceMappingURL=.*$/u, '')
  assert.ok(
    bundleSrc.includes(officialRegistration),
    'official client bundle must be inlined verbatim into the replacement bundle',
  )
})

test('client bundle: no secret material', () => {
  for (const token of ['Bearer ', 'password=', 'privateKey', '-----BEGIN', 'client_secret']) {
    assert.ok(!bundleSrc.includes(token), `bundle must not contain secret material token "${token}"`)
  }
})

test('client bundle: no governance tokens', () => {
  const governanceTokens = ['r1', 'SPEC1', 'SPEC2', 'SPEC3', 'ANY', 'RSC-', 'U' + '21', 'U' + '22', 'U' + '23']
  for (const token of governanceTokens) {
    assert.ok(!bundleSrc.includes(token), `bundle must not contain governance token "${token}"`)
  }
})

test('client bundle: modules register and the wrapped apply exposes channel client', () => {
  const factories = new Map()
  // Register cordis mock (needed by the official gateway client factory)
  factories.set('@deepseek-ai/cordis', () => ({ Service: class Service { } }))
  const moduleLoader = { load({ id, factory }) { factories.set(id, factory) } }
  vm.runInNewContext(bundleSrc, { window: { __ModuleLoader__: moduleLoader } })
  assert.ok(factories.has('@deepseek-ai/dsh-api-gateway'), 'official module registered')
  assert.ok(factories.has('@deepseek-ai/dsh-plugin-api-session-channel-gateway'), 'replacement module registered')

  const loadCache = new Map()
  const require = (spec) => {
    if (loadCache.has(spec)) return loadCache.get(spec)
    const factory = factories.get(spec)
    if (!factory) throw new Error(`no registered factory for "${spec}"`)
    const exports = factory(require)
    loadCache.set(spec, exports)
    return exports
  }
  const replacementExports = require('@deepseek-ai/dsh-plugin-api-session-channel-gateway')
  assert.equal(typeof replacementExports.apply, 'function')
  assert.equal(typeof replacementExports.inject, 'object')

  // Wrapped apply exposes ctx.sessionChannel channel client
  const provided = {}
  const fakeCtx = {
    effect() {},
    provide(name, value) { provided[name] = value },
    get(name) { return provided[name] },
    connection: {
      rpc: {
        call: (endpoint, method, payload) => Promise.resolve({ ok: true, value: { called: [endpoint, method] } }),
      },
    },
  }
  replacementExports.apply(fakeCtx)
  assert.ok(fakeCtx.sessionChannel, 'ctx.sessionChannel channel client must be exposed')
  assert.equal(typeof fakeCtx.sessionChannel.call, 'function')
})

test('client bundle: channel client calls /channel with validated method', async () => {
  const factories = new Map()
  factories.set('@deepseek-ai/cordis', () => ({ Service: class Service { } }))
  const moduleLoader = { load({ id, factory }) { factories.set(id, factory) } }
  vm.runInNewContext(bundleSrc, { window: { __ModuleLoader__: moduleLoader } })
  const loadCache = new Map()
  const require = (spec) => {
    if (loadCache.has(spec)) return loadCache.get(spec)
    const factory = factories.get(spec)
    if (!factory) throw new Error(`no registered factory for "${spec}"`)
    const exports = factory(require)
    loadCache.set(spec, exports)
    return exports
  }
  const replacementExports = require('@deepseek-ai/dsh-plugin-api-session-channel-gateway')
  const calls = []
  const connection = { rpc: { call: (endpoint, method, payload) => { calls.push([endpoint, method, payload]); return Promise.resolve({ ok: true }) } } }
  const fakeCtx = {
    effect() {},
    provide() {},
    get(name) { return name === 'connection' ? connection : undefined },
    connection,
  }
  replacementExports.apply(fakeCtx)
  const result = await fakeCtx.sessionChannel.call('open', { device: 'dev1' })
  assert.ok(result.ok)
  assert.equal(calls[0][0], '/channel')
  assert.equal(calls[0][1], 'sessionChannel/open')
  assert.equal(JSON.stringify(calls[0][2]), JSON.stringify({ args: { device: 'dev1' } }))
})

test('client bundle: channel client rejects unknown method', async () => {
  const factories = new Map()
  factories.set('@deepseek-ai/cordis', () => ({ Service: class Service { } }))
  const moduleLoader = { load({ id, factory }) { factories.set(id, factory) } }
  vm.runInNewContext(bundleSrc, { window: { __ModuleLoader__: moduleLoader } })
  const loadCache = new Map()
  const require = (spec) => {
    if (loadCache.has(spec)) return loadCache.get(spec)
    const factory = factories.get(spec)
    if (!factory) throw new Error(`no registered factory for "${spec}"`)
    const exports = factory(require)
    loadCache.set(spec, exports)
    return exports
  }
  const replacementExports = require('@deepseek-ai/dsh-plugin-api-session-channel-gateway')
  const fakeCtx = { effect() {}, provide() {}, get() { return undefined }, connection: { rpc: { call: () => Promise.resolve({ ok: true }) } } }
  replacementExports.apply(fakeCtx)
  const result = await fakeCtx.sessionChannel.call('bogus', {})
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'invalid-input')
})

test('client bundle: channel client returns transport-unavailable without carrier', async () => {
  const factories = new Map()
  factories.set('@deepseek-ai/cordis', () => ({ Service: class Service { } }))
  const moduleLoader = { load({ id, factory }) { factories.set(id, factory) } }
  vm.runInNewContext(bundleSrc, { window: { __ModuleLoader__: moduleLoader } })
  const loadCache = new Map()
  const require = (spec) => {
    if (loadCache.has(spec)) return loadCache.get(spec)
    const factory = factories.get(spec)
    if (!factory) throw new Error(`no registered factory for "${spec}"`)
    const exports = factory(require)
    loadCache.set(spec, exports)
    return exports
  }
  const replacementExports = require('@deepseek-ai/dsh-plugin-api-session-channel-gateway')
  const fakeCtx = { effect() {}, provide() {}, get() { return undefined }, connection: undefined }
  replacementExports.apply(fakeCtx)
  const result = await fakeCtx.sessionChannel.call('open', {})
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'transport-unavailable')
})