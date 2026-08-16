import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDisabledFacade,
  createDisabledServicesNamespace,
  createServicesNamespace,
  SERVICE_DEFINITIONS,
} from '../lib/services.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from '../lib/errors.js'

const def = SERVICE_DEFINITIONS.find((d) => d.key === 'fs')

test('disabled facade throws inactive error when core is inactive', () => {
  const facade = buildDisabledFacade(def, () => false, 'test reason')
  assert.equal(facade.isActive, false)
  assert.throws(
    () => facade.readText(),
    (error) => {
      assert.ok(error instanceof PluginApiInactiveError)
      assert.equal(error.code, 'PLUGIN_API_INACTIVE')
      return true
    },
  )
})

test('disabled facade getter throws the same typed inactive error', () => {
  const facade = buildDisabledFacade(def, () => false, 'test reason')
  assert.throws(
    () => facade.sandboxMode,
    (error) => {
      assert.ok(error instanceof PluginApiInactiveError)
      return true
    },
  )
})

test('disabled facade throws feature-disabled error with per-service feature code', () => {
  const facade = buildDisabledFacade(def, () => true, 'official service "fs" is unavailable')
  assert.throws(
    () => facade.readText({}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.code, 'PLUGIN_API_FEATURE_DISABLED')
      assert.equal(error.feature, 'services.fs')
      assert.match(error.message, /official service "fs" is unavailable/)
      return true
    },
  )
})

test('feature-level disabled namespace throws feature-disabled error with feature code "services"', () => {
  const services = createDisabledServicesNamespace(() => true)
  assert.ok(Object.isFrozen(services))
  assert.throws(
    () => services.fs.readText({}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'services')
      return true
    },
  )
})

test('per-service degradation facade does not call into official services', () => {
  let officialCalls = 0
  const ctx = {
    get(name) {
      if (name === 'fs') return undefined
      return {
        officialCalls,
        run() {
          officialCalls += 1
        },
      }
    },
  }
  const services = createServicesNamespace({ ctx, active: true })
  assert.equal(services.fs.isActive, false)
  assert.throws(() => services.fs.readText({}), PluginApiFeatureDisabledError)
  assert.equal(officialCalls, 0)
})

test('all-disabled fallback never exposes an active facade', () => {
  const services = createServicesNamespace({ ctx: { get: () => undefined }, active: true })
  for (const key of Object.keys(services)) {
    assert.equal(services[key].isActive, false)
  }
})
