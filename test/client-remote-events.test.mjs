import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientRemoteEvents, createDisabledClientRemoteEvents } from '../lib/client-remote-events.js'

function createRemoteCarrier() {
  const table = new Map()
  return {
    table,
    remote: {
      $on(event, listener) { const list = table.get(event) ?? []; list.push(listener); table.set(event, list); return () => { list.splice(list.indexOf(listener), 1) } },
      $dispatch(event, args) { for (const listener of [...(table.get(event) ?? [])]) listener(...args) },
    },
  }
}

test('remote events accept only the official allowlist and answer the standard observation handle', () => {
  const { remote } = createRemoteCarrier()
  const events = createClientRemoteEvents({ remote })
  const calls = []
  const observation = events.observe('settings/document-updated')
  assert.deepEqual(Object.keys(observation).sort(), ['current', 'dispose', 'epoch', 'subscribe'], 'the entry answers the observation handle and carries no internal record')
  assert.equal(observation.current(), undefined, 'nothing has been delivered yet')
  const unsubscribe = observation.subscribe((payload) => calls.push(payload))
  assert.deepEqual(events.dispatch('settings/document-updated', [{ scope: 'a', value: 2 }]), { ok: true, code: 'dispatched' },
    'dispatch answers the frozen discriminated result; containment is expressible without throwing')
  assert.deepEqual(calls, [{ scope: 'a', value: 2 }])
  assert.deepEqual(observation.current(), { scope: 'a', value: 2 }, 'current() reads the last delivered payload')
  // A delivery that carries more than one argument is published as the
  // argument tuple, so no part of the frame is dropped.
  events.dispatch('settings/document-updated', ['scope', 2])
  assert.deepEqual(observation.current(), ['scope', 2])
  assert.throws(() => events.observe('private/event'), /allowlist/)
  unsubscribe()
  calls.length = 0
  events.dispatch('settings/document-updated', ['later'])
  assert.deepEqual(calls, [])
  assert.equal(observation.dispose().ok, true)
  assert.equal(observation.dispose().ok, false, 'a second release is a no-op rather than a throw')
  events.dispatch('settings/document-updated', ['after release'])
  assert.deepEqual(calls, [])
})

test('official carrier preserves snapshot iteration and client listener failures are contained', () => {
  const logs = []
  const { remote } = createRemoteCarrier()
  const events = createClientRemoteEvents({ remote, logger: { error: (line) => logs.push(line) } })
  const calls = []
  events.observe('llm/adapters-updated').subscribe(() => { throw new Error('private') })
  events.observe('llm/adapters-updated').subscribe((...args) => calls.push(args))
  events.dispatch('llm/adapters-updated', ['x'])
  assert.deepEqual(calls, [['x']])
  assert.equal(logs.length, 1)
  assert.doesNotMatch(logs[0], /private/)
  assert.throws(() => createDisabledClientRemoteEvents().observe('x'), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED')
})

test('dispatch reports a refusing carrier as a typed code instead of throwing', () => {
  const remote = {
    $on() { return () => {} },
    $dispatch() { throw new Error('carrier refused') },
  }
  const events = createClientRemoteEvents({ remote })
  assert.deepEqual(events.dispatch('llm/adapters-updated', ['x']), { ok: false, code: 'error', reason: 'carrier refused' })
  assert.throws(() => events.dispatch('llm/adapters-updated', 'not-an-array'), TypeError, 'a malformed argument list is refused before anything is sent')
  assert.throws(() => createDisabledClientRemoteEvents().dispatch('llm/adapters-updated', []), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED',
    'a missing carrier refuses the dispatch rather than silently swallowing it')
})

test('remote events contain a rejected thenable without breaking later listeners or unhandledRejection', async () => {
  const logs = []
  const { remote } = createRemoteCarrier()
  const events = createClientRemoteEvents({ remote, logger: { error: (line) => logs.push(line) } })
  let unhandled = 0
  const onUnhandled = () => { unhandled += 1 }
  process.on('unhandledRejection', onUnhandled)
  try {
    const calls = []
    events.observe('llm/adapters-updated').subscribe(() => Promise.reject(new Error('async failure')))
    const observation = events.observe('llm/adapters-updated')
    observation.subscribe((...args) => calls.push(args))
    events.dispatch('llm/adapters-updated', ['x'])
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(calls, [['x']])
    assert.equal(unhandled, 0)
    assert.ok(logs.some((line) => /observer failed/i.test(line)))
    assert.equal(observation.dispose().ok, true)
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})
