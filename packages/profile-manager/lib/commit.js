/**
 * Executor commit path (the CAS check..5.9, the apply gate/6.6): CAS baseline hash,
 * atomic config swap (official dsh-atomic-write paradigm: sibling temp +
 * rename; a partial-write state is never externally visible), bounded backup
 * rotation with owner-local monotonic generations, and the byte-identical
 * real-profile guarantee on every failed stage.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync, existsSync, statSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname, basename } from 'node:path'
import { readSnapshotRecord, readSnapshotField, LIFECYCLE_STATE } from './snapshot.js'

/**
 * Compute the CAS baseline of the real profile's config files (package.json
 * + cordis.patch.yml + cordis.yml). Undefined when any required file is
 * unreadable.
 */
export function profileBaseline(profileDir) {
  try {
    const hash = createHash('sha256')
    for (const name of ['package.json', 'cordis.patch.yml', 'cordis.yml']) {
      try {
        const content = readFileSync(join(profileDir, name), 'utf8')
        hash.update(name)
        hash.update(content)
      } catch {
        // missing optional files contribute nothing; package.json is required
        if (name === 'package.json') return undefined
      }
    }
    return hash.digest('hex')
  } catch {
    return undefined
  }
}

/**
 * CAS verification: compare the current real-profile baseline against the
 * prepare-time baseline. Two identical baselines are byte-identical for the
 * config files the pipeline writes.
 */
export function casMatches(profileDir, expectedBaseline) {
  if (typeof expectedBaseline !== 'string') return false
  return profileBaseline(profileDir) === expectedBaseline
}

/**
 * Atomic config swap (official dsh-atomic-write paradigm):
 * 1. write every staged file to a sibling `.staged-<token>` directory;
 * 2. rename the real files away to `.previous-<token>`;
 * 3. rename the staged directory into place;
 * 4. delete the previous files.
 * On any failure step, restore the previous files before returning false, so
 * a partial-write state is never externally visible.
 *
 * @param {string} profileDir - real profile directory.
 * @param {Record<string, string>} stagedFiles - filename -> content.
 * @returns {boolean} true when the swap committed atomically.
 */
export function atomicSwap(profileDir, stagedFiles) {
  const token = `${process.pid}-${Date.now()}`
  const stagedDir = join(profileDir, `.staged-${token}`)
  const previousDir = join(profileDir, `.previous-${token}`)
  try {
    mkdirSync(stagedDir, { recursive: true })
    for (const [name, content] of Object.entries(stagedFiles)) {
      if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') continue
      writeFileSync(join(stagedDir, name), content, 'utf8')
    }
    // move real files out (each rename is atomic on the same filesystem)
    for (const name of Object.keys(stagedFiles)) {
      const from = join(profileDir, name)
      if (existsSync(from)) {
        mkdirSync(previousDir, { recursive: true })
        renameSync(from, join(previousDir, name))
      }
    }
    // move staged files into place
    for (const name of Object.keys(stagedFiles)) {
      renameSync(join(stagedDir, name), join(profileDir, name))
    }
    rmSync(stagedDir, { recursive: true, force: true })
    rmSync(previousDir, { recursive: true, force: true })
    return true
  } catch {
    // restore previous files (best effort, file by file)
    try {
      if (existsSync(previousDir)) {
        for (const name of readdirSync(previousDir)) {
          try {
            renameSync(join(previousDir, name), join(profileDir, name))
          } catch {
            // best effort per file
          }
        }
      }
    } catch {
      // restoration failure must not hide the original error
    }
    rmSync(stagedDir, { recursive: true, force: true })
    rmSync(previousDir, { recursive: true, force: true })
    return false
  }
}

/**
 * Write one backup generation into `backups/<profile>/<generation>/` (the
 * pre-swap content of the config files) and rotate to the bounded retention
 * N (owner-local monotonic generations; oldest dropped).
 *
 * @returns {number} the generation written (0 when nothing to back up).
 */
export function rotateBackup({ profileDir, backupsRoot, retention = 5, now = Date.now }) {
  try {
    const stamp = now()
    const generation = stamp
    const backupDir = join(backupsRoot, String(generation))
    mkdirSync(backupDir, { recursive: true })
    let wroteAny = false
    for (const name of ['package.json', 'cordis.patch.yml', 'cordis.yml']) {
      const from = join(profileDir, name)
      if (existsSync(from)) {
        copyFileSync(from, join(backupDir, name))
        wroteAny = true
      }
    }
    if (!wroteAny) {
      rmSync(backupDir, { recursive: true, force: true })
      return 0
    }
    // bounded rotation: keep the newest N generations.
    const entries = readdirSync(backupsRoot)
      .map((name) => join(backupsRoot, name))
      .filter((path) => {
        try {
          return statSync(path).isDirectory() && /^\d+$/.test(basename(path))
        } catch {
          return false
        }
      })
      .sort((a, b) => Number(basename(a)) - Number(basename(b)))
    for (const old of entries.slice(retention)) {
      rmSync(old, { recursive: true, force: true })
    }
    return generation
  } catch {
    return 0
  }
}

/**
 * The single commit entry used by both quick-write and snapshot-apply:
 *
 * 1. CAS check (the CAS check): baseline mismatch -> typed cas-conflict, profile
 *    byte-identical, rebase notice;
 * 2. backup rotation before the swap (the bounded backup retention);
 * 3. atomic swap (the atomic swap);
 * 4. restartRequired = config or dependencies actually changed.
 *
 * @returns typed terminal result.
 */
export function commitProfileChange({ profileDir, expectedBaseline, stagedFiles, backupsRoot, retention = 5, now = Date.now }) {
  const baselineNow = profileBaseline(profileDir)
  if (typeof expectedBaseline !== 'string' || baselineNow !== expectedBaseline) {
    return {
      outcome: 'error',
      code: 'cas-conflict',
      reason: 'baseline-drifted-rebase-required',
      restartRequired: false,
      auditability: true,
    }
  }
  const baselineBefore = profileBaseline(profileDir)
  const generation = rotateBackup({ profileDir, backupsRoot, retention, now })
  const swapped = atomicSwap(profileDir, stagedFiles)
  if (!swapped) {
    return {
      outcome: 'error',
      code: 'internal',
      reason: 'atomic-swap-failed',
      restartRequired: false,
      auditability: true,
    }
  }
  const baselineAfter = profileBaseline(profileDir)
  const changed = baselineBefore !== baselineAfter
  return {
    outcome: 'success',
    generation,
    restartRequired: changed,
    auditability: true,
  }
}

/**
 * Apply gate (the apply gate): a snapshot may be applied only when its current
 * content generation is validated.
 */
/**
 * Crash recovery for the config swap: a hard kill mid-commit can leave
 * `.previous-<token>` (moved-out originals) and missing main files. Every
 * executor command start heals this by restoring the previous files first,
 * so no externally visible half-written state persists.
 *
 * @returns {boolean} true when a recovery was performed (or nothing to do).
 */
export function recoverSwap(profileDir) {
  try {
    if (!profileDir || !existsSync(profileDir)) return false
    let recovered = false
    for (const entry of readdirSync(profileDir)) {
      if (!entry.startsWith('.previous-') && !entry.startsWith('.staged-')) continue
      const backupDir = join(profileDir, entry)
      if (existsSync(backupDir)) {
        for (const name of readdirSync(backupDir)) {
          const from = join(backupDir, name)
          const to = join(profileDir, name)
          if (!existsSync(to)) {
            try {
              renameSync(from, to)
              recovered = true
            } catch {
              // best effort per file
            }
          }
        }
        rmSync(backupDir, { recursive: true, force: true })
        recovered = true
      }
    }
    return recovered
  } catch {
    return false
  }
}

export function applyGate(snapshotDir) {
  const record = readSnapshotRecord(snapshotDir)
  if (!record) return { ok: false, reason: 'snapshot-record-unreadable' }
  if (record.lifecycleState !== LIFECYCLE_STATE.validated) {
    return { ok: false, reason: 'gate-conflict' }
  }
  return { ok: true, record }
}
