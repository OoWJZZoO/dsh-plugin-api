import test from 'node:test'
import assert from 'node:assert/strict'
import { buildActiveFacade, SERVICE_DEFINITIONS } from '../lib/services.js'

test('optional method flush is omitted when the official service lacks it', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'sessionTelemetry')
  const service = {
    emit() {},
    shutdown() {},
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

test('non-optional missing method is also omitted, never faked', () => {
  const def = SERVICE_DEFINITIONS.find((d) => d.key === 'codeRuntime')
  const facade = buildActiveFacade(def, {}, {})
  assert.equal(facade.isActive, true)
  assert.ok(!('run' in facade))
})
