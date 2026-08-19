import path from 'node:path'
import { discoverFiles } from './discovery.js'
import { MigrationToolError } from './errors.js'
import { createFinding, createParseFinding } from './findings.js'
import { analyzePackageManifest, analyzeParsedFile } from './analyze.js'
import { applyEdits, planSafeEdits } from './edits.js'
import { identifyEntry, planFacadeInjection } from './injection.js'
import { parseSource, readSource } from './parser.js'
import { buildReport, unifiedDiff } from './report.js'
import { ruleById } from './rules.js'

export function scanRoot({
  root,
  include = [],
  exclude = [],
  allowOutsideRoot = false,
  parser = 'babel',
  options = {},
} = {}) {
  const discovered = discoverFiles({ root, include, exclude, allowOutsideRoot })
  const findings = []
  const diagnostics = []
  let parseFailed = false
  for (const file of discovered.files) {
    try {
      const parsed = parseSource(readSource(file), { mode: parser })
      findings.push(...analyzeParsedFile(parsed, { root: discovered.root }))
    } catch (error) {
      parseFailed = true
      findings.push(createParseFinding({ file: file.file, error }))
      diagnostics.push({ code: error.code ?? 'PARSE_ERROR', file: file.file, message: error.message })
    }
  }
  const manifest = analyzePackageManifest(discovered.root)
  if (manifest.present) {
    findings.push(...manifest.findings)
    if (manifest.error) {
      parseFailed = true
      findings.push(createParseFinding({ file: 'package.json', error: new MigrationToolError('PARSE_ERROR', `package.json: ${manifest.error.message}`) }))
      diagnostics.push({ code: 'MANIFEST_PARSE_ERROR', file: 'package.json', message: manifest.error.message })
    }
  }
  const reportFiles = discovered.files.map((file) => file.file)
  if (manifest.present && !reportFiles.includes('package.json')) reportFiles.push('package.json')
  return buildReport({
    root: discovered.root,
    files: reportFiles,
    findings,
    diagnostics,
    success: !parseFailed,
    options: { parser, include, exclude, allowOutsideRoot, ...options },
  })
}

export function planMigration({
  root,
  include = [],
  exclude = [],
  allowOutsideRoot = false,
  parser = 'babel',
  options = {},
} = {}) {
  const discovered = discoverFiles({ root, include, exclude, allowOutsideRoot })
  const findings = []
  const diagnostics = []
  const edits = []
  const changes = []
  const parsedFiles = []
  let parseFailed = false
  let editFailed = false
  const manifest = analyzePackageManifest(discovered.root)
  for (const file of discovered.files) {
    try {
      const parsed = parseSource(readSource(file), { mode: parser })
      findings.push(...analyzeParsedFile(parsed, { root: discovered.root }))
      parsedFiles.push({ file, parsed, safeEdits: planSafeEdits(parsed), entry: identifyEntry(parsed) })
    } catch (error) {
      parseFailed = true
      findings.push(createParseFinding({ file: file.file, error }))
      diagnostics.push({ code: error.code ?? 'PARSE_ERROR', file: file.file, message: error.message })
    }
  }
  const mainFile = typeof manifest.manifest?.main === 'string'
    ? path.posix.normalize(manifest.manifest.main.replaceAll('\\', '/').replace(/^\.\//, ''))
    : null
  const entryKeys = new Set()
  for (const record of parsedFiles.filter((value) => value.entry.kind === 'apply')) {
    entryKeys.add(mainFile && record.file.file === mainFile ? `entry:${record.file.file}` : `apply:${record.file.file}`)
  }
  if (mainFile && !parsedFiles.some((record) => record.file.file === mainFile && record.entry.kind === 'apply')) entryKeys.add(`main:${mainFile}`)
  const ambiguousEntries = entryKeys.size > 1
  for (const record of parsedFiles) {
    if (!record.safeEdits.length) continue
    if (ambiguousEntries) {
      findings.push(createFinding({
        file: record.file.file,
        rule: ruleById('host.facade-injection'),
        ruleId: 'host.facade-injection',
        classification: 'REVIEW',
        severity: 'WARN',
        kind: 'facade-injection-required',
        message: 'Multiple possible host entry points prevent automatic pluginApi injection.',
        suggestion: 'Select the package entry manually before applying facade edits.',
        details: { entryKind: 'ambiguous', candidates: [...entryKeys].sort() },
      }))
      continue
    }
    const injection = record.entry.kind === 'apply'
      ? planFacadeInjection(record.parsed, { requiresPluginApi: true })
      : { status: 'not-required', edits: [] }
    if (injection.status !== 'planned' && injection.status !== 'not-required') {
      findings.push(createFinding({
        file: record.file.file,
        rule: ruleById('host.facade-injection'),
        ruleId: 'host.facade-injection',
        classification: 'REVIEW',
        severity: 'WARN',
        kind: 'facade-injection-required',
        message: `Cannot safely identify a single apply entry for pluginApi injection (${injection.status}).`,
        suggestion: 'Add or review the pluginApi injection and activation guard manually.',
        details: { entryKind: injection.entry?.kind ?? 'unknown' },
      }))
      continue
    }
    const fileEdits = [...record.safeEdits, ...injection.edits]
    edits.push(...fileEdits)
    try {
      const proposed = applyEdits(record.parsed.bytes, fileEdits)
      if (Buffer.compare(record.parsed.bytes, proposed) !== 0) changes.push({ file: record.file.file, before: record.parsed.source, after: proposed.toString('utf8') })
    } catch (error) {
      editFailed = true
      diagnostics.push({ code: 'EDIT_CONFLICT', file: record.file.file, message: error.message })
      findings.push(createFinding({ file: record.file.file, ruleId: 'infrastructure.edit-conflict', classification: 'MANUAL', severity: 'ERROR', kind: 'edit-conflict', message: error.message, suggestion: 'Resolve overlapping or stale edits before writing.' }))
    }
  }
  if (manifest.present) {
    findings.push(...manifest.findings)
    if (manifest.error) {
      parseFailed = true
      findings.push(createParseFinding({ file: 'package.json', error: new MigrationToolError('PARSE_ERROR', `package.json: ${manifest.error.message}`) }))
      diagnostics.push({ code: 'MANIFEST_PARSE_ERROR', file: 'package.json', message: manifest.error.message })
    }
  }
  const reportFiles = discovered.files.map((file) => file.file)
  if (manifest.present && !reportFiles.includes('package.json')) reportFiles.push('package.json')
  const report = buildReport({
    root: discovered.root,
    files: reportFiles,
    findings,
    edits,
    diff: unifiedDiff(changes),
    diagnostics,
    success: !parseFailed && !editFailed,
    options: { parser, include, exclude, allowOutsideRoot, ...options },
  })
  return report
}

export function ensureRootPositionals(positionals = []) {
  if (positionals.length !== 1) throw new MigrationToolError('ROOT_REQUIRED', 'exactly one plugin root is required')
  return positionals[0]
}
