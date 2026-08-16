import test from 'node:test'
import assert from 'node:assert/strict'
import { createServicesNamespace, SERVICE_DEFINITIONS, SERVICES_NAMESPACE_KEYS } from '../lib/services.js'

function fullCtx(overrides = {}) {
  const get = (name) => {
    if (overrides.get) return overrides.get(name)
    return { official: true }
  }
  return { get }
}

test('namespace exposes exactly the 17 keys and nothing else', () => {
  const services = createServicesNamespace({ ctx: fullCtx(), active: true })
  assert.deepEqual(Object.keys(services), SERVICES_NAMESPACE_KEYS)
  assert.equal(Object.keys(services).length, 17)
  assert.ok(!('compaction' in services))
})

test('namespace and every facade are frozen (read-only at runtime)', () => {
  const services = createServicesNamespace({ ctx: fullCtx(), active: true })
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
      get(name) {
        if (name === missing) return undefined
        return { official: true }
      },
    }),
    active: true,
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
  const services = createServicesNamespace({ ctx: fullCtx(), active: true })
  for (const def of SERVICE_DEFINITIONS) {
    assert.ok(services[def.key])
  }
})
