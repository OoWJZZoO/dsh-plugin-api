import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { validatePolicyInventory } from '../scripts/policy-inventory-validate.mjs'
import { validateRegistry } from '../scripts/registry-validate.mjs'

const REGISTRY_PATH = fileURLToPath(new URL('../docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json', import.meta.url))
const INVENTORY_PATH = fileURLToPath(new URL('../docs/specs/plugin-api-policy-enforcement-closure/policy-inventory.json', import.meta.url))
const CAPABILITY_MATRIX_LIB_PATH = fileURLToPath(new URL('../lib/capability-matrix.js', import.meta.url))

const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))
const inventory = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'))

const INVENTORY_FIELDS = [
  'policyPath', 'registrationShape', 'primaryIdiom', 'policyOwner', 'componentOwner',
  'decisionVocabulary', 'reducer/conflictRule', 'defaultDecision', 'automaticDecisionPoint',
  'protectedAction', 'cooperativeInterface', 'observableEvidence', 'failureAndCancellation',
  'coverageStatus', 'verification', 'retirementCondition',
]
const COVERAGE_STATUSES = ['automatic', 'planned-automatic', 'cooperative-only', 'unavailable', 'named-gap']

test('the policy inventory validates cleanly against the canonical registry', () => {
  const result = validatePolicyInventory(registry, inventory)
  assert.deepEqual(result.errors, [], 'policy inventory must pass the pure validator')
  assert.equal(result.ok, true)
  const registryResult = validateRegistry(registry)
  assert.deepEqual(registryResult.errors, [], 'the registry must still validate cleanly')
})

test('every current registry policy leaf has exactly one inventory disposition', () => {
  const registered = new Set()
  for (const row of inventory.inventory) {
    registered.add(row.registrationShape)
    for (const member of row.registeredMembers ?? []) registered.add(member)
  }
  let covered = 0
  for (const member of registry.members) {
    if (member.runtime !== 'host' && member.runtime !== 'both') continue
    if (member.kind === 'handle') continue
    if (member.idiom !== 'policy') continue
    if (member.migrationAction !== null && member.migrationAction !== 'retain') continue
    assert.ok(registered.has(member.publicPath), `${member.publicPath} must appear in an inventory row`)
    covered += 1
  }
  assert.ok(covered >= 15, 'all 15 policy domains are inventoried')
})

test('every inventory row carries the complete field set with explicit nulls', () => {
  for (const [index, row] of inventory.inventory.entries()) {
    for (const field of INVENTORY_FIELDS) {
      assert.ok(field in row, `inventory[${index}].${field} must be present (explicit null allowed)`)
    }
    assert.ok(COVERAGE_STATUSES.includes(row.coverageStatus), `${row.policyPath}: coverageStatus is a closed disposition`)
    assert.ok(row.retirementCondition === null || typeof row.retirementCondition === 'string', `${row.policyPath}: retirementCondition is null unless a retained gap`)
  }
})

test('each policy disposition is closed: automatic rows are evidenced, cooperative-only rows expose an interface', () => {
  for (const row of inventory.inventory) {
    if (row.coverageStatus === 'automatic' || row.coverageStatus === 'planned-automatic') {
      assert.ok(Array.isArray(row.enforcementPaths) && row.enforcementPaths.length > 0, `${row.policyPath}: automatic disposition declares enforcement paths`)
      assert.ok(typeof row.automaticDecisionPoint === 'string' && row.automaticDecisionPoint.trim(), `${row.policyPath}: automatic disposition declares a decision point`)
    }
    if (row.coverageStatus === 'cooperative-only') {
      assert.ok(typeof row.cooperativeInterface === 'string' && row.cooperativeInterface.trim(), `${row.policyPath}: cooperative-only disposition exposes an interface`)
    }
  }
})

test('the enforcement matrix is closed in both directions', () => {
  const matrixPaths = new Set(inventory.enforcementMatrix.map((row) => row.officialPath))
  const claimed = new Set()
  for (const row of inventory.inventory) {
    for (const path of row.enforcementPaths ?? []) claimed.add(path)
  }
  for (const path of claimed) {
    assert.ok(matrixPaths.has(path), `claimed enforcement path ${path} must be declared in the matrix`)
  }
  for (const path of matrixPaths) {
    assert.ok(claimed.has(path), `matrix path ${path} must be claimed by an inventory row`)
  }
})

test('egress and recovery official paths are enumerated in the matrix', () => {
  const paths = inventory.enforcementMatrix.map((row) => row.officialPath)
  for (const expected of ['llm/provider', 'llm/modelDiscovery', 'mcp/stdio', 'mcp/http', 'web', 'subprocess', 'connection', 'telemetry']) {
    assert.ok(paths.includes(expected), `egress matrix must include ${expected}`)
  }
  for (const expected of ['recovery/model', 'recovery/tool', 'recovery/task', 'recovery/transaction']) {
    assert.ok(paths.includes(expected), `recovery matrix must include ${expected}`)
  }
})

test('s6 reclassification: the registry no longer claims automatic probe execution', () => {
  const healthRemovals = registry.capabilityMatrix.find((row) => row.capabilityCluster === 'llm.routing.health removals')
  assert.ok(healthRemovals, 'the llm.routing.health removals cluster exists')
  assert.ok(!/automatic probe execution/i.test(healthRemovals.replacement ?? ''), 'capabilityMatrix replacement must not claim automatic probe execution')
  const probeMapping = registry.oldToTargetMapping.find((entry) => entry.oldPath === 'llm.routing.health.probe')
  assert.ok(probeMapping, 'the probe oldToTargetMapping row exists')
  assert.ok(!/automatic probe execution/i.test(probeMapping.relation ?? ''), 'oldToTargetMapping relation must not claim automatic probe execution')
  const reclassified = inventory.reclassifiedShapes.find((row) => row.path.includes('llm.routing.health.probe'))
  assert.ok(reclassified, 'the inventory records the probe reclassification')
  assert.ok(/no facade automatic scheduler/i.test(reclassified.finding), 'the finding records the missing scheduler')
})

test('s6 reclassification: the generated capability matrix mirror stays in sync', () => {
  const libSource = readFileSync(CAPABILITY_MATRIX_LIB_PATH, 'utf8')
  assert.ok(!/automatic probe execution/i.test(libSource), 'lib/capability-matrix.js must not claim automatic probe execution')
  const healthRemovals = registry.capabilityMatrix.find((row) => row.capabilityCluster === 'llm.routing.health removals')
  const quoted = healthRemovals.replacement.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  assert.ok(libSource.includes(quoted), 'lib/capability-matrix.js replacement text mirrors the registry')
})

test('validator rejects an unregistered policy member', () => {
  const copy = structuredClone(inventory)
  copy.inventory = copy.inventory.filter((row) => row.policyPath !== 'security.egress')
  const result = validatePolicyInventory(registry, copy)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('has no inventory disposition')))
})

test('validator rejects an undeclared official protected path', () => {
  const copy = structuredClone(inventory)
  copy.inventory.find((row) => row.policyPath === 'security.egress').enforcementPaths = ['ghost/path']
  const result = validatePolicyInventory(registry, copy)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('not declared in enforcementMatrix')))
})

test('validator rejects an ownerless matrix path', () => {
  const copy = structuredClone(inventory)
  const row = copy.inventory.find((row) => row.policyPath === 'security.egress')
  row.enforcementPaths = row.enforcementPaths.slice(1)
  const result = validatePolicyInventory(registry, copy)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('not claimed by any inventory row')))
})

test('validator rejects a registration with no disposition', () => {
  const copy = structuredClone(inventory)
  copy.inventory.find((row) => row.policyPath === 'llm.routing.policies').coverageStatus = null
  const result = validatePolicyInventory(registry, copy)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('is not one of')))
})

test('validator rejects an overbroad coverage claim', () => {
  const copy = structuredClone(inventory)
  copy.inventory.find((row) => row.policyPath === 'tools.guard').automaticDecisionPoint = 'applies to all official paths'
  const result = validatePolicyInventory(registry, copy)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('overbroad coverage claim')))
})

test('validator rejects a gap record with missing fields', () => {
  const copy = structuredClone(inventory)
  copy.gaps = [{ gapPath: 'telemetry', component: 'dsh-session-telemetry-otel' }]
  const result = validatePolicyInventory(registry, copy)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('requires gap field')))
})

test('validator rejects a gap recorded for a common or replacement-owned path', () => {
  const copy = structuredClone(inventory)
  copy.gaps = [{
    gapPath: 'security.egress.web',
    component: 'dsh-web',
    trigger: 'provider fetch',
    protectedAction: 'outbound fetch',
    missingPreActionPoint: 'none',
    failedChannels: ['official binding'],
    observableConsequence: 'egress not consulted',
    affectedInstallationModes: 'all',
    evidence: 'none',
    retirementCondition: 'none',
  }]
  const result = validatePolicyInventory(registry, copy)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('must not be recorded as an edge-path gap')))
})

test('validator rejects a registry/inventory contradiction without silent selection', () => {
  const copy = structuredClone(registry)
  const healthRemovals = copy.capabilityMatrix.find((row) => row.capabilityCluster === 'llm.routing.health removals')
  healthRemovals.replacement = 'llm.routing.health.probe -> llm.routing.health.probe.register plus automatic probe execution'
  const result = validatePolicyInventory(copy, inventory)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('still claims automatic probe execution')))
})
