import test from 'node:test'
import assert from 'node:assert/strict'
import { createServicesNamespace, SERVICE_DEFINITIONS, SERVICES_NAMESPACE_KEYS } from '../lib/services.js'

function completeService(def) {
  const svc = {}
  for (const member of def.members) {
    if (member.kind === 'method') svc[member.name] = () => {}
    else if (member.kind === 'getter') {
      Object.defineProperty(svc, member.name, { enumerable: true, get() { return null } })
    }
  }
  return svc
}

function fullCtx(overrides = {}) {
  const byService = {}
  for (const def of SERVICE_DEFINITIONS) byService[def.ctxService] = completeService(def)
  const get = (name) => {
    if (overrides.get) return overrides.get(name, byService)
    return byService[name]
  }
  return { get }
}

const URI_HELPERS = {
  encodeSessionReferenceUri: () => 'encoded',
  decodeSessionReferenceUri: () => ({}),
}

test('namespace exposes exactly the 18 keys and nothing else', () => {
  const services = createServicesNamespace({ ctx: fullCtx(), active: true, uriHelpers: URI_HELPERS })
  assert.deepEqual(Object.keys(services), SERVICES_NAMESPACE_KEYS)
  assert.equal(Object.keys(services).length, 18)
  assert.ok(!('compaction' in services))
})

test('namespace and every facade are frozen (read-only at runtime)', () => {
  const services = createServicesNamespace({ ctx: fullCtx(), active: true, uriHelpers: URI_HELPERS })
  assert.ok(Object.isFrozen(services))
  for (const key of SERVICES_NAMESPACE_KEYS) {
    assert.ok(Object.isFrozen(services[key]), `${key} facade frozen`)
    assert.equal(services[key].isActive, true)
  }
})

test('facade values are observably disabled per service when one official service is missing', () => {
  const missing = 'fs'
  const services = createServicesNamespace({
    ctx: fullCtx({
      get(name, byService) {
        if (name === missing) return undefined
        return byService[name]
      },
    }),
    active: true,
    uriHelpers: URI_HELPERS,
  })

  assert.equal(services.fs.isActive, false)
  for (const key of SERVICES_NAMESPACE_KEYS) {
    if (key !== missing) {
      assert.equal(services[key].isActive, true, `${key} stays active`)
    }
  }
})

test('namespace is all-disabled when ctx.get is unavailable', () => {
  const services = createServicesNamespace({ ctx: {}, active: true })
  for (const key of SERVICES_NAMESPACE_KEYS) {
    assert.equal(services[key].isActive, false)
  }
})

test('namespace is all-disabled when every official service is missing', () => {
  const services = createServicesNamespace({ ctx: fullCtx({ get: () => undefined }), active: true })
  for (const key of SERVICES_NAMESPACE_KEYS) {
    assert.equal(services[key].isActive, false)
  }
})

test('facade active construction is driven by the static definitions only', () => {
  const services = createServicesNamespace({ ctx: fullCtx(), active: true, uriHelpers: URI_HELPERS })
  for (const def of SERVICE_DEFINITIONS) {
    assert.ok(services[def.key])
  }
})
