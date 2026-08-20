import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const auditSelf = relative(root, fileURLToPath(import.meta.url)).split(sep).join('/')

/**
 * Governance magic tokens. Built by concatenation so this audit source itself
 * does not contain any literal banned token.
 */
const BANNED_TOKENS = [
  'A11',
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

/** Fields that used to carry governance classification into the public catalog. */
const GOVERNANCE_FIELD_PATTERNS = [
  /^\s*type:\s*['"]?[ABR]['"]?,?\s*$/m,
  /^\s*source:\s*['"][A-Z]+[0-9]+['"],?\s*$/m,
  /^\s*source:\s*['"]U[0-9]+ \([A-Z]+\)['"],?\s*$/m,
]

function walk(dir, out = []) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out
  for (const entry of readdirSync(dir)) {
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
  for (const dir of ['lib', 'test']) files.push(...walk(join(root, dir)))
  for (const pkg of ['compaction-events', 'session-title', 'full']) {
    const base = join(root, 'packages', pkg)
    files.push(join(base, 'package.json'))
    files.push(join(base, 'cordis.patch.yml'))
    files.push(...walk(join(base, 'lib')))
    files.push(...walk(join(base, 'test')))
  }
  return files.filter((file) => file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.json') || file.endsWith('.yml'))
}

test('implementation artifacts contain no governance magic tokens or catalog fields', () => {
  const violations = []
  for (const file of implementationFiles()) {
    const rel = relative(root, file).split(sep).join('/')
    if (rel === auditSelf) continue
    const source = readFileSync(file, 'utf8')
    for (const token of BANNED_TOKENS) {
      if (source.includes(token)) violations.push(`${rel}: banned token ${JSON.stringify(token)}`)
    }
    for (const pattern of GOVERNANCE_FIELD_PATTERNS) {
      if (pattern.test(source)) violations.push(`${rel}: governance catalog field ${pattern}`)
    }
  }
  assert.deepEqual(violations, [])
})
