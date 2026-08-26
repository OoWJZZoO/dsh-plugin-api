import test from 'node:test'
import assert from 'node:assert/strict'
import { runClientHalfCheck, checkClientFile, checkClientManifest, CLIENT_WARNING_CODES, CLIENT_BLOCKING_CODES } from '../lib/client-check.js'

const OK_SOURCE = 'export const view = "hello"\n'

test('clean client source produces zero blocking and zero warnings', async () => {
  const result = await checkClientFile(OK_SOURCE, 'client.js')
  assert.deepEqual(result.blocking, [])
  assert.deepEqual(result.warnings, [])
})

test('syntax errors are blocking (client-blocking)', async () => {
  const source = 'export const = broken(('
  const result = await checkClientFile(source, 'broken.js')
  assert.equal(result.blocking.length, 1)
  assert.equal(result.blocking[0].code, 'syntax-error')
  assert.equal(result.blocking[0].subject, 'broken.js')
})

test('forbidden node built-in imports are blocking (the blocking classification)', async () => {
  const esm = 'import { readFileSync } from "node:fs"\nexport const x = 1\n'
  const result = await checkClientFile(esm, 'client.js')
  assert.equal(result.blocking.length, 1)
  assert.equal(result.blocking[0].code, 'forbidden-import')
  const dynamic = 'export async function load() { return import("node:path") }\n'
  const dynamicResult = await checkClientFile(dynamic, 'client.js')
  assert.equal(dynamicResult.blocking.length, 1)
  assert.equal(dynamicResult.blocking[0].code, 'forbidden-import')
})

test('dangerous sinks are non-blocking warnings with the shared vocabulary (the warning vocabulary)', async () => {
  const evalSource = 'export function run(code) { return eval(code) }\n'
  const evalResult = await checkClientFile(evalSource, 'client.js')
  assert.deepEqual(evalResult.blocking, [])
  assert.ok(evalResult.warnings.some((w) => w.code === 'eval'))

  const htmlSource = 'export function render(el, html) { el.innerHTML = html }\n'
  const htmlResult = await checkClientFile(htmlSource, 'client.js')
  assert.ok(htmlResult.warnings.some((w) => w.code === 'unsafe-inner-html'))

  const postSource = 'export function tell(target) { target.postMessage("msg", "*") }\n'
  const postResult = await checkClientFile(postSource, 'client.js')
  assert.ok(postResult.warnings.some((w) => w.code === 'wildcard-postmessage'))

  // all warning codes come from the shared vocabulary.
  for (const warning of [...evalResult.warnings, ...htmlResult.warnings, ...postResult.warnings]) {
    assert.ok(CLIENT_WARNING_CODES.includes(warning.code))
  }
})

test('dsh.client manifest conformance failures are blocking (the blocking classification)', () => {
  assert.deepEqual(checkClientManifest({ name: 'x' }), [])
  assert.deepEqual(checkClientManifest(undefined), [])
  const noPlatform = checkClientManifest({ dsh: { client: { inject: [] } } })
  assert.equal(noPlatform.length, 1)
  assert.ok(noPlatform[0].code, 'manifest-nonconformant')
  const badInject = checkClientManifest({ dsh: { client: { platform: 'web', inject: 'nope' } } })
  assert.equal(badInject.length, 1)
  const good = checkClientManifest({ dsh: { client: { platform: 'web', inject: ['@deepseek-ai/x'] } } })
  assert.deepEqual(good, [])
})

test('runClientHalfCheck aggregates blocking and shared clientWarnings', async () => {
  const staged = {
    manifest: { dsh: { client: { platform: 'web', inject: [] } } },
    clientFiles: [
      { name: 'ok.js', content: OK_SOURCE },
      { name: 'bad.js', content: 'import fs from "node:fs"\nexport const x = eval("1")\n' },
    ],
  }
  const result = await runClientHalfCheck(staged)
  assert.equal(result.blocking.length, 1)
  assert.equal(result.blocking[0].code, 'forbidden-import')
  assert.ok(result.warnings.some((w) => w.code === 'eval'))
  assert.equal(result.clientWarnings, result.warnings)
  for (const warning of result.clientWarnings) {
    assert.ok(CLIENT_WARNING_CODES.includes(warning.code))
  }
})

test('blocking codes all come from the shared blocking vocabulary', async () => {
  const staged = {
    manifest: { dsh: { client: {} } },
    clientFiles: [{ name: 'x.js', content: 'import z from "node:os"\nexport const broken = (((' }],
  }
  const result = await runClientHalfCheck(staged)
  assert.ok(result.blocking.length >= 2)
  for (const entry of result.blocking) {
    assert.ok(!['syntax-error', 'forbidden-import', 'manifest-nonconformant'].includes(entry.code) || CLIENT_BLOCKING_CODES.includes(entry.code))
  }
})