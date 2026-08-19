import crypto from 'node:crypto'
import path from 'node:path'
import { REPORT_SCHEMA_VERSION, SEVERITY_RANK } from './constants.js'
import { sourceRangeOf } from './parser.js'

const DEFAULT_SEVERITY = Object.freeze({
  SAFE: 'INFO',
  REVIEW: 'WARN',
  MANUAL: 'WARN',
  UNSUPPORTED: 'ERROR',
})

function slash(value) {
  return String(value).split(path.sep).join('/')
}

function compareLexical(a, b) {
  return a === b ? 0 : (a < b ? -1 : 1)
}

function normalizeFile(file, root) {
  if (!file) return null
  const candidate = slash(file)
  if (!root || !path.isAbsolute(file)) return candidate.replace(/^\.\//, '')
  return slash(path.relative(root, file)).replace(/^\.\//, '')
}

function canonicalFingerprint(ruleId, file, start, end, symbol) {
  const payload = JSON.stringify([ruleId, file, start.byte, end.byte, symbol ?? null])
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex')
}

export function severityFor(classification, explicit) {
  return explicit ?? DEFAULT_SEVERITY[classification] ?? 'WARN'
}

export function createFinding({
  parsed = null,
  root = null,
  file = parsed?.file ?? null,
  startNode = null,
  endNode = startNode,
  start = null,
  end = null,
  rule = null,
  ruleCandidates = [],
  ruleId = rule?.id ?? null,
  classification = rule?.classification ?? 'MANUAL',
  severity = null,
  kind,
  symbol = null,
  message,
  suggestion = rule?.guidance ?? null,
  details = {},
} = {}) {
  const normalizedFile = normalizeFile(file, root)
  const range = parsed && startNode ? {
    start: sourceRangeOf(parsed, startNode).start,
    end: sourceRangeOf(parsed, endNode ?? startNode).end,
  } : null
  const locationStart = start ?? range?.start ?? null
  const locationEnd = end ?? range?.end ?? locationStart
  const finding = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    ruleId,
    classification,
    severity: severityFor(classification, severity),
    kind,
    file: normalizedFile,
    start: locationStart,
    end: locationEnd,
    message: String(message ?? kind ?? 'migration finding'),
    suggestion,
    ...details,
  }
  if (locationStart && locationEnd && ruleId && normalizedFile) {
    finding.fingerprint = canonicalFingerprint(ruleId, normalizedFile, locationStart, locationEnd, symbol)
  }
  if (rule) finding.rule = { id: rule.id, registryVersion: rule.registryVersion }
  if (ruleCandidates.length > 1) {
    finding.ruleCandidates = ruleCandidates.map((candidate) => candidate.id)
  }
  return Object.freeze(finding)
}

export function createParseFinding({ file, error, root = null }) {
  const details = error?.details ?? {}
  const normalizedFile = normalizeFile(file, root)
  const kind = error?.code === 'ENCODING_ERROR' ? 'encoding-error' : 'parse-error'
  const start = details.line == null ? null : {
    line: details.line,
    column: details.column ?? 1,
    byte: details.byte ?? 0,
  }
  return createFinding({
    file: normalizedFile,
    start,
    end: start,
    ruleId: `infrastructure.${kind}`,
    classification: 'MANUAL',
    severity: 'ERROR',
    kind,
    message: error?.message ?? String(error),
    suggestion: 'Fix the source encoding or syntax before attempting migration.',
  })
}

export function compareFindings(a, b) {
  const fileOrder = compareLexical(a.file ?? '', b.file ?? '')
  if (fileOrder) return fileOrder
  const startOrder = (a.start?.byte ?? Number.MAX_SAFE_INTEGER) - (b.start?.byte ?? Number.MAX_SAFE_INTEGER)
  if (startOrder) return startOrder
  const endOrder = (a.end?.byte ?? Number.MAX_SAFE_INTEGER) - (b.end?.byte ?? Number.MAX_SAFE_INTEGER)
  if (endOrder) return endOrder
  return compareLexical(a.fingerprint ?? '', b.fingerprint ?? '')
}

export function sortFindings(findings) {
  return [...findings].sort(compareFindings)
}

export function findingRanks(findings) {
  const counts = {
    classifications: { SAFE: 0, REVIEW: 0, MANUAL: 0, UNSUPPORTED: 0 },
    severities: { INFO: 0, WARN: 0, ERROR: 0 },
    kinds: {},
  }
  for (const finding of findings) {
    if (finding.classification in counts.classifications) counts.classifications[finding.classification] += 1
    if (finding.severity in counts.severities) counts.severities[finding.severity] += 1
    counts.kinds[finding.kind] = (counts.kinds[finding.kind] ?? 0) + 1
  }
  return counts
}

export function highestSeverity(findings) {
  return findings.reduce((highest, finding) => {
    return (SEVERITY_RANK[finding.severity] ?? 0) > (SEVERITY_RANK[highest] ?? -1)
      ? finding.severity
      : highest
  }, 'INFO')
}
