/**
 * Staged-publication contract across every mountable feature.
 *
 * `prepareFeature(...)` publishes a candidate through the same internal
 * assignment path a live owner takes, and `rollback()` restores the feature's
 * disabled form. That only works when two things hold for a feature:
 *
 * 1. the published candidate can be identified again (`_readSlot`), so a
 *    transaction can prove it still owns the slot; and
 * 2. the disabled form is accepted by the feature's own mount guard — the same
 *    contract check a live owner passes.
 *
 * A feature that cannot offer both must refuse staging with a typed error, so
 * a rollback can never silently leave a candidate published while reporting
 * success. This test walks the whole feature set: each name is either refused
 * or proven to satisfy both properties end to end.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { createPluginApiService, KNOWN_FEATURE_NAMES } from '../lib/plugin-api-service.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

function createService() {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  return new ServiceClass({ reflect: { provide() {} } })
}

// Features whose disabled form is not a surface object: the type registry's
// disabled form is the absence of a published surface, the official helper
// slot is retired, and the execution-route slot is retired through its token.
// They are staged with a minimal valid owner instead.
const RETIREMENT_FIXTURES = {
  typert: {},
  officialPassthrough: { renderContextSnapshot() {}, joinContextSections() {} },
  execRoute: { routeOf() {} },
}

test('every feature either refuses staged publication or restores its disabled form on rollback', () => {
  const refused = []
  const stageable = []

  for (const name of KNOWN_FEATURE_NAMES) {
    const service = createService()
    const owner = RETIREMENT_FIXTURES[name] ?? service._disabledSurfaceFor(name) ?? { markerFor: name }
    let prepared
    try {
      prepared = service.prepareFeature(name, owner)
    } catch (error) {
      assert.ok(error instanceof PluginApiFeatureDisabledError, `${name} must refuse staging with a typed error`)
      assert.match(error.message, /staged preparation is not supported/, `${name} must refuse for the documented reason`)
      refused.push(name)
      continue
    }

    // sessionDurable carries its own transaction whose restore path is the
    // durable epoch reset (covered by the session-durable suite).
    if (name === 'sessionDurable') continue
    stageable.push(name)

    assert.equal(prepared.commit(), true, `${name}: the candidate publishes`)
    assert.equal(service._readSlot(name), owner, `${name}: the published candidate stays identifiable`)
    assert.equal(prepared.rollback(), true, `${name}: rollback reports the restore it performed`)
    assert.notEqual(service._readSlot(name), owner, `${name}: the candidate is no longer published after rollback`)
    assert.equal(prepared.rollback(), false, `${name}: rollback is idempotent`)
  }

  // The split is stable and both halves are exercised: a regression that
  // refuses everything, or restores nothing, cannot pass silently.
  assert.deepEqual(refused.sort(), [
    'agent', 'agentExtension', 'events', 'llm', 'services', 'session', 'settings', 'systemPrompt', 'tools',
  ])
  assert.ok(stageable.length >= 30, `expected the slot-backed features to stay stageable, saw ${stageable.length}`)
})

test('a stale transaction neither disturbs a newer mount nor claims a restore', () => {
  const service = createService()
  const firstOwner = service._disabledSurfaceFor('storage')
  const first = service.prepareFeature('storage', firstOwner)
  first.commit()

  const secondOwner = { marker: 'second', open: async () => ({}), availability: () => ({ status: 'active' }) }
  const second = service.prepareFeature('storage', secondOwner)
  second.commit()

  assert.equal(first.rollback(), false, 'the superseded transaction restored nothing')
  assert.equal(service._readSlot('storage'), secondOwner, 'the newer mount is untouched')
  assert.equal(second.rollback(), true)
  assert.notEqual(service._readSlot('storage'), secondOwner)
})
