/**
 * Pure snapshot/generator for the public contract registry.
 *
 * Zero harness dependencies. Derives test-time artifacts from the registry so
 * the public shape is constrained by a single source of truth:
 * - host/client surface snapshots (target tree + leaf members);
 * - idiom groups (public paths grouped by their primary idiom);
 * - handle members (public handle leaves);
 * - capability status (conservation matrix rows);
 * - services fixture (static whitelist);
 * - event authority (event semantics, producer authority, dispatch modes);
 * - composable profile fixture (recommended members);
 * - migration diff (per-action current-to-target path lists);
 * - composition matrix (members grouped by declared composition mode).
 *
 * Snapshots contain neutral capability/domain names only and never carry
 * governance classification tokens. The generator never inspects arbitrary
 * runtime objects and never discovers undocumented official members.
 *
 * Usage:
 *   node scripts/registry-snapshot.mjs <registry.json> <outDir>
 */

export function buildSnapshots(registry) {
  const hostDomainTree = Array.isArray(registry?.hostDomainTree) ? registry.hostDomainTree : []
  const clientDomainTree = Array.isArray(registry?.clientDomainTree) ? registry.clientDomainTree : []
  const members = Array.isArray(registry?.members) ? registry.members : []
  const servicesWhitelist = Array.isArray(registry?.servicesWhitelist) ? registry.servicesWhitelist : []
  const capabilityMatrix = Array.isArray(registry?.capabilityMatrix) ? registry.capabilityMatrix : []
  const eventCatalog = Array.isArray(registry?.eventCatalog) ? registry.eventCatalog : []
  const oldToTargetMapping = Array.isArray(registry?.oldToTargetMapping) ? registry.oldToTargetMapping : []
  const namespaces = Array.isArray(registry?.namespaces) ? registry.namespaces : []

  const hostMembers = members
    .filter((member) => member.runtime === 'host' || member.runtime === 'both')
    .map(projectMember)
  const clientMembers = members
    .filter((member) => member.runtime === 'client' || member.runtime === 'both')
    .map(projectMember)

  const idiomGroups = {}
  for (const member of members) {
    if (member.idiom === null || member.idiom === undefined) continue
    ;(idiomGroups[member.idiom] ??= []).push(member.publicPath)
  }
  for (const list of Object.values(idiomGroups)) list.sort()

  const handleMembers = members
    .filter((member) => member.kind === 'handle')
    .map((member) => ({
      publicPath: member.publicPath,
      targetPath: member.targetPath,
      runtime: member.runtime,
      idiom: member.idiom,
      lifecycle: member.lifecycle,
    }))
    .sort((a, b) => a.publicPath.localeCompare(b.publicPath))

  const byComposition = {}
  for (const member of members) {
    const mode = member.composition
    if (!mode || mode === 'pending-audit') continue
    ;(byComposition[mode] ??= []).push(member.publicPath)
  }

  const recommended = members
    .filter((member) => member.status === 'recommended')
    .map((member) => member.publicPath)
    .sort()

  const byAction = {}
  for (const entry of oldToTargetMapping) {
    const action = entry.action ?? 'rename'
    ;(byAction[action] ??= []).push(entry.oldPath)
  }
  for (const list of Object.values(byAction)) list.sort()

  return {
    hostSurface: {
      roots: [...hostDomainTree].sort(),
      namespaces: namespaces
        .filter((record) => (record.runtime ?? 'host') === 'host')
        .map((record) => ({ namespace: record.namespace, availabilityMember: record.availabilityMember, availabilityExemption: record.availabilityExemption })),
      members: hostMembers,
    },
    clientSurface: {
      roots: [...clientDomainTree].sort(),
      clientRoot: registry?.clientRoot ?? null,
      namespaces: namespaces
        .filter((record) => (record.runtime ?? 'host') === 'client')
        .map((record) => ({ namespace: record.namespace, availabilityMember: record.availabilityMember, availabilityExemption: record.availabilityExemption })),
      members: clientMembers,
    },
    idiomGroups,
    handleMembers,
    capabilityStatus: {
      clusters: capabilityMatrix.map((row) => ({
        capabilityCluster: row.capabilityCluster,
        status: row.status,
        qualifiers: row.qualifiers ?? [],
        replacement: row.replacement ?? null,
        gapReason: row.gapReason ?? null,
      })),
    },
    servicesFixture: {
      keys: servicesWhitelist.map((entry) => entry.key).sort(),
    },
    eventAuthority: {
      events: eventCatalog.map((event) => ({
        name: event.name,
        runtime: event.runtime ?? 'host',
        eventSemantics: event.eventSemantics,
        producerAuthority: event.producerAuthority,
        dispatch: event.dispatch,
        observerFailure: event.observerFailure,
      })),
    },
    migrationDiff: {
      byAction,
    },
    compositionMatrix: {
      byComposition,
    },
    composableProfile: {
      members: recommended,
    },
  }
}

function projectMember(member) {
  return {
    publicPath: member.publicPath,
    proposedTargetPath: typeof member.targetPath === 'string' && member.targetPath.length > 0 ? member.targetPath : null,
    runtime: member.runtime,
    idiom: member.idiom,
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
