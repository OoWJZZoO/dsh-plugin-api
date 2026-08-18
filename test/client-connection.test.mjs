import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientConnection, createDisabledClientConnection } from '../lib/client-connection.js'

test('connection forwards the exact API transport wire and preserves results', () => {
  const result = Promise.resolve({ ok: true })
  const calls = []
  const connection = {
    rpc: { call(...args) { calls.push([this, args]); return result } },
    api: { settings: { describe(...args) { return [this, args] } } },
  }
  const api = createClientConnection({ connection })
  const signal = new AbortController().signal
  assert.equal(api.rpc.call('settings.describe', { ns: 'a' }, signal), result)
  assert.deepEqual(calls, [[connection.rpc, ['/api', 'settings.describe', { args: { ns: 'a' } }, signal]]])
  assert.deepEqual(api.api.settings.describe('a'), [connection.api.settings, ['a']])
})

test('connection disabled face is typed and core inactivity wins', () => {
  assert.throws(() => createDisabledClientConnection().rpc.call('x'), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED')
  assert.throws(() => createDisabledClientConnection(false).rpc.call('x'), (error) => error.code === 'PLUGIN_API_INACTIVE')
})
