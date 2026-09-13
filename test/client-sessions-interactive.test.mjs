/**
 * Client-half tests for the pending-interaction and selection faces.
 *
 * The client members mirror the host shapes over the typed routes; they only
 * validate the wire shape (host-side redaction completes before
 * serialization), and every failure — absent transport, malformed payload, a
 * rebind mid-call — degrades to typed unavailable instead of a fabricated
 * view.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientSessionsInteractions } from '../lib/client-sessions-interactions.js'
import { createClientSessionsSelection } from '../lib/client-sessions-selection.js'
import {
  createInteractionsRouteHandler,
  createSelectionRouteHandler,
  INTERACTIONS_CLIENT_METHODS,
  SELECTION_CLIENT_METHODS,
} from '../lib/client-request-bridge.js'

const VIEW = Object.freeze({
  id: 'ix_1',
  kind: 'approval',
  sessionId: 's1',
  summary: 'Approval requested for tool "bash"',
  createdAt: '2026-09-14T00:00:00.000Z',
  answerShape: { kind: 'approval', actions: ['approve', 'reject', 'cancel'] },
})

const SELECTION_VIEW = Object.freeze({
  sessionId: 's1',
  provider: 'deepseek',
  model: 'v3',
  effort: null,
  revision: 0,
  source: 'committed',
  committedAt: null,
  observedAt: '2026-09-14T00:00:00.000Z',
})

function transportOf(answers) {
  const calls = []
  return {
    calls,
    request: async (method, payload) => {
      calls.push({ method, payload })
      return answers[method]
    },
  }
}

test('the client token lists cover exactly the routed members', () => {
  assert.deepEqual(INTERACTIONS_CLIENT_METHODS, ['sessions.interactions.list', 'sessions.interactions.get', 'sessions.interactions.respond', 'sessions.interactions.availability'])
  assert.deepEqual(SELECTION_CLIENT_METHODS, ['sessions.selection.get', 'sessions.selection.set', 'sessions.selection.availability'])
})

test('the interaction client mirrors the host shapes and freezes them', async () => {
  const transport = transportOf({
    'sessions.interactions.list': { ok: true, items: [VIEW], nextCursor: null, sources: { approval: 'active', question: 'unavailable' } },
    'sessions.interactions.get': { ok: true, view: VIEW },
    'sessions.interactions.respond': { ok: true, code: 'accepted' },
  })
  const face = createClientSessionsInteractions({ transport })
  const list = await face.list({ sessionId: 's1' })
  assert.equal(list.ok, true)
  assert.deepEqual(list.items[0], VIEW)
  assert.ok(Object.isFrozen(list.items[0]))
  assert.deepEqual(list.sources, { approval: 'active', question: 'unavailable' })
  assert.equal((await face.get({ id: 'ix_1' })).view.id, 'ix_1')
  assert.deepEqual(await face.respond({ id: 'ix_1', action: 'approve' }), { ok: true, code: 'accepted' })
  // host-side degradation rides through verbatim
  const degraded = transportOf({ 'sessions.interactions.list': { ok: false, code: 'unavailable', reason: 'the session source is unreachable' } })
  assert.equal((await createClientSessionsInteractions({ transport: degraded }).list({})).reason, 'the session source is unreachable')
})

test('malformed payloads and an absent carrier degrade to typed unavailable', async () => {
  const malformed = transportOf({
    'sessions.interactions.list': { ok: true, items: [{ id: 'ix_1' }] },
    'sessions.interactions.get': { ok: true, view: { id: 7 } },
    'sessions.interactions.respond': { ok: true, code: 'maybe' },
  })
  const face = createClientSessionsInteractions({ transport: malformed })
  assert.equal((await face.list({})).code, 'unavailable')
  assert.equal((await face.get({ id: 'ix_1' })).code, 'unavailable')
  assert.equal((await face.respond({ id: 'ix_1', action: 'approve' })).code, 'unavailable')

  const offline = createClientSessionsInteractions({ transport: null })
  assert.equal((await offline.list({})).code, 'unavailable')
  assert.match((await offline.list({})).reason, /transport is not wired/)
  assert.equal((await offline.availability()).status, 'unavailable')
})

test('a rebind mid-call degrades instead of writing into the newer generation', async () => {
  let epoch = 0
  const transport = {
    request: async () => {
      epoch += 1
      return { ok: true, items: [], nextCursor: null, sources: { approval: 'active', question: 'unavailable' } }
    },
  }
  const face = createClientSessionsInteractions({ transport, epoch: () => epoch })
  const outcome = await face.list({ sessionId: 's1' })
  assert.equal(outcome.code, 'unavailable')
  assert.match(outcome.reason, /generation changed/)
})

test('the selection client forwards expected and mirrors the typed outcome', async () => {
  const transport = transportOf({
    'sessions.selection.get': { ok: true, view: SELECTION_VIEW },
    'sessions.selection.set': { ok: true, code: 'committed', revision: 1, view: { ...SELECTION_VIEW, revision: 1 } },
  })
  const face = createClientSessionsSelection({ transport })
  assert.deepEqual((await face.get({ sessionId: 's1' })).view, SELECTION_VIEW)
  const committed = await face.set({ sessionId: 's1', selection: { model: 'v4' }, expected: { model: 'v3' } })
  assert.equal(committed.code, 'committed')
  assert.equal(committed.revision, 1)
  assert.deepEqual(transport.calls[1].payload.expected, { model: 'v3' }, 'the observed snapshot rides to the host CAS')

  const conflict = transportOf({ 'sessions.selection.set': { ok: false, code: 'conflict', reason: 'stale snapshot' } })
  const conflicted = await createClientSessionsSelection({ transport: conflict }).set({ sessionId: 's1', selection: { model: 'v4' } })
  assert.equal(conflicted.code, 'conflict')
})

test('the selection client refuses a malformed committed payload and an absent carrier', async () => {
  const malformed = transportOf({ 'sessions.selection.set': { ok: true, code: 'committed', revision: 1, view: { sessionId: 's1' } } })
  assert.equal((await createClientSessionsSelection({ transport: malformed }).set({ sessionId: 's1', selection: { model: 'v4' } })).code, 'unavailable')
  const offline = createClientSessionsSelection({ transport: null })
  assert.equal((await offline.get({ sessionId: 's1' })).code, 'unavailable')
  assert.equal((await offline.set({ sessionId: 's1', selection: { model: 'v4' } })).code, 'unavailable')
  assert.equal((await offline.availability()).status, 'unavailable')
})

test('the host route handlers dispatch by token and project value-only', async () => {
  const interactions = {
    list: (input) => ({ ok: true, items: [], nextCursor: null, sources: { approval: 'active', question: 'unavailable' }, echoed: input }),
    get: () => ({ ok: false, code: 'missing', reason: 'unknown interaction id' }),
    respond: (input) => ({ ok: true, code: 'accepted', echoedAction: input.action }),
  }
  const handler = createInteractionsRouteHandler({ interactions })
  assert.equal((await handler({ method: 'sessions.interactions.list', payload: { sessionId: 's1' } })).echoed.sessionId, 's1')
  assert.equal((await handler({ method: 'sessions.interactions.get', payload: { id: 'ix_1' } })).code, 'missing')
  assert.equal((await handler({ method: 'sessions.interactions.respond', payload: { id: 'ix_1', action: 'reject' } })).echoedAction, 'reject')
  assert.equal((await handler({ method: 'sessions.unknown', payload: {} })).code, 'unsupported')

  const selection = {
    get: () => ({ ok: true, view: SELECTION_VIEW }),
    set: () => ({ ok: true, code: 'committed', revision: 2, view: SELECTION_VIEW }),
  }
  const selectionHandler = createSelectionRouteHandler({ selection })
  assert.equal((await selectionHandler({ method: 'sessions.selection.get', payload: { sessionId: 's1' } })).view.model, 'v3')
  assert.equal((await selectionHandler({ method: 'sessions.selection.set', payload: { sessionId: 's1', selection: { model: 'v4' } } })).revision, 2)
  assert.equal((await selectionHandler({ method: 'nope' })).code, 'unsupported')
  // A callable member can never ride the carrier: the projection drops it.
  const withMethod = createInteractionsRouteHandler({ interactions: { list: () => ({ ok: true, items: [], nextCursor: null, sources: {}, method() {} }) } })
  assert.equal('method' in (await withMethod({ method: 'sessions.interactions.list' })), false)
})


test('client availability mirrors the host self-description instead of probing', async () => {
  const interactions = transportOf({
    'sessions.interactions.availability': { status: 'degraded', reason: 'the question source is unavailable on this runtime', sources: { approval: 'active', question: 'unavailable' } },
  })
  const face = createClientSessionsInteractions({ transport: interactions })
  const probe = await face.availability()
  assert.equal(probe.status, 'degraded', 'a degraded host is never displayed as active')
  assert.deepEqual(probe.sources, { approval: 'active', question: 'unavailable' })

  const selection = transportOf({ 'sessions.selection.availability': { status: 'degraded', reason: 'the official selection submit seam is not available; reads remain available' } })
  const selectionFace = createClientSessionsSelection({ transport: selection })
  const selectionProbe = await selectionFace.availability()
  assert.equal(selectionProbe.status, 'degraded')
  assert.match(selectionProbe.reason, /submit seam is not available/)

  const broken = transportOf({ 'sessions.selection.availability': { status: 'wat' } })
  assert.equal((await createClientSessionsSelection({ transport: broken }).availability()).status, 'unavailable')
})
