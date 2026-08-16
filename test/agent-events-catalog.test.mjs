import test from 'node:test'
import assert from 'node:assert/strict'
import { agentEventsCatalog } from '../lib/agent-events-catalog.js'

const AGENT_NAMES = [
  'agent/created',
  'agent/disposed',
  'agent/status',
  'agent/session-start',
  'agent/inbox/inserted',
  'agent/inbox/claimed',
  'agent/inbox/discarded',
  'agent/pre-step',
  'agent/request',
  'agent/request-error',
  'agent/turn-stopping',
  'agent/error',
]

test('agent slice contains exactly the 12 agent/* event names', () => {
  assert.deepEqual(Object.keys(agentEventsCatalog).sort(), [...AGENT_NAMES].sort())
  assert.ok(Object.isFrozen(agentEventsCatalog), 'catalog must be frozen')
})

test('every agent entry is agent-scoped and typed A', () => {
  for (const name of AGENT_NAMES) {
    const entry = agentEventsCatalog[name]
    assert.equal(entry.scopeFiltered, true, `${name}: scopeFiltered`)
    assert.equal(entry.scopeKey, 'args[0].agent', `${name}: scopeKey`)
    assert.equal(entry.type, 'A', `${name}: type`)
  }
})

test('agent entries carry the confirmed fault/freeze policy matrix', () => {
  assert.equal(agentEventsCatalog['agent/created'].fault, 'created')
  for (const name of ['agent/pre-step', 'agent/request', 'agent/request-error', 'agent/turn-stopping']) {
    assert.equal(agentEventsCatalog[name].fault, 'propagate', `${name}: propagate`)
  }
  for (const name of ['agent/disposed', 'agent/status', 'agent/session-start', 'agent/inbox/inserted', 'agent/inbox/claimed', 'agent/inbox/discarded', 'agent/error']) {
    assert.equal(agentEventsCatalog[name].fault, 'contain', `${name}: contain`)
  }
  // live objects (agent/signal) are never deep-frozen: deep lists exclude them
  for (const name of AGENT_NAMES) {
    const freeze = agentEventsCatalog[name].freeze
    assert.ok(freeze && typeof freeze === 'object' && Array.isArray(freeze.deep), `${name}: deep policy`)
    assert.ok(!freeze.deep.includes('agent') && !freeze.deep.includes('signal'), `${name}: live fields exempt`)
  }
  assert.deepEqual(agentEventsCatalog['agent/pre-step'].freeze.deep, ['messages'])
  assert.deepEqual(agentEventsCatalog['agent/request-error'].freeze.deep, ['failure'])
})

test('agent slice entries match the confirmed mode/source matrix', () => {
  const matrix = {
    'agent/created': ['emit', 'A1'],
    'agent/disposed': ['emit', 'A1'],
    'agent/status': ['emit', 'A1'],
    'agent/session-start': ['emit', 'A1'],
    'agent/inbox/inserted': ['emit', 'A2'],
    'agent/inbox/claimed': ['emit', 'A2'],
    'agent/inbox/discarded': ['emit', 'A2'],
    'agent/pre-step': ['waterfall', 'A3'],
    'agent/request': ['waterfall', 'A4'],
    'agent/request-error': ['waterfall', 'A5'],
    'agent/turn-stopping': ['serial', 'A6'],
    'agent/error': ['emit', 'A7'],
  }
  for (const [name, [mode, source]] of Object.entries(matrix)) {
    assert.equal(agentEventsCatalog[name].mode, mode, `${name}: mode`)
    assert.equal(agentEventsCatalog[name].source, source, `${name}: source`)
  }
})
