/**
 * Official-contract parity fixture gate (capability-strategy R2): the vendored
 * fork reproduces the official `@deepseek-ai/dsh-client-runtime` host entry
 * and the browser-module manifest half.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

test('forked host: preserves every official export name', async () => {
  const official = await import('@deepseek-ai/dsh-client-runtime')
  const forked = await import('../lib/forked-host.js')
  const officialKeys = Object.keys(official).sort()
  const forkedKeys = Object.keys(forked).sort()
  assert.deepEqual(forkedKeys, officialKeys)
})

test('forked host: the official host apply remains a no-op', async () => {
  const forked = await import('../lib/forked-host.js')
  const official = await import('@deepseek-ai/dsh-client-runtime')
  const forkedResult = forked.apply({})
  const officialResult = official.apply({})
  assert.equal(forkedResult, officialResult)
  assert.equal(forkedResult, undefined)
})

test('forked host: the vendored source is verbatim official', () => {
  const officialPkgPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-client-runtime'))
  const officialSource = readFileSync(officialPkgPath, 'utf8')
  const forkedSource = readFileSync(fileURLToPath(new URL('../lib/forked-host.js', import.meta.url)), 'utf8')
  const headerEnd = forkedSource.indexOf('//#region lib/types/index.js')
  assert.ok(headerEnd >= 0, 'fork must carry the official source')
  assert.equal(forkedSource.slice(headerEnd), officialSource)
})

test('replacement package: client manifest reproduces official inject list', () => {
  const official = JSON.parse(readFileSync(
    fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-client-runtime/package.json')),
    'utf8',
  ))
  const own = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  assert.deepEqual(own.dsh.client.inject, official.dsh.client.inject)
  assert.equal(own.dsh.client.platform, 'web')
  assert.equal(own.dsh.client.immediately, true)
})