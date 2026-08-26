import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureStorageRoot } from '../lib/storage.js'
import { createSnapshot } from '../lib/snapshot.js'
import {
  runValidation,
  classifyBoot,
  resolveDshBin,
  stageValidationEnvironment,
  BASIC_LEVEL,
  BOOT_LEVEL,
  MOCK_ROW_PACKAGE,
  VALIDATION_PORT,
} from '../lib/validate.js'

const CONFIG = { quotaPerOwnerMb: 256, quotaTotalMb: 1024, backupRetentionN: 5 }

function makeFixture() {
  const base = mkdtempSync(join(tmpdir(), 'profile-manager-validate-'))
  const home = join(base, 'dsh')
  mkdirSync(home, { recursive: true })
  const root = ensureStorageRoot({ env: { DSH_HOME: home } })
  // Fake dsh executable: controlled dump output, controlled boot exit and
  // optional provider-hint stderr, so the verdict classification is fully
  // deterministic and offline.
  const fakeDir = join(base, 'fake-bin')
  mkdirSync(fakeDir, { recursive: true })
  const fakeDsh = join(fakeDir, 'dsh')
  writeFileSync(fakeDsh, [
    '#!/usr/bin/env node',
    'if (process.argv.includes("--dump-config")) {',
    '  process.stdout.write(process.env.FAKE_DUMP ?? "")',
    '  process.exit(Number(process.env.FAKE_DUMP_EXIT ?? "0"))',
    '}',
    'if (process.env.FAKE_HINT) process.stderr.write(process.env.FAKE_HINT + "\\n")',
    'process.exit(Number(process.env.FAKE_BOOT_EXIT ?? "0"))',
    '',
  ].join('\n'), 'utf8')
  chmodSync(fakeDsh, 0o755)
  const profilesHome = join(root, '..', '..', 'profiles')
  mkdirSync(profilesHome, { recursive: true })
  const profile = join(profilesHome, 'dev')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: webserver\n  config: { port: 3082 }')
  return { base, home, root, fakeDsh, profilesHome, profile }
}

function makeSnapshot(root, owner = 'plugin-a', snapshotId = 'sna-1', sourceProfile = 'dev') {
  return createSnapshot({
    root,
    intent: { owner, snapshotId, source: 'disk', sourceProfile },
    config: CONFIG,
  })
}

test('classifyBoot maps exit 0 to healthy; non-zero non-provider to crash; provider hints to caveat', () => {
  assert.deepEqual(classifyBoot({ code: 0, stderr: '' }), { bootHealthy: true, caveats: [] })
  const crash = classifyBoot({ code: 1, stderr: 'some boot error' })
  assert.equal(crash.bootHealthy, false)
  assert.equal(crash.caveats[0], 'boot-crash:exit-1')
  const provider = classifyBoot({ code: 1, stderr: 'rate limit exceeded' })
  assert.equal(provider.bootHealthy, true)
  assert.deepEqual(provider.caveats, ['provider-layer:rate limit'])
  const network = classifyBoot({ code: 2, stderr: 'network unreachable' })
  assert.equal(network.bootHealthy, true)
})

test('resolveDshBin honors the env seam and falls back to the PATH name', () => {
  assert.equal(resolveDshBin({ DSH_PLUGIN_API_PROFILE_DSH_BIN: '/opt/x/dsh' }), '/opt/x/dsh')
  assert.equal(resolveDshBin({ DSH_PLUGIN_API_PROFILE_DSH_BIN: '  ' }), 'dsh')
  assert.equal(resolveDshBin({}), 'dsh')
})

test('stageValidationEnvironment composes settings seed, mock row package and validation overlay', async () => {
  const { root, base } = makeFixture()
  try {
    const created = await makeSnapshot(root)
    assert.equal(created.outcome, 'success')
    const snapshotDir = join(root, 'snapshots', 'plugin-a', 'sna-1')
    const tmpHome = join(root, 'tmp', 'run-x')
    const staged = stageValidationEnvironment({ tmpHome, snapshotDir, l2Id: 'run-x' })
    assert.equal(staged.ok, true)
    const settings = readFileSync(staged.settingsPath, 'utf8')
    assert.match(settings, /agent-default-model:/)
    assert.match(settings, /plugin-api-validation/)
    assert.match(settings, /deterministic-completion/)
    const overlay = readFileSync(staged.overlayPath, 'utf8')
    assert.match(overlay, /id: webserver/)
    assert.match(overlay, new RegExp(`port: ${VALIDATION_PORT}`))
    assert.match(overlay, new RegExp(`name: '${MOCK_ROW_PACKAGE}'`))
    assert.ok(existsSync(join(staged.profileDir, 'node_modules', '@deepseek-ai', 'dsh-plugin-api-profile-manager-mock', 'index.js')))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('level basic (basic) fails on duplicate row ids in the dump', async () => {
  const { root, base } = makeFixture()
  try {
    const created = await makeSnapshot(root)
    assert.equal(created.outcome, 'success')
    const snapshotDir = join(root, 'snapshots', 'plugin-a', 'sna-1')
    const result = await runValidation({
      snapshotDir,
      l2Id: 'run-dup',
      level: BASIC_LEVEL,
      dshBin: join(base, 'fake-bin', 'dsh'),
      env: {
        FAKE_DUMP: '- id: webserver\n  config: {}\n- id: webserver\n  config: {}\n',
        FAKE_DUMP_EXIT: '0',
      },
    })
    assert.equal(result.code, 'fail')
    assert.ok(result.blocking.some((entry) => String(entry.detail ?? '').includes('duplicate row ids')))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('level basic (basic) passes with a clean dump', async () => {
  const { root, base } = makeFixture()
  try {
    const created = await makeSnapshot(root)
    assert.equal(created.outcome, 'success')
    const snapshotDir = join(root, 'snapshots', 'plugin-a', 'sna-1')
    const result = await runValidation({
      snapshotDir,
      l2Id: 'run-clean',
      level: BASIC_LEVEL,
      dshBin: join(base, 'fake-bin', 'dsh'),
      env: { FAKE_DUMP: '- id: webserver\n  config: {}\n', FAKE_DUMP_EXIT: '0' },
    })
    assert.equal(result.code, 'ok')
    assert.equal(result.verdict.bootHealthy, true)
    assert.equal(result.verdict.rowsApplied, 1)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('level boot (boot) passes with a clean boot and carries the mock-first verdict', async () => {
  const { root, base } = makeFixture()
  try {
    const created = await makeSnapshot(root)
    assert.equal(created.outcome, 'success')
    const snapshotDir = join(root, 'snapshots', 'plugin-a', 'sna-1')
    const result = await runValidation({
      snapshotDir,
      l2Id: 'run-pass',
      level: BOOT_LEVEL,
      dshBin: join(base, 'fake-bin', 'dsh'),
      env: {
        FAKE_DUMP: '- id: webserver\n  config: {}\n',
        FAKE_DUMP_EXIT: '0',
        FAKE_BOOT_EXIT: '0',
      },
    })
    assert.equal(result.code, 'ok')
    assert.equal(result.verdict.bootHealthy, true)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('level boot (boot) fails on a boot-phase crash; provider failure becomes a caveat pass', async () => {
  const { root, base } = makeFixture()
  try {
    const created = await makeSnapshot(root)
    assert.equal(created.outcome, 'success')
    const snapshotDir = join(root, 'snapshots', 'plugin-a', 'sna-1')
    const dshBin = join(base, 'fake-bin', 'dsh')

    const crash = await runValidation({
      snapshotDir,
      l2Id: 'run-crash',
      level: BOOT_LEVEL,
      dshBin,
      env: { FAKE_DUMP: '- id: a\n', FAKE_DUMP_EXIT: '0', FAKE_BOOT_EXIT: '3' },
    })
    assert.equal(crash.code, 'fail')
    assert.equal(crash.verdict.bootHealthy, false)
    assert.deepEqual(crash.verdict.caveats, ['boot-crash:exit-3'])

    const provider = await runValidation({
      snapshotDir,
      l2Id: 'run-provider',
      level: BOOT_LEVEL,
      dshBin,
      env: { FAKE_DUMP: '- id: a\n', FAKE_DUMP_EXIT: '0', FAKE_BOOT_EXIT: '1', FAKE_HINT: 'insufficient balance' },
    })
    assert.equal(provider.code, 'ok')
    assert.equal(provider.verdict.bootHealthy, true)
    assert.deepEqual(provider.verdict.caveats, ['provider-layer:insufficient balance'])
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('level basic+boot runs both and requires both to pass', async () => {
  const { root, base } = makeFixture()
  try {
    const created = await makeSnapshot(root)
    assert.equal(created.outcome, 'success')
    const snapshotDir = join(root, 'snapshots', 'plugin-a', 'sna-1')
    const result = await runValidation({
      snapshotDir,
      l2Id: 'run-both',
      level: `${BASIC_LEVEL}+${BOOT_LEVEL}`,
      dshBin: join(base, 'fake-bin', 'dsh'),
      env: { FAKE_DUMP: '- id: a\n', FAKE_DUMP_EXIT: '0', FAKE_BOOT_EXIT: '0' },
    })
    assert.equal(result.code, 'ok')
    assert.equal(result.level, 'basic+boot')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('runValidation runs the client-half mechanical check on discovered client content', async () => {
  const { root, base } = makeFixture()
  try {
    const created = await makeSnapshot(root)
    assert.equal(created.outcome, 'success')
    const snapshotDir = join(root, 'snapshots', 'plugin-a', 'sna-1')
    // staged content with a dsh.client manifest + a forbidden node import.
    mkdirSync(join(snapshotDir, 'client'), { recursive: true })
    writeFileSync(join(snapshotDir, 'package.json'), JSON.stringify({ name: 'p', dsh: { client: { platform: 'web' } } }))
    writeFileSync(join(snapshotDir, 'client', 'entry.js'), 'import fs from "node:fs"\nexport const x = 1\n')
    const result = await runValidation({
      snapshotDir,
      l2Id: 'run-client',
      level: 'basic',
      dshBin: join(base, 'fake-bin', 'dsh'),
      env: { FAKE_DUMP: '- id: a\n', FAKE_DUMP_EXIT: '0' },
    })
    assert.equal(result.code, 'fail')
    assert.ok(result.blocking.some((entry) => entry.code === 'client-blocking' && entry.detail?.includes('forbidden import')))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('runValidation rejects unknown levels with typed invalid-input', async () => {
  const { root, base } = makeFixture()
  try {
    const snapshotDir = join(root, 'snapshots')
    const result = await runValidation({
      snapshotDir,
      l2Id: 'run-bad',
      level: 'nope',
      dshBin: join(base, 'fake-bin', 'dsh'),
      env: {},
    })
    assert.equal(result.code, 'invalid-input')
    assert.match(result.reason, /unknown validation level/)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})