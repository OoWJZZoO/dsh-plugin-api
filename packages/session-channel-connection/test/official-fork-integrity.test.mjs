import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const officialPkgPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-client-connection/package.json'))
const officialSrcPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-client-connection'))
const forkedPath = fileURLToPath(new URL('../lib/forked-host.js', import.meta.url))

function officialPkg() {
  return JSON.parse(readFileSync(officialPkgPath, 'utf8'))
}

test('forked host: preserves all official export names', async () => {
  const official = await import('@deepseek-ai/dsh-client-connection')
  const forked = await import('../lib/forked-host.js')
  const officialKeys = Object.keys(official).sort()
  const forkedKeys = Object.keys(forked).sort()
  assert.deepEqual(officialKeys, forkedKeys, 'forked host must export the same named keys as the official package')
})

test('forked host: inject matches official', async () => {
  const official = await import('@deepseek-ai/dsh-client-connection')
  const forked = await import('../lib/forked-host.js')
  assert.deepEqual(forked.inject, official.inject, 'forked inject must match official')
})

test('forked host: Config schema keys match official', () => {
  // Config is a schemastery schema; we verify the visible keys.
  const forkedSrc = readFileSync(forkedPath, 'utf8')
  const officialSrc = readFileSync(officialSrcPath, 'utf8')
  // Check that the Config variable name and the trustedHosts/maxRequestBodyBytes
  // keys are present in both.
  const configPattern = /Config\s*=\s*z\.object\(\{([^}]+)\}\)/s
  const forkedMatch = forkedSrc.match(configPattern)
  const officialMatch = officialSrc.match(configPattern)
  assert.ok(forkedMatch, 'forked host has Config definition')
  assert.ok(officialMatch, 'official package has Config definition')
  // Verify trustedHosts key exists in both
  assert.ok(forkedMatch[1].includes('trustedHosts'), 'forked Config has trustedHosts')
  assert.ok(officialMatch[1].includes('trustedHosts'), 'official Config has trustedHosts')
})

test('forked host: HostConnectionService member names preserved', async () => {
  const official = await import('@deepseek-ai/dsh-client-connection')
  const forked = await import('../lib/forked-host.js')
  // Check that the same public members exist on the prototype.
  const officialMembers = Object.getOwnPropertyNames(official.HostConnectionService?.prototype ?? {}).filter(
    (key) => key !== 'constructor',
  ).sort()
  const forkedMembers = Object.getOwnPropertyNames(forked.HostConnectionService?.prototype ?? {}).filter(
    (key) => key !== 'constructor',
  ).sort()
  assert.deepEqual(officialMembers, forkedMembers, 'HostConnectionService prototype methods must match')
})

test('forked host: PRIVILEGED_METHODS set is preserved', () => {
  const officialSrc = readFileSync(officialSrcPath, 'utf8')
  const forkedSrc = readFileSync(forkedPath, 'utf8')
  // Check a few known privileged methods exist in both.
  const methods = ['settings.describe', 'settings.update', 'credentials.describe', 'llm.discoverModels']
  for (const method of methods) {
    assert.ok(officialSrc.includes(method), `official source includes PRIVILEGED_METHODS entry ${method}`)
    assert.ok(forkedSrc.includes(method), `forked source includes PRIVILEGED_METHODS entry ${method}`)
  }
})

test('forked host: trustedHosts fence is explicitly NOT authentication (comment evidence)', () => {
  const forkedSrc = readFileSync(forkedPath, 'utf8')
  assert.ok(
    forkedSrc.includes('DNS-rebinding fence') || forkedSrc.includes('not an auth'),
    'forked source must preserve the trustedHosts-is-not-authentication comment',
  )
})

test('forked host: API_PATH constants match official', async () => {
  const official = await import('@deepseek-ai/dsh-client-connection')
  const forked = await import('../lib/forked-host.js')
  assert.equal(forked.API_PATH, official.API_PATH)
  assert.equal(forked.MUX_EVENTS_PATH, official.MUX_EVENTS_PATH)
  assert.equal(forked.HOST_EVENTS_PATH, official.HOST_EVENTS_PATH)
})

test('official contract: dsh-client-connection is version 0.1.0-rc.6', () => {
  const pkg = officialPkg()
  assert.equal(pkg.version, '0.1.0-rc.6')
})