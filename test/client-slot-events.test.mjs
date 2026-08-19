import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientSlotEvents } from '../lib/client-slot-events.js'

test('slot events use snapshot order and contain a failed listener', () => {
  const listeners = new Set()
  const events = createClientSlotEvents({
    ctx: {
      on(name, listener) {
        assert.equal(name, 'slots/changed')
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  })
  const values = []
  events.on('slots/changed', () => { throw new Error('private') })
  const dispose = events.on('slots/changed', (key) => values.push(key))
  for (const listener of [...listeners]) listener('details')
  assert.deepEqual(values, ['details'])
  assert.equal(dispose(), true); assert.equal(dispose(), false)
})

test('slot events contain a rejected thenable without breaking later listeners or unhandledRejection', async () => {
  const listeners = new Set()
  const events = createClientSlotEvents({
    ctx: {
      on(name, listener) {
        assert.equal(name, 'slots/changed')
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    logger: { error() {} },
  })
  let unhandled = 0
  const onUnhandled = () => { unhandled += 1 }
  process.on('unhandledRejection', onUnhandled)
  try {
    const values = []
    events.on('slots/changed', () => Promise.reject(new Error('async failure')))
    const dispose = events.on('slots/changed', (key) => values.push(key))
    for (const listener of [...listeners]) listener('details')
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(values, ['details'])
    assert.equal(unhandled, 0)
    assert.equal(dispose(), true)
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})
