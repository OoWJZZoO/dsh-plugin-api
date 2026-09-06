/**
 * Client-bundle shape gate: the replacement client half is built (never
 * hand-edited) from the official bundle verbatim plus the wrapper; the module
 * id registration is preserved; the attention receiver channel is present;
 * the consumer `$on` allowlist vocabulary in the bundle is untouched.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const bundlePath = new URL('../lib/client.js', import.meta.url)
const bundle = readFileSync(bundlePath, 'utf8')

test('client bundle: registered under the official module id', () => {
  assert.match(bundle, /["']@deepseek-ai\/dsh-api-remotes["']/)
})

test('client bundle: contains the internal attention receiver channel (not a $on key)', () => {
  assert.match(bundle, /dsh-plugin-api\.attention\.receiver/)
  assert.match(bundle, /subscribe/)
})

test('client bundle: the extension event never leaks into the bundle key surface', () => {
  // The consumer `$on` legal key set is the reproduced official allowlist
  // (asserted host-side by the fork-integrity fixture); the extension event
  // must not appear in the browser bundle as a key set member.
  assert.equal(bundle.includes('attention/update'), false)
})

test('client bundle: checked-in artifact is reproducible from the build entry', async () => {
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'api-remotes-bundle-'))
  execFileSync('node', [new URL('../scripts/build-client.mjs', import.meta.url).pathname, '--out', join(dir, 'client.js')], { cwd: new URL('..', import.meta.url).pathname })
  const rebuilt = readFileSync(join(dir, 'client.js'), 'utf8')
  assert.equal(rebuilt, bundle, 'bundle must be byte-identical to the rebuild')
})

test('official bundle is never modified by the client-half build (stat + hash stable)', async () => {
  const { createHash } = await import('node:crypto')
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, statSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const officialPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-api-remotes/client'))
  const snapshot = () => {
    const stat = statSync(officialPath)
    return {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      hash: createHash('sha256').update(readFileSync(officialPath)).digest('hex'),
    }
  }
  const before = snapshot()
  const dir = mkdtempSync(join(tmpdir(), 'api-remotes-audit-'))
  execFileSync('node', [fileURLToPath(new URL('../scripts/build-client.mjs', import.meta.url)), '--out', join(dir, 'client.js')], { cwd: fileURLToPath(new URL('..', import.meta.url)) })
  const after = snapshot()
  assert.deepEqual(after, before, 'the official published bundle must remain untouched by the build')
})