import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { validateRegistry } from '../scripts/registry-validate.mjs'

const REGISTRY_PATH = fileURLToPath(new URL('../docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json', import.meta.url))
const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))

function expectErrors(copy, ...fragments) {
  const result = validateRegistry(copy)
  assert.equal(result.ok, false, `expected the validator to reject: ${fragments.join(' ; ')}`)
  for (const fragment of fragments) {
    assert.ok(
      result.errors.some((error) => error.includes(fragment)),
      `expected an error containing ${JSON.stringify(fragment)}; got:\n${result.errors.map((e) => `  - ${e}`).join('\n')}`,
    )
  }
}

test('rejects a member whose capability cluster is absent from the capability matrix', () => {
  const copy = structuredClone(registry)
  copy.members.push({ ...structuredClone(copy.members[0]), publicPath: 'unregistered.leaf', capability: 'never-registered-cluster', runtime: 'host' })
  expectErrors(copy, 'absent from capabilityMatrix')
})

test('rejects a handle row without a registered parent member', () => {
  const copy = structuredClone(registry)
  copy.members.push({
    ...structuredClone(copy.members[0]),
    publicPath: 'orphan.namespace.handle',
    kind: 'handle',
    idiom: 'resourceRegistry',
    runtime: 'host',
    capability: 'llm',
  })
  expectErrors(copy, 'has no registered parent member')
})

test('rejects an idiom outside the closed vocabulary and a passthrough idiom outside services.*', () => {
  const copy = structuredClone(registry)
  copy.members[0].idiom = 'not-an-idiom'
  expectErrors(copy, 'not one of the eight idioms')
  const copy2 = structuredClone(registry)
  copy2.members[0].idiom = 'passthrough-exception'
  expectErrors(copy2, 'only valid on a services.* path')
})

test('rejects a services.* member carrying a standard idiom', () => {
  const copy = structuredClone(registry)
  const services = copy.members.find((m) => m.publicPath === 'services')
  services.idiom = 'selfDescription'
  expectErrors(copy, 'must use the passthrough-exception idiom')
})

test('rejects a compatibility alias: a rename that keeps the old path', () => {
  const copy = structuredClone(registry)
  const renamed = copy.members.find((m) => m.migrationAction === 'rename')
  renamed.targetPath = renamed.publicPath
  expectErrors(copy, 'must move to a different target path')
})

test('rejects generation/seq/epoch meaning bleed', () => {
  const copy = structuredClone(registry)
  copy.members[0].lifecycle = 'seq as fencing token for writes'
  expectErrors(copy, 'mixes the generation/seq/epoch meanings')
})

test('rejects a services.<key> member whose key is not in the audited whitelist', () => {
  const copy = structuredClone(registry)
  copy.members.push({
    ...structuredClone(copy.members[0]),
    publicPath: 'services.unaudited.member',
    idiom: 'passthrough-exception',
    targetPath: 'services.unaudited.member',
    runtime: 'host',
    capability: 'services',
  })
  expectErrors(copy, 'not in the audited servicesWhitelist')
})

test('rejects an idiom exception missing any of the six required fields', () => {
  const copy = structuredClone(registry)
  copy.members[0].idiomExceptions = [{ memberPath: 'x', baseContract: 'y', exception: 'z' }]
  expectErrors(copy, 'idiomExceptions[0] is missing')
})

test('rejects a namespace record with neither an availability member nor an exemption', () => {
  const copy = structuredClone(registry)
  copy.namespaces[0].availabilityMember = null
  copy.namespaces[0].availabilityExemption = null
  expectErrors(copy, 'needs an availabilityMember or a non-empty availabilityExemption')
})

test('rejects an availability leaf without a namespace navigation record', () => {
  const copy = structuredClone(registry)
  copy.namespaces = copy.namespaces.filter((r) => r.namespace !== 'coordination')
  expectErrors(copy, 'has no namespace navigation record')
})

test('rejects a compound conservation status inside the capability matrix', () => {
  const copy = structuredClone(registry)
  copy.capabilityMatrix[0].status = 'retained+deleted'
  expectErrors(copy, 'is not one of retained | renamed | merged | migrated | deleted | gap')
})

test('rejects a deleted cluster without a replacement or gap reason', () => {
  const copy = structuredClone(registry)
  const deleted = copy.capabilityMatrix.find((row) => row.status === 'deleted')
  deleted.replacement = null
  deleted.gapReason = null
  expectErrors(copy, 'needs a replacement or a gap reason')
})

test('rejects a member migrationAction that disagrees with the mapping action', () => {
  const copy = structuredClone(registry)
  const renamed = copy.members.find((m) => m.migrationAction === 'rename')
  const entry = copy.oldToTargetMapping.find((e) => e.oldPath === renamed.publicPath)
  entry.action = 'delete'
  expectErrors(copy, 'disagrees with oldToTargetMapping action')
})

test('rejects gap used as a migration action value', () => {
  const copy = structuredClone(registry)
  copy.members[0].migrationAction = 'gap'
  expectErrors(copy, 'is not in vocabulary.migrationAction')
  const copy2 = structuredClone(registry)
  copy2.vocabulary.migrationAction.push('gap')
  expectErrors(copy2, 'must not contain gap')
})

test('rejects a coordination lease handle that provides dispose()', () => {
  const copy = structuredClone(registry)
  const handle = copy.members.find((m) => m.idiom === 'coordination' && m.kind === 'handle')
  handle.lifecycle = 'lease credential; destruction through dispose()'
  expectErrors(copy, 'must not provide dispose()')
})

test('rejects a decision event without the three required extras', () => {
  const copy = structuredClone(registry)
  const decision = copy.eventCatalog.find((e) => e.eventSemantics === 'decision')
  delete decision.conflictConvergence
  expectErrors(copy, 'a decision event requires conflictConvergence')
})
