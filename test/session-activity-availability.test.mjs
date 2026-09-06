import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionActivityProjection } from '../lib/session-activity.js'

function makeProjection({ ctx } = {}) {
  return createSessionActivityProjection({ ctx: ctx ?? { on: () => () => {} }, observe: true })
}

test('availability: shape is frozen { status, reason? } and never throws', () => {
  const projection = makeProjection()
  const first = projection.api.availability()
  assert.ok('status' in first)
  assert.equal(first.status, 'degraded')
  const second = projection.api.availability()
  assert.ok(Object.isFrozen(second))
  // health information never mixes into availability
  assert.ok(!('health' in second))
})

test('availability: active when the firehose is reachable and the slice is active', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  const availability = projection.api.availability()
  assert.equal(availability.status, 'active')
})

test('availability: slice inactive => degraded with terminal-evidence reason, sources stay served', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: false, versionMatched: false })
  // the official firehose is reachable so the projection keeps serving
  const availability = projection.api.availability()
  assert.equal(availability.status, 'degraded')
  assert.match(availability.reason, /terminal-evidence=reconstructed/)
})

test('availability: slice version mismatch => distinct degraded reason', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: false })
  const availability = projection.api.availability()
  assert.equal(availability.status, 'degraded')
  assert.match(availability.reason, /attempt-facts=version-mismatch/)
})

test('availability: a missing optional source degrades with the source listed', () => {
  const ctx = {
    on(name, listener) {
      // session and agent groups subscribe; tools throws
      if (name.startsWith('session/') || name.startsWith('agent/')) {
        return () => {}
      }
      if (name === 'tools/change') {
        throw new Error(`cannot subscribe ${name}`)
      }
      return () => {}
    },
  }
  const projection = makeProjection({ ctx })
  const availability = projection.api.availability()
  assert.equal(availability.status, 'degraded')
  // tools is the only optional group without a reachable subscription;
  // approval evidence arrives through the session firehose, not a probe
  assert.match(availability.reason, /sources=tools/)
})

test('availability: no reachable evidence source => unavailable', () => {
  const projection = makeProjection({ ctx: {} })
  const availability = projection.api.availability()
  assert.equal(availability.status, 'unavailable')
  assert.equal(availability.reason, 'evidence-sources-unavailable')
})

test('availability: per-context degraded reporting with identical query semantics', () => {
  // same runtime identity, different host context reachability: the query
  // surface behaves identically, only availability differs
  const headless = makeProjection()
  const bare = makeProjection({ ctx: {} })
  assert.deepEqual(headless.api.current('s1'), bare.api.current('s1'))
  assert.equal(headless.api.availability().status, 'degraded')
  assert.equal(bare.api.availability().status, 'unavailable')
})

test('availability: owner initialization failure is contained, never throws, reports degraded', () => {
  const ctx = {
    on() {
      throw new Error('subscriber host broken')
    },
  }
  // construction itself must not throw
  const projection = createSessionActivityProjection({ ctx, observe: true })
  const availability = projection.api.availability()
  assert.ok(['degraded', 'unavailable'].includes(availability.status))
  assert.equal(projection.api.current('s1').code, 'absent')
})