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

test('namespace exposes exactly the 19 keys and nothing else', () => {
  const services = createServicesNamespace({ ctx: fullCtx(), active: true, uriHelpers: URI_HELPERS })
  assert.deepEqual(Object.keys(services), SERVICES_NAMESPACE_KEYS)
  assert.equal(Object.keys(services).length, 19)
  assert.ok('compaction' in services)
})

test('namespace and every facade are frozen (read-only at runtime)', () => {
  const services = createServicesNamespace({ ctx: fullCtx(), active: true, uriHelpers: URI_HELPERS })
  assert.ok(Object.isFrozen(services))
  for (const key of SERVICES_NAMESPACE_KEYS) {
    assert.ok(Object.isFrozen(services[key]), `${key} facade frozen`)
    assert.equal(services[key].isActive, true)
  }

  const compaction = services.compaction
  assert.deepEqual(Object.keys(compaction), [
    'isActive',
    'compactIfNeeded',
    'compactNow',
    'compactRegion',
  ])
  assert.equal('summarize' in compaction, false)
  assert.equal('config' in compaction, false)

  assert.throws(() => { services.extra = true }, TypeError)
  assert.throws(() => { delete services.compaction }, TypeError)
  assert.throws(() => { Object.defineProperty(services, 'extra', { value: true }) }, TypeError)
  assert.throws(() => { compaction.extra = true }, TypeError)
  assert.throws(() => { delete compaction.compactNow }, TypeError)
  assert.throws(() => { Object.defineProperty(compaction, 'extra', { value: true }) }, TypeError)
  assert.equal(services.extra, undefined)
  assert.equal(services.compaction, compaction)
  assert.equal(compaction.extra, undefined)
  assert.equal(typeof compaction.compactNow, 'function')
})

test('compaction facade does not mutate the official service target', () => {
  const compaction = {
    compactIfNeeded() {},
    compactNow() {},
    compactRegion() {},
    summarize() {},
    config: { mode: 'basic' },
    providerState: { active: true },
  }
  const services = createServicesNamespace({
    ctx: fullCtx({
      get(name, byService) {
        return name === 'compaction' ? compaction : byService[name]
      },
    }),
    active: true,
    uriHelpers: URI_HELPERS,
  })

  assert.equal(services.compaction.isActive, true)
  assert.equal('summarize' in services.compaction, false)
  assert.equal('config' in services.compaction, false)
  assert.equal('providerState' in services.compaction, false)
  assert.equal(Object.isFrozen(compaction), false)
  assert.equal(typeof compaction.summarize, 'function')
  assert.deepEqual(compaction.config, { mode: 'basic' })
  assert.deepEqual(compaction.providerState, { active: true })
})

test('hostile compaction member inspection degrades locally without interrupting other facades', () => {
  const loggerMessages = []
  const compaction = {
    compactIfNeeded() {},
    compactNow() {},
    compactRegion() {},
  }
  Object.defineProperty(compaction, 'compactNow', {
    get() {
      throw new Error('hostile member getter')
    },
  })
  const services = createServicesNamespace({
    ctx: fullCtx({
      get(name, byService) {
        return name === 'compaction' ? compaction : byService[name]
      },
    }),
    active: true,
    logger: { error(message) { loggerMessages.push(message) } },
    uriHelpers: URI_HELPERS,
  })

  assert.equal(services.compaction.isActive, false)
  assert.equal(services.fs.isActive, true)
  assert.throws(
    () => services.compaction.compactNow(),
    (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'services.compaction',
  )
  assert.equal(loggerMessages.length, 1)
})

test('an incomplete compaction target is one sealed definition-level P4 facade while all static peers remain active', () => {
  let officialCalls = 0
  const incomplete = {
    compactIfNeeded() { officialCalls += 1 },
    compactNow() { officialCalls += 1 },
    // `compactRegion` is deliberately absent: the whole declared definition,
    // not only the missing member, must degrade to P4.
    backendOnly() { officialCalls += 1 },
    scheduler: { queued: true },
  }
  const services = createServicesNamespace({
    ctx: fullCtx({
      get(name, byService) {
        return name === 'compaction' ? incomplete : byService[name]
      },
    }),
    active: true,
    uriHelpers: URI_HELPERS,
  })

  assert.deepEqual(Object.keys(services), SERVICES_NAMESPACE_KEYS)
  assert.equal(services.compaction.isActive, false)
  assert.deepEqual(Object.keys(services.compaction), [
    'isActive',
    'compactIfNeeded',
    'compactNow',
    'compactRegion',
  ])
  assert.equal('backendOnly' in services.compaction, false)
  assert.equal('scheduler' in services.compaction, false)
  for (const name of ['compactIfNeeded', 'compactNow', 'compactRegion']) {
    assert.throws(
      () => services.compaction[name]({ marker: name }),
      (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'services.compaction',
    )
  }
  assert.equal(officialCalls, 0)
  for (const key of SERVICES_NAMESPACE_KEYS) {
    if (key !== 'compaction') assert.equal(services[key].isActive, true, `${key} stays active`)
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
