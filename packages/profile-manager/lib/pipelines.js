/**
 * Executor write pipelines (the quick-write contract quick-write, the snapshot-apply contract snapshot-apply):
 * prepare -> validate(basic+boot) -> commit with the CAS / atomic-swap /
 * bounded-backup guarantees. The real profile is NEVER mutated during
 * prepare or validate - dependency materialization runs inside a staging
 * clone - so every failure path leaves it byte-identical (the byte-identical guarantee).
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { planConfigOverlay } from '@deepseek-ai/dsh-plugin-api-main/profile-fold'
import { runValidation, resolveDshBin, BASIC_LEVEL, BOOT_LEVEL } from './validate.js'
import { commitProfileChange, profileBaseline, applyGate } from './commit.js'
import { snapshotDir, loadConfig, storagePaths } from './storage.js'
import { rebuildSeed, materializeDependencies } from './seed-cache.js'
import { readSnapshotRecord } from './snapshot.js'

/**
 * Resolve the target real profile directory. The intent must name the
 * profile; when absent, fail closed instead of guessing.
 */
function resolveTargetProfile(root, intent) {
  const profileName = typeof intent?.profile === 'string' && intent.profile.length > 0
    ? intent.profile
    : undefined
  if (!profileName) return { ok: false, reason: 'missing-profile' }
  const profilesHome = join(root, '..', '..', 'profiles')
  const profileDir = join(profilesHome, profileName)
  if (!existsSync(join(profileDir, 'package.json'))) {
    return { ok: false, reason: 'profile-not-found' }
  }
  return { ok: true, profileDir, profileName }
}

/**
 * Build the candidate staged files for a configuration-type intent: the
 * current user patch layer plus the change rows, serialized in the official
 * entry-list dialect. Pure computation (no file writes here).
 */
export function prepareConfigChange({ profileDir, rows }) {
  let current = ''
  try {
    current = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
  } catch {
    current = ''
  }
  const overlay = planConfigOverlay({ rows: Array.isArray(rows) ? rows : [] })
  const merged = [current.trim(), overlay.overlayYaml.trim()]
    .filter((part) => part.length > 0)
    .join('\n')
  return {
    stagedPatch: merged,
    warnings: overlay.warnings,
  }
}

/**
 * Clone the profile's config files into a staging directory (the design's
 * "clone directory" - dependency materialization happens inside the clone).
 */
function stageProfileClone(profileDir, stagingDir) {
  mkdirSync(stagingDir, { recursive: true })
  for (const name of ['package.json', 'cordis.patch.yml', 'cordis.yml']) {
    try {
      const content = readFileSync(join(profileDir, name), 'utf8')
      writeFileSync(join(stagingDir, name), content, 'utf8')
    } catch {
      // missing optional files simply stay absent in the clone
    }
  }
}

/**
 * Run pnpm in a directory (dependency-type intents). The pnpm binary is
 * resolved from PATH with an env seam for hermetic tests
 * (DSH_PLUGIN_API_PROFILE_PNPM_BIN). Runs inside the staging clone.
 */
function runPnpm(args, { cwd, env }) {
  const bin = (env.DSH_PLUGIN_API_PROFILE_PNPM_BIN ?? 'pnpm')
  return new Promise((resolve) => {
    execFile(bin, args, { cwd, env: { ...process.env, ...env }, timeout: 300000 }, (error, stdout, stderr) => {
      if (!error) return resolve({ ok: true, stdout: String(stdout), stderr: String(stderr) })
      resolve({ ok: false, code: error.code, stdout: String(stdout), stderr: String(stderr ?? '') })
    })
  })
}

/**
 * Full quick-write pipeline (the quick-write pipeline): prepare -> validate basic+boot -> commit.
 * Config-type changes are staged from the current patch plus the change
 * rows; dependency-type changes materialize inside the staging clone via
 * pnpm (never in the real profile).
 */
export async function quickWrite({ root, intent, env = {}, now = Date.now, config = loadConfig(root) }) {
  const type = intent?.type
  const operationId = typeof intent?.operationId === 'string' ? intent.operationId : undefined
  const owner = typeof intent?.owner === 'string' ? intent.owner : undefined
  const target = resolveTargetProfile(root, intent)
  if (!target.ok) {
    return { outcome: 'error', code: 'invalid-input', reason: target.reason, owner, target: intent?.profile, auditability: true }
  }
  const { profileDir, profileName } = target
  const stagingRoot = join(root, 'tmp', `qw-${operationId ?? Date.now()}`)
  const stagingDir = join(stagingRoot, 'profiles', 'staging')
  const expectedBaseline = profileBaseline(profileDir)

  let stagedFiles
  try {
    stageProfileClone(profileDir, stagingDir)
    if (type === 'config') {
      const prepared = prepareConfigChange({ profileDir, rows: intent?.rows })
      writeFileSync(join(stagingDir, 'cordis.patch.yml'), prepared.stagedPatch, 'utf8')
    } else if (type === 'deps') {
      const add = Array.isArray(intent?.add) ? intent.add.filter((entry) => typeof entry === 'string') : []
      const remove = Array.isArray(intent?.remove) ? intent.remove.filter((entry) => typeof entry === 'string') : []
      if (add.length === 0 && remove.length === 0) {
        return { outcome: 'error', code: 'invalid-input', reason: 'empty-deps-change', owner, target: profileName, auditability: true }
      }
      const commands = []
      if (add.length > 0) commands.push(['add', ...add])
      if (remove.length > 0) commands.push(['remove', ...remove])
      for (const args of commands) {
        const run = await runPnpm(args, { cwd: stagingDir, env })
        if (!run.ok) {
          return { outcome: 'error', code: 'internal', reason: `pnpm-${args[0]}-failed`, owner, target: profileName, auditability: true }
        }
      }
    } else {
      return { outcome: 'error', code: 'invalid-input', reason: `unknown-intent-type:${String(type)}`, owner, target: profileName, auditability: true }
    }
    stagedFiles = {}
    for (const name of ['package.json', 'cordis.patch.yml', 'cordis.yml']) {
      try {
        stagedFiles[name] = readFileSync(join(stagingDir, name), 'utf8')
      } catch {
        stagedFiles[name] = ''
      }
    }
    // Seed cache lifecycle: the first-ever quick-write creates the system
    // seed; every quick-write materializes the staged clone's dependency
    // tree from it (hardlink clone) so later dependency reconciliation runs
    // inside the clone only. A seed failure degrades the write (byte-identical
    // guarantee preserved) instead of silently proceeding without deps.
    const seedDir = storagePaths(root).seed
    const seed = rebuildSeed({ seedDir, profileName, profileDir })
    if (!seed.ok) {
      return { outcome: 'error', code: 'internal', reason: 'seed-unavailable', owner, target: profileName, auditability: true }
    }
    const materialized = materializeDependencies({
      seedDir,
      profileName,
      profileDir,
      snapshotNodeModules: join(stagingDir, 'node_modules'),
    })
    if (!materialized.ok) {
      return { outcome: 'error', code: 'internal', reason: 'dep-materialize-failed', owner, target: profileName, auditability: true }
    }
  } catch (error) {
    rmSync(stagingRoot, { recursive: true, force: true })
    return { outcome: 'error', code: 'internal', reason: error?.message ?? String(error), owner, target: profileName, auditability: true }
  }

  const validation = await runValidation({
    snapshotDir: stagingDir,
    l2Id: 'staging',
    level: `${BASIC_LEVEL}+${BOOT_LEVEL}`,
    dshBin: resolveDshBin(env),
    env,
    tmpRoot: stagingRoot,
    managerRoot: root,
    profileName,
  })
  if (validation.code !== 'ok') {
    rmSync(stagingRoot, { recursive: true, force: true })
    return {
      outcome: 'error',
      code: 'client-blocking',
      reason: validation.reason ?? validation.blocking.map((entry) => entry.detail ?? entry.code).join('; '),
      owner,
      target: profileName,
      auditability: true,
    }
  }

  const backupsRoot = join(root, 'backups', profileName)
  const commit = commitProfileChange({
    profileDir,
    expectedBaseline,
    stagedFiles,
    backupsRoot,
    retention: config.backupRetentionN,
    now,
  })
  rmSync(stagingRoot, { recursive: true, force: true })
  return {
    outcome: commit.outcome,
    code: commit.code,
    reason: commit.reason,
    restartRequired: commit.restartRequired,
    generation: commit.generation,
    owner,
    target: profileName,
    auditability: true,
    result: {
      validation: validation.verdict,
      restartRequired: Boolean(commit.restartRequired),
      generation: commit.generation ?? undefined,
    },
  }
}

/**
 * Snapshot-apply (the apply gate/6.6): hard gate on the validated generation, then
 * atomic config swap + backup rotation; any failure aborts with the real
 * profile unchanged.
 */
export async function snapshotApply({ root, intent, env = {}, now = Date.now, config = loadConfig(root) }) {
  const owner = typeof intent?.owner === 'string' ? intent.owner : undefined
  const snapshotId = typeof intent?.snapshotId === 'string' ? intent.snapshotId : undefined
  const dir = snapshotDir(root, owner, snapshotId)
  if (!dir || !existsSync(dir)) {
    return { outcome: 'error', code: 'invalid-input', reason: 'snapshot-not-found', owner, target: snapshotId, auditability: true }
  }
  const record = readSnapshotRecord(dir)
  if (record && record.owner !== owner) {
    return { outcome: 'error', code: 'ownership-conflict', reason: 'snapshot-owned-by-different-owner', owner, target: snapshotId, auditability: true }
  }
  const gate = applyGate(dir)
  if (!gate.ok) {
    return {
      outcome: 'error',
      code: gate.reason === 'gate-conflict' ? 'gate-conflict' : 'internal',
      reason: gate.reason,
      owner,
      target: snapshotId,
      auditability: true,
    }
  }
  const target = resolveTargetProfile(root, intent)
  if (!target.ok) {
    return { outcome: 'error', code: 'invalid-input', reason: target.reason, owner, target: snapshotId, auditability: true }
  }
  const { profileDir, profileName } = target
  const expectedBaseline = profileBaseline(profileDir)

  const stagedFiles = {}
  for (const name of ['package.json', 'cordis.patch.yml', 'cordis.yml']) {
    try {
      stagedFiles[name] = readFileSync(join(dir, name), 'utf8')
    } catch {
      stagedFiles[name] = ''
    }
  }

  const backupsRoot = join(root, 'backups', profileName)
  const commit = commitProfileChange({
    profileDir,
    expectedBaseline,
    stagedFiles,
    backupsRoot,
    retention: config.backupRetentionN,
    now,
  })
  return {
    outcome: commit.outcome,
    code: commit.code,
    reason: commit.reason,
    restartRequired: commit.restartRequired,
    generation: commit.generation,
    owner,
    target: snapshotId,
    auditability: true,
    result: {
      restartRequired: Boolean(commit.restartRequired),
      generation: commit.generation ?? undefined,
    },
  }
}
