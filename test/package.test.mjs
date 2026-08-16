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
})

test('peerDependencies keep shared host instances for the facade base', () => {
  assert.equal(typeof pkg.peerDependencies['@deepseek-ai/cordis'], 'string')
  assert.equal(typeof pkg.peerDependencies['@deepseek-ai/dsh-llm'], 'string')
  assert.equal(typeof pkg.peerDependencies['@deepseek-ai/dsh-scope'], 'string')
  assert.equal(typeof pkg.peerDependencies['@deepseek-ai/dsh-session'], 'string')
})
