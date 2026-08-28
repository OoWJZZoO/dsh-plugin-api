import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('package.json is parseable and exposes the expected entry points', () => {
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.name, '@deepseek-ai/dsh-plugin-api-main')
  assert.equal(pkg.main, 'lib/index.js')
  assert.equal(pkg.exports['.'], './lib/index.js')
  assert.equal(pkg.exports['./package.json'], './package.json')
  assert.equal(pkg.exports['./profile-fold'], './lib/profile-fold.js')
})

test('dsh.api is a major.minor contract', () => {
  assert.ok(pkg.dsh, 'package.json must declare the dsh field')
  assert.equal(typeof pkg.dsh.api, 'string')
  assert.match(pkg.dsh.api, /^\d+\.\d+$/)
  assert.equal(pkg.dsh.api, '0.1')
})

test('package version is the full unique version: <runtime-full-version>-<api-generation>.<api-increment>.<maintenance>', () => {
  const match = pkg.version.match(/^(.+)-(\d+\.\d+)\.(\d+)$/)
  assert.ok(match, 'version must follow <runtime>-<api-generation>.<api-increment>.<maintenance>')
  const apiPart = match[2]
  const maintenance = match[3]
  assert.equal(apiPart, pkg.dsh.api, 'version api part must equal dsh.api')
  assert.equal(maintenance, '0', 'the frozen baseline shares maintenance component 0')
  assert.equal(pkg.version, '0.1.0-rc.6-0.1.0')
})

test('the protocol stays in the reserved pre-release generation and never promotes the reserved 1.0', () => {
  const [major, minor] = pkg.dsh.api.split('.').map(Number)
  assert.equal(major, 0)
  assert.equal(minor, 1)
  assert.notEqual(pkg.dsh.api, '1.0')
})

test('peerDependencies keep shared host instances for the facade base', () => {
  assert.equal(typeof pkg.peerDependencies['@deepseek-ai/cordis'], 'string')
  assert.equal(typeof pkg.peerDependencies['@deepseek-ai/dsh-llm'], 'string')

  assert.equal(typeof pkg.peerDependencies['@deepseek-ai/dsh-scope'], 'string')
  assert.equal(typeof pkg.peerDependencies['@deepseek-ai/dsh-session'], 'string')
  assert.equal(typeof pkg.peerDependencies['@deepseek-ai/dsh-settings'], 'string')
})

test('peerDependencies include the session-reference public export host package', () => {
  assert.equal(typeof pkg.peerDependencies['@deepseek-ai/dsh-session-reference'], 'string')
})

test('peerDependencies are the exact union of facade host and durable-audit identities', () => {
  const expected = [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-scope',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-system-prompt',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-session-reference',
    '@deepseek-ai/dsh-user-approval',
    '@deepseek-ai/dsh-schedule',
    '@deepseek-ai/dsh-subagent',
    '@deepseek-ai/dsh-subagent-in-process-driver',
    '@deepseek-ai/dsh-agent-loop',
    '@deepseek-ai/dsh-typert-registry',
    '@deepseek-ai/dsh-typert-protocol',
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-client-ui-settings',
  ]
  assert.deepEqual(Object.keys(pkg.peerDependencies), expected)
  assert.equal(pkg.peerDependencies['@deepseek-ai/cordis'], '^4.0.1')
  for (const name of expected.slice(1)) {
    assert.equal(pkg.peerDependencies[name], '^0.1.0-rc.6')
  }
})

test('the profile-composition folding parser is the only runtime dependency', () => {
  assert.ok(pkg.dependencies, 'package.json must declare the fold-parser dependency')
  assert.deepEqual(Object.keys(pkg.dependencies), ['js-yaml'])
  assert.match(pkg.dependencies['js-yaml'], /^\^?4\./)
})
