import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, rmSync, mkdtempSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { validateRegistry } from '../scripts/registry-validate.mjs'
import { buildSnapshots } from '../scripts/registry-snapshot.mjs'
import { CLIENT_CAPABILITY_PATHS } from '../lib/client-runtime.js'

const REGISTRY_PATH = fileURLToPath(new URL('../docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json', import.meta.url))
const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))

test('the current registry validates cleanly', () => {
  const result = validateRegistry(registry)
  assert.deepEqual(result.errors, [], 'registry must pass the pure validator')
  assert.equal(result.ok, true)
})

test('the client runtime root member inventory stays in sync with the registry', () => {
  assert.deepEqual(
    [...CLIENT_CAPABILITY_PATHS].sort(),
    [...registry.clientDomainTree].sort(),
    'CLIENT_CAPABILITY_PATHS must mirror registry clientDomainTree',
  )
  assert.deepEqual(
    [...registry.clientRoot.members].sort(),
    [...registry.clientDomainTree].sort(),
    'registry clientRoot.members must mirror clientDomainTree',
  )
})

test('every retained member has a finalized composition record with authority fields', () => {
  const requiredFields = ['composition', 'idiom', 'effect', 'scope', 'resourceKey', 'identitySource', 'conflictRule', 'lifecycle', 'failureSemantics', 'availabilityShape']
  for (const member of registry.members) {
    assert.notEqual(member.composition, 'pending-audit', `${member.publicPath} must have a finalized composition mode`)
    for (const field of requiredFields) {
      assert.ok(member[field] !== undefined, `${member.publicPath}.${field} must be recorded (explicit null allowed)`)
    }
  }
})

test('the composable profile fixture matches the recommended members and audits are complete', () => {
  const snapshots = buildSnapshots(registry)
  const recommended = registry.members.filter((m) => m.status === 'recommended').map((m) => m.publicPath).sort()
  assert.deepEqual(snapshots.composableProfile.members, recommended, 'profile fixture mirrors the registry marker')
  assert.ok(recommended.length >= 4, 'the fundamentals and capabilities are in the default profile')
  for (const path of recommended) {
    const member = registry.members.find((m) => m.publicPath === path)
    assert.ok(member.composition && member.composition !== 'pending-audit', `${path} must be audited before recommendation`)
    assert.ok(member.effect === 'read', `${path} must be read-only to be recommended`)
  }
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
    publicPath: 'llm.routing.decisions.extra.deep.more',
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
  for (const expected of ['agents', 'sessions', 'executions', 'prompts', 'llm.routing', 'workspaces.transactions', 'sessions.channels', 'capabilities']) {
    assert.ok(snapshots.hostSurface.roots.includes(expected.split('.')[0]), `host surface must include root ${expected}`)
  }
  const targets = new Set(snapshots.hostSurface.members.map((member) => member.proposedTargetPath).filter(Boolean))
  for (const expected of ['agents.get', 'sessions.observe', 'llm.routing.forExecution', 'workspaces.transactions.prepare', 'sessions.channels.acquire', 'capabilities.get']) {
    assert.ok(targets.has(expected), `host surface must include target ${expected}`)
  }
  assert.ok(Array.isArray(snapshots.clientSurface.roots))
  assert.ok(snapshots.clientSurface.roots.includes('connection'))
  assert.equal(snapshots.clientSurface.clientRoot.publicRoot, 'ctx.pluginApi (direct root members)')
  assert.ok(snapshots.servicesFixture.keys.includes('fs'))
  assert.equal(snapshots.servicesFixture.keys.length, 46, 'snapshot services fixture matches the reduced whitelist')
  assert.ok(!snapshots.servicesFixture.keys.includes('compaction'), 'removed compaction key is absent from the snapshot')
  assert.ok(!snapshots.servicesFixture.keys.includes('workflows'), 'removed workflows key is absent from the snapshot')
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

test('services whitelist members never claim recommended profile status', () => {
  for (const entry of registry.servicesWhitelist) {
    assert.equal(entry.status, 'advanced',
      `services.${entry.key} stays an advanced passthrough: passthrough members claim no default composition guarantee`)
    assert.equal(entry.channel, 'passthrough')
    assert.ok(entry.composition !== undefined && entry.composition !== '', `services.${entry.key} declares a composition classification`)
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
    assert.deepEqual(files, [
      'capabilityStatus.json', 'clientSurface.json', 'composableProfile.json', 'compositionMatrix.json',
      'eventAuthority.json', 'handleMembers.json', 'hostSurface.json', 'idiomGroups.json',
      'migrationDiff.json', 'servicesFixture.json',
    ])
    const capabilityStatus = JSON.parse(readFileSync(join(outDir, 'capabilityStatus.json'), 'utf8'))
    const matrixClusters = new Set(registry.capabilityMatrix.map((row) => row.capabilityCluster))
    for (const row of capabilityStatus.clusters) {
      assert.ok(matrixClusters.has(row.capabilityCluster), `capability status covers matrix cluster ${row.capabilityCluster}`)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('the runtime capability descriptor table mirrors the registry capability paths', async () => {
  const { CAPABILITY_PATHS } = await import('../lib/capability-descriptors.js')
  // Leaf-level registry: a runtime capability path is a member capability
  // cluster, a namespace navigation path, or a root self-description member.
  const capabilityPaths = new Set(registry.members.map((m) => m.capability))
  for (const record of registry.namespaces) capabilityPaths.add(record.capabilityPath)
  for (const path of registry.members.map((m) => m.publicPath)) {
    if (!path.includes('.')) capabilityPaths.add(path)
  }
  for (const path of CAPABILITY_PATHS) {
    assert.ok(capabilityPaths.has(path), `runtime capability ${path} must be a registry capability path`)
  }
})

test('the services whitelist mirrors the runtime service definitions', async () => {
  const { SERVICE_DEFINITIONS, SERVICES_NAMESPACE_KEYS } = await import('../lib/services.js')
  const whitelist = registry.servicesWhitelist
  assert.deepEqual(whitelist.map((entry) => entry.key), SERVICES_NAMESPACE_KEYS)
  for (const entry of whitelist) {
    const def = SERVICE_DEFINITIONS.find((d) => d.key === entry.key)
    assert.ok(def, `whitelist key ${entry.key} must resolve to a runtime definition`)
    assert.equal(entry.capability, def.capability, `whitelist ${entry.key} carries the public capability path`)
    assert.equal(entry.composition, def.composition ?? 'pending-audit', `whitelist ${entry.key} matches the runtime composition metadata`)
  }
})

test('approved deletions are recorded as removed with a deletion-report link', () => {
  for (const entry of registry.deletionReport) {
    assert.ok(['remove', 'rename'].includes(entry.category), `deletion entry ${entry.path} has a known category`)
    assert.ok(['approved', 'pending-second-approval'].includes(entry.status), `deletion entry ${entry.path} has a known status`)
    assert.ok(typeof entry.link === 'string' || typeof entry.note === 'string', `deletion entry ${entry.path} links the report`)
  }
  for (const [path, status] of Object.entries(registry.statusByPath)) {
    assert.equal(status, 'removed', `statusByPath ${path} must be removed`)
  }
})