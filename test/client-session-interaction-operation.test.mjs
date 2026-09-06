/**
 * Client-face tests for the session request/cancel operation.
 *
 * Covers Requirement 9: same-shaped typed outcomes over the transport, offline
 * / rebind typed unavailable, no silent queue/drop, stale generation guards,
 * host-side redaction assumption (client validates shape only) and client
 * availability that never affects the host authority.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClientSessionInteractionOperation } from '../lib/client-session-interaction-operation.js'

function transportFixture() {
  const calls = []
  let epoch = 0
  const transport = {
    calls,
    bumpEpoch() {
      epoch += 1
    },
    currentEpoch: () => epoch,
    request: async (method, payload, opts) => {
      calls.push({ method, payload, opts })
      if (method === 'sessions.request') {
        return {
          ok: true,
          code: 'accepted',
          operation: { id: 'op1', ownerId: 'o1', sessionId: 's1', activity: { executionId: 'ex1', confidence: 'unknown' } },
          activity: { activityId: null, executionId: 'ex1', confidence: 'unknown' },
        }
      }
      if (method === 'sessions.cancel') {
        return { ok: true, code: 'accepted' }
      }
      return { ok: false, code: 'unavailable', reason: 'unknown method' }
    },
    operation: {
      status: (id) => ({ phase: 'running', terminal: null, attempt: null, activity: { executionId: 'ex1', confidence: 'unknown' }, observedAt: 't' }),
      observe: (id, listener) => {
        const disposer = () => {
          transport.calls.push({ observeDisposed: id })
        }
        listener({ phase: 'terminal', terminal: { outcome: 'success', classification: 'completed' }, attempt: null, activity: null, observedAt: 't2' })
        return disposer
      },
    },
  }
  return transport
}

test('client request forwards and returns the same typed outcome shape', async () => {
  const transport = transportFixture()
  const client = createClientSessionInteractionOperation({ transport, epoch: () => transport.currentEpoch() })
  const out = await client.request({ sessionId: 's1', message: { kind: 'user-message', text: 'hi' } })
  assert.deepEqual(out.code, 'accepted')
  assert.equal(out.ok, true)
  assert.equal(out.operation.id, 'op1')
  assert.equal(transport.calls[0].method, 'sessions.request')
  // client-side operation handle forwards status/observe/dispose over the transport
  assert.equal(out.operation.status().phase, 'running')
  assert.equal(out.operation.ownerId, 'o1')
})

test('client cancel forwards and returns the typed cancel outcome', async () => {
  const transport = transportFixture()
  const client = createClientSessionInteractionOperation({ transport, epoch: () => transport.currentEpoch() })
  const result = await client.cancel({ operationId: 'op1', by: 'system', reason: 'stop-then-restore' })
  assert.deepEqual(result, { ok: true, code: 'accepted' })
  assert.equal(transport.calls.at(-1).method, 'sessions.cancel')
})

test('offline/unwired transport returns typed unavailable without queuing or dropping silently', async () => {
  const calls = []
  const client = createClientSessionInteractionOperation({
    transport: null,
    logger: { warn: () => calls.push('logged') },
  })
  const out = await client.request({ sessionId: 's1', message: { kind: 'user-message', text: 'hi' } })
  assert.equal(out.code, 'unavailable')
  assert.equal(out.ok, false)
  const cancelResult = await client.cancel({ operationId: 'op1' })
  assert.equal(cancelResult.code, 'unavailable')
  assert.equal(calls.length >= 1, true, 'diagnostics were logged, nothing was queued')
})

test('malformed host payload is rejected as unavailable, never fabricated', async () => {
  const transport = {
    request: async () => ({ ok: true, code: 'accepted', operation: null }),
  }
  const client = createClientSessionInteractionOperation({ transport, epoch: () => 0 })
  const out = await client.request({ sessionId: 's1' })
  assert.equal(out.code, 'unavailable')
})

test('rebind / generation change staleness: old cotransport callbacks never write into the new generation', async () => {
  const transport = transportFixture()
  const client = createClientSessionInteractionOperation({ transport, epoch: () => transport.currentEpoch() })
  const out = await client.request({ sessionId: 's1' })
  // bump the generation mid-life: old handle's status/observe become unavailable-only
  transport.bumpEpoch()
  const staleStatus = out.operation.status()
  assert.equal(staleStatus.phase, 'terminal')
  assert.equal(staleStatus.terminal.outcome, 'error')
  let delivered = false
  out.operation.observe(() => { delivered = true })
  assert.equal(delivered, false, 'stale observer does not deliver against the new generation')
})

test('client availability reports truthfully and never affects the host authority', async () => {
  const transport = transportFixture()
  const client = createClientSessionInteractionOperation({ transport, epoch: () => transport.currentEpoch() })
  assert.equal(client.availability().status, 'active')
  const offline = createClientSessionInteractionOperation({ transport: null, epoch: () => 0 })
  assert.equal(offline.availability().status, 'unavailable')
})