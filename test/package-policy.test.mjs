import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const readPackage = (...parts) => JSON.parse(readFileSync(join(here, ...parts), 'utf8'))

const main = readPackage('..', 'package.json')
const compaction = readPackage('..', 'packages', 'compaction-events', 'package.json')
const sessionTitle = readPackage('..', 'packages', 'session-title', 'package.json')
const mcp = readPackage('..', 'packages', 'mcp', 'package.json')
const attachments = readPackage('..', 'packages', 'attachments', 'package.json')
const routePolicy = readPackage('..', 'packages', 'agent-loop', 'package.json')
const sessionBranch = readPackage('..', 'packages', 'session-branch', 'package.json')
const profileManager = readPackage('..', 'packages', 'profile-manager', 'package.json')
const full = readPackage('..', 'packages', 'full', 'package.json')

test('main, auxiliary, and full packages all share the unified full-version + dsh.api policy', () => {
  for (const pkg of [main, compaction, sessionTitle, mcp, attachments, routePolicy, sessionBranch, profileManager, full]) {
    assert.match(pkg.version, /^(.+)-(\d+\.\d+)$/, `${pkg.name}: full unique version shape`)
    assert.equal(pkg.version.match(/^(.+)-(\d+\.\d+)$/)[2], pkg.dsh.api, `${pkg.name}: version suffix must equal dsh.api`)
    assert.equal(pkg.dsh.api, main.dsh.api, `${pkg.name}: API protocol must equal the main package`)
    assert.equal(pkg.version.match(/^(.+)-\d+\.\d+$/)[1], main.version.match(/^(.+)-\d+\.\d+$/)[1], `${pkg.name}: runtime part must equal the main package`)
  }
  assert.equal(main.version, '0.1.0-rc.6-0.6')
  assert.equal(main.dsh.api, '0.6')
})

test('the auxiliary packages do not declare the main package as a runtime dependency', () => {
  for (const pkg of [compaction, sessionTitle, mcp, attachments, routePolicy, sessionBranch]) {
    assert.ok(!pkg.dependencies?.['@deepseek-ai/dsh-plugin-api-main'], pkg.name)
    assert.ok(!pkg.peerDependencies?.['@deepseek-ai/dsh-plugin-api-main'], `${pkg.name}: version consistency is enforced by apply-time metadata check`)
  }
})

test('the full aggregate bundle depends on main and every auxiliary package at workspace-consistent versions', () => {
  assert.deepEqual(full.dependencies, {
    '@deepseek-ai/dsh-plugin-api-main': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-compaction-events': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-session-title': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-mcp': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-attachments': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-agent-loop': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-session-branch': 'workspace:*',
    '@deepseek-ai/dsh-plugin-api-profile-manager': 'workspace:*',
  })
  assert.equal(full.dsh.bundle.patch, './cordis.patch.yml')
})

test('replacement row ids use capability names without governance suffixes', () => {
  const compactionPatch = readFileSync(join(here, '..', 'packages', 'compaction-events', 'cordis.patch.yml'), 'utf8')
  const titlePatch = readFileSync(join(here, '..', 'packages', 'session-title', 'cordis.patch.yml'), 'utf8')
  const attachmentPatch = readFileSync(join(here, '..', 'packages', 'attachments', 'cordis.patch.yml'), 'utf8')
  const routePolicyPatch = readFileSync(join(here, '..', 'packages', 'agent-loop', 'cordis.patch.yml'), 'utf8')
  const sessionBranchPatch = readFileSync(join(here, '..', 'packages', 'session-branch', 'cordis.patch.yml'), 'utf8')
  const fullPatch = readFileSync(join(here, '..', 'packages', 'full', 'cordis.patch.yml'), 'utf8')
  assert.match(compactionPatch, /id: plugin-api-compaction-events/)
  assert.doesNotMatch(compactionPatch, /r1/)
  assert.match(titlePatch, /id: plugin-api-session-title/)
  assert.doesNotMatch(titlePatch, /r1/)
  assert.match(attachmentPatch, /id: plugin-api-attachments/)
  assert.match(routePolicyPatch, /id: agent-loop[\s\S]*disabled: true/)
  assert.match(routePolicyPatch, /id: plugin-api-agent-loop/)
  assert.doesNotMatch(attachmentPatch, /r1/)
  assert.match(sessionBranchPatch, /id: session[\s\S]*disabled: true/)
  assert.match(sessionBranchPatch, /id: plugin-api-session-branch/)
  assert.doesNotMatch(sessionBranchPatch, /r1/)
  assert.match(fullPatch, /id: plugin-api-main/)
  assert.match(fullPatch, /id: plugin-api-compaction-events/)
  assert.match(fullPatch, /id: plugin-api-session-title/)
  assert.match(fullPatch, /id: plugin-api-attachments/)
  assert.match(fullPatch, /id: plugin-api-agent-loop/)
  assert.match(fullPatch, /id: plugin-api-session-branch/)
  assert.doesNotMatch(fullPatch, /r1/)
})
