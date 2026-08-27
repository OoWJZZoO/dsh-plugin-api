import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as official from '@deepseek-ai/dsh-llm'
import * as fork from '../lib/forked-runtime.js'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const baseline = readFileSync(join(here, '..', 'OFFICIAL_AUDIT_BASELINE.md'), 'utf8')
const require = createRequire(import.meta.url)

/** The single permitted prototype method addition (documented in the baseline). */
const PROTOTYPE_WHITELIST = new Set(['_decorationChainFor'])

function exportNames(mod) {
  return Object.keys(mod).filter((key) => key !== '__esModule').sort()
}

test('the fork export set equals the installed official export set', () => {
  const officialNames = exportNames(official)
  const forkNames = exportNames(fork)
  assert.deepEqual(forkNames, officialNames, 'the fork must export exactly the official surface')
  assert.ok(officialNames.length >= 39, 'sanity: the official package must export its full surface')
})

test('the official import resolves to the official module, not the replacement', () => {
  const resolved = require.resolve('@deepseek-ai/dsh-llm')
  assert.ok(!resolved.includes('dsh-plugin-api-llm'), `official import must not resolve to the replacement: ${resolved}`)
  assert.ok(resolved.includes('dsh-llm'), `official import must resolve into dsh-llm: ${resolved}`)
})

test('LlmRuntime.prototype method set matches official except the documented whitelist', () => {
  const officialMethods = new Set(Object.getOwnPropertyNames(official.LlmRuntime.prototype))
  const forkMethods = new Set(Object.getOwnPropertyNames(fork.LlmRuntime.prototype))
  const missing = [...officialMethods].filter((name) => !forkMethods.has(name))
  const extra = [...forkMethods].filter((name) => !officialMethods.has(name))
  assert.deepEqual(missing, [], 'the fork must not drop any official prototype member')
  const unexplained = extra.filter((name) => !PROTOTYPE_WHITELIST.has(name))
  assert.deepEqual(unexplained, [], 'every added prototype member must be whitelisted')
})

test('the fork preserves the official event names', () => {
  // The official event surface is emitted by the runtime's own methods; the
  // fork must keep the two public event names intact.
  assert.match(fork.LlmRuntime.prototype.emitAdaptersUpdated.toString(), /llm\/adapters-updated/)
  assert.match(fork.LlmRuntime.prototype.streamWithRegistration.toString(), /llm\/stream/)
})

test('the audit baseline documents every difference and the prototype whitelist', () => {
  assert.match(baseline, /@deepseek-ai\/dsh-llm/)
  assert.match(baseline, /0\.1\.0-rc\.6/)
  assert.match(baseline, /1407 lines/)
  assert.match(baseline, /_decorationChainFor/)
  assert.match(baseline, /_consumeAdapterIterator/)
  assert.match(baseline, /six-negative/)
  assert.match(baseline, /host-only/)
  assert.match(baseline, /Official import resolution/)
})

test('no governance tokens leak into the fork implementation', () => {
  const source = readFileSync(join(here, '..', 'lib', 'forked-runtime.js'), 'utf8')
  // Built by concatenation so this audit source itself carries no literal token.
  const tokens = [
    'AD' + '-R',
    'U' + '20',
    'SPEC' + '1',
    'SPEC' + '2',
    'SPEC' + '3',
    'A' + '-class',
    'R' + '-class',
  ]
  for (const token of tokens) {
    assert.ok(!source.includes(token), `fork source must not contain governance token "${token}"`)
  }
})

test('the fork package carries no client build surface', () => {
  const manifest = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
  assert.equal(manifest.dsh?.client, undefined, 'the replacement package must have no dsh.client manifest')
  assert.ok(!manifest.exports || !manifest.exports['./client'], 'the replacement package must not export a client bundle')
  assert.ok(!require.resolve('node:fs').endsWith('client.js'))
})
