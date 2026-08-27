/**
 * Shape and behavior tests for the built connection client bundle.
 *
 * The bundle is a browser classic script registering modules through
 * `window.__ModuleLoader__.load`. This test evaluates it in a VM with a
 * minimal module-loader mock and verifies:
 * - both module ids are registered (official + replacement);
 * - the replacement factory preserves the official exports;
 * - the wrapped apply attaches the incremental slices to the connection
 *   service;
 * - no secret material or governance tokens enter the bundle.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const bundlePath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const bundleSrc = readFileSync(bundlePath, 'utf8')

test('client bundle: exports["./client"] resolves', () => {
  assert.doesNotThrow(() => import.meta.resolve('@deepseek-ai/dsh-plugin-api-session-channel-connection/client'))
})

test('client bundle: contains both module registrations', () => {
  assert.match(bundleSrc, /id: "@deepseek-ai\/dsh-client-connection"/, 'official module id must be registered')
  assert.match(bundleSrc, /id: '@deepseek-ai\/dsh-plugin-api-session-channel-connection'/, 'replacement module id must be registered')
  assert.match(bundleSrc, /require\('@deepseek-ai\/dsh-client-connection'\)/, 'replacement factory must require the official module')
})

test('client bundle: official code inlined verbatim (not hand-modified)', () => {
  const officialPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-client-connection/client'))
  const officialSrc = readFileSync(officialPath, 'utf8')
  // The bundle must contain the official module registration verbatim
  // (modulo the stripped sourceMappingURL comment and trailing-whitespace
  // normalization applied by the build script for diff-clean artifacts).
  const officialRegistration = officialSrc
    .replace(/\n\/\/# sourceMappingURL=.*$/u, '')
    .replace(/[ \t]+$/gm, '')
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
  // Tokens are concatenated so this test source itself contains no literal labels.
  const governanceTokens = ['r1', 'SPEC1', 'SPEC2', 'SPEC3', 'ANY', 'RSC-', 'U' + '21', 'U' + '22', 'U' + '23']
  for (const token of governanceTokens) {
    assert.ok(!bundleSrc.includes(token), `bundle must not contain governance token "${token}"`)
  }
})

test('client bundle: both modules register and the replacement wraps official exports', () => {
  const factories = new Map()
  const moduleLoader = {
    load({ id, factory }) {
      factories.set(id, factory)
    },
  }
  vm.runInNewContext(bundleSrc, { window: { __ModuleLoader__: moduleLoader } })
  assert.ok(factories.has('@deepseek-ai/dsh-client-connection'), 'official module registered')
  assert.ok(factories.has('@deepseek-ai/dsh-plugin-api-session-channel-connection'), 'replacement module registered')

  // Materialize through ONE shared require so each module id resolves to a
  // single memoized instance (mirroring the real loader).
  const require = makeRequire(factories)
  const officialExports = require('@deepseek-ai/dsh-client-connection')
  const replacementExports = require('@deepseek-ai/dsh-plugin-api-session-channel-connection')

  // Official exports preserved
  assert.equal(typeof replacementExports.apply, 'function')
  assert.equal(typeof replacementExports.AbstractApiClient, 'function')
  assert.equal(replacementExports.inject, officialExports.inject)
  assert.equal(replacementExports.RpcId, officialExports.RpcId)
  assert.equal(replacementExports.transportError, officialExports.transportError)

  // Slices attached by the wrapped apply
  const provided = {}
  const fakeCtx = {
    fiber: { entry: { options: { config: { advertisedTransports: ['websocket', 'sse'], authorizedTransports: ['websocket'] } } } },
    provide(name, value) { provided[name] = value },
    get(name) { return provided[name] },
  }
  replacementExports.apply(fakeCtx)
  const connection = provided.connection
  assert.ok(connection, 'connection service provided')
  assert.equal(typeof connection.transport, 'object')
  // Spread into an outer-realm array: VM-created arrays have a different
  // Array.prototype, so deepStrictEqual would compare prototypes and fail.
  assert.deepEqual([...connection.transport.negotiated()], ['websocket'])
  assert.equal(typeof connection.fencing.bind, 'function')
  assert.equal(typeof connection.resume.reattach, 'function')
})

test('client bundle: wrapped apply leaves official surface intact when ctx has no get', () => {
  const factories = new Map()
  const moduleLoader = { load({ id, factory }) { factories.set(id, factory) } }
  vm.runInNewContext(bundleSrc, { window: { __ModuleLoader__: moduleLoader } })
  const provided = {}
  const minimalCtx = { provide(name, value) { provided[name] = value } }
  const replacementExports = factories.get('@deepseek-ai/dsh-plugin-api-session-channel-connection')(makeRequire(factories))
  assert.doesNotThrow(() => replacementExports.apply(minimalCtx))
  assert.ok(provided.connection, 'official connection service still provided')
})

function makeRequire(factories) {
  // Mirror the real client module loader: materialized factories are memoized
  // in a loadCache, so each module id resolves to a single instance.
  const loadCache = new Map()
  const require = (spec) => {
    if (loadCache.has(spec)) return loadCache.get(spec)
    const factory = factories.get(spec)
    if (!factory) throw new Error(`no registered factory for "${spec}"`)
    const exports = factory(require)
    loadCache.set(spec, exports)
    return exports
  }
  return require
}