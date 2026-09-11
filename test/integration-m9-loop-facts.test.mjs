import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

/**
 * integration wave — shared loop boundary slice:
 * vocabulary mechanical consistency (three lines), assembled observed
 * full-chain consumption, double-run absence, gating combination.
 */

// --- vocabulary consistency (I3 / 11.6 mechanical comparison) ---
test('m9: attempt-fact vocabulary stays mechanically consistent across the three lines', async () => {
  const { buildAttemptStartPayload, buildAttemptEndPayload, ATTEMPT_OUTCOMES, ATTEMPT_FOLLOW_UP, ATTEMPT_FACTS_CONTRACT_VERSION } = await import('../packages/agent-loop/lib/interaction-slice.js')
  const contract = await import('../lib/session-activity-contract.js')
  const checkpointFacts = await import('../lib/checkpoint-facts.js')

  // outcome/followUp closed vocabularies match (interaction production side
  // vs activity consumption side).
  assert.deepEqual([...ATTEMPT_OUTCOMES].sort(), [...contract.TERMINAL_OUTCOMES].sort())
  assert.deepEqual([...ATTEMPT_FOLLOW_UP].sort(), [...contract.FOLLOW_UP_VALUES].sort())

  // start payload keys match the frozen consumption field list.
  const start = buildAttemptStartPayload({ attemptId: 'a1', operationId: 'op1', executionId: 'e1', sessionId: 's1', seq: 3, observedAt: '2026-09-06T00:00:00.000Z' })
  assert.deepEqual(Object.keys(start).sort(), [...contract.ATTEMPT_START_FIELDS].sort())
  assert.equal(contract.activityObservationContract().attemptStart.validate(start), true)

  // end payload with every field.
  const end = buildAttemptEndPayload({ attemptId: 'a1', operationId: 'op1', executionId: 'e1', sessionId: 's1', seq: 4, observedAt: '2026-09-06T00:00:01.000Z', outcome: 'success', reason: null, classification: null, followUp: 'none' })
  assert.deepEqual(Object.keys(end).filter((key) => end[key] !== null && end[key] !== undefined).sort(), ['attemptId', 'executionId', 'followUp', 'observedAt', 'operationId', 'outcome', 'seq', 'sessionId'].sort())
  assert.equal(contract.activityObservationContract().attemptEnd.validate(end), true)

  // null = serialized default: absent optional fields validate on the
  // consumption side (null-keyed payloads produce observed-grade facts).
  const startNoCorrelation = buildAttemptStartPayload({ attemptId: 'a2', operationId: null, executionId: null, sessionId: 's2', seq: 5, observedAt: '2026-09-06T00:00:02.000Z' })
  assert.equal(contract.activityObservationContract().attemptStart.validate(startNoCorrelation), true)
  assert.equal(startNoCorrelation.operationId, null)
  assert.equal(startNoCorrelation.executionId, null)

  // contract version compares numerically across lines (the slice record §4).
  assert.equal(Number(ATTEMPT_FACTS_CONTRACT_VERSION), contract.ACTIVITY_OBSERVATION_CONTRACT_VERSION)
  assert.equal(Number(ATTEMPT_FACTS_CONTRACT_VERSION), 1)

  // checkpoint consumption vocabulary: LIVE_STATES align with observed
  // states the slice can express (running/idle/queued).
  const state = checkpointFacts.createLoopFacts({})
  const observed = state.observed('missing-session')
  assert.ok(['observed', 'reconstructed', 'unknown'].includes(observed.evidence))
})

// --- assembled observed full chain (I3/I4) ---
function makeBootCtx({ withBoundary = true } = {}) {
  const services = {
    loader: { entries() { return [] } },
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    agents: { get() {}, list() {}, roots() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {} },
    sessions: { get: (id) => (id === 's1' ? { id } : undefined), list() {}, fork() {} },
  }
  if (withBoundary) {
    const boundary = {
      admitted: [],
      slots: new Map(),
      admit(spec) {
        this.admitted.push(spec)
        return { accepted: true, attemptRef: { sessionId: spec.sessionId, operationId: spec.operationId } }
      },
      cancelAttempt(ref, { reason }) {
        this.lastCancel = { ref, reason }
        return { ok: true, code: 'accepted' }
      },
      availability() {
        return { status: 'active', contractVersion: 1 }
      },
    }
    services.agentLoop = {
      [Symbol.for('dsh-plugin-api.agent-loop.interaction')]: boundary,
    }
  }
  const state = { listeners: [], effects: [], provides: 0 }
  const ctx = {
    listeners: state.listeners,
    logger: { error() {}, warn() {} },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') {
          state.pluginApi = value
          state.provides += 1
        }
      },
    },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      return services[name]
    },
    plugin(Class) { new Class(ctx) },
    effect(fn, label) { state.effects.push({ fn, label }) },
    on(name, listener) {
      state.listeners.push({ name, listener })
      let disposed = false
      return () => { disposed = true; return disposed }
    },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  return { ctx, state, services }
}

test('m9: assembled observed full chain — attempt facts become observed-grade activity records', () => {
  const { ctx, state, services } = makeBootCtx({ withBoundary: true })
  apply(ctx)

  // The market on the root context is installed by the assembly.
  const marker = (ctx.root ?? ctx)[Symbol.for('dsh-plugin-api.session-activity.observation-contract')]
  assert.ok(marker, 'observation contract marker must be installed on the root context')
  assert.equal(marker.version, 1)

  // Deliver the attempt facts over the shared event stream. The probe-first
  // listeners refresh the slice gate before the adapters ingest the same
  // dispatch, so the first fact must already be observed-grade.
  const startListeners = ctx.listeners.filter((entry) => entry.name === 'agent/attempt/start')
  const endListeners = ctx.listeners.filter((entry) => entry.name === 'agent/attempt/end')
  assert.ok(startListeners.length >= 3, "probe + ingestion + adapter subscriptions registered")
  // fire in registration order
  const fire = (listeners, payload) => {
    for (const entry of listeners) entry.listener(payload)
  }
  fire(startListeners, {
    attemptId: 'attempt-1', operationId: 'op-1', executionId: null, sessionId: 's1', seq: 1, observedAt: '2026-09-06T00:00:10.000Z',
  })

  const view = state.pluginApi.sessions.activity.current('s1', { audience: 'diagnostics' })
  assert.equal(view.ok, undefined, 'current returns the frozen projection shape')
  assert.ok(view.snapshot, 'a record must exist for the session')
  assert.equal(view.snapshot.status.phase, 'running')
  assert.equal(view.snapshot.fidelity.sliceObserved, true, 'attempt facts were consumed at observed grade')
  const queue = view.sessionQueue
  assert.ok(queue === null || queue.length === 0, 'followUp none leaves the session queue empty')

  // terminal commits through the attempt-end fact: the open activity becomes
  // a terminal record in the session history.
  fire(endListeners, {
    attemptId: 'attempt-1', operationId: 'op-1', executionId: null, sessionId: 's1', seq: 2, observedAt: '2026-09-06T00:00:20.000Z',
    outcome: 'success', reason: null, classification: null, followUp: 'none',
  })
  const history = state.pluginApi.sessions.activity.history('s1')
  assert.equal(history.items.length, 1)
  assert.equal(history.items[0].terminal.outcome, 'success')
  assert.equal(history.items[0].terminal.confidence, 'observed')
})

test('m9: without the slice the projection degrades honestly and never labels guesses observed', () => {
  const { ctx, state } = makeBootCtx({ withBoundary: false })
  apply(ctx)
  const availability = state.pluginApi.sessions.activity.availability()
  assert.equal(availability.status, 'degraded')
  const startListeners = ctx.listeners.filter((entry) => entry.name === 'agent/attempt/start')
  for (const entry of startListeners) {
    entry.listener({ attemptId: 'x', operationId: null, executionId: null, sessionId: 's9', seq: 1, observedAt: '2026-09-06T00:00:00.000Z' })
  }
  const view = state.pluginApi.sessions.activity.current('s9')
  assert.ok(!view.snapshot, 'no observed record may be fabricated without the slice')
})

test('m9: feature gating and capability three-value mapping under assembly', () => {
  const { ctx, state } = makeBootCtx({ withBoundary: true })
  apply(ctx)
  assert.equal(state.pluginApi.capabilities.get('sessions.activity').status, 'active')
  assert.equal(state.pluginApi.capabilities.get('sessions.request').status, 'active')
  assert.equal(state.pluginApi.capabilities.get('attention').status, 'active')
  assert.ok(['active', 'degraded', 'unavailable'].includes(state.pluginApi.sessions.activity.availability().status))
  assert.ok(['active', 'degraded', 'unavailable'].includes(state.pluginApi.sessions.availability().status))
  assert.ok(['active', 'degraded', 'unavailable'].includes(state.pluginApi.attention.availability().status))
  const checkpointsSurface = state.pluginApi.executions.recovery.checkpoints
  const checkpointsAvailability = checkpointsSurface.availability()
  assert.ok(['active', 'degraded', 'unavailable'].includes(checkpointsAvailability.status))
  assert.equal(state.pluginApi.capabilities.get('sessions.cancel').status, 'active')
  assert.equal(state.pluginApi.capabilities.get('executions.recovery.checkpoints').status, 'active')
})

test('m9: interaction authority consumes attempt facts without double terminal commits', () => {
  const { ctx, state } = makeBootCtx({ withBoundary: true })
  apply(ctx)
  // one request accepted through the mounted authority
  const outcomePromise = state.pluginApi.sessions.request(
    { sessionId: 's1', content: [{ type: 'text', text: 'hi' }], idempotencyKey: 'k-1' },
    undefined,
  )
  return outcomePromise.then(async (outcome) => {
    assert.equal(outcome.ok, true)
    const operationId = outcome.operation.id
    const fire = (name, payload) => {
      for (const entry of ctx.listeners.filter((l) => l.name === name)) entry.listener(payload)
    }
    fire('agent/attempt/start', { attemptId: 't-1', operationId, executionId: null, sessionId: 's1', seq: 3, observedAt: '2026-09-06T00:00:30.000Z' })
    fire('agent/attempt/end', { attemptId: 't-1', operationId, executionId: null, sessionId: 's1', seq: 4, observedAt: '2026-09-06T00:00:31.000Z', outcome: 'success', reason: null, classification: null, followUp: 'none' })
    const status = outcome.operation.status()
    assert.equal(status.phase, 'terminal')
    assert.equal(status.terminal.outcome, 'success')
    const again = outcome.operation.status()
    assert.equal(again.phase, 'terminal', 'terminal commits once')
    assert.equal(again.terminal.outcome, 'success')
  })
})

test('m9: client-request bridge routes session request/cancel over the RPC carrier', async () => {
  const { ctx, state, services } = makeBootCtx({ withBoundary: true })
  // attach an RPC carrier handling the bridge route
  const handlers = new Map()
  ctx.get = (name) => {
    if (name === 'connection') {
      return {
        rpc: {
          call: async (path, endpoint, args, signal) => {
            const handler = handlers.get(path)
            if (!handler) return { ok: false, code: 'unavailable', reason: 'no route' }
            return handler(endpoint, args, signal)
          },
          handle(path, handler) {
            handlers.set(path, handler)
            return () => handlers.delete(path)
          },
        },
      }
    }
    if (name === 'pluginApi') return state.pluginApi
    return services[name]
  }
  apply(ctx)
  const bridge = await import('../lib/client-request-bridge.js')
  const client = bridge.createClientRequestTransport({ ctx, path: '/plugin-api/sessions' })
  const outcome = await client.request('sessions.request', { sessionId: 's1', content: [{ type: 'text', text: 'hi' }], idempotencyKey: 'k-i' })
  assert.notEqual(outcome.ok, undefined)
  assert.equal(outcome.code === 'accepted' || outcome.code === 'duplicate', true, 'host authority answers the typed request')
})

test('m9: an accepted operation exposes the activity correlation the projection evidences', async () => {
  const { ctx, state } = makeBootCtx({ withBoundary: true })
  apply(ctx)
  const outcome = await state.pluginApi.sessions.request(
    { sessionId: 's1', content: [{ type: 'text', text: 'hi' }], idempotencyKey: 'k-corr' },
    undefined,
  )
  assert.equal(outcome.code, 'accepted')
  const executionId = outcome.activity.executionId
  // Healthy projection, no evidence yet: `unknown`, never a fabricated id.
  assert.equal(outcome.activity.activityId, null)
  assert.equal(outcome.activity.confidence, 'unknown')

  const fire = (name, payload) => {
    for (const entry of ctx.listeners.filter((entry) => entry.name === name)) entry.listener(payload)
  }
  fire('agent/attempt/start', {
    attemptId: 'att-corr', operationId: outcome.operation.id, executionId,
    sessionId: 's1', seq: 7, observedAt: '2026-09-06T00:01:00.000Z',
  })

  // The projection owns the activity identity; the operation mirrors exactly
  // that id instead of minting its own from the event sequence.
  const record = state.pluginApi.sessions.activity.current('s1')
  assert.ok(record.snapshot, 'the attempt fact produced an activity record')
  assert.equal(record.snapshot.execution.executionId, executionId)
  const correlated = outcome.operation.status().activity
  assert.equal(correlated.activityId, record.snapshot.activityId)
  assert.equal(correlated.executionId, executionId)
  assert.equal(correlated.confidence, 'observed')

  fire('agent/attempt/end', {
    attemptId: 'att-corr', operationId: outcome.operation.id, executionId,
    sessionId: 's1', seq: 8, observedAt: '2026-09-06T00:01:02.000Z',
    outcome: 'success', reason: null, classification: null, followUp: 'none',
  })
  const terminal = outcome.operation.status()
  assert.equal(terminal.phase, 'terminal')
  assert.equal(terminal.terminal.outcome, 'success')
  assert.equal(terminal.activity.activityId, record.snapshot.activityId, 'the correlation survives the terminal')
  assert.equal(terminal.activity.confidence, 'observed')
})
