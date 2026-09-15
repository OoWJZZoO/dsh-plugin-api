/**
 * Regenerate `lib/capability-matrix.js` from the public contract registry.
 *
 * The runtime matrix is a *current-capability* projection: one row per live
 * capability cluster with its current status, its limitations and its gap
 * reason. The registry keeps the migration ledger (rename / merge / migrate /
 * delete / internalize and the replacement notes) — that bookkeeping is a
 * registration-face concern and must not reach the runtime output.
 *
 * Usage: node scripts/capability-matrix-sync.mjs [registry.json] [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DEFAULT_REGISTRY = fileURLToPath(new URL('../docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json', import.meta.url))
const TARGET = fileURLToPath(new URL('../lib/capability-matrix.js', import.meta.url))

/**
 * Bookkeeping clusters that never reach the runtime projection: the retro
 * removal lists and the internalization notes are migration ledger rows, not
 * current capabilities.
 */
const BOOKKEEPING_CLUSTER = / (internalized|removals)$/

function currentStatus(row) {
  if (row.status === 'deleted' || BOOKKEEPING_CLUSTER.test(row.capabilityCluster)) return undefined
  if (row.status === 'gap') return 'unavailable'
  return 'active'
}

export function buildRows(registry) {
  const rows = []
  for (const row of registry.capabilityMatrix ?? []) {
    const status = currentStatus(row)
    if (status === undefined) continue
    rows.push({
      capabilityCluster: row.capabilityCluster,
      status,
      limitations: [],
      gapReason: row.gapReason ?? null,
    })
  }
  return rows
}

export function renderModule(rows) {
  const body = rows.map((row) => {
    const fields = [
      `capabilityCluster: ${JSON.stringify(row.capabilityCluster)}`,
      `status: ${JSON.stringify(row.status)}`,
      `limitations: ${JSON.stringify(row.limitations)}`,
      `gapReason: ${row.gapReason === null ? 'null' : JSON.stringify(row.gapReason)}`,
    ]
    return `  {\n${fields.map((field) => `    ${field},`).join('\n')}\n  },`
  })
  return `/**
 * Current capability projection for the pluginApi root (generated).
 *
 * One row per live capability cluster: the cluster name, its current status
 * (a three-value token, never a migration action), the limitations it carries
 * today and, for a cluster that does not exist yet, the gap reason. The
 * migration ledger — rename / merge / migrate / delete / internalize and the
 * replacement notes — lives in the public contract registry's registration
 * face and deliberately does not appear here.
 *
 * Rebuild with \`node scripts/capability-matrix-sync.mjs\`; the registry test
 * suite asserts the projection stays derived from the registry.
 */
export const CAPABILITY_MATRIX = Object.freeze([
${body.join('\n')}
].map((record) => Object.freeze({ ...record, limitations: Object.freeze([...record.limitations]) })))

const BY_CLUSTER = new Map(CAPABILITY_MATRIX.map((record) => [record.capabilityCluster, record]))

/** Frozen current-capability view: one row per live capability cluster. */
export function capabilityMatrixView() {
  return Object.freeze({ clusters: CAPABILITY_MATRIX })
}

/** @returns {object|undefined} the frozen projection row for a cluster. */
export function capabilityMatrixCluster(cluster) {
  return BY_CLUSTER.get(cluster)
}
`
}

const args = process.argv.slice(2)
const check = args.includes('--check')
const registryPath = args.find((arg) => !arg.startsWith('--')) ?? DEFAULT_REGISTRY
const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
const rendered = renderModule(buildRows(registry))

if (check) {
  const current = readFileSync(TARGET, 'utf8')
  if (current !== rendered) {
    console.error('capability matrix is out of date with the registry')
    process.exit(1)
  }
  console.log('capability matrix is in sync with the registry')
} else {
  writeFileSync(TARGET, rendered)
  console.log(`capability matrix regenerated from the registry (${buildRows(registry).length} clusters)`)
}
