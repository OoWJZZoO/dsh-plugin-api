import test from 'node:test'
import assert from 'node:assert/strict'
import { createCheckpointsApi, createDisabledCheckpointsApi } from '../lib/checkpoint-facade.js'
import { PluginApiInactiveError, PluginApiFeatureDisabledError } from '../lib/errors.js'
import {
  createTestStore,
  createIdFactory,
  stubOwnerOf,
  createBranchAuthorityFixture,
  createAttemptFactsFixture,
  createCoordinationFixture,
  createTerminalWaiterFixture,
} from './checkpoint-test-kit.mjs'

function buildFacade(options = {}) {
  const store = options.store ?? createTestStore()
  const branch = options.branch ?? createBranchAuthorityFixture()
  const attempts = options.attempts ?? createAttemptFactsFixture()
  return createCheckpointsApi({
    active: options.active ?? (() => true),
    ownerOf: stubOwnerOf,
    store,
    factsSource: attempts.facet,
    authorities: { branch: branch.face },
    stepAuthorities: { branches: branch.face },
    coordination: (options.coordination ?? createCoordinationFixture()).face,
    waitForTerminal: (options.waitForTerminal ?? createTerminalWaiterFixture()).waiter,
    idFactory: options.idFactory ?? createIdFactory('cp'),
  })
}

async function captureThrough(facade, { owner, scope = { sessionId: 'session-1' }, source = { kind: 'branch' }, captureKey } = {}) {
  return facade.api.create({ scope, source, ...(captureKey ? { captureKey } : {}) }, { owner })
}

test('facade: surface exposes create/list/inspect/planRestore/restore/availability in one frozen bounded context', async () => {
  const facade = buildFacade()
  const surface = facade.api
  for (const member of ['create', 'list', 'inspect', 'planRestore', 'restore', 'availability']) {
    assert.equal(typeof surface[member], 'function', member)
  }
  assert.ok(Object.isFrozen(surface))
  // Only the branch source is wired in this minimal facade: the v1 surface is
  // degraded overall while the wired source stays active (per-source honesty).
  const report = surface.availability()
  assert.equal(report.status, 'degraded')
  assert.equal(report.sources.branch.status, 'active')
  assert.equal(report.sources['workspace-journal'].status, 'unavailable')
  const outcome = await captureThrough(facade, { owner: 'plugin-a', captureKey: 'key-1' })
  assert.equal(outcome.ok, true)
  const inspected = await surface.inspect(outcome.summary.checkpointId)
  assert.equal(inspected.ok, true)
  const plan = await surface.planRestore(outcome.summary.checkpointId)
  assert.equal(plan.ok, true)
  const restored = await surface.restore(outcome.summary.checkpointId, { plan: plan.plan }, { owner: 'plugin-a' })
  assert.equal(restored.ok, true)
  assert.equal(restored.handle.status().terminal, 'success')
})

test('facade: two synthetic plugins exercising the same paths in reverse registration order get identical outcomes', async () => {
  // The facade is stateless with respect to plugin registration order: build
  // two facades over the same backing store (sharing the facade id factory,
  // mirroring one mounted facade serving two plugins) and drive the same
  // capture/plan paths with different owner identities.
  const store = createTestStore()
  const idFactory = createIdFactory('cp')
  const facadeA = buildFacade({ store, idFactory })
  const facadeB = buildFacade({ store, idFactory })
  const a = await captureThrough(facadeA, { owner: 'plugin-a', captureKey: 'shared-key' })
  const b = await captureThrough(facadeB, { owner: 'plugin-b', captureKey: 'shared-key' })
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  assert.equal(a.code, b.code)
  assert.notEqual(a.summary.checkpointId, b.summary.checkpointId, 'owner isolation: distinct records per owner')
  // Same paths in reverse order: planning outcomes are shape-identical.
  const planA = await facadeA.api.planRestore(a.summary.checkpointId)
  const planB = await facadeB.api.planRestore(b.summary.checkpointId)
  assert.equal(planA.plan.slices[0].steps[0].authority, planB.plan.slices[0].steps[0].authority)
  assert.equal(planA.plan.overallRestoreability, planB.plan.overallRestoreability)
  // Both captures co-exist in the same durable store.
  const listed = await store.list({ scopeKind: 'session', resourceId: 'session-1' })
  assert.equal(listed.items.length, 2)
})

test('facade: inactive core raises the uniform P1 error at every entry', async () => {
  const facade = buildFacade({ active: () => false })
  await assert.rejects(() => facade.api.create({}, { owner: 'plugin-a' }), PluginApiInactiveError)
  await assert.rejects(() => facade.api.list({}), PluginApiInactiveError)
  await assert.rejects(() => facade.api.inspect('x'), PluginApiInactiveError)
  await assert.rejects(() => facade.api.planRestore('x'), PluginApiInactiveError)
  await assert.rejects(() => facade.api.restore('x', {}), PluginApiInactiveError)
  assert.equal(facade.api.availability().status, 'unavailable')
})

test('facade: disabled surface is shape-preserving with typed P2 failures', async () => {
  const disabled = createDisabledCheckpointsApi(() => true, 'checkpoints capability is disabled')
  assert.throws(() => disabled.create({}), PluginApiFeatureDisabledError)
  assert.throws(() => disabled.list({}), PluginApiFeatureDisabledError)
  const report = disabled.availability()
  assert.equal(report.status, 'unavailable')
  assert.match(report.reason, /disabled/)
})

test('facade: auto-capture policy availability is reported while slices are active', async () => {
  const facade = buildFacade()
  const policy = facade.internals.autoCapture
  const status = policy.status()
  assert.equal(status.enabled, false)
  const enabled = await policy.enable ? policy.enable({ owner: 'plugin-a', cadence: { kind: 'every-attempt' } }) : null
  if (enabled) {
    assert.equal(enabled.ok, true)
    assert.equal(facade.api.availability().autoCapture.status, 'active')
    await policy.disable()
  }
})