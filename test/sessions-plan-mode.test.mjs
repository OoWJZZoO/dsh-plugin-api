/**
 * Unit acceptance for the plan-mode core module (pure, harness-free).
 *
 * The module owns the official outcome mapping, the frozen read view, the
 * change feed derived from the official fact stream, the bounded audit ring
 * and the epoch/staleness rules. Everything here drives the authority through
 * its test seams; the assembly-level behaviour is covered by the e2e and
 * migration-slice files.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PLAN_MODE_AUDIT_CAPACITY,
  mapPlanModeOutcome,
  createPlanModeAuditRing,
  createSessionsPlanModeAuthority,
} from '../lib/sessions-plan-mode.js'
import { PluginApiInactiveError } from '../lib/errors.js'

const agent = (id = 's1') => ({ session: { id, events: [] } })

/** Test-seam harness: an official plan-mode mock faithful to the probed seam. */
function harness(options = {}) {
  const calls = { get: 0, set: 0, owner: 0, sessions: 0 }
  const sessions = new Map([['s1', { id: 's1' }], ['s2', { id: 's2' }]])
  const state = { active: false, pending: undefined, outcome: 'committed' }
  const official = {
    get(target) {
      calls.get += 1
      if (options.getThrows) throw new Error(options.getThrows)
      if (options.getShape === 'broken') return { nope: true }
      const sessionId = target?.session?.id
      return Object.freeze({
        active: sessionId === 's2' ? !state.active : state.active,
        ...(state.pending === undefined ? {} : { pending: state.pending }),
      })
    },
    set() {
      calls.set += 1
      if (options.setThrows) throw new Error(options.setThrows)
      return state.outcome
    },
  }
  const authority = createSessionsPlanModeAuthority({
    active: () => options.inactive !== true,
    resolvePlanMode: () => (options.noService === true ? undefined : official),
    resolveTargetPresence: (id) => {
      calls.sessions += 1
      if (options.storeUnreachable === true) return null
      if (options.closedTargets?.includes(id)) return false
      return sessions.has(id) ? true : false
    },
    resolveOwnerId: () => {
      calls.owner += 1
      return options.owner === undefined ? 'plugin-a' : options.owner
    },
    logger: options.logger,
    clock: options.clock ?? (() => new Date('2026-01-01T00:00:00.000Z')),
  })
  return { authority, calls, state, official, sessions }
}

test('official outcome verbs map onto the frozen discriminated result (no extra fields)', () => {
  const committed = mapPlanModeOutcome('committed', { requested: true, appliedAt: '2026-01-01T00:00:00.000Z' })
  assert.deepEqual({ ...committed }, { ok: true, code: 'committed', commitState: 'success', mode: 'plan', appliedAt: '2026-01-01T00:00:00.000Z' })
  assert.equal(Object.isFrozen(committed), true)

  const queued = mapPlanModeOutcome('queued', { requested: false })
  assert.deepEqual({ ...queued }, { ok: true, code: 'queued', pending: true, mode: 'default' })
  assert.equal('commitState' in queued, false, 'a queued selection has not committed to the log')

  const cancelled = mapPlanModeOutcome('cancelled', { requested: true })
  assert.equal(cancelled.ok, false)
  assert.equal(cancelled.code, 'cancelled')
  assert.equal(typeof cancelled.reason, 'string')

  const noop = mapPlanModeOutcome('noop', { requested: true })
  assert.equal(noop.ok, false)
  assert.equal(noop.code, 'noop')

  const unknown = mapPlanModeOutcome('surprise', { requested: true })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.code, 'internal')

  for (const result of [committed, queued, cancelled, noop, unknown]) {
    assert.equal('target' in result, false, 'the result carries the declared fields only')
  }
})

test('the audit ring is bounded, redacted and gap-marked on a write failure', () => {
  let now = 0
  const ring = createPlanModeAuditRing({ capacity: 2, clock: () => new Date(1000 + (now += 1)) })
  assert.equal(PLAN_MODE_AUDIT_CAPACITY, 512)
  const first = ring.record({ ownerId: 'plugin-a', target: 's1', requested: 'enter', outcome: 'attempt' })
  assert.equal(first.ok, true)
  assert.equal(first.record.seq, 1)
  assert.equal(first.record.action, 'plan-mode.select')
  assert.equal('reason' in first.record, false)
  ring.record({ ownerId: 'plugin-a', target: 's1', requested: 'enter', outcome: 'committed' })
  ring.record({ ownerId: 'plugin-a', target: 's1', requested: 'exit', outcome: 'noop' })
  const view = ring.view()
  assert.equal(view.records.length, 2, 'overflow drops the oldest record')
  assert.equal(view.truncated, true)
  assert.equal(view.gapSince, null)
  assert.equal(Object.isFrozen(view), true)
  assert.equal(Object.isFrozen(view.records[0]), true)

  // An unreadable entry degrades to the gap marker instead of escaping.
  const hostile = Object.defineProperty({}, 'ownerId', { get() { throw new Error('boom') } })
  const failed = ring.record(hostile)
  assert.equal(failed.ok, false)
  assert.equal(typeof failed.reason, 'string')
  assert.equal(typeof ring.view().gapSince, 'string', 'a failed write leaves a gap marker')

  // Long reasons stay bounded and carry no payload.
  const bounded = ring.record({ ownerId: 'x'.repeat(1000), target: 'y'.repeat(1000), requested: 'enter', outcome: 'z'.repeat(1000), reason: 'r'.repeat(1000) })
  assert.equal(bounded.ok, true)
  assert.ok(bounded.record.ownerId.length <= 240)
  assert.ok(bounded.record.target.length <= 240)
  assert.ok(bounded.record.reason.length <= 240)
})

test('select maps the official verbs, derives the owner and audits the attempt', () => {
  const { authority, calls, state } = harness()
  assert.equal(authority.select(agent(), true, {}).code, 'committed')
  assert.equal(calls.set, 1)

  state.outcome = 'queued'
  const queued = authority.select(agent(), false, {})
  assert.equal(queued.code, 'queued')
  assert.equal(queued.pending, true)

  state.outcome = 'cancelled'
  assert.equal(authority.select(agent(), true, {}).code, 'cancelled')

  state.outcome = 'noop'
  assert.equal(authority.select(agent(), true, {}).code, 'noop')

  state.outcome = 'brand-new-verb'
  assert.equal(authority.select(agent(), true, {}).code, 'internal')

  const audit = authority.audit()
  assert.equal(audit.records.filter((record) => record.action === 'plan-mode.select').length, 10, 'every attempt and every outcome is recorded')
  assert.equal(audit.records[0].outcome, 'attempt')
  assert.equal(audit.records.at(-1).outcome, 'internal')
  assert.equal(audit.records.every((record) => record.ownerId === 'plugin-a'), true, 'who is derived, never reported')
})

test('select refuses before any side effect: bad targets, bad input, unowned callers, closed targets', () => {
  const { authority, calls } = harness()
  assert.equal(authority.select(null, true, {}).code, 'invalid-target')
  assert.equal(authority.select({}, true, {}).code, 'invalid-target')
  assert.equal(authority.select({ session: {} }, true, {}).code, 'invalid-target')
  assert.equal(authority.select({ session: { id: '' } }, true, {}).code, 'invalid-target')
  assert.equal(authority.select(agent('missing'), true, {}).code, 'invalid-target')
  assert.equal(calls.set, 0, 'no official write happens before the target is proven')

  assert.equal(authority.select(agent(), 'yes', {}).code, 'invalid-input')
  assert.equal(calls.set, 0)

  // Every pre-submit refusal is audited with its who/what/when/outcome.
  const refusals = authority.audit().records
  assert.deepEqual(refusals.map((record) => record.outcome), ['invalid-target', 'invalid-target', 'invalid-target', 'invalid-target', 'invalid-target', 'invalid-input'])
  assert.equal(refusals.every((record) => record.action === 'plan-mode.select' && typeof record.at === 'string' && typeof record.seq === 'number'), true)
  assert.equal(refusals[4].target, 'missing', 'the requested target is recorded even when it does not exist')
  assert.equal(refusals[5].target, 's1')
  assert.equal(refusals[5].requested, 'unknown', 'a malformed request is recorded as an unknown intent, never guessed')
  assert.equal(typeof refusals[0].reason, 'string', 'the refusal reason stays bounded and available to the audit')

  const unowned = harness({ owner: null })
  assert.equal(unowned.authority.select(agent(), true, {}).code, 'denied')
  assert.equal(unowned.calls.set, 0, 'an unattributable caller never reaches the official seam')
  assert.equal(unowned.authority.audit().records.at(-1).outcome, 'denied')
  assert.equal(unowned.authority.audit().records.at(-1).ownerId, 'unattributed')

  const closed = harness({ closedTargets: ['s1'] })
  assert.equal(closed.authority.select(agent(), true, {}).code, 'invalid-target')
  assert.equal(closed.calls.set, 0)
  assert.equal(closed.authority.audit().records.at(-1).outcome, 'invalid-target')
})

test('the declared refusal order holds when several preconditions fail at once', () => {
  // Availability wins over the target: the missing service is the dominant fact.
  const absent = harness({ noService: true })
  assert.equal(absent.authority.select(null, true, {}).code, 'unavailable')
  assert.equal(absent.authority.audit().records.at(-1).outcome, 'unavailable')

  // The target wins over the input: a malformed request to an unusable target
  // reports the target, not the request.
  const present = harness({ closedTargets: ['s1'] })
  assert.equal(present.authority.select(agent(), 'yes', {}).code, 'invalid-target')
})

test('select reports typed failures when the official seam is missing, broken or hostile', () => {
  const absent = harness({ noService: true })
  assert.deepEqual({ ...absent.authority.select(agent(), true, {}) }, { ok: false, code: 'unavailable', reason: 'the official plan-mode service is unavailable' })
  assert.equal(absent.authority.availability().status, 'unavailable')

  const throwing = harness({ setThrows: 'seam exploded' })
  assert.deepEqual({ ...throwing.authority.select(agent(), true, {}) }, { ok: false, code: 'internal', reason: 'the official plan-mode write failed' })
  assert.equal(throwing.authority.audit().records.at(-1).outcome, 'internal')
  assert.equal(throwing.authority.audit().records.at(-1).reason, 'seam exploded')
})

test('the read view is frozen, sourced from the official read and degrades typed', () => {
  const { authority } = harness()
  const view = authority.get(agent())
  assert.deepEqual({ ...view }, { target: 's1', active: false, observedAt: '2026-01-01T00:00:00.000Z', source: 'official' })
  assert.equal(Object.isFrozen(view), true)

  const pending = harness()
  pending.state.pending = true
  assert.equal(pending.authority.get(agent()).pending, true)

  const degraded = harness({ getShape: 'broken' })
  assert.equal(degraded.authority.get(agent()).source, 'degraded')
  assert.equal(degraded.authority.get(agent()).active, null)

  const throwing = harness({ getThrows: 'read exploded' })
  assert.equal(throwing.authority.get(agent()).source, 'degraded')

  const absent = harness({ noService: true })
  assert.equal(absent.authority.get(agent()).source, 'unavailable')

  const closed = harness({ closedTargets: ['s1'] })
  assert.equal(closed.authority.get(agent()).source, 'degraded')
  assert.match(closed.authority.get(agent()).reason, /closed/)
})

test('observation delivery: change-only, per-handle, verified against the official read', () => {
  const { authority, state } = harness()
  const a = agent('s1')
  const first = authority.observe(a)
  const second = authority.observe(a)
  const seenFirst = []
  const seenSecond = []
  first.subscribe((payload) => seenFirst.push(payload))
  second.subscribe((payload) => seenSecond.push(payload))

  authority.ingestSessionEvent({ id: 's1' }, { type: 'request/header' })
  assert.equal(seenFirst.length, 0, 'an unchanged mode is not delivered')

  state.active = true
  authority.ingestSessionEvent({ id: 's1' }, { type: 'plan/mode' })
  assert.equal(seenFirst.length, 1)
  assert.equal(seenSecond.length, 1, 'each handle carries its own delivery cell')
  assert.deepEqual({ ...seenFirst[0] }, { target: 's1', view: { active: true }, observedAt: '2026-01-01T00:00:00.000Z' })
  assert.equal(Object.isFrozen(seenFirst[0]), true)
  assert.equal(Object.isFrozen(seenFirst[0].view), true)

  // Another target's event never reaches this handle.
  const before = { first: seenFirst.length, second: seenSecond.length }
  state.active = false
  authority.ingestSessionEvent({ id: 's2' }, { type: 'plan/mode' })
  assert.equal(seenFirst.length, before.first)
  assert.equal(seenSecond.length, before.second)

  // A disposed handle stops receiving; its disposer is an idempotent no-op.
  assert.equal(first.dispose(), true)
  assert.equal(first.dispose(), false)
  authority.ingestSessionEvent({ id: 's1' }, { type: 'plan/mode' })
  assert.equal(seenSecond.length, before.second + 1, 'the surviving handle still receives the change')
  state.active = true
  authority.ingestSessionEvent({ id: 's1' }, { type: 'plan/mode' })
  assert.equal(seenSecond.length, before.second + 2)
  assert.equal(seenFirst.length, before.first, 'a disposed handle is out of the feed')
  assert.equal(typeof first.current().source, 'string', 'a stale handle answers typed reads')
})

test('observation containment: a throwing listener degrades alone', () => {
  const diagnostics = []
  const { authority, state } = harness({ logger: { warn: (message) => diagnostics.push(message) } })
  const handle = authority.observe(agent())
  const seen = []
  handle.subscribe(() => { throw new Error('listener exploded') })
  handle.subscribe((payload) => seen.push(payload))
  state.active = true
  authority.ingestSessionEvent({ id: 's1' }, { type: 'plan/mode' })
  assert.equal(seen.length, 1, 'one broken listener never suppresses the others')
  assert.equal(diagnostics.some((message) => message.includes('listener threw')), true)
})

test('observation degrades typed when the source is unavailable and recovers on evidence', () => {
  const options = { noService: false }
  const calls = { get: 0 }
  const state = { active: false }
  const agentRef = agent()
  const authority = createSessionsPlanModeAuthority({
    active: () => true,
    resolvePlanMode: () => (options.noService ? undefined : { get: () => ({ active: state.active }), set: () => 'committed' }),
    resolveTargetPresence: () => true,
    resolveOwnerId: () => 'plugin-a',
    logger: { warn() {} },
  })
  const handle = authority.observe(agentRef)
  const seen = []
  handle.subscribe((payload) => seen.push(payload))
  assert.equal(handle.current().source, 'official')

  options.noService = true
  state.active = true
  authority.ingestSessionEvent({ id: 's1' }, { type: 'plan/mode' })
  assert.equal(handle.current().source, 'unavailable', 'source loss degrades the read face instead of guessing')
  assert.equal(handle.current().active, null)
  assert.equal(seen.length, 0, 'no fabricated delivery while the source is gone')

  options.noService = false
  authority.ingestSessionEvent({ id: 's1' }, { type: 'plan/mode' })
  assert.equal(handle.current().source, 'official', 'a verified re-read clears the degradation')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].view.active, true)
})

test('the close fact stops delivery and degrades the handle', () => {
  const { authority, state } = harness()
  const handle = authority.observe(agent('s1'))
  const seen = []
  handle.subscribe((payload) => seen.push(payload))
  authority.ingestSessionDisposed({ id: 's1' })
  assert.equal(seen.length, 0, 'the change feed carries state changes, not lifecycle notices')
  assert.equal(handle.current().source, 'degraded')
  assert.match(handle.current().reason, /closed/)
  const late = []
  handle.subscribe((payload) => late.push(payload))
  assert.equal(late.length, 0, 'a closed target accepts no new subscription')
  state.active = true
  authority.ingestSessionEvent({ id: 's1' }, { type: 'plan/mode' })
  assert.equal(seen.length, 0, 'a closed target stops delivering')
})

test('epochs: stale handles fail typed after the hub is disposed and remounted', () => {
  const { authority } = harness()
  const handle = authority.observe(agent())
  const epoch = handle.epoch
  assert.equal(typeof epoch, 'number')
  authority.dispose()
  assert.equal(handle.current().source, 'degraded')
  assert.match(handle.current().reason, /stale/)
  const seen = []
  handle.subscribe((payload) => seen.push(payload))
  assert.equal(seen.length, 0, 'a stale handle accepts no new subscription')
  assert.equal(handle.dispose(), false, 'the hub already released the handle; disposal stays an idempotent no-op')
})

test('the core-inactive gate is the single typed-throw path', () => {
  const { authority } = harness({ inactive: true })
  assert.throws(() => authority.get(agent()), PluginApiInactiveError)
  assert.throws(() => authority.select(agent(), true, {}), PluginApiInactiveError)
  assert.throws(() => authority.observe(agent()), PluginApiInactiveError)
})

test('the module touches only its declared seams: no prompt registration, no session writes', () => {
  const touched = []
  const session = {
    id: 's1',
    append() { touched.push('session.append'); throw new Error('the facade must never append session events') },
    emit() { touched.push('session.emit'); throw new Error('the facade must never emit session events') },
  }
  const agentRef = { session }
  const authority = createSessionsPlanModeAuthority({
    active: () => true,
    resolvePlanMode: () => ({ get: () => ({ active: false }), set: () => 'committed' }),
    resolveTargetPresence: () => true,
    resolveOwnerId: () => 'plugin-a',
  })
  assert.equal(authority.select(agentRef, true, {}).ok, true)
  assert.equal(authority.get(agentRef).source, 'official')
  const handle = authority.observe(agentRef)
  authority.ingestSessionEvent(session, { type: 'plan/mode' })
  handle.dispose()
  assert.deepEqual(touched, [], 'reads, switches and observation never write session facts or prompts')
})

test('caller-supplied identifiers never escape bounded into results, views, audit or diagnostics', () => {
  const diagnostics = []
  const huge = 'x'.repeat(50000)
  const long = { session: { id: huge } }
  const authority = createSessionsPlanModeAuthority({
    active: () => true,
    resolvePlanMode: () => ({ get: () => ({ active: false }), set: () => 'committed' }),
    resolveTargetPresence: () => false,
    resolveOwnerId: () => 'plugin-a',
    logger: { warn: (message) => diagnostics.push(message) },
  })

  const rejected = authority.select(long, true, {})
  assert.equal(rejected.code, 'invalid-target')
  assert.ok(rejected.reason.length <= 300, 'the refusal reason stays bounded')
  const view = authority.get(long)
  assert.ok(String(view.reason).length <= 300, 'the degraded view reason stays bounded')
  authority.select({ session: { id: `${huge}y` } }, true, {})
  const record = authority.audit().records.at(-1)
  assert.ok(record.target.length <= 240 && record.reason.length <= 240, 'the ring keeps its bounded fields')
  assert.equal(diagnostics.length, 0, 'no diagnostic is emitted on the refusal path')

  // The diagnostic path with a live target and a failing official read.
  const throwing = createSessionsPlanModeAuthority({
    active: () => true,
    resolvePlanMode: () => ({ get() { throw new Error(`boom ${huge}`) }, set: () => 'committed' }),
    resolveTargetPresence: () => true,
    resolveOwnerId: () => 'plugin-a',
    logger: { warn: (message) => diagnostics.push(message) },
  })
  const degraded = throwing.get({ session: { id: huge } })
  assert.equal(degraded.source, 'degraded')
  assert.equal(diagnostics.length, 1, 'the failing read is reported once')
  assert.ok(diagnostics[0].length <= 300, 'diagnostics stay bounded even with a hostile identifier')
})

test('a target the official store no longer holds is retired on the next delivery attempt', () => {
  const { authority, sessions, state } = harness()
  const handle = authority.observe(agent('s1'))
  const seen = []
  handle.subscribe((payload) => seen.push(payload))
  sessions.delete('s1') // no close fact reaches the feature
  state.active = true
  authority.ingestSessionEvent({ id: 's1' }, { type: 'plan/mode' })
  assert.equal(seen.length, 0, 'presence is part of the delivery verification')
  assert.equal(handle.current().source, 'degraded')
  assert.match(handle.current().reason, /closed/)
})

test('an unreachable official store is never reported as a closed target', () => {
  const { authority, calls } = harness({ storeUnreachable: true })
  const unverifiable = authority.get(agent('s1'))
  assert.equal(unverifiable.source, 'unavailable', 'the read face reports the honest unavailable view')
  assert.match(unverifiable.reason, /cannot be verified/)
  const refused = authority.select(agent('s1'), true, {})
  assert.equal(refused.code, 'unavailable', 'a switch is refused typed rather than claiming the target is gone')
  assert.equal(calls.set, 0)

  // Delivery skips while the store is unreachable but the handle is not retired.
  const handle = authority.observe(agent('s1'))
  const seen = []
  handle.subscribe((payload) => seen.push(payload))
  authority.ingestSessionEvent({ id: 's1' }, { type: 'plan/mode' })
  assert.equal(seen.length, 0, 'nothing is delivered without a verified presence')
  assert.equal(handle.current().source, 'unavailable')
})

test('the store returning to service resumes delivery on the same handle', () => {
  const options = { storeUnreachable: true }
  const sessions = new Map([['s1', { id: 's1' }]])
  const state = { active: false }
  const authority = createSessionsPlanModeAuthority({
    active: () => true,
    resolvePlanMode: () => ({ get: () => ({ active: state.active }), set: () => 'committed' }),
    resolveTargetPresence: (id) => (options.storeUnreachable ? null : sessions.has(id) ? true : false),
    resolveOwnerId: () => 'plugin-a',
  })
  const handle = authority.observe(agent('s1'))
  const seen = []
  handle.subscribe((payload) => seen.push(payload))
  state.active = true
  authority.ingestSessionEvent({ id: 's1' }, { type: 'plan/mode' })
  assert.equal(seen.length, 0, 'no delivery while the store is unreachable')

  options.storeUnreachable = false
  authority.ingestSessionEvent({ id: 's1' }, { type: 'plan/mode' })
  assert.equal(seen.length, 1, 'delivery resumes once the presence is verifiable again')
  assert.equal(seen[0].view.active, true)
})

test('an unresolvable target yields an unbound handle that reports the honest reason', () => {
  const { authority } = harness()
  for (const broken of [null, {}, { session: {} }, { session: { id: '' } }]) {
    const handle = authority.observe(broken)
    const view = handle.current()
    assert.equal(view.source, 'unavailable', 'an unbound handle is not "stale"; it reports the real read view')
    assert.match(view.reason, /official agent handle|session identity/)
    const seen = []
    const release = handle.subscribe((payload) => seen.push(payload))
    assert.equal(typeof release, 'function')
    assert.equal(seen.length, 0, 'an unusable target accepts no subscription')
    assert.equal(handle.dispose(), true)
    assert.equal(handle.dispose(), false)
  }
  // The same target through the read/write faces reports the same reason family.
  assert.equal(authority.select(null, true, {}).code, 'invalid-target')
  assert.equal(authority.get(null).source, 'unavailable')
})
