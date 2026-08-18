import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientSlotEvents } from '../lib/client-slot-events.js'

test('slot events use snapshot order and contain a failed listener', () => {
  const events = createClientSlotEvents()
  const values = []
  events.on('slots/changed', () => { throw new Error('private') })
  const dispose = events.on('slots/changed', (key) => values.push(key))
  events.emitChanged('details')
  assert.deepEqual(values, ['details'])
  assert.equal(dispose(), true); assert.equal(dispose(), false)
})
