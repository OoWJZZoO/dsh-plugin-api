import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureStorageRoot, storagePaths } from '../lib/storage.js'
import { createSnapshot, readSnapshotRecord } from '../lib/snapshot.js'
import { dependencyFingerprint, hardlinkClone, rebuildSeed, materializeDependencies } from '../lib/seed-cache.js'
import { classifyOrphans, deleteOrphans, declaredDependencies } from '../lib/gc.js'

const CONFIG = { quotaPerOwnerMb: 256, quotaTotalMb: 1024, backupRetentionN: 5 }

function makeHome() {
  const base = mkdtempSync(join(tmpdir(), 'profile-manager-governance-'))
  const home = join(base, 'dsh')
  mkdirSync(home, { recursive: true })
  return { base, home, root: ensureStorageRoot({ env: { DSH_HOME: home } }) }
}

test('dependency fingerprint is a stable sha256 of the profile manifest', async () => {
  const base = mkdtempSync(join(tmpdir(), 'profile-mgr-fp-'))
  const profile = join(base, 'profiles', 'dev')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
  const fp1 = dependencyFingerprint(profile)
  assert.equal(typeof fp1, 'string')
  assert.equal(fp1.length, 64)
  const fp2 = dependencyFingerprint(profile)
  assert.equal(fp1, fp2)
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web'] } } }))
  assert.notEqual(dependencyFingerprint(profile), fp1)
  assert.equal(dependencyFingerprint(join(base, 'missing')), undefined)
  rmSync(base, { recursive: true, force: true })
})

test('hardlinkClone clones a tree with hardlinks and recreated symlinks', async () => {
  const base = mkdtempSync(join(tmpdir(), 'profile-mgr-hl-'))
  const source = join(base, 'node_modules', '@deepseek-ai', 'pkg-x')
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'index.js'), 'module.exports = 1\n')
  writeFileSync(join(base, 'node_modules', 'top.txt'), 'hello')
  const target = join(base, 'out')
  const ok = hardlinkClone(join(base, 'node_modules'), target)
  assert.equal(ok, true)
  assert.ok(existsSync(join(target, 'top.txt')))
  assert.ok(existsSync(join(target, '@deepseek-ai', 'pkg-x', 'index.js')))
  // hardlink: same inode for a regular file clone.
  assert.equal(statSync(join(target, '@deepseek-ai', 'pkg-x', 'index.js')).ino,
    statSync(join(source, 'index.js')).ino)
  rmSync(base, { recursive: true, force: true })
})

test('seed rebuild is atomic, exclusive-per-rename, and fingerprint-driven', async () => {
  const base = mkdtempSync(join(tmpdir(), 'profile-mgr-seed-'))
  const { root } = makeHome()
  try {
    const profilesHome = join(root, '..', '..', 'profiles')
    const profile = join(profilesHome, 'dev')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
    mkdirSync(join(profile, 'node_modules', '@deepseek-ai', 'dep-a'), { recursive: true })
    writeFileSync(join(profile, 'node_modules', '@deepseek-ai', 'dep-a', 'index.js'), 'a')
    const seedDir = storagePaths(root).seed

    const first = rebuildSeed({ seedDir, profileName: 'dev', profileDir: profile })
    assert.equal(first.ok, true)
    assert.equal(first.rebuilt, true)
    assert.ok(existsSync(join(seedDir, 'dev', 'node_modules', '@deepseek-ai', 'dep-a', 'index.js')))

    // fingerprint unchanged: no rebuild, seed intact.
    const second = rebuildSeed({ seedDir, profileName: 'dev', profileDir: profile })
    assert.equal(second.ok, true)
    assert.equal(second.rebuilt, false)

    // fingerprint drift: rebuild with atomic swap.
    writeFileSync(join(profile, 'node_modules', '@deepseek-ai', 'dep-a', 'index.js'), 'a2')
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }))
    const third = rebuildSeed({ seedDir, profileName: 'dev', profileDir: profile })
    assert.equal(third.ok, true)
    assert.equal(third.rebuilt, true)
    assert.equal(readFileSync(join(seedDir, 'dev', 'node_modules', '@deepseek-ai', 'dep-a', 'index.js'), 'utf8'), 'a2')
    // no staging strays remain
    const leftovers = []
    for (const entry of readdirSync(seedDir)) {
      if (entry.includes('.staging-') || entry.includes('.old-')) leftovers.push(entry)
    }
    assert.deepEqual(leftovers, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(base, { recursive: true, force: true })
  }
})

test('materializeDependencies clones the seed into the snapshot at first validate', async () => {
  const base = mkdtempSync(join(tmpdir(), 'profile-mgr-mat-'))
  const { root } = makeHome()
  try {
    const profilesHome = join(root, '..', '..', 'profiles')
    const profile = join(profilesHome, 'dev')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
    mkdirSync(join(profile, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(profile, 'node_modules', 'pkg', 'index.js'), 'dep-content')

    const created = await createSnapshot({ root, intent: { owner: 'p', source: 'disk', sourceProfile: 'dev' }, config: CONFIG })
    assert.equal(created.outcome, 'success')
    const snapNodeModules = join(root, 'snapshots', 'p', created.result.snapshotId, 'node_modules')
    assert.ok(!existsSync(snapNodeModules), 'lazy: nothing at create time')

    const materialized = materializeDependencies({
      seedDir: storagePaths(root).seed,
      profileName: 'dev',
      profileDir: profile,
      snapshotNodeModules: snapNodeModules,
    })
    assert.equal(materialized.ok, true)
    assert.ok(existsSync(join(snapNodeModules, 'pkg', 'index.js')))
    assert.equal(readFileSync(join(snapNodeModules, 'pkg', 'index.js'), 'utf8'), 'dep-content')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(base, { recursive: true, force: true })
  }
})

test('gc classifies orphans with the full criteria and deletes immediately (the orphan rule)', async () => {
  const { root } = makeHome()
  try {
    const profilesHome = join(root, '..', '..', 'profiles')
    // target profile exists and declares owner-a only.
    const profile = join(profilesHome, 'dev')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: { '@deepseek-ai/owner-a': '1.0.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    }))
    const snapshotsRoot = join(root, 'snapshots')
    for (const [owner, id] of [['@deepseek-ai/owner-a', 's1'], ['@deepseek-ai/owner-b', 's2'], ['@deepseek-ai/owner-c', 's3']]) {
      const dir = join(snapshotsRoot, owner, id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'snapshot.json'), JSON.stringify({ snapshotId: id, owner, sourceProfile: 'dev', lifecycleState: 'clean', createdAt: 'x' }))
    }
    // owner-c's target profile no longer exists.
    const resolveOwnerProfile = (owner) => {
      const dir = join(profilesHome, owner === '@deepseek-ai/owner-c' ? 'gone' : 'dev')
      return { profileDir: dir }
    }
    const classified = classifyOrphans({ snapshotsRoot, runtimeView: new Set(['@deepseek-ai/owner-b']), resolveOwnerProfile })
    const reasons = new Map(classified.orphaned.map((entry) => [entry.owner, entry.reason]))
    // owner-a: absent from runtime but declared in deps -> kept (reinstall cycle).
    // owner-b: present in runtime -> kept.
    assert.equal(classified.keptCount, 2)
    // owner-c: target profile gone -> orphaned.
    assert.equal(reasons.get('@deepseek-ai/owner-c'), 'target-profile-missing')
    assert.equal(classified.orphaned.length, 1)

    const deleted = deleteOrphans({ snapshotsRoot, orphaned: classified.orphaned })
    assert.equal(deleted.deleted, 1)
    assert.ok(!existsSync(join(snapshotsRoot, '@deepseek-ai/owner-c', 's3')))
    assert.ok(existsSync(join(snapshotsRoot, '@deepseek-ai/owner-a', 's1')))
    assert.ok(existsSync(join(snapshotsRoot, '@deepseek-ai/owner-b', 's2')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('gc keeps runtime-source snapshots whose owner is present in the runtime view (no recorded target)', async () => {
  const { root } = makeHome()
  try {
    const profilesHome = join(root, '..', '..', 'profiles')
    // runtime-source snapshot: no sourceProfile recorded.
    const dir = join(root, 'snapshots', '@deepseek-ai', 'live-owner', 'sna-live')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'snapshot.json'), JSON.stringify({ snapshotId: 'sna-live', owner: '@deepseek-ai/live-owner', lifecycleState: 'clean', createdAt: 'x' }))
    const snapshotsRoot = join(root, 'snapshots')
    // no target resolvable: owner in runtime view -> kept.
    const withRuntime = classifyOrphans({ snapshotsRoot, runtimeView: new Set(['@deepseek-ai/live-owner']), resolveOwnerProfile: () => undefined })
    assert.equal(withRuntime.orphaned.length, 0)
    assert.equal(withRuntime.keptCount, 1)
    // owner absent from runtime and target unresolved -> orphaned (never guessed).
    const withoutRuntime = classifyOrphans({ snapshotsRoot, runtimeView: new Set(), resolveOwnerProfile: () => undefined })
    assert.equal(withoutRuntime.orphaned.length, 1)
    assert.equal(withoutRuntime.orphaned[0].reason, 'target-profile-unresolved-and-owner-absent')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('declaredDependencies reads bundles and user dependencies from the profile manifest', async () => {
  const base = mkdtempSync(join(tmpdir(), 'profile-mgr-dd-'))
  const profile = join(base, 'profiles', 'dev')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    dependencies: { '@deepseek-ai/plugin-x': 'file:../x', '@deepseek-ai/plugin-y': '^1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } },
  }))
  const declared = declaredDependencies(profile)
  assert.ok(declared.has('@deepseek-ai/dsh-base'))
  assert.ok(declared.has('@deepseek-ai/plugin-x'))
  assert.ok(declared.has('@deepseek-ai/plugin-y'))
  assert.equal(declaredDependencies(join(base, 'nope')).size, 0)
  rmSync(base, { recursive: true, force: true })
})

test('readSnapshotRecord round-trips the durable record with persistent identity', async () => {
  const { root } = makeHome()
  try {
    const created = await createSnapshot({ root, intent: { owner: 'p', snapshotId: 'sna-durable', source: 'runtime', config: {} }, config: CONFIG })
    assert.equal(created.outcome, 'success')
    const record = readSnapshotRecord(join(root, 'snapshots', 'p', 'sna-durable'))
    assert.equal(record.snapshotId, 'sna-durable')
    assert.equal(record.owner, 'p')
    assert.equal(record.lifecycleState, 'clean')
    assert.equal(typeof record.createdAt, 'string')
    assert.equal(readSnapshotRecord(join(root, 'snapshots', 'p', 'nope')), undefined)
    assert.equal(readSnapshotRecord(undefined), undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})