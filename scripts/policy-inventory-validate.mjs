/**
 * Pure validator for the policy inventory / enforcement matrix of the
 * plugin-api-policy-enforcement-closure feature.
 *
 * Zero harness dependencies. Cross-checks the build/test-time inventory
 * artifact (`docs/specs/plugin-api-policy-enforcement-closure/policy-inventory.json`)
 * against the canonical public contract registry. It fails on:
 *   - an unregistered policy member (registry policy leaf absent from the inventory);
 *   - an undeclared official protected path (inventory automatic point not in the matrix);
 *   - a registration with no automatic/cooperative disposition;
 *   - an overbroad coverage claim;
 *   - a gap record missing any required field;
 *   - a gap recorded for a common path or a path already owned by an approved replacement;
 *   - a contradiction between registry and inventory that must not be silently resolved.
 *
 * Usage:
 *   node scripts/policy-inventory-validate.mjs <registry.json> <inventory.json>
 * Exits non-zero when the inventory is invalid.
 */

const INVENTORY_FIELDS = [
  'policyPath', 'registrationShape', 'primaryIdiom', 'policyOwner', 'componentOwner',
  'decisionVocabulary', 'reducer/conflictRule', 'defaultDecision', 'automaticDecisionPoint',
  'protectedAction', 'cooperativeInterface', 'observableEvidence', 'failureAndCancellation',
  'coverageStatus', 'verification', 'retirementCondition',
]

const GAP_FIELDS = [
  'gapPath', 'component', 'trigger', 'protectedAction', 'missingPreActionPoint',
  'failedChannels', 'observableConsequence', 'affectedInstallationModes', 'evidence',
  'retirementCondition',
]

const COVERAGE_STATUSES = ['automatic', 'planned-automatic', 'cooperative-only', 'unavailable', 'named-gap']

/**
 * Paths that are common, materially security/correctness-relevant, or already
 * owned by an approved replacement component must never be recorded as an
 * edge-path gap (the feature requirement 10 edge-gap rejection rule). Kept in
 * sync with the approved replacement inventory of this feature.
 */
const DENY_GAP_PREFIXES = [
  'security.egress', 'executions.recovery', 'events.define',
  'llm/provider', 'llm/modelDiscovery', 'llm/request-transform', 'llm/admission', 'route', 'circuit',
  'mcp/stdio', 'mcp/http', 'web', 'connection', 'subprocess', 'terminal', 'shell',
  'visibility', 'channel-auth', 'tool-restrict', 'tool-guard', 'skill-activation',
  'prompt-provenance', 'security-policy', 'security-redaction',
  'recovery/model', 'recovery/tool', 'recovery/task', 'recovery/transaction', 'recovery-visibility',
]

const OVERBROAD_PATTERNS = [
  /\ball official paths\b/i,
  /\bevery official path\b/i,
  /\ball official outbound\b/i,
  /\ball outbound paths\b/i,
  /\ball egress targets\b/i,
  /\bcover[s]? everything\b/i,
  /\ball paths\b/i,
]

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasField(record, field) {
  return field in record && record[field] !== undefined
}

/**
 * @param {unknown} registry - parsed canonical registry JSON.
 * @param {unknown} inventory - parsed policy inventory JSON.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validatePolicyInventory(registry, inventory) {
  const errors = []

  if (!isPlainRecord(inventory)) {
    return { ok: false, errors: ['policy inventory must be a JSON object'] }
  }

  // Baseline agreement: the inventory must pin the same frozen baseline as the
  // registry; a mismatch is a contradiction, not a silent choice.
  const base = inventory.baseline
  const rb = registry?.contractBaseline
  if (!isPlainRecord(base)) {
    errors.push('policy inventory requires a baseline object')
  } else if (!isPlainRecord(rb)) {
    errors.push('policy inventory baseline cannot be compared: registry contractBaseline is missing')
  } else {
    for (const field of ['runtime', 'api', 'packageVersion']) {
      if (base[field] !== rb[field]) {
        errors.push(`policy inventory baseline.${field} ${JSON.stringify(base[field])} disagrees with registry ${JSON.stringify(rb[field])}`)
      }
    }
    if (base.frozen !== true) errors.push('policy inventory baseline.frozen must be true')
  }

  if (!Array.isArray(inventory.coverageStatuses) || !COVERAGE_STATUSES.every((s) => inventory.coverageStatuses.includes(s))) {
    errors.push(`policy inventory coverageStatuses must include ${COVERAGE_STATUSES.join(' | ')}`)
  }
  if (!Array.isArray(inventory.inventory)) errors.push('policy inventory requires an inventory array')

  const members = Array.isArray(registry?.members) ? registry.members : []
  const capabilityMatrix = Array.isArray(registry?.capabilityMatrix) ? registry.capabilityMatrix : []

  // -------------------------------------------------------------------------
  // Inventory rows: field completeness and registry agreement
  // -------------------------------------------------------------------------
  const registeredPaths = new Set()
  const inventoryByPath = new Map()
  if (Array.isArray(inventory.inventory)) {
    const seenPolicy = new Set()
    for (const [index, row] of inventory.inventory.entries()) {
      const where = `inventory[${index}]`
      if (!isPlainRecord(row)) {
        errors.push(`${where} must be an object`)
        continue
      }
      for (const field of INVENTORY_FIELDS) {
        if (!hasField(row, field)) errors.push(`${where} requires field ${field}; a non-applicable field carries an explicit null`)
      }
      if (isNonEmptyString(row.policyPath)) {
        if (seenPolicy.has(row.policyPath)) errors.push(`${where} duplicates policyPath ${JSON.stringify(row.policyPath)}`)
        seenPolicy.add(row.policyPath)
        inventoryByPath.set(row.policyPath, row)
      }
      if (!COVERAGE_STATUSES.includes(row.coverageStatus)) {
        errors.push(`${where}.coverageStatus ${JSON.stringify(row.coverageStatus)} is not one of ${COVERAGE_STATUSES.join(' | ')}`)
      }
      // A registration must have a disposition: automatic or planned-automatic
      // requires an enforcement path; cooperative-only requires an interface.
      if (row.coverageStatus === 'automatic' || row.coverageStatus === 'planned-automatic') {
        if (!Array.isArray(row.enforcementPaths) || row.enforcementPaths.length === 0) {
          errors.push(`${where}: an ${row.coverageStatus} row must declare at least one enforcementPath`)
        }
        if (!isNonEmptyString(row.automaticDecisionPoint)) {
          errors.push(`${where}: an ${row.coverageStatus} row requires a non-empty automaticDecisionPoint`)
        }
      } else if (row.coverageStatus === 'cooperative-only') {
        if (!isNonEmptyString(row.cooperativeInterface)) {
          errors.push(`${where}: a cooperative-only row requires a non-empty cooperativeInterface`)
        }
      }
      // Registration members must exist in the registry as policy members.
      const shapes = [row.registrationShape, ...(Array.isArray(row.registeredMembers) ? row.registeredMembers : [])].filter(isNonEmptyString)
      for (const shape of shapes) {
        registeredPaths.add(shape)
        const member = members.find((m) => m.publicPath === shape && (m.runtime === 'host' || m.runtime === 'both'))
        if (!member) {
          errors.push(`${where}: registration member ${JSON.stringify(shape)} is not registered in the canonical registry`)
        } else if (member.idiom !== 'policy') {
          errors.push(`${where}: registration member ${JSON.stringify(shape)} has registry idiom ${JSON.stringify(member.idiom)}, not policy`)
        }
      }
      // Overbroad coverage claim guard: automatic rows may not claim blanket coverage.
      if (row.coverageStatus === 'automatic') {
        const text = [row.automaticDecisionPoint, row.protectedAction, row.observableEvidence].filter(isNonEmptyString).join(' ')
        for (const pattern of OVERBROAD_PATTERNS) {
          if (pattern.test(text)) {
            errors.push(`${where}: overbroad coverage claim matched ${pattern}`)
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Enforcement matrix: declaration closure in both directions
  // -------------------------------------------------------------------------
  const matrixPaths = new Set()
  if (!Array.isArray(inventory.enforcementMatrix)) {
    errors.push('policy inventory requires an enforcementMatrix array')
  } else {
    const seenPath = new Set()
    for (const [index, row] of inventory.enforcementMatrix.entries()) {
      const where = `enforcementMatrix[${index}]`
      if (!isPlainRecord(row)) {
        errors.push(`${where} must be an object`)
        continue
      }
      for (const field of ['officialPath', 'decisionPoint', 'componentOwner', 'implementationChannel', 'reentry', 'coverageStatus', 'verification']) {
        if (!isNonEmptyString(row[field])) errors.push(`${where} requires a non-empty ${field}`)
      }
      if (isNonEmptyString(row.officialPath)) {
        if (seenPath.has(row.officialPath)) errors.push(`${where} duplicates officialPath ${JSON.stringify(row.officialPath)}`)
        seenPath.add(row.officialPath)
        matrixPaths.add(row.officialPath)
      }
    }
  }

  // Every declared enforcement path must be registered in the matrix, and every
  // matrix path must be claimed by at least one inventory row (no ownerless path).
  const claimedPaths = new Set()
  for (const row of inventory.inventory ?? []) {
    for (const path of row.enforcementPaths ?? []) claimedPaths.add(path)
  }
  for (const path of claimedPaths) {
    if (!matrixPaths.has(path)) errors.push(`inventory claims enforcement path ${JSON.stringify(path)} which is not declared in enforcementMatrix`)
  }
  for (const path of matrixPaths) {
    if (!claimedPaths.has(path)) errors.push(`enforcementMatrix path ${JSON.stringify(path)} is not claimed by any inventory row`)
  }

  // -------------------------------------------------------------------------
  // Unregistered policy members: every current registry policy leaf must be
  // covered by an inventory row.
  // -------------------------------------------------------------------------
  for (const member of members) {
    if (member.runtime !== 'host' && member.runtime !== 'both') continue
    if (member.kind === 'handle') continue
    if (member.idiom !== 'policy') continue
    if (member.migrationAction !== null && member.migrationAction !== 'retain') continue
    if (!registeredPaths.has(member.publicPath)) {
      errors.push(`registry policy member ${JSON.stringify(member.publicPath)} has no inventory disposition`)
    }
  }

  // -------------------------------------------------------------------------
  // Gap records
  // -------------------------------------------------------------------------
  if (!Array.isArray(inventory.gaps)) {
    errors.push('policy inventory requires a gaps array')
  } else {
    const seenGaps = new Set()
    for (const [index, gap] of inventory.gaps.entries()) {
      const where = `gaps[${index}]`
      if (!isPlainRecord(gap)) {
        errors.push(`${where} must be an object`)
        continue
      }
      for (const field of GAP_FIELDS) {
        if (!hasField(gap, field)) errors.push(`${where} requires gap field ${field}; non-applicable fields carry an explicit null`)
      }
      if (!isNonEmptyString(gap.gapPath)) continue
      if (seenGaps.has(gap.gapPath)) errors.push(`${where} duplicates gapPath ${JSON.stringify(gap.gapPath)}`)
      seenGaps.add(gap.gapPath)
      // A common / approved-replacement-owned path must never be an edge gap.
      if (DENY_GAP_PREFIXES.some((prefix) => gap.gapPath === prefix || gap.gapPath.startsWith(`${prefix}.`) || gap.gapPath.startsWith(`${prefix}/`))) {
        errors.push(`${where}: ${JSON.stringify(gap.gapPath)} is a common or replacement-owned path and must not be recorded as an edge-path gap`)
      }
      // One path's gap must not generalize to a wider path.
      for (const other of inventory.gaps) {
        if (other === gap || !isNonEmptyString(other?.gapPath)) continue
        if (gap.gapPath.startsWith(`${other.gapPath}.`) || other.gapPath.startsWith(`${gap.gapPath}.`) || gap.gapPath.startsWith(`${other.gapPath}/`) || other.gapPath.startsWith(`${gap.gapPath}/`)) {
          errors.push(`${where}: gap paths must not nest (${gap.gapPath} vs ${other.gapPath}); one path's gap cannot generalize to another`)
        }
      }
      // failedChannels must explain each rejected implementation channel.
      if (!Array.isArray(gap.failedChannels) || gap.failedChannels.length === 0) {
        errors.push(`${where}.failedChannels must be a non-empty array explaining each rejected channel`)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Registry/inventory contradictions (no silent single-source selection)
  // -------------------------------------------------------------------------
  // A registry gap cluster that this feature plans to close must not already be
  // claimed automatic in the inventory.
  for (const row of capabilityMatrix) {
    if (row?.status === 'gap') {
      const rowForCluster = (inventory.inventory ?? []).find((r) => r.policyPath === row.capabilityCluster)
      if (rowForCluster && rowForCluster.coverageStatus === 'automatic') {
        errors.push(`inventory marks ${JSON.stringify(row.capabilityCluster)} automatic while the registry capabilityMatrix still records it as a gap`)
      }
    }
  }
  // llm.routing.health probe wording: the registry must not claim automatic
  // probe execution while the inventory records it as caller-driven.
  const healthRemovals = capabilityMatrix.find((row) => row?.capabilityCluster === 'llm.routing.health removals')
  if (healthRemovals && /automatic probe execution/i.test(`${healthRemovals.replacement ?? ''}`)) {
    errors.push('registry llm.routing.health removals still claims automatic probe execution; the inventory records probe execution as caller-driven')
  }

  return { ok: errors.length === 0, errors }
}

/* Direct CLI execution: `node scripts/policy-inventory-validate.mjs <registry.json> <inventory.json>` */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const { readFileSync } = await import('node:fs')
  const registryPath = process.argv[2]
  const inventoryPath = process.argv[3]
  if (!registryPath || !inventoryPath) {
    console.error('usage: node scripts/policy-inventory-validate.mjs <registry.json> <inventory.json>')
    process.exit(2)
  }
  let registry
  let inventory
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf8'))
    inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'))
  } catch (error) {
    console.error(`cannot read inputs: ${error.message}`)
    process.exit(2)
  }
  const result = validatePolicyInventory(registry, inventory)
  for (const error of result.errors) console.error(`- ${error}`)
  if (!result.ok) process.exit(1)
  console.log('policy inventory valid')
}
