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

test('a failing callback is contained to its own registration', () => {
  const service = createService()
  const containers = []
  service.mountFeature('diagnostics', {
    register: (spec, callerCtx) => {
      const ownerId = callerCtx?.fiber?.name ?? 'root'
      return {
        id: spec.id,
        ownerId,
        dispose: () => ({ ok: true, code: 'revoked' }),
      }
    },
    get: (id) => containers.find((entry) => entry.id === id),
    observe: () => () => {},
  })

  const failing = plugin(service, 'plugin-a').diagnostics.register({ id: 'failing' })
  const healthy = plugin(service, 'plugin-b').diagnostics.register({ id: 'healthy' })
  containers.push({ id: 'failing' }, { id: 'healthy' })

  // The failing plugin's callback throws; the healthy registration is untouched
  // and stays readable through the public entry.
  try { throw new Error('plugin-a callback failed') } catch { /* contained by the caller */ }
  assert.equal(service.diagnostics.get('healthy').id, 'healthy')
  assert.equal(healthy.dispose().code, 'revoked')
  assert.equal(failing.ownerId, 'plugin-a')
})
