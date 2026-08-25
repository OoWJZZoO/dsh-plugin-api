/**
 * System-owned global seed cache (the seed-cache creation..8.3): created by hardlink-cloning
 * the target profile's node_modules on first use; later snapshots
 * materialize dependency trees from the seed via hardlinks and reconcile
 * deltas inside the snapshot only; fingerprint drift rebuilds the seed
 * atomically. Written by exactly one process at a time (exclusive
 * single-writer; the rename-based swap is atomic).
 */
import { mkdirSync, rmSync, readdirSync, statSync, copyFileSync, linkSync, renameSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'

/** Fingerprint of a profile's dependency identity: sha256 of its package.json. */
export function dependencyFingerprint(profileDir) {
  try {
    const manifest = join(profileDir, 'package.json')
    if (!existsSync(manifest)) return undefined
    const content = readFileSync(manifest, 'utf8')
    return createHash('sha256').update(content).digest('hex')
  } catch {
    return undefined
  }
}

/**
 * Recursively hardlink-clone a directory tree. Directories are created;
 * regular files are hardlinked; symlinks are recreated as symlinks (never
 * followed). Never throws past the first bucket: a failure returns false and
 * the caller cleans up.
 */
export function hardlinkClone(source, target) {
  try {
    if (!existsSync(source)) return false
    mkdirSync(target, { recursive: true })
    for (const entry of readdirSync(source)) {
      const from = join(source, entry)
      const to = join(target, entry)
      const stats = statSync(from)
      if (stats.isDirectory()) {
        if (!hardlinkClone(from, to)) return false
      } else if (stats.isSymbolicLink()) {
        try {
          copyFileSync(from, to) // recreates the symlink itself, not the target
        } catch {
          try {
            rmSync(to, { force: true })
            linkSync(from, to)
          } catch {
            return false
          }
        }
      } else {
        try {
          linkSync(from, to)
        } catch {
          return false
        }
      }
    }
    return true
  } catch {
    return false
  }
}

/**
 * Rebuild the seed for one profile atomically when its dependency
 * fingerprint drifted (the atomic seed rebuild). Exclusive: the swap is a single rename;
 * concurrent callers converge on the same final state and stale staging
 * directories are cleaned up.
 *
 * @param {string} seedDir - cache/seed root.
 * @param {string} profileName - target profile name.
 * @param {string} profileDir - real profile directory.
 * @param {boolean} force - rebuild even when the fingerprint matches.
 * @returns {{ ok: boolean, rebuilt: boolean }} result.
 */
export function rebuildSeed({ seedDir, profileName, profileDir, force = false }) {
  try {
    const fingerprint = dependencyFingerprint(profileDir)
    if (!fingerprint) return { ok: false, rebuilt: false }
    const target = join(seedDir, profileName)
    const stamp = join(target, '.fingerprint')
    if (!force && existsSync(stamp) && readFileSync(stamp, 'utf8') === fingerprint) {
      return { ok: true, rebuilt: false }
    }
    const staging = join(seedDir, `.${profileName}.staging-${process.pid}-${Date.now()}`)
    // A profile without node_modules yields an empty seed (valid: the isolated
    // boot relies on the global runtime tree for core packages).
    const nodeModulesSource = join(profileDir, 'node_modules')
    if (!existsSync(nodeModulesSource)) {
      mkdirSync(join(staging, 'node_modules'), { recursive: true })
    } else if (!hardlinkClone(nodeModulesSource, join(staging, 'node_modules'))) {
      rmSync(staging, { recursive: true, force: true })
      return { ok: false, rebuilt: false }
    }
    mkdirSync(join(staging, 'profiles'), { recursive: true })
    writeFileSync(join(staging, 'profiles', '.fingerprint'), fingerprint, 'utf8')
    // Atomic swap: one rename replaces the old seed. Clean strays.
    const previous = `${target}.old-${Date.now()}`
    try {
      if (existsSync(target)) renameSync(target, previous)
      renameSync(staging, target)
      rmSync(previous, { recursive: true, force: true })
      writeFileSync(join(target, '.fingerprint'), fingerprint, 'utf8')
      return { ok: true, rebuilt: true }
    } catch (error) {
      // restore the previous seed if the swap failed mid-way
      try {
        if (!existsSync(target) && existsSync(previous)) renameSync(previous, target)
      } catch {
        // best effort
      }
      rmSync(staging, { recursive: true, force: true })
      return { ok: false, rebuilt: false, reason: error?.message ?? String(error) }
    }
  } catch {
    return { ok: false, rebuilt: false }
  }
}

/**
 * Materialize a snapshot's dependency tree from the seed via hardlinks
 * (the seed-cache reuse). Reconciles the seed first when the target profile fingerprint
 * drifted. Returns the result with the snapshot node_modules path.
 *
 * @param {object} options - { seedDir, profileName, profileDir, snapshotNodeModules }
 * @returns {{ ok: true, path } | { ok: false, reason }}
 */
export function materializeDependencies({ seedDir, profileName, profileDir, snapshotNodeModules }) {
  const seedResult = rebuildSeed({ seedDir, profileName, profileDir })
  if (!seedResult.ok) return { ok: false, reason: 'seed-unavailable' }
  const seedTree = join(seedDir, profileName, 'node_modules')
  if (!existsSync(seedTree)) return { ok: false, reason: 'seed-missing' }
  const target = snapshotNodeModules
  mkdirSync(dirname(target), { recursive: true })
  if (!hardlinkClone(seedTree, target)) {
    return { ok: false, reason: 'materialize-failed' }
  }
  return { ok: true, path: target }
}