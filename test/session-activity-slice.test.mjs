import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionActivityProjection } from '../lib/session-activity.js'
import { activityObservationContract } from '../lib/session-activity-contract.js'

function makeProjection({ observe = true, enabled = true } = {}) {
  const ctx = { on: () => () => {} }
  return createSessionActivityProjection({ ctx, observe, enabled })
}

const AT = Object.freeze({
  start(over = {}) {
    return {
      attemptId: 'att-1',
      executionId: 'exec-1',
      sessionId: 's1',
      seq: 10,
      observedAt: '2026-09-06T00:00:00.000Z',
      ...over,
    }
  },
  end(over = {}) {
    return {
      attemptId: 'att-1',
      executionId: 'exec-1',
      sessionId: 's1',
      outcome: 'success',
      followUp: 'none',
      seq: 11,
      observedAt: '2026-09-06T00:00:00.000Z',
      ...over,
    }
  },
})

test('slice: active slice facts produce observed-grade terminal and queue facts', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  assert.equal(projection.ingestAttemptFact('agent/attempt/start', AT.start()), true)
  assert.equal(projection.ingestAttemptFact('agent/attempt/end', AT.end({ outcome: 'superseded', followUp: 'queued' })), true)
  // the activity closed: the frozen record lives in history, the current view
  // reports absence and the session-level queue marker is set
  const current = projection.api.current('s1')
  assert.deepEqual(current, { ok: false, code: 'absent' })
  const history = projection.api.history('s1')
  const snapshot = history.items[0]
  assert.equal(snapshot.terminal.outcome, 'superseded')
  assert.equal(snapshot.terminal.confidence, 'observed')
  assert.equal(snapshot.terminal.followUp, 'queued')
  assert.equal(snapshot.fidelity.sliceObserved, true)
  assert.equal(history.gap, null)
  assert.ok(Object.isFrozen(snapshot))
  const withQueue = projection.api.get(snapshot.activityId)
  assert.equal(withQueue.sessionQueue.kind, 'queued')
  assert.equal(withQueue.sessionQueue.confidence, 'observed')
})

test('slice: inactive slice refuses facts and never mislabels them observed', () => {
  const projection = makeProjection()
  // slice state defaults to inactive
  assert.equal(projection.ingestAttemptFact('agent/attempt/start', AT.start()), false)
  assert.equal(projection.ingestAttemptFact('agent/attempt/end', AT.end()), false)
  const view = projection.api.current('s1')
  assert.equal(view.ok, false)
  assert.deepEqual(view, { ok: false, code: 'absent' })
  const availability = projection.api.availability()
  assert.equal(availability.status, 'degraded')
  assert.match(availability.reason, /terminal-evidence=reconstructed/)
})

test('slice: version mismatch degrades with a distinct reason', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: false })
  assert.equal(projection.ingestAttemptFact('agent/attempt/start', AT.start()), false)
  const availability = projection.api.availability()
  assert.equal(availability.status, 'degraded')
  assert.match(availability.reason, /attempt-facts=version-mismatch/)
})

test('slice: payload shape is validated field by field against the frozen contract', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  assert.equal(projection.ingestAttemptFact('agent/attempt/start', AT.start({ attemptId: undefined })), false)
  assert.equal(projection.ingestAttemptFact('agent/attempt/start', AT.start({ seq: 'x' })), false)
  assert.equal(projection.ingestAttemptFact('agent/attempt/end', AT.end({ outcome: 'settled' })), false)
  assert.equal(projection.ingestAttemptFact('agent/attempt/end', AT.end({ followUp: 'maybe' })), false)
  assert.equal(projection.ingestAttemptFact('agent/attempt/end', AT.end({ outcome: 'denied', followUp: 'none' })), true)
  assert.equal(projection.ingestAttemptFact('agent/attempt/other', AT.start()), false)
  assert.equal(projection.ingestAttemptFact('agent/attempt/start', null), false)
})

test('slice: denied terminal becomes observed-grade denied', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  projection.ingestAttemptFact('agent/attempt/start', AT.start())
  projection.ingestAttemptFact('agent/attempt/end', AT.end({ outcome: 'denied', followUp: 'none' }))
  const history = projection.api.history('s1')
  assert.equal(history.items[0].terminal.outcome, 'denied')
  assert.equal(history.items[0].terminal.confidence, 'observed')
})

test('slice: a queued terminal never rewrites into a waiting status', () => {
  const projection = makeProjection()
  projection.setSliceState({ active: true, versionMatched: true })
  projection.ingestAttemptFact('agent/attempt/start', AT.start())
  projection.ingestAttemptFact('agent/attempt/end', AT.end({ followUp: 'queued' }))
  const history = projection.api.history('s1')
  assert.equal(history.items[0].status, null)
  assert.equal(history.items[0].terminal.outcome, 'success')
  const withQueue = projection.api.get(history.items[0].activityId)
  assert.equal(withQueue.sessionQueue.kind, 'queued')
})

test('slice: observation contract marker matches the frozen contract mirror', () => {
  const contract = activityObservationContract()
  assert.equal(contract.version, 1)
  assert.deepEqual(contract.attemptStart.fields, [
    'attemptId', 'operationId', 'executionId', 'sessionId', 'seq', 'observedAt',
  ])
  assert.deepEqual(contract.attemptEnd.fields, [
    'attemptId', 'operationId', 'executionId', 'sessionId',
    'outcome', 'reason', 'classification', 'followUp', 'seq', 'observedAt',
  ])
})

test('slice: disabled projection throws the typed feature-disabled error and nothing else', () => {
  const projection = makeProjection({ enabled: false })
  assert.throws(() => projection.api.current('s1'), (error) => {
    assert.equal(error.name, 'PluginApiFeatureDisabledError')
    assert.equal(error.code, 'PLUGIN_API_FEATURE_DISABLED')
    return true
  })
  assert.throws(() => projection.api.observe({ sessionId: 's1' }), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED')
  assert.throws(() => projection.api.availability(), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED')
})