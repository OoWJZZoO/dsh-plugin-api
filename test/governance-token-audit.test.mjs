import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/**
 * Governance magic tokens. Built by concatenation so this audit source itself
 * does not contain any literal banned token.
 */
const BANNED_TOKENS = [
  'A' + '11',
  'compaction-events-' + 'r1',
  'session-title-' + 'r1',
  'plugin-api-compaction-events-' + 'r1',
  'plugin-api-session-title-' + 'r1',
  'dsh-plugin-api.compaction-events-' + 'r1' + '.active',
  'dsh-plugin-api.session-title-' + 'r1' + '.active',
  'dsh-plugin-api.compaction-events-' + 'r1' + '.rejected',
  'A' + '-class',
  'B' + '-class',
  'C' + '-class',
  'R' + '-class',
]

/** Labels used by the governance documents, not by runtime contracts. */
const GOVERNANCE_LABEL_PATTERN = /\b(?:ST|SV|AC|CL|WMT|TEO|PPM|PD|EO)-?\d+(?:\.\d+)?[a-z]?\b|\b[ABCRMDLTWFSUP]\d+(?:\.\d+)?[a-z]?\b|\b[ABCR]-class\b/g

/** The only implementation labels intentionally retained for control syntax. */
const CONTROL_LABEL_EXEMPTIONS = new Set([
  `packages/session-title/lib/event-contract.js:136:${'C' + '0'}`,
  `packages/session-title/lib/event-contract.js:136:${'C' + '1'}`,
  `packages/session-title/lib/forked-service.js:29:${'C' + '0'}`,
  `packages/session-title/lib/forked-service.js:29:${'C' + '1'}`,
  // Re-exports: the official dsh-client-connection bundle is inlined verbatim
  // (client half self-build rule) and its internal base64 fixture data contains
  // non-governance identifiers that match the governance label pattern.
  `packages/session-channel-connection/lib/client.js:6711:${'P' + 'D' + '1q'}`,
  `packages/session-channel-connection/lib/client.js:6711:${'B' + '4b'}`,
])

/** Fields that used to carry governance classification into the public catalog. */
const GOVERNANCE_FIELD_PATTERNS = [
  /^\s*type:\s*['"]?[ABR]['"]?,?\s*$/m,
  /^\s*source:\s*['"][A-Z]+[0-9]+['"],?\s*$/m,
  /^\s*source:\s*['"]U[0-9]+ \([A-Z]+\)['"],?\s*$/m,
]

function walk(dir, out = []) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function implementationFiles() {
  const files = [
    join(root, 'package.json'),
    join(root, 'cordis.patch.yml'),
  ]
  for (const dir of ['lib', 'packages', 'test', 'scripts']) files.push(...walk(join(root, dir)))
  return files.filter((file) => {
    const rel = relativePath(file)
    return rel.startsWith('scripts/') || /\.(?:js|mjs|json|yml|yaml)$/.test(file)
  })
}

function relativePath(file) {
  const prefix = `${root}/`
  return (file.startsWith(prefix) ? file.slice(prefix.length) : file).replaceAll('\\', '/')
}

function governanceLabels(source, rel) {
  const violations = []
  for (const [lineIndex, line] of source.split('\n').entries()) {
    const lineNumber = lineIndex + 1
    const identifiers = []
    for (const match of line.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
      const start = match.index ?? 0
      if (start > 0 && /[A-Za-z0-9_$]/.test(line[start - 1])) continue
      if (start > 0 && line[start - 1] === '\\') continue
      identifiers.push(match[0]
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/[_$]/g, ' '))
    }
    const labels = new Set([
      ...line.matchAll(GOVERNANCE_LABEL_PATTERN),
      ...identifiers.flatMap((value) => [...value.matchAll(GOVERNANCE_LABEL_PATTERN)]),
    ].map((match) => match[0]))
    for (const label of labels) {
      if (CONTROL_LABEL_EXEMPTIONS.has(`${rel}:${lineNumber}:${label}`)) continue
      violations.push(`${rel}:${lineNumber}: governance label ${JSON.stringify(label)}`)
    }
  }
  return violations
}

function scanArtifact(source, rel) {
  const violations = []
  for (const token of BANNED_TOKENS) {
    if (source.includes(token)) violations.push(`${rel}: banned token ${JSON.stringify(token)}`)
  }
  violations.push(...governanceLabels(source, rel))
  for (const pattern of GOVERNANCE_FIELD_PATTERNS) {
    if (pattern.test(source)) violations.push(`${rel}: governance catalog field ${pattern}`)
  }
  return violations
}

test('implementation artifacts contain no governance magic tokens, labels, or catalog fields', () => {
  const violations = []
  for (const file of implementationFiles()) {
    const rel = relativePath(file)
    const source = readFileSync(file, 'utf8')
    violations.push(...scanArtifact(rel, `${rel} [path]`))
    violations.push(...scanArtifact(source, rel))
  }
  assert.deepEqual(violations, [])
})
