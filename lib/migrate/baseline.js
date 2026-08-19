import fs from 'node:fs'
import { SEVERITY_RANK } from './constants.js'
import { thresholdRank } from './report.js'

function loadValue(value) {
  if (!value) return { fingerprints: [] }
  if (typeof value === 'string') return JSON.parse(fs.readFileSync(value, 'utf8'))
  return value
}
export function baselineFingerprints(value) {
  const report = loadValue(value)
  if (Array.isArray(report)) return new Set(report.filter((item) => typeof item === 'string'))
  if (Array.isArray(report.fingerprints)) return new Set(report.fingerprints.filter((item) => typeof item === 'string'))
  if (Array.isArray(report.findings)) return new Set(report.findings.map((item) => item?.fingerprint).filter(Boolean))
  return new Set()
}

export function compareBaseline(findings, baseline) {
  const previous = baselineFingerprints(baseline)
  const current = new Set(findings.map((finding) => finding.fingerprint).filter(Boolean))
  const added = findings.filter((finding) => finding.fingerprint && !previous.has(finding.fingerprint))
  const removed = [...previous].filter((fingerprint) => !current.has(fingerprint)).sort()
  const unchanged = findings.filter((finding) => finding.fingerprint && previous.has(finding.fingerprint))
  return { added, removed, unchanged, baseline: [...previous].sort() }
}

export function baselineFails(delta, threshold = 'ERROR') {
  const rank = thresholdRank(threshold)
  return delta.added.some((finding) => (SEVERITY_RANK[finding.severity] ?? 0) >= rank)
}
