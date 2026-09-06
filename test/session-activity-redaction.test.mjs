import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionActivityProjection } from '../lib/session-activity.js'
import { buildProjection } from '../lib/session-activity-view.js'

const SECRET = 'password=hunter2-secret-token'

test('redaction: content text and owner-private material never enter snapshots', () => {
  const listeners = new Map()
  const sessions = {}
  const ctx = {
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name).push(listener)
      return () => {}
    },
    get(service) {
      if (service === 'sessions') return { get: (id) => sessions[id] }
      return undefined
    },
  }
  const projection = createSessionActivityProjection({ ctx, observe: true })
  sessions.s1 = {
    id: 's1',
    header: { id: 's1' },
    events: [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      // user content carrying a secret: the projection never projects content
      { type: 'user/message', seq: 1, time: 2, data: { content: `do this: ${SECRET}` } },
      { type: 'turn/end', seq: 2, time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
    ],
  }
  projection.joinDurable(sessions.s1)
  const serialized = JSON.stringify(projection.api.history('s1'))
  assert.ok(!serialized.includes(SECRET))
  const current = JSON.stringify(projection.api.current('s1'))
  assert.ok(!current.includes(SECRET))
  // no content-bearing field exists on the projection at all
  for (const item of projection.api.history('s1').items) {
    assert.equal('content' in item, false)
    assert.equal('message' in item, false)
  }
})

test('redaction: free-text reason material is audience-gated', () => {
  const projection = createSessionActivityProjection({ ctx: { on: () => () => {} }, observe: false })
  projection.setSliceState({ active: true, versionMatched: true })
  projection.ingestAttemptFact('agent/attempt/start', {
    attemptId: 'att-1', executionId: 'exec-1', sessionId: 's1', seq: 1,
    observedAt: '2026-09-06T00:00:00.000Z',
  })
  projection.ingestAttemptFact('agent/attempt/end', {
    attemptId: 'att-1', executionId: 'exec-1', sessionId: 's1',
    outcome: 'error', followUp: 'none', seq: 2,
    reason: `stream exploded: ${SECRET}`,
    classification: 'agent-error',
    observedAt: '2026-09-06T00:00:00.000Z',
  })
  // ui audience never receives the free-text reason
  const history = projection.api.history('s1')
  assert.ok(!('reason' in history.items[0].terminal))
  assert.equal(history.items[0].terminal.classification, 'agent-error')
  assert.ok(!JSON.stringify(history).includes(SECRET))
  // diagnostics audience may read the bounded reason
  const diagnostics = projection.api.history('s1', { audience: 'diagnostics' })
  assert.equal(diagnostics.items[0].terminal.reason.includes(SECRET), true)
})

test('redaction: buildProjection is total and never leaks internal fields', () => {
  const projection = createSessionActivityProjection({ ctx: { on: () => () => {} }, observe: false })
  projection.setSliceState({ active: true, versionMatched: true })
  projection.ingestAttemptFact('agent/attempt/start', {
    attemptId: 'att-1', executionId: 'exec-1', sessionId: 's1', seq: 1,
    observedAt: '2026-09-06T00:00:00.000Z',
  })
  const raw = projection.api.current('s1').snapshot
  const rebuilt = buildProjection(
    {
      ...raw,
      // hostile input cannot break the builder
      correlation: { ...raw.execution, confidence: undefined },
    },
    { audience: 'ui' },
  )
  assert.equal(typeof rebuilt.activityId, 'string')
  assert.ok(Object.isFrozen(rebuilt))
  assert.equal(buildProjection(null), undefined)
})

test('redaction: degradation logs carry source names but never payload content', () => {
  const logs = []
  const ctx = {
    on(name) {
      if (name === 'tools/change') {
        throw new Error('tools subscription blocked')
      }
      return () => {}
    },
  }
  const logger = {
    warn(message) {
      logs.push(String(message))
    },
  }
  const projection = createSessionActivityProjection({ ctx, logger, observe: true })
  projection.api.availability()
  const serialized = logs.join('\n')
  assert.ok(!serialized.includes(SECRET))
  assert.match(serialized, /activity-projection/)
})