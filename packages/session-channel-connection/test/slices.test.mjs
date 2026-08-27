import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createTransportNegotiation,
  createFencingTable,
  createResumePrimitive,
  attachConnectionSlices,
} from '../lib/slices.js'
import { CODE_TRANSPORT_UNAVAILABLE, CODE_INVALID_INPUT, CODE_ABORTED, CODE_STALE_GENERATION, CONTRACT_SYMBOL } from '../lib/shared-vocab.js'

// ── Transport negotiation ───────────────────────────────────────────────────

test('transport negotiation: empty authorized → no transport negotiated', () => {
  const t = createTransportNegotiation({ advertised: ['websocket', 'sse'], authorized: [] })
  assert.deepEqual(t.negotiated(), [])
  const r = t.result()
  assert.equal(r.ok, false)
  assert.equal(r.error.code, CODE_TRANSPORT_UNAVAILABLE)
})

test('transport negotiation: intersection of advertised and authorized', () => {
  const t = createTransportNegotiation({ advertised: ['websocket', 'sse', 'polling'], authorized: ['websocket', 'loopback'] })
  assert.deepEqual(t.negotiated(), ['websocket'])
  assert.ok(t.canNegotiate('websocket'))
  assert.ok(!t.canNegotiate('sse'))
  assert.ok(!t.canNegotiate('polling'))
  assert.ok(!t.canNegotiate('loopback'))
})

test('transport negotiation: all advertised ∩ authorized → full list', () => {
  const t = createTransportNegotiation({ advertised: ['websocket', 'sse'], authorized: ['websocket', 'sse'] })
  assert.deepEqual(t.negotiated(), ['websocket', 'sse'])
  assert.ok(t.result().ok)
})

test('transport negotiation: unknown transport names are filtered out', () => {
  const t = createTransportNegotiation({ advertised: ['websocket', 'unknown'], authorized: ['websocket'] })
  assert.deepEqual(t.negotiated(), ['websocket'])
})

test('transport negotiation: loopback is a transport like any other', () => {
  const t = createTransportNegotiation({ advertised: ['loopback'], authorized: [] })
  assert.deepEqual(t.negotiated(), [])
  const t2 = createTransportNegotiation({ advertised: ['loopback'], authorized: ['loopback'] })
  assert.deepEqual(t2.negotiated(), ['loopback'])
})

// ── Fencing table ───────────────────────────────────────────────────────────

test('fencing: inactive when no facade attached', () => {
  const f = createFencingTable({ facade: () => undefined })
  assert.ok(!f.active)
  f.attach()
  assert.ok(!f.active, 'must stay inactive when facade remains undefined')
})

test('fencing: active after facade with CONTRACT_SYMBOL is attached', () => {
  const facade = { [CONTRACT_SYMBOL]: true, onChange: () => undefined }
  const f = createFencingTable({ facade: () => facade })
  f.attach()
  assert.ok(f.active)
})

test('fencing: bind and isCurrent round-trip', () => {
  const f = createFencingTable()
  assert.ok(f.bind('ch1', 'gen1'))
  assert.ok(f.isCurrent('ch1', 'gen1'))
  assert.ok(!f.isCurrent('ch1', 'gen2'))
  assert.ok(!f.isCurrent('ch2', 'gen1'))
})

test('fencing: bind rejects invalid inputs', () => {
  const f = createFencingTable()
  assert.ok(!f.bind('', 'gen1'))
  assert.ok(!f.bind('ch1', ''))
})

test('fencing: drop removes binding', () => {
  const f = createFencingTable()
  f.bind('ch1', 'gen1')
  assert.ok(f.isCurrent('ch1', 'gen1'))
  f.drop('ch1')
  assert.ok(!f.isCurrent('ch1', 'gen1'))
})

test('fencing: snapshot bounded output', () => {
  const f = createFencingTable()
  f.bind('ch1', 'gen1')
  f.bind('ch2', 'gen2')
  const snap = f.snapshot()
  assert.equal(snap.ch1, 'gen1')
  assert.equal(snap.ch2, 'gen2')
})

// ── Resume primitive ────────────────────────────────────────────────────────

test('resume: reattach with valid generation returns ok', async () => {
  const r = createResumePrimitive({ isCurrentGeneration: () => true })
  const result = await r.reattach('gen1')
  assert.ok(result.ok)
  assert.equal(result.carrier.connectionGeneration, 'gen1')
})

test('resume: reattach rejects invalid generation', async () => {
  const r = createResumePrimitive()
  const result = await r.reattach('')
  assert.equal(result.ok, false)
  assert.equal(result.error.code, CODE_INVALID_INPUT)
})

test('resume: reattach respects aborted signal', async () => {
  const r = createResumePrimitive()
  const ac = new AbortController()
  ac.abort()
  const result = await r.reattach('gen1', ac.signal)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, CODE_ABORTED)
})

test('resume: reattach rejects stale generation', async () => {
  const r = createResumePrimitive({ isCurrentGeneration: () => false })
  const result = await r.reattach('gen1')
  assert.equal(result.ok, false)
  assert.equal(result.error.code, CODE_STALE_GENERATION)
})

// ── attachConnectionSlices ──────────────────────────────────────────────────

test('attachConnectionSlices: adds transport, fencing, resume to a connection object', () => {
  const connection = { rpc: { handle() {}, intercept() {} } }
  const transport = createTransportNegotiation()
  const fencing = createFencingTable()
  const resume = createResumePrimitive()
  const result = attachConnectionSlices(connection, { transport, fencing, resume })
  assert.equal(typeof connection.transport, 'object')
  assert.equal(typeof connection.fencing, 'object')
  assert.equal(typeof connection.resume, 'object')
  assert.equal(typeof connection.transport.negotiated, 'function')
  assert.equal(typeof connection.fencing.bind, 'function')
  assert.equal(typeof connection.resume.reattach, 'function')
  assert.equal(typeof result.dispose, 'function')
})

test('attachConnectionSlices: dispose detaches fencing', () => {
  const connection = { rpc: { handle() {}, intercept() {} } }
  const fencing = createFencingTable()
  const result = attachConnectionSlices(connection, { fencing })
  assert.ok(result.dispose())
})