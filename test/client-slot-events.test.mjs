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
