/**
 * Executor storage scope and governance primitives (profile scope per
 * durable-state-and-scope §1): `$DSH_HOME/plugin-api/profile-manager/` with
 * snapshots/, cache/seed/, backups/, audit.log and tmp/.
 *
 * Config.json (executor-owned, no public write entry): quotas and backup
 * retention defaults apply fail-closed when missing or partial — never
 * relaxing an existing quota.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const STORAGE_DIR_NAME = 'plugin-api'
export const MANAGER_DIR_NAME = 'profile-manager'
export const SNAPSHOTS_DIR = 'snapshots'
export const CACHE_DIR = 'cache'
export const SEED_DIR = 'seed'
export const BACKUPS_DIR = 'backups'
export const TMP_DIR = 'tmp'
export const AUDIT_FILE = 'audit.log'
export const CONFIG_FILE = 'config.json'

export const DEFAULT_CONFIG = Object.freeze({
  quotaPerOwnerMb: 256,
  quotaTotalMb: 1024,
  backupRetentionN: 5,
})

/** Resolve the DSH home (empty/whitespace $DSH_HOME treated as unset). */
export function resolveDshHome(env = {}) {
  const fromEnv = env.DSH_HOME
  const configured = fromEnv !== undefined && String(fromEnv).trim().length > 0 ? String(fromEnv).trim() : undefined
  if (configured) return resolve(configured)
  const home = env.HOME ?? env.USERPROFILE
  return resolve(home && String(home).length > 0 ? String(home) : '.', '.dsh')
}

/**
 * Ensure the manager storage layout exists and return its absolute path.
 * Directory creation is best effort; a failure degrades the returned root to
 * undefined so callers can type-degrade instead of crashing the executor.
 *
 * @param {{ env?: object }} [options]
 * @returns {string | undefined} the manager root, or undefined on failure.
 */
export function ensureStorageRoot({ env = {} } = {}) {
  try {
    const root = join(resolveDshHome(env), STORAGE_DIR_NAME, MANAGER_DIR_NAME)
    for (const dir of [root, join(root, SNAPSHOTS_DIR), join(root, CACHE_DIR), join(root, CACHE_DIR, SEED_DIR),
      join(root, BACKUPS_DIR), join(root, TMP_DIR)]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    }
    return root
  } catch {
    return undefined
  }
}

/**
 * Resize (ensure) the storage layout and return its root. Fail-safe alias
 * used by the CLI.
 */
export function resizeStorage({ env = {} } = {}) {
  return ensureStorageRoot({ env })
}

/**
 * Load the executor config.json with fail-closed defaults. A missing or
 * malformed config is NOT an error: defaults apply, and a quota present in
 * the file is never relaxed beyond its declared value.
 *
 * @param {string | undefined} root - manager root (undefined => defaults).
 * @returns {object} frozen effective config.
 */
export function loadConfig(root) {
  if (!root) return DEFAULT_CONFIG
  const out = { ...DEFAULT_CONFIG }
  try {
    const path = join(root, CONFIG_FILE)
    if (!existsSync(path)) return Object.freeze(out)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return Object.freeze(out)
    const clamp = (value, fallback) => {
      const n = Number(value)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
    }
    if (parsed.quotaPerOwnerMb !== undefined) out.quotaPerOwnerMb = clamp(parsed.quotaPerOwnerMb, DEFAULT_CONFIG.quotaPerOwnerMb)
    if (parsed.quotaTotalMb !== undefined) out.quotaTotalMb = clamp(parsed.quotaTotalMb, DEFAULT_CONFIG.quotaTotalMb)
    if (parsed.backupRetentionN !== undefined) out.backupRetentionN = clamp(parsed.backupRetentionN, DEFAULT_CONFIG.backupRetentionN)
    return Object.freeze(out)
  } catch {
    return Object.freeze(out)
  }
}

/**
 * Append one audit record to audit.log (JSONL, append-only). Never throws.
 *
 * @param {object} record - { at, owner?, op, target, outcome, reasons[]?, generation? }
 * @param {string | undefined} root
 * @returns {boolean} true when durably appended; false on any failure.
 */
export function appendAuditRecord(record, root) {
  try {
    if (!root) return false
    const path = join(root, AUDIT_FILE)
    const line = {
      at: record.at ?? new Date().toISOString(),
      owner: typeof record.owner === 'string' ? record.owner : undefined,
      op: record.op,
      target: typeof record.target === 'string' ? record.target : '',
      outcome: record.outcome,
      reasons: Array.isArray(record.reasons) ? record.reasons : [],
      generation: typeof record.generation === 'string' ? record.generation : undefined,
    }
    appendFileSync(path, `${JSON.stringify(line)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * Path helpers for the storage scope.
 */
export function storagePaths(root) {
  return Object.freeze({
    root,
    snapshots: root ? join(root, SNAPSHOTS_DIR) : undefined,
    seed: root ? join(root, CACHE_DIR, SEED_DIR) : undefined,
    backups: root ? join(root, BACKUPS_DIR) : undefined,
    tmp: root ? join(root, TMP_DIR) : undefined,
    audit: root ? join(root, AUDIT_FILE) : undefined,
    config: root ? join(root, CONFIG_FILE) : undefined,
  })
}

/**
 * Snapshot directory path with containment: `<root>/snapshots/<owner>/<id>`.
 * Returns undefined when the names escape the layout (never avoids the
 * containment check silently).
 */
 /**
  * Ensure one owner path segment is safe: non-empty, not a traversal
  * segment, and clean of backslashes / absolute escapes.
  */
function safeSegment(segment) {
  if (typeof segment !== 'string' || segment.length === 0) return false
  if (segment === '.' || segment === '..') return false
  if (segment.includes('\\')) return false
  if (segment.includes('/')) return false // segments are split by the caller
  return true
}

export function snapshotDir(root, owner, snapshotId) {
  if (!root || typeof owner !== 'string' || typeof snapshotId !== 'string') return undefined
  if (owner.length === 0 || snapshotId.length === 0) return undefined
  // owner may be a scoped package identity (`@scope/name`) or a plain name;
  // each path segment is containment-checked and nested scopes are allowed
  // (the snapshots layout is `snapshots/<owner>/<id>` with nested owner
  // scopes). Only traversal, absolute, empty and backslash segments are
  // rejected.
  const ownerSegments = owner.split('/').filter((segment) => segment.length > 0)
  if (ownerSegments.length === 0) return undefined
  if (!ownerSegments.every(safeSegment)) return undefined
  if (!safeSegment(snapshotId)) return undefined
  const dir = resolve(join(root, SNAPSHOTS_DIR, ...ownerSegments, snapshotId))
  const expected = resolve(join(root, SNAPSHOTS_DIR)) + '/'
  if (!dir.startsWith(expected)) return undefined
  return dir
}

export { dirname as _dirname }