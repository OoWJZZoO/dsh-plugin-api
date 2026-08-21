import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CLIENT_EVENT_NAMES,
  createClientOfficialEvent,
  createClientOfficialEvents,
} from '../lib/client-official-events.js'

const EVENT_KEYS = {
  'locale/change': 'localeChange',
  'theme/change': 'themeChange',
  'connection/reset': 'connectionReset',
  'command/executed': 'commandExecuted',
}

function createSource() {
  const listeners = new Map()
  const disposals = []
  const source = {
    on(name, listener) {
      assert.equal(this, source)
      const entries = listeners.get(name) ?? []
      entries.push(listener)
      listeners.set(name, entries)
      return () => {
        disposals.push(name)
        const current = listeners.get(name) ?? []
        const index = current.indexOf(listener)
        if (index !== -1) current.splice(index, 1)
      }
    },
    emit(name, ...args) {
      for (const listener of [...(listeners.get(name) ?? [])]) listener(...args)
    },
    count(name) {
      return (listeners.get(name) ?? []).length
    },
    disposals,
  }
  return source
}

test('client event facade exposes exact leaves and preserves argument identity and order', () => {
  const source = createSource()
  const result = createClientOfficialEvents({
    resolveSource() {
      return source
    },
  })
  assert.deepEqual(Object.keys(result.api).sort(), [
    'commandExecuted', 'connectionReset', 'dispose', 'isActive', 'localeChange', 'on', 'themeChange',
  ])
  assert.deepEqual(CLIENT_EVENT_NAMES.map((name) => EVENT_KEYS[name]), [
    'localeChange', 'themeChange', 'connectionReset', 'commandExecuted',
  ])

  for (const name of CLIENT_EVENT_NAMES) {
    const leaf = result.api[EVENT_KEYS[name]]
    assert.deepEqual(Object.keys(leaf), ['isActive', 'on', 'dispose'])
    assert.equal(leaf.isActive, true)
  }

  const first = {}
  const second = Symbol('second')
  const received = []
  const dispose = result.api.on('command/executed', (...args) => received.push(args))
  source.emit('command/executed', first, second, 3)
  assert.deepEqual(received, [[first, second, 3]])
  assert.equal(received[0][0], first)
  assert.equal(received[0][1], second)
  assert.equal(dispose(), true)
  assert.equal(dispose(), false)
  source.emit('command/executed', first, second, 4)
  assert.deepEqual(received, [[first, second, 3]])
})

test('event source resolution is lazy and one absent source does not disable other leaves', () => {
  const source = createSource()
  let reads = 0
  const result = createClientOfficialEvents({
    resolveSource(name) {
      reads += 1
      return name === 'locale/change' ? source : undefined
    },
  })

  assert.equal(reads, 0)
  assert.equal(result.api.localeChange.isActive, true)
  assert.equal(reads, 1)
  assert.equal(result.api.themeChange.isActive, false)
  assert.throws(
    () => result.api.themeChange.on(() => {}),
    (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'client.themeChange',
  )
  let delivered = 0
  result.api.localeChange.on(() => { delivered += 1 })
  source.emit('locale/change', {})
  assert.equal(delivered, 1)
})

test('listener failures and rejected thenables are contained while later listeners run', async () => {
  const source = createSource()
  const logs = []
  const result = createClientOfficialEvents({
    eventSource: source,
    logger: { error(message, error) { logs.push([message, error]) } },
  })
  const thrown = new Error('sync listener failure')
  const rejected = new Error('async listener failure')
  const delivered = []
  result.api.localeChange.on(() => { throw thrown })
  result.api.localeChange.on((value) => delivered.push(value))
  result.api.localeChange.on(() => Promise.reject(rejected))
  const payload = { locale: 'en' }
  source.emit('locale/change', payload)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(delivered, [payload])
  assert.equal(logs.length, 2)
  assert.equal(logs[0][1], thrown)
  assert.equal(logs[1][1], rejected)
})

test('native event disposer failures are contained and logged', async () => {
  const syncError = new Error('native sync cleanup failure')
  const asyncError = new Error('native async cleanup failure')
  const logs = []
  const makeSource = (disposer) => ({
    on() {
      return disposer
    },
  })
  const logger = { error(message, error) { logs.push([message, error]) } }

  const syncLeaf = createClientOfficialEvent({
    name: 'locale/change',
    source: makeSource(() => { throw syncError }),
    logger,
  })
  syncLeaf.api.on(() => {})
  assert.equal(syncLeaf.api.dispose(), true)

  const asyncLeaf = createClientOfficialEvent({
    name: 'theme/change',
    source: makeSource(() => Promise.reject(asyncError)),
    logger,
  })
  asyncLeaf.api.on(() => {})
  assert.equal(asyncLeaf.api.dispose(), true)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(logs.map(([, error]) => error), [syncError, asyncError])
})

test('official event source adapters preserve receiver for on, $on, addEventListener, and function forms', () => {
  const forms = [
    {
      create(calls) {
        const source = {
          on(name, listener) {
            assert.equal(this, source)
            calls.push([name, listener])
            return () => {}
          },
        }
        return source
      },
    },
    {
      create(calls) {
        const source = {
          $on(name, listener) {
            assert.equal(this, source)
            calls.push([name, listener])
            return () => {}
          },
        }
        return source
      },
    },
    {
      create(calls) {
        const source = {
          addEventListener(name, listener) {
            assert.equal(this, source)
            calls.push([name, listener])
            return () => {}
          },
        }
        return source
      },
    },
    {
      create(calls) {
        return (name, listener) => {
          calls.push([name, listener])
          return () => {}
        }
      },
    },
  ]
  for (const form of forms) {
    const calls = []
    const source = form.create(calls)
    const leaf = createClientOfficialEvent({ name: 'locale/change', source })
    const listener = () => {}
    leaf.api.on(listener)
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], 'locale/change')
    assert.equal(calls[0][1] !== listener, true)
  }
})

test('reapplying an event leaf invalidates the old listener and keeps the new owner', () => {
  const source = createSource()
  const ownerScope = {}
  const first = createClientOfficialEvents({ ownerScope, eventSource: source })
  const firstReceived = []
  first.api.themeChange.on((value) => firstReceived.push(value))
  const second = createClientOfficialEvents({ ownerScope, eventSource: source })
  const secondReceived = []
  second.api.themeChange.on((value) => secondReceived.push(value))
  const payload = { theme: 'dark' }
  source.emit('theme/change', payload)
  assert.deepEqual(firstReceived, [])
  assert.deepEqual(secondReceived, [payload])
  assert.equal(first.leaves['theme/change'].dispose(), false)
  source.emit('theme/change', payload)
  assert.deepEqual(secondReceived, [payload, payload])
})

test('root inactivity wins before a source resolver is touched', () => {
  let reads = 0
  const result = createClientOfficialEvents({
    active: () => false,
    resolveSource() {
      reads += 1
      return createSource()
    },
  })
  assert.equal(result.api.localeChange.isActive, false)
  assert.equal(reads, 0)
  assert.throws(() => result.api.localeChange.on(() => {}), (error) => error.code === 'PLUGIN_API_INACTIVE')
})
