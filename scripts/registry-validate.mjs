/**
 * Pure registry validator for the public contract registry.
 *
 * Zero harness dependencies. Validates the machine-readable public contract
 * registry (single source of truth for the pre-release public contract):
 * required leaf fields with explicit nulls, duplicate paths, path depth,
 * vocabulary membership, idiom classification and the services passthrough
 * boundary, handle coverage, namespace navigation closure, capability
 * conservation, event semantics, mapping consistency, and host/client parity.
 * Never inspects arbitrary runtime objects and never auto-discovers official
 * members.
 *
 * Usage:
 *   node scripts/registry-validate.mjs <registry.json>
 * Exits non-zero when the registry is invalid.
 */

const VERSION_RE = /^(.+)-\d+\.\d+(?:\.\d+)?$/
const MAX_PATH_DEPTH = 5
const IDIOMS = ['projection', 'policy', 'mutation', 'operation', 'contribution', 'resourceRegistry', 'coordination', 'selfDescription', 'passthrough-exception']
const MIGRATION_ACTIONS = ['rename', 'merge', 'split', 'migrate', 'delete', 'internalize', 'retain']
const CONSERVATION_STATUS = ['retained', 'renamed', 'merged', 'migrated', 'deleted', 'gap']
const QUALIFIERS = ['shape', 'split', 'reclassified', 'internalized']
const EVENT_SEMANTICS = ['decision', 'fact', 'observation', 'notification']
const EXCEPTION_FIELDS = ['memberPath', 'baseContract', 'exception', 'reason', 'replacementShape', 'verification']
const MEMBER_FIELDS = [
  'publicPath', 'targetPath', 'capability', 'kind', 'idiom', 'idiomExceptions', 'eventSemantics',
  'semanticFace', 'effect', 'composition', 'runtime', 'implementationChannel', 'authority', 'scope',
  'resourceKey', 'identitySource', 'conflictRule', 'lifecycle', 'failureSemantics', 'idempotency',
  'retryLayer', 'availabilityShape', 'concurrency', 'reducer', 'currentShape', 'migrationAction',
  'status', 'verification',
]

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * @param {unknown} registry - parsed registry JSON content.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateRegistry(registry) {
  const errors = []

  if (!isPlainRecord(registry)) {
    return { ok: false, errors: ['registry must be a JSON object'] }
  }

  const vocabulary = registry.vocabulary
  if (!isPlainRecord(vocabulary)) {
    return { ok: false, errors: ['vocabulary section is required'] }
  }
  const vocabNames = [
    'runtime', 'effect', 'composition', 'availability', 'status',
    'terminal', 'priority', 'scope', 'implementationChannel', 'deletionCategory',
    'idiom', 'eventSemantics', 'semanticFace', 'failureSemantics', 'conflictRule',
    'migrationAction', 'lifecycleState', 'coordinationCode', 'concurrency', 'reducer',
    'qualifier', 'operationTerminal',
  ]
  for (const name of vocabNames) {
    if (!Array.isArray(vocabulary[name]) || vocabulary[name].length === 0) {
      errors.push(`vocabulary.${name} must be a non-empty array`)
    }
  }
  // Frozen decisions: the idiom and migration-action vocabularies are closed.
  for (const idiom of ['projection', 'policy', 'mutation', 'operation', 'contribution', 'resourceRegistry', 'coordination', 'selfDescription', 'passthrough-exception']) {
    if (!vocabulary.idiom?.includes(idiom)) errors.push(`vocabulary.idiom must contain ${idiom}`)
  }
  for (const action of MIGRATION_ACTIONS) {
    if (!vocabulary.migrationAction?.includes(action)) errors.push(`vocabulary.migrationAction must contain ${action}`)
  }
  if (vocabulary.migrationAction?.includes('gap')) {
    errors.push('vocabulary.migrationAction must not contain gap; gap is a capabilityMatrix.status value only')
  }
  const memberOf = (name, value) => {
    const list = vocabulary[name] ?? []
    return typeof value === 'string' && list.includes(value)
  }

  const baseline = registry.contractBaseline
  if (!isPlainRecord(baseline)) {
    errors.push('contractBaseline section is required')
  } else {
    if (!isNonEmptyString(baseline.packageVersion) || !VERSION_RE.test(baseline.packageVersion)) {
      errors.push('contractBaseline.packageVersion must follow <runtime>-<api>.<increment>.<maintenance>')
    }
    if (isNonEmptyString(baseline.api) && !/^\d+\.\d+$/.test(baseline.api)) {
      errors.push('contractBaseline.api must be a bare <generation>.<increment> contract')
    }
    if (baseline.frozen !== true) {
      errors.push('contractBaseline.frozen must be true while the baseline is frozen')
    }
  }

  if (!Array.isArray(registry.hostDomainTree) || registry.hostDomainTree.length === 0) {
    errors.push('hostDomainTree must be a non-empty array')
  }
  if (!Array.isArray(registry.clientDomainTree) || registry.clientDomainTree.length === 0) {
    errors.push('clientDomainTree must be a non-empty array')
  }

  const clientRoot = registry.clientRoot
  if (!isPlainRecord(clientRoot)) {
    errors.push('clientRoot section must be an object')
  } else if (!Array.isArray(clientRoot.members)) {
    errors.push('clientRoot.members must be an array of root member names')
  } else if (clientRoot.members.some((name) => typeof name === 'string' && name.includes('.client'))) {
    errors.push('clientRoot.members must not expose a public .client wrapper namespace')
  }

  // -------------------------------------------------------------------------
  // Members: leaf-level records with the complete field set
  // -------------------------------------------------------------------------
  const seenPaths = new Set()
  const membersByRuntimePath = new Map()
  const memberByKey = new Map()
  if (!Array.isArray(registry.members)) {
    errors.push('members must be an array')
  } else {
    for (const [index, member] of registry.members.entries()) {
      const where = `members[${index}]`
      if (!isPlainRecord(member)) {
        errors.push(`${where} must be an object`)
        continue
      }
      for (const field of MEMBER_FIELDS) {
        if (!(field in member)) {
          errors.push(`${where} requires field ${field}; a field that does not apply carries an explicit null`)
        }
      }
      if (!isNonEmptyString(member.publicPath)) {
        errors.push(`${where} requires a non-empty publicPath`)
        continue
      }
      const key = `${member.runtime}|${member.publicPath}`
      if (seenPaths.has(key)) {
        errors.push(`${where} duplicates publicPath ${JSON.stringify(member.publicPath)} for runtime ${JSON.stringify(member.runtime)}`)
        continue
      }
      seenPaths.add(key)
      memberByKey.set(key, member)
      if (member.runtime !== 'host' && member.runtime !== 'client' && member.runtime !== 'both') {
        errors.push(`${where}.runtime ${JSON.stringify(member.runtime)} is not in vocabulary.runtime`)
      }
      const segments = member.publicPath.split('.')
      const servicesRooted = member.publicPath === 'services' || member.publicPath.startsWith('services.')
      // Handle rows append the `.handle` suffix to their parent path, so they
      // carry one segment more than the deepest leaf.
      const depthLimit = member.kind === 'handle' ? MAX_PATH_DEPTH + 1 : MAX_PATH_DEPTH
      if (segments.length > depthLimit && !servicesRooted) {
        errors.push(`${where}: publicPath depth ${segments.length} exceeds the allowed maximum ${depthLimit} (services.* excepted)`)
      }

      // Idiom classification and the services passthrough boundary.
      const idiom = member.idiom
      if (idiom === 'passthrough-exception') {
        const publicRooted = servicesRooted
          || member.publicPath === 'services'
        const targetRooted = typeof member.targetPath === 'string'
          && (member.targetPath === 'services' || member.targetPath.startsWith('services.'))
        if (!publicRooted && !targetRooted) {
          errors.push(`${where}: passthrough-exception is only valid on a services.* path (publicPath or migrate targetPath), got ${JSON.stringify(member.publicPath)}`)
        }
      } else if (idiom !== null) {
        if (!IDIOMS.includes(idiom)) {
          errors.push(`${where}.idiom ${JSON.stringify(idiom)} is not one of the eight idioms or the registered passthrough exception`)
        }
        if (servicesRooted) {
          errors.push(`${where}: a services.* member must use the passthrough-exception idiom, got ${JSON.stringify(idiom)}`)
        }
      } else if (member.migrationAction !== 'delete' && member.migrationAction !== 'internalize') {
        errors.push(`${where}: idiom may only be null for delete or internalize members, got migrationAction ${JSON.stringify(member.migrationAction)}`)
      }
      if (Array.isArray(member.idiomExceptions) && member.idiomExceptions.length > 0) {
        for (const [eindex, exception] of member.idiomExceptions.entries()) {
          for (const field of EXCEPTION_FIELDS) {
            if (!isNonEmptyString(exception?.[field])) {
              errors.push(`${where}.idiomExceptions[${eindex}] is missing ${field}; all six fields are required`)
            }
          }
        }
      }

      for (const field of ['effect', 'composition', 'status', 'implementationChannel']) {
        if (member[field] !== undefined && !memberOf(field, member[field])) {
          // `pending-audit` is a provisional inventory marker for members whose
          // composition audit has not run yet; it is a registry-data value, not
          // a contract vocabulary entry, and must be resolved before delivery.
          if (field === 'composition' && member[field] === 'pending-audit') continue
          errors.push(`${where}.${field} ${JSON.stringify(member[field])} is not in vocabulary.${field}`)
        }
      }
      for (const field of ['failureSemantics', 'conflictRule', 'concurrency', 'reducer']) {
        if (member[field] !== null && member[field] !== undefined && !memberOf(field, member[field])) {
          errors.push(`${where}.${field} ${JSON.stringify(member[field])} is not in vocabulary.${field}`)
        }
      }
      if (member.migrationAction !== null && member.migrationAction !== undefined && !MIGRATION_ACTIONS.includes(member.migrationAction)) {
        errors.push(`${where}.migrationAction ${JSON.stringify(member.migrationAction)} is not in vocabulary.migrationAction`)
      }
      // A rename that keeps the old path is a compatibility alias, not a rename.
      if (member.migrationAction === 'rename' && member.publicPath === member.targetPath) {
        errors.push(`${where}: a rename must move to a different target path, got alias ${JSON.stringify(member.publicPath)}`)
      }
      // Official service passthrough keys must be audited whitelist entries.
      if (member.publicPath.startsWith('services.') && member.publicPath.split('.')[1]) {
        const serviceKey = member.publicPath.split('.')[1]
        const whitelist = Array.isArray(registry.servicesWhitelist) ? registry.servicesWhitelist : []
        if (!whitelist.some((entry) => entry?.key === serviceKey)) {
          errors.push(`${where}: services key ${JSON.stringify(serviceKey)} is not in the audited servicesWhitelist`)
        }
      }
      // generation/seq/epoch meanings must not bleed into each other.
      for (const field of ['lifecycle', 'idempotency', 'availabilityShape']) {
        const text = typeof member[field] === 'string' ? member[field] : ''
        if (/seq as (a )?fencing/i.test(text) || /epoch as (a )?concurrenc/i.test(text) || /generation as (a )?registration order/i.test(text)) {
          errors.push(`${where}.${field} mixes the generation/seq/epoch meanings`)
        }
      }
      if (member.status === 'recommended' && (member.composition === undefined || member.composition === null)) {
        errors.push(`${where}: a recommended member must declare a composition mode`)
      }
      if (member.status === 'recommended' && member.effect !== 'read' && !(Array.isArray(member.bypasses))) {
        errors.push(`${where}: a recommended non-read member must declare bypasses`)
      }
      if (member.availabilityShape !== null && member.availabilityShape !== undefined
        && !isNonEmptyString(member.availabilityShape)) {
        errors.push(`${where}.availabilityShape must be a non-empty string or an explicit null`)
      }
      // Coordination lease handles are credentials: no dispose(), give-back is
      // the entry verb release(handle); `stale` is never a machine code.
      if (idiom === 'coordination' && member.kind === 'handle') {
        const note = `${member.lifecycle ?? ''}`
        if (note.includes('dispose()')) {
          errors.push(`${where}: a coordination lease handle must not provide dispose(); give-back is release(handle)`)
        }
        if (!note.includes('release(handle)')) {
          errors.push(`${where}: a coordination lease handle must record the release(handle) give-back verb`)
        }
      }
      membersByRuntimePath.set(key, member)
    }
  }

  // Handle coverage: every handle row points at an existing parent member.
  const parentCandidates = new Set()
  for (const member of registry.members ?? []) {
    if (!isNonEmptyString(member?.publicPath)) continue
    parentCandidates.add(`${member.runtime}|${member.publicPath}`)
    if (isNonEmptyString(member.targetPath)) parentCandidates.add(`${member.runtime}|${member.targetPath}`)
  }
  for (const member of registry.members ?? []) {
    if (member?.kind !== 'handle') continue
    const parentPath = member.publicPath.split('.handle')[0]
    const grandparent = parentPath.split('.').slice(0, -1).join('.')
    const found = [parentPath, grandparent].some((prefix) => prefix && parentCandidates.has(`${member.runtime}|${prefix}`))
    if (!found) {
      errors.push(`members: handle row ${JSON.stringify(member.publicPath)} has no registered parent member`)
    }
  }

  // One outer failureSemantics per idiom (domain data varies, the outer
  // contract does not).
  const failureByIidom = new Map()
  for (const member of registry.members ?? []) {
    if (member?.idiom === null || member?.idiom === undefined) continue
    const previous = failureByIidom.get(member.idiom)
    if (previous === undefined) failureByIidom.set(member.idiom, member.failureSemantics)
    else if (previous !== member.failureSemantics) {
      errors.push(`members: idiom ${JSON.stringify(member.idiom)} carries conflicting failureSemantics ${JSON.stringify(previous)} and ${JSON.stringify(member.failureSemantics)}`)
    }
  }

  // Host/client parity for same-named members: aligned outer contracts.
  for (const member of registry.members ?? []) {
    if (member?.runtime !== 'host') continue
    const client = memberByKey.get(`client|${member.publicPath}`)
    if (!client) continue
    if (member.idiom !== client.idiom) {
      errors.push(`members: parity mismatch for ${JSON.stringify(member.publicPath)}: host idiom ${JSON.stringify(member.idiom)} vs client ${JSON.stringify(client.idiom)}`)
    }
    if (member.failureSemantics !== client.failureSemantics) {
      errors.push(`members: parity mismatch for ${JSON.stringify(member.publicPath)}: host failureSemantics ${JSON.stringify(member.failureSemantics)} vs client ${JSON.stringify(client.failureSemantics)}`)
    }
  }

  // -------------------------------------------------------------------------
  // Namespace navigation records
  // -------------------------------------------------------------------------
  if (!Array.isArray(registry.namespaces) || registry.namespaces.length === 0) {
    errors.push('namespaces must be a non-empty array of navigation records')
  } else {
    const seenNamespaces = new Set()
    for (const [index, record] of registry.namespaces.entries()) {
      const where = `namespaces[${index}]`
      if (!isPlainRecord(record) || !isNonEmptyString(record.namespace)) {
        errors.push(`${where} requires a non-empty namespace`)
        continue
      }
      const runtime = record.runtime ?? 'host'
      const nsKey = `${runtime}|${record.namespace}`
      if (seenNamespaces.has(nsKey)) {
        errors.push(`${where} duplicates namespace ${JSON.stringify(record.namespace)} for runtime ${JSON.stringify(runtime)}`)
      }
      seenNamespaces.add(nsKey)
      if (record.availabilityMember !== null && record.availabilityExemption) {
        errors.push(`${where}: availabilityMember and availabilityExemption are mutually exclusive`)
      }
      if (record.availabilityMember === null && !isNonEmptyString(record.availabilityExemption)) {
        errors.push(`${where}: a namespace record needs an availabilityMember or a non-empty availabilityExemption`)
      }
      const availability = record.availabilityMember ? memberByKey.get(`${runtime}|${record.availabilityMember}`) : null
      if (record.availabilityMember && !availability) {
        errors.push(`${where}: availabilityMember ${JSON.stringify(record.availabilityMember)} has no registered member`)
      } else if (availability && availability.idiom !== 'selfDescription') {
        errors.push(`${where}: availabilityMember ${JSON.stringify(record.availabilityMember)} must be a selfDescription member`)
      }
      if (!Array.isArray(record.contributingFeatures) || record.contributingFeatures.length === 0) {
        errors.push(`${where}: contributingFeatures must list every contributing feature`)
      }
      const prefix = `${record.namespace}.`
      const hasMember = [...memberByKey.values()].some((m) => m.runtime === runtime && (m.publicPath === record.namespace || m.publicPath.startsWith(prefix)))
      if (!hasMember) {
        errors.push(`${where}: namespace ${JSON.stringify(record.namespace)} has no registered member`)
      }
    }
    // Prefix closure: a member whose prefix is declared as a namespace is
    // fine; a declared namespace must exist (checked above). Conversely, an
    // availability leaf without its namespace record is a defect.
    for (const member of registry.members ?? []) {
      if (!isNonEmptyString(member?.publicPath) || !member.publicPath.endsWith('.availability')) continue
      const ns = member.publicPath.slice(0, -'.availability'.length)
      if (member.publicPath.startsWith('services.')) continue
      const record = registry.namespaces.find((r) => r?.namespace === ns && (r.runtime ?? 'host') === member.runtime)
      if (!record) {
        errors.push(`members: availability leaf ${JSON.stringify(member.publicPath)} has no namespace navigation record`)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Capability conservation matrix
  // -------------------------------------------------------------------------
  if (!Array.isArray(registry.capabilityMatrix)) {
    errors.push('capabilityMatrix must be an array')
  } else {
    const seenClusters = new Set()
    for (const [index, row] of registry.capabilityMatrix.entries()) {
      const where = `capabilityMatrix[${index}]`
      if (!isPlainRecord(row) || !isNonEmptyString(row.capabilityCluster)) {
        errors.push(`${where} requires a non-empty capabilityCluster`)
        continue
      }
      if (seenClusters.has(row.capabilityCluster)) {
        errors.push(`${where} duplicates capabilityCluster ${JSON.stringify(row.capabilityCluster)}`)
      }
      seenClusters.add(row.capabilityCluster)
      if (!CONSERVATION_STATUS.includes(row.status)) {
        errors.push(`${where}.status ${JSON.stringify(row.status)} is not one of ${CONSERVATION_STATUS.join(' | ')}`)
      }
      if (!Array.isArray(row.qualifiers) || row.qualifiers.some((q) => !QUALIFIERS.includes(q))) {
        errors.push(`${where}.qualifiers must be drawn from ${QUALIFIERS.join(' | ')}`)
      }
      if (row.status === 'deleted' && !isNonEmptyString(row.replacement) && !isNonEmptyString(row.gapReason)) {
        errors.push(`${where}: a deleted cluster needs a replacement or a gap reason`)
      }
      if (row.status === 'gap' && !isNonEmptyString(row.gapReason)) {
        errors.push(`${where}: a gap cluster needs the missing capability property and its required upstream nature`)
      }
      if (['renamed', 'merged', 'migrated'].includes(row.status) && !(Array.isArray(row.targetPaths) && row.targetPaths.length > 0)) {
        errors.push(`${where}: a ${row.status} cluster needs at least one target path`)
      }
      if (row.status === 'gap' && (Array.isArray(row.currentPaths) && row.currentPaths.length > 0)) {
        errors.push(`${where}: a gap cluster is not represented by current public leaves`)
      }
    }
    const clusterSet = new Set(registry.capabilityMatrix.map((row) => row?.capabilityCluster))
    for (const member of registry.members ?? []) {
      if (isNonEmptyString(member?.capability) && !clusterSet.has(member.capability)) {
        errors.push(`members: capability ${JSON.stringify(member.capability)} of ${JSON.stringify(member.publicPath)} is absent from capabilityMatrix`)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Event catalog
  // -------------------------------------------------------------------------
  if (!Array.isArray(registry.eventCatalog)) {
    errors.push('eventCatalog must be an array')
  } else {
    const seenEvents = new Set()
    for (const [index, event] of registry.eventCatalog.entries()) {
      const where = `eventCatalog[${index}]`
      if (!isPlainRecord(event) || !isNonEmptyString(event.name)) {
        errors.push(`${where} requires a non-empty name`)
        continue
      }
      const key = `${event.runtime ?? 'host'}|${event.name}`
      if (seenEvents.has(key)) errors.push(`${where} duplicates event ${JSON.stringify(event.name)}`)
      seenEvents.add(key)
      for (const field of ['eventSemantics', 'scope', 'payloadShape', 'freeze', 'priority', 'observerFailure', 'producerAuthority', 'dispatch', 'implementationChannel']) {
        if (!isNonEmptyString(event[field])) {
          errors.push(`${where} requires a non-empty ${field}`)
        }
      }
      if (event.eventSemantics !== undefined && !EVENT_SEMANTICS.includes(event.eventSemantics)) {
        errors.push(`${where}.eventSemantics ${JSON.stringify(event.eventSemantics)} is not in vocabulary.eventSemantics`)
      }
      if (event.eventSemantics === 'decision') {
        for (const field of ['decisionPrecedence', 'conflictConvergence', 'listenerFailureDefault']) {
          if (!isNonEmptyString(event[field])) {
            errors.push(`${where}: a decision event requires ${field}`)
          }
        }
      } else if (event.decisionPrecedence !== undefined) {
        errors.push(`${where}: decision precedence fields are reserved for decision events`)
      }
    }
  }

  // -------------------------------------------------------------------------
  // servicesWhitelist, oldToTargetMapping
  // -------------------------------------------------------------------------
  const seenServices = new Set()
  if (!Array.isArray(registry.servicesWhitelist)) {
    errors.push('servicesWhitelist must be an array')
  } else {
    for (const [index, entry] of registry.servicesWhitelist.entries()) {
      const where = `servicesWhitelist[${index}]`
      if (!isPlainRecord(entry) || !isNonEmptyString(entry.key)) {
        errors.push(`${where} requires a non-empty key`)
        continue
      }
      if (seenServices.has(entry.key)) {
        errors.push(`${where} duplicates service key ${JSON.stringify(entry.key)}`)
      }
      seenServices.add(entry.key)
      if (entry.channel !== undefined && !memberOf('implementationChannel', entry.channel)) {
        errors.push(`${where}.channel ${JSON.stringify(entry.channel)} is not in vocabulary.implementationChannel`)
      }
    }
  }

  const mappingByOld = new Map()
  if (!Array.isArray(registry.oldToTargetMapping)) {
    errors.push('oldToTargetMapping must be an array')
  } else {
    for (const [index, entry] of registry.oldToTargetMapping.entries()) {
      const where = `oldToTargetMapping[${index}]`
      if (!isPlainRecord(entry) || !isNonEmptyString(entry.oldPath)) {
        errors.push(`${where} requires a non-empty oldPath`)
        continue
      }
      if (mappingByOld.has(entry.oldPath)) {
        errors.push(`${where} duplicates oldPath ${JSON.stringify(entry.oldPath)}`)
        continue
      }
      mappingByOld.set(entry.oldPath, entry)
      if (entry.action !== undefined) {
        if (!MIGRATION_ACTIONS.includes(entry.action)) {
          errors.push(`${where}.action ${JSON.stringify(entry.action)} is not in vocabulary.migrationAction`)
        }
        if (entry.action === 'delete' && entry.targetPath !== null) {
          errors.push(`${where}: a delete entry records targetPath null`)
        }
        if (!['delete', 'internalize'].includes(entry.action) && !isNonEmptyString(entry.targetPath)) {
          errors.push(`${where}: a non-delete entry requires a target path`)
        }
      } else if (!isNonEmptyString(entry.targetPath)) {
        errors.push(`${where} requires a targetPath`)
      }
    }
    for (const member of registry.members ?? []) {
      if (member?.migrationAction === null || member?.migrationAction === undefined) continue
      const entry = mappingByOld.get(member.publicPath)
      if (!entry) {
        errors.push(`members: ${JSON.stringify(member.publicPath)} declares migrationAction ${JSON.stringify(member.migrationAction)} without an oldToTargetMapping entry`)
      } else if (entry.action !== undefined && entry.action !== member.migrationAction) {
        errors.push(`members: ${JSON.stringify(member.publicPath)} migrationAction ${JSON.stringify(member.migrationAction)} disagrees with oldToTargetMapping action ${JSON.stringify(entry.action)}`)
      }
    }
  }

  return { ok: errors.length === 0, errors }
}

/* Direct CLI execution: `node scripts/registry-validate.mjs <registry.json>` */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const { readFileSync } = await import('node:fs')
  const target = process.argv[2]
  if (!target) {
    console.error('usage: node scripts/registry-validate.mjs <registry.json>')
    process.exit(2)
  }
  let registry
  try {
    registry = JSON.parse(readFileSync(target, 'utf8'))
  } catch (error) {
    console.error(`cannot read registry ${target}: ${error.message}`)
    process.exit(2)
  }
  const result = validateRegistry(registry)
  for (const error of result.errors) console.error(`- ${error}`)
  if (!result.ok) process.exit(1)
  console.log('registry valid')
}
