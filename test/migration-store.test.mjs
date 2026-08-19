import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { executeMigration, planMigration, rollbackMigration } from '../lib/migrate/index.js'

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-api-store-'))
}

function fixture(root) {
  const file = path.join(root, 'plugin.js')
  fs.writeFileSync(file, "export function apply(ctx) {\n  const tools = ctx.get('tools')\n  tools.register({})\n}\n")
  return file
}

function multiFixture(root) {
  const files = []
  for (const [index, name] of ['one.js', 'two.js'].entries()) {
    const file = path.join(root, name)
    fs.writeFileSync(file, index === 0
      ? "export function apply(ctx) {\n  const tools = ctx.get('tools')\n  tools.register({})\n}\n"
      : "export function helper(ctx) {\n  const tools = ctx.get('tools')\n  tools.register({})\n}\n")
    files.push(file)
  }
  return files
}

test('write creates a guarded manifest and rollback restores the original bytes', () => {
  const root = tempRoot()
  const file = fixture(root)
  const before = fs.readFileSync(file)
  const report = planMigration({ root })
  const result = executeMigration({ root, report })
  assert.ok(result.migrationId)
  assert.notDeepEqual(fs.readFileSync(file), before)
  assert.ok(fs.existsSync(path.join(root, '.dsh', 'migrations', result.migrationId, 'manifest.json')))
  const rollback = rollbackMigration({ root, migration: result.migrationId })
  assert.deepEqual(fs.readFileSync(file), before)
  assert.deepEqual(rollback.restored, ['plugin.js'])
})

test('rollback refuses any owned file changed after migration', () => {
  const root = tempRoot()
  const file = fixture(root)
  const result = executeMigration({ root, report: planMigration({ root }) })
  fs.appendFileSync(file, '\n// changed after migration\n')
  assert.throws(() => rollbackMigration({ root, migration: result.migrationId }), /changed since migration/)
})

test('a plan with no safe edits does not create a migration directory', () => {
  const root = tempRoot()
  fs.writeFileSync(path.join(root, 'plugin.js'), 'export function apply(ctx) { return ctx.pluginApi.tools.get() }')
  const report = planMigration({ root })
  assert.equal(report.edits.length, 0)
})

test('a migrated facade receiver is idempotent on a second plan', () => {
  const root = tempRoot()
  const file = fixture(root)
  const first = executeMigration({ root, report: planMigration({ root }) })
  const second = planMigration({ root })
  assert.equal(second.edits.length, 0)
  assert.ok(second.findings.some((finding) => finding.kind === 'idempotence' && finding.classification === 'SAFE'))
  assert.ok(first.migrationId)
})

test('no-backup stores reversible content in the manifest and still rolls back', () => {
  const root = tempRoot()
  const file = fixture(root)
  const before = fs.readFileSync(file)
  const result = executeMigration({ root, report: planMigration({ root }), backup: false })
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.dsh', 'migrations', result.migrationId, 'manifest.json'), 'utf8'))
  assert.equal(manifest.backup, false)
  assert.ok(manifest.files[0].beforeContent)
  assert.equal(fs.existsSync(path.join(root, '.dsh', 'migrations', result.migrationId, 'originals', 'plugin.js')), false)
  rollbackMigration({ root, migration: result.migrationId })
  assert.deepEqual(fs.readFileSync(file), before)
})

test('an invalid UTF-8 file prevents a global write', () => {
  const root = tempRoot()
  const good = fixture(root)
  const before = fs.readFileSync(good)
  fs.writeFileSync(path.join(root, 'broken.js'), Buffer.from([0x63, 0xff, 0x64]))
  const report = planMigration({ root })
  assert.equal(report.success, false)
  assert.throws(() => executeMigration({ root, report }), /scan or planning has failed/)
  assert.deepEqual(fs.readFileSync(good), before)
  assert.equal(fs.existsSync(path.join(root, '.dsh', 'migrations')), false)
})

test('rollback rejects manifest paths outside the plugin root', () => {
  const root = tempRoot()
  const file = fixture(root)
  const result = executeMigration({ root, report: planMigration({ root }) })
  const migrated = fs.readFileSync(file)
  const directory = path.join(root, '.dsh', 'migrations', result.migrationId)
  const manifestPath = path.join(directory, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  manifest.files[0].file = '../outside.js'
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  assert.throws(() => rollbackMigration({ root, migration: result.migrationId }), /escapes root/)
  assert.deepEqual(fs.readFileSync(file), migrated)
})

test('multi-file commit failure restores already-replaced files', () => {
  const root = tempRoot()
  const files = multiFixture(root)
  const before = new Map(files.map((file) => [file, fs.readFileSync(file)]))
  const report = planMigration({ root })
  const originalWrite = fs.writeFileSync
  const sourceFiles = new Set(files.map((file) => path.resolve(file)))
  let sourceWrites = 0
  fs.writeFileSync = function patchedWrite(file, ...args) {
    if ([...sourceFiles].some((source) => String(file).startsWith(`${source}.tmp-`))) {
      sourceWrites += 1
      if (sourceWrites === 2) throw new Error('injected commit failure')
    }
    return originalWrite.call(this, file, ...args)
  }
  let migrationDirectory
  try {
    assert.throws(() => executeMigration({ root, report }), /injected commit failure/)
    migrationDirectory = fs.readdirSync(path.join(root, '.dsh', 'migrations')).find((name) => !name.startsWith('.staging-'))
  } finally {
    fs.writeFileSync = originalWrite
  }
  for (const file of files) assert.deepEqual(fs.readFileSync(file), before.get(file))
  assert.ok(migrationDirectory)
  assert.ok(fs.existsSync(path.join(root, '.dsh', 'migrations', migrationDirectory, 'recovery.json')))
})

test('rollback failure records recovery and inverse-restores prior files', () => {
  const root = tempRoot()
  const files = multiFixture(root)
  const before = new Map(files.map((file) => [file, fs.readFileSync(file)]))
  const result = executeMigration({ root, report: planMigration({ root }) })
  const migrated = new Map(files.map((file) => [file, fs.readFileSync(file)]))
  const originalWrite = fs.writeFileSync
  let failed = false
  fs.writeFileSync = function patchedWrite(file, ...args) {
    if (!failed && String(file).startsWith(`${path.resolve(files[1])}.tmp-`)) {
      failed = true
      throw new Error('injected rollback failure')
    }
    return originalWrite.call(this, file, ...args)
  }
  try {
    assert.throws(() => rollbackMigration({ root, migration: result.migrationId }), /injected rollback failure/)
  } finally {
    fs.writeFileSync = originalWrite
  }
  assert.deepEqual(fs.readFileSync(files[0]), migrated.get(files[0]))
  assert.deepEqual(fs.readFileSync(files[1]), migrated.get(files[1]))
  const recovery = JSON.parse(fs.readFileSync(path.join(result.directory, 'rollback-recovery.json'), 'utf8'))
  assert.deepEqual(recovery.inverseRestored, ['one.js'])
  assert.deepEqual(fs.readFileSync(files[0]), migrated.get(files[0]))
  assert.notDeepEqual(fs.readFileSync(files[0]), before.get(files[0]))
})
