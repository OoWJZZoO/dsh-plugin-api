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

test('incomplete member set disables the whole facade of a retained service', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'sessionProjectionCache')
  const facade = buildActiveFacade(def, {
    cachedSnapshot() {},
    coldSnapshot: 'not callable',
  }, {})

  assert.equal(facade.isActive, false)
  for (const name of ['cachedSnapshot', 'coldSnapshot']) {
    assert.equal(typeof facade[name], 'function')
    assert.throws(
      () => facade[name](),
      (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'services.sessionProjectionCache',
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

test('incomplete jobs service disables the whole nine-method facade', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'jobs')
  const facade = buildActiveFacade(def, {
    start() {},
    list() {},
    get() {},
    read() {},
    kill() {},
    wait() {},
    onJobDone() {},
    // onJobsChanged deliberately absent; attachController present.
    attachController() {},
  }, {})

  assert.equal(facade.isActive, false)
  for (const name of def.members.map((m) => m.name)) {
    assert.equal(typeof facade[name], 'function', `${name} stays observable`)
    assert.throws(
      () => facade[name](),
      (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'services.jobs',
    )
  }
})

test('jobs non-callable member degrades the whole nine-method facade', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'jobs')
  const facade = buildActiveFacade(def, {
    start() {},
    list() {},
    get() {},
    read() {},
    kill() {},
    wait: 'not callable',
    onJobDone() {},
    onJobsChanged() {},
    attachController() {},
  }, {})

  assert.equal(facade.isActive, false)
  for (const name of def.members.map((m) => m.name)) {
    assert.throws(
      () => facade[name](),
      (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'services.jobs',
    )
  }
})

test('incomplete shellEnv service disables the whole three-method facade', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'shellEnv')
  const facade = buildActiveFacade(def, {
    register() {},
    // collect deliberately absent; list present.
    list() {},
  }, {})

  assert.equal(facade.isActive, false)
  for (const name of def.members.map((m) => m.name)) {
    assert.equal(typeof facade[name], 'function', `${name} stays observable`)
    assert.throws(
      () => facade[name](),
      (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'services.shellEnv',
    )
  }
})
