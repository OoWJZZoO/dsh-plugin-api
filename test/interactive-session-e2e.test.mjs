/**
 * End-to-end acceptance for the interactive session access line.
 *
 * The approval journey runs against the real official authority: a real
 * `dsh-session` Session with an open turn, the real `dsh-user-approval`
 * ApprovalService driving its own waterfall and durable pair, the facade's
 * last-resort answerer, and an interactive client that only consumes public
 * contracts (list → respond). The selection journey runs against the official
 * mux request/response shape the audited apiProxy whitelist members speak; the
 * attachment journey writes through the real durable append contract.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import {
  KNOWN_SESSION_EVENT_TYPES,
  Session,
  SessionStore,
  isJsonValue,
  isSurfaceEligibleType,
  snapshotJsonValue,
} from '@deepseek-ai/dsh-session'
import { buildSessionDurableContracts } from '../lib/session-durable-catalog.js'
import { appendMessage } from '../lib/session-durable-feature.js'
import { createInteractionsAuthority, mountInteractionsFeature } from '../lib/sessions-interactions-facade.js'
import { createSelectionAuthority } from '../lib/sessions-selection-facade.js'
import { createSessionInteractionOperation } from '../lib/session-interaction-operation.js'
import { INTERACTION_BOUNDARY_SYMBOL } from '../lib/session-interaction-operation-authority.js'

const contracts = buildSessionDurableContracts({
  Session,
  isJsonValue,
  snapshotJsonValue,
  knownSessionEventTypes: KNOWN_SESSION_EVENT_TYPES,
  isSurfaceEligibleType,
})

function imageRef(id, overrides = {}) {
  return Object.freeze({ attachmentId: id, mediaType: 'image/png', bytes: 68, width: 8, height: 8, ...overrides })
}

/** Open a real session whose log has an open turn (the approval audit pair is turn-enclosed). */
function openSession(id) {
  const store = new SessionStore(new Context())
  const session = store.create(id)
  session.append('turn/start', { turn: 1 })
  return session
}

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

/** Boot the real approval authority plus the facade's interactions face. */
function bootInteractions() {
  const root = new Context()
  const store = new SessionStore(root)
  new ApprovalService(root, { policy: 'ask' })
  const session = store.create('e2e-approval')
  session.append('turn/start', { turn: 1 })
  const listenerOffs = []
  root.on = (name, listener) => {
    listenerOffs.push(name)
    return () => {}
  }
  const authority = createInteractionsAuthority({
    ctx: root,
    sessionLookup: (id) => store.get(id),
    sessionList: () => store.list(),
    now: () => new Date('2026-09-14T10:00:00.000Z'),
  })
  const mounted = mountInteractionsFeature({ ctx: { on: () => () => {}, logger: { warn() {} } }, authority })
  // The official authority drives its own waterfall; the facade's answerer is
  // the last resort, so it is wired as the fallback of the real service call.
  root.approval.decide = (req, targetSession) => {
    const answer = Promise.resolve().then(() => mounted.surface === undefined ? 'unavailable' : authority.answerer(req, () => Promise.resolve('unavailable')))
    void targetSession
    return answer.then((outcome) => (['allowed-once', 'rejected', 'unavailable', 'cancelled'].includes(outcome) ? outcome : 'unavailable'))
  }
  return { root, store, session, authority, mounted, listenerOffs }
}

test('an interactive client answers a real approval through the restricted view', async () => {
  const { root, session, authority, mounted } = bootInteractions()
  try {
    // The client shows interest in the session (that is what arms the
    // last-resort answerer) and sees nothing pending yet.
    const before = mounted.surface.list({ sessionId: session.id })
    assert.deepEqual(before.items, [])
    assert.deepEqual(before.sources, { approval: 'active', question: 'unavailable' })

    // The official authority asks for a decision; its durable pair is appended
    // by the authority itself.
    const decision = root.approval.request({ agent: { session, ctx: root }, toolName: 'bash', callId: 'call-1', signal: undefined })
    assert.equal(session.events.some((event) => event.type === 'approval/asked'), true, 'the official authority wrote the pending record')
    // The official waterfall dispatches through a promise chain, so the
    // last-resort answerer holds one microtask later — the same latency a real
    // client sees between asking and the pending item becoming answerable.
    await new Promise((resolve) => setTimeout(resolve, 0))

    const pending = mounted.surface.list({ sessionId: session.id })
    assert.equal(pending.items.length, 1, 'the view reports the pending approval the authority just asked for')
    const view = pending.items[0]
    assert.equal(view.kind, 'approval')
    assert.match(view.summary, /bash/)
    assert.equal(session.events.some((event) => event.type === 'approval/decided'), false, 'nothing is decided yet')

    const outcome = mounted.surface.respond({ id: view.id, action: 'approve' })
    assert.equal(outcome.code, 'accepted')
    assert.equal(await decision, 'allowed-once', 'the official authority receives the caller decision verbatim')

    // The client's second attempt is stale, and the pending set is empty again.
    assert.equal(mounted.surface.respond({ id: view.id, action: 'reject' }).code, 'stale')
    assert.deepEqual(mounted.surface.list({ sessionId: session.id }).items, [], 'a decided interaction disappears from the view')
    void authority
  } finally {
    mounted.dispose()
  }
})

test('an unanswered approval is released with the official no-answer value when the lease expires', async () => {
  const scheduled = []
  const root = new Context()
  const store = new SessionStore(root)
  new ApprovalService(root, { policy: 'ask' })
  const session = store.create('e2e-lease')
  session.append('turn/start', { turn: 1 })
  session.append('approval/asked', { id: 'ask-lease', toolName: 'bash' })
  const authority = createInteractionsAuthority({
    ctx: root,
    sessionLookup: (id) => store.get(id),
    sessionList: () => store.list(),
    timer: { setTimeout: (fn, ms) => { scheduled.push({ fn, ms }); return { fn, ms } }, clearTimeout: () => {} },
  })
  const mounted = mountInteractionsFeature({ ctx: { on: () => () => {}, logger: { warn() {} } }, authority })
  try {
    mounted.surface.list({ sessionId: session.id })
    const held = authority.answerer({ agent: { session }, callId: null }, () => Promise.resolve('unavailable'))
    assert.equal(scheduled.length, 1)
    scheduled[0].fn()
    assert.equal(await held, 'unavailable', 'no client answer means the official no-answer value, never a fabricated decision')
  } finally {
    mounted.dispose()
  }
})

test('the official mux selection seam is consumed through the audited whitelist members', () => {
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
  const authority = createSelectionAuthority({
    readModels: (sessionId) => apiProxy.sessionsModels({ rpcId: 'rpc', payload: { sessionId } }),
    submitSelection: ({ sessionId, selection, rpcId }) => apiProxy.sessionsSelectModel({
      rpcId,
      payload: { sessionId, provider: selection.provider, model: selection.model },
    }),
    loggedConfigOf: () => undefined,
    deploymentDefaultOf: () => ({ provider: 'deepseek', model: 'v3' }),
    now: () => new Date('2026-09-14T10:00:00.000Z'),
  })

  const before = authority.get({ sessionId: 's1' })
  assert.equal(before.view.source, 'fallback-deployment-default', 'the effective tier is disclosed instead of claimed as committed')
  const committed = authority.set({ sessionId: 's1', selection: { model: 'v4' }, expected: { provider: 'deepseek', model: 'v3' } })
  assert.equal(committed.code, 'committed')
  assert.equal(committed.view.model, 'v4')
  assert.equal(committed.view.source, 'committed')
  assert.equal(calls.selectModel.length, 1, 'exactly one write through the single official seam')
  const stale = authority.set({ sessionId: 's1', selection: { model: 'v5' }, expected: { model: 'v3' } })
  assert.equal(stale.code, 'conflict')
  assert.equal(calls.selectModel.length, 1, 'a conflicting snapshot never reaches the seam')
})

test('an attachment-bearing request reaches the real durable log with mapped image blocks', async () => {
  const root = new Context()
  const store = new SessionStore(root)
  const session = store.create('e2e-attachments')
  const appends = []
  const known = new Map()
  const stored = imageRef('att_e2e')
  known.set('att_e2e', stored)
  const attachments = {
    async readImage(ref) {
      const canonical = known.get(ref.attachmentId)
      if (canonical === undefined) {
        const error = new Error('not stored')
        error.code = 'ATTACHMENT_NOT_FOUND'
        throw error
      }
      return { ref: canonical, data: new Uint8Array(canonical.bytes) }
    },
  }
  const ctx = {
    get(name) {
      if (name === 'pluginApi') {
        return {
          isActive: true,
          sessions: {
            durable: {
              appendMessage(target, kind, payload, options) {
                const result = appendMessage(target, kind, payload, options, { Session, sessions: store, contracts })
                appends.push({ kind, payload })
                return result
              },
            },
          },
        }
      }
      if (name === 'sessions') return { get: (id) => store.get(id) }
      if (name === 'attachments') return attachments
      if (name === 'agentLoop') return { [INTERACTION_BOUNDARY_SYMBOL]: makeBoundary() }
      return undefined
    },
    logger: { warn: () => {} },
  }
  const owner = createSessionInteractionOperation({ ctx, coreActive: () => true })
  const accepted = await owner.request({
    sessionId: session.id,
    message: { kind: 'user-message', text: 'look at this', attachmentRefs: [stored] },
  }, { owner: 'client' })
  assert.equal(accepted.code, 'accepted')
  assert.deepEqual(appends[0].payload.content.map((block) => block.type), ['text', 'image'], 'the attachment is not shrunk to text')
  assert.deepEqual(appends[0].payload.content[1].attachment, stored, 'the durable block carries the store-verified reference')
  const durableEvents = session.events.filter((event) => event.type === 'user/message')
  assert.equal(durableEvents.length, 1, 'the real durable log holds exactly one user message')
  owner.dispose()
})
