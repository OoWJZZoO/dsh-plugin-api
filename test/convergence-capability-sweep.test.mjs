/**
 * Member-level capability self-description sweep.
 *
 * Every capability namespace the registry records must publish an availability
 * member that is a `selfDescription` leaf, must be reachable through the
 * runtime availability table, and must never be reported active on the strength
 * of an object existing. The sweep runs over the registry so a new namespace
 * cannot be added without its self-description.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { HOST_NAMESPACE_RECORDS } from '../lib/namespace-availability.js'

const registry = JSON.parse(readFileSync(
  resolve(import.meta.dirname, '../docs/specs/plugin-api-m7-public-contract-refactor/public-contract.registry.json'),
  'utf8',
))

const availabilityNamespaces = (registry.namespaces ?? []).filter((record) => record.availabilityMember !== null)

test('every namespace publishes a selfDescription availability member', () => {
  assert.equal(availabilityNamespaces.length >= 40, true, 'the registry records the namespace inventory')
  for (const record of availabilityNamespaces) {
    const member = (registry.members ?? []).find(
      (entry) => entry.publicPath === record.availabilityMember && (entry.runtime ?? 'host') === (record.runtime ?? 'host'),
    )
    assert.ok(member, `${record.namespace} publishes ${record.availabilityMember}`)
    assert.equal(member.idiom, 'selfDescription', `${record.availabilityMember} is a selfDescription member`)
    assert.equal(typeof member.availabilityShape, 'string', `${record.availabilityMember} declares its availability shape`)
  }
})

test('the runtime availability table covers every host registry namespace', () => {
  const inheritedFrom = []
  for (const record of availabilityNamespaces.filter((entry) => (entry.runtime ?? 'host') === 'host')) {
    // The runtime table tracks namespace-level availability; a leaf capability
    // (e.g. `sessions.request`) inherits its containing namespace's record.
    const segments = record.capabilityPath.split('.')
    const candidates = segments.map((_, index) => segments.slice(0, segments.length - index).join('.'))
    const direct = HOST_NAMESPACE_RECORDS[record.capabilityPath]
    const mapped = direct ?? candidates.slice(1).map((path) => HOST_NAMESPACE_RECORDS[path]).find((entry) => entry !== undefined)
    assert.ok(mapped, `${record.capabilityPath} resolves through the runtime availability table (directly or via its namespace)`)
    assert.equal(typeof mapped.path, 'string', `${record.capabilityPath} resolves to a leaf path`)
    if (direct === undefined) {
      // Inheriting from an ancestor is legitimate only for leaf capabilities;
      // record the exemption so a drifting table cannot hide behind it.
      inheritedFrom.push(record.capabilityPath)
    }
  }
  assert.equal(inheritedFrom.length <= 3, true, `at most a few leaf capabilities inherit their namespace record: ${inheritedFrom.join(', ')}`)
  assert.equal(Object.keys(HOST_NAMESPACE_RECORDS).length >= 30, true, 'the runtime table carries the host namespace inventory')
})

test('availability never reports active from an object existing alone', async () => {
  // The deployed shape: a namespace assembled from a ctx that carries no
  // official service reports every face as disabled — never active, never
  // fabricated.
  const { SERVICE_DEFINITIONS, buildActiveFacade, createServicesNamespace } = await import('../lib/services.js')
  const assembled = createServicesNamespace({ get: () => undefined }, { coreActive: true })
  for (const definition of SERVICE_DEFINITIONS) {
    assert.equal(assembled[definition.key].isActive, false, `${definition.key} is not active without its official service`)
    const required = definition.members.filter((member) => member.optional !== true)
    // The member-level shape: a present service with an absent member is the
    // one deliberate exception (`optional`), and it is stated as such.
    const presentService = required.length === 0 ? buildActiveFacade(definition, {}, {}, true) : null
    if (presentService !== null) {
      assert.equal(presentService.isActive, true, `${definition.key} stays active: every member is optional`)
      assert.equal(definition.members.every((member) => !(member.name in presentService)), true, `${definition.key} fabricates no member`)
    }
  }
})

test('absence is a typed degradation, never a business refusal code', async () => {
  const { SERVICE_DEFINITIONS, buildDisabledFacade } = await import('../lib/services.js')
  const { PluginApiFeatureDisabledError } = await import('../lib/errors.js')
  const { AVAILABILITY_STATUSES } = await import('../lib/namespace-availability.js')
  const { REQUEST_OUTCOME_CODES, CANCEL_OUTCOME_CODES } = await import('../lib/session-interaction-operation-normalize.js')
  const { PLAN_MODE_OUTCOME_CODES } = await import('../lib/sessions-plan-mode.js')
  const { RESPOND_OUTCOME_CODES } = await import('../lib/sessions-interactions.js')
  const { SELECTION_OUTCOME_CODES } = await import('../lib/sessions-selection.js')

  // 1) Per face, every declared member reports a missing carrier through the
  //    typed-disabled channel: absence never surfaces as a business answer.
  for (const definition of SERVICE_DEFINITIONS) {
    const disabled = buildDisabledFacade(definition, () => true, 'missing carrier')
    for (const member of definition.members) {
      assert.throws(
        () => disabled[member.name](),
        (error) => error instanceof PluginApiFeatureDisabledError && error.code === 'PLUGIN_API_FEATURE_DISABLED',
        `${definition.key}.${member.name} reports its missing carrier as a typed degradation`,
      )
    }
  }

  // 2) The vocabularies stay separate: `unavailable` is the single shared
  //    absence marker, while the availability statuses never appear as a
  //    business refusal and the typed-disabled code is not an outcome code.
  const businessCodes = new Set([
    ...REQUEST_OUTCOME_CODES, ...CANCEL_OUTCOME_CODES, ...PLAN_MODE_OUTCOME_CODES,
    ...RESPOND_OUTCOME_CODES, ...SELECTION_OUTCOME_CODES,
  ])
  assert.equal(businessCodes.has('PLUGIN_API_FEATURE_DISABLED'), false, 'the degradation code is not an outcome code')
  for (const status of AVAILABILITY_STATUSES) {
    if (status === 'unavailable') continue
    assert.equal(businessCodes.has(status), false, `availability status ${status} is not reused as a business refusal`)
  }
  assert.equal(businessCodes.has('unavailable'), true, 'the absence marker is spelled the same everywhere, never as a refusal')
})
