import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { validateRegistry } from '../scripts/registry-validate.mjs'
import { buildSnapshots } from '../scripts/registry-snapshot.mjs'

const REGISTRY_PATH = fileURLToPath(new URL('../docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json', import.meta.url))
const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))

const IDIOMS = ['projection', 'policy', 'mutation', 'operation', 'contribution', 'resourceRegistry', 'coordination', 'selfDescription']
const MEMBER_FIELDS = [
  'publicPath', 'targetPath', 'capability', 'kind', 'idiom', 'idiomExceptions', 'eventSemantics',
  'semanticFace', 'effect', 'composition', 'runtime', 'implementationChannel', 'authority', 'scope',
  'resourceKey', 'identitySource', 'conflictRule', 'lifecycle', 'failureSemantics', 'idempotency',
  'retryLayer', 'availabilityShape', 'concurrency', 'reducer', 'currentShape', 'migrationAction',
  'status', 'verification',
]

test('every member carries the complete field set with explicit nulls', () => {
  for (const member of registry.members) {
    for (const field of MEMBER_FIELDS) {
      assert.ok(field in member, `${member.publicPath}.${field} must exist (explicit null when not applicable)`)
    }
  }
})

test('every member classifies into one primary idiom or the registered passthrough exception', () => {
  for (const member of registry.members) {
    const servicesRooted = member.publicPath === 'services' || member.publicPath.startsWith('services.')
    if (member.idiom === 'passthrough-exception') {
      const targetRooted = typeof member.targetPath === 'string' && (member.targetPath === 'services' || member.targetPath.startsWith('services.'))
      assert.ok(servicesRooted || targetRooted, `${member.publicPath}: passthrough-exception lives on a services.* path`)
    } else if (member.idiom !== null) {
      assert.ok(IDIOMS.includes(member.idiom), `${member.publicPath}: ${member.idiom} is one of the eight idioms`)
      assert.ok(!servicesRooted, `${member.publicPath}: services.* members use the passthrough exception, not an idiom`)
    } else {
      assert.ok(['delete', 'internalize'].includes(member.migrationAction), `${member.publicPath}: null idiom only for delete or internalize`)
    }
    assert.equal(member.semanticFace, null, `${member.publicPath}: semanticFace is not derived from idiom at registration time`)
  }
})

test('namespace navigation records cover the public namespace set with availability or exemption', () => {
  assert.ok(registry.namespaces.length >= 30, 'the namespace set is explicit')
  for (const record of registry.namespaces) {
    const hasAvailability = record.availabilityMember !== null
    const hasExemption = typeof record.availabilityExemption === 'string' && record.availabilityExemption.length > 0
    assert.ok(hasAvailability !== hasExemption, `${record.namespace}: availabilityMember or exemption, exactly one`)
    if (record.namespace.startsWith('services')) {
      assert.ok(hasExemption, `${record.namespace}: passthrough namespaces carry the exemption`)
    }
  }
})

test('every availability leaf maps to a namespace record and the closure is complete', () => {
  const namespaceSet = new Set(registry.namespaces.map((r) => `${r.runtime ?? 'host'}|${r.namespace}`))
  for (const member of registry.members) {
    if (!member.publicPath.endsWith('.availability')) continue
    if (member.publicPath.startsWith('services.')) continue
    const ns = member.publicPath.slice(0, -'.availability'.length)
    assert.ok(namespaceSet.has(`${member.runtime}|${ns}`), `${member.publicPath} needs a namespace navigation record`)
  }
})

test('capability clusters carry exactly one closed conservation status', () => {
  const STATUSES = ['retained', 'renamed', 'merged', 'migrated', 'deleted', 'gap']
  const QUALIFIERS = ['shape', 'split', 'reclassified', 'internalized']
  const clusters = new Set()
  for (const row of registry.capabilityMatrix) {
    assert.ok(!clusters.has(row.capabilityCluster), `cluster ${row.capabilityCluster} is unique`)
    clusters.add(row.capabilityCluster)
    assert.ok(STATUSES.includes(row.status), `${row.capabilityCluster}: ${row.status} is a closed conservation status`)
    assert.ok(!/\+/.test(row.status), `${row.capabilityCluster}: no compound label inside status`)
    for (const qualifier of row.qualifiers ?? []) {
      assert.ok(QUALIFIERS.includes(qualifier), `${row.capabilityCluster}: qualifier ${qualifier} is registered`)
    }
    if (row.status === 'deleted') {
      assert.ok(row.replacement !== null || row.gapReason !== null, `${row.capabilityCluster}: deletion has a replacement or gap reason`)
    }
    if (row.status === 'gap') {
      assert.ok(row.gapReason !== null, `${row.capabilityCluster}: gap states the missing capability property`)
      assert.equal(row.currentPaths.length, 0, `${row.capabilityCluster}: gap is not represented by current leaves`)
    }
    if (['renamed', 'merged', 'migrated'].includes(row.status)) {
      assert.ok(row.targetPaths.length > 0, `${row.capabilityCluster}: ${row.status} has target paths`)
    }
  }
})

test('member migration actions agree with the current-to-target mapping', () => {
  const mapping = new Map(registry.oldToTargetMapping.map((e) => [e.oldPath, e]))
  for (const member of registry.members) {
    if (member.migrationAction === null) continue
    const entry = mapping.get(member.publicPath)
    assert.ok(entry, `${member.publicPath}: ${member.migrationAction} has a mapping entry`)
    assert.equal(entry.action, member.migrationAction, `${member.publicPath}: mapping action agrees with the member record`)
  }
})

test('event catalog separates semantics, authority, and dispatch with decision extras', () => {
  const SEMANTICS = ['decision', 'fact', 'observation', 'notification']
  for (const event of registry.eventCatalog) {
    assert.ok(SEMANTICS.includes(event.eventSemantics), `${event.name}: registered event semantics`)
    assert.ok(event.producerAuthority, `${event.name}: producer authority recorded`)
    if (event.eventSemantics === 'decision') {
      for (const field of ['decisionPrecedence', 'conflictConvergence', 'listenerFailureDefault']) {
        assert.ok(event[field], `${event.name}: decision event declares ${field}`)
      }
    } else {
      assert.equal(event.decisionPrecedence, undefined, `${event.name}: decision extras reserved for decision events`)
    }
  }
})

test('coordination members use the asynchronous lease contract', () => {
  for (const member of registry.members) {
    if (member.idiom !== 'coordination') continue
    if (member.kind !== 'handle') continue
    assert.ok(member.lifecycle.includes('release(handle)'), `${member.publicPath}: give-back is the entry verb release(handle)`)
    assert.ok(!member.lifecycle.includes('dispose()'), `${member.publicPath}: the lease handle provides no dispose()`)
  }
})

test('snapshots group members by idiom, handles, and migration actions from the same registry', () => {
  const snapshots = buildSnapshots(registry)
  const grouped = Object.values(snapshots.idiomGroups).reduce((sum, list) => sum + list.length, 0)
  const classified = registry.members.filter((m) => m.idiom !== null).length
  assert.equal(grouped, classified, 'idiom groups cover every classified member')
  assert.equal(snapshots.handleMembers.length, registry.members.filter((m) => m.kind === 'handle').length, 'handle snapshot covers every handle row')
  const diffActions = new Set(Object.keys(snapshots.migrationDiff.byAction))
  for (const member of registry.members) {
    if (member.migrationAction === null) continue
    assert.ok(diffActions.has(member.migrationAction), `migration diff carries action ${member.migrationAction}`)
  }
  assert.equal(snapshots.capabilityStatus.clusters.length, registry.capabilityMatrix.length, 'capability status mirrors the matrix')
})

test('dispatch members register identity and retry as not applicable', () => {
  const dispatchPaths = ['events.emit', 'events.serial', 'events.parallel', 'events.bail', 'events.waterfall']
  const rows = registry.members.filter((member) => dispatchPaths.includes(member.publicPath))
  assert.equal(rows.length, dispatchPaths.length, 'all five dispatch members are registered')
  for (const member of rows) {
    assert.equal(member.idiom, 'operation', `${member.publicPath}: dispatch is the operation dispatch variant`)
    assert.equal(member.identitySource, null, `${member.publicPath}: no independent operation identity`)
    assert.equal(member.retryLayer, null, `${member.publicPath}: never retried`)
    assert.match(member.lifecycle, /no independent operation identity/i, `${member.publicPath}: records why identity is not applicable`)
    assert.match(member.lifecycle, /never retried/i, `${member.publicPath}: records why retry is not applicable`)
  }
})

test('the projection observe entry and its handle row are registered with the parent', () => {
  for (const member of registry.members) {
    if (member.runtime !== 'host' || !['events.observe', 'events.observe.handle'].includes(member.publicPath)) continue
    assert.equal(member.idiom, 'projection', `${member.publicPath}: projection subscription`)
    assert.equal(member.targetPath, member.publicPath, `${member.publicPath}: target path is self`)
    assert.equal(member.migrationAction, null, `${member.publicPath}: new target leaf without a current counterpart`)
    assert.equal(member.scope, 'facade')
  }
  const leaf = registry.members.find((m) => m.publicPath === 'events.observe' && m.runtime === 'host')
  const handle = registry.members.find((m) => m.publicPath === 'events.observe.handle' && m.runtime === 'host')
  assert.ok(leaf && handle, 'both the observe leaf and its handle row must exist')
})

test('gap resolution records the unavailable owner-scoped publisher as the only gap', () => {
  const gaps = registry.capabilityMatrix.filter((row) => row.status === 'gap')
  assert.equal(gaps.length, 1, 'exactly one capability gap is carried')
  assert.match(gaps[0].capabilityCluster, /events\.define/, 'the gap is the owner-scoped custom event publisher')
})
