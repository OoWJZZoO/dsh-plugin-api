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

/**
 * Paths the facade publishes today.
 *
 * A published member row is the primary evidence. The `services.*` aggregate is
 * registered as an audited whitelist rather than as member rows, so a
 * whitelisted service key counts as published too — otherwise the passthrough
 * clusters would report a limitation the facade does not have.
 */
function publishedPaths(registry) {
  const published = new Set()
  for (const member of registry.members ?? []) {
    if (member?.status !== 'removed' && typeof member?.publicPath === 'string') published.add(member.publicPath)
  }
  for (const entry of registry.servicesWhitelist ?? []) {
    if (typeof entry?.key === 'string' && entry.key.length > 0) published.add(`services.${entry.key}`)
  }
  return published
}

/**
 * Derive one cluster's current status, limitations and gap reason.
 *
 * Current status is read from the published member inventory, never from the
 * migration action the registry records: `active` when every path the cluster
 * designates is published, `degraded` when part of it is (the unpublished paths
 * are the cluster's limitations today), `unavailable` when none of it is (the
 * cluster's gap reason explains why).
 */
function currentRow(row, published) {
  const targets = Array.isArray(row.targetPaths) ? row.targetPaths.filter((path) => typeof path === 'string') : []
  const unpublished = targets.filter((path) => !published.has(path))
  if (targets.length === 0 || unpublished.length === 0) {
    if (targets.length === 0 && !(Array.isArray(row.currentPaths) && row.currentPaths.length > 0)) return undefined
    return { status: 'active', limitations: [], gapReason: null }
  }
  const limitations = [...unpublished].sort()
  if (unpublished.length === targets.length) {
    return { status: 'unavailable', limitations, gapReason: row.gapReason ?? null }
  }
  return { status: 'degraded', limitations, gapReason: row.gapReason ?? null }
}

export function buildRows(registry) {
  const published = publishedPaths(registry)
  const rows = []
  for (const row of registry.capabilityMatrix ?? []) {
    // The retro removal and internalization lists are migration bookkeeping,
    // never current capabilities: their paths are gone (or moved behind another
    // entry) and their replacements are already registered as the clusters
    // those replacements belong to.
    if (BOOKKEEPING_CLUSTER.test(row.capabilityCluster)) continue
    const current = currentRow(row, published)
    if (current === undefined) continue
    rows.push({ capabilityCluster: row.capabilityCluster, ...current })
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
 * today — the paths the cluster designates that the facade does not publish —
 * and, for a cluster that is unavailable, the gap reason. The
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

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
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
}
