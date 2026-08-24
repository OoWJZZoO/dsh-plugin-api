import test from 'node:test'
import assert from 'node:assert/strict'
import { createExecutionVisibility } from '../lib/execution-visibility.js'

const projection = {
  executionId: 'exec-1',
  sessionId: 's1',
  agentId: 'a1',
  outcome: 'error',
  outcomeReason: { category: 'timeout' },
  phase: 'ended',
  provenance: [{ sourceKind: 'agent', observedAt: '2026-01-01T00:00:00.000Z', certainty: 'observed' }],
  sourceAvailability: { agent: 'available' },
}

test('default audience redaction follows minimum exposure per audience', () => {
  const visibility = createExecutionVisibility()
  const model = visibility.redact(projection, { audience: 'model' })
  assert.ok('executionId' in model)
  assert.ok('outcome' in model)
  assert.ok(!('provenance' in model), 'model/tool output omits internal diagnostics')

  const ui = visibility.redact(projection, { audience: 'ui' })
  assert.ok('sessionId' in ui)
  assert.ok('sourceAvailability' in ui)
  assert.ok('provenance' in ui)

  const log = visibility.redact(projection, { audience: 'log' })
  assert.ok('executionId' in log)
  assert.ok(!('sessionId' in log))
  assert.ok(!('provenance' in log))
})

test('explicit non-secret policy exposes approved fields with identity', () => {
  const visibility = createExecutionVisibility()
  const disposer = visibility.register({
    id: 'p1',
    ownerId: 'owner-a',
    generation: 'g1',
    filter: (field) => field === 'executionId',
  })
  const model = visibility.redact(projection, { audience: 'model' })
  assert.ok('executionId' in model)
  assert.equal(disposer(), true)
  const after = visibility.redact(projection, { audience: 'model' })
  assert.ok('executionId' in after, 'executionId is a default field; policy disposal still allows it')
})

test('a policy throw degrades only that decision point to default denial', () => {
  const visibility = createExecutionVisibility()
  visibility.register({
    id: 'thrower',
    ownerId: 'o',
    generation: 'g',
    // Non-default debug-only field, policy throws -> denied for ui.
    filter: () => { throw new Error('boom') },
  })
  const out = visibility.redact({ executionId: 'e', provenance: [{ sourceKind: 'agent' }] }, { audience: 'ui' })
  assert.ok('executionId' in out)
  assert.ok(!('redacted' in out))
})

test('secret fields are denied unless an explicit secret policy is present', () => {
  const visibility = createExecutionVisibility()
  const secretProjection = { executionId: 'e', credential: 'top-secret' }
  const denied = visibility.redact(secretProjection, { audience: 'debug' })
  assert.ok(!('credential' in denied))

  visibility.register({
    id: 'secret-approver',
    ownerId: 'o',
    generation: 'g',
    secret: true,
    filter: (field) => field === 'credential',
  })
  const allowed = visibility.redact(secretProjection, { audience: 'debug' })
  assert.equal(allowed.credential, 'top-secret')
})

test('registration validates, deduplicates ids and returns identity-bound disposers', () => {
  const visibility = createExecutionVisibility()
  assert.throws(() => visibility.register({ id: '', ownerId: 'o', filter: () => true }), TypeError)
  const first = visibility.register({ id: 'same', ownerId: 'o', filter: () => true })
  assert.throws(() => visibility.register({ id: 'same', ownerId: 'o2', filter: () => true }), TypeError)
  assert.equal(first(), true)
  // A disposed registration cannot be re-disposed.
  assert.equal(first(), false)
})
