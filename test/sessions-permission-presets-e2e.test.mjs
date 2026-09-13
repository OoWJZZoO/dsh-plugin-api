/**
 * End-to-end acceptance for the controlled permission-preset face
 * (`sessions.permissionPresets`) through the public facade only.
 *
 * The harness (see `session-permission-presets-test-kit.mjs`) boots a real
 * cordis tree carrying the real official approval service plus probed-shape
 * doubles of the preset component and the projection carrier, so the
 * consistency evidence runs the official approval decision chain.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createHarness, createOfficialPermissionPresets } from './session-permission-presets-test-kit.mjs'

const permissionPresetsOf = (kit) => kit.root.pluginApi.sessions.permissionPresets

test('a committed selection: mapping, official read-back and the idempotent repeat', async () => {
  const kit = await createHarness()
  const session = kit.createSession('s1')
  const caller = await kit.caller('CallerA')
  const face = caller.permissions

  assert.equal(face.availability().status, 'active')
  const initial = face.current(session)
  assert.deepEqual({ ...initial }, {
    target: 's1',
    preset: 'workspace-write',
    observedAt: initial.observedAt,
    source: 'official',
  })

  const result = face.select(session, 'danger-full-access')
  assert.deepEqual({ ...result }, {
    ok: true,
    code: 'committed',
    commitState: 'success',
    preset: 'danger-full-access',
    appliedAt: result.appliedAt,
  })
  assert.equal(kit.presets.writes.preset, 1, 'the official seam owns the durable write')
  assert.equal(kit.presets.writes.approval, 1, 'the preset bundle writes its approval knob')
  assert.equal(session.events.filter((event) => event.type === 'permission/preset').length, 2, 'the initial pin plus this selection')
  assert.equal(face.current(session).preset, 'danger-full-access', 'the facade read follows the official fold')

  // The repeat is the declared idempotent result and writes nothing further.
  const repeat = face.select(session, 'danger-full-access')
  assert.deepEqual({ ...repeat }, {
    ok: false,
    code: 'unchanged',
    preset: 'danger-full-access',
    reason: 'the requested preset is already effective',
  })
  assert.equal(kit.presets.writes.preset, 1)
  assert.equal(session.events.filter((event) => event.type === 'permission/preset').length, 2)
})

test('the selection changes a real approval decision (official chain, not a copy)', async () => {
  const kit = await createHarness()
  const session = kit.createSession('s1')
  const caller = await kit.caller('CallerA')

  // Baseline: the workspace-write preset asks (the waterfall is reached).
  assert.equal(kit.approval.effectivePolicy(session), 'ask')
  const asked = []
  const releaseAsk = kit.root.on('approval/request', () => { asked.push('asked'); return 'allowed-once' })
  const req = { agent: { session }, requestId: 'r-1' }
  assert.equal(await kit.approval.decide(req, session), 'allowed-once', 'the ask policy dispatches the official approval waterfall and its answer decides')
  assert.equal(asked.length, 1)

  // Selecting the no-approval preset flips the real decision to rejected
  // without ever reaching the waterfall.
  assert.equal(caller.permissions.select(session, 'danger-full-access').code, 'committed')
  assert.equal(kit.approval.effectivePolicy(session), 'never')
  assert.equal(await kit.approval.decide(req, session), 'rejected')
  assert.equal(asked.length, 1, 'the never policy rejects before the waterfall')

  // Switching back restores the asking behaviour through the same chain.
  assert.equal(caller.permissions.select(session, 'workspace-write').code, 'committed')
  assert.equal(kit.approval.effectivePolicy(session), 'ask')
  assert.equal(await kit.approval.decide(req, session), 'allowed-once')
  assert.equal(asked.length, 2)
  releaseAsk()
})

test('refusals stay typed, change nothing and are audited', async () => {
  const kit = await createHarness()
  const session = kit.createSession('s1')
  const caller = await kit.caller('CallerA')
  const face = caller.permissions
  const before = session.events.length

  assert.equal(face.select(null, 'workspace-write').code, 'invalid-input')
  assert.equal(face.select(session, '').code, 'invalid-input')
  assert.equal(face.select(session, 'custom').code, 'invalid-preset', 'the derived state is never a selection target')
  assert.equal(face.select(session, 'not-a-preset').code, 'unknown-preset')
  assert.equal(face.select({ id: 'ghost', events: [] }, 'workspace-write').code, 'invalid-target')
  assert.equal(session.events.length, before, 'no refusal reached the official write seam')
  assert.equal(kit.presets.writes.preset, 0)
})

test('an unattributable caller is refused and reaches no official seam', async () => {
  const kit = await createHarness()
  const session = kit.createSession('s1')
  // A caller context that carries no plugin identity at all.
  const anonymous = kit.service._sessionPermissionPresetsSlot.api.surfaceFor({})
  const denied = anonymous.select(session, 'danger-full-access')
  assert.equal(denied.ok, false)
  assert.equal(denied.code, 'denied', 'ownership is derived, never guessed')
  assert.equal(kit.presets.writes.preset, 0)
  assert.equal(permissionPresetsOf(kit).availability().status, 'active', 'the face itself stays healthy')
})

test('changes made through official paths reach subscribers, with containment and stale isolation', async () => {
  const kit = await createHarness()
  const session = kit.createSession('s1')
  const caller = await kit.caller('CallerA')
  const face = caller.permissions

  const first = face.observe(session)
  const second = face.observe(session)
  const seenFirst = []
  const seenSecond = []
  first.subscribe(() => { throw new Error('broken listener') })
  first.subscribe((payload) => seenFirst.push(payload))
  second.subscribe((payload) => seenSecond.push(payload))

  // Official path: the facade never issued this selection. A bundle change may
  // land as several knob facts, so the feed reports each composed change and
  // the last delivery carries the settled state.
  kit.presets.service.set(session, 'danger-full-access')
  kit.emitFact(session, 'permission/preset', { preset: 'danger-full-access' })
  assert.equal(seenFirst.length >= 1, true, 'the broken listener is contained, the healthy one still receives')
  assert.equal(seenSecond.length, seenFirst.length, 'both handles see the same composed changes')
  assert.equal(seenFirst.at(-1).preset, 'danger-full-access')
  assert.deepEqual(seenFirst.at(-1).options.map((option) => option.value), ['workspace-write', 'danger-full-access'])
  assert.equal(seenFirst.at(-1).currentValue, 'danger-full-access')

  // The official command path (`apply` + the approval service's own live
  // `setPolicy`) writes the same durable knob facts and is observable too.
  const beforeSecond = seenSecond.length
  const agent = { session, inject() {} }
  kit.presets.service.apply(session, 'workspace-write', (policy) => kit.approval.setPolicy(agent, policy))
  assert.equal(kit.approval.effectivePolicy(session), 'ask', 'the real approval service applies the live policy change')
  assert.equal(seenSecond.length > beforeSecond, true, 'the command-path change reached the subscriber')
  assert.equal(seenFirst.length, seenSecond.length, 'both handles see the same composed changes')
  assert.equal(face.current(session).preset, 'workspace-write', 'the read face follows the command-path change')
  assert.equal(face.options(session).currentValue, 'workspace-write')

  const firstCount = seenFirst.length
  const secondCount = seenSecond.length
  assert.equal(first.dispose(), true)
  first.subscribe(() => {})
  kit.presets.service.set(session, 'danger-full-access')
  kit.emitFact(session, 'permission/preset', { preset: 'danger-full-access' })
  assert.equal(seenFirst.length, firstCount, 'a disposed handle receives nothing further')
  assert.equal(seenSecond.length > secondCount, true)
})

test('a closed session stops the feed and degrades typed reads', async () => {
  const kit = await createHarness()
  const session = kit.createSession('s1')
  const caller = await kit.caller('CallerA')
  const face = caller.permissions
  const handle = face.observe(session)
  const seen = []
  handle.subscribe((payload) => seen.push(payload))

  kit.sessions.delete('s1')
  kit.root.emit('session/disposed', session)
  assert.equal(seen.length, 0, 'the close fact retires the handle instead of pushing a lifecycle notice')
  assert.equal(handle.current().source, 'degraded')
  assert.match(handle.current().reason, /closed/)

  kit.emitFact(session, 'permission/preset', { preset: 'danger-full-access' })
  assert.equal(seen.length, 0, 'a closed target never delivers again')
  assert.equal(face.select(session, 'danger-full-access').code, 'invalid-target')
})

test('the disabled face returns typed results and never removes the namespace', async () => {
  const kit = await createHarness({ noPresets: true })
  const session = kit.createSession('s1', { seed: false })
  const face = permissionPresetsOf(kit)
  assert.equal(face.availability().status, 'unavailable')
  assert.equal(face.current(session).source, 'unavailable')
  assert.deepEqual({ ...face.options(session) }, {
    target: null,
    options: [],
    currentValue: null,
    observedAt: null,
    source: 'unavailable',
    reason: 'the sessions.permissionPresets feature is not mounted in this installation',
  })
  assert.equal(face.select(session, 'workspace-write').code, 'unavailable')
  const handle = face.observe(session)
  assert.equal(handle.current().source, 'unavailable')
  const seen = []
  handle.subscribe((payload) => seen.push(payload))
  assert.equal(seen.length, 1, 'the disabled handle reports its state once')
  assert.equal(handle.dispose(), false)
})

test('a missing projection carrier degrades options alone', async () => {
  const kit = await createHarness({ noProjection: true })
  const session = kit.createSession('s1')
  const caller = await kit.caller('CallerA')
  const face = caller.permissions

  assert.equal(face.availability().status, 'degraded')
  assert.match(face.availability().reason, /projection carrier/)
  const options = face.options(session)
  assert.equal(options.source, 'degraded')
  assert.equal(options.target, 's1')
  assert.deepEqual([...options.options], [], 'no option is ever fabricated')
  assert.equal(face.current(session).source, 'official', 'the preset read does not depend on the projection carrier')
  assert.equal(face.select(session, 'danger-full-access').code, 'committed', 'the write face still works')
  assert.match(kit.root.pluginApi.sessions.availability().reason, /permission presets degraded/)
})

test('the feature is orthogonal: no prompt sections, no session writes beyond the official seam', async () => {
  const kit = await createHarness()
  const session = kit.createSession('s1')
  const caller = await kit.caller('CallerA')
  const face = caller.permissions

  const written = []
  const originalAppend = session.append
  session.append = (type, data) => { written.push(type); return originalAppend(type, data) }
  const promptsBefore = kit.systemPromptCalls.length
  const approvalsBefore = kit.approvalDecisions.length

  face.select(session, 'danger-full-access')
  face.current(session)
  face.options(session)
  face.observe(session).subscribe(() => {})
  kit.emitFact(session, 'permission/preset', { preset: 'danger-full-access' })

  assert.equal(written.every((type) => ['permission/preset', 'sandbox/mode', 'approval/policy'].includes(type)), true, 'only the official seam writes the log')
  assert.equal(kit.approvalDecisions.length, approvalsBefore, 'the facade never asks for an approval decision')
  assert.equal(kit.systemPromptCalls.length, promptsBefore, 'the facade registers no prompt section or context')

  // The passthrough keeps its audited read members and gains no write member.
  const passthrough = kit.root.pluginApi.services.permissionPresets
  assert.equal(typeof passthrough.current, 'function')
  assert.equal('set' in passthrough, false, 'services.permissionPresets never re-gains a raw write member')
  assert.equal('selectFor' in passthrough, false, 'services.permissionPresets never re-gains selectFor')
})

test('capability and availability registration mirror the runtime face', async () => {
  const kit = await createHarness()
  kit.createSession('s1')
  const capabilities = kit.root.pluginApi.capabilities
  assert.equal(capabilities.list({ prefix: 'sessions.' }).includes('sessions.permissionPresets'), true)
  assert.equal(capabilities.get('sessions.permissionPresets').capability, 'sessions.permissionPresets')
  assert.equal(capabilities.get('sessions.permissionPresets').status, 'active')
})

test('two independent trees, reverse registration order: the official fold decides every race', async () => {
  // Two plugin trees over ONE official preset component and ONE session store;
  // the two products of "two synthetic plugins".
  const official = createOfficialPermissionPresets()
  const sessions = new Map()
  const treeA = await createHarness({ officialInstance: official, sessions })
  const treeB = await createHarness({ officialInstance: official, sessions })
  const session = treeA.createSession('s1')
  assert.equal(treeB.sessions.get('s1'), session, 'both trees see the same official session')

  // Registration order: tree A registers its plugin first, tree B second.
  const firstRegistered = await treeA.caller('CallerA')
  const secondRegistered = await treeB.caller('CallerB')

  // Action order is the REVERSE of registration: the later-registered plugin
  // submits first, and the official seam still decides.
  const first = secondRegistered.permissions.select(session, 'danger-full-access')
  const second = firstRegistered.permissions.select(session, 'danger-full-access')
  assert.equal(first.code, 'committed', 'the later-registered plugin still commits through the official seam')
  assert.equal(second.code, 'unchanged', 'the racing repeat is the idempotent verb, never a second commit')
  assert.equal(official.writes.preset, 1, 'the official seam wrote exactly one preset fact')

  // Opposite selections in sequence: the official fold is the final arbiter
  // and both trees read the same value.
  assert.equal(firstRegistered.permissions.select(session, 'workspace-write').code, 'committed')
  assert.equal(secondRegistered.permissions.select(session, 'danger-full-access').code, 'committed')
  assert.equal(secondRegistered.permissions.current(session).preset, 'danger-full-access')
  assert.equal(firstRegistered.permissions.current(session).preset, 'danger-full-access', 'both trees read the same official authority')

  // A state change written through one tree is observable from the other
  // tree's substrate (both fold the same official log), and a repeated fact
  // without a state change publishes nothing.
  const handle = secondRegistered.permissions.observe(session)
  const seen = []
  handle.subscribe((payload) => seen.push(payload.preset))
  treeB.emitFact(session, 'permission/preset', { preset: 'danger-full-access' })
  assert.equal(seen.length, 0, 'a fact without a state change never delivers')
  firstRegistered.permissions.select(session, 'workspace-write')
  treeB.emitFact(session, 'permission/preset', { preset: 'workspace-write' })
  assert.equal(seen.at(-1), 'workspace-write', 'the other tree observes the same official change')
  handle.dispose()
})

test('a service without its write member disables the feature through the guard and isolates it', async () => {
  const kit = await createHarness({ presetsWithoutSet: true, noPresets: false })
  const guard = await import('../lib/guards.js')
  const result = guard.runFeatureGuard('sessionPermissionPresets', kit.root)
  assert.equal(result.ok, false, 'the guard refuses a service that lacks the write member')
  assert.equal(result.problems.some((problem) => problem.name === 'permissionPresets'), true)
  // Unrelated capabilities and members stay intact.
  assert.equal(typeof kit.root.pluginApi.tools.register, 'function')
  assert.equal(typeof kit.root.pluginApi.sessions.get, 'function')
  assert.equal(typeof kit.root.pluginApi.sessions.views.deriveMessages, 'function')
  assert.equal(typeof kit.root.pluginApi.events.observe, 'function')
  assert.equal(typeof kit.root.pluginApi.capabilities.get('tools').status, 'string')
})

test('a failed fact-stream subscription degrades observation alone', async () => {
  const kit = await createHarness()
  const session = kit.createSession('s1')
  // A context whose event substrate refuses subscriptions; everything else
  // resolves through the real root.
  const hostile = new Proxy(kit.root, {
    get(target, property) {
      if (property === 'on') return () => { throw new Error('no event substrate') }
      if (property === 'get') return (name) => target.get(name)
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const { createPermissionPresetFeature } = await import('../lib/sessions-permission-presets-facade.js')
  const { createFeatureRegistry } = await import('../lib/feature-registry.js')
  const registry = createFeatureRegistry()
  const feature = createPermissionPresetFeature({ ctx: hostile, service: kit.service, logger: { warn() {} } })
  kit.service.mountFeature('sessionPermissionPresets', feature.api)
  registry.mount('sessionPermissionPresets')

  const face = kit.root.pluginApi.sessions.permissionPresets
  assert.equal(face.availability().status, 'degraded', 'the missing fact stream degrades observation')
  assert.match(face.availability().reason, /fact stream/)
  assert.equal(face.current(session).source, 'official', 'the read face still answers')
  assert.equal(face.options(session).source, 'official', 'the options face still answers')
  const caller = await kit.caller('CallerA')
  assert.equal(caller.permissions.select(session, 'danger-full-access').code, 'committed', 'the write face still commits')
  feature.disposer()
})

test('the feature stays inside its declared service seams', async () => {
  const kit = await createHarness()
  const session = kit.createSession('s1')
  const caller = await kit.caller('CallerA')
  const tracker = kit.trackServiceAccess()

  caller.permissions.current(session)
  caller.permissions.options(session)
  caller.permissions.select(session, 'danger-full-access')
  const handle = caller.permissions.observe(session)
  handle.subscribe(() => {})
  kit.emitFact(session, 'permission/preset', { preset: 'danger-full-access' })
  handle.dispose()

  assert.deepEqual(tracker.outside(), [], 'the feature resolves only permissionPresets, sessionProjections and sessions')
})

test('a disabled feature never takes unrelated capabilities down with it', async () => {
  const kit = await createHarness({ noPresets: true })
  kit.createSession('s1')
  assert.equal(typeof kit.root.pluginApi.tools.register, 'function')
  assert.equal(typeof kit.root.pluginApi.sessions.get, 'function')
  assert.equal(typeof kit.root.pluginApi.sessions.observe, 'function')
  assert.equal(typeof kit.root.pluginApi.events.observe, 'function')
  assert.equal(kit.root.pluginApi.capabilities.get('sessions.permissionPresets').status, 'unavailable')
  assert.notEqual(kit.root.pluginApi.capabilities.get('sessions').status, 'active', 'the sessions capability reflects only its own features')
  assert.equal(typeof kit.root.pluginApi.capabilities.get('tools').status, 'string')
})

test('a mounted feature keeps its namespace shape when the core turns inert', async () => {
  const kit = await createHarness()
  const session = kit.createSession('s1')
  assert.equal(kit.root.pluginApi.sessions.permissionPresets.availability().status, 'active')

  const previous = process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
  process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = '1'
  try {
    kit.service.reconcile({ registry: kit.service._registry, coreActive: () => false })
    assert.equal(kit.service.isActive, false)
    const face = kit.root.pluginApi.sessions.permissionPresets
    assert.ok(face, 'the member never disappears while the core is inert')
    assert.deepEqual({ ...face.availability() }, {
      status: 'unavailable',
      reason: 'the sessions.permissionPresets feature is not mounted in this installation',
    })
    const inactive = (error) => error?.name === 'PluginApiInactiveError'
    assert.throws(() => face.current(session), inactive)
    assert.throws(() => face.select(session, 'workspace-write'), inactive)
  } finally {
    if (previous === undefined) delete process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL
    else process.env.DSH_PLUGIN_API_FORCE_GUARD_FAIL = previous
  }
})

test('unmounting retires the slot, its subscriptions and its handles', async () => {
  const kit = await createHarness()
  const session = kit.createSession('s1')
  const face = kit.root.pluginApi.sessions.permissionPresets
  const handle = face.observe(session)
  assert.equal(handle.current().source, 'official')
  const activeBefore = kit.subscriptions.filter((entry) => entry.active).length
  assert.equal(activeBefore >= 2, true, 'the feature owns the two fact subscriptions while mounted')

  // The assembly's unload sequence: `prepared.rollback()` replaces the slot
  // with the typed disabled api, then the owner cleanup disposes the authority
  // and its subscriptions.
  assert.equal(kit.prepared.rollback(), true)
  const after = kit.root.pluginApi.sessions.permissionPresets
  assert.equal(after.availability().status, 'unavailable', 'the namespace answers honestly after the rollback')
  assert.equal(after.select(session, 'workspace-write').code, 'unavailable')
  kit.feature.disposer()
  assert.equal(handle.current().source, 'degraded', 'authority teardown retires every handle')
  assert.match(handle.current().reason, /stale/)
  const activeAfter = kit.subscriptions.filter((entry) => entry.active).length
  assert.equal(activeAfter, activeBefore - 2, 'both feature-owned fact subscriptions are released')

  // A fact published after teardown no longer reaches the retired handle.
  const seen = []
  handle.subscribe((payload) => seen.push(payload))
  kit.emitFact(session, 'permission/preset', { preset: 'danger-full-access' })
  assert.equal(seen.length, 0)
})

test('each knob fact moves the feed, and non-knob facts never do', async () => {
  const kit = await createHarness()
  const session = kit.createSession('s1')
  const caller = await kit.caller('CallerA')
  const handle = caller.permissions.observe(session)
  const seen = []
  handle.subscribe((payload) => seen.push(payload))

  // A sandbox knob written by another official component is observable.
  assert.equal(kit.presets.service.set(session, 'danger-full-access'), undefined)
  assert.equal(seen.length >= 1, true)
  assert.equal(seen.at(-1).preset, 'danger-full-access')

  // A non-knob fact publishes nothing, even though the session is bound.
  const before = seen.length
  kit.emitFact(session, 'request/header', {})
  kit.emitFact(session, 'turn/start', { turn: 1 })
  assert.equal(seen.length, before, 'only permission/preset, sandbox/mode and approval/policy move the composed state')

  // An approval-policy knob alone moves the composed view as well (the knob is
  // appended to the durable log, as the official seam does).
  session.append('approval/policy', { policy: 'ask' })
  assert.equal(seen.length > before, true, 'the approval knob alone produced a delivery')
  handle.dispose()
})
