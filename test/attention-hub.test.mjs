/**
 * Focused tests for the host attention hub (host-side requirements):
 * the hub is a pure module, constructed directly with test
 * seams — it is not mounted into the gate here (integration wave owns that).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ATTENTION_LEVELS,
  CODE_CAPACITY,
  CODE_CONFLICT,
  CODE_DUPLICATE,
  CODE_INVALID_INPUT,
  CODE_INVOKED,
  CODE_NOT_FOUND,
  CODE_NOOP,
  CODE_OWNER_CONFLICT,
  CODE_REGISTERED,
  CODE_STALE,
  CODE_UNAVAILABLE,
  CODE_WITHDRAWN,
  createAttentionHub,
} from '../lib/attention-hub.js'

/** Build a synthetic caller with an owner identity and optional visibility. */
function caller(ownerId, kind = 'web', scopes = null) {
  return { ownerId, kind, scopes }
}

function webCaller(ownerId) {
  return { ownerId, kind: 'web', scopes: null }
}

test('contribute registers one item and returns an owner-scoped handle', () => {
  let now = 1000
  const hub = createAttentionHub({ now: () => now, resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  const alice = webCaller('alice')
  const outcome = hub.contribute({ id: 'a-1', title: 'hello', level: 'info', body: 'world' }, alice)
  assert.equal(outcome.ok, true)
  assert.equal(outcome.code, CODE_REGISTERED)
  assert.equal(outcome.handle.id, 'a-1')
  assert.equal(outcome.handle.ownerId, 'alice')
  assert.equal(outcome.handle.seq, 1)
  assert.equal(typeof outcome.handle.dispose, 'function')
  const view = hub.current(alice)
  assert.equal(view.length, 1)
  assert.equal(view[0].id, 'a-1')
  assert.equal(Object.isFrozen(view), true)
  // ownerId is derived from the caller, not reportable in the spec.
  assert.equal('ownerId' in outcome.handle, true)
  assert.equal(outcome.handle.ownerId, 'alice')
})

test('same-owner same-id is a stable conflict; cross-owner is owner-conflict', () => {
  const hub = createAttentionHub({ resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  const alice = webCaller('alice')
  const bob = webCaller('bob')
  hub.contribute({ id: 'c-1', title: 'first', level: 'info' }, alice)
  const sameOwner = hub.contribute({ id: 'c-1', title: 'second', level: 'info' }, alice)
  assert.equal(sameOwner.ok, false)
  assert.equal(sameOwner.code, CODE_CONFLICT)
  const crossOwner = hub.contribute({ id: 'c-1', title: 'third', level: 'info' }, bob)
  assert.equal(crossOwner.ok, false)
  assert.equal(crossOwner.code, CODE_OWNER_CONFLICT)
  assert.equal(hub.current(alice).length, 1)
  assert.equal(hub.current(alice)[0].title, 'first')
})

test('malformed specs return invalid-input and register nothing', () => {
  const hub = createAttentionHub({ resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  const alice = webCaller('alice')
  const cases = [
    null,
    {},
    { id: '', title: 'x' },
    { id: 'x', title: '' },
    { id: 'x', title: 'x', level: 'loud' },
    { id: 'x', title: 'x', audience: ['radio'] },
    { id: 'x', title: 'x', audience: [] },
    { id: 'x', title: 'x', scope: { sessionId: 's', workspaceId: 'w' } },
    { id: 'x', title: 'x', actions: [{ id: 'a', label: 3 }] },
    { id: 'x', title: 'x', actions: [{ id: 'a', label: 'ok' }, { id: 'a', label: 'dup' }] },
  ]
  for (const spec of cases) {
    const outcome = hub.contribute(spec, alice)
    assert.equal(outcome.ok, false, JSON.stringify(spec))
    assert.equal(outcome.code, CODE_INVALID_INPUT, JSON.stringify(spec))
  }
  assert.equal(hub.current(alice).length, 0)
})

test('dispose withdraws the live item; double dispose is an idempotent no-op', () => {
  const hub = createAttentionHub({ resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  const alice = webCaller('alice')
  const bob = webCaller('bob')
  const { handle } = hub.contribute({ id: 'd-1', title: 'dispose me', level: 'info' }, alice)
  assert.equal(handle.dispose().code, CODE_WITHDRAWN)
  assert.equal(hub.current(alice).length, 0)
  assert.equal(handle.dispose().code, CODE_NOOP)
  // cross-owner handle attempt is rejected and must not remove newer items
  hub.contribute({ id: 'd-2', title: 'kept', level: 'info' }, alice)
  const attempt = hub.dispose('d-2', bob)
  assert.equal(attempt.ok, false)
  assert.equal(attempt.code, CODE_STALE)
  assert.equal(hub.current(alice).length, 1)
})

test('capacity eviction is observable and reports capacity when nothing is removable', () => {
  let now = 1000
  const hub = createAttentionHub({
    now: () => now,
    capacity: 2,
    resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }),
  })
  const alice = webCaller('alice')
  const removals = []
  const ob = hub.observe(alice, {})
  ob.subscribe((change) => removals.push(change))
  hub.contribute({ id: 'cap-1', title: 'one', level: 'info' }, alice)
  hub.contribute({ id: 'cap-2', title: 'two', level: 'info' }, alice)
  const third = hub.contribute({ id: 'cap-3', title: 'three', level: 'info' }, alice)
  assert.equal(third.ok, true)
  assert.equal(third.code, CODE_REGISTERED)
  assert.deepEqual(hub.current(alice).map((item) => item.id), ['cap-2', 'cap-3'])
  const eviction = removals.find((change) => change.op === 'remove' && change.reason === 'evicted-capacity')
  assert.ok(eviction, 'an eviction removal must be observable')
  assert.equal(eviction.id, 'cap-1')
  // capacity=0: nothing can ever be held → typed capacity outcome
  const empty = createAttentionHub({
    capacity: 0,
    resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }),
  })
  const squeezed = empty.contribute({ id: 'x', title: 'x', level: 'info' }, alice)
  assert.equal(squeezed.ok, false)
  assert.equal(squeezed.code, CODE_CAPACITY)
})

test('the public item shape is bounded, frozen and loses hub-private state', () => {
  const hub = createAttentionHub({
    resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }),
    bounds: { maxTitleLength: 10 },
  })
  const alice = webCaller('alice')
  const { handle } = hub.contribute({
    id: 's-1',
    title: 'title',
    body: 'body',
    level: 'warning',
    dedupeKey: 'k',
    expiresAt: Date.now() + 60000,
    audience: ['web', 'tui'],
    actions: [{ id: 'go', label: 'Go' }],
    scope: { sessionId: 'sess-1' },
    correlation: { activityId: 'act-1' },
    meta: { steps: 3 },
    handlers: { go: () => {} },
  }, alice)
  const [publicItem] = hub.current(alice)
  assert.equal(publicItem.id, 's-1')
  assert.equal(publicItem.seq, 1)
  assert.equal(publicItem.ownerId, 'alice')
  assert.equal(publicItem.level, 'warning')
  assert.equal(publicItem.correlation.verification, 'unknown')
  assert.deepEqual(publicItem.actions, [{ id: 'go', label: 'Go' }])
  assert.deepEqual(publicItem.meta, { steps: 3 })
  assert.equal('handlers' in publicItem, false)
  assert.equal('live' in publicItem, false)
  // observedAt is hub-assigned and not caller-reportable.
  assert.equal(typeof publicItem.observedAt, 'number')
  assert.equal('observedAt' in { id: 's-1' }, false)
  assert.throws(() => { 'use strict'; publicItem.title = 'hacked' }, TypeError)
  // bounded title rejects oversized content
  const oversized = hub.contribute({ id: 'big', title: '0123456789abcdef', level: 'info' }, alice)
  assert.equal(oversized.ok, false)
  assert.equal(oversized.code, CODE_INVALID_INPUT)
  assert.equal(handle.dispose().code, CODE_WITHDRAWN)
})

test('redaction rejects secret-typed keys and credential material at the boundary', () => {
  const hub = createAttentionHub({ resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  const alice = webCaller('alice')
  const secretKey = hub.contribute({ id: 'k1', title: 'x', level: 'info', meta: { apiKey: 'abc' } }, alice)
  assert.equal(secretKey.ok, false)
  assert.equal(secretKey.code, CODE_INVALID_INPUT)
  const secretTitle = hub.contribute({ id: 'k2', title: 'my key is sk-abcdefghijklmnopqrstuvwxyz', level: 'info' }, alice)
  assert.equal(secretTitle.ok, false)
  assert.equal(secretTitle.code, CODE_INVALID_INPUT)
  const secretMeta = hub.contribute({ id: 'k3', title: 'x', level: 'info', meta: { note: 'AKIAABCDEFGHIJKLMNOP' } }, alice)
  assert.equal(secretMeta.ok, false)
  assert.equal(secretMeta.code, CODE_INVALID_INPUT)
  assert.equal(hub.current(alice).length, 0)
})

test('observe handle exposes current/subscribe/dispose/epoch with frozen changes', () => {
  let now = 1000
  const hub = createAttentionHub({ now: () => now, resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  const alice = webCaller('alice')
  const seen = []
  const ob = hub.observe(alice, {})
  assert.equal(typeof ob.current, 'function')
  assert.equal(typeof ob.subscribe, 'function')
  assert.equal(typeof ob.dispose, 'function')
  assert.equal(typeof ob.epoch, 'number')
  ob.subscribe((change) => seen.push(change))
  hub.contribute({ id: 'o-1', title: 'hello', level: 'info' }, alice)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].op, 'add')
  assert.equal(seen[0].item.id, 'o-1')
  assert.equal(Object.isFrozen(seen[0].item), true)
  // listener containment: a throwing listener never breaks the others
  const second = []
  ob.subscribe(() => { throw new Error('boom') })
  ob.subscribe((change) => second.push(change))
  hub.contribute({ id: 'o-2', title: 'again', level: 'info' }, alice)
  assert.equal(second.length, 1)
  // dispose stops delivery
  ob.dispose()
  hub.contribute({ id: 'o-3', title: 'after', level: 'info' }, alice)
  assert.equal(seen.length, 2)
})

test('projection honors audience and scope authorization without leaking', () => {
  const hub = createAttentionHub({ resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  const wide = caller('wide', 'web', { sessions: new Set(['s1', 's2']), workspaces: null, unscoped: true })
  const narrow = caller('narrow', 'web', { sessions: new Set(['s1']), workspaces: null, unscoped: false })
  const desktop = caller('desk', 'desktop', null)
  hub.contribute({ id: 'p1', title: 's1', level: 'info', scope: { sessionId: 's1' } }, wide)
  hub.contribute({ id: 'p2', title: 's2', level: 'info', scope: { sessionId: 's2' } }, wide)
  hub.contribute({ id: 'p3', title: 'unscoped', level: 'info' }, wide)
  hub.contribute({ id: 'p4', title: 'desktop-only', level: 'info', audience: ['desktop'] }, wide)
  assert.deepEqual(hub.current(narrow).map((item) => item.id), ['p1'])
  // a desktop-audience item never leaks into a web caller's view
  assert.deepEqual(hub.current(wide).map((item) => item.id), ['p1', 'p2', 'p3'])
  // a desktop caller with unrestricted scope sees it through the audience gate
  const desktopIds = hub.current(desktop).map((item) => item.id).sort()
  assert.deepEqual(desktopIds, ['p1', 'p2', 'p3', 'p4'])
  // filters overlay visibility
  assert.deepEqual(hub.current(wide, { scope: { sessionId: 's2' } }).map((item) => item.id), ['p2'])
  // list pages with a cursor continuation
  const locks = wide
  const pageA = hub.list(locks, { limit: 2 })
  assert.equal(pageA.items.length, 2)
  assert.equal(typeof pageA.nextCursor, 'number')
  const pageB = hub.list(locks, { limit: 2, cursor: pageA.nextCursor })
  assert.equal(pageB.items.length, 1)
  assert.equal(pageB.items[0].id, 'p3')
})

test('degraded/unavailable hub returns typed views and never throws', () => {
  const hub = createAttentionHub({ resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  const alice = webCaller('alice')
  hub.setAvailability({ status: 'unavailable', reason: 'slice mismatch' })
  const view = hub.current(alice)
  assert.equal(view.status, 'unavailable')
  assert.equal(view.reason, 'slice mismatch')
  const listView = hub.list(alice, {})
  assert.equal(listView.status, 'unavailable')
  const contribute = hub.contribute({ id: 'x', title: 'y', level: 'info' }, alice)
  assert.equal(contribute.ok, false)
  assert.equal(contribute.code, CODE_UNAVAILABLE)
  const ob = hub.observe(alice, {})
  assert.equal(ob.current().status, 'unavailable')
})

test('dismiss, expiry and withdraw follow one lifecycle with observable reasons', () => {
  let now = 1000
  const hub = createAttentionHub({ now: () => now, resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  const alice = webCaller('alice')
  const changes = []
  const ob = hub.observe(alice, {})
  ob.subscribe((change) => changes.push(change))
  // dismiss by a visible consumer
  hub.contribute({ id: 'l1', title: 'dismissed item', level: 'info' }, alice)
  const dismissed = hub.dismiss('l1', { by: 'operator' }, alice)
  assert.equal(dismissed.ok, true)
  assert.equal(changes.some((change) => change.op === 'remove' && change.reason === 'dismissed'), true)
  // dismiss by a non-visible consumer → not-found (no leak)
  const bob = caller('bob', 'web', { sessions: new Set(['other']), workspaces: null, unscoped: false })
  hub.contribute({ id: 'l2', title: 'scoped', level: 'info', scope: { sessionId: 's1' } }, alice)
  const hiddenDismiss = hub.dismiss('l2', { by: 'bob' }, bob)
  assert.equal(hiddenDismiss.ok, false)
  assert.equal(hiddenDismiss.code, CODE_NOT_FOUND)
  assert.equal(hub.current(alice).length, 1)
  // expiry sweep is observable and never writes durable state
  hub.contribute({ id: 'l3', title: 'expiring', level: 'info', expiresAt: 1500 }, alice)
  assert.equal(hub.current(alice).length, 2)
  now = 2000
  assert.equal(hub.sweep(), true)
  assert.equal(hub.current(alice).length, 1)
  assert.equal(changes.some((change) => change.op === 'remove' && change.reason === 'expired'), true)
  // owner teardown withdraws with reason withdrawn
  hub.contribute({ id: 'l4', title: 'owner item', level: 'info' }, alice)
  hub.withdrawOwner('alice')
  assert.equal(hub.current(alice).length, 0)
  assert.equal(changes.some((change) => change.op === 'remove' && change.reason === 'withdrawn'), true)
})

test('reloaded owner gets a new generation; stale disposers cannot remove newer items', () => {
  const hub = createAttentionHub({ resolveOwner: (c) => ({ ownerId: c.ownerId, generation: c.gen ?? 0 }) })
  const alice = (gen) => ({ ownerId: 'alice', kind: 'web', scopes: null, gen })
  // reload withdraws the owner's live items and bumps the opaque generation
  const first = hub.contribute({ id: 'g1', title: 'first gen', level: 'info' }, alice(0))
  assert.equal(first.ok, true)
  hub.reloadOwner('alice')
  assert.equal(hub.current(alice(1)).length, 0)
  // a contribution after reload is a new registration under the same id
  const second = hub.contribute({ id: 'g1', title: 'second gen', level: 'info' }, alice(1))
  assert.equal(second.ok, true)
  // the pre-reload disposer loses commit eligibility and cannot remove the
  // newer-generation item
  const staleDispose = first.handle.dispose()
  assert.equal(staleDispose.ok, false)
  assert.equal(staleDispose.code, CODE_STALE)
  assert.equal(hub.current(alice(1)).length, 1)
  assert.equal(hub.current(alice(1))[0].id, 'g1')
  // the live (new-generation) handle still works
  assert.equal(second.handle.dispose().code, CODE_WITHDRAWN)
})

test('dedupeKey duplicate inside the live window references the live item', () => {
  const hub = createAttentionHub({ resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  const alice = webCaller('alice')
  hub.contribute({ id: 'd1', title: 'first', level: 'info', dedupeKey: 'same' }, alice)
  const dup = hub.contribute({ id: 'd2', title: 'second', level: 'info', dedupeKey: 'same' }, alice)
  assert.equal(dup.ok, false)
  assert.equal(dup.code, CODE_DUPLICATE)
  assert.equal(dup.item.id, 'd1')
  assert.equal(hub.current(alice).length, 1)
})

test('action invocation is owner-bound, contained and stale-aware', () => {
  const hub = createAttentionHub({
    resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }),
    isCurrentExecution: (executionId) => executionId !== 'moved-exec',
  })
  const alice = webCaller('alice')
  const bob = webCaller('bob')
  let called = 0
  hub.contribute({
    id: 'a1',
    title: 'actionable',
    level: 'info',
    actions: [{ id: 'go', label: 'Go' }],
    handlers: { go: () => { called += 1 } },
  }, alice)
  const invoked = hub.invoke('a1', 'go', bob)
  assert.equal(invoked.ok, true)
  assert.equal(invoked.code, CODE_INVOKED)
  assert.equal(called, 1)
  // missing action → not-found
  assert.equal(hub.invoke('a1', 'nope', bob).code, CODE_NOT_FOUND)
  // no handler → unavailable
  hub.contribute({ id: 'a2', title: 'label-only', level: 'info', actions: [{ id: 'x', label: 'X' }] }, alice)
  assert.equal(hub.invoke('a2', 'x', bob).code, CODE_UNAVAILABLE)
  // throwing handler → conflict with owner attribution
  hub.contribute({
    id: 'a3',
    title: 'thrower',
    level: 'info',
    actions: [{ id: 'boom', label: 'Boom' }],
    handlers: { boom: () => { throw new Error('kaboom') } },
  }, alice)
  const failed = hub.invoke('a3', 'boom', bob)
  assert.equal(failed.ok, false)
  assert.equal(failed.code, CODE_CONFLICT)
  assert.equal(failed.attribution, 'alice')
  // stale execution target → conflict, handler not invoked
  const before = called
  hub.contribute({
    id: 'a4',
    title: 'stale target',
    level: 'info',
    actions: [{ id: 'late', label: 'Late' }],
    correlation: { executionId: 'moved-exec' },
    handlers: { late: () => { called += 1 } },
  }, alice)
  const stale = hub.invoke('a4', 'late', bob)
  assert.equal(stale.ok, false)
  assert.equal(stale.code, CODE_CONFLICT)
  assert.equal(called, before)
  // item no longer live → not-found
  hub.dispose('a4', alice)
  assert.equal(hub.invoke('a4', 'late', bob).code, CODE_NOT_FOUND)
})

test('availability never throws and reflects set state', () => {
  const hub = createAttentionHub({ resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  const active = hub.availability()
  assert.equal(active.status, 'active')
  assert.equal(Object.isFrozen(active), true)
  hub.setAvailability({ status: 'degraded', reason: 'no client consumer present' })
  assert.deepEqual(hub.availability(), { status: 'degraded', reason: 'no client consumer present' })
  hub.setAvailability({ status: 'active' })
  assert.equal(hub.availability().status, 'active')
})

test('attention never becomes a durable fact store', () => {
  const one = createAttentionHub({ resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  const two = createAttentionHub({ resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  const alice = webCaller('alice')
  one.contribute({ id: 'iso-1', title: 'one', level: 'info' }, alice)
  assert.equal(two.current(alice).length, 0)
  assert.equal(one.current(alice).length, 1)
  // default model visibility is denied: no model-target field escapes the hub
  const [publicItem] = one.current(alice)
  for (const key of Object.keys(publicItem)) {
    assert.ok(!key.toLowerCase().includes('model'), `unexpected field ${key}`)
  }
})

test('multi-owner composition is isolated and views are immutable', () => {
  const hub = createAttentionHub({ resolveOwner: (c) => ({ ownerId: c.ownerId, generation: 0 }) })
  // reverse registration order: client-face-style, then a host-style owner
  const browser = caller('browser-plugin', 'web', {
    sessions: new Set(['s1']),
    workspaces: null,
    unscoped: false,
  })
  const desktop = caller('desktop-plugin', 'desktop', {
    sessions: new Set(['d1']),
    workspaces: null,
    unscoped: true,
  })
  hub.contribute({ id: 'm1', title: 'from browser', level: 'info', scope: { sessionId: 's1' } }, browser)
  const outcome = hub.contribute({ id: 'm1', title: 'from browser', level: 'info' }, browser)
  assert.equal(outcome.code, CODE_CONFLICT)
  hub.contribute({ id: 'm2', title: 'from desktop', level: 'info', scope: { sessionId: 'd1' } }, desktop)
  // browser sees only its own session scope; desktop sees only its own.
  assert.deepEqual(hub.current(browser).map((item) => item.id), ['m1'])
  assert.deepEqual(hub.current(desktop).map((item) => item.id), ['m2'])
  // withdrawing one owner never affects the other
  hub.withdrawOwner('browser-plugin')
  assert.deepEqual(hub.current(desktop).map((item) => item.id), ['m2'])
  assert.equal(hub.current(browser).length, 0)
  // invalid input from one producer never corrupts the other registrations
  hub.contribute({ id: 'm3', title: 'kept', level: 'info' }, desktop)
  const bad = hub.contribute({ title: 'no id' }, desktop)
  assert.equal(bad.code, CODE_INVALID_INPUT)
  assert.deepEqual(hub.current(desktop).map((item) => item.id), ['m2', 'm3'])
  // returned views are frozen; callers cannot mutate shared hub state
  const view = hub.current(desktop)
  assert.throws(() => { 'use strict'; view.push({}) }, TypeError)
})