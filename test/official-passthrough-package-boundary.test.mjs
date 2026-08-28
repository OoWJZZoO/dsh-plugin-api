import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const readPackage = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))

const MAIN = readPackage('package.json')

test('package protocol metadata stays mutually consistent and atomic while the client work is delivered', () => {
  const auxiliary = [
    ['packages/compaction-events/package.json', readPackage('packages/compaction-events/package.json')],
    ['packages/session-title/package.json', readPackage('packages/session-title/package.json')],
    ['packages/attachments/package.json', readPackage('packages/attachments/package.json')],
    ['packages/full/package.json', readPackage('packages/full/package.json')],
  ]
  for (const [path, pkg] of auxiliary) {
    assert.equal(pkg.version, MAIN.version, `${path} version must equal the main package version`)
    assert.equal(pkg.dsh?.api, MAIN.dsh?.api, `${path} dsh.api must equal the main package dsh.api`)
  }
  // The full unique version is `<runtime>-<api generation>.<api increment>.<maintenance>`;
  // the runtime part must be present and the api part must equal the installed
  // facade dsh.api.
  const match = /^(.+)-(\d+\.\d+)\.(\d+)$/.exec(MAIN.version)
  assert.ok(match, `version ${MAIN.version} must carry the runtime and api protocol parts`)
  assert.equal(match[2], MAIN.dsh?.api, 'the api protocol part must agree with dsh.api')
  assert.equal(match[3], '0', 'the frozen baseline shares maintenance component 0')
  assert.ok(match[1].length > 0)
  assert.equal(typeof MAIN.dsh?.client?.inject, 'object')
})

test('the optional module loader adds no peer dependency and no hard client injection', () => {
  assert.equal(MAIN.dsh.client.inject.includes('@deepseek-ai/dsh-client-modules'), false,
    'the module loader must stay an optional browser substrate')
  for (const [path, pkg] of [
    ['packages/compaction-events/package.json', readPackage('packages/compaction-events/package.json')],
    ['packages/session-title/package.json', readPackage('packages/session-title/package.json')],
  ]) {
    assert.equal(Object.keys(pkg.peerDependencies ?? {}).includes('@deepseek-ai/dsh-client-modules'), false,
      `${path} must not add the module loader as a peer`)
    assert.equal(pkg.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-modules') ?? false, false,
      `${path} must not add the module loader to a client inject list`)
  }
  assert.equal(Object.keys(MAIN.peerDependencies).includes('@deepseek-ai/dsh-client-modules'), false)
})
