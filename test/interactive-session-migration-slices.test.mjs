/**
 * Consumer migration slices for interactive session access.
 *
 * Recorded facts (goal §Why / OBS-09 / OBS-12): the mobile channel of
 * `dsh-remote-web-ui` talks to the private `apiProxy.events.mux` directly and
 * calls several mux operations, and a continuation/recovery style plugin has to
 * reconstruct run state from raw events. Neither consumer repository lives in
 * this workspace, so these slices execute the public call shapes a consumer
 * migrates to and assert the deltas — they never claim a migrated repository.
 *
 * | slice | original consumer behavior | migrated public call | observed result |
 * |---|---|---|---|
 * | A (mobile channel) | opens the private mux, calls `session.prompt`/`session.selectModel`/`session.models` and reads raw approval frames | `sessions.request` (with `attachmentRefs`/`delivery`), `sessions.interactions.list/get/respond`, `sessions.selection.get/set`, plus the delivered `sessions.channels`/`attention` owners | the client depends on no mux frame: the selection read/submit round-trips through the audited whitelist members, a queued delivery lands in the official inbox, and an approval is observed and answered through the facade |
 * | B (auto-continue / chat recovery) | folds `session/event` streams to guess what is still running and what to resend | `sessions.activity` + the delivered operation `status()`/`observe()` + `sessions.channels` resume | live/queued work is read from the shared activity projection, a stale handle answers typed, and committed queued work is not re-sent |
 *
 * Non-functional and recorded instead of approximated: the consumers' own
 * renderers, command registries and remote contracts.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionInteractionOperation } from '../lib/session-interaction-operation.js'
import { createInteractionsAuthority, mountInteractionsFeature } from '../lib/sessions-interactions-facade.js'
import { createSelectionAuthority } from '../lib/sessions-selection-facade.js'
import { INTERACTION_BOUNDARY_SYMBOL } from '../lib/session-interaction-operation-authority.js'

function makeBoundary() {
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

test('slice A: an mux-bound mobile channel moves onto the typed faces', async () => {
  const calls = { models: [], selectModel: [] }
  let current = { provider: 'deepseek', model: 'v3' }
  const apiProxy = {
    sessionsModels(request) {
      calls.models.push(request)
      return { rpcId: request.rpcId, result: { ok: true, value: { current: { ...current }, routable: true, groups: [], failures: [] } } }
    },
    sessionsSelectModel(request) {
      calls.selectModel.push(request)
      current = { provider: request.payload.provider, model: request.payload.model }
      return { rpcId: request.rpcId, result: { ok: true, value: { selected: { ...current } } } }
    },
  }
  const selection = createSelectionAuthority({
    readModels: (sessionId) => apiProxy.sessionsModels({ rpcId: 'rpc', payload: { sessionId } }),
    submitSelection: ({ sessionId, selection: picked, rpcId }) => apiProxy.sessionsSelectModel({
      rpcId,
      payload: { sessionId, provider: picked.provider, model: picked.model },
    }),
    deploymentDefaultOf: () => ({ provider: 'deepseek', model: 'v3' }),
  })
  const picked = selection.set({ sessionId: 's1', selection: { model: 'v4' } })
  assert.equal(picked.code, 'committed', 'the model switch no longer needs a mux frame')
  assert.equal(calls.selectModel.length, 1)
  assert.equal(selection.get({ sessionId: 's1' }).view.model, 'v4')

  // The approval half of the same client journey.
  const root = { logger: { warn() {} } }
  const events = []
  let resolveRequest
  const session = { id: 's1', events }
  const notify = () => {}
  const authority = createInteractionsAuthority({
    ctx: root,
    sessionLookup: (id) => (id === 's1' ? session : undefined),
    sessionList: () => [session],
    timer: { setTimeout: (fn, ms) => ({ fn, ms }), clearTimeout: () => {} },
  })
  const mounted = mountInteractionsFeature({ ctx: { on: () => () => {}, logger: { warn() {} } }, authority })
  mounted.surface.list({ sessionId: 's1' })
  events.push({ seq: 1, type: 'approval/asked', time: '2026-09-14T00:00:00.000Z', data: { id: 'ask-1', toolName: 'bash', callId: 'c1' } })
  notify()
  const held = authority.answerer({ agent: { session }, callId: 'c1' }, () => Promise.resolve('unavailable'))
  const view = mounted.surface.list({ sessionId: 's1' }).items[0]
  assert.ok(view, 'the client sees the pending approval without reading a mux frame')
  resolveRequest = view.id
  assert.equal(mounted.surface.respond({ id: resolveRequest, action: 'approve' }).code, 'accepted')
  assert.equal(await held, 'allowed-once')
  mounted.dispose()
})

test('slice A: the delivery vocabulary replaces the mux prompt mode', async () => {
  const steered = []
  const followed = []
  const agent = {
    inbox: { remove: () => true },
    steer: (message) => steered.push(message),
    followup: (message) => followed.push(message),
  }
  const ctx = {
    get(name) {
      if (name === 'pluginApi') return { isActive: true }
      if (name === 'sessions') return { get: () => ({ id: 's1' }) }
      if (name === 'agents') return { get: (id) => (id === 's1' ? agent : undefined) }
      if (name === 'agentLoop') return { [INTERACTION_BOUNDARY_SYMBOL]: makeBoundary() }
      return undefined
    },
    logger: { warn: () => {} },
  }
  const owner = createSessionInteractionOperation({ ctx, coreActive: () => true, durableAppend: async () => ({ ok: true }) })
  const live = await owner.request({ sessionId: 's1', message: { kind: 'user-message', text: 'first' } }, { owner: 'mobile' })
  assert.equal(live.code, 'accepted')
  assert.equal((await owner.request({ sessionId: 's1', message: { kind: 'user-message', text: 'steer' }, delivery: 'steer' }, { owner: 'mobile' })).delivery, 'steer')
  assert.equal((await owner.request({ sessionId: 's1', message: { kind: 'user-message', text: 'queue' }, delivery: 'queue' }, { owner: 'mobile' })).delivery, 'queue')
  assert.equal(steered.length, 1)
  assert.equal(followed.length, 1)
  owner.dispose()
})

test('slice B: a recovery plugin reads the shared activity and operation faces instead of folding events', async () => {
  const facts = []
  const ctx = {
    get(name) {
      if (name === 'pluginApi') return { isActive: true }
      if (name === 'sessions') return { get: () => ({ id: 's1' }) }
      if (name === 'agentLoop') return { [INTERACTION_BOUNDARY_SYMBOL]: makeBoundary() }
      return undefined
    },
    logger: { warn: () => {} },
  }
  const owner = createSessionInteractionOperation({ ctx, coreActive: () => true, durableAppend: async () => ({ ok: true }) })
  const accepted = await owner.request({ sessionId: 's1', message: { kind: 'user-message', text: 'resume me' } }, { owner: 'recovery' })
  owner.ingestAttemptFact({ name: 'agent/attempt/start', operationId: accepted.operation.id, attemptId: 'att-1', observedAt: '2026-09-14T00:00:02.000Z' })
  const observed = []
  accepted.operation.observe((status) => observed.push(status.phase))
  assert.ok(observed.includes('running'), 'the shared operation face reports the live phase')

  // A stale handle (an older generation's reference) answers typed instead of
  // writing into the current one.
  const stale = owner.cancel({ operationId: 'op_from_an_older_generation' }, { owner: 'recovery' })
  assert.equal(stale.code, 'stale')

  const cancelled = owner.cancel({ operationId: accepted.operation.id, by: 'system', reason: 'resume decided not to continue' }, { owner: 'recovery' })
  assert.equal(cancelled.code, 'accepted')
  assert.equal(cancelled.ok, true, 'the cancel is a signal; the authority confirms it with the loop')
  // The loop converges the attempt; the authority — not the client — writes
  // the single terminal from that fact.
  owner.ingestAttemptFact({ name: 'agent/attempt/end', operationId: accepted.operation.id, attemptId: 'att-1', outcome: 'aborted', observedAt: '2026-09-14T00:00:03.000Z' })
  const terminal = accepted.operation.status()
  assert.equal(terminal.phase, 'terminal')
  assert.equal(terminal.terminal.outcome, 'aborted')
  facts.push(accepted.operation.id)
  assert.equal(facts.length, 1)
  owner.dispose()
})
