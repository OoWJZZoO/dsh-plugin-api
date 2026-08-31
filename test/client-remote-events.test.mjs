import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientRemoteEvents, createDisabledClientRemoteEvents } from '../lib/client-remote-events.js'

test('remote events accept only the official allowlist and delegate subscriptions and frames', () => {
  const table = new Map()
  const remote = {
    $on(event, listener) { const list = table.get(event) ?? []; list.push(listener); table.set(event, list); return () => { list.splice(list.indexOf(listener), 1) } },
    $dispatch(event, args) { for (const listener of [...(table.get(event) ?? [])]) listener(...args) },
  }
  const events = createClientRemoteEvents({ remote })
  const calls = []
  const dispose = events.observe('settings/document-updated', (...args) => calls.push(args))
  assert.equal(events.dispatch('settings/document-updated', ['scope', 2]), undefined)
  assert.deepEqual(calls, [['scope', 2]])
  assert.throws(() => events.observe('private/event', () => {}), /allowlist/)
  assert.equal(dispose(), true)
  assert.equal(dispose(), false)
  events.dispatch('settings/document-updated', ['later'])
  assert.deepEqual(calls, [['scope', 2]])
})

test('official carrier preserves snapshot iteration and client listener failures are contained', () => {
  const logs = []
  const table = new Map()
  const remote = {
    $on(event, listener) { const list = table.get(event) ?? []; list.push(listener); table.set(event, list); return () => { list.splice(list.indexOf(listener), 1) } },
    $dispatch(event, args) { for (const listener of [...(table.get(event) ?? [])]) listener(...args) },
  }
  const events = createClientRemoteEvents({ remote, logger: { error: (line) => logs.push(line) } })
  const calls = []
  events.observe('llm/adapters-updated', () => { throw new Error('private') })
  events.observe('llm/adapters-updated', (...args) => calls.push(args))
  events.dispatch('llm/adapters-updated', ['x'])
  assert.deepEqual(calls, [['x']])
  assert.equal(logs.length, 1)
  assert.doesNotMatch(logs[0], /private/)
  assert.throws(() => createDisabledClientRemoteEvents().observe('x', () => {}), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED')
})

test('remote events contain a rejected thenable without breaking later listeners or unhandledRejection', async () => {
  const logs = []
  const table = new Map()
  const remote = {
    $on(event, listener) { const list = table.get(event) ?? []; list.push(listener); table.set(event, list); return () => { list.splice(list.indexOf(listener), 1) } },
    $dispatch(event, args) { for (const listener of [...(table.get(event) ?? [])]) listener(...args) },
  }
  const events = createClientRemoteEvents({ remote, logger: { error: (line) => logs.push(line) } })
  let unhandled = 0
  const onUnhandled = () => { unhandled += 1 }
  process.on('unhandledRejection', onUnhandled)
  try {
    const calls = []
    events.observe('llm/adapters-updated', () => Promise.reject(new Error('async failure')))
    const dispose = events.observe('llm/adapters-updated', (...args) => calls.push(args))
    events.dispatch('llm/adapters-updated', ['x'])
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(calls, [['x']])
    assert.equal(unhandled, 0)
    assert.ok(logs.some((line) => /remote event listener rejected/i.test(line)))
    assert.equal(dispose(), true)
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})
