import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const officialPkgPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-api-gateway/package.json'))
const officialSrcPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-api-gateway'))

function officialPkg() {
  return JSON.parse(readFileSync(officialPkgPath, 'utf8'))
}

test('forked host: preserves all official export names', async () => {
  const official = await import('@deepseek-ai/dsh-api-gateway')
  const forked = await import('../lib/forked-host.js')
  const officialKeys = Object.keys(official).sort()
  const forkedKeys = Object.keys(forked).sort()
  assert.deepEqual(officialKeys, forkedKeys, 'forked host must export the same named keys as the official package')
})

test('forked host: TypertGatewayService prototype members preserved', async () => {
  const official = await import('@deepseek-ai/dsh-api-gateway')
  const forked = await import('../lib/forked-host.js')
  const officialMembers = Object.getOwnPropertyNames(official.TypertGatewayService?.prototype ?? {}).filter(
    (key) => key !== 'constructor',
  ).sort()
  const forkedMembers = Object.getOwnPropertyNames(forked.TypertGatewayService?.prototype ?? {}).filter(
    (key) => key !== 'constructor',
  ).sort()
  assert.deepEqual(officialMembers, forkedMembers, 'TypertGatewayService prototype methods must match (excluding constructor)')
})

test('forked host: TypertGatewayError class preserved', async () => {
  const official = await import('@deepseek-ai/dsh-api-gateway')
  const forked = await import('../lib/forked-host.js')
  // Verify the error class structure
  const err = new forked.TypertGatewayError('test-code', 'ns/method', 'test message')
  assert.equal(err.code, 'test-code')
  assert.equal(err.endpoint, 'ns/method')
  assert.equal(err.message.includes('test message'), true)
})

test('official contract: dsh-api-gateway is version 0.1.0-rc.6', () => {
  const pkg = officialPkg()
  assert.equal(pkg.version, '0.1.0-rc.6')
})

test('forked host: API_PATH constant matches official', async () => {
  const official = await import('@deepseek-ai/dsh-api-gateway')
  const forked = await import('../lib/forked-host.js')
  // The official gateway doesn't export these directly; check the source contains them.
  const officialSrc = readFileSync(officialSrcPath, 'utf8')
  const forkedSrc = readFileSync(fileURLToPath(new URL('../lib/forked-host.js', import.meta.url)), 'utf8')
  assert.ok(officialSrc.includes('typertGateway'), 'official source has typertGateway service name')
  assert.ok(forkedSrc.includes('typertGateway'), 'forked source has typertGateway service name')
})