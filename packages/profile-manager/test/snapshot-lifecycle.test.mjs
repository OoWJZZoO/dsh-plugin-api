import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureStorageRoot, loadConfig, storagePaths, snapshotDir } from '../lib/storage.js'
import { applyGate } from '../lib/commit.js'
import {
  createSnapshot,
  modifySnapshot,
  deleteSnapshot,
  readSnapshotRecord,
  apparentBytesOf,
  enforceQuota,
  LIFECYCLE_STATE,
  markValidated,
} from '../lib/snapshot.js'

function makeHome() {
  const base = mkdtempSync(join(tmpdir(), 'profile-manager-lifecycle-'))
  const home = join(base, 'dsh')
  mkdirSync(home, { recursive: true })
  return { base, home, root: ensureStorageRoot({ env: { DSH_HOME: home } }) }
}

const CONFIG = { quotaPerOwnerMb: 256, quotaTotalMb: 1024, backupRetentionN: 5 }

test('snapshot-create is a near-instant atomic step: config copied, no dependency work', async () => {
  const { home, root } = makeHome()
  try {
    const sourceProfile = join(home, 'profiles', 'dev')
    mkdirSync(sourceProfile, { recursive: true })
    writeFileSync(join(sourceProfile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
    writeFileSync(join(sourceProfile, 'cordis.patch.yml'), '- id: webserver\n  config: { port: 3082 }')

    const result = await createSnapshot({
      root,
      intent: { owner: 'plugin-a', source: 'disk', sourceProfile: 'dev' },
      config: CONFIG,
    })
    assert.equal(result.outcome, 'success')
    assert.equal(result.result.lifecycleState, 'clean')
    const dir = join(root, 'snapshots', 'plugin-a', result.result.snapshotId)
    assert.ok(existsSync(dir))
    assert.equal(readSnapshotRecord(dir).sourceProfile, 'dev')
    assert.equal(readSnapshotRecord(dir).lifecycleState, LIFECYCLE_STATE.clean)
    // config copied; node_modules never materialized at create time.
    assert.ok(existsSync(join(dir, 'package.json')))
    assert.ok(existsSync(join(dir, 'cordis.patch.yml')))
    assert.ok(!existsSync(join(dir, 'node_modules')))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('snapshot-create accepts runtime-sourced config content directly', async () => {
  const { root } = makeHome()
  try {
    const result = await createSnapshot({
      root,
      intent: {
        owner: 'plugin-b',
        source: 'runtime',
        config: { 'package.json': '{"name":"p"}', 'cordis.patch.yml': '- id: x' },
      },
      config: CONFIG,
    })
    assert.equal(result.outcome, 'success')
    const dir = join(root, 'snapshots', 'plugin-b', result.result.snapshotId)
    assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), '{"name":"p"}')
    assert.equal(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8'), '- id: x')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('snapshot-create rejects invalid input and duplicate ids without throwing', async () => {
  const { root } = makeHome()
  try {
    const noOwner = await createSnapshot({ root, intent: { source: 'disk' }, config: CONFIG })
    assert.equal(noOwner.outcome, 'error')
    assert.equal(noOwner.code, 'invalid-input')
    const ok = await createSnapshot({ root, intent: { owner: 'p', source: 'disk' }, config: CONFIG })
    assert.equal(ok.outcome, 'success')
    const dup = await createSnapshot({ root, intent: { owner: 'p', snapshotId: ok.result.snapshotId, source: 'disk' }, config: CONFIG })
    assert.equal(dup.code, 'invalid-input')
    const badOwner = await createSnapshot({ root, intent: { owner: '../evil', source: 'disk' }, config: CONFIG })
    assert.equal(badOwner.code, 'invalid-input')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('snapshot-modify flips to dirty and invalidates the validated generation (the dirty-state rule/6.4)', async () => {
  const { root } = makeHome()
  try {
    const created = await createSnapshot({ root, intent: { owner: 'p', source: 'runtime', config: {} }, config: CONFIG })
    const snapshotId = created.result.snapshotId
    // simulate a previously validated generation
    const dir = join(root, 'snapshots', 'p', snapshotId)
    const record = readSnapshotRecord(dir)
    record.lifecycleState = LIFECYCLE_STATE.validated
    record.validatedGeneration = 'gen-1'
    writeFileSync(join(dir, 'snapshot.json'), JSON.stringify(record, null, 2))
    const modified = await modifySnapshot({ root, intent: { owner: 'p', snapshotId, config: { patch: '- id: y' } } })
    assert.equal(modified.outcome, 'success')
    assert.equal(modified.result.lifecycleState, LIFECYCLE_STATE.dirty)
    const after = readSnapshotRecord(dir)
    assert.equal(after.lifecycleState, LIFECYCLE_STATE.dirty)
    assert.equal(after.validatedGeneration, undefined)
    assert.equal(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8'), '- id: y')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('snapshot-delete enforces ownership and is idempotent (the ownership rule)', async () => {
  const { root } = makeHome()
  try {
    const created = await createSnapshot({ root, intent: { owner: 'plugin-a', source: 'disk' }, config: CONFIG })
    const snapshotId = created.result.snapshotId
    const foreign = await deleteSnapshot({ root, intent: { owner: 'plugin-b', snapshotId } })
    assert.equal(foreign.outcome, 'error')
    assert.equal(foreign.code, 'ownership-conflict')
    const own = await deleteSnapshot({ root, intent: { owner: 'plugin-a', snapshotId } })
    assert.equal(own.outcome, 'success')
    assert.equal(own.result.removed, true)
    assert.ok(!existsSync(join(root, 'snapshots', 'plugin-a', snapshotId)))
    const again = await deleteSnapshot({ root, intent: { owner: 'plugin-a', snapshotId } })
    assert.equal(again.outcome, 'success')
    assert.equal(again.result.removed, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('concurrent modify+validate on the same snapshot stays serialized (per-snapshot mutex)', async () => {
  const { root } = makeHome()
  try {
    const created = await createSnapshot({ root, intent: { owner: 'p', snapshotId: 'sna-shared', source: 'runtime', config: {} }, config: CONFIG })
    assert.equal(created.outcome, 'success')
    const dir = join(root, 'snapshots', 'p', 'sna-shared')
    // Two concurrent modifies on the same snapshot must serialize; the state
    // machine stays intact after both settle.
    const [first, second] = await Promise.all([
      modifySnapshot({ root, intent: { owner: 'p', snapshotId: 'sna-shared', config: { patch: '- id: one' } } }),
      modifySnapshot({ root, intent: { owner: 'p', snapshotId: 'sna-shared', config: { patch: '- id: two' } } }),
    ])
    assert.equal(first.outcome, 'success')
    assert.equal(second.outcome, 'success')
    const record = readSnapshotRecord(dir)
    assert.equal(record.lifecycleState, LIFECYCLE_STATE.dirty)
    assert.equal(record.validatedGeneration, undefined)
    // No lock directory remains behind.
    assert.ok(!existsSync(join(dir, '.lock')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('quota rejects owner overflow and refuses to delete data for space (the quota contract/8.5)', async () => {
  const { root } = makeHome()
  try {
    const tiny = { quotaPerOwnerMb: 1, quotaTotalMb: 1024, backupRetentionN: 5 }
    // create something worth ~ >1MB apparent.
    const created = await createSnapshot({ root, intent: { owner: 'big', source: 'disk' }, config: tiny })
    assert.equal(created.outcome, 'success')
    const dir = join(root, 'snapshots', 'big', created.result.snapshotId)
    const bigFile = Buffer.alloc(2 * 1024 * 1024, 7)
    writeFileSync(join(dir, 'big.bin'), bigFile)
    const denied = enforceQuota({ root, owner: 'big', config: tiny, extraBytes: 1024 })
    assert.equal(denied.code, 'quota-exceeded')
    assert.equal(denied.reason, 'owner-quota')
    // The data is never auto-deleted to free space.
    assert.ok(existsSync(join(dir, 'big.bin')))
    assert.equal(apparentBytesOf(dir) > 1024 * 1024, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('quota total rejects a second owner over the whole limit', async () => {
  const { root } = makeHome()
  try {
    const tiny = { quotaPerOwnerMb: 1024, quotaTotalMb: 1, backupRetentionN: 5 }
    const a = await createSnapshot({ root, intent: { owner: 'a', source: 'disk' }, config: tiny })
    assert.equal(a.outcome, 'success')
    writeFileSync(join(root, 'snapshots', 'a', a.result.snapshotId, 'a.bin'), Buffer.alloc(2 * 1024 * 1024, 1))
    const b = await createSnapshot({ root, intent: { owner: 'b', source: 'disk' }, config: tiny })
    assert.equal(b.outcome, 'error')
    assert.equal(b.code, 'quota-exceeded')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('scoped package owners work end to end (create -> modify -> validate -> apply -> delete)', async () => {
  const { root } = makeHome()
  try {
    const owner = '@deepseek-ai/my-plugin'
    const created = await createSnapshot({ root, intent: { owner, snapshotId: 'sna-scoped', source: 'runtime', config: { 'package.json': '{}', 'cordis.patch.yml': '- id: x' } }, config: CONFIG })
    assert.equal(created.outcome, 'success')
    assert.equal(created.result.snapshotId, 'sna-scoped')
    const dir = snapshotDir(root, owner, 'sna-scoped')
    assert.ok(dir)
    assert.ok(existsSync(join(root, 'snapshots', '@deepseek-ai', 'my-plugin', 'sna-scoped')))
    const modified = await modifySnapshot({ root, intent: { owner, snapshotId: 'sna-scoped', config: { patch: '- id: y' } } })
    assert.equal(modified.outcome, 'success')
    assert.equal(modified.result.lifecycleState, 'dirty')
    await markValidated({ root, intent: { owner, snapshotId: 'sna-scoped' }, generation: 'gen-scoped' })
    const gate = applyGate(dir)
    assert.equal(gate.ok, true)
    const deleted = await deleteSnapshot({ root, intent: { owner, snapshotId: 'sna-scoped' } })
    assert.equal(deleted.outcome, 'success')
    assert.equal(deleted.result.removed, true)
    // traversal and unsafe segments stay rejected.
    assert.equal(snapshotDir(root, '../evil', 'x'), undefined)
    assert.equal(snapshotDir(root, 'ok', '../x'), undefined)
    assert.equal(snapshotDir(root, 'a\\b', 'x'), undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loadConfig defaults and storagePaths resolve under the manager root', async () => {
  const { root } = makeHome()
  try {
    assert.deepEqual(loadConfig(root), CONFIG)
    const paths = storagePaths(root)
    assert.ok(paths.snapshots.endsWith('snapshots'))
    assert.ok(paths.seed.endsWith(join('cache', 'seed')))
    assert.ok(paths.audit.endsWith('audit.log'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})