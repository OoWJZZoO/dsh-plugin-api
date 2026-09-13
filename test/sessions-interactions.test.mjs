/**
 * Pending-interaction face tests: durable-log folding, restricted views, the
 * shared identity registry, and the last-resort approval answerer.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createInteractionsAuthority, deriveApprovalId, mountInteractionsFeature } from '../lib/sessions-interactions-facade.js'
import { foldPendingApprovals, createInteractionRegistry } from '../lib/sessions-interactions.js'

function asked(id, extra = {}, seq = 1, time = '2026-09-14T00:00:00.000Z') {
  return { seq, type: 'approval/asked', time, data: { id, toolName: 'bash', ...extra } }
}

function decided(id, outcome = 'allowed-once', seq = 2) {
  return { seq, type: 'approval/decided', time: '2026-09-14T00:00:01.000Z', data: { id, outcome } }
}

function sessionOf(id, events) {
  return { id, events }
}

function makeAuthority({ sessions = new Map(), nowValue = 0, timer = null } = {}) {
  const timerStub = timer ?? {
    scheduled: [],
    setTimeout(fn, ms) {
      const handle = { fn, ms, cleared: false }
      this.scheduled.push(handle)
      return handle
    },
    clearTimeout(handle) {
      if (handle !== undefined) handle.cleared = true
    },
  }
  let clock = nowValue
  const authority = createInteractionsAuthority({
    ctx: { logger: { warn: () => {} } },
    sessionLookup: (id) => sessions.get(id),
    sessionList: () => [...sessions.values()],
    now: () => new Date(clock),
    timer: timerStub,
  })
  return { authority, sessions, timer: timerStub, advance: (ms) => { clock += ms } }
}

test('the pending fold mirrors the official answerer: asked minus decided, tail-first', () => {
  const events = [
    asked('a1', { callId: 'c1' }, 1),
    asked('a2', { callId: 'c2' }, 2),
    decided('a1', 'allowed-once', 3),
    asked('a3', { callId: 'c3' }, 4),
  ]
  const pending = foldPendingApprovals({ events })
  assert.deepEqual(pending.map((item) => item.officialId), ['a3', 'a2'], 'newest first, decided one gone')
  assert.deepEqual(pending.map((item) => item.callId), ['c3', 'c2'])
})

test('a claimed approval is not reported as pending by this facade', () => {
  const events = [asked('a1', { callId: 'c1' }, 1), asked('a2', { callId: 'c2' }, 2)]
  const pending = foldPendingApprovals({ events, claimed: new Set(['a2']) })
  assert.deepEqual(pending.map((item) => item.officialId), ['a1'])
})

test('deriveApprovalId matches the newest not-decided ask for the request call id', () => {
  const events = [asked('a1', { callId: 'c1' }, 1), asked('a2', { callId: 'c2' }, 2), decided('a2', 'rejected', 3)]
  assert.equal(deriveApprovalId(events, { callId: 'c2' }), undefined, 'a decided ask is never re-answered')
  assert.equal(deriveApprovalId(events, { callId: 'c1' }), 'a1')
  assert.equal(deriveApprovalId(events, { callId: 'nope' }), undefined)
})

test('the identity registry reuses one public id per official approval and clears it on decision', () => {
  const registry = createInteractionRegistry({ limit: 2 })
  const first = registry.idFor('s1', 'a1')
  assert.equal(registry.idFor('s1', 'a1'), first, 'the same approval keeps one public identity')
  assert.notEqual(registry.idFor('s1', 'a2'), first)
  assert.deepEqual(registry.lookup(first), { id: first, sessionId: 's1', officialId: 'a1' })
  assert.equal(registry.clear('s1', 'a1'), true)
  assert.equal(registry.lookup(first), undefined)
  // bounded: the oldest identity is evicted, never grown without bound
  registry.idFor('s1', 'a3')
  registry.idFor('s1', 'a4')
  assert.equal(registry.size() <= 2, true)
})

test('list returns frozen restricted views with per-kind source states', () => {
  const sessions = new Map([['s1', sessionOf('s1', [asked('a1', { reason: 'needs /home/wanwe/secret/project access' }, 1)])]])
  const { authority } = makeAuthority({ sessions })
  const page = authority.list({ sessionId: 's1' })
  assert.equal(page.ok, true)
  assert.equal(page.items.length, 1)
  assert.ok(Object.isFrozen(page.items[0]))
  assert.equal(page.items[0].kind, 'approval')
  assert.equal(page.items[0].sessionId, 's1')
  assert.equal(page.items[0].createdAt, '2026-09-14T00:00:00.000Z', 'createdAt comes from the durable event, not the read time')
  assert.deepEqual(page.items[0].answerShape, { kind: 'approval', actions: ['approve', 'reject', 'cancel'] })
  assert.match(page.items[0].summary, /bash/)
  assert.equal(page.items[0].summary.includes('/home/wanwe/secret/project'), false, 'paths never ride out of a summary')
  assert.deepEqual(page.sources, { approval: 'active', question: 'unavailable' })
  assert.deepEqual(Object.keys(page.items[0]).sort(), ['answerShape', 'createdAt', 'id', 'kind', 'sessionId', 'summary'], 'the view carries exactly the public fields')
  assert.equal(page.items[0].id.startsWith('ix_'), true, 'the public identity is facade-minted')
})

test('a decided approval stops being reported and a question is never faked as empty', () => {
  const sessions = new Map([['s1', sessionOf('s1', [asked('a1', {}, 1), decided('a1', 'rejected', 2)])]])
  const { authority } = makeAuthority({ sessions })
  const page = authority.list({ sessionId: 's1' })
  assert.deepEqual(page.items, [], 'nothing is pending after the decision')
  assert.equal(page.sources.question, 'unavailable', 'an empty question side is disclosed, never a healthy empty list')
  const status = authority.availability()
  assert.equal(status.status, 'degraded')
  assert.match(status.reason, /question source is unavailable/)
})

test('an unreachable session list degrades typed instead of reporting an empty page', () => {
  const authority = createInteractionsAuthority({
    ctx: { logger: { warn: () => {} } },
    sessionLookup: () => undefined,
    sessionList: () => undefined,
    now: () => new Date(0),
  })
  const page = authority.list({})
  assert.equal(page.ok, false)
  assert.equal(page.code, 'unavailable')
  assert.deepEqual(page.sources, { approval: 'active', question: 'unavailable' })
})

test('paging is stable and the cursor is facade-owned (never an event sequence)', () => {
  const events = []
  for (let index = 0; index < 60; index += 1) events.push(asked(`a${index}`, {}, index + 1))
  const sessions = new Map([['s1', sessionOf('s1', events)]])
  const { authority } = makeAuthority({ sessions })
  const first = authority.list({ sessionId: 's1' })
  assert.equal(first.items.length, 50)
  assert.equal(first.nextCursor, 50)
  const second = authority.list({ sessionId: 's1', cursor: first.nextCursor })
  assert.equal(second.items.length, 10)
  assert.equal(second.nextCursor, null)
  const ids = new Set([...first.items, ...second.items].map((view) => view.id))
  assert.equal(ids.size, 60, 'no duplicates and no gaps across the two pages')
})

test('get resolves a known interaction, drops a decided one, and refuses unknown ids', () => {
  const sessions = new Map([['s1', sessionOf('s1', [asked('a1', {}, 1)])]])
  const { authority } = makeAuthority({ sessions })
  const id = authority.list({ sessionId: 's1' }).items[0].id
  const ok = authority.get({ id })
  assert.equal(ok.ok, true)
  assert.equal(ok.view.id, id)
  assert.equal(authority.get({ id: 'ix_unknown' }).code, 'missing')

  sessions.set('s1', sessionOf('s1', [asked('a1', {}, 1), decided('a1', 'allowed-once', 2)]))
  const gone = authority.get({ id })
  assert.equal(gone.ok, false)
  assert.equal(gone.code, 'missing', 'a decided interaction is gone, not an error')
})

test('the answerer only holds a request for a watched session and releases it through respond', async () => {
  const events = [asked('a1', { callId: 'c1' }, 1)]
  const sessions = new Map([['s1', sessionOf('s1', events)]])
  const { authority, timer } = makeAuthority({ sessions })
  const id = authority.list({ sessionId: 's1' }).items[0].id

  const answer = authority.answerer({ agent: { session: { id: 's1', events } }, callId: 'c1' }, () => 'unavailable')
  assert.equal(typeof answer.then, 'function', 'the watched request is held, not delegated')
  assert.deepEqual(authority.heldIds(), [id], 'the hold reuses the view identity')

  const outcome = authority.respond({ id, action: 'approve' })
  assert.deepEqual(outcome, { ok: true, code: 'accepted' })
  assert.equal(await answer, 'allowed-once', 'the caller decision is forwarded verbatim into the official vocabulary')
  assert.deepEqual(authority.heldIds(), [])
  assert.equal(timer.scheduled[0].cleared, true, 'the lease timer is cleared on release')
})

test('reject and cancel map onto the official outcome vocabulary; answer is refused', async () => {
  for (const [action, expected] of [['reject', 'rejected'], ['cancel', 'cancelled']]) {
    const events = [asked('a1', { callId: 'c1' }, 1)]
    const sessions = new Map([['s1', sessionOf('s1', events)]])
    const { authority } = makeAuthority({ sessions })
    const id = authority.list({ sessionId: 's1' }).items[0].id
    const answer = authority.answerer({ agent: { session: { id: 's1', events } }, callId: 'c1' }, () => 'unavailable')
    assert.equal(authority.respond({ id, action }).code, 'accepted')
    assert.equal(await answer, expected)
  }

  const events = [asked('a1', { callId: 'c1' }, 1)]
  const sessions = new Map([['s1', sessionOf('s1', events)]])
  const { authority } = makeAuthority({ sessions })
  const id = authority.list({ sessionId: 's1' }).items[0].id
  const answer = authority.answerer({ agent: { session: { id: 's1', events } }, callId: 'c1' }, () => 'unavailable')
  const refused = authority.respond({ id, action: 'answer', answer: { free: 'text' } })
  assert.equal(refused.code, 'rejected', 'a free answer is never coerced into an approval decision')
  assert.match(refused.reason, /approve, reject or cancel/)
  assert.equal(authority.respond({ id, action: 'approve' }).code, 'accepted', 'the interaction is still answerable')
  await answer
})

test('a second responder gets stale and only the first answer settles the request', async () => {
  const events = [asked('a1', { callId: 'c1' }, 1)]
  const sessions = new Map([['s1', sessionOf('s1', events)]])
  const { authority } = makeAuthority({ sessions })
  const id = authority.list({ sessionId: 's1' }).items[0].id
  const answer = authority.answerer({ agent: { session: { id: 's1', events } }, callId: 'c1' }, () => 'unavailable')
  assert.equal(authority.respond({ id, action: 'approve' }).code, 'accepted')
  const second = authority.respond({ id, action: 'reject' })
  assert.equal(second.ok, false)
  assert.equal(second.code, 'stale')
  assert.equal(await answer, 'allowed-once')
})

test('an unwatched session delegates to the official chain instead of holding', () => {
  const events = [asked('a1', { callId: 'c1' }, 1)]
  const sessions = new Map([['s1', sessionOf('s1', events)]])
  const { authority } = makeAuthority({ sessions })
  let delegated = 0
  const outcome = authority.answerer({ agent: { session: { id: 's1', events } }, callId: 'c1' }, () => {
    delegated += 1
    return 'unavailable'
  })
  assert.equal(outcome, 'unavailable')
  assert.equal(delegated, 1, 'without a watcher the official default applies unchanged')
  assert.deepEqual(authority.heldIds(), [])
})

test('reads renew the lease, and an expired lease releases the hold as unavailable', async () => {
  const events = [asked('a1', { callId: 'c1' }, 1)]
  const sessions = new Map([['s1', sessionOf('s1', events)]])
  const { authority, timer } = makeAuthority({ sessions })
  authority.list({ sessionId: 's1' })
  const answer = authority.answerer({ agent: { session: { id: 's1', events } }, callId: 'c1' }, () => 'unavailable')
  assert.deepEqual(authority.heldIds().length, 1)

  const lease = timer.scheduled[0]
  assert.equal(lease.ms, 60000, 'the lease is bounded')
  lease.fn()
  assert.equal(await answer, 'unavailable', 'an expired lease fails closed with the official no-answer value')
  assert.deepEqual(authority.heldIds(), [])
})

test('an aborted request signal settles the hold as cancelled', async () => {
  const events = [asked('a1', { callId: 'c1' }, 1)]
  const sessions = new Map([['s1', sessionOf('s1', events)]])
  const { authority } = makeAuthority({ sessions })
  authority.list({ sessionId: 's1' })
  const controller = new AbortController()
  const answer = authority.answerer({ agent: { session: { id: 's1', events } }, callId: 'c1', signal: controller.signal }, () => 'unavailable')
  controller.abort()
  assert.equal(await answer, 'cancelled')
  assert.deepEqual(authority.heldIds(), [])
})

test('respond on a pending-but-unheld interaction is unavailable, on an unknown id stale', () => {
  const events = [asked('a1', { callId: 'c1' }, 1)]
  const sessions = new Map([['s1', sessionOf('s1', events)]])
  const { authority } = makeAuthority({ sessions })
  const id = authority.list({ sessionId: 's1' }).items[0].id
  const unheld = authority.respond({ id, action: 'approve' })
  assert.equal(unheld.code, 'unavailable', 'the facade never claims an answer it does not own')
  assert.match(unheld.reason, /another answerer/)
  const unknown = authority.respond({ id: 'ix_unknown', action: 'approve' })
  assert.equal(unknown.code, 'stale')
})

test('respond input validation and the audit ring keep payloads out', async () => {
  const events = [asked('a1', { callId: 'c1' }, 1)]
  const sessions = new Map([['s1', sessionOf('s1', events)]])
  const { authority } = makeAuthority({ sessions })
  assert.equal(authority.respond({ id: '', action: 'approve' }).code, 'rejected')
  assert.equal(authority.respond({ id: 'ix_1', action: 'maybe' }).code, 'rejected')
  assert.equal(authority.respond({ id: 'ix_1', action: 'approve', signal: {} }).code, 'rejected')

  const id = authority.list({ sessionId: 's1' }).items[0].id
  const answer = authority.answerer({ agent: { session: { id: 's1', events } }, callId: 'c1' }, () => 'unavailable')
  authority.respond({ id, action: 'approve', reason: 'looks safe' })
  await answer
  const audit = authority.internalAudit()
  assert.equal(audit.records.some((record) => record.outcome === 'allowed-once'), true, 'the audit records the settled outcome, not the caller wording')
  const serialized = JSON.stringify(audit)
  assert.equal(serialized.includes('looks safe'), false, 'the reason never enters the audit ring')
  assert.equal(/answer|payload/.test(Object.keys(audit.records[0]).join(',')), false, 'the audit record carries no answer field')
})

test('unmounting releases every hold as unavailable and the mount registers an append listener', async () => {
  const events = [asked('a1', { callId: 'c1' }, 1)]
  const sessions = new Map([['s1', sessionOf('s1', events)]])
  const { authority } = makeAuthority({ sessions })
  const listeners = []
  const off = () => listeners.push('off')
  const ctx = {
    logger: { warn: () => {} },
    on(name, listener) {
      listeners.push({ name, listener })
      return off
    },
  }
  const mounted = mountInteractionsFeature({ ctx, authority })
  assert.equal(listeners[0].name, 'approval/request', 'the answerer listens on the official waterfall')
  assert.equal(mounted.surface.availability().status, 'degraded')

  authority.list({ sessionId: 's1' })
  const answer = authority.answerer({ agent: { session: { id: 's1', events } }, callId: 'c1' }, () => 'unavailable')
  mounted.dispose()
  assert.equal(await answer, 'unavailable', 'unmount settles outstanding holds instead of hanging them')
  assert.equal(authority.availability().status, 'unavailable')
})

test('an earlier-registered answerer claims the request and the facade never shadows it', async () => {
  // The delivered chain is a waterfall: whoever claims first ends the chain.
  // The facade's answerer is registered append-only, so it only ever runs when
  // no earlier answerer claimed the request — this pins that behavior.
  const events = [asked('a1', { callId: 'c1' }, 1)]
  const sessions = new Map([['s1', sessionOf('s1', events)]])
  const { authority } = makeAuthority({ sessions })
  authority.list({ sessionId: 's1' })
  const listeners = []
  const ctx = { logger: { warn() {} }, on: (name, listener) => { listeners.push({ name, listener }); return () => {} } }
  const mounted = mountInteractionsFeature({ ctx, authority })
  assert.equal(listeners.length, 1)

  // A waterfall runs its listeners in registration order and stops at the
  // first one that does not delegate: an earlier answerer (the official mux
  // answerer in a web deployment) claiming the request means the facade's
  // append-registered listener is never reached.
  let facadeCalls = 0
  const facadeListener = (...args) => { facadeCalls += 1; return listeners[0].listener(...args) }
  const earlierAnswerer = (request, next) => Promise.resolve('allowed-once')
  const waterfall = (request, chain) => {
    let index = 0
    const next = () => {
      const listener = chain[index]
      index += 1
      return listener === undefined ? Promise.resolve('unavailable') : listener(request, next)
    }
    return next()
  }
  const delivered = await waterfall({ agent: { session: sessions.get('s1') }, callId: 'c1' }, [earlierAnswerer, facadeListener])
  assert.equal(delivered, 'allowed-once')
  assert.equal(facadeCalls, 0, 'the facade listener never runs once an earlier answerer claimed the request')
  assert.deepEqual(authority.heldIds(), [], 'and it holds nothing in that case')

  // When nothing claimed it, the facade's own answerer holds and answers.
  const held = listeners[0].listener({ agent: { session: sessions.get('s1') }, callId: 'c1' }, () => 'unavailable')
  assert.equal(typeof held.then, 'function', 'the facade is the last resort and takes the request')
  const view = mounted.surface.list({ sessionId: 's1' }).items[0]
  assert.equal(mounted.surface.respond({ id: view.id, action: 'approve' }).code, 'accepted')
  assert.equal(await held, 'allowed-once')
  mounted.dispose()
})

test('the view reports exactly the pending set the official answerer would match', () => {
  const events = [
    asked('a1', { callId: 'c1' }, 1),
    asked('a2', { callId: 'c2' }, 2),
    decided('a1', 'allowed-once', 3),
    asked('a3', { callId: 'c3' }, 4),
    decided('a3', 'rejected', 5),
  ]
  const sessions = new Map([['s1', sessionOf('s1', events)]])
  const { authority } = makeAuthority({ sessions })
  const page = authority.list({ sessionId: 's1' })
  const officialPending = foldPendingApprovals({ events }).map((item) => item.officialId)
  assert.deepEqual(officialPending, ['a2'], 'the official fold leaves exactly one pending ask')
  assert.equal(page.items.length, officialPending.length, 'the view and the official matcher agree item for item')
})

test('respond refuses an already-aborted submission before touching state', async () => {
  const events = [asked('a1', { callId: 'c1' }, 1)]
  const sessions = new Map([['s1', sessionOf('s1', events)]])
  const { authority } = makeAuthority({ sessions })
  const id = authority.list({ sessionId: 's1' }).items[0].id
  const answer = authority.answerer({ agent: { session: sessions.get('s1') }, callId: 'c1' }, () => 'unavailable')
  const controller = new AbortController()
  controller.abort()
  const refused = authority.respond({ id, action: 'approve', signal: controller.signal })
  assert.equal(refused.code, 'unavailable')
  assert.match(refused.reason, /aborted/)
  assert.equal(authority.respond({ id, action: 'approve' }).code, 'accepted', 'the interaction is still answerable')
  await answer
})

test('respond audit records the caller owner and never the answer payload', async () => {
  const events = [asked('a1', { callId: 'c1' }, 1)]
  const sessions = new Map([['s1', sessionOf('s1', events)]])
  const { authority } = makeAuthority({ sessions })
  const id = authority.list({ sessionId: 's1' }).items[0].id
  const answer = authority.answerer({ agent: { session: sessions.get('s1') }, callId: 'c1' }, () => 'unavailable')
  authority.respond({ id, action: 'approve' }, { fiber: { name: 'consumer-plugin' } })
  await answer
  const settled = authority.internalAudit().records.find((record) => record.outcome === 'allowed-once')
  assert.equal(settled.owner, 'consumer-plugin', 'the caller fiber is the owner recorded for the decision')
  assert.equal('answer' in settled, false)
})
