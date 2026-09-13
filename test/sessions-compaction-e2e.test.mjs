/**
 * End-to-end acceptance for the controlled compaction operation
 * (`sessions.compaction`), through the public facade only.
 *
 * The harness lives in `sessions-compaction-test-kit.mjs`; it boots a real
 * cordis tree carrying the facade and mounts the replacement's forked engine as
 * the `compaction` provider, so a passing gate runs the real engine transaction
 * while the failing-gate scenarios exercise the declared typed degradation.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createHarness, makeSession, makeMeter, agentOf, faceOf, hasOperationSubface, OPERATION_SUBFACE_SYMBOL } from './sessions-compaction-test-kit.mjs'

test('a passing gate runs the real engine and maps the outcome', async () => {
  // mode 'now' is the idle-session bracket: the target must have no open turn.
  const kit = await createHarness({ session: makeSession({ openTurn: false }) })
  const face = faceOf(kit)
  assert.equal(face.availability().status, 'active')

  const result = await face.run({ agent: agentOf(kit), mode: 'now' })
  assert.equal(result.ok, true)
  assert.equal(result.code, 'compacted')
  assert.equal(result.terminal, 'success')
  assert.equal(result.outcome, 'compacted')
  assert.equal(typeof result.lineage.compactionId, 'string')
  assert.equal(JSON.stringify(result).includes('compacted checkpoint'), false, 'the summary body never leaves the engine')
  assert.equal(kit.facts.filter((name) => name === 'compaction/started').length, 1)
  assert.equal(kit.facts.filter((name) => name === 'compaction/completed').length, 1, 'the engine is the only fact producer')

  // The durable transaction is real and the lineage is resolvable from it.
  const session = agentOf(kit).session
  assert.equal(session.events.some((event) => event.type === 'compaction/start'), true)
  assert.equal(session.events.some((event) => event.type === 'compaction/end'), true)
})

test('the gate degrades typed when the replacement is not active', async () => {
  const noRow = await createHarness({ loaderEntries: [] })
  assert.equal(faceOf(noRow).availability().status, 'unavailable')
  await assert.rejects(() => faceOf(noRow).run({ agent: agentOf(noRow), mode: 'now' }), (error) => error?.name === 'PluginApiFeatureDisabledError')

  const officialEnabled = await createHarness({ loaderEntries: [{ options: { id: 'plugin-api-compaction-events' } }, { options: { id: 'compaction-basic' }, disabled: false }] })
  assert.equal(faceOf(officialEnabled).availability().status, 'unavailable')
  assert.match(faceOf(officialEnabled).availability().reason, /official compaction row is still enabled/)

  const mismatch = await createHarness({ auxiliaryManifest: { version: '0.1.0-rc.5-0.1.0', api: '0.1' } })
  assert.equal(faceOf(mismatch).availability().status, 'unavailable')
  assert.match(faceOf(mismatch).availability().reason, /version does not match/)
  assert.equal(mismatch.emitted.filter((entry) => entry.name === 'warn').length, 1, 'the mismatch warns exactly once')

  const noMarker = await createHarness({ withSubface: false })
  assert.equal(faceOf(noMarker).availability().status, 'unavailable')
  assert.match(faceOf(noMarker).availability().reason, /operation sub-face/)

  const noProvider = await createHarness({ noProvider: true })
  assert.equal(faceOf(noProvider).availability().status, 'unavailable')
  assert.match(faceOf(noProvider).availability().reason, /contract marker/)
})

test('invocation refusals are typed and never reach the engine', async () => {
  const kit = await createHarness()
  const face = faceOf(kit)
  const before = kit.engine.ctx.tokenMeter.measure(agentOf(kit).session).totalTokens

  assert.equal((await face.run(null)).code, 'invalid-arguments')
  assert.equal((await face.run({ agent: agentOf(kit), mode: 'whenever' })).code, 'invalid-arguments')
  assert.equal((await face.run({ agent: { id: 'ghost' }, mode: 'now' })).code, 'invalid-target')
  assert.equal((await face.run({ agent: { session: makeSession() }, mode: 'now' })).code, 'invalid-target', 'an unverifiable agent object is refused typed, never handed to the engine')
  assert.equal((await face.run({ agent: agentOf(kit), mode: 'range' })).code, 'invalid-range')
  assert.equal((await face.run({ agent: agentOf(kit), mode: 'range', range: { start: 4, end: 1 } })).code, 'invalid-range')
  assert.equal((await face.run({ agent: agentOf(kit), mode: 'now', sourceCommandId: 42 })).code, 'invalid-arguments')
  assert.equal(kit.engine.ctx.tokenMeter.measure(agentOf(kit).session).totalTokens, before, 'no refusal touched the session')
})

test('a policy veto is a denied terminal with the decision reason', async () => {
  const session = makeSession({ openTurn: false })
  const kit = await createHarness({ session })
  kit.root.on('compaction/request', () => ({ kind: 'reject', reason: 'policy says no' }))
  const result = await faceOf(kit).run({ agent: agentOf(kit), mode: 'now' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'rejected')
  assert.equal(result.terminal, 'denied')
  assert.equal(result.reason, 'policy says no')
  assert.equal(session.events.some((event) => event.type === 'compaction/start'), false, 'a veto starts no transaction')
})

test('the range mode runs the direct path and reports its typed failures', async () => {
  const kit = await createHarness({ session: makeSession({ openTurn: true }) })
  const compacted = await faceOf(kit).run({ agent: agentOf(kit), mode: 'range', range: { start: 1, end: 4 } })
  assert.equal(compacted.code, 'compacted')

  const idle = await createHarness({ session: makeSession({ openTurn: false }) })
  const refused = await faceOf(idle).run({ agent: agentOf(idle), mode: 'range', range: { start: 1, end: 4 } })
  assert.equal(refused.terminal, 'error')
  assert.equal(refused.code, 'open-turn-required')
})

test('an already-aborted invocation is aborted without touching the engine', async () => {
  const kit = await createHarness({ session: makeSession({ openTurn: false }) })
  const controller = new AbortController()
  controller.abort()
  const result = await faceOf(kit).run({ agent: agentOf(kit), mode: 'now', signal: controller.signal })
  assert.equal(result.code, 'aborted')
  assert.equal(result.terminal, 'aborted')
  assert.equal(agentOf(kit).session.events.some((event) => event.type === 'compaction/start'), false)
})

test('the gate state surfaces in the sessions availability reason and the capability', async () => {
  const kit = await createHarness({ withSubface: false })
  assert.match(kit.root.pluginApi.sessions.availability().reason ?? '', /compaction unavailable/)
  // The capability descriptor reflects the mount; the runtime gate state is the
  // member's own availability (the same coverage boundary as the sibling lines).
  assert.equal(kit.root.pluginApi.capabilities.get('sessions.compaction').status, 'active')
  assert.equal(kit.root.pluginApi.sessions.compaction.availability().status, 'unavailable')
  // Unrelated session members stay published.
  assert.equal(typeof kit.root.pluginApi.sessions.get, 'function')
  assert.equal(typeof kit.root.pluginApi.sessions.durable.list, 'function')
})

test('the facade never mints its own identity or facts', async () => {
  const kit = await createHarness({ session: makeSession({ openTurn: false }) })
  const result = await faceOf(kit).run({ agent: agentOf(kit), mode: 'now' })
  assert.equal('operation' in result, false, 'the result omits the operation identity member (registered exception)')
  assert.equal(hasOperationSubface(kit.engine), true)
  assert.equal(kit.engine[OPERATION_SUBFACE_SYMBOL], true)
})

test('a mounted-but-gated feature keeps its member shape and its rollback works', async () => {
  const kit = await createHarness({ withSubface: false })
  const face = faceOf(kit)
  assert.deepEqual(Object.keys(face).sort(), ['availability', 'run'], 'the namespace keeps the live member set')
  assert.equal(face.availability().status, 'unavailable')
  await assert.rejects(() => face.run({}), (error) => error?.name === 'PluginApiFeatureDisabledError')

  // The staged rollback restores the same typed disabled shape.
  assert.equal(kit.prepared.rollback(), true)
  const rolledBack = faceOf(kit)
  assert.deepEqual(Object.keys(rolledBack).sort(), ['availability', 'run'])
  assert.equal(rolledBack.availability().status, 'unavailable')
  assert.throws(() => rolledBack.run({}), (error) => error?.name === 'PluginApiFeatureDisabledError')
  // The rollback restores the disabled surface into the slot (the same
  // mechanism `sessions.branches` uses), so the member set stays typed.
  const restored = kit.service._readSlot('sessionCompaction')
  assert.equal(typeof restored?.run, 'function')
  assert.throws(() => restored.run({}), (error) => error?.name === 'PluginApiFeatureDisabledError')
})

test('an unmounted feature answers typed before any mount', async () => {
  const kit = await createHarness({ noProvider: true, noMount: true })
  const face = faceOf(kit)
  assert.deepEqual(Object.keys(face).sort(), ['availability', 'run'])
  assert.equal(face.availability().status, 'unavailable')
  // The disabled face throws the typed error synchronously (the declared
  // disabled presentation), while a mounted-but-gated face rejects instead.
  assert.throws(() => face.run({}), (error) => error?.name === 'PluginApiFeatureDisabledError')
})

test('the lineage matches the durable transaction records', async () => {
  const kit = await createHarness({ session: makeSession({ openTurn: false }) })
  const result = await faceOf(kit).run({ agent: agentOf(kit), mode: 'now' })
  const session = agentOf(kit).session
  const started = session.events.find((event) => event?.type === 'compaction/start')
  const summary = session.events.find((event) => event?.type === 'compaction/summary')
  const end = session.events.find((event) => event?.type === 'compaction/end')
  assert.equal(started.data.compactionId, result.lineage.compactionId)
  assert.equal(summary.data.compactionId, result.lineage.compactionId)
  assert.equal(end.data.compactionId, result.lineage.compactionId)
  assert.equal(result.lineage.startSeq, started.seq)
  assert.equal(result.lineage.summarySeq, summary.seq)
  assert.equal(result.lineage.endSeq, end.seq)
})

test('a summarization abort closes the transaction and reports aborted', async () => {
  const controller = new AbortController()
  const kit = await createHarness({ session: makeSession({ openTurn: false }) })
  const engine = kit.engine
  const original = engine.summarize.bind(engine)
  engine.summarize = async (...args) => {
    controller.abort()
    return original(...args)
  }
  const result = await faceOf(kit).run({ agent: agentOf(kit), mode: 'now', signal: controller.signal })
  assert.equal(result.code, 'aborted')
  assert.equal(result.terminal, 'aborted')
  const session = agentOf(kit).session
  assert.equal(session.events.filter((event) => event?.type === 'compaction/end').length, 1, 'the transaction closed exactly once')
  assert.equal(kit.facts.filter((name) => name === 'compaction/completed').length, 0)
  assert.equal(kit.facts.filter((name) => name === 'compaction/failed').length, 1, 'exactly one failed fact reports the aborted attempt')
})

test('an abort after the durable commit keeps the completed fact and is never rewritten to success', async () => {
  const controller = new AbortController()
  const kit = await createHarness({ session: makeSession({ openTurn: false }) })
  const root = kit.root
  const sessions = root.get('sessions')
  const originalFlush = sessions.flush.bind(sessions)
  sessions.flush = async (...args) => {
    const value = await originalFlush(...args)
    controller.abort()
    return value
  }
  const result = await faceOf(kit).run({ agent: agentOf(kit), mode: 'now', signal: controller.signal })
  assert.equal(result.code, 'aborted', 'the engine adjudicates the terminal')
  assert.equal(kit.facts.filter((name) => name === 'compaction/completed').length, 1, 'the completed fact is kept')
  assert.equal(result.ok, false, 'the facade never rewrites an aborted terminal into success')
})

test('a second invocation while one compaction is active is busy', async () => {
  const kit = await createHarness({ session: makeSession({ openTurn: false }) })
  const agent = agentOf(kit)
  // Hold the first transaction inside summarization so it stays in flight while
  // the second invocation arrives; the engine's durable lock is the authority.
  let release
  const hold = new Promise((resolve) => { release = resolve })
  const original = kit.engine.summarize.bind(kit.engine)
  kit.engine.summarize = async (...args) => {
    await hold
    return original(...args)
  }
  const first = faceOf(kit).run({ agent, mode: 'now' })
  await new Promise((resolve) => setImmediate(resolve))
  const second = await faceOf(kit).run({ agent, mode: 'now' })
  assert.equal(second.code, 'busy')
  assert.equal(second.terminal, 'error')
  release()
  assert.equal((await first).code, 'compacted')
  assert.equal(kit.facts.filter((name) => name === 'compaction/started').length, 1, 'only the winner started a transaction')
})

test('the policy replace-range and malformed decisions govern the operation path', async () => {
  const replaced = await createHarness({ session: makeSession({ openTurn: false }) })
  replaced.root.on('compaction/request', () => ({ kind: 'replace-range', start: 1, end: 3 }))
  const result = await faceOf(replaced).run({ agent: agentOf(replaced), mode: 'now' })
  assert.equal(result.code, 'compacted')
  assert.equal(result.lineage.shadowedRange.start, 1)
  assert.equal(result.lineage.shadowedRange.end, 3, 'the operation reflects the range that was actually compacted')

  const malformed = await createHarness({ session: makeSession({ openTurn: false }) })
  malformed.root.on('compaction/request', () => ({ kind: 'nonsense' }))
  assert.equal((await faceOf(malformed).run({ agent: agentOf(malformed), mode: 'now' })).code, 'compacted', 'a malformed decision proceeds')
})

test('the whole apply loop mounts the feature and serves the operation', async () => {
  const { apply } = await import('../lib/index.js')
  const { BasicCompactionEngine } = await import('../packages/compaction-events/lib/forked-engine.js')
  const { attachOperationSubface } = await import('../packages/compaction-events/lib/operation-subface.js')

  const session = makeSession({ openTurn: false })
  const services = {
    tokenMeter: makeMeter(),
    loader: { entries: () => [{ options: { id: 'plugin-api-compaction-events' } }, { options: { id: 'compaction-basic' }, disabled: true }] },
    llm: { resolveModelInfo: async () => ({ context: { contextWindow: 1000 } }), prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {}, executionMode() { return 'mode' } },
    agents: { get: (id) => (id === 'agent-1' ? { id, session, options: { provider: 'p', model: 'm' }, runMaintenance: (job) => job(new AbortController().signal) } : undefined), list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {}, async flush() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {}, renderPrompt() {}, renderContextSections() {}, renderContextSnapshot() {}, joinContextSections() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {} },
  }
  const state = { pluginApi: undefined, listeners: [] }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect() {},
    on(name, listener) { state.listeners.push({ name, listener }); return () => {} },
    once() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
    runtime: { name: 'test', version: '0.1.0-rc.6' },
  }
  // The engine registers itself as the `compaction` service on this ctx.
  const engine = new BasicCompactionEngine(ctx, { auto: false })
  attachOperationSubface(engine)
  services.compaction = engine

  apply(ctx)
  const registry = state.pluginApi._registry.snapshot()
  assert.equal(registry.find((entry) => entry.name === 'sessionCompaction')?.isActive, true, 'the mounter mounted through the real apply loop')

  // This workspace does not link the auxiliary package into node_modules, so
  // the manifest condition of the gate cannot be satisfied here: the real apply
  // loop must publish the member set and degrade typed (the passing-gate path is
  // covered by the kit-based cases above, which supply the manifest).
  const face = state.pluginApi.sessions.compaction
  assert.deepEqual(Object.keys(face).sort(), ['availability', 'run'], 'the real loop publishes the live member set')
  assert.equal(face.availability().status, 'unavailable')
  await assert.rejects(() => face.run({ agent: services.agents.get('agent-1'), mode: 'now' }), (error) => error?.name === 'PluginApiFeatureDisabledError')
  assert.equal(session.events.some((event) => event?.type === 'compaction/end'), false, 'a gated feature never reaches the engine')
})
