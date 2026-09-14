/**
 * Rebuild entry for the convergence public member table.
 *
 * The whole-tree convergence delivery checks in a member table that is a
 * mechanical projection of the canonical registry `members` section, and the
 * delivery gate (`scripts/convergence-verify.mjs`, run from the test suite)
 * compares the two verbatim. That makes the table a generated artifact: it must
 * only ever be updated by regeneration, never by hand.
 *
 * This script regenerates the table body from the registry and preserves the
 * prose header above the table. It only rewrites the member table; the other
 * convergence tables carry hand-written evidence and are not generated.
 *
 * Zero harness dependencies.
 *
 * Usage:
 *   node scripts/convergence-table-sync.mjs <registry.json> [--check]
 *
 * `--check` exits non-zero when the checked-in table differs from the registry
 * projection, so drift is detectable without writing.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TABLE_PATH = fileURLToPath(new URL(
  '../docs/specs/plugin-api-m10-contract-convergence/convergence/public-member-table.md',
  import.meta.url,
))

const COLUMNS = ['publicPath', 'runtime', 'idiom', 'effect', 'composition', 'scope', 'authority', 'conflictRule', 'concurrency', 'availabilityShape', 'currentShape']

/** Render one cell: an explicit null/undefined is the table's dash. */
function cell(value) {
  if (value === null || value === undefined) return '—'
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

/** Build the full member table (header + separator + one row per registry member). */
export function renderMemberTable(registry) {
  const members = Array.isArray(registry?.members) ? registry.members : []
  const lines = [
    `| ${COLUMNS.join(' | ')} |`,
    `|${COLUMNS.map(() => '---').join('|')}|`,
  ]
  for (const member of members) {
    lines.push(`| ${COLUMNS.map((field) => cell(member[field])).join(' | ')} |`)
  }
  return lines.join('\n')
}

/**
 * Replace the member table inside the checked-in file, keeping the prose header
 * (everything before the table header row) and the trailing appendix.
 */
export function rewriteMemberTable(document, table) {
  const lines = document.split('\n')
  const headerIndex = lines.findIndex((line) => line.startsWith('| publicPath |'))
  if (headerIndex < 0) throw new Error('public-member-table.md has no member table header row')
  let end = headerIndex
  while (end < lines.length && lines[end].startsWith('|')) end += 1
  const before = `${lines.slice(0, headerIndex).join('\n')}\n`
  const after = lines.slice(end).join('\n')
  return `${before}${table}\n${after}`
}

/* Direct CLI execution. */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const target = process.argv[2]
  const checkOnly = process.argv.includes('--check')
  if (!target) {
    console.error('usage: node scripts/convergence-table-sync.mjs <registry.json> [--check]')
    process.exit(2)
  }
  let registry
  try {
    registry = JSON.parse(readFileSync(target, 'utf8'))
  } catch (error) {
    console.error(`cannot read registry ${target}: ${error.message}`)
    process.exit(2)
  }
  const table = renderMemberTable(registry)
  const current = readFileSync(TABLE_PATH, 'utf8')
  const next = rewriteMemberTable(current, table)
  if (next === current) {
    console.log(`member table is in sync with the registry (${(registry.members ?? []).length} rows)`)
    process.exit(0)
  }
  if (checkOnly) {
    console.error('member table is out of sync with the registry; run without --check to regenerate')
    process.exit(1)
  }
  writeFileSync(TABLE_PATH, next)
  console.log(`member table regenerated from the registry (${(registry.members ?? []).length} rows)`)
}
