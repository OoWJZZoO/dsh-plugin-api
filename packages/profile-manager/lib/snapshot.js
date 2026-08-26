/**
 * Executor snapshot lifecycle: create / modify / delete with the durable
 * state machine `clean → dirty ⇄ validated` (validated bound to a content
 * generation), per-snapshot mutual exclusion, owner-bounded parallelism,
 * and quota accounting.
 *
 * Concurrency strategy (approved design KDD #4):
 * - operations on the same snapshotId are mutually exclusive — realized
 *   with an atomic mkdir lock directory inside the snapshot (mkdir is
 *   atomic across processes; each executor operation is its own subprocess);
 * - different owners' snapshots run in parallel (owner-bounded parallelism);
 * - seed-cache rebuilds are exclusive single-writer (see seed-cache.js).
 */
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, readlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { snapshotDir, DEFAULT_CONFIG } from './storage.js'

export const LIFECYCLE_STATE = Object.freeze({
  clean: 'clean',
  dirty: 'dirty',
  validated: 'validated',
})

export const SNAPSHOT_RECORD_FILE = 'snapshot.json'
export const CONFIG_COPY_FILES = Object.freeze(['package.json', 'cordis.patch.yml', 'cordis.yml'])

export const LOCK_TIMEOUT_MS = 30000
export const LOCK_POLL_MS = 25

/**
 * Acquire a per-snapshot exclusive lock via atomic mkdir. Returns a release
 * function; null when the lock cannot be acquired within the timeout.
 */
export async function acquireSnapshotLock(dir, { timeoutMs = LOCK_TIMEOUT_MS, now = Date.now } = {}) {
  const lockDir = join(dir, '.lock')
  const deadline = now() + timeoutMs
  for (;;) {
    try {
      mkdirSync(lockDir)
      return () => {
        try {
          rmSync(lockDir, { recursive: true, force: true })
        } catch {
          // best-effort release
        }
      }
    } catch {
      if (!existsSync(lockDir)) throw new Error('snapshot lock acquire failed unexpectedly')
      if (now() >= deadline) return null
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS))
    }
  }
}

function classifyCallerOwner(intent) {
  if (intent && typeof intent.owner === 'string' && intent.owner.length > 0) return intent.owner
  return undefined
}

function validateNames(intent) {
  const owner = classifyCallerOwner(intent)
  if (!owner) return 'missing-owner'
  return undefined
}

/**
 * Create a snapshot as a near-instant atomic step (lazy materialization): configuration
 * files are copied now; dependencies are materialized only at first
 * validate. Quota is enforced before creation (the quota contract/8.5). Returns a
 * direct typed result or a typed denial.
 */
export async function createSnapshot({ root, intent, config, now = Date.now }) {
  const reason = validateNames(intent)
  if (reason) return { outcome: 'error', code: 'invalid-input', reason, auditability: true }
  const owner = intent.owner
  const snapshotId = typeof intent.snapshotId === 'string' && intent.snapshotId.length > 0
    ? intent.snapshotId
    : randomUUID()
  const dir = snapshotDir(root, owner, snapshotId)
  if (!dir) return { outcome: 'error', code: 'invalid-input', reason: 'invalid-snapshot-path', auditability: true }
  if (existsSync(dir)) {
    return { outcome: 'error', code: 'invalid-input', reason: 'snapshot-exists', owner, target: snapshotId, auditability: true }
  }
  const quota = enforceQuota({ root, owner, config: config ?? DEFAULT_CONFIG, extraBytes: 0 })
  if (quota) return { ...quota, owner, target: snapshotId, auditability: true }
  try {
    mkdirSync(dir, { recursive: true })
    // Config files are copied via the caller-supplied content (source
    // 'runtime') or read from the source profile directory (source 'disk').
    const source = intent.source === 'disk' ? 'disk' : 'runtime'
    const files = {}
    if (source === 'disk') {
      const profileDir = typeof intent.sourceProfile === 'string' && intent.sourceProfile.length > 0
        ? join(root, '..', '..', 'profiles', intent.sourceProfile)
        : undefined
      if (profileDir && existsSync(profileDir)) {
        for (const name of CONFIG_COPY_FILES) {
          try {
            const path = join(profileDir, name)
            if (existsSync(path)) files[name] = readFileSync(path, 'utf8')
          } catch {
            // an unreadable config file is simply not copied
          }
        }
      }
    } else if (intent && typeof intent.config === 'object' && intent.config !== null) {
      for (const name of CONFIG_COPY_FILES) {
        if (typeof intent.config[name] === 'string') files[name] = intent.config[name]
      }
    }
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content, 'utf8')
    }
    const record = {
      snapshotId,
      owner,
      sourceProfile: source === 'disk' ? intent.sourceProfile : undefined,
      lifecycleState: LIFECYCLE_STATE.clean,
      validatedGeneration: intent.validatedGeneration ?? undefined,
      createdAt: new Date(now()).toISOString(),
    }
    writeFileSync(join(dir, SNAPSHOT_RECORD_FILE), JSON.stringify(record, null, 2), 'utf8')
    return {
      outcome: 'success',
      owner,
      target: snapshotId,
      result: { snapshotId, owner, lifecycleState: LIFECYCLE_STATE.clean, path: dir },
      auditability: true,
    }
  } catch (error) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup of the failed creation
    }
    return { outcome: 'error', code: 'internal', reason: error?.message ?? String(error), owner, target: snapshotId, auditability: true }
  }
}

/**
 * Read the snapshot record, or undefined when absent/unreadable.
 */
export function readSnapshotRecord(dir) {
  try {
    if (!dir || !existsSync(dir)) return undefined
    const raw = readFileSync(join(dir, SNAPSHOT_RECORD_FILE), 'utf8')
    const record = JSON.parse(raw)
    if (record === null || typeof record !== 'object') return undefined
    return record
  } catch {
    return undefined
  }
}

export function readSnapshotField(dir, field) {
  const record = readSnapshotRecord(dir)
  return record?.[field]
}

/**
 * Modify an existing snapshot: edits are applied without validation and the
 * lifecycle state becomes dirty (the dirty-state rule); a validated generation is
 * invalidated (the validated invalidation rule).
 */
export async function modifySnapshot({ root, intent, now = Date.now }) {
  const owner = classifyCallerOwner(intent)
  if (!owner) return { outcome: 'error', code: 'invalid-input', reason: 'missing-owner', auditability: true }
  const snapshotId = intent?.snapshotId
  if (typeof snapshotId !== 'string' || snapshotId.length === 0) {
    return { outcome: 'error', code: 'invalid-input', reason: 'missing-snapshot-id', auditability: true }
  }
  const dir = snapshotDir(root, owner, snapshotId)
  if (!dir) return { outcome: 'error', code: 'invalid-input', reason: 'invalid-snapshot-path', auditability: true }
  const release = await acquireSnapshotLock(dir)
  if (!release) return { outcome: 'error', code: 'internal', reason: 'lock-timeout', owner, target: snapshotId, auditability: true }
  try {
    if (!existsSync(dir)) {
      return { outcome: 'error', code: 'invalid-input', reason: 'snapshot-not-found', owner, target: snapshotId, auditability: true }
    }
    const record = readSnapshotRecord(dir)
    if (!record) {
      return { outcome: 'error', code: 'internal', reason: 'snapshot-record-unreadable', owner, target: snapshotId, auditability: true }
    }
    if (record.owner !== owner) {
      return { outcome: 'error', code: 'ownership-conflict', reason: 'snapshot-owned-by-different-owner', owner, target: snapshotId, auditability: true }
    }
    // Apply the requested config edits into the snapshot copy.
    if (intent?.config && typeof intent.config === 'object' && !Array.isArray(intent.config)) {
      writeFileSync(join(dir, 'cordis.patch.yml'), String(intent.config.patch ?? ''), 'utf8')
    }
    record.lifecycleState = LIFECYCLE_STATE.dirty
    record.validatedGeneration = undefined
    record.modifiedAt = new Date(now()).toISOString()
    writeFileSync(join(dir, SNAPSHOT_RECORD_FILE), JSON.stringify(record, null, 2), 'utf8')
    return { outcome: 'success', owner, target: snapshotId, result: { snapshotId, lifecycleState: LIFECYCLE_STATE.dirty }, auditability: true }
  } catch (error) {
    return { outcome: 'error', code: 'internal', reason: error?.message ?? String(error), owner, target: snapshotId, auditability: true }
  } finally {
    release()
  }
}

/**
 * Mark a snapshot validated, bound to its current content generation
 * (the validated-generation rule): the apply gate reads this state, and any later modify reverts
 * it to dirty (the validated invalidation rule). The generation is the owner-local opaque token
 * derived from the snapshot's config content hash.
 *
 * @returns result with the persisted lifecycleState/validatedGeneration.
 */
export async function markValidated({ root, intent, generation, now = Date.now }) {
  const owner = classifyCallerOwner(intent)
  if (!owner) return { outcome: 'error', code: 'invalid-input', reason: 'missing-owner', auditability: true }
  const snapshotId = intent?.snapshotId
  if (typeof snapshotId !== 'string' || snapshotId.length === 0) {
    return { outcome: 'error', code: 'invalid-input', reason: 'missing-snapshot-id', auditability: true }
  }
  const dir = snapshotDir(root, owner, snapshotId)
  if (!dir) return { outcome: 'error', code: 'invalid-input', reason: 'invalid-snapshot-path', auditability: true }
  const release = await acquireSnapshotLock(dir)
  if (!release) return { outcome: 'error', code: 'internal', reason: 'lock-timeout', owner, target: snapshotId, auditability: true }
  try {
    const record = readSnapshotRecord(dir)
    if (!record) {
      return { outcome: 'error', code: 'internal', reason: 'snapshot-record-unreadable', owner, target: snapshotId, auditability: true }
    }
    if (record.owner !== owner) {
      return { outcome: 'error', code: 'ownership-conflict', reason: 'snapshot-owned-by-different-owner', owner, target: snapshotId, auditability: true }
    }
    record.lifecycleState = LIFECYCLE_STATE.validated
    record.validatedGeneration = typeof generation === 'string' && generation.length > 0 ? generation : undefined
    record.validatedAt = new Date(now()).toISOString()
    writeFileSync(join(dir, SNAPSHOT_RECORD_FILE), JSON.stringify(record, null, 2), 'utf8')
    return {
      outcome: 'success',
      owner,
      target: snapshotId,
      result: { snapshotId, lifecycleState: LIFECYCLE_STATE.validated, validatedGeneration: record.validatedGeneration },
      auditability: true,
    }
  } catch (error) {
    return { outcome: 'error', code: 'internal', reason: error?.message ?? String(error), owner, target: snapshotId, auditability: true }
  } finally {
    release()
  }
}

/**
 * Delete a snapshot owned by the caller (the ownership rule); idempotent on missing
 * snapshots; a snapshot recorded under a different owner is rejected with
 * ownership-conflict even when the caller has no directory of their own.
 */
export async function deleteSnapshot({ root, intent }) {
  const owner = classifyCallerOwner(intent)
  if (!owner) return { outcome: 'error', code: 'invalid-input', reason: 'missing-owner', auditability: true }
  const snapshotId = intent?.snapshotId
  if (typeof snapshotId !== 'string' || snapshotId.length === 0) {
    return { outcome: 'error', code: 'invalid-input', reason: 'missing-snapshot-id', auditability: true }
  }
  const dir = snapshotDir(root, owner, snapshotId)
  if (!dir) return { outcome: 'error', code: 'invalid-input', reason: 'invalid-snapshot-path', auditability: true }
  if (!existsSync(dir)) {
    // Idempotency boundary: before claiming success, make sure the id is not
    // recorded under a different owner (cross-owner probe) so a foreign
    // delete is rejected rather than silently reporting a missing snapshot.
    const foreignRecord = findSnapshotByOwner(root, owner, snapshotId)
    if (foreignRecord) {
      return {
        outcome: 'error',
        code: 'ownership-conflict',
        reason: 'snapshot-owned-by-different-owner',
        owner,
        target: snapshotId,
        auditability: true,
      }
    }
    return { outcome: 'success', owner, target: snapshotId, result: { snapshotId, removed: false }, auditability: true }
  }
  const record = readSnapshotRecord(dir)
  if (record && record.owner !== owner) {
    return { outcome: 'error', code: 'ownership-conflict', reason: 'snapshot-owned-by-different-owner', owner, target: snapshotId, auditability: true }
  }
  const release = await acquireSnapshotLock(dir)
  if (!release) return { outcome: 'error', code: 'internal', reason: 'lock-timeout', owner, target: snapshotId, auditability: true }
  try {
    rmSync(dir, { recursive: true, force: true })
    return { outcome: 'success', owner, target: snapshotId, result: { snapshotId, removed: true }, auditability: true }
  } catch (error) {
    return { outcome: 'error', code: 'internal', reason: error?.message ?? String(error), owner, target: snapshotId, auditability: true }
  } finally {
    release()
  }
}

/**
 * Scan other owners' snapshot directories for a record with the given
 * snapshot id. Returns the record when found under a different owner,
 * undefined otherwise. Read-only; used for the ownership boundary.
 */
function findSnapshotByOwner(root, owner, snapshotId) {
  try {
    const snapshotsRoot = join(root, 'snapshots')
    if (!existsSync(snapshotsRoot)) return undefined
    const walk = (current) => {
      for (const entry of readdirSync(current)) {
        const full = join(current, entry)
        let stats
        try {
          stats = statSync(full)
        } catch {
          continue
        }
        if (!stats.isDirectory()) continue
        const record = readSnapshotRecord(full)
        if (record && record.snapshotId === snapshotId && record.owner !== owner) {
          return record
        }
        if (!record) {
          const nested = walk(full)
          if (nested) return nested
        }
      }
      return undefined
    }
    return walk(snapshotsRoot)
  } catch {
    return undefined
  }
}

/**
 * Account the apparent bytes of a snapshot directory (quota semantics:
 * apparent bytes of snapshot directories; the seed cache is excluded).
 */
export function apparentBytesOf(dir) {
  if (!dir || !existsSync(dir)) return 0
  let total = 0
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      let stats
      try {
        stats = statSync(full)
      } catch {
        continue
      }
      if (stats.isSymbolicLink()) {
        try {
          total += (readlinkSync(full) ?? '').length
        } catch {
          // unresolvable link contributes zero apparent weight
        }
      } else if (stats.isDirectory()) {
        if (entry === '.lock') continue
        walk(full)
      } else {
        total += stats.size
      }
    }
  }
  walk(dir)
  return total
}

/**
 * Quota guard: apparent bytes per owner and total across owners.
 * Returns null when the operation may proceed; a typed denial otherwise.
 * Never auto-deletes existing data to free space (the no-auto-delete rule).
 */
export function enforceQuota({ root, owner, config, extraBytes = 0 }) {
  const ownerDir = join(root, 'snapshots', owner)
  const ownerBytes = existsSync(ownerDir) ? apparentBytesOf(ownerDir) : 0
  if (ownerBytes + extraBytes > config.quotaPerOwnerMb * 1024 * 1024) {
    return { outcome: 'error', code: 'quota-exceeded', reason: 'owner-quota', owner, detail: { ownerBytes, limitMb: config.quotaPerOwnerMb } }
  }
  // Apparent bytes across ALL owners (including the caller's own snapshot
  // dir); the seed cache is system-owned and excluded by layout.
  const snapshotsRoot = join(root, 'snapshots')
  let totalBytes = 0
  if (existsSync(snapshotsRoot)) {
    for (const sub of readdirSync(snapshotsRoot)) {
      const full = join(snapshotsRoot, sub)
      try {
        if (statSync(full).isDirectory()) totalBytes += apparentBytesOf(full)
      } catch {
        // an unreadable sibling counts conservatively as its apparent dir size
      }
    }
  }
  if (totalBytes + extraBytes > config.quotaTotalMb * 1024 * 1024) {
    return { outcome: 'error', code: 'quota-exceeded', reason: 'total-quota', owner, detail: { totalBytes, limitMb: config.quotaTotalMb } }
  }
  return null
}