/**
 * End-to-end acceptance for scoped agent contributions.
 *
 * The mock harness lives in `scoped-agent-test-kit.mjs` and reproduces the
 * probed official semantics recorded in the feature's tasks probe record
 * (host-singleton tools/systemPrompt with per-agent scoped layers, caller
 * -shadow binding by access context, agent-identity assembly, lifecycle facts
 * delivered to root-context listeners). Every scenario below goes through
 * public facade entries only.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createHarness, scopedSection } from './scoped-agent-test-kit.mjs'

test('two agents, one plugin: each target sees only its own contributions', async () => {
  const { state, makeAgent, singletons } = createHarness()
  const agentA = makeAgent('agent-a')
  const agentB = makeAgent('agent-b')
  const scopes = state.pluginApi.agents.scopes
  const handleA = scopes.register({ agent: 'agent-a' }).handle
  const handleB = scopes.register({ agent: 'agent-b' }).handle

  const first = state.pluginApi.prompts.contribute(scopedSection('guide-a', 'A only'))
  assert.equal(first.ok, true, 'scope-less spec still installs globally')
  first.handle.dispose()

  const contributedA = state.pluginApi.prompts.contribute({ ...scopedSection('guide-a', 'A only'), scope: handleA })
  assert.equal(contributedA.ok, true)
  const contributedB = state.pluginApi.prompts.contribute({ ...scopedSection('guide-b', 'B only'), scope: handleB })
  assert.equal(contributedB.ok, true)

  const asmA = await singletons.systemPrompt.assemble({ agent: 'agent-a' })
  const asmB = await singletons.systemPrompt.assemble({ agent: 'agent-b' })
  assert.deepEqual(asmA.sections.map((section) => section.name), ['guide-a'])
  assert.deepEqual(asmB.sections.map((section) => section.name), ['guide-b'])
})

test('two contributors on one target coexist with owner attribution', async () => {
  const { state, makeAgent, singletons } = createHarness()
  makeAgent('shared')
  const scopes = state.pluginApi.agents.scopes
  const handle = scopes.register({ agent: 'shared' }).handle
  const first = state.pluginApi.prompts.contribute({ ...scopedSection('one', 'one'), scope: handle, ownerId: 'owner-1' })
  const second = state.pluginApi.prompts.contribute({ ...scopedSection('two', 'two'), scope: handle, ownerId: 'owner-2' })
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(first.handle.ownerId, 'owner-1')
  assert.equal(second.handle.ownerId, 'owner-2')
  const asm = await singletons.systemPrompt.assemble({ agent: 'shared' })
  assert.deepEqual(asm.sections.map((section) => section.name), ['one', 'two'])
  // disposal of one owner's contribution leaves the other intact
  assert.equal(first.handle.dispose().code, 'revoked')
  const after = await singletons.systemPrompt.assemble({ agent: 'shared' })
  assert.deepEqual(after.sections.map((section) => section.name), ['two'])
})

test('global and scoped contributions stack in the fixed composition order', async () => {
  const { state, makeAgent, singletons } = createHarness()
  makeAgent('agent-x')
  const handle = state.pluginApi.agents.scopes.register({ agent: 'agent-x' }).handle
  assert.equal(state.pluginApi.prompts.contribute(scopedSection('global-1', 'g1')).ok, true)
  assert.equal(state.pluginApi.prompts.contribute({ ...scopedSection('scoped-1', 's1'), scope: handle }).ok, true)

  const target = await singletons.systemPrompt.assemble({ agent: 'agent-x' })
  assert.deepEqual(target.sections.map((section) => section.name), ['global-1', 'scoped-1'], 'global additive first, then target-scoped')
  const other = await singletons.systemPrompt.assemble({ agent: 'nobody' })
  assert.deepEqual(other.sections.map((section) => section.name), ['global-1'], 'non-targets stay clean')
})

test('tools: scoped registration and restriction are target-only', async () => {
  const { state, makeAgent, singletons } = createHarness()
  makeAgent('agent-t')
  const handle = state.pluginApi.agents.scopes.register({ agent: 'agent-t' }).handle
  state.pluginApi.tools.register({ name: 'global-tool' })
  state.pluginApi.tools.register({ name: 'scoped-tool' }, { scope: handle })
  state.pluginApi.tools.restrict.register(() => false, { scope: handle })

  const viewTarget = singletons.tools.view('agent-t')
  const viewOther = singletons.tools.view('agent-other')
  assert.deepEqual(viewTarget.tools, ['global-tool', 'scoped-tool'])
  assert.deepEqual(viewOther.tools, ['global-tool'])
  assert.equal(viewTarget.restricts, 1, 'scoped restriction applies to the target only')
})

test('cold resume: same identity re-announcement re-installs the scoped contribution', async () => {
  const { state, makeAgent, announce, disposeAgent, singletons } = createHarness()
  makeAgent('resume-x')
  const handle = state.pluginApi.agents.scopes.register({ agent: 'resume-x' }).handle
  assert.equal(state.pluginApi.prompts.contribute({ ...scopedSection('persist', 'kept'), scope: handle }).ok, true)
  assert.deepEqual((await singletons.systemPrompt.assemble({ agent: 'resume-x' })).sections.map((section) => section.name), ['persist'])

  // the old instance drains (agent/disposed), the identity resumes (agent/created)
  const oldAgent = null
  void oldAgent
  const registryEntry = state.pluginApi.agents.get('resume-x')
  disposeAgent(registryEntry)
  assert.deepEqual((await singletons.systemPrompt.assemble({ agent: 'resume-x' })).sections, [], 'dormant records reach no assembly')

  const resumed = makeAgent('resume-x')
  announce(resumed.agent)
  assert.deepEqual((await singletons.systemPrompt.assemble({ agent: 'resume-x' })).sections.map((section) => section.name), ['persist'], 're-installed without plugin re-registration')
})

test('destroy cleanup, stale handles, and owner reload never cross-damage', async () => {
  const { state, makeAgent, disposeAgent, singletons } = createHarness()
  makeAgent('doomed')
  makeAgent('survivor')
  const doomedHandle = state.pluginApi.agents.scopes.register({ agent: 'doomed' }).handle
  const survivorHandle = state.pluginApi.agents.scopes.register({ agent: 'survivor' }).handle
  state.pluginApi.prompts.contribute({ ...scopedSection('doomed-s', 'x'), scope: doomedHandle })
  state.pluginApi.prompts.contribute({ ...scopedSection('survivor-s', 'y'), scope: survivorHandle })

  const doomedEntry = state.pluginApi.agents.get('doomed')
  disposeAgent(doomedEntry)
  assert.equal(doomedHandle.status().status, 'destroyed')
  assert.deepEqual((await singletons.systemPrompt.assemble({ agent: 'doomed' })).sections, [])
  assert.deepEqual((await singletons.systemPrompt.assemble({ agent: 'survivor' })).sections.map((section) => section.name), ['survivor-s'])

  // stale contribution disposal after target destruction is a typed no-op
  const doomedContribution = state.pluginApi.prompts.contribute({ ...scopedSection('doomed-s2', 'z'), scope: doomedHandle })
  assert.equal(doomedContribution.ok, false, 'installing onto a destroyed target is typed unavailable')
  assert.equal(doomedContribution.code, 'unavailable')

  // scope handle dispose removes only its own records
  assert.equal(doomedHandle.dispose().status, 'ok')
  assert.equal(doomedHandle.dispose().status, 'stale')
  assert.equal(survivorHandle.dispose().status, 'ok')
  assert.deepEqual((await singletons.systemPrompt.assemble({ agent: 'survivor' })).sections, [], 'survivor records gone only via its own handle')
})

test('the per-step selection snapshot serves variables and route consumption identically', async () => {
  const { state, makeAgent, singletons } = createHarness()
  makeAgent('snap-x')
  const handle = state.pluginApi.agents.scopes.register({ agent: 'snap-x' }).handle
  const cell = state.pluginApi.agents.scopes.snapshotOf(handle)
  assert.equal(cell.ok, true)

  // writer seam (the interactive feature's future obligation)
  const write = (value) => state.pluginApi._scopedContributionFeature.registry.writeSnapshotCurrent(handle, value)
  write({ provider: 'p1', model: 'm1' })

  // a scoped variable contribution reads the per-step snapshot
  assert.equal(state.pluginApi.prompts.contribute({
    kind: 'variable', name: 'selection', scope: handle,
    provider: (context) => {
      const snapshot = state.pluginApi.agents.scopes.snapshotOf(handle)
      return `${snapshot.snapshot.assembled()?.provider ?? ''}/${snapshot.snapshot.assembled()?.model ?? ''}`
    },
  }).ok, true)

  // step 1: assembly captures the current selection and the variable reads it
  const asm1 = await singletons.systemPrompt.assemble({ agent: 'snap-x' })
  assert.equal(asm1.variables.selection, 'p1/m1')
  // route consumption reads the same captured value
  assert.deepEqual(cell.snapshot.assembled(), { provider: 'p1', model: 'm1' })

  // switch between steps: the next assembly sees the new value
  write({ provider: 'p2', model: 'm2' })
  const asm2 = await singletons.systemPrompt.assemble({ agent: 'snap-x' })
  assert.equal(asm2.variables.selection, 'p2/m2')
})

test('fiber-bound install without a scope stays global (target-channel necessity pin)', async () => {
  const { state, makeAgent, singletons } = createHarness()
  makeAgent('agent-a')
  makeAgent('agent-b')
  // installing through the host caller context (no scope) lands globally:
  // cordis resolves by access context, not by execution fiber
  assert.equal(state.pluginApi.prompts.contribute(scopedSection('leaky', 'visible everywhere')).ok, true)
  assert.deepEqual((await singletons.systemPrompt.assemble({ agent: 'agent-a' })).sections.map((section) => section.name), ['leaky'])
  assert.deepEqual((await singletons.systemPrompt.assemble({ agent: 'agent-b' })).sections.map((section) => section.name), ['leaky'], 'the leak proves the explicit scope channel is required')
})

test('all five scoped contribution kinds land in the target layer only', async () => {
  const { state, makeAgent, singletons } = createHarness()
  makeAgent('agent-k')
  const handle = state.pluginApi.agents.scopes.register({ agent: 'agent-k' }).handle
  // the facade's own boot-time global contributions are environment, not
  // scenario data: only the delta this test contributes is asserted
  const globalToolProviders = singletons.__globalLayer.toolProviders.length
  const globalSuppressed = singletons.__globalLayer.suppressed
  const contribute = (spec) => state.pluginApi.prompts.contribute({ ...spec, scope: handle })

  assert.equal(contribute(scopedSection('s', 'section')).ok, true)
  assert.equal(contribute({ kind: 'context', id: 'c', context: { id: 'c', text: () => 'ctx' } }).ok, true)
  assert.equal(contribute({ kind: 'variable', name: 'v', provider: () => 'value' }).ok, true)
  assert.equal(contribute({ kind: 'tools', id: 'p', provider: () => [{ name: 't' }] }).ok, true)
  assert.equal(contribute({ kind: 'suppressRuntimeContext', id: 'sup' }).ok, true)

  const target = await singletons.systemPrompt.assemble({ agent: 'agent-k' })
  assert.deepEqual(target.sections.map((section) => section.name), ['s', 'c'])
  assert.equal(target.variables.v, 'value')
  const targetLayer = singletons.__layers.get('agent-k')
  assert.equal(targetLayer.toolProviders.length, 1)
  assert.equal(targetLayer.suppressed, 1)

  const other = await singletons.systemPrompt.assemble({ agent: 'agent-other' })
  assert.deepEqual(other.sections, [])
  assert.deepEqual(other.variables, {})
  assert.equal(singletons.__globalLayer.toolProviders.length, globalToolProviders, 'nothing landed globally')
  assert.equal(singletons.__globalLayer.suppressed, globalSuppressed)
})

test('scoped failures are typed and never degrade to a global installation', async () => {
  const { state, makeAgent, singletons } = createHarness()
  makeAgent('agent-f')
  const handle = state.pluginApi.agents.scopes.register({ agent: 'agent-f' }).handle

  const unsupported = state.pluginApi.prompts.contribute({ kind: 'nope', id: 'x', scope: handle })
  assert.equal(unsupported.ok, false)
  assert.equal(unsupported.code, 'unsupported')

  const foreign = state.pluginApi.prompts.contribute({ ...scopedSection('f', 'f'), scope: { id: 'scope:9999' } })
  assert.equal(foreign.ok, false)
  assert.equal(foreign.code, 'invalid-input')

  // a throwing official member converts into a typed result, not a caller throw
  const backing = singletons.systemPrompt
  const original = backing.section
  backing.section = () => { throw new Error('official exploded') }
  let failed
  assert.doesNotThrow(() => {
    failed = state.pluginApi.prompts.contribute({ ...scopedSection('boom', 'boom'), scope: handle })
  })
  backing.section = original
  assert.equal(failed.ok, false)
  assert.equal(failed.code, 'error')
  assert.match(failed.reason, /official exploded/)

  assert.deepEqual((await singletons.systemPrompt.assemble({ agent: 'agent-f' })).sections, [], 'no orphan installation survives the failure')
  assert.deepEqual(singletons.__globalLayer.sections, [], 'no failure degraded to the global layer')
})

test('scoped providers are re-evaluated per assembly of the target only', async () => {
  const { state, makeAgent, singletons } = createHarness()
  makeAgent('agent-p')
  const handle = state.pluginApi.agents.scopes.register({ agent: 'agent-p' }).handle
  const variableCalls = []
  assert.equal(state.pluginApi.prompts.contribute({
    kind: 'variable', name: 'v', scope: handle,
    provider: () => { variableCalls.push(variableCalls.length + 1); return variableCalls.length },
  }).ok, true)

  const first = await singletons.systemPrompt.assemble({ agent: 'agent-p' })
  const second = await singletons.systemPrompt.assemble({ agent: 'agent-p' })
  assert.equal(first.variables.v, 1)
  assert.equal(second.variables.v, 2, 'the provider is re-evaluated for every assembly of the target')
  await singletons.systemPrompt.assemble({ agent: 'agent-other' })
  assert.equal(variableCalls.length, 2, 'a non-target assembly never invokes the provider')
})

test('global prompt projections without a target scope exclude scoped contributions', async () => {
  const { state, makeAgent, singletons } = createHarness()
  makeAgent('agent-g')
  const handle = state.pluginApi.agents.scopes.register({ agent: 'agent-g' }).handle
  assert.equal(state.pluginApi.prompts.contribute(scopedSection('global-visible', 'g')).ok, true)
  assert.equal(state.pluginApi.prompts.contribute({ ...scopedSection('scoped-hidden', 's'), scope: handle }).ok, true)

  const hostRender = await singletons.systemPrompt.assemble({})
  assert.deepEqual(hostRender.sections.map((section) => section.name), ['global-visible'])
  assert.equal(singletons.systemPrompt.renderPrompt(), '')
  assert.equal(singletons.__globalLayer.sections.some((def) => def.name === 'scoped-hidden'), false)
})

test('the prompt conflict key is one id namespace per (owner, target)', async () => {
  const { state, makeAgent, singletons } = createHarness()
  makeAgent('agent-c')
  const handle = state.pluginApi.agents.scopes.register({ agent: 'agent-c' }).handle
  assert.equal(state.pluginApi.prompts.contribute({ ...scopedSection('same-id', 's'), scope: handle }).ok, true)

  const clash = state.pluginApi.prompts.contribute({ kind: 'variable', name: 'same-id', scope: handle, provider: () => 'v' })
  assert.equal(clash.ok, false, 'the kind is not part of the key: one id namespace per (owner, target)')
  assert.equal(clash.code, 'conflict')

  const otherOwner = state.pluginApi.prompts.contribute({ ...scopedSection('same-id', 's2'), scope: handle, ownerId: 'owner-2' })
  assert.equal(otherOwner.ok, true, 'a different owner may reuse the id on the same target')
  const asm = await singletons.systemPrompt.assemble({ agent: 'agent-c' })
  assert.deepEqual(asm.sections.map((section) => section.name), ['same-id', 'same-id'])
})

test('tools: conflict rules, identity-bound dispose, and resume re-install', async () => {
  const { state, makeAgent, announce, disposeAgent, singletons } = createHarness()
  makeAgent('agent-tools')
  const handle = state.pluginApi.agents.scopes.register({ agent: 'agent-tools' }).handle
  const first = state.pluginApi.tools.register({ name: 'scoped-one' }, { scope: handle })
  const second = state.pluginApi.tools.register({ name: 'scoped-two' }, { scope: handle })
  assert.equal(first.targetId, 'agent-tools')

  assert.throws(() => state.pluginApi.tools.register({ name: 'scoped-one' }, { scope: handle }), /already active/)
  assert.throws(() => state.pluginApi.tools.register({ name: 'x' }, { scope: { id: 'scope:nope' } }), /live scope handle/)

  assert.deepEqual(singletons.tools.view('agent-tools').tools, ['scoped-one', 'scoped-two'])
  assert.equal(first.dispose().code, 'revoked')
  assert.deepEqual(singletons.tools.view('agent-tools').tools, ['scoped-two'], 'only its own key is removed')
  assert.equal(first.dispose().code, 'stale', 'dispose is idempotent')

  const entry = state.pluginApi.agents.get('agent-tools')
  disposeAgent(entry)
  assert.deepEqual(singletons.tools.view('agent-tools').tools, [], 'a dead target contributes nothing')
  const resumed = makeAgent('agent-tools')
  announce(resumed.agent)
  assert.deepEqual(singletons.tools.view('agent-tools').tools, ['scoped-two'], 're-installed into the new instance layer')
  assert.equal(second.dispose().code, 'revoked')
})

test('scoped contributions are runtime state and never open a durable tier', async () => {
  const { state, makeAgent, singletons, requested } = createHarness()
  requested.length = 0
  makeAgent('agent-d')
  const handle = state.pluginApi.agents.scopes.register({ agent: 'agent-d' }).handle
  state.pluginApi.prompts.contribute({ ...scopedSection('d', 'd'), scope: handle })
  await singletons.systemPrompt.assemble({ agent: 'agent-d' })
  const durableProbes = requested.filter((name) => /storage|persistence|durable/i.test(name))
  assert.deepEqual(durableProbes, [], 'no durable/storage backing is ever requested: scoped state is runtime state')
})

test('two independent plugin fibers on one target: owner attribution and unload isolation', async () => {
  const { makeAgent, createPluginContext, singletons } = createHarness()
  makeAgent('agent-shared')
  const pluginA = createPluginContext('plugin-alpha')
  const pluginB = createPluginContext('plugin-beta')
  const apiA = pluginA.get('pluginApi')
  const apiB = pluginB.get('pluginApi')
  assert.notEqual(apiA, apiB, 'each plugin fiber resolves its own caller-bound facade view')

  const handleA = apiA.agents.scopes.register({ agent: 'agent-shared' }).handle
  const handleB = apiB.agents.scopes.register({ agent: 'agent-shared' }).handle
  assert.equal(handleA.ownerId, 'plugin-alpha', 'the owner derives from the calling plugin fiber')
  assert.equal(handleB.ownerId, 'plugin-beta')

  // the same contribution id under the same target coexists across owners
  assert.equal(apiA.prompts.contribute({ ...scopedSection('shared-id', 'a'), scope: handleA }).ok, true)
  assert.equal(apiB.prompts.contribute({ ...scopedSection('shared-id', 'b'), scope: handleB }).ok, true)
  // but repeats within one owner still conflict
  assert.equal(apiA.prompts.contribute({ ...scopedSection('shared-id', 'a2'), scope: handleA }).code, 'conflict')
  assert.deepEqual((await singletons.systemPrompt.assemble({ agent: 'agent-shared' })).sections.map((section) => section.name), ['shared-id', 'shared-id'])

  // owner unload removes that plugin's contributions and handles only
  pluginA.teardown()
  assert.equal(handleA.dispose().status, 'stale', 'the unloaded owner handle left with its fiber')
  assert.equal(handleB.status().status, 'usable', 'the other owner is untouched')
  assert.deepEqual((await singletons.systemPrompt.assemble({ agent: 'agent-shared' })).sections.map((section) => section.name), ['shared-id'])
  assert.equal(handleB.dispose().status, 'ok')
})

test('without the lifecycle substrate the feature degrades alone with typed errors', () => {
  const healthy = createHarness()
  assert.equal(healthy.state.pluginApi.capabilities.get('agents.scopes').status, 'active',
    'the healthy backing is reported as active')
  assert.doesNotThrow(() => healthy.state.pluginApi.agents.scopes.register({ agent: 'missing-agent' }),
    'a missing target is a typed result, not a capability failure')

  const { state, makeAgent } = createHarness({ omitListenerSubstrate: true })
  const api = state.pluginApi
  // the registered member stays present and reports the typed degradation
  assert.throws(
    () => api.agents.scopes.register({ agent: 'agent-a' }),
    (error) => error?.name === 'PluginApiFeatureDisabledError' && error.feature === 'agents.scopes',
  )
  // the capability reports the real backing state instead of object presence
  assert.equal(api.capabilities.get('agents.scopes').status, 'degraded')
  assert.equal(api.capabilities.get('agents').status, 'active', 'the agents domain itself stays healthy')
  // unrelated agent members and the global contribution entry are unaffected
  assert.doesNotThrow(() => api.agents.list())
  makeAgent('agent-b')
  assert.equal(api.prompts.contribute(scopedSection('still-global', 'g')).ok, true)
})
