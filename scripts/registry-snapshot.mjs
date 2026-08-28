/**
 * Pure snapshot/generator for the public contract registry.
 *
 * Zero harness dependencies. Derives test-time artifacts from the registry so
 * the public shape is constrained by a single source of truth:
 * - host surface snapshot (target tree + members);
 * - client surface snapshot (target tree + client root record);
 * - services fixture (static whitelist);
 * - composition matrix input (members grouped by declared composition mode;
 *   members awaiting audit are excluded until they are finalized).
 *
 * Snapshots contain neutral capability/domain names only and never carry
 * governance classification tokens.
 *
 * Usage:
 *   node scripts/registry-snapshot.mjs <registry.json> <outDir>
 */

export function buildSnapshots(registry) {
  const hostDomainTree = Array.isArray(registry?.hostDomainTree) ? registry.hostDomainTree : []
  const clientDomainTree = Array.isArray(registry?.clientDomainTree) ? registry.clientDomainTree : []
  const members = Array.isArray(registry?.members) ? registry.members : []
  const servicesWhitelist = Array.isArray(registry?.servicesWhitelist) ? registry.servicesWhitelist : []

  const hostMembers = members
    .filter((member) => member.runtime === 'host' || member.runtime === 'both')
    .map(projectMember)
  const clientMembers = members
    .filter((member) => member.runtime === 'client' || member.runtime === 'both')
    .map(projectMember)

  const byComposition = {}
  for (const member of members) {
    const mode = member.composition
    if (!mode || mode === 'pending-audit') continue
    ;(byComposition[mode] ??= []).push(member.publicPath)
  }

  return {
    hostSurface: {
      roots: [...hostDomainTree].sort(),
      members: hostMembers,
    },
    clientSurface: {
      roots: [...clientDomainTree].sort(),
      clientRoot: registry?.clientRoot ?? null,
      members: clientMembers,
    },
    servicesFixture: {
      keys: servicesWhitelist.map((entry) => entry.key).sort(),
    },
    compositionMatrix: {
      byComposition,
    },
  }
}

function projectMember(member) {
  return {
    publicPath: member.publicPath,
    proposedTargetPath: member.proposedTargetPath ?? member.publicPath,
    runtime: member.runtime,
    effect: member.effect,
    composition: member.composition ?? 'pending-audit',
    status: member.status,
    implementationChannel: member.implementationChannel,
  }
}

/* Direct CLI execution: `node scripts/registry-snapshot.mjs <registry.json> <outDir>` */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const { readFileSync, mkdirSync, writeFileSync } = await import('node:fs')
  const target = process.argv[2]
  const outDir = process.argv[3]
  if (!target || !outDir) {
    console.error('usage: node scripts/registry-snapshot.mjs <registry.json> <outDir>')
    process.exit(2)
  }
  let registry
  try {
    registry = JSON.parse(readFileSync(target, 'utf8'))
  } catch (error) {
    console.error(`cannot read registry ${target}: ${error.message}`)
    process.exit(2)
  }
  const snapshots = buildSnapshots(registry)
  mkdirSync(outDir, { recursive: true })
  for (const [name, value] of Object.entries(snapshots)) {
    writeFileSync(`${outDir}/${name}.json`, `${JSON.stringify(value, null, 2)}\n`)
    console.log(`wrote ${outDir}/${name}.json`)
  }
}