import fs from 'node:fs'
import path from 'node:path'
import { RULE_REGISTRY_VERSION, TOOL_VERSION, SEVERITY_RANK, SOURCE_EXTENSIONS } from './constants.js'
import { compareFindings, findingRanks, sortFindings } from './findings.js'

function compareLexical(a, b) {
  return a === b ? 0 : (a < b ? -1 : 1)
}

function sortEdits(edits = []) {
  return [...edits].sort((a, b) => {
    const file = compareLexical(a.file ?? '', b.file ?? '')
    if (file) return file
    const start = (a.start?.byte ?? 0) - (b.start?.byte ?? 0)
    if (start) return start
    return (a.end?.byte ?? 0) - (b.end?.byte ?? 0)
  })
}

export function buildReport({
  root,
  files = [],
  findings = [],
  edits = [],
  diagnostics = [],
  success = true,
  options = {},
  auditObservations,
  baseline,
  diff = '',
} = {}) {
  const orderedFindings = sortFindings(findings)
  const report = {
    schemaVersion: 1,
    toolVersion: TOOL_VERSION,
    ruleRegistryVersion: RULE_REGISTRY_VERSION,
    root,
    files: [...files].sort(compareLexical),
    findings: orderedFindings,
    edits: sortEdits(edits),
    counts: findingRanks(orderedFindings),
    diagnostics: [...diagnostics],
    success: Boolean(success),
    options: { ...options },
  }
  if (auditObservations) report.auditObservations = auditObservations
  if (baseline) report.baseline = baseline
  report.diff = diff
  const entryKinds = orderedFindings.map((finding) => finding.entryKind ?? finding.details?.entryKind).filter(Boolean)
  if (entryKinds.length) report.entryKinds = [...new Set(entryKinds)].sort(compareLexical)
  return Object.freeze(report)
}

export function reportJson(report, space = 2) {
  return `${JSON.stringify(report, null, space)}\n`
}

export function writeReport(report, file, { root = report.root } = {}) {
  const target = path.resolve(file)
  const rootReal = path.resolve(root)
  const relative = path.relative(rootReal, target)
  const insideRoot = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  const sourceLike = path.basename(target).toLowerCase() === 'package.json' || SOURCE_EXTENSIONS.has(path.extname(target).toLowerCase())
  if (insideRoot && sourceLike) throw new Error(`report target is a plugin source path: ${file}`)
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) throw new Error(`report target is a directory: ${file}`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(temporary, reportJson(report))
  try {
    fs.renameSync(temporary, target)
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }) } catch {}
    throw error
  }
}

export function unifiedDiff(changes = []) {
  const chunks = []
  for (const change of changes) {
    if (!change?.before || change.before === change.after) continue
    const before = change.before.split(/\r?\n/)
    const after = change.after.split(/\r?\n/)
    chunks.push(`--- a/${change.file}`)
    chunks.push(`+++ b/${change.file}`)
    chunks.push(`@@ -1,${before.length} +1,${after.length} @@`)
    chunks.push(...before.map((line) => `-${line}`))
    chunks.push(...after.map((line) => `+${line}`))
  }
  return chunks.length ? `${chunks.join('\n')}\n` : ''
}

export function formatHuman(report) {
  const lines = [`DSH plugin API migration report`, `Root: ${report.root}`, `Files: ${report.files.length}`]
  for (const finding of report.findings) {
    const location = finding.start ? `${finding.file}:${finding.start.line}:${finding.start.column}` : finding.file
    lines.push(`${finding.severity.padEnd(5)} ${finding.classification.padEnd(11)} ${location} ${finding.message}`)
  }
  const counts = report.counts.classifications
  lines.push(`Findings: SAFE=${counts.SAFE} REVIEW=${counts.REVIEW} MANUAL=${counts.MANUAL} UNSUPPORTED=${counts.UNSUPPORTED}`)
  lines.push(report.success ? 'Status: success' : 'Status: failed')
  return `${lines.join('\n')}\n`
}

export function thresholdRank(name) {
  return SEVERITY_RANK[String(name ?? 'ERROR').toUpperCase()] ?? SEVERITY_RANK.ERROR
}

export function hasSeverityAtOrAbove(findings, threshold = 'ERROR') {
  const rank = thresholdRank(threshold)
  return findings.some((finding) => (SEVERITY_RANK[finding.severity] ?? 0) >= rank)
}

export { compareFindings }
