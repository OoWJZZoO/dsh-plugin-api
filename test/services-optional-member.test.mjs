import test from 'node:test'
import assert from 'node:assert/strict'
import { buildActiveFacade, SERVICE_DEFINITIONS } from '../lib/services.js'

test('optional method flush is omitted when the official service lacks it', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'sessionTelemetry')
  const service = {
    emit() {},
    shutdown() {},
    sharing: false,
  }
  const facade = buildActiveFacade(def, service, {})
  assert.equal(facade.isActive, true)
  assert.ok(!('flush' in facade))
  assert.equal(typeof facade.emit, 'function')
  assert.equal(typeof facade.shutdown, 'function')
})

test('optional method flush is present and delegates when the official service has it', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'sessionTelemetry')
  const calls = []
  const service = {
    emit() {},
    shutdown() {},
    sharing: false,
    flush(reason) {
      calls.push(reason)
      return 'flushed'
    },
  }
  const facade = buildActiveFacade(def, service, {})
  assert.equal(typeof facade.flush, 'function')
  assert.equal(facade.flush('turn'), 'flushed')
  assert.deepEqual(calls, ['turn'])
})

test('incomplete compaction service disables the whole three-method facade', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'compaction')
  const facade = buildActiveFacade(def, {
    compactIfNeeded() {},
    compactNow: 'not callable',
    compactRegion() {},
  }, {})

  assert.equal(facade.isActive, false)
  for (const name of ['compactIfNeeded', 'compactNow', 'compactRegion']) {
    assert.equal(typeof facade[name], 'function')
    assert.throws(
      () => facade[name](),
      (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'services.compaction',
    )
  }
})

test('non-optional missing member degrades the whole facade to disabled (never silently omitted)', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'codeRuntime')
  const facade = buildActiveFacade(def, {}, {})
  assert.equal(facade.isActive, false)
  assert.ok('run' in facade, 'declared member stays observable')
  assert.throws(
    () => facade.run(),
    (error) => {
      assert.equal(error.code, 'PLUGIN_API_FEATURE_DISABLED')
      assert.equal(error.feature, 'services.codeRuntime')
      assert.match(error.message, /missing declared member/)
      return true
    },
  )
})
