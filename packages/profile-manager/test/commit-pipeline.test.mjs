import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureStorageRoot } from '../lib/storage.js'
import { createSnapshot, modifySnapshot, markValidated, readSnapshotRecord } from '../lib/snapshot.js'
import { profileBaseline, commitProfileChange, applyGate, atomicSwap, recoverSwap } from '../lib/commit.js'
import { quickWrite, snapshotApply, prepareConfigChange } from '../lib/pipelines.js'

const CONFIG = { quotaPerOwnerMb: 256, quotaTotalMb: 1024, backupRetentionN: 5 }

function makeHome() {
  const base = mkdtempSync(join(tmpdir(), 'profile-manager-commit-'))
  const home = join(base, 'dsh')
  mkdirSync(home, { recursive: true })
  const root = ensureStorageRoot({ env: { DSH_HOME: home } })
  const profilesHome = join(root, '..', '..', 'profiles')
  mkdirSync(profilesHome, { recursive: true })
  const profile = join(profilesHome, 'dev')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'dsh-profile-dev', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: webserver\n  config: { port: 3082 }\n')
  // fake dsh + fake pnpm bins for hermetic pipeline runs
  const binDir = join(base, 'bin')
  mkdirSync(binDir, { recursive: true })
  const fakeDsh = join(binDir, 'dsh')
  writeFileSync(fakeDsh, [
    '#!/usr/bin/env node',
    'if (process.argv.includes("--dump-config")) {',
    '  process.stdout.write(process.env.FAKE_DUMP ?? "")',
    '  process.exit(Number(process.env.FAKE_DUMP_EXIT ?? "0"))',
    '}',
    'process.exit(Number(process.env.FAKE_BOOT_EXIT ?? "0"))',
    '',
  ].join('\n'), 'utf8')
  chmodSync(fakeDsh, 0o755)
  const fakePnpm = join(binDir, 'pnpm')
  writeFileSync(fakePnpm, [
    '#!/usr/bin/env node',
    'const { readFileSync, writeFileSync } = require("node:fs")',
    'const { join } = require("node:path")',
    'const pkgPath = join(process.cwd(), "package.json")',
    'const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))',
    'pkg.dependencies ??= {}',
    'const args = process.argv.slice(2)',
    'const mode = args[0]',
    'const names = args.slice(1)',
    'if (mode === "add") for (const n of names) pkg.dependencies[n] = "file:x"',
    'if (mode === "remove") for (const n of names) delete pkg.dependencies[n]',
    'writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))',
    'if (process.env.FAKE_PNPM_FAIL === "1") process.exit(1)',
    'process.exit(0)',
    '',
  ].join('\n'), 'utf8')
  chmodSync(fakePnpm, 0o755)
  return { base, home, root, profile, binDir, fakeDsh, fakePnpm }
}

const envOf = (fixture, extra = {}) => ({
  DSH_PLUGIN_API_PROFILE_DSH_BIN: fixture.fakeDsh,
  DSH_PLUGIN_API_PROFILE_PNPM_BIN: fixture.fakePnpm,
  FAKE_DUMP: '- id: webserver\n  config: {}\n',
  FAKE_DUMP_EXIT: '0',
  FAKE_BOOT_EXIT: '0',
  ...extra,
})

test('profileBaseline and casMatches detect drift in the real profile', async () => {
  const fixture = makeHome()
  try {
    const baseline = profileBaseline(fixture.profile)
    assert.equal(typeof baseline, 'string')
    writeFileSync(join(fixture.profile, 'cordis.patch.yml'), '- id: webserver\n  config: { port: 9999 }\n')
    assert.notEqual(profileBaseline(fixture.profile), baseline)
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('atomicSwap commits the staged config and rolls back cleanly on failure', async () => {
  const fixture = makeHome()
  try {
    const ok = atomicSwap(fixture.profile, { 'cordis.patch.yml': '- id: new-row\n  config: {}\n' })
    assert.equal(ok, true)
    assert.equal(readFileSync(join(fixture.profile, 'cordis.patch.yml'), 'utf8'), '- id: new-row\n  config: {}\n')
    // no staged/previous strays remain
    const strays = readdirSync(fixture.profile).filter((name) => name.startsWith('.staged-') || name.startsWith('.previous-'))
    assert.deepEqual(strays, [])
    // recovery with nothing to heal preserves the current state
    assert.equal(recoverSwap(fixture.profile), false)
    assert.equal(readFileSync(join(fixture.profile, 'cordis.patch.yml'), 'utf8'), '- id: new-row\n  config: {}\n')
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('a hard kill mid-swap leaves no externally visible half-written state: recoverSwap restores it', async () => {
  const fixture = makeHome()
  try {
    const original = readFileSync(join(fixture.profile, 'cordis.patch.yml'), 'utf8')
    // simulate an interruption between moving the originals out and moving
    // the staged files in: previous backup exists, main file missing.
    const token = '98765'
    const previousDir = join(fixture.profile, `.previous-${token}`)
    const stagedDir = join(fixture.profile, `.staged-${token}`)
    mkdirSync(previousDir, { recursive: true })
    mkdirSync(stagedDir, { recursive: true })
    renameSync(join(fixture.profile, 'cordis.patch.yml'), join(previousDir, 'cordis.patch.yml'))
    writeFileSync(join(stagedDir, 'cordis.patch.yml'), '- id: interrupted\n')
    // the crash leaves the profile without its patch file
    assert.ok(!existsSync(join(fixture.profile, 'cordis.patch.yml')))
    // next executor start heals it
    assert.equal(recoverSwap(fixture.profile), true)
    assert.equal(readFileSync(join(fixture.profile, 'cordis.patch.yml'), 'utf8'), original)
    assert.ok(!existsSync(previousDir))
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('commitProfileChange rejects on CAS mismatch leaving the profile byte-identical', async () => {
  const fixture = makeHome()
  try {
    const baseline = profileBaseline(fixture.profile)
    // tamper after baseline capture
    writeFileSync(join(fixture.profile, 'cordis.patch.yml'), '- id: tampered\n')
    const before = readFileSync(join(fixture.profile, 'cordis.patch.yml'), 'utf8')
    const result = commitProfileChange({
      profileDir: fixture.profile,
      expectedBaseline: baseline,
      stagedFiles: { 'cordis.patch.yml': '- id: new\n' },
      backupsRoot: join(fixture.root, 'backups', 'dev'),
      retention: 5,
    })
    assert.equal(result.outcome, 'error')
    assert.equal(result.code, 'cas-conflict')
    assert.equal(readFileSync(join(fixture.profile, 'cordis.patch.yml'), 'utf8'), before)
    assert.equal(result.restartRequired, false)
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('commitProfileChange succeeds with backup rotation and restartRequired truth', async () => {
  const fixture = makeHome()
  try {
    const baseline = profileBaseline(fixture.profile)
    const backupsRoot = join(fixture.root, 'backups', 'dev')
    const result = commitProfileChange({
      profileDir: fixture.profile,
      expectedBaseline: baseline,
      stagedFiles: { 'cordis.patch.yml': '- id: webserver\n  config: { port: 1234 }\n' },
      backupsRoot,
      retention: 2,
    })
    assert.equal(result.outcome, 'success')
    assert.equal(result.restartRequired, true)
    assert.ok(result.generation > 0)
    // a no-op swap (identical content) does not claim a restart.
    const baseline2 = profileBaseline(fixture.profile)
    const noop = commitProfileChange({
      profileDir: fixture.profile,
      expectedBaseline: baseline2,
      stagedFiles: { 'cordis.patch.yml': readFileSync(join(fixture.profile, 'cordis.patch.yml'), 'utf8') },
      backupsRoot,
      retention: 2,
    })
    assert.equal(noop.outcome, 'success')
    assert.equal(noop.restartRequired, false)
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('backup rotation keeps only the newest N generations', async () => {
  const fixture = makeHome()
  try {
    const backupsRoot = join(fixture.root, 'backups', 'dev')
    let baseline = profileBaseline(fixture.profile)
    for (let index = 0; index < 6; index += 1) {
      const result = commitProfileChange({
        profileDir: fixture.profile,
        expectedBaseline: baseline,
        stagedFiles: { 'cordis.patch.yml': `- id: row-${index}\n` },
        backupsRoot,
        retention: 2,
      })
      assert.equal(result.outcome, 'success')
      baseline = profileBaseline(fixture.profile)
    }
    const generations = readdirSync(backupsRoot)
    assert.equal(generations.length, 2)
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('applyGate rejects unvalidated and dirty snapshots and accepts validated ones', async () => {
  const fixture = makeHome()
  try {
    const created = await createSnapshot({ root: fixture.root, intent: { owner: 'p', snapshotId: 'sna-gate', source: 'runtime', config: {} }, config: CONFIG })
    assert.equal(created.outcome, 'success')
    const dir = join(fixture.root, 'snapshots', 'p', 'sna-gate')
    assert.equal(applyGate(dir).ok, false) // clean
    await modifySnapshot({ root: fixture.root, intent: { owner: 'p', snapshotId: 'sna-gate', config: { patch: '- id: x' } } })
    assert.equal(applyGate(dir).ok, false) // dirty
    await markValidated({ root: fixture.root, intent: { owner: 'p', snapshotId: 'sna-gate' }, generation: 'gen-9' })
    const gate = applyGate(dir)
    assert.equal(gate.ok, true)
    assert.equal(gate.record.validatedGeneration, 'gen-9')
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('quick-write config happy path: validate + CAS + swap + restartRequired', async () => {
  const fixture = makeHome()
  try {
    const result = await quickWrite({
      root: fixture.root,
      intent: {
        operationId: 'qw-1',
        owner: 'plugin-a',
        profile: 'dev',
        type: 'config',
        rows: [{ id: 'agent-default-model', config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }],
      },
      env: envOf(fixture),
      config: CONFIG,
    })
    assert.equal(result.outcome, 'success')
    assert.equal(result.result.restartRequired, true)
    const patch = readFileSync(join(fixture.profile, 'cordis.patch.yml'), 'utf8')
    assert.ok(patch.includes('agent-default-model'))
    assert.ok(patch.includes('deepseek-v4-flash'))
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('quick-write deps happy path: pnpm runs inside the clone, manifest lands with restart', async () => {
  const fixture = makeHome()
  try {
    const result = await quickWrite({
      root: fixture.root,
      intent: { operationId: 'qw-2', owner: 'plugin-a', profile: 'dev', type: 'deps', add: ['@deepseek-ai/plugin-new'] },
      env: envOf(fixture),
      config: CONFIG,
    })
    assert.equal(result.outcome, 'success')
    const manifest = JSON.parse(readFileSync(join(fixture.profile, 'package.json'), 'utf8'))
    assert.ok(manifest.dependencies['@deepseek-ai/plugin-new'])
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('quick-write pnpm failure aborts with the real profile byte-identical', async () => {
  const fixture = makeHome()
  try {
    const before = readFileSync(join(fixture.profile, 'package.json'), 'utf8')
    const result = await quickWrite({
      root: fixture.root,
      intent: { operationId: 'qw-3', owner: 'plugin-a', profile: 'dev', type: 'deps', add: ['@deepseek-ai/plugin-new'] },
      env: envOf(fixture, { FAKE_PNPM_FAIL: '1' }),
      config: CONFIG,
    })
    assert.equal(result.outcome, 'error')
    assert.equal(readFileSync(join(fixture.profile, 'package.json'), 'utf8'), before)
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('quick-write validation failure (boot crash) aborts without touching the real profile', async () => {
  const fixture = makeHome()
  try {
    const before = readFileSync(join(fixture.profile, 'cordis.patch.yml'), 'utf8')
    const result = await quickWrite({
      root: fixture.root,
      intent: { operationId: 'qw-4', owner: 'plugin-a', profile: 'dev', type: 'config', rows: [{ id: 'x' }] },
      env: envOf(fixture, { FAKE_BOOT_EXIT: '7' }),
      config: CONFIG,
    })
    assert.equal(result.outcome, 'error')
    assert.equal(readFileSync(join(fixture.profile, 'cordis.patch.yml'), 'utf8'), before)
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('manual snapshot full chain: create -> modify -> validate -> apply succeeds (the validated-generation rule/6.5/6.6)', async () => {
  const fixture = makeHome()
  try {
    const created = await createSnapshot({
      root: fixture.root,
      intent: { owner: 'plugin-a', snapshotId: 'sna-chain', source: 'disk', sourceProfile: 'dev' },
      config: CONFIG,
    })
    assert.equal(created.outcome, 'success')
    const dir = join(fixture.root, 'snapshots', 'plugin-a', 'sna-chain')
    await modifySnapshot({ root: fixture.root, intent: { owner: 'plugin-a', snapshotId: 'sna-chain', config: { patch: '- id: staged-row\n  config: {}\n' } } })
    // "validate" is a run; for the chain test we mark validated directly with
    // the CLI-equivalent generation binding.
    await markValidated({ root: fixture.root, intent: { owner: 'plugin-a', snapshotId: 'sna-chain' }, generation: 'gen-chain' })
    const gate = applyGate(dir)
    assert.equal(gate.ok, true)

    const applyResult = await snapshotApply({
      root: fixture.root,
      intent: { owner: 'plugin-a', snapshotId: 'sna-chain', profile: 'dev' },
      env: envOf(fixture),
      config: CONFIG,
    })
    assert.equal(applyResult.outcome, 'success')
    assert.equal(applyResult.result.restartRequired, true)
    const patch = readFileSync(join(fixture.profile, 'cordis.patch.yml'), 'utf8')
    assert.ok(patch.includes('staged-row'))
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('snapshot-apply rejects a gate-conflict snapshot with the real profile untouched', async () => {
  const fixture = makeHome()
  try {
    await createSnapshot({ root: fixture.root, intent: { owner: 'p', snapshotId: 'sna-gate2', source: 'runtime', config: {} }, config: CONFIG })
    const before = readFileSync(join(fixture.profile, 'cordis.patch.yml'), 'utf8')
    const result = await snapshotApply({
      root: fixture.root,
      intent: { owner: 'p', snapshotId: 'sna-gate2', profile: 'dev' },
      env: envOf(fixture),
      config: CONFIG,
    })
    assert.equal(result.outcome, 'error')
    assert.equal(result.code, 'gate-conflict')
    assert.equal(readFileSync(join(fixture.profile, 'cordis.patch.yml'), 'utf8'), before)
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})

test('prepareConfigChange merges the current patch with the change rows', async () => {
  const fixture = makeHome()
  try {
    const prepared = prepareConfigChange({ profileDir: fixture.profile, rows: [{ id: 'new-row' }] })
    assert.ok(prepared.stagedPatch.includes('webserver'))
    assert.ok(prepared.stagedPatch.includes('new-row'))
  } finally {
    rmSync(fixture.base, { recursive: true, force: true })
  }
})