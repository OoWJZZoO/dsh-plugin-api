import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('package.json is parseable and exposes the expected entry points', () => {
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.main, 'lib/index.js')
  assert.equal(pkg.exports['.'], './lib/index.js')
  assert.equal(pkg.exports['./package.json'], './package.json')
})

test('dsh.api is a major.minor contract', () => {
  assert.ok(pkg.dsh, 'package.json must declare the dsh field')
  assert.equal(typeof pkg.dsh.api, 'string')
  assert.match(pkg.dsh.api, /^\d+\.\d+$/)
  assert.equal(pkg.dsh.api, '0.1')
})

test('peerDependencies keep shared host instances for the facade base', () => {
  assert.equal(typeof pkg.peerDependencies['@deepseek-ai/cordis'], 'string')
  assert.equal(typeof pkg.peerDependencies['@deepseek-ai/dsh-llm'], 'string')

  assert.equal(typeof pkg.peerDependencies['@deepseek-ai/dsh-scope'], 'string')
  assert.equal(typeof pkg.peerDependencies['@deepseek-ai/dsh-session'], 'string')
  assert.equal(typeof pkg.peerDependencies['@deepseek-ai/dsh-settings'], 'string')
})

test('peerDependencies include the SV15 session-reference public export host package', () => {
  assert.equal(typeof pkg.peerDependencies['@deepseek-ai/dsh-session-reference'], 'string')
})

test('capability services feature adds no runtime dependencies', () => {
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0)
})
