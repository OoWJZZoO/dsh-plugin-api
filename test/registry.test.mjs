import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, rmSync, mkdtempSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { validateRegistry } from '../scripts/registry-validate.mjs'
import { buildSnapshots } from '../scripts/registry-snapshot.mjs'

const REGISTRY_PATH = fileURLToPath(new URL('../docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json', import.meta.url))
const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))

test('the current registry validates cleanly', () => {
  const result = validateRegistry(registry)
  assert.deepEqual(result.errors, [], 'registry must pass the pure validator')
  assert.equal(result.ok, true)
})

test('validator rejects duplicate public paths', () => {
  const copy = structuredClone(registry)
  copy.members.push(structuredClone(copy.members[0]))
  const result = validateRegistry(copy)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('duplicates publicPath')))
})

test('validator rejects vocabulary violations', () => {
  const copy = structuredClone(registry)
  copy.members[0].status = 'not-a-status'
  copy.members[1].implementationChannel = 'not-a-channel'
  const result = validateRegistry(copy)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('not in vocabulary.status')))
  assert.ok(result.errors.some((error) => error.includes('not in vocabulary.implementationChannel')))
})

test('validator rejects excessive path depth outside services.*', () => {
  const copy = structuredClone(registry)
  copy.members.push({
    publicPath: 'llm.routing.decisions.extra',
    runtime: 'host',
    effect: 'read',
    composition: 'pure',
    status: 'advanced',
    implementationChannel: 'facade',
  })
  const result = validateRegistry(copy)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('depth')))
})

test('validator rejects missing required member fields', () => {
  const copy = structuredClone(registry)
  copy.members.push({ runtime: 'host' })
  const result = validateRegistry(copy)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('publicPath')))
})

test('validator rejects a frozen baseline that is not frozen', () => {
  const copy = structuredClone(registry)
  copy.contractBaseline.frozen = false
  const result = validateRegistry(copy)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('frozen')))
})

test('snapshots derive every surface from the same registry', () => {
  const snapshots = buildSnapshots(registry)
  assert.ok(Array.isArray(snapshots.hostSurface.roots))
  assert.ok(snapshots.hostSurface.roots.includes('llm'))
  assert.ok(snapshots.hostSurface.roots.includes('services'))
  const targets = new Set(snapshots.hostSurface.members.map((member) => member.proposedTargetPath))
  for (const expected of ['agents', 'sessions', 'executions', 'prompts', 'llm.routing', 'workspaces.transactions', 'sessions.channels', 'capabilities']) {
    assert.ok(targets.has(expected), `host surface must include target ${expected}`)
  }
  assert.ok(Array.isArray(snapshots.clientSurface.roots))
  assert.ok(snapshots.clientSurface.roots.includes('connection'))
  assert.equal(snapshots.clientSurface.clientRoot.publicRoot, 'ctx.pluginApi.client')
  assert.ok(snapshots.servicesFixture.keys.includes('fs'))
  assert.ok(snapshots.servicesFixture.keys.length >= 21)
  assert.ok(snapshots.compositionMatrix.byComposition !== undefined)
})

test('registry snapshots contain no governance tokens or catalog fields', () => {
  // Built by concatenation so this audit source itself contains no banned token.
  const bannedTokens = [
    'A' + '11',
    'compaction-events-' + 'r1',
    'dsh-plugin-api.compaction-events-' + 'r1' + '.active',
  ]
  const snapshots = buildSnapshots(registry)
  const tmp = mkdtempSync(join(tmpdir(), 'm7-snapshots-'))
  try {
    const outDir = join(tmp, 'out')
    mkdirSync(outDir, { recursive: true })
    for (const [name, value] of Object.entries(snapshots)) {
      const text = JSON.stringify(value)
      for (const token of bannedTokens) {
        assert.ok(!text.includes(token), `${name} must not contain banned token ${JSON.stringify(token)}`)
      }
      assert.ok(!/^\s*type:\s*['"]?[ABR]['"]?,?\s*$/m.test(text), `${name} must not carry governance catalog fields`)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('the snapshot CLI writes files and the validate CLI accepts the registry', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'm7-registry-cli-'))
  try {
    const { execFileSync } = await import('node:child_process')
    const root = fileURLToPath(new URL('..', import.meta.url))
    execFileSync(process.execPath, ['scripts/registry-validate.mjs', REGISTRY_PATH], { cwd: root, encoding: 'utf8' })
    const outDir = join(tmp, 'snap')
    execFileSync(process.execPath, ['scripts/registry-snapshot.mjs', REGISTRY_PATH, outDir], { cwd: root, encoding: 'utf8' })
    const files = readdirSync(outDir).sort()
    assert.deepEqual(files, ['clientSurface.json', 'compositionMatrix.json', 'hostSurface.json', 'servicesFixture.json'])
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})