/**
 * Boot-init orphan classification (the orphan rule): a snapshot is orphaned when its
 * owner is absent from BOTH the supplied runtime view AND the target
 * profile's declared dependencies, or when the target profile directory no
 * longer exists. Orphans are deleted immediately; the reinstall-cycle loss
 * is an accepted, documented tradeoff (the reinstall tradeoff).
 */
import { readdirSync, statSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readSnapshotRecord, SNAPSHOT_RECORD_FILE } from './snapshot.js'

/**
 * Walk the snapshots root recursively and yield every directory that holds a
 * snapshot record (`snapshot.json`). Owner scopes may be nested (package
 * names contain `/`), so discovery is record-driven rather than assuming a
 * fixed depth.
 */
function* findSnapshotDirs(root) {
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = readdirSync(current)
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(current, entry)
      try {
        const stats = statSync(full)
        if (!stats.isDirectory()) continue
      } catch {
        continue
      }
      if (existsSync(join(full, SNAPSHOT_RECORD_FILE))) {
        yield full
      } else {
        stack.push(full)
      }
    }
  }
}

/**
 * Read the declared dependency names of a profile manifest (bundles + user
 * dependencies + the manifest's own name if present).
 *
 * @param {string} profileDir
 * @returns {Set<string>} declared package names (bundles ∪ dependencies).
 */
export function declaredDependencies(profileDir) {
  const names = new Set()
  try {
    const raw = readFileSync(join(profileDir, 'package.json'), 'utf8')
    const manifest = JSON.parse(raw)
    if (manifest?.dsh?.profile?.bundles && Array.isArray(manifest.dsh.profile.bundles)) {
      for (const bundle of manifest.dsh.profile.bundles) {
        if (typeof bundle === 'string') names.add(bundle)
      }
    }
    if (manifest?.dependencies && typeof manifest.dependencies === 'object') {
      for (const name of Object.keys(manifest.dependencies)) names.add(name)
    }
  } catch {
    // an unreadable target profile contributes no declared dependencies
  }
  return names
}

/**
 * Classify snapshots for the GC scan.
 *
 * @param {object} options
 * @param {string} options.snapshotsRoot - manager snapshots root.
 * @param {Set<string>} options.runtimeView - owner set from the facade's
 *   boot-time runtime view.
 * @param {(owner: string) => { profileDir?: string } | undefined} options.resolveOwnerProfile -
 *   maps a snapshot owner to its target profile dir (undefined = no target).
 * @returns {{ orphaned: Array<{owner, snapshotId, reason}>, kept: count }}
 */
export function classifyOrphans({ snapshotsRoot, runtimeView = new Set(), resolveOwnerProfile }) {
  const orphaned = []
  const kept = []
  if (!snapshotsRoot || !existsSync(snapshotsRoot)) return { orphaned, kept, keptCount: 0 }
  for (const dir of findSnapshotDirs(snapshotsRoot)) {
    const record = readSnapshotRecord(dir)
    const ownerName = typeof record?.owner === 'string' ? record.owner : undefined
    const snapshotId = typeof record?.snapshotId === 'string' ? record.snapshotId : dir.split(/[\\/]/).pop()
    if (!ownerName) {
      // an unreadable record is not deleted by the GC (never guess)
      kept.push({ owner: dir.split(/[\\/]/).pop(), snapshotId })
      continue
    }
    const target = resolveOwnerProfile?.(ownerName, record)
    const inRuntime = runtimeView.has(ownerName)
    const targetExists = Boolean(target?.profileDir && existsSync(target.profileDir))
    // A snapshot with an unknown/unresolvable target profile (e.g. runtime
    // source without a recorded sourceProfile) is conservatively KEPT when
    // its owner is still present in the runtime view; only a recorded target
    // that no longer exists makes it an orphan. Never guess the target from
    // the owner name.
    if (!target?.profileDir) {
      if (inRuntime) {
        kept.push({ owner: ownerName, snapshotId })
      } else {
        orphaned.push({ owner: ownerName, snapshotId, reason: 'target-profile-unresolved-and-owner-absent' })
      }
      continue
    }
    if (!targetExists) {
      orphaned.push({ owner: ownerName, snapshotId, reason: 'target-profile-missing' })
      continue
    }
    const declared = declaredDependencies(target.profileDir)
    const inDeclared = declared.has(ownerName)
    if (!inRuntime && !inDeclared) {
      orphaned.push({ owner: ownerName, snapshotId, reason: 'owner-absent-from-runtime-and-deps' })
    } else {
      kept.push({ owner: ownerName, snapshotId })
    }
  }
  return { orphaned, kept, keptCount: kept.length }
}

/**
 * Delete the given orphaned snapshot directories immediately.
 *
 * @returns {{ deleted: number }}
 */
export function deleteOrphans({ snapshotsRoot, orphaned }) {
  let deleted = 0
  for (const entry of orphaned) {
    try {
      const dir = join(snapshotsRoot, entry.owner, entry.snapshotId)
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
        deleted += 1
      }
    } catch {
      // one stale entry must not stop the rest of the scan
    }
  }
  return { deleted }
}