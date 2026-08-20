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

test('every agent entry is agent-scoped and free of governance class metadata', () => {
  for (const name of AGENT_NAMES) {
    const entry = agentEventsCatalog[name]
    assert.equal(entry.scopeFiltered, true, `${name}: scopeFiltered`)
    assert.equal(entry.scopeKey, 'args[0].agent', `${name}: scopeKey`)
    assert.ok(!('type' in entry), `${name}: type must not leak governance letters`)
    assert.ok(!('source' in entry), `${name}: source must not leak governance ids`)
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

test('agent slice entries match the confirmed mode matrix', () => {
  const matrix = {
    'agent/created': 'emit',
    'agent/disposed': 'emit',
    'agent/status': 'emit',
    'agent/session-start': 'emit',
    'agent/inbox/inserted': 'emit',
    'agent/inbox/claimed': 'emit',
    'agent/inbox/discarded': 'emit',
    'agent/pre-step': 'waterfall',
    'agent/request': 'waterfall',
    'agent/request-error': 'waterfall',
    'agent/turn-stopping': 'serial',
    'agent/error': 'emit',
  }
  for (const [name, mode] of Object.entries(matrix)) {
    assert.equal(agentEventsCatalog[name].mode, mode, `${name}: mode`)
  }
})
