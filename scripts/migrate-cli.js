#!/usr/bin/env node
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  baselineFails,
  buildReport,
  compareBaseline,
  ensureRootPositionals,
  executeMigration,
  formatHuman,
  hasSeverityAtOrAbove,
  migrationToolVersion,
  reportJson,
  planMigration,
  readAuditFile,
  rollbackMigration,
  scanRoot,
  writeReport,
} from '../lib/migrate/index.js'

function help() {
  return `dsh-plugin-api-migrate ${migrationToolVersion()}

Usage:
  dsh-plugin-api-migrate scan <root> [options]
  dsh-plugin-api-migrate check <root> [options]
  dsh-plugin-api-migrate migrate <root> [--write] [options]
  dsh-plugin-api-migrate migrate --rollback <migration-id-or-dir>
  dsh-plugin-api-migrate audit --read <jsonl>

Options:
  --json                 emit machine-readable JSON
  --parser babel|ecma    select source parser (default: babel)
  --include <path>       include a relative path (repeatable)
  --exclude <path>       exclude a relative path (repeatable)
  --allow-outside-root   allow explicit files resolved outside root
  --report <file>        write a report to a file
  --baseline <file>      compare check findings with a baseline report
  --fail-on info|warn|error  inclusive check threshold (default: error)
  --read <jsonl>         read an audit JSONL file
  --help                 show this help
`
}

export function parseCliArgs(argv) {
  const args = [...argv]
  const command = args.length && !args[0].startsWith('-') ? args.shift() : 'help'
  const options = { command, include: [], exclude: [], positionals: [] }
  while (args.length) {
    const value = args.shift()
    if (value === '--help' || value === '-h') options.help = true
    else if (value === '--json') options.json = true
    else if (value === '--write') options.write = true
    else if (value === '--allow-outside-root') options.allowOutsideRoot = true
    else if (value === '--parser') options.parser = args.shift()
    else if (value === '--include') options.include.push(args.shift())
    else if (value === '--exclude') options.exclude.push(args.shift())
    else if (value === '--report') options.report = args.shift()
    else if (value === '--read') options.read = args.shift()
    else if (value === '--baseline') options.baseline = args.shift()
    else if (value === '--fail-on') options.failOn = args.shift()
    else if (value === '--no-backup') options.noBackup = true
    else if (value === '--backup') options.backup = true
    else if (value === '--rollback') options.rollback = args.shift()
    else options.positionals.push(value)
  }
  return options
}

export async function main(argv = process.argv.slice(2), io = console) {
  const options = parseCliArgs(argv)
  if (options.help || options.command === 'help') {
    io.log(help())
    return 0
  }
  try {
    if (options.command === 'audit') {
      if (!options.read) {
        io.error('audit requires --read <jsonl>')
        return 2
      }
      const audit = readAuditFile(options.read)
      const output = buildReport({ root: path.dirname(path.resolve(options.read)), files: [], findings: [], edits: [], diagnostics: audit.diagnostics, auditObservations: audit.observations, success: audit.diagnostics.length === 0, options: { command: 'audit', read: options.read } })
      if (options.report) writeReport(output, options.report, { root: output.root })
      if (options.json) io.log(reportJson(output))
      else io.log(formatHuman(output))
      return output.success ? 0 : 1
    }
    if (!['scan', 'check', 'migrate'].includes(options.command)) {
      io.error(`unknown command: ${options.command}`)
      return 2
    }
    if (options.failOn && !['info', 'warn', 'error'].includes(String(options.failOn).toLowerCase())) {
      io.error(`invalid --fail-on threshold: ${options.failOn}`)
      return 2
    }
    if (options.rollback) {
      const rollbackRoot = options.positionals[0] ?? process.cwd()
      const result = rollbackMigration({ root: rollbackRoot, migration: options.rollback })
      const payload = { schemaVersion: 1, success: true, migrationId: result.migrationId, restored: result.restored, directory: result.directory }
      if (options.json) io.log(reportJson(payload))
      else io.log(`Rollback ${result.migrationId} restored ${result.restored.length} file(s).\n`)
      return 0
    }
    const root = ensureRootPositionals(options.positionals)
    const scanOptions = {
      root,
      include: options.include,
      exclude: options.exclude,
      allowOutsideRoot: options.allowOutsideRoot,
      parser: options.parser ?? 'babel',
      options: { command: options.command },
    }
    const report = options.command === 'migrate' ? planMigration(scanOptions) : scanRoot(scanOptions)
    let output = report
    let exitCode = 0
    if (options.command === 'migrate' && options.write && options.report) writeReport(report, options.report, { root })
    if (options.command === 'check') {
      const delta = options.baseline ? compareBaseline(report.findings, options.baseline) : null
      const failed = delta ? baselineFails(delta, options.failOn ?? 'ERROR') : hasSeverityAtOrAbove(report.findings, options.failOn ?? 'ERROR')
      output = buildReport({ ...report, success: report.success && !failed, options: { ...report.options, failOn: options.failOn ?? 'ERROR', baseline: options.baseline ?? null }, baseline: delta ? { added: delta.added.map((finding) => finding.fingerprint), removed: delta.removed, unchanged: delta.unchanged.map((finding) => finding.fingerprint) } : undefined, diagnostics: [...report.diagnostics, ...(delta ? [{ code: 'BASELINE_DELTA', added: delta.added.length, removed: delta.removed.length, unchanged: delta.unchanged.length }] : [])] })
      exitCode = output.success ? 0 : 1
    } else if (options.command === 'migrate' && options.write) {
      if (!report.success) {
        exitCode = 1
      } else if (!report.edits.length) {
        exitCode = 0
      } else {
        const result = executeMigration({ root, report, backup: !options.noBackup })
        output = { ...report, migrationId: result.migrationId, changedFiles: result.changedFiles }
        exitCode = 0
      }
    } else if (options.command === 'migrate') {
      exitCode = report.success ? 0 : 1
    }
    if (options.report) writeReport(output, options.report, { root })
    if (options.json) io.log(reportJson(output))
    else io.log(formatHuman(output))
    return exitCode
  } catch (error) {
    io.error(error?.stack ?? error)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code }).catch((error) => {
    console.error(error?.stack ?? error)
    process.exitCode = 1
  })
}
