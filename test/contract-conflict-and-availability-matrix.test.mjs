/**
 * Conflict vocabulary and availability aggregation matrix.
 *
 * The conflict cases drive two synthetic owners through the provenance policy
 * registry: same owner + same id is latest-wins (the old handle goes stale and
 * cannot revoke the new resource), the same id under another owner is a typed
 * owner conflict. The availability cases drive the namespace decoration: a
 * domain token normalizes onto the three-value vocabulary with every detail
 * field kept, an unmapped token degrades with the token named, a detail-only
 * record falls back to its declared descriptor, and the disabled storage face
 * carries the same field set as the active one.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createContextEngine } from '../lib/context-engine.js'
import { createNamespaceAvailability } from '../lib/namespace-availability.js'
import { createDisabledStorageApi } from '../lib/storage-binding.js'
import { createDecisionParticipationFeature, createDisabledDecisionProviders } from '../lib/decision-participation-facade.js'

const caller = (name) => ({ fiber: { name } })

function makeEngine() {
  return createContextEngine({
    sources: {
      systemPrompt: { status: () => 'available' },
      sessionSurface: { status: () => 'available', verifySeqBounds: () => ({ ok: true }) },
      attachment: { status: () => 'unavailable' },
      toolExposure: { status: () => 'unavailable' },
      skillExposure: { status: () => 'unavailable' },
      compaction: { status: () => 'available' },
    },
    evidenceSource: { status: () => 'available' },
    now: () => new Date('2026-09-21T00:00:00.000Z'),
    sessionResolver: (sessionId) => ({ ok: true, sessionId }),
    reportDiagnostics: () => {},
  })
}

const policySpec = (id) => ({ id, priority: 'normal', decide: () => null })

test('conflict matrix: same owner + same id is latest-wins and the old handle goes stale', () => {
  const engine = makeEngine()
  const first = engine.policy.register(policySpec('matrix-policy'), caller('plugin-a'))
  const second = engine.policy.register(policySpec('matrix-policy'), caller('plugin-a'))
  assert.equal(first.dispose().code, 'stale', 'the superseded handle cannot revoke the new resource')
  assert.equal(second.dispose().code, 'revoked')
})

test('conflict matrix: the same id under another owner is a typed owner conflict', () => {
  const engine = makeEngine()
  engine.policy.register(policySpec('owner-policy'), caller('plugin-a'))
  assert.throws(
    () => engine.policy.register(policySpec('owner-policy'), caller('plugin-b')),
    (error) => error.code === 'PROVENANCE_POLICY_OWNER_CONFLICT',
  )
})

test('availability matrix: available normalizes to active with all domain detail kept', () => {
  const { decorate } = createNamespaceAvailability({ resolveFeatureStatus: () => true })
  const decorated = decorate(Object.freeze({
    availability: () => ({ status: 'available', scope: 'profile', durability: 'durable', epoch: 'epoch:1' }),
  }), ['coordination'])
  const view = decorated.availability()
  assert.equal(view.status, 'active')
  assert.equal(view.scope, 'profile')
  assert.equal(view.durability, 'durable')
  assert.equal(view.epoch, 'epoch:1')
})

test('availability matrix: an unmapped token degrades with the token named, never silently', () => {
  const { decorate } = createNamespaceAvailability({ resolveFeatureStatus: () => true })
  const decorated = decorate(Object.freeze({
    availability: () => ({ status: 'weird-token', epoch: 'epoch:2' }),
  }), ['coordination'])
  const view = decorated.availability()
  assert.equal(view.status, 'degraded')
  assert.match(view.reason, /weird-token/)
  assert.equal(view.epoch, 'epoch:2')
})

test('availability matrix: a detail-only domain record falls back to its declared descriptor', () => {
  const { decorate } = createNamespaceAvailability({ resolveFeatureStatus: () => true })
  const decorated = decorate(Object.freeze({
    availability: () => ({ sources: { jobs: 'available' }, epoch: 'epoch:3' }),
  }), ['coordination'])
  const view = decorated.availability()
  assert.equal(view.status, 'active')
  assert.deepEqual(view.sources, { jobs: 'available' })
  assert.equal(view.epoch, 'epoch:3')
})

test('availability matrix: the disabled storage face keeps the active field set including epoch', () => {
  const view = createDisabledStorageApi().availability()
  assert.equal(view.status, 'unavailable')
  assert.equal(typeof view.reason, 'string')
  assert.ok(Array.isArray(view.scope))
  assert.ok(view.durability)
  assert.ok(view.epoch)
})

/** The four decision-participation faces a namespace record names. */
const DECISION_FACES = ['agents', 'tools', 'prompts', 'events']

function decisionFeature(catalog) {
  return createDecisionParticipationFeature({
    ctx: { get() {} },
    eventsBus: {
      registerParticipation() { return { dispose() {} } },
      catalog() { return catalog },
    },
    logger: { error() {}, warn() {} },
  })
}

test('availability matrix: a decision face degrades on its unavailable point and names it', () => {
  // With no dispatch backing, every decision point behind every face is
  // unavailable: each face degrades and names the point, never claiming active.
  const feature = decisionFeature({})
  for (const face of DECISION_FACES) {
    const view = feature.providers[face](caller('plugin-a')).availability()
    assert.equal(Object.isFrozen(view), true)
    assert.equal(view.status, 'degraded', `${face} must not claim active without its backing`)
    assert.match(view.reason, /the decision point ".+" is unavailable/, `${face} must name the unavailable point`)
  }
  // A face whose single backing point resolves reports active and carries no
  // reason: the degradation is aggregation, not a blanket verdict.
  const live = decisionFeature({ 'system-prompt/assemble': {} })
  const prompts = live.providers.prompts(caller('plugin-a')).availability()
  assert.equal(prompts.status, 'active')
  assert.equal(prompts.reason, undefined)
  feature.disposer()
  live.disposer()
})

test('availability matrix: a namespace with no domain disclosure names what is unavailable', () => {
  // An active backing answers the bare verdict: there is nothing to explain.
  const active = createNamespaceAvailability({ resolveFeatureStatus: () => true })
  const activeView = active.decorate(Object.freeze({}), ['tools']).availability()
  assert.deepEqual(activeView, { status: 'active' })

  // A non-active backing always names what is unavailable, so a caller never
  // has to guess why the namespace is down.
  const inactive = createNamespaceAvailability({ resolveFeatureStatus: () => false })
  const inactiveView = inactive.decorate(Object.freeze({}), ['tools']).availability()
  assert.equal(inactiveView.status, 'unavailable')
  assert.equal(typeof inactiveView.reason, 'string')
  assert.match(inactiveView.reason, /tools/)

  // A partly active backing degrades and names the inactive part.
  const partly = createNamespaceAvailability({ resolveFeatureStatus: (feature) => feature !== 'settingsRemote' })
  const degradedView = partly.decorate(Object.freeze({}), ['settings']).availability()
  assert.equal(degradedView.status, 'degraded')
  assert.match(degradedView.reason, /settingsRemote/)
})

test('availability matrix: a domain record declaring a non-active state still names a reason', () => {
  const { decorate } = createNamespaceAvailability({ resolveFeatureStatus: () => true })
  // A standard token declared without a reason.
  const tokenView = decorate(Object.freeze({
    availability: () => ({ status: 'unavailable', epoch: 'epoch:9' }),
  }), ['coordination']).availability()
  assert.equal(tokenView.status, 'unavailable')
  assert.equal(typeof tokenView.reason, 'string')
  assert.equal(tokenView.epoch, 'epoch:9', 'the domain detail is still preserved')

  // A bare `active: false` marker, as the branch add-on publishes while its
  // replacement is absent.
  const markerView = decorate(Object.freeze({
    availability: () => ({ active: false, contract: false }),
  }), ['coordination']).availability()
  assert.equal(markerView.status, 'unavailable')
  assert.equal(typeof markerView.reason, 'string')
  assert.equal(markerView.contract, false)

  // An active verdict stays the bare verdict: no invented reason.
  const activeView = decorate(Object.freeze({
    availability: () => ({ status: 'active' }),
  }), ['coordination']).availability()
  assert.deepEqual(activeView, { status: 'active' })
})

test('availability matrix: an unmounted decision face reports unavailable with its own reason', () => {
  const disabled = createDisabledDecisionProviders()
  for (const face of DECISION_FACES) {
    const view = disabled[face]().availability()
    assert.equal(Object.isFrozen(view), true)
    assert.equal(view.status, 'unavailable')
    assert.equal(typeof view.reason, 'string')
    assert.ok(view.reason.length > 0)
  }
})
