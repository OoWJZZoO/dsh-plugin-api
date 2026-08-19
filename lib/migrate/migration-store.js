import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { DEFAULT_MIGRATION_DIR, REPORT_SCHEMA_VERSION, RULE_REGISTRY_VERSION, TOOL_VERSION } from './constants.js'
import { discoverFiles } from './discovery.js'
import { applyEdits, hashBytes } from './edits.js'
import { planMigration } from './scan.js'
import { reportJson } from './report.js'

function migrationId(root, report) {
  const seed = `${root}\0${report.diff ?? ''}`
  const digest = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 12)
  const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')
  return `${stamp}-${digest}`
}

function gitRevision(root) {
  try {
    const value = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return { kind: 'git', value }
  } catch {
    return { kind: 'unknown', value: null }
  }
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true })
}

function writeAtomic(file, bytes) {
  const target = path.resolve(file)
  ensureDirectory(path.dirname(target))
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(temporary, bytes)
  fs.renameSync(temporary, target)
}

function relativeSafe(root, file) {
  const relative = path.relative(root, file)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`migration target escapes root: ${file}`)
  return relative.split(path.sep).join('/')
}

function materialize(root, report) {
  const discovered = discoverFiles({ root })
  const byFile = new Map(discovered.files.map((file) => [file.file, file]))
  const proposed = []
  for (const file of discovered.files) {
    const edits = report.edits.filter((edit) => edit.file === file.file)
    if (!edits.length) continue
    const before = fs.readFileSync(file.absolute)
    const after = applyEdits(before, edits)
    proposed.push({
      file: file.file,
      absolute: file.absolute,
      before,
      after,
      beforeHash: hashBytes(before),
      afterHash: hashBytes(after),
    })
  }
  for (const edit of report.edits) {
    if (!byFile.has(edit.file)) throw new Error(`edit targets undiscovered file: ${edit.file}`)
  }
  return proposed.filter((entry) => entry.beforeHash !== entry.afterHash)
}

function manifestFor({ root, id, report, files, backup }) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    migrationId: id,
    root,
    originalRevision: gitRevision(root),
    toolVersion: TOOL_VERSION,
    ruleRegistryVersion: RULE_REGISTRY_VERSION,
    command: 'migrate --write',
    backup: Boolean(backup),
    files: files.map((file) => ({
      file: file.file,
      beforeHash: file.beforeHash,
      afterHash: file.afterHash,
      beforeContent: backup ? null : file.before.toString('base64'),
      edits: report.edits.filter((edit) => edit.file === file.file),
    })),
    unresolvedFindings: report.findings.filter((finding) => finding.classification !== 'SAFE').map((finding) => finding.fingerprint).filter(Boolean),
    verification: 'not-run',
  }
}

export function executeMigration({ root, report, backup = true } = {}) {
  const rootReal = fs.realpathSync(root)
  if (!report?.success) throw new Error('migration cannot write while scan or planning has failed')
  const files = materialize(rootReal, report)
  if (!files.length) return { report, migrationId: null, changedFiles: [] }
  const id = migrationId(rootReal, report)
  const migrationRoot = path.resolve(rootReal, DEFAULT_MIGRATION_DIR)
  const finalDirectory = path.join(migrationRoot, id)
  const stagingDirectory = path.join(migrationRoot, `.staging-${id}`)
  if (fs.existsSync(finalDirectory) || fs.existsSync(stagingDirectory)) throw new Error(`migration already exists: ${id}`)
  ensureDirectory(stagingDirectory)
  const originalsDirectory = path.join(stagingDirectory, 'originals')
  const proposedDirectory = path.join(stagingDirectory, 'proposed')
  for (const file of files) {
    const relative = relativeSafe(rootReal, file.absolute)
    if (backup) writeAtomic(path.join(originalsDirectory, relative), file.before)
    writeAtomic(path.join(proposedDirectory, relative), file.after)
  }
  const manifest = manifestFor({ root: rootReal, id, report, files, backup })
  writeAtomic(path.join(stagingDirectory, 'manifest.json'), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`))
  writeAtomic(path.join(stagingDirectory, 'migration.patch'), Buffer.from(report.diff ?? '', 'utf8'))
  writeAtomic(path.join(stagingDirectory, 'report.json'), Buffer.from(reportJson(report)))
  ensureDirectory(migrationRoot)
  fs.renameSync(stagingDirectory, finalDirectory)

  const replaced = []
  try {
    for (const file of files) {
      const current = fs.readFileSync(file.absolute)
      if (hashBytes(current) !== file.beforeHash) throw new Error(`source changed before migration: ${file.file}`)
      writeAtomic(file.absolute, file.after)
      replaced.push(file)
    }
  } catch (error) {
    const restored = []
    const unrestored = []
    for (const file of replaced.reverse()) {
      try {
        const originalPath = path.join(finalDirectory, 'originals', relativeSafe(rootReal, file.absolute))
        if (fs.existsSync(originalPath)) writeAtomic(file.absolute, fs.readFileSync(originalPath))
        else if (!backup && file.before) writeAtomic(file.absolute, file.before)
        restored.push(file.file)
      } catch {
        unrestored.push(file.file)
      }
    }
    writeAtomic(path.join(finalDirectory, 'recovery.json'), Buffer.from(`${JSON.stringify({ error: error.message, restored, unrestored }, null, 2)}\n`))
    throw error
  }
  return { report, migrationId: id, changedFiles: files.map((file) => file.file), directory: finalDirectory }
}

function resolveMigrationDirectory(root, idOrDirectory) {
  const candidate = path.isAbsolute(idOrDirectory)
    ? idOrDirectory
    : path.join(root, DEFAULT_MIGRATION_DIR, idOrDirectory)
  const directory = fs.realpathSync(candidate)
  let effectiveRoot = root
  if (path.isAbsolute(idOrDirectory)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
      if (metadata.root) effectiveRoot = metadata.root
    } catch {}
  }
  const migrationsRoot = fs.realpathSync(path.join(effectiveRoot, DEFAULT_MIGRATION_DIR))
  const relative = path.relative(migrationsRoot, directory)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('rollback directory escapes migration root')
  return directory
}

export function rollbackMigration({ root, migration } = {}) {
  if (!root || !migration) throw new Error('rollback requires root and migration id or directory')
  const directory = resolveMigrationDirectory(root, migration)
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
  const effectiveRoot = fs.realpathSync(manifest.root ?? root)
  const files = manifest.files ?? []
  const currentSnapshots = new Map()
  const safePaths = new Map()
  for (const file of files) {
    const absolute = path.resolve(effectiveRoot, file.file)
    const relative = path.relative(effectiveRoot, absolute)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`rollback manifest target escapes root: ${file.file}`)
    const normalized = relative.split(path.sep).join('/')
    safePaths.set(file.file, normalized)
    const current = fs.readFileSync(absolute)
    if (hashBytes(current) !== file.afterHash) throw new Error(`rollback refused; file changed since migration: ${file.file}`)
    currentSnapshots.set(file.file, current)
  }
  const restored = []
  const unrestored = []
  try {
    for (const file of files) {
      const absolute = path.resolve(effectiveRoot, file.file)
    const originalPath = path.join(directory, 'originals', safePaths.get(file.file))
    if (fs.existsSync(originalPath)) writeAtomic(absolute, fs.readFileSync(originalPath))
    else if (file.beforeContent) writeAtomic(absolute, Buffer.from(file.beforeContent, 'base64'))
    else throw new Error(`rollback backup is missing: ${file.file}`)
      restored.push(file.file)
    }
  } catch (error) {
    for (const file of files) if (!restored.includes(file.file)) unrestored.push(file.file)
    const inverseRestored = []
    const inverseUnrestored = []
    for (const file of restored) {
      try {
        writeAtomic(path.resolve(effectiveRoot, file), currentSnapshots.get(file))
        inverseRestored.push(file)
      } catch {
        inverseUnrestored.push(file)
      }
    }
    writeAtomic(path.join(directory, 'rollback-recovery.json'), Buffer.from(`${JSON.stringify({ error: error.message, restored, unrestored, inverseRestored, inverseUnrestored }, null, 2)}\n`))
    throw error
  }
  writeAtomic(path.join(directory, 'rollback.json'), Buffer.from(`${JSON.stringify({ restored, timestamp: new Date().toISOString() }, null, 2)}\n`))
  return { migrationId: manifest.migrationId, restored, directory }
}

export function planAndMaybeMigrate({ root, write = false, backup = true, ...options } = {}) {
  const report = planMigration({ root, ...options })
  if (!write) return { report, migrationId: null, changedFiles: [] }
  return executeMigration({ root, report, backup })
}
