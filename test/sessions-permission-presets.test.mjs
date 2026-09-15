/**
 * Unit acceptance for the permission-preset core module (pure, harness-free).
 *
 * The module owns the official selection mapping, the frozen read/option
 * views, the change feed derived from the official fact stream, the bounded
 * audit ring and the epoch/presence rules. Everything here drives the
 * authority through its test seams; the assembly-level behaviour (including
 * the real approval decision evidence) lives in the e2e file.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CUSTOM_PRESET_NAME,
  PERMISSION_PRESET_AUDIT_CAPACITY,
  createPermissionPresetAuditRing,
  createPermissionPresetAuthority,
  mapSelectResult,
} from '../lib/sessions-permission-presets.js'
import { PluginApiInactiveError } from '../lib/errors.js'

const session = (id = 's1') => ({ id, events: [], seq: 0 })

function harness(options = {}) {
  const calls = { set: 0, current: 0, snapshot: 0, owner: 0, presence: 0 }
  const sessions = new Map([['s1', { id: 's1' }], ['s2', { id: 's2' }]])
  const state = { preset: 'workspace-write', currentValue: 'workspace-write' }
  const names = ['workspace-write', 'danger-full-access']
  const official = {
    current() {
      calls.current += 1
      if (options.currentThrows) throw new Error(options.currentThrows)
      return state.preset
    },
    resolve(name) {
      if (!names.includes(name) && name !== CUSTOM_PRESET_NAME) throw new Error(`permission: unknown preset "${name}"`)
      return {}
    },
    set() {
      calls.set += 1
      if (options.setThrows) throw new Error(options.setThrows)
      if (options.setApplies !== false) {
        state.preset = options.setResult ?? state.preset === 'workspace-write' ? 'danger-full-access' : 'workspace-write'
      }
      return undefined
    },
    names,
    optionOf(name) {
      return { value: name, name, description: `${name} preset` }
    },
  }
  const snapshot = (target) => {
    calls.snapshot += 1
    return {
      asOfSeq: target.seq - 1,
      values: {
        permissions: {
          options: names.map((name) => official.optionOf(name)),
          currentValue: state.currentValue ?? state.preset,
        },
      },
    }
  }
  const authority = createPermissionPresetAuthority({
    active: () => options.inactive !== true,
    resolvePresets: () => (options.noService === true ? undefined : official),
    resolveSnapshot: () => (options.noProjection === true ? null : snapshot),
    resolveTargetPresence: (id) => {
      calls.presence += 1
      if (options.storeUnreachable === true) return null
      if (options.closedTargets?.includes(id)) return false
      return sessions.has(id)
    },
    resolveOwnerId: () => {
      calls.owner += 1
      return options.owner === undefined ? 'plugin-a' : options.owner
    },
    logger: options.logger,
    clock: options.clock ?? (() => new Date('2026-01-01T00:00:00.000Z')),
    observeAvailable: options.observeAvailable ?? true,
    optionsAvailable: options.optionsAvailable ?? true,
  })
  return { authority, calls, state, official, sessions, snapshot }
}

test('the selection result table is frozen and carries exactly the declared fields', () => {
  const committed = mapSelectResult({ before: 'workspace-write', after: 'danger-full-access', requested: 'danger-full-access', appliedAt: '2026-01-01T00:00:00.000Z' })
  assert.deepEqual({ ...committed }, {
    ok: true,
    code: 'committed',
    commitState: 'success',
    preset: 'danger-full-access',
    appliedAt: '2026-01-01T00:00:00.000Z',
  })
  assert.equal(Object.isFrozen(committed), true)

  const unchanged = mapSelectResult({ before: 'workspace-write', after: 'workspace-write', requested: 'workspace-write' })
  assert.deepEqual({ ...unchanged }, { ok: false, code: 'unchanged', preset: 'workspace-write', reason: 'the requested preset is already effective' })
  assert.equal('commitState' in unchanged, false, 'an unchanged selection committed nothing')

  const notApplied = mapSelectResult({ before: 'workspace-write', after: 'workspace-write', requested: 'danger-full-access' })
  assert.equal(notApplied.ok, false)
  assert.equal(notApplied.code, 'not-applied', 'the official state cannot evidence the change: never a fake success')
  assert.equal(notApplied.preset, 'danger-full-access')
})

test('the audit ring is bounded, redacted and gap-marked on a write failure', () => {
  const ring = createPermissionPresetAuditRing({ capacity: 2, clock: () => new Date('2026-01-01T00:00:00.000Z') })
  assert.equal(PERMISSION_PRESET_AUDIT_CAPACITY, 512)
  const first = ring.record({ ownerId: 'plugin-a', target: 's1', preset: 'workspace-write', outcome: 'attempt' })
  assert.equal(first.ok, true)
  assert.equal(first.record.action, 'permission-preset.select')
  assert.equal(first.record.seq, 1)
  ring.record({ ownerId: 'plugin-a', target: 's1', preset: 'danger-full-access', outcome: 'committed' })
  ring.record({ ownerId: 'plugin-a', target: 's1', preset: 'danger-full-access', outcome: 'unchanged' })
  const view = ring.view()
  assert.equal(view.records.length, 2)
  assert.equal(view.truncated, true)
  assert.equal(view.gapSince, null)
  assert.equal(Object.isFrozen(view.records[0]), true)

  const hostile = Object.defineProperty({}, 'ownerId', { get() { throw new Error('boom') } })
  const failed = ring.record(hostile)
  assert.equal(failed.ok, false)
  assert.equal(typeof ring.view().gapSince, 'string')

  const huge = 'x'.repeat(50000)
  const bounded = ring.record({ ownerId: huge, target: huge, preset: huge, outcome: 'committed', reason: huge })
  assert.equal(bounded.ok, true)
  assert.ok(bounded.record.ownerId.length <= 240 && bounded.record.target.length <= 240)
  assert.ok(bounded.record.preset.length <= 240 && bounded.record.reason.length <= 240)
})

test('select maps the official outcome and audits every reachable path', () => {
  const { authority, calls, state } = harness()
  const target = session('s1')

  const committed = authority.select(target, 'danger-full-access', {})
  assert.equal(committed.code, 'committed')
  assert.equal(committed.commitState, 'success')
  assert.equal(calls.set, 1)

  const unchanged = authority.select(target, 'danger-full-access', {})
  assert.equal(unchanged.code, 'unchanged')
  assert.equal(unchanged.preset, 'danger-full-access')

  state.preset = 'workspace-write'
  const notApplied = harness({ setApplies: false })
  assert.equal(notApplied.authority.select(session('s1'), 'danger-full-access', {}).code, 'not-applied')

  const audit = authority.audit()
  assert.deepEqual(audit.records.map((record) => record.outcome), ['attempt', 'committed', 'attempt', 'unchanged'])
  assert.equal(audit.records.every((record) => record.ownerId === 'plugin-a' && record.action === 'permission-preset.select'), true)
})

test('select refuses in the declared order before any side effect', () => {
  const target = session('s1')

  // Parameters first.
  const params = harness()
  assert.equal(params.authority.select(null, 'workspace-write', {}).code, 'invalid-input')
  assert.equal(params.authority.select(target, '', {}).code, 'invalid-input')
  assert.equal(params.authority.select(target, 42, {}).code, 'invalid-input')
  assert.equal(params.calls.set, 0)

  // Availability beats the owner and the target.
  const unavailable = harness({ noService: true, owner: null })
  assert.equal(unavailable.authority.select(null, 42, {}).code, 'invalid-input', 'parameters still win')
  assert.equal(unavailable.authority.select(target, 'workspace-write', {}).code, 'unavailable')

  // Owner beats the target.
  const unowned = harness({ owner: null })
  assert.equal(unowned.authority.select(session('missing'), 'workspace-write', {}).code, 'denied')
  assert.equal(unowned.calls.set, 0)

  // Target beats the preset name.
  const closed = harness({ closedTargets: ['s1'] })
  assert.equal(closed.authority.select(target, 'not-a-preset', {}).code, 'invalid-target')
  assert.equal(closed.calls.set, 0)

  // The derived custom state is never a selection target.
  const custom = harness()
  assert.equal(custom.authority.select(target, CUSTOM_PRESET_NAME, {}).code, 'invalid-preset')
  assert.equal(custom.calls.set, 0)

  // Unknown names are refused before the official seam.
  const unknown = harness()
  const refused = unknown.authority.select(target, 'not-a-preset', {})
  assert.equal(refused.code, 'unknown-preset')
  assert.equal(unknown.calls.set, 0, 'the official write seam is never reached for an unknown preset')

  // Every refusal is audited with its code and a bounded reason.
  assert.deepEqual(params.authority.audit().records.map((record) => record.outcome), ['invalid-input', 'invalid-input', 'invalid-input'])
  assert.deepEqual(closed.authority.audit().records.map((record) => record.outcome), ['invalid-target'])
  assert.equal(typeof closed.authority.audit().records[0].reason, 'string')
  assert.equal(unowned.authority.audit().records.at(-1).ownerId, 'unattributed')
})

test('select reports typed failures when the official seam throws', () => {
  const writeFails = harness({ setThrows: 'seam exploded' })
  const failed = writeFails.authority.select(session('s1'), 'danger-full-access', {})
  assert.equal(failed.code, 'internal')
  assert.equal(writeFails.authority.audit().records.at(-1).outcome, 'internal')

  const readFails = harness({ currentThrows: 'read exploded' })
  const unreadable = readFails.authority.select(session('s1'), 'danger-full-access', {})
  assert.equal(unreadable.code, 'internal')
  assert.equal(readFails.calls.set, 0, 'a failed pre-read never reaches the write seam')
})

test('the read views are frozen, source-attributed and degrade typed', () => {
  const { authority } = harness()
  const target = session('s1')

  const preset = authority.current(target)
  assert.deepEqual({ ...preset }, { target: 's1', preset: 'workspace-write', observedAt: '2026-01-01T00:00:00.000Z', source: 'official' })
  assert.equal(Object.isFrozen(preset), true)

  const options = authority.options(target)
  assert.equal(options.target, 's1')
  assert.equal(options.source, 'official')
  assert.equal(options.currentValue, 'workspace-write')
  assert.deepEqual(options.options.map((option) => option.value), ['workspace-write', 'danger-full-access'])
  assert.equal(Object.isFrozen(options.options), true)
  assert.equal(Object.isFrozen(options.options[0]), true)

  const broken = harness({ currentThrows: 'nope' })
  assert.equal(broken.authority.current(target).source, 'degraded')

  const absent = harness({ noService: true })
  assert.equal(absent.authority.current(target).source, 'unavailable')

  const noProjection = harness({ noProjection: true })
  const degraded = noProjection.authority.options(target)
  assert.equal(degraded.source, 'degraded')
  assert.equal(degraded.target, 's1', 'a degraded options view still names its target')
  assert.deepEqual([...degraded.options], [], 'no option is ever fabricated')
  assert.equal(degraded.currentValue, null)
})

test('an unreachable store is never reported as a closed target', () => {
  const { authority, calls } = harness({ storeUnreachable: true })
  const unverifiable = authority.current(session('s1'))
  assert.equal(unverifiable.source, 'unavailable')
  assert.match(unverifiable.reason, /cannot be verified/)
  assert.equal(authority.select(session('s1'), 'workspace-write', {}).code, 'unavailable')
  assert.equal(calls.set, 0)
})

test('observation delivers changes only, per handle, verified against the official read', () => {
  const { authority, state } = harness()
  const target = session('s1')
  const first = authority.observe(target)
  const second = authority.observe(target)
  const seenFirst = []
  const seenSecond = []
  first.subscribe((payload) => seenFirst.push(payload))
  second.subscribe((payload) => seenSecond.push(payload))

  authority.ingestSessionEvent({ id: 's1' }, { type: 'permission/preset' })
  assert.equal(seenFirst.length, 0, 'an unchanged preset is not delivered')

  state.preset = 'danger-full-access'
  authority.ingestSessionEvent({ id: 's1' }, { type: 'permission/preset' })
  assert.equal(seenFirst.length, 1)
  assert.equal(seenSecond.length, 1, 'each handle carries its own delivery cell')
  assert.deepEqual({ ...seenFirst[0] }, {
    target: 's1',
    preset: 'danger-full-access',
    options: seenFirst[0].options,
    currentValue: 'workspace-write',
    observedAt: '2026-01-01T00:00:00.000Z',
  })
  assert.equal(Object.isFrozen(seenFirst[0]), true)

  assert.equal(first.dispose().code, 'revoked')
  assert.equal(first.dispose().code, 'stale')
  authority.ingestSessionEvent({ id: 's2' }, { type: 'permission/preset' })
  assert.equal(seenSecond.length, 1, 'another target never reaches this handle')
})

test('observation containment: a throwing listener degrades alone', () => {
  const diagnostics = []
  const { authority, state } = harness({ logger: { warn: (message) => diagnostics.push(message) } })
  const handle = authority.observe(session('s1'))
  const seen = []
  handle.subscribe(() => { throw new Error('listener exploded') })
  handle.subscribe((payload) => seen.push(payload))
  state.preset = 'danger-full-access'
  authority.ingestSessionEvent({ id: 's1' }, { type: 'permission/preset' })
  assert.equal(seen.length, 1)
  assert.equal(diagnostics.some((message) => message.includes('listener threw')), true)
})

test('the close fact retires the handle and the store governs delivery', () => {
  const { authority, sessions, state } = harness()
  const handle = authority.observe(session('s1'))
  const seen = []
  handle.subscribe((payload) => seen.push(payload))
  authority.ingestSessionDisposed({ id: 's1' })
  assert.equal(seen.length, 0, 'the change feed carries state changes, not lifecycle notices')
  assert.equal(handle.current().source, 'degraded')
  assert.match(handle.current().reason, /closed/)
  assert.equal(handle.subscribe(() => {}) instanceof Function, true)

  // Presence alone retires a handle when no close fact arrives.
  const other = harness()
  const second = other.authority.observe(session('s1'))
  const secondSeen = []
  second.subscribe((payload) => secondSeen.push(payload))
  other.sessions.delete('s1')
  other.state.preset = 'danger-full-access'
  other.authority.ingestSessionEvent({ id: 's1' }, { type: 'permission/preset' })
  assert.equal(secondSeen.length, 0, 'an unverified presence never fabricates a delivery')
  assert.equal(second.current().source, 'degraded')
  assert.equal(state.preset, 'workspace-write')
})

test('epochs: stale handles fail typed after the hub is disposed, unbound targets stay honest', () => {
  const { authority } = harness()
  const handle = authority.observe(session('s1'))
  assert.equal(typeof handle.epoch, 'number')
  authority.dispose()
  assert.equal(handle.current().source, 'degraded')
  assert.match(handle.current().reason, /stale/)
  const seen = []
  handle.subscribe((payload) => seen.push(payload))
  assert.equal(seen.length, 0)
  assert.equal(handle.dispose().code, 'stale')

  const unbound = harness().authority.observe({})
  assert.equal(unbound.current().source, 'unavailable')
  assert.match(unbound.current().reason, /official session handle/)
  const late = []
  unbound.subscribe((payload) => late.push(payload))
  assert.equal(late.length, 0, 'an unusable target accepts no subscription')
})

test('the core-inactive gate is the single typed-throw path', () => {
  const { authority } = harness({ inactive: true })
  assert.throws(() => authority.current(session('s1')), PluginApiInactiveError)
  assert.throws(() => authority.options(session('s1')), PluginApiInactiveError)
  assert.throws(() => authority.select(session('s1'), 'workspace-write', {}), PluginApiInactiveError)
  assert.throws(() => authority.observe(session('s1')), PluginApiInactiveError)
  assert.equal(authority.availability().status, 'active', 'availability never throws')
})

test('availability reflects the two substrates and never throws', () => {
  assert.equal(harness().authority.availability().status, 'active')
  assert.equal(harness({ noService: true }).authority.availability().status, 'unavailable')
  assert.equal(harness({ optionsAvailable: false }).authority.availability().status, 'degraded')
  assert.equal(harness({ observeAvailable: false }).authority.availability().status, 'degraded')
  const both = harness({ optionsAvailable: false, observeAvailable: false }).authority.availability()
  assert.match(both.reason, /projection carrier.*fact stream/)
})

test('the module touches only its declared seams: no prompt registration, no session writes', () => {
  const touched = []
  const target = {
    id: 's1',
    seq: 0,
    append() { touched.push('session.append'); throw new Error('the facade must never append session events') },
    emit() { touched.push('session.emit'); throw new Error('the facade must never emit session events') },
  }
  const authority = createPermissionPresetAuthority({
    active: () => true,
    resolvePresets: () => ({ current: () => 'workspace-write', set: () => {}, resolve: () => ({}) }),
    resolveTargetPresence: () => true,
    resolveOwnerId: () => 'plugin-a',
  })
  assert.equal(authority.select(target, 'workspace-write', {}).ok, false)
  assert.equal(authority.current(target).source, 'official')
  authority.observe(target).dispose()
  assert.deepEqual(touched, [])
})

test('an overflowing audit ring never blocks the selection effect', () => {
  const ring = createPermissionPresetAuditRing({ capacity: 1 })
  ring.record({ ownerId: 'p', target: 's1', preset: 'workspace-write', outcome: 'attempt' })
  ring.record({ ownerId: 'p', target: 's1', preset: 'danger-full-access', outcome: 'attempt' })
  const view = ring.view()
  assert.equal(view.records.length, 1)
  assert.equal(view.truncated, true, 'the oldest record is dropped, the ring stays usable')

  // The authority records through the ring without ever turning an audit
  // problem into a failed selection.
  const { authority } = harness()
  assert.equal(authority.select(session('s1'), 'danger-full-access', {}).code, 'committed')
  assert.equal(authority.audit().truncated, false)
  assert.equal(authority.audit().records.every((record) => typeof record.reason === 'undefined' || typeof record.reason === 'string'), true)
})

test('reasons and diagnostics are bounded and secret-shaped error text is redacted', () => {
  const diagnostics = []
  const authority = createPermissionPresetAuthority({
    active: () => true,
    resolvePresets: () => ({
      current: () => 'workspace-write',
      resolve: () => ({}),
      set() { throw new Error(`permission: write failed with token sk-live-${'a'.repeat(60)}`) },
    }),
    resolveTargetPresence: () => true,
    resolveOwnerId: () => 'plugin-a',
    logger: { warn: (message) => diagnostics.push(message) },
  })
  const result = authority.select(session('s1'), 'danger-full-access', {})
  assert.equal(result.code, 'internal')
  const record = authority.audit().records.at(-1)
  assert.ok(record.reason.length <= 240, 'the audit reason stays bounded')
  assert.equal(diagnostics.length >= 1, true)
  assert.equal(diagnostics.every((message) => message.length <= 300), true, 'diagnostics stay bounded')
  assert.equal(diagnostics.some((message) => message.includes('sk-live-')), false, 'credential-shaped text never reaches the log')
  assert.equal(record.reason.includes('sk-live-'), false, 'credential-shaped text never reaches the audit')
})

test('only the three knob facts trigger a re-read; a change resumes after an unreachable store', () => {
  const options = { storeUnreachable: false }
  const sessions = new Map([['s1', { id: 's1' }]])
  const state = { preset: 'workspace-write' }
  const reads = { current: 0 }
  const authority = createPermissionPresetAuthority({
    active: () => true,
    resolvePresets: () => ({
      current() { reads.current += 1; return state.preset },
      resolve: () => ({}),
      set() {},
    }),
    resolveTargetPresence: (id) => (options.storeUnreachable ? null : sessions.has(id) ? true : false),
    resolveOwnerId: () => 'plugin-a',
  })
  const handle = authority.observe({ id: 's1', events: [] })
  const seen = []
  handle.subscribe((payload) => seen.push(payload.preset))

  // Non-knob and unreadable facts never reach the re-read.
  const before = reads.current
  authority.ingestSessionEvent({ id: 's1' }, { type: 'request/header' })
  authority.ingestSessionEvent({ id: 's1' }, { type: 'turn/start' })
  authority.ingestSessionEvent({ id: 's1' })
  assert.equal(reads.current, before, 'only permission/preset, sandbox/mode and approval/policy trigger a re-read')

  // Each knob fact re-reads (and delivers only when the state moved).
  authority.ingestSessionEvent({ id: 's1' }, { type: 'sandbox/mode' })
  assert.equal(reads.current > before, true)
  const afterSandbox = reads.current
  authority.ingestSessionEvent({ id: 's1' }, { type: 'approval/policy' })
  assert.equal(reads.current > afterSandbox, true)
  assert.equal(seen.length, 0, 'no delivery without a composed-state change')

  // An unreachable store skips the delivery outright, and the same handle
  // resumes once the presence is verifiable again.
  options.storeUnreachable = true
  state.preset = 'danger-full-access'
  authority.ingestSessionEvent({ id: 's1' }, { type: 'permission/preset' })
  assert.equal(seen.length, 0, 'an unreachable store never fabricates a delivery')
  options.storeUnreachable = false
  state.preset = 'danger-full-access'
  authority.ingestSessionEvent({ id: 's1' }, { type: 'permission/preset' })
  assert.equal(seen.length, 1, 'delivery resumes once the presence is verifiable again and now reports the motion')
  assert.equal(seen[0], 'danger-full-access')
})
