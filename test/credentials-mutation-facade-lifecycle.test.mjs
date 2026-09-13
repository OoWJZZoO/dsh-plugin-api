/**
 * Facade lifecycle acceptance for the credential mutation face: the typed
 * disabled surface, the inert-core presentation, the degraded fact-stream
 * state and the unmount rollback — the same presentation contract the sibling
 * mutation lines verify.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createHarness } from './credentials-mutation-test-kit.mjs'
import { createCredentialMutationFeature } from '../lib/credentials-mutation-facade.js'
import { createFeatureRegistry } from '../lib/feature-registry.js'

const REF = 'DSH_LIFECYCLE_PROBE'

test('an unmounted feature returns typed results and never removes the namespace', async () => {
  const kit = await createHarness({ noFeature: true })
  try {
    const face = kit.root.pluginApi.credentials
    assert.ok(face, 'the namespace stays published')
    assert.deepEqual({ ...face.availability() }, {
      status: 'unavailable',
      reason: 'the credentials feature is not mounted in this installation',
    })
    assert.deepEqual({ ...(await face.set(REF, 'v1')) }, {
      ok: false,
      code: 'unavailable',
      reason: 'the credentials feature is not mounted in this installation',
    })
    assert.equal((await face.unset(REF)).code, 'unavailable')
  } finally {
    await kit.cleanup()
  }
})

test('an inert core keeps the member present, throws on operations and never throws on availability', async () => {
  const kit = await createHarness()
  try {
    const previous = process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
    process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = '1'
    try {
      kit.service.reconcile({ registry: kit.service._registry, coreActive: () => false })
      assert.equal(kit.service.isActive, false)
      const face = kit.root.pluginApi.credentials
      assert.ok(face, 'the member never disappears while the core is inert')
      assert.deepEqual({ ...face.availability() }, {
        status: 'unavailable',
        reason: 'the credentials feature is not mounted in this installation',
      })
      // The disabled face gates synchronously: the inactive-core error is
      // thrown before any promise is produced.
      const inactive = (error) => error?.name === 'PluginApiInactiveError'
      assert.throws(() => face.set(REF, 'v1'), inactive)
      assert.throws(() => face.unset(REF), inactive)
    } finally {
      if (previous === undefined) delete process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
      else process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = previous
    }
  } finally {
    await kit.cleanup()
  }
})

test('a missing fact stream degrades revision tracking alone', async () => {
  const kit = await createHarness()
  try {
    // A context whose event substrate refuses subscriptions; everything else
    // resolves through the real root.
    const hostile = new Proxy(kit.root, {
      get(target, property) {
        if (property === 'on') return () => { throw new Error('no event substrate') }
        if (property === 'get') return (name) => target.get(name)
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const registry = createFeatureRegistry()
    const feature = createCredentialMutationFeature({ ctx: hostile, service: kit.service, logger: { warn() {} } })
    kit.service.mountFeature('credentials', feature.api)
    registry.mount('credentials')

    const face = kit.root.pluginApi.credentials
    assert.equal(face.availability().status, 'degraded')
    assert.match(face.availability().reason, /fact stream/)
    const written = await face.set(REF, 'v1')
    assert.equal(written.code, 'committed', 'the write face still commits')
    assert.equal(written.revision, undefined, 'no marker was observed from the missing fact stream')
    feature.disposer()
  } finally {
    await kit.cleanup()
  }
})

test('unmounting retires the slot and stops marker propagation', async () => {
  const kit = await createHarness()
  try {
    const face = kit.root.pluginApi.credentials
    await face.set(REF, 'v1')
    const subscriptionsBefore = kit.subscriptions.filter((entry) => entry.active).length

    // The assembly's unload sequence: slot rollback, then owner cleanup.
    assert.equal(kit.prepared.rollback(), true)
    const after = kit.root.pluginApi.credentials
    assert.equal(after.availability().status, 'unavailable')
    assert.equal((await after.set(REF, 'v2')).code, 'unavailable')

    const before = kit.feature.authority.revisionOf(REF)
    assert.equal(before.known, true, 'the committed write was observed before teardown')
    kit.feature.disposer()
    const activeAfter = kit.subscriptions.filter((entry) => entry.active).length
    assert.equal(activeAfter, subscriptionsBefore - 1, 'the feature-owned fact subscription is released')
    // Facts arriving after teardown cannot advance the retired authority: the
    // marker stays exactly as it was (an "advanced" marker would be known, and
    // an invalidated one would carry invalid: true).
    kit.feature.authority.observeUpdated(REF)
    assert.deepEqual({ ...kit.feature.authority.revisionOf(REF) }, { known: false, invalid: false }, 'a retired authority keeps no marker at all')
  } finally {
    await kit.cleanup()
  }
})
