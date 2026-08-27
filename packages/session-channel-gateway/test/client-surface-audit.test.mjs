/**
 * Client-surface audit for the gateway replacement package.
 *
 * The official `@deepseek-ai/dsh-api-gateway` row's six client-surface checks
 * are POSITIVE (it declares a `dsh.client` manifest, ships a browser bundle,
 * and exposes a client `remote` service), so the replacement must provide a
 * complete client half (self-maintained bundle build).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const officialPkgPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-api-gateway/package.json'))
const ownPkgPath = fileURLToPath(new URL('../package.json', import.meta.url))

function officialPkg() {
  return JSON.parse(readFileSync(officialPkgPath, 'utf8'))
}

function ownPkg() {
  return JSON.parse(readFileSync(ownPkgPath, 'utf8'))
}

test('audit 1: official row declares a dsh.client manifest (positive check)', () => {
  const manifest = officialPkg().dsh?.client
  assert.ok(manifest, 'official gateway row declares dsh.client')
  assert.equal(manifest.platform, 'web')
})

test('audit 2: official package ships a browser bundle (positive check)', () => {
  const files = officialPkg().files ?? []
  assert.ok(files.includes('lib/client.js'), 'official package ships lib/client.js')
})

test('audit 3: official package exposes ./client export face (positive check)', () => {
  const exports = officialPkg().exports ?? {}
  assert.ok('./client' in exports, 'official package exposes ./client')
})

test('replacement: declares its own dsh.client manifest', () => {
  const manifest = ownPkg().dsh?.client
  assert.ok(manifest, 'replacement package must declare dsh.client (client half)')
  assert.equal(manifest.platform, 'web')
})

test('replacement: exposes ./client export face', () => {
  const exports = ownPkg().exports ?? {}
  assert.ok('./client' in exports, 'replacement package must expose ./client')
})

test('replacement: ships a built client bundle', () => {
  const bundlePath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
  const src = readFileSync(bundlePath, 'utf8')
  assert.ok(src.includes('window.__ModuleLoader__.load'), 'client bundle must be a module-loader registration')
  assert.ok(src.includes('@deepseek-ai/dsh-plugin-api-session-channel-gateway'), 'bundle registers the replacement module id')
})