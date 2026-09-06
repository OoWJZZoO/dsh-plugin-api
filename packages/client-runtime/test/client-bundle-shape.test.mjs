/**
 * Client-bundle shape gate: the replacement client half is built (never
 * hand-edited) from the official bundle verbatim plus the inlined attention
 * runtime and the wrapper; the official module id is preserved, the browser
 * module contract names are present, and the internal runtime contract symbol
 * is installed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const bundlePath = new URL('../lib/client.js', import.meta.url)
const bundle = readFileSync(bundlePath, 'utf8')

test('client bundle: registered under the official module id', () => {
  assert.match(bundle, /["']@deepseek-ai\/dsh-client-runtime["']/)
})

test('client bundle: preserves the reproduced browser-module contract names', () => {
  for (const name of ['connection/reset', 'slots/changed', 'conversationEvents', 'conversationViews']) {
    assert.ok(bundle.includes(name), `bundle must preserve official contract name ${name}`)
  }
})

test('client bundle: the internal attention runtime contract is present', () => {
  assert.ok(bundle.includes('dsh-plugin-api.attention.runtime'))
  assert.ok(bundle.includes('createBrowserAttentionRuntime'))
  assert.ok(bundle.includes('dsh-plugin-api.attention.request-channel'))
})

test('client bundle: the extension event stays out of the bundle key surface', () => {
  assert.equal(bundle.includes('attention/update'), false)
  assert.equal(bundle.includes('$on'), false)
})

test('client bundle: checked-in artifact is reproducible from the build entry', async () => {
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'client-runtime-bundle-'))
  execFileSync('node', [fileURLToPath(new URL('../scripts/build-client.mjs', import.meta.url)), '--out', join(dir, 'client.js')], { cwd: fileURLToPath(new URL('..', import.meta.url)) })
  const rebuilt = readFileSync(join(dir, 'client.js'), 'utf8')
  assert.equal(rebuilt, bundle, 'bundle must be byte-identical to the rebuild')
})

test('official bundle is never modified by the client-half build (stat + hash stable)', async () => {
  const { createHash } = await import('node:crypto')
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, statSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const officialPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-client-runtime/client'))
  const snapshot = () => {
    const stat = statSync(officialPath)
    return {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      hash: createHash('sha256').update(readFileSync(officialPath)).digest('hex'),
    }
  }
  const before = snapshot()
  const dir = mkdtempSync(join(tmpdir(), 'client-runtime-audit-'))
  execFileSync('node', [fileURLToPath(new URL('../scripts/build-client.mjs', import.meta.url)), '--out', join(dir, 'client.js')], { cwd: fileURLToPath(new URL('..', import.meta.url)) })
  const after = snapshot()
  assert.deepEqual(after, before, 'the official published bundle must remain untouched by the build')
})