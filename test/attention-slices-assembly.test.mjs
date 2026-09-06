/**
 * Cross-slice assembly regression tests: the two replacement slices assemble
 * together on the web profile, each claims exactly one route, an identity
 * mismatch along one slice degrades only that slice, and the installation is
 * never left with an official row disabled and nothing working (no hollow).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { createApiRemotesApply } from '../packages/api-remotes/lib/apply.js'
import { FORWARDER_OWNER_SYMBOL } from '../packages/api-remotes/lib/shared-vocab.js'
import { createClientRuntimeApply } from '../packages/client-runtime/lib/apply.js'
import { RUNTIME_OWNER_SYMBOL } from '../packages/client-runtime/lib/shared-vocab.js'

const WEB_BASE = [
  { insert: [
    { id: 'api-remotes', name: '@deepseek-ai/dsh-api-remotes' },
    { id: 'client-runtime', name: '@deepseek-ai/dsh-client-runtime' },
  ] },
]

const AUX = [
  { id: 'api-remotes', disabled: true },
  { insert: [{ id: 'plugin-api-api-remotes', name: '@deepseek-ai/dsh-plugin-api-api-remotes', inject: ['loader'] }] },
  { id: 'client-runtime', disabled: true },
  { insert: [{ id: 'plugin-api-client-runtime', name: '@deepseek-ai/dsh-plugin-api-client-runtime', inject: ['loader'] }] },
]

test('assembly: both official rows disabled and both replacement rows inserted', () => {
  const entries = composeEntries([WEB_BASE, AUX])
  const byId = new Map(entries.map((entry) => [entry.id ?? entry.options?.id, entry]))
  assert.equal(byId.get('api-remotes').disabled, true)
  assert.equal(byId.get('client-runtime').disabled, true)
  assert.ok(byId.get('plugin-api-api-remotes'))
  assert.ok(byId.get('plugin-api-client-runtime'))
})

function rows() {
  return [
    { id: 'api-remotes', disabled: true },
    { id: 'client-runtime', disabled: true },
  ]
}

function fakeCtx() {
  const logs = []
  const ctx = {
    loader: { entries: () => rows().map((row) => ({ options: { id: row.id }, disabled: row.disabled })) },
    logger: { warn: (m) => logs.push(m), debug() {} },
    get: () => undefined,
    on: () => () => {},
  }
  ctx.__logs = logs
  return ctx
}

function remotesOk() {
  return {
    readPackageVersion: (pkg) => (pkg === '@deepseek-ai/dsh-api-remotes' ? '0.1.0-rc.6' : '0.1.0-rc.6-0.1.0'),
    readPackageApi: () => '0.1',
    resolveSource: () => ({ subscribe: () => () => {} }),
    resolveStream: () => ({ push: () => {} }),
  }
}

function runtimeOk() {
  return {
    readPackageVersion: (pkg) => (pkg === '@deepseek-ai/dsh-client-runtime' ? '0.1.0-rc.6' : '0.1.0-rc.6-0.1.0'),
    readPackageApi: () => '0.1',
    probeBundle: () => true,
  }
}

test('assembly: both slices claim exactly one route each with no double-run', () => {
  const ctx = fakeCtx()
  const firstRemotes = createApiRemotesApply(remotesOk())(ctx)
  assert.equal(typeof firstRemotes, 'function')
  assert.equal(ctx[FORWARDER_OWNER_SYMBOL], true)
  const secondRemotes = createApiRemotesApply(remotesOk())(ctx)
  assert.equal(secondRemotes, undefined)
  const firstRuntime = createClientRuntimeApply(runtimeOk())(ctx)
  assert.equal(typeof firstRuntime, 'function')
  assert.equal(ctx[RUNTIME_OWNER_SYMBOL], true)
  const secondRuntime = createClientRuntimeApply(runtimeOk())(ctx)
  assert.equal(secondRuntime, undefined)
})

test('assembly: an identity mismatch on one slice degrades only that slice', () => {
  const ctx = fakeCtx()
  const staleRemotes = createApiRemotesApply({
    ...remotesOk(),
    readPackageVersion: (pkg) => (pkg === '@deepseek-ai/dsh-api-remotes' ? '0.1.0-rc.7' : '0.1.0-rc.6-0.1.0'),
  })(ctx)
  assert.equal(staleRemotes, undefined)
  assert.equal(ctx[FORWARDER_OWNER_SYMBOL], undefined)
  assert.ok(ctx.__logs.some((line) => /identity mismatch/.test(line)))
  // the client-runtime slice is unaffected by the api-remotes mismatch
  const runtimeDisposer = createClientRuntimeApply(runtimeOk())(ctx)
  assert.equal(typeof runtimeDisposer, 'function')
  assert.equal(ctx[RUNTIME_OWNER_SYMBOL], true)
})

test('assembly: no hollow — each replacement bundle still serves its official client half', () => {
  const apiBundle = readFileSync(fileURLToPath(new URL('../packages/api-remotes/lib/client.js', import.meta.url)), 'utf8')
  const runtimeBundle = readFileSync(fileURLToPath(new URL('../packages/client-runtime/lib/client.js', import.meta.url)), 'utf8')
  assert.ok(apiBundle.includes('@deepseek-ai/dsh-api-remotes'))
  assert.ok(runtimeBundle.includes('@deepseek-ai/dsh-client-runtime'))
  // the extension event never reaches either bundle's key surface
  assert.equal(apiBundle.includes('attention/update'), false)
  assert.equal(runtimeBundle.includes('attention/update'), false)
})

test('assembly: cross-package markers are distinct and fixed', () => {
  assert.notEqual(FORWARDER_OWNER_SYMBOL, RUNTIME_OWNER_SYMBOL)
  assert.equal(String(FORWARDER_OWNER_SYMBOL), 'Symbol(dsh-plugin-api.api-remotes.contract)')
  assert.equal(String(RUNTIME_OWNER_SYMBOL), 'Symbol(dsh-plugin-api.client-runtime.contract)')
})