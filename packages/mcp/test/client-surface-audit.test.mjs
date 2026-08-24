import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const officialPkgPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-mcp-client/package.json'))
const officialIndexPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-mcp-client'))

function officialPkg() {
  return JSON.parse(readFileSync(officialPkgPath, 'utf8'))
}

/**
 * Six negative client-surface checks against the locked official package.
 * If any check turns positive the replacement must re-run the six-step audit
 * in a new Requirements/Design revision before enabling any client behavior.
 */
test('audit 1: no dsh.client manifest', () => {
  const manifest = officialPkg().dsh
  if (manifest === undefined || manifest.client === undefined) {
    assert.ok(true, 'no dsh.client manifest')
    return
  }
  assert.fail('dsh.client manifest appeared; requires a client-surface audit revision')
})

test('audit 2: no remote namespace surface', () => {
  const exports = officialPkg().exports ?? {}
  assert.ok(!('./remote' in exports) && !('./client' in exports), 'no client/remote export face')
  assert.ok(!officialIndexPath.includes('/lib/client'), 'no lib/client module')
})

test('audit 3: no slot or settings bridge', () => {
  const src = readFileSync(officialIndexPath, 'utf8')
  // Browser-only symbols would indicate a client/UI bridge; the host module
  // must not reference any of them. ("stability window" in a comment is not
  // browser code, so we check concrete browser APIs only.)
  for (const token of ['document.', 'localStorage', 'navigator.', 'addEventListener', 'window.']) {
    assert.ok(!src.includes(token), `host module must not reference browser API "${token}"`)
  }
  const header = src.split('\n').slice(0, 20).join('\n')
  assert.ok(!/slot|settingsBridge|settings-bridge/i.test(header))
})

test('audit 4: no host/client version negotiation', () => {
  const pkg = officialPkg()
  assert.ok(!pkg.dsh?.client, 'no client version negotiation manifest')
})

test('audit 5: no browser-side state/reconnect surface', () => {
  const src = readFileSync(officialIndexPath, 'utf8')
  for (const token of ['document.', 'localStorage', 'navigator.', 'addEventListener', 'window.']) {
    assert.ok(!src.includes(token), `no browser-side state code (found "${token}")`)
  }
  // host reconnect is a child-process supervisor, not a browser client lifecycle
  const files = officialPkg().files ?? []
  assert.ok(files.every((file) => !/browser|client\/index/.test(file)))
})

test('audit 6: no client-facing event/service', () => {
  const exports = officialPkg().exports ?? {}
  const keys = Object.keys(exports)
  assert.deepEqual(
    keys.sort(),
    ['.', './invariant', './package.json', './src/*'].sort(),
    'only host + invariant import faces exist',
  )
})

test('host-only classification stays valid: package publishes no client bundle', () => {
  const files = officialPkg().files ?? []
  assert.ok(!files.some((file) => file.includes('client.js') || file.includes('bundle')), 'no client bundle published')
})
