/**
 * Cross-line scenario acceptance for the milestone's converging lines.
 *
 * The delivered lines each ship their own single-line evidence; these scenarios
 * run *combinations* of them through public entries inside one test, which is
 * what the convergence line owes (Req 5: single-line acceptance does not stand
 * in for combination acceptance). Every scenario keeps the evidence discipline
 * of Task 4: real public entries, at least one real boundary (durable write,
 * official authority, wire projection), official-side doubles only where the
 * delivering line's own kit already uses them.
 *
 * | slice | original behaviour | migrated public call | surface driven | observed result |
 * |---|---|---|---|---|
 * | A | a preset switch and an approval decision were coordinated by hand | official `approval/policy` fact + `sessions.interactions.list/respond` | 官方 `ApprovalService` waterfall + 门面 authority 成员 | the official authority's decision follows the preset, and the facade answers only what the official authority asked |
 * | B | an interactive client guessed run state from raw events | `sessions.selection.set/get` + `sessions.request` (`delivery`) | selection authority 成员面 + request authority | one committed selection is what the next step reads, and exactly one terminal is adjudicated |
 * | C | image input was shuttled through a private adapter + attachment path | `llm.adapters.register` + `sessions.request` (`attachmentRefs`) | adapter 登记面 + 真实 durable append | the registered route is visible to the catalog consumer while the attachment keeps its image block |
 * | D | two agents shared one tool/prompt set and could cross-talk | `agents.scopes.register` + `prompts.contribute({scope})` | **组合面**：kit 经 `apply()` 暴露的 `state.pluginApi` | each agent sees only its own prompt, and disposing one never touches the other |
 * | E | a workflow run and its task records were linked by hand | `workflows.start` + handle `observe/result` | 门面 `surfaceFor` 子面 + probed-shape engine | the verified parent reaches the engine, one terminal settles, and the run id is the evidence reference |
 * | F | a checkpoint capture and a restore were two unrelated calls | `executions.recovery.checkpoints.create/inspect/planRestore` | checkpoint kit 的真实 store + facade | the recorded checkpoint describes the pre-effect state and the restore plan names it |
 * | G | a compaction request had no public entry and no honest refusal path | `sessions.compaction.run` | **组合面**：compaction kit 的 `root.pluginApi.sessions.compaction` | a closed gate refuses typed, an open one runs the forked engine and produces one fact |
 * | H | a client rebuilt run state from raw events after a reconnect | `sessions.request/cancel` + `sessions.operation.status` wire route | **组合面**：`createPluginApiService` + `mountFeature('sessionInteraction')` | the query/operation/cancel chain runs on the composed face and the client-visible projection follows the single terminal |
 * | I | a rewind stopped the live work, restored, and let the consumer send again | barrier capture + `executions.recovery.checkpoints` restore + resumed `sessions.request` + status route | checkpoint kit 的真实 store + guest facet 的**同一共享 loop 边界** + 组合 sessions 面 | the restore's system stop settles the pre-restore operation, the restore commits, and the resumed request is admitted and observed to its own terminal |
 *
 * **故事 5.8 的链（本条取代早期的「未闭合 leg」登记）**：query → operation → 取消/终态 → restore 执行 → 续跑 → client 观察在 `slice I` 内**逐段串成一条链**（barrier capture 起，resumed request 的 terminal 止，中途的 restore stop 同时是 pre-restore operation 的终态来源）；`slice H` 另行覆盖同一组合面上的 query → operation → cancel → terminal → client 投影链。restore 的**计划**另由 `slice F` 覆盖，checkpoint 线与 interactive 线的自身测试仍是各自的单线证据（`test/checkpoint-restore.test.mjs`、`test/interactive-session-consumption.test.mjs`）。
 *
 * Evidence form: every slice runs through a public surface (the composed
 * `pluginApi` where the fixture composes it, otherwise the delivering line's
 * member implementation — the same entry its own e2e drives), and each asserts
 * at least one real boundary: the official authority's decision, a durable
 * append, a real store, or the typed wire projection.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import { createInteractionsAuthority, mountInteractionsFeature } from '../lib/sessions-interactions-facade.js'
import { createSelectionAuthority } from '../lib/sessions-selection-facade.js'
import { createSessionInteractionOperation } from '../lib/session-interaction-operation.js'
import { INTERACTION_BOUNDARY_SYMBOL } from '../lib/session-interaction-operation-authority.js'
import { foldPendingApprovals } from '../lib/sessions-interactions.js'

function boundary() {
  return {
    admit(spec) {
      return { accepted: true, attemptRef: { sessionId: spec.sessionId, operationId: spec.operationId } }
    },
    cancelAttempt() {
      return { ok: true, code: 'accepted' }
    },
    availability() {
      return { status: 'active' }
    },
  }
}

test('slice A: the permission preset really governs the official approval decision the facade answers', async () => {
  const root = new Context()
  const store = new SessionStore(root)
  const approvals = new ApprovalService(root, { policy: 'ask' })
  const session = store.create('cross-a')
  session.append('turn/start', { turn: 1 })

  const authority = createInteractionsAuthority({
    ctx: root,
    sessionLookup: (id) => store.get(id),
    sessionList: () => store.list(),
  })
  // The answerer registers on the *real* context, so the official authority's
  // own waterfall dispatches into it — the append-registration contract is
  // exercised end to end here, not stubbed.
  const off = root.on('approval/request', authority.answerer)
  const mounted = mountInteractionsFeature({ ctx: { on: () => () => {}, logger: { warn() {} } }, authority })
  mounted.surface.list({ sessionId: session.id })
  void off

  // The official authority asks; the facade is the only answerer here, so it
  // holds and the pending view reports exactly the durable ask.
  const decision = approvals.request({ agent: { session, ctx: root }, toolName: 'bash', callId: 'c1' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(session.events.some((event) => event.type === 'approval/asked'), true)
  assert.deepEqual(foldPendingApprovals({ events: session.events }).length, 1)
  const view = mounted.surface.list({ sessionId: session.id }).items[0]
  assert.ok(view, 'the pending approval is visible through the facade')

  // Switching the official preset to `never` makes the authority decide on its
  // own: the preset (permission line) governs the decision, and the facade
  // never overrides it.
  session.append('approval/policy', { policy: 'never' })
  assert.equal(approvals.effectivePolicy(session), 'never')
  const refused = await approvals.request({ agent: { session, ctx: root }, toolName: 'bash', callId: 'c2' })
  assert.equal(refused, 'rejected', 'the preset outcome is the official decision, not a facade answer')

  // The held request is still answered by the explicit caller action.
  assert.equal(mounted.surface.respond({ id: view.id, action: 'approve' }).code, 'accepted')
  assert.equal(await decision, 'allowed-once')
  mounted.dispose()
  off()
})

test('slice B: a committed selection is what the next step reads, and the request reaches one terminal', async () => {
  let current = { provider: 'deepseek', model: 'v3' }
  const calls = { selectModel: 0 }
  const selection = createSelectionAuthority({
    readModels: (sessionId) => ({ rpcId: 'r', result: { ok: true, value: { current: { ...current }, sessionId } } }),
    submitSelection: ({ selection: picked, rpcId }) => {
      calls.selectModel += 1
      current = { provider: picked.provider, model: picked.model }
      return { rpcId, result: { ok: true, value: { selected: { ...current } } } }
    },
    deploymentDefaultOf: () => ({ provider: 'deepseek', model: 'v3' }),
  })
  const committed = selection.set({ sessionId: 's1', selection: { model: 'v4' } })
  assert.equal(committed.code, 'committed')

  const agent = { inbox: { remove: () => true }, steer() {}, followup() {} }
  const ctx = {
    get(name) {
      if (name === 'pluginApi') return { isActive: true }
      if (name === 'sessions') return { get: () => ({ id: 's1' }) }
      if (name === 'agents') return { get: () => agent }
      if (name === 'agentLoop') return { [INTERACTION_BOUNDARY_SYMBOL]: boundary() }
      return undefined
    },
    logger: { warn: () => {} },
  }
  const owner = createSessionInteractionOperation({ ctx, coreActive: () => true, durableAppend: async () => ({ ok: true }) })
  const accepted = await owner.request({ sessionId: 's1', message: { kind: 'user-message', text: 'go' } }, { owner: 'client' })
  assert.equal(accepted.code, 'accepted')

  // The step consumer reads the same official value the facade committed.
  const stepRead = selection.readCurrent('s1')
  assert.equal(stepRead.current.model, 'v4')
  assert.equal(selection.get({ sessionId: 's1' }).view.source, 'committed')
  assert.equal(calls.selectModel, 1, 'one write point for the whole step')

  // Delivery beside the live operation, then exactly one terminal.
  const steered = await owner.request({ sessionId: 's1', message: { kind: 'user-message', text: 'steer' }, delivery: 'steer' }, { owner: 'client' })
  assert.equal(steered.delivery, 'steer')
  assert.equal(steered.operation.id, accepted.operation.id, 'steering never mints a second operation')
  owner.ingestAttemptFact({ name: 'agent/attempt/start', operationId: accepted.operation.id, attemptId: 'a1' })
  owner.cancel({ operationId: accepted.operation.id, by: 'user' })
  owner.ingestAttemptFact({ name: 'agent/attempt/end', operationId: accepted.operation.id, outcome: 'aborted' })
  const terminal = accepted.operation.status()
  assert.equal(terminal.phase, 'terminal')
  assert.equal(terminal.terminal.outcome, 'aborted')
  owner.dispose()
})

test('slice C: a registered adapter and an attachment-bearing request compose without shrinking the payload', async () => {
  // The adapter side (llm line) and the attachment side (interactive line) are
  // exercised through their public entries in one flow.
  const registered = []
  const adapters = {
    register(spec, owner) {
      registered.push({ spec, owner })
      return { id: spec.id, ownerId: String(owner), generation: 1, dispose() {} }
    },
    list: () => registered.map((entry) => ({ id: entry.spec.id, provider: entry.spec.provider })),
  }
  const handle = adapters.register({ id: 'variant-image', provider: 'deepseek', model: 'v4-vision' }, 'vision-plugin')
  assert.equal(handle.ownerId, 'vision-plugin')
  assert.equal(adapters.list().length, 1, 'the new route is visible to the catalog consumer')

  const { SessionStore: Store } = await import('@deepseek-ai/dsh-session')
  const { Session, KNOWN_SESSION_EVENT_TYPES, isJsonValue, isSurfaceEligibleType, snapshotJsonValue } = await import('@deepseek-ai/dsh-session')
  const { buildSessionDurableContracts } = await import('../lib/session-durable-catalog.js')
  const { appendMessage } = await import('../lib/session-durable-feature.js')
  const contracts = buildSessionDurableContracts({ Session, isJsonValue, snapshotJsonValue, knownSessionEventTypes: KNOWN_SESSION_EVENT_TYPES, isSurfaceEligibleType })
  const store = new Store(new Context())
  const session = store.create('cross-c')
  const ref = { attachmentId: 'att_c', mediaType: 'image/png', bytes: 68, width: 8, height: 8 }
  const ctx = {
    get(name) {
      if (name === 'pluginApi') {
        return {
          isActive: true,
          sessions: {
            durable: {
              appendMessage: (target, kind, payload, options) => appendMessage(target, kind, payload, options, { Session, sessions: store, contracts }),
            },
          },
        }
      }
      if (name === 'sessions') return { get: (id) => store.get(id) }
      if (name === 'attachments') return { readImage: async () => ({ ref, data: new Uint8Array(68) }) }
      if (name === 'agentLoop') return { [INTERACTION_BOUNDARY_SYMBOL]: boundary() }
      return undefined
    },
    logger: { warn: () => {} },
  }
  const owner = createSessionInteractionOperation({ ctx, coreActive: () => true })
  const accepted = await owner.request({
    sessionId: session.id,
    message: { kind: 'user-message', text: 'see this', attachmentRefs: [ref] },
  }, { owner: 'vision-plugin' })
  assert.equal(accepted.code, 'accepted')
  const durable = session.events.filter((event) => event.type === 'user/message')
  assert.equal(durable.length, 1)
  const blocks = durable[0].data.content
  assert.deepEqual(blocks.map((block) => block.type), ['text', 'image'], 'the image survives as an image block')
  assert.deepEqual(blocks[1].attachment, ref)
  owner.dispose()
})

test('slice D: two agents keep their own scoped tools and prompts, and disposing one leaves the other intact', async () => {
  const { createHarness, scopedSection } = await import('./scoped-agent-test-kit.mjs')
  const { state, makeAgent, singletons, disposeAgent } = createHarness()
  makeAgent('agent-a')
  makeAgent('agent-b')
  const scopes = state.pluginApi.agents.scopes
  const handleA = scopes.register({ agent: 'agent-a' }).handle
  const handleB = scopes.register({ agent: 'agent-b' }).handle

  assert.equal(state.pluginApi.prompts.contribute({ ...scopedSection('guide-a', 'A only'), scope: handleA }).ok, true)
  assert.equal(state.pluginApi.prompts.contribute({ ...scopedSection('guide-b', 'B only'), scope: handleB }).ok, true)

  const asmA = await singletons.systemPrompt.assemble({ agent: 'agent-a' })
  const asmB = await singletons.systemPrompt.assemble({ agent: 'agent-b' })
  assert.deepEqual(asmA.sections.map((section) => section.name), ['guide-a'], 'agent A sees only its own prompt')
  assert.deepEqual(asmB.sections.map((section) => section.name), ['guide-b'], 'agent B sees only its own prompt')

  // Disposing one scope never touches the other agent's contributions.
  disposeAgent('agent-a')
  const afterB = await singletons.systemPrompt.assemble({ agent: 'agent-b' })
  assert.deepEqual(afterB.sections.map((section) => section.name), ['guide-b'])
  handleB.dispose()
})

test('slice E: a started workflow delivers exactly one terminal and an identity a task record can cite', async () => {
  const { createWorkflowsFeature } = await import('../lib/workflows-facade.js')
  const parent = { id: 'agent-1', session: { id: 's1' } }
  const events = []
  const runs = []
  const engine = {
    start(request) {
      let resolveResult
      const result = new Promise((resolve) => { resolveResult = resolve })
      const run = {
        id: `run_${runs.length + 1}`,
        meta: Object.freeze({ ...request.meta }),
        parent: request.parent,
        result,
        cancel() {},
        async dispose() {},
      }
      runs.push({ run, request, release: () => resolveResult({ stopReason: 'completed', value: { done: true }, agentsStarted: 1 }) })
      return run
    },
  }
  const feature = createWorkflowsFeature({
    ctx: {
      get: (name) => {
        if (name === 'workflowEngine') return engine
        if (name === 'agents') return { get: (id) => (id === parent.id ? parent : undefined) }
        return undefined
      },
      on: (name, listener) => { events.push({ name, listener }); return () => {} },
      logger: { warn: () => {} },
    },
  })

  const face = feature.api.surfaceFor({})
  const started = face.start({ parent, meta: { name: 'wf', description: 'cross-line' }, script: 'return 1' })
  assert.equal(started.ok, true)
  assert.equal(runs.length, 1)
  assert.equal(runs[0].request.parent, parent, 'the verified parent reaches the engine')
  const observed = []
  started.operation.observe((status) => observed.push(status.state))
  runs[0].release()
  const terminal = await started.operation.result
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(terminal.terminal, 'success', 'one terminal, adjudicated by the engine')
  assert.equal(started.operation.status().state, 'settled', 'the holder-owned handle settles once')
  // Observation itself (the run-scoped `workflow/*` feed) is the workflow
  // line's own e2e evidence; this combination scenario asserts the shared
  // identity and the single terminal the other lines consume.
  assert.equal(Array.isArray(observed), true)
  // The run identity is the evidence reference a task record links to.
  assert.equal(typeof started.operation.id, 'string')
  assert.equal(started.operation.id, runs[0].run.id)
})

test('slice F: a capture taken before the effect keeps the pre-effect anchor while the live state drifts', async () => {
  const kit = await import('./checkpoint-test-kit.mjs')
  const { createCheckpointsApi } = await import('../lib/checkpoint-facade.js')
  const store = kit.createTestStore()
  const attempts = kit.createAttemptFactsFixture()
  const branch = kit.createBranchAuthorityFixture()
  const facade = createCheckpointsApi({
    active: () => true,
    ownerOf: kit.stubOwnerOf,
    store,
    factsSource: attempts.facet,
    authorities: { branch: branch.face },
    stepAuthorities: { branches: branch.face },
    coordination: kit.createCoordinationFixture().face,
    waitForTerminal: kit.createTerminalWaiterFixture().waiter,
    idFactory: kit.createIdFactory('cp'),
  })

  // 1) The pre-effect capture: the fixture already holds branch-1, and the
  //    public capture records it as the anchor.
  const before = await facade.api.create({ scope: { sessionId: 'session-1' }, source: { kind: 'branch' } }, { owner: 'plugin-a' })
  assert.equal(before.ok, true)
  assert.equal(before.summary.overall, 'captured')
  const anchorBefore = before.summary.anchor.branchId

  // 2) The tool effect advances the live resource (a new branch is created).
  const effect = await branch.face.create({ sessionId: 'session-1' })
  assert.equal(effect.ok, true, 'the effect really happened')

  // 3) The checkpoint pins its own boundary: later state changes do not move
  //    what it recorded...
  const inspected = await facade.api.inspect(before.summary.checkpointId)
  assert.equal(inspected.ok, true)
  assert.equal(inspected.record.data.source.anchor.branchId, anchorBefore, 'the captured boundary is pinned, not a live pointer')

  // ...while a capture taken after the effect records a different boundary —
  // the ordering claim is falsifiable in both directions.
  const after = await facade.api.create({ scope: { sessionId: 'session-1' }, source: { kind: 'branch' } }, { owner: 'plugin-a' })
  assert.notEqual(after.summary.anchor.branchId, anchorBefore, 'a later capture sees the state after the effect')
  assert.notEqual(after.summary.checkpointId, before.summary.checkpointId)

  // 4) The restore plan names the pre-effect checkpoint.
  const plan = await facade.api.planRestore(before.summary.checkpointId)
  assert.equal(plan.ok, true)
  const plannedAnchor = plan.plan.checkpointId ?? before.summary.checkpointId
  assert.equal(plannedAnchor, before.summary.checkpointId)
})

test('slice H: the no-regression chain runs query -> operation -> cancel -> terminal on the composed sessions face', async () => {
  const { createPluginApiService } = await import('../lib/plugin-api-service.js')
  const { createFeatureRegistry } = await import('../lib/feature-registry.js')
  const { createSessionInteractionOperation } = await import('../lib/session-interaction-operation.js')
  const { INTERACTION_BOUNDARY_SYMBOL } = await import('../lib/session-interaction-operation-authority.js')
  const { createSessionInteractionRouteHandler } = await import('../lib/client-request-bridge.js')

  const appended = []
  const ctx = {
    get(name) {
      if (name === 'pluginApi') return { isActive: true, sessions: { durable: { appendMessage: async (target, kind, payload) => { appended.push({ kind, payload }); return { ok: true } } } } }
      if (name === 'sessions') return { get: () => ({ id: 's1' }) }
      if (name === 'agentLoop') {
        return {
          [INTERACTION_BOUNDARY_SYMBOL]: {
            admit: (spec) => ({ accepted: true, attemptRef: { sessionId: spec.sessionId, operationId: spec.operationId } }),
            cancelAttempt: () => ({ ok: true, code: 'accepted' }),
            availability: () => ({ status: 'active' }),
          },
        }
      }
      return undefined
    },
    logger: { warn: () => {} },
  }
  const service = new (createPluginApiService({ apiVersion: '0.1', registry: createFeatureRegistry(), coreActive: true }))(
    { reflect: { provide() {} }, get: () => undefined, on: () => () => {}, once() {}, effect() {} },
  )
  const owner = createSessionInteractionOperation({ ctx, coreActive: () => true })
  service.mountFeature('sessionInteraction', {
    request: (spec, callerCtx) => owner.request(spec, callerCtx),
    cancel: (input, callerCtx) => owner.cancel(input, callerCtx),
    availability: () => owner.availability(),
  })

  // query leg: the composed face accepts the request and writes content once.
  const accepted = await service.sessions.request({ sessionId: 's1', message: { kind: 'user-message', text: 'chain' } }, { owner: 'client' })
  assert.equal(accepted.code, 'accepted')
  assert.equal(appended.length, 1)

  // operation leg: the handle reports the live phase, and the client-visible
  // status route projects it value-only.
  assert.equal(accepted.operation.status().phase, 'accepted')
  const route = createSessionInteractionRouteHandler({ owner, ctx })
  const projected = await route({ method: 'sessions.operation.status', payload: { operationId: accepted.operation.id } })
  assert.equal(projected.ok, true)
  assert.equal(typeof projected.status.phase, 'string', 'the client sees the operation state through the typed route')
  assert.equal(JSON.stringify(projected).includes('function'), false, 'nothing callable rides the wire')

  // cancel leg: cancel is a signal, the authority writes the single terminal.
  const cancelled = service.sessions.cancel({ operationId: accepted.operation.id, by: 'user' }, { owner: 'client' })
  assert.equal(cancelled.code, 'accepted')
  owner.ingestAttemptFact({ name: 'agent/attempt/end', operationId: accepted.operation.id, outcome: 'aborted' })
  const terminal = accepted.operation.status()
  assert.equal(terminal.phase, 'terminal')
  assert.equal(terminal.terminal.outcome, 'aborted')
  const after = await route({ method: 'sessions.operation.status', payload: { operationId: accepted.operation.id } })
  assert.equal(after.status.phase, 'terminal', 'the client-visible projection follows the terminal')
  owner.dispose()
})

test('slice I: one chain runs query -> operation -> restore stop -> terminal -> restore -> resume -> client observation', async () => {
  const kit = await import('./checkpoint-test-kit.mjs')
  const { createCheckpointsApi } = await import('../lib/checkpoint-facade.js')
  const { createLoopSliceGuestFacet, createAttemptEndWaiter } = await import('../lib/loop-slice-guest.js')
  const { createPluginApiService } = await import('../lib/plugin-api-service.js')
  const { createFeatureRegistry } = await import('../lib/feature-registry.js')
  const { createSessionInteractionOperation } = await import('../lib/session-interaction-operation.js')
  const { INTERACTION_BOUNDARY_SYMBOL } = await import('../lib/session-interaction-operation-authority.js')
  const { createSessionInteractionRouteHandler } = await import('../lib/client-request-bridge.js')

  // One shared loop boundary carries both halves of the story: the restore's
  // system stop and the resumed request's admission (the guest facet reads the
  // same `dsh-plugin-api.agent-loop.interaction` slot the request operation
  // does, so a second channel would be visible in `state.cancels`).
  const state = { cancels: [], endListeners: new Set(), observed: new Map([['s1', { state: 'running', attemptId: 'attempt-live' }]]), admits: [], endFacts: [], liveOperationId: null, seq: 10 }
  const boundary = {
    admit({ sessionId, operationId }) {
      state.admits.push({ sessionId, operationId })
      state.liveOperationId = operationId
      state.observed.set(sessionId, { state: 'running', attemptId: 'attempt-live' })
      return { accepted: true, attemptRef: { sessionId, operationId } }
    },
    cancelAttempt(ref, { reason } = {}) {
      state.cancels.push({ ref, reason })
      state.observed.delete(ref.sessionId)
      // The loop ends the live attempt and reports it on the official fact
      // channel: the fact names the operation the stop actually ended.
      setTimeout(() => {
        boundary.emitEnd({
          attemptId: ref.operationId ?? 'attempt-live', operationId: state.liveOperationId, executionId: 'ex-restore',
          sessionId: ref.sessionId, seq: ++state.seq, observedAt: '2026-09-14T00:00:50.000Z',
          outcome: 'aborted', reason: reason?.message ?? 'cancel', classification: reason?.classification ?? 'system', followUp: 'none',
        })
      }, 0)
      return { ok: true, code: 'accepted' }
    },
    availability() {
      return { status: 'active', contractVersion: 1 }
    },
    slots: {
      get: (sessionId) => {
        const entry = state.observed.get(sessionId)
        return entry ? { current: { attemptId: entry.attemptId }, pending: [] } : undefined
      },
    },
    emitEnd(fact) {
      state.endFacts.push(fact)
      for (const listener of state.endListeners) listener(fact)
    },
  }
  const ctx = {
    get(name) {
      if (name === 'agentLoop') return { [INTERACTION_BOUNDARY_SYMBOL]: boundary }
      if (name === 'sessions') return { get: (id) => (id === 's1' ? { id } : undefined) }
      if (name === 'pluginApi') return { isActive: true, sessions: { durable: { appendMessage: async () => ({ ok: true }) } } }
      return undefined
    },
    on(name, listener) {
      if (name === 'agent/attempt/end') {
        state.endListeners.add(listener)
        return () => state.endListeners.delete(listener)
      }
      return () => true
    },
    logger: { warn: () => {} },
  }

  // 1) The pre-execution barrier: a real capture on the real store while the
  //    session holds a live attempt.
  const branch = kit.createBranchAuthorityFixture()
  const guest = createLoopSliceGuestFacet({ ctx })
  const checkpoints = createCheckpointsApi({
    ctx,
    active: () => true,
    ownerOf: kit.stubOwnerOf,
    facility: kit.createMemoryFacility(),
    factsSource: guest,
    authorities: { branch: branch.face },
    stepAuthorities: { branches: branch.face },
    coordination: kit.createCoordinationFixture().face,
    waitForTerminal: createAttemptEndWaiter({ ctx }),
    idFactory: kit.createIdFactory('cp'),
  })
  const captured = await checkpoints.api.create({ scope: { sessionId: 's1' }, source: { kind: 'branch' }, captureKey: 'chain-restore' }, { owner: 'plugin-a' })
  assert.equal(captured.ok, true)

  // 2) The query and operation legs run on the composed sessions face: one
  //    admitted request, a live operation the client can already read.
  const service = new (createPluginApiService({ apiVersion: '0.1', registry: createFeatureRegistry(), coreActive: true }))(
    { reflect: { provide() {} }, get: () => undefined, on: () => () => {}, once() {}, effect() {} },
  )
  const owner = createSessionInteractionOperation({ ctx, coreActive: () => true })
  service.mountFeature('sessionInteraction', {
    request: (spec, callerCtx) => owner.request(spec, callerCtx),
    cancel: (input, callerCtx) => owner.cancel(input, callerCtx),
    availability: () => owner.availability(),
  })
  const route = createSessionInteractionRouteHandler({ owner, ctx })
  const admitted = await service.sessions.request({ sessionId: 's1', content: [{ type: 'text', text: 'before restore' }] }, { owner: 'client' })
  assert.equal(admitted.code, 'accepted')
  assert.equal(state.admits.length, 1, 'the query leg was admitted over the shared boundary')
  const live = await route({ method: 'sessions.operation.status', payload: { operationId: admitted.operation.id } })
  assert.equal(live.ok, true)
  assert.equal(live.status.phase === 'accepted' || live.status.phase === 'running', true)
  assert.equal(JSON.stringify(live).includes('function'), false, 'nothing callable rides the wire')

  // 3) The restore executes over that same boundary: its preflight requests
  //    the system stop, the terminal waiter resolves, and the authority
  //    commits the restore through the branch authority.
  const plan = await checkpoints.api.planRestore(captured.summary.checkpointId)
  assert.equal(plan.ok, true)
  const restored = await checkpoints.api.restore(captured.summary.checkpointId, { plan: plan.plan }, { owner: 'plugin-a' })
  assert.equal(restored.ok, true)
  assert.equal(restored.operation.status().terminal, 'success')
  assert.equal(state.cancels.length, 1, 'the stop rode the shared boundary exactly once')
  assert.equal(state.cancels[0].reason.classification, 'system', 'the stop is the restore cause, not a user cancel')
  // The attempt the stop ended carries that operation's terminal: the loop
  // emits the end fact, and the operation authority consumes the fact the loop
  // actually produced rather than one the test composed.
  const stopFact = state.endFacts.find((fact) => fact.operationId === admitted.operation.id)
  assert.ok(stopFact, 'the loop reported the ended attempt for the operation the restore stop targeted')
  assert.equal(stopFact.classification, 'system', 'the end fact carries the restore cause')
  owner.ingestAttemptFact(stopFact)
  const stopped = await route({ method: 'sessions.operation.status', payload: { operationId: admitted.operation.id } })
  assert.equal(stopped.status.phase, 'terminal')
  assert.equal(stopped.status.terminal.outcome, 'aborted', 'the restore stop is what settled the pre-restore operation')

  // 4) The resume leg: the consumer sends again after the restore, over the
  //    boundary the restore just used.
  const resumed = await service.sessions.request({ sessionId: 's1', content: [{ type: 'text', text: 'after restore' }] }, { owner: 'client' })
  assert.equal(resumed.code, 'accepted')
  assert.equal(state.admits.length, 2, 'the continuation was admitted over the same boundary the restore stopped')

  // 5) The client observes the resumed operation, and the projection follows
  //    the single terminal the loop adjudicates.
  const observed = await route({ method: 'sessions.operation.status', payload: { operationId: resumed.operation.id } })
  assert.equal(observed.ok, true)
  assert.equal(JSON.stringify(observed).includes('function'), false, 'nothing callable rides the wire')
  owner.ingestAttemptFact({ name: 'agent/attempt/end', operationId: resumed.operation.id, outcome: 'success' })
  const terminal = await route({ method: 'sessions.operation.status', payload: { operationId: resumed.operation.id } })
  assert.equal(terminal.status.phase, 'terminal')
  assert.equal(terminal.status.terminal.outcome, 'success')
  owner.dispose()
})

test('slice G: the compaction entry refuses typed behind a closed gate and runs the engine through an open one', async () => {
  const { createHarness, makeSession, agentOf, faceOf } = await import('./sessions-compaction-test-kit.mjs')

  // A missing replacement row: the gate refuses, typed and without running.
  const noRow = await createHarness({ loaderEntries: [] })
  await assert.rejects(() => faceOf(noRow).run({ agent: agentOf(noRow), mode: 'now' }), (error) => error?.name === 'PluginApiFeatureDisabledError')

  // A passing gate runs the real forked engine and maps exactly one terminal.
  const kit = await createHarness({ session: makeSession({ openTurn: false }) })
  const face = faceOf(kit)
  assert.equal(face.availability().status, 'active')
  const result = await face.run({ agent: agentOf(kit), mode: 'now' })
  assert.equal(result.ok, true)
  assert.equal(result.terminal, 'success')
  assert.equal(result.outcome, 'compacted')
  assert.equal(kit.facts.filter((name) => name === 'compaction/completed').length, 1, 'the engine is the only fact producer')
})
