/**
 * End-to-end acceptance for the controlled plan-mode face (`sessions.planMode`)
 * through the public facade only.
 *
 * The official side is the probed-shape mock in `session-plan-mode-test-kit.mjs`
 * (synchronous arbitration verbs, pending table, conditional narration, the
 * `onBoundary` settlement); the facade must map those verbs, read through the
 * official `get`, and derive its change feed from the official `session/event`
 * and `session/disposed` facts with a verifying re-read.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createHarness, createOfficialPlanMode, mountOfficialSession, planModeOf } from './session-plan-mode-test-kit.mjs'

const mode = planModeOf
const planFacts = (official, session) => official.logOf(session).filter((event) => event.type === 'plan/mode')

test('a committed switch: mapping, official read-back and the idempotent repeat', () => {
  const { state, official, createSession, emitFact } = createHarness()
  const session = createSession('s1')
  const agent = { session }
  const face = mode(state)
  assert.equal(face.availability().status, 'active')
  assert.equal(typeof face.get, 'function')
  assert.equal(typeof face.select, 'function')
  assert.equal(typeof face.observe, 'function')

  const result = face.select(agent, true)
  assert.deepEqual({ ...result }, {
    ok: true, code: 'committed', commitState: 'success', mode: 'plan', appliedAt: result.appliedAt,
  })
  assert.equal(Object.isFrozen(result), true)
  assert.equal(planFacts(official, session).length, 1, 'the official seam owns the log write')
  assert.deepEqual(official.appendSources, ['official-set'])
  assert.equal(official.narrations.length, 0, 'nothing was told by a header yet, so the official seam narrates nothing')

  const read = face.get(agent)
  assert.deepEqual({ ...read }, { target: 's1', active: true, observedAt: read.observedAt, source: 'official' })

  // The repeat maps to the official noop and never records a second commit.
  const repeat = face.select(agent, true)
  assert.equal(repeat.ok, false)
  assert.equal(repeat.code, 'noop')
  assert.equal(planFacts(official, session).length, 1)

  // Exit maps the same way.
  emitFact(session, { type: 'plan/mode', active: true })
  assert.equal(face.select(agent, false).code, 'committed')
  assert.equal(face.get(agent).active, false)

  // Narration stays the official seam's conditional business: the notice only
  // appears once a logged header has told the other mode.
  official.markHeader(session, false)
  assert.equal(face.select(agent, true).code, 'committed')
  assert.equal(official.narrations.length, 1, 'the official seam narrates the switch after a header told the other mode')
})

test('a queued switch settles through the official boundary fact and the observation face', () => {
  const { state, official, createSession, emitFact } = createHarness()
  const session = createSession('s1', { openTurn: true })
  const agent = { session }
  const face = mode(state)
  const handle = face.observe(agent)
  const seen = []
  handle.subscribe((payload) => seen.push(payload))

  const queued = face.select(agent, true)
  assert.deepEqual({ ...queued }, { ok: true, code: 'queued', pending: true, mode: 'plan' })
  assert.equal(official.pendingCount(), 1)
  assert.equal(face.get(agent).pending, true, 'the pending intent is visible through the official read')

  // The official boundary settles the intent and appends the fact.
  assert.equal(official.onBoundary(session), 'committed')
  emitFact(session, { type: 'plan/mode', active: true })
  assert.equal(seen.length, 1)
  assert.deepEqual({ ...seen[0] }, { target: 's1', view: { active: true }, observedAt: seen[0].observedAt })
  assert.equal(queued.code, 'queued', 'the earlier result is never rewritten')
})

test('the reverse-pending cancellation is a typed refusal and a silent clear is honest', () => {
  const { state, official, createSession, emitFact } = createHarness()
  const session = createSession('s1', { mode: true, openTurn: true })
  const agent = { session }
  const face = mode(state)
  const handle = face.observe(agent)
  const seen = []
  handle.subscribe((payload) => seen.push(payload))

  // Queue a reverse intent through the official seam: the composed state gains
  // a pending flag, which the observation face reports.
  assert.equal(official.service.set(agent, false), 'queued')
  emitFact(session, { type: 'request/header' })
  assert.equal(seen.length, 1)
  assert.deepEqual({ ...seen[0].view }, { active: true, pending: false })

  // Asking for the mode the log already carries is the reverse-pending
  // cancellation: a typed refusal, never a fake success.
  const cancelled = face.select(agent, true)
  assert.equal(cancelled.ok, false)
  assert.equal(cancelled.code, 'cancelled')
  assert.match(cancelled.reason, /cancelled/)
  emitFact(session, { type: 'request/header' })
  assert.deepEqual({ ...seen[1].view }, { active: true, pending: true })

  // The official boundary clears the pending silently: no log fact, no
  // delivery until an official fact re-reads the settled state.
  assert.equal(official.onBoundary(session), 'silent-clear')
  assert.equal(seen.length, 2, 'no fabricated delivery without an official fact')
  assert.equal(face.get(agent).pending, undefined, 'the read face shows the pending intent is gone')
  emitFact(session, { type: 'request/header' })
  assert.equal(seen.length, 3)
  assert.equal(seen[2].view.active, true)
  assert.equal('pending' in seen[2].view, false)
})

test('pre-submit refusals stay typed and leave the official state untouched', () => {
  const { state, createSession, official } = createHarness()
  createSession('s1')
  const face = mode(state)

  assert.equal(face.select(null, true).code, 'invalid-target')
  assert.equal(face.select({}, true).code, 'invalid-target')
  assert.equal(face.select({ session: { id: 'ghost' } }, true).code, 'invalid-target')
  assert.equal(face.select({ session: { id: 's1' } }, 'yes').code, 'invalid-input')
  assert.equal(official.setCalls.length, 0, 'no official write is attempted')
  assert.deepEqual(official.appendSources, [])
})

test('an unattributable caller is refused and reaches no official seam', () => {
  const { state, createSession, official } = createHarness({ unowned: true })
  const session = createSession('s1')
  const denied = state.pluginApi.sessions.planMode.select({ session }, true)
  assert.equal(denied.ok, false)
  assert.equal(denied.code, 'denied')
  assert.equal(official.setCalls.length, 0, 'owner derivation gates the official seam')
})

test('changes made through official paths reach subscribers, with containment and stale isolation', () => {
  const { state, createSession, emitFact, official } = createHarness()
  const session = createSession('s1')
  const agent = { session }
  const face = mode(state)
  const first = face.observe(agent)
  const second = face.observe(agent)
  const seenFirst = []
  const seenSecond = []
  first.subscribe(() => { throw new Error('broken listener') })
  first.subscribe((payload) => seenFirst.push(payload))
  second.subscribe((payload) => seenSecond.push(payload))

  // Official path: the facade never issued this switch.
  official.service.set(agent, true)
  emitFact(session, { type: 'plan/mode', active: true })
  assert.equal(seenFirst.length, 1, 'the broken listener is contained, the healthy one still receives')
  assert.equal(seenSecond.length, 1, 'each handle carries its own delivery cell')

  const release = second.subscribe(() => { throw new Error('released listener') })
  release()
  assert.equal(first.dispose(), true)
  official.service.set(agent, false)
  emitFact(session, { type: 'plan/mode', active: false })
  assert.equal(seenSecond.length, 2)
  assert.equal(seenFirst.length, 1, 'a disposed handle receives nothing further')
  assert.equal(first.current().source, 'degraded')
  assert.match(first.current().reason, /stale/)
})

test('a closed session stops the feed and degrades typed reads', () => {
  const { state, createSession, emitFact, ctx, sessions } = createHarness()
  const session = createSession('s1')
  const agent = { session }
  const face = mode(state)
  const handle = face.observe(agent)
  const seen = []
  handle.subscribe((payload) => seen.push(payload))

  sessions.delete('s1') // the official close removes the session from the store
  ctx.emit('session/disposed', session)
  assert.equal(seen.length, 0, 'the close fact retires the handle instead of pushing a lifecycle notice')
  assert.equal(handle.current().source, 'degraded')
  assert.match(handle.current().reason, /closed/)
  const late = []
  handle.subscribe((payload) => late.push(payload))
  assert.equal(late.length, 0, 'a closed target accepts no new subscription')

  emitFact(session, { type: 'plan/mode', active: true })
  assert.equal(seen.length, 0, 'a closed target never delivers again')
  assert.equal(face.select(agent, true).code, 'invalid-target')
  assert.equal(face.get(agent).source, 'degraded', 'a known but closed target reads as degraded, not as a missing service')
})

test('the disabled face returns typed results and never removes the namespace', () => {
  const { state, createSession } = createHarness({ noPlanMode: true })
  createSession('s1')
  const face = mode(state)
  assert.equal(face.availability().status, 'unavailable')
  assert.equal(face.get({ session: { id: 's1' } }).source, 'unavailable')
  assert.equal(face.select({ session: { id: 's1' } }, true).code, 'unavailable')
  const handle = face.observe({ session: { id: 's1' } })
  assert.equal(handle.current().source, 'unavailable')
  const seen = []
  handle.subscribe((payload) => seen.push(payload))
  assert.equal(seen.length, 1, 'the disabled handle reports its state once')
  assert.equal(handle.dispose(), false)
  assert.equal(state.pluginApi.sessions.planMode, face, 'the namespace member stays published')
})

test('the feature is orthogonal: no prompt sections, no session writes beyond the official seam', () => {
  const { state, createSession, official } = createHarness()
  const session = createSession('s1')
  const agent = { session }
  const face = mode(state)
  const promptSectionsBefore = state.listeners.filter((entry) => entry.name === 'system-prompt/assemble').length

  face.select(agent, true)
  face.get(agent)
  face.observe(agent).subscribe(() => {})

  assert.equal(state.listeners.filter((entry) => entry.name === 'system-prompt/assemble').length, promptSectionsBefore, 'the facade registers no prompt section')
  assert.deepEqual(official.appendSources, ['official-set'], 'every session fact write came from the official seam')
  assert.equal(planFacts(official, session).length, 1)

  // The plan-mode passthrough keeps its audited read member and gains no write member.
  const passthrough = state.pluginApi.services.planMode
  assert.equal(typeof passthrough.get, 'function')
  assert.equal('set' in passthrough, false, 'services.planMode never re-gains a raw write member')
})

test('unmounting degenerates the face to typed results and retires the handles', () => {
  const { state, createSession } = createHarness()
  const session = createSession('s1')
  const agent = { session }
  const face = mode(state)
  const handle = face.observe(agent)
  assert.equal(handle.current().source, 'official')
  assert.equal(typeof handle.epoch, 'number')

  const slot = state.pluginApi._sessionPlanModeSlot
  assert.ok(slot, 'the feature published a slot')
  const factSubscriptions = state.listeners.filter((entry) => entry.name === 'session/event' || entry.name === 'session/disposed').length
  assert.equal(factSubscriptions > 0, true, 'the feature subscribes to both official fact streams')

  // Unload through the cleanup the assembly registered for this feature: the
  // authority, its fact subscriptions and every handle are released.
  const cleanup = state.effects.find((entry) => entry.label === 'dsh-plugin-api: sessionPlanMode cleanup')
  assert.ok(cleanup, 'the staged mount registered its cleanup')
  const dispose = cleanup.fn()
  assert.equal(typeof dispose, 'function')
  dispose()

  const after = mode(state)
  assert.equal(after.availability().status, 'unavailable', 'the namespace answers honestly after unmount')
  assert.equal(after.select(agent, true).code, 'unavailable')
  assert.equal(handle.current().source, 'degraded')
  assert.match(handle.current().reason, /stale/)
  const remaining = state.listeners.filter((entry) => entry.name === 'session/event' || entry.name === 'session/disposed').length
  assert.equal(remaining, factSubscriptions - 2, 'both fact subscriptions are gone')
})

test('capability and availability registration mirror the runtime face', () => {
  const { state, createSession } = createHarness()
  createSession('s1')
  const capabilities = state.pluginApi.capabilities
  assert.equal(capabilities.list({ prefix: 'sessions.' }).includes('sessions.planMode'), true)
  assert.equal(capabilities.get('sessions.planMode').capability, 'sessions.planMode')
  assert.equal(state.pluginApi.sessions.availability().status, 'active')
})

test('two independent plugin trees over one official seam: reverse registration order stays deterministic', () => {
  // Two synthetic plugin trees share the official plan-mode component and the
  // official session store; each derives its own caller owner. The facade
  // invents no arbitration of its own: every switch lands on the same official
  // seam and the official verbs decide.
  const official = createOfficialPlanMode()
  const sessions = new Map()
  const treeA = createHarness({ official, sessions, fiberName: 'plugin-a' })
  const treeB = createHarness({ official, sessions, fiberName: 'plugin-b' })
  const session = { id: 's1' }
  sessions.set('s1', session)
  const agent = { session }

  // Reverse registration order: tree B observes first, tree A second.
  const handleB = planModeOf(treeB.state).observe(agent)
  const handleA = planModeOf(treeA.state).observe(agent)
  const seenA = []
  const seenB = []
  handleA.subscribe((payload) => seenA.push(payload))
  handleB.subscribe((payload) => seenB.push(payload))

  const first = planModeOf(treeA.state).select(agent, true)
  const second = planModeOf(treeB.state).select(agent, false)
  const repeat = planModeOf(treeB.state).select(agent, true)
  const third = planModeOf(treeA.state).select(agent, true)
  assert.deepEqual([first.code, second.code, repeat.code, third.code], ['committed', 'committed', 'committed', 'noop'], 'entering, exiting, re-entering and the idempotent repeat stay deterministic')
  assert.equal(third.code, 'noop', 'the repeat of the current mode is the official idempotent verb')
  assert.equal(official.setCalls.length, 4, 'every switch reached the official seam exactly once')

  // Both trees read the same official authority (no second state).
  assert.equal(planModeOf(treeA.state).get(agent).active, planModeOf(treeB.state).get(agent).active)
  assert.equal(planModeOf(treeA.state).get(agent).active, true)

  // Both trees derive the change from the same official facts (each tree
  // consumes the fact through its own substrate, as in a real boot).
  treeA.emitFact(session, { type: 'plan/mode', active: true })
  treeB.emitFact(session, { type: 'plan/mode', active: true })
  assert.equal(seenA.length, 1)
  assert.equal(seenB.length, 1)
  assert.deepEqual({ ...seenA.at(-1).view }, { ...seenB.at(-1).view })
  assert.equal(seenA.at(-1).view.active, true)
})

test('an unavailable fact stream degrades observation alone and surfaces in the namespace reason', () => {
  const { state, createSession } = createHarness({ onThrows: true })
  const session = createSession('s1')
  const agent = { session }
  const face = mode(state)
  assert.equal(face.availability().status, 'degraded', 'a missing fact stream degrades the observation channel')
  assert.equal(face.get(agent).source, 'official', 'the read face still answers from the official authority')
  assert.equal(face.select(agent, true).code, 'committed', 'the write face still commits through the official seam')
  assert.equal(face.observe(agent).current().source, 'official', 'the handle reads the official state directly')
  assert.match(state.pluginApi.sessions.availability().reason ?? '', /plan mode degraded/, 'the namespace reason carries the plan-mode degradation')
  assert.equal(state.pluginApi.isActive, true, 'the degradation never disables the main facade')
  assert.equal(typeof state.pluginApi.tools.register, 'function')
  assert.equal(typeof state.pluginApi.sessions.get, 'function')
})

test('a disabled feature never takes unrelated capabilities down with it', () => {
  const { state, createSession } = createHarness({ noPlanMode: true })
  createSession('s1')
  const face = mode(state)
  assert.equal(face.availability().status, 'unavailable')
  // The rest of the facade keeps its published members and their behavior.
  assert.equal(typeof state.pluginApi.sessions.get, 'function')
  assert.equal(typeof state.pluginApi.sessions.observe, 'function')
  assert.equal(typeof state.pluginApi.tools.register, 'function')
  assert.equal(typeof state.pluginApi.events.observe, 'function')
  assert.equal(state.pluginApi.isActive, true)
  assert.equal(state.pluginApi.sessions.activity.availability().status !== undefined, true)
  assert.equal(state.pluginApi.capabilities.get('sessions.planMode').status, 'unavailable')
  assert.notEqual(state.pluginApi.capabilities.get('sessions').status, 'unavailable', 'the parent capability is not dragged down')
})

test('delivery stops when the official store no longer holds the target, even without a close fact', () => {
  const { state, createSession, sessions, emitFact } = createHarness()
  const session = createSession('s1')
  const agent = { session }
  const face = mode(state)
  const handle = face.observe(agent)
  const seen = []
  handle.subscribe((payload) => seen.push(payload))

  // The official store drops the session but no `session/disposed` fact arrives.
  sessions.delete('s1')
  emitFact(session, { type: 'plan/mode', active: true })
  assert.equal(seen.length, 0, 'an unverified presence never fabricates a delivery')
  assert.equal(handle.current().source, 'degraded', 'the read face reports the missing target')
  emitFact(session, { type: 'plan/mode', active: false })
  assert.equal(seen.length, 0)
})

test('an inert core keeps the whole facade inert without breaking the availability contract', () => {
  const previous = process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
  process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = '1'
  try {
    const { state } = createHarness()
    assert.equal(state.pluginApi.isActive, false)
    // Every namespace availability member answers typed instead of throwing.
    assert.equal(state.pluginApi.sessions.availability().status, 'unavailable')
    assert.deepEqual({ ...state.pluginApi.sessions.planMode.availability() }, {
      status: 'unavailable',
      reason: 'the sessions.planMode feature is not mounted in this installation',
    })
    // Data members keep the established inactive-core throw; only availability
    // is required to answer typed in every state.
    const inactive = (error) => error?.name === 'PluginApiInactiveError'
    assert.throws(() => state.pluginApi.sessions.planMode.get({ session: { id: 's1' } }), inactive)
    assert.throws(() => state.pluginApi.sessions.planMode.select({ session: { id: 's1' } }, true), inactive)
    assert.throws(() => state.pluginApi.sessions.planMode.observe({ session: { id: 's1' } }), inactive)
  } finally {
    if (previous === undefined) delete process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
    else process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = previous
  }
})

test('the switch never reads or writes the neighbouring policy faces', () => {
  const kit = createHarness()
  const { session, agent } = mountOfficialSession(kit, 's1')
  const probe = kit.probeCrossDomain()
  const face = mode(kit.state)

  face.select(agent, true)
  face.get(agent)
  face.observe(agent).subscribe(() => {})
  kit.emitFact(session, { type: 'plan/mode', active: true })
  face.select(agent, false)

  assert.deepEqual(probe.accesses, [], 'permission presets, approval, security and sandbox faces stay untouched')
})

test('a mounted feature keeps its namespace shape when the core turns inert', () => {
  const { state, createSession } = createHarness()
  createSession('s1')
  assert.equal(state.pluginApi.sessions.planMode.availability().status, 'active')

  const previous = process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
  process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = '1'
  try {
    // The second apply reconciles the reused service with an inert core.
    state.pluginApi.reconcile({ registry: state.pluginApi._registry, coreActive: () => false })
    assert.equal(state.pluginApi.isActive, false)
    assert.ok(state.pluginApi.sessions.planMode, 'the member never disappears while the core is inert')
    assert.deepEqual({ ...state.pluginApi.sessions.planMode.availability() }, {
      status: 'unavailable',
      reason: 'the sessions.planMode feature is not mounted in this installation',
    })
  } finally {
    if (previous === undefined) delete process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
    else process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = previous
  }
})
