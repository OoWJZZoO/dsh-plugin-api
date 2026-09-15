/**
 * Dual-plugin composition acceptance.
 *
 * Two synthetic plugins drive one facade through public entries only. The
 * scenarios mirror the composition contract: load order never decides who owns
 * a registration, a clash is a typed conflict rather than a silent overwrite,
 * unloading one plugin cannot disturb the other, an old handle can never revoke
 * a newer resource, and one plugin's failing callback stays contained.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'
import { createDiagnosticsOwner } from '../lib/diagnostics.js'

function createService() {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  return new ServiceClass({ reflect: { provide() {} } })
}

/** A caller-bound view of the facade for one synthetic plugin fiber. */
function plugin(service, name) {
  const fiber = { name }
  const ctx = { fiber, loader: { entries: () => [{ fiber, options: { name } }] } }
  const shadow = Object.create(service)
  Object.defineProperty(shadow, 'ctx', { value: ctx, enumerable: true, configurable: true })
  return shadow
}

function mountConflictFamily(service, seen) {
  service.mountFeature('llm/request', {
    transform: (spec, callerCtx) => {
      const owner = callerCtx?.fiber?.name
      seen.push({ owner, id: spec.id })
      return { id: spec.id, ok: true }
    },
  })
}

test('load order never decides ownership: the later plugin cannot claim the earlier registration', () => {
  const service = createService()
  const seen = []
  mountConflictFamily(service, seen)
  const a = plugin(service, 'plugin-a')
  const b = plugin(service, 'plugin-b')

  // B takes its view first, A registers, then B registers under the same id.
  const viewB = b.llm.requestTransforms
  const viewA = a.llm.requestTransforms
  viewA.register({ id: 'shared-id' })
  viewB.register({ id: 'shared-id' })

  assert.deepEqual(seen, [{ owner: 'plugin-a', id: 'shared-id' }, { owner: 'plugin-b', id: 'shared-id' }],
    'each registration carries its own caller identity regardless of read order')
})

test('two plugins on one key keep separate registrations and separate handles', () => {
  const service = createService()
  const revoked = []
  service.mountFeature('diagnostics', {
    register: (spec, callerCtx) => {
      const ownerId = callerCtx?.fiber?.name ?? 'root'
      const record = { id: spec.id, ownerId }
      let released = false
      return {
        id: spec.id,
        ownerId,
        dispose() {
          if (released) return { ok: false, code: 'stale', reason: 'the registration is already released' }
          released = true
          revoked.push(record)
          return { ok: true, code: 'revoked' }
        },
      }
    },
    get: () => undefined,
    observe: () => () => {},
  })

  const handleA = plugin(service, 'plugin-a').diagnostics.register({ id: 'check-1' })
  const handleB = plugin(service, 'plugin-b').diagnostics.register({ id: 'check-1' })
  assert.equal(handleA.ownerId, 'plugin-a')
  assert.equal(handleB.ownerId, 'plugin-b')

  // Unloading A releases only A's registration.
  assert.equal(handleA.dispose().code, 'revoked')
  assert.deepEqual(revoked, [{ id: 'check-1', ownerId: 'plugin-a' }], 'only the released owner is touched')
  assert.equal(handleA.dispose().code, 'stale', 'the released handle is a typed stale no-op')
  assert.equal(handleB.dispose().code, 'revoked')
})

test('a stale handle never revokes the newer resource', () => {
  const service = createService()
  const live = []
  service.mountFeature('diagnostics', {
    register: (spec, callerCtx) => {
      const ownerId = callerCtx?.fiber?.name ?? 'root'
      const record = { id: spec.id, ownerId }
      live.push(record)
      return {
        id: spec.id,
        ownerId,
        dispose() {
          const index = live.indexOf(record)
          if (index === -1) return { ok: false, code: 'stale', reason: 'the resource is already released' }
          live.splice(index, 1)
          return { ok: true, code: 'revoked' }
        },
      }
    },
    get: () => undefined,
    observe: () => () => {},
  })

  const first = plugin(service, 'plugin-a').diagnostics.register({ id: 'check-1' })
  assert.equal(first.dispose().code, 'revoked')
  const second = plugin(service, 'plugin-a').diagnostics.register({ id: 'check-1' })
  assert.equal(first.dispose().code, 'stale', 'the released handle stays released')
  assert.deepEqual(live, [{ id: 'check-1', ownerId: 'plugin-a' }], 'the newer resource survives the stale disposer')
  assert.equal(second.dispose().code, 'revoked')
})

test('a failing check callback is contained to its own registration', async () => {
  const service = createService()
  // The real diagnostics owner: the facade is what invokes the contributed
  // checks, so this is the boundary that has to contain a throwing callback.
  const owner = createDiagnosticsOwner({ coreActive: () => true })
  service.mountFeature('diagnostics', owner.api)
  try {
    const failing = plugin(service, 'plugin-a').diagnostics.register({
      checkId: 'failing',
      scope: 'host',
      run() { throw new Error('plugin-a callback failed') },
    })
    const healthy = plugin(service, 'plugin-b').diagnostics.register({
      checkId: 'healthy',
      scope: 'host',
      run: () => ({ health: 'healthy', availability: 'active', severity: 'info', blocking: 'non-blocking' }),
    })
    assert.equal(failing.ownerId, 'plugin-a')
    assert.equal(healthy.ownerId, 'plugin-b')
    await settle()

    // The throwing check settles as a failed report instead of escaping the
    // facade, and the other plugin's check keeps its own real result.
    const view = service.diagnostics.get({ scope: 'host' })
    const byCheck = new Map(view.checks.map((check) => [check.checkId, check]))
    assert.equal(byCheck.get('failing').health, 'failed', 'the failing check is reported, not rethrown')
    assert.equal(byCheck.get('failing').reason.code, 'probe-failed', 'the report names the probe failure')
    assert.equal(byCheck.get('failing').ownerId, 'plugin-a')
    assert.equal(byCheck.get('healthy').health, 'healthy', 'the healthy check keeps its own result')
    assert.equal(byCheck.get('healthy').availability, 'active')
    assert.equal(byCheck.get('healthy').ownerId, 'plugin-b')

    // Unloading the failing plugin leaves the healthy registration readable and
    // releasable: containment is per registration, not per scope.
    assert.equal(failing.dispose().code, 'revoked')
    await settle()
    const afterRelease = service.diagnostics.get({ scope: 'host' })
    const remaining = afterRelease.checks.filter((check) => check.checkId !== 'plugin-api-facade').map((check) => check.checkId)
    assert.deepEqual(remaining, ['healthy'], 'only the released check is gone')
    assert.equal(afterRelease.state, 'healthy', 'the scope state follows the surviving check')
    assert.equal(healthy.dispose().code, 'revoked')
  } finally {
    owner.dispose()
  }
})

async function settle() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}
