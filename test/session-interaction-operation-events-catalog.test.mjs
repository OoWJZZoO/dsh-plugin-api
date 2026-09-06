/**
 * Tests for the attempt-fact dynamic catalog slice (event catalog entries and
 * gating on the shared loop boundary marker).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_ATTEMPT_BOUNDARY_SYMBOL,
  agentAttemptFactsCatalogSlice,
  createAgentAttemptFactsCatalogSlice,
} from '../lib/session-interaction-operation-events-catalog.js'

const EXPECTED_CONTRACT = { runtime: '0.1.0-rc.6', api: '0.1' }
const AUX = { version: '0.1.0-rc.6-0.1.0', api: '0.1' }

function boundaryCtx({ active = true, rowActive = true } = {}) {
  const agentLoop = active
    ? { [AGENT_ATTEMPT_BOUNDARY_SYMBOL]: { availability: () => ({ status: 'active' }) } }
    : {}
  return {
    loader: {
      entries: () => (rowActive ? [{ options: { name: '@deepseek-ai/dsh-plugin-api-agent-loop' }, fiber: {}, disabled: false }] : []),
    },
    get: (name) => (name === 'agentLoop' ? agentLoop : undefined),
  }
}

test('catalog slice declares the two attempt facts with frozen payload shapes', () => {
  const slice = createAgentAttemptFactsCatalogSlice({ expectedContract: EXPECTED_CONTRACT, auxiliaryManifest: AUX })
  assert.equal(slice.name, 'attempt-facts')
  assert.equal(slice.entries.length, 2)
  const [start, end] = slice.entries
  assert.equal(start.name, 'agent/attempt/start')
  assert.equal(start.mode, 'emit')
  assert.equal(start.fault, 'contain')
  assert.equal(start.scopeFiltered, false)
  assert.equal(end.name, 'agent/attempt/end')
  assert.equal(end.mode, 'emit')
  assert.match(end.payload, /outcome: success\|error\|aborted\|denied\|superseded/)
  assert.match(end.payload, /followUp: none\|queued/)
  assert.ok(Object.isFrozen(start))
  assert.ok(Object.isFrozen(end))
})

test('slice is active only when the aux package matches and the boundary is active', () => {
  const slice = createAgentAttemptFactsCatalogSlice({ expectedContract: EXPECTED_CONTRACT, auxiliaryManifest: AUX })
  assert.equal(slice.isActive(boundaryCtx()), true)
  assert.equal(slice.isActive(boundaryCtx({ active: false })), false)
  assert.equal(slice.isActive(boundaryCtx({ rowActive: false })), false)
  const mismatched = createAgentAttemptFactsCatalogSlice({
    expectedContract: EXPECTED_CONTRACT,
    auxiliaryManifest: { version: '0.1.0-rc.6-99.0', api: '0.1' },
    logger: { warn: () => {} },
  })
  assert.equal(mismatched.isActive(boundaryCtx()), false)
})

test('boundary probing failures are contained (never throw through the catalog)', () => {
  const slice = createAgentAttemptFactsCatalogSlice({ expectedContract: EXPECTED_CONTRACT, auxiliaryManifest: AUX })
  assert.equal(slice.isActive({ get: () => { throw new Error('broken ctx') } }), false)
  assert.equal(slice.isActive({ ...boundaryCtx(), loader: { entries: () => { throw new Error('broken loader') } } }), false)
})

test('metadata-only default slice carries the catalog entries for pure consumers', () => {
  assert.equal(agentAttemptFactsCatalogSlice.entries.length, 2)
  assert.equal(agentAttemptFactsCatalogSlice.name, 'attempt-facts')
})