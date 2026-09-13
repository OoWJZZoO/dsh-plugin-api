/**
 * Delivery tests for the session request operation (steer / queue).
 *
 * A request that arrives while the target session has a live operation keeps
 * its delivered `already-running` default. An explicit `delivery` instead
 * hands the message to the official agent seams: `steer` splices into the live
 * attempt, `queue` parks it in the official next-turn inbox. Both are verified
 * against the official inbox cancellation identity — a queued reference cancels
 * the message it delivered, and never an unrelated later operation.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
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
import { createSessionInteractionOperation } from '../lib/session-interaction-operation.js'
import { INTERACTION_BOUNDARY_SYMBOL } from '../lib/session-interaction-operation-authority.js'

const contracts = buildSessionDurableContracts({
  Session,
  isJsonValue,
  snapshotJsonValue,
  knownSessionEventTypes: KNOWN_SESSION_EVENT_TYPES,
  isSurfaceEligibleType,
})

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

/**
 * A minimal official agent double: the three seams `delivery` uses are the
 * real contract (`steer`/`followup` take a user message; `inbox.remove` answers
 * whether the message was still pending).
 */
function makeAgent({ pending = new Set(), removeBehaviour } = {}) {
  return {
    steered: [],
    followedUp: [],
    removed: [],
    inbox: {
      get nextTurn() {
        return []
      },
      get nextStep() {
        return []
      },
      get hasPending() {
        return pending.size > 0
      },
      remove(messageId) {
        this.owner.removed.push(messageId)
        if (typeof removeBehaviour === 'function') return removeBehaviour(messageId, pending)
        const had = pending.has(messageId)
        pending.delete(messageId)
        return had
      },
    },
    steer(message) {
      this.steered.push(message)
    },
    followup(message) {
      this.followedUp.push(message)
      pending.add(message.id)
    },
  }
}

function bootHost({ agent } = {}) {
  const ctx = new Context()
  new SessionStore(ctx)
  const appends = []
  const durableAppendMessage = (session, kind, payload, options) => {
    const result = appendMessage(session, kind, payload, options, { Session, sessions: ctx.sessions, contracts })
    appends.push({ kind, payload })
    return result
  }
  const liveAgent = agent ?? null
  if (liveAgent?.inbox !== undefined && liveAgent.inbox !== null) liveAgent.inbox.owner = liveAgent
  const hostCtx = {
    get(name) {
      if (name === 'pluginApi') return { isActive: true, sessions: { durable: { appendMessage: durableAppendMessage } } }
      if (name === 'sessions') return { get: (id) => ctx.sessions.get(id) }
      if (name === 'agents') return { get: (id) => (liveAgent === null || id !== sessionIdOf(liveAgent) ? undefined : liveAgent) }
      if (name === 'agentLoop') return { [INTERACTION_BOUNDARY_SYMBOL]: makeBoundary() }
      return undefined
    },
    logger: { warn: () => {} },
  }
  const owner = createSessionInteractionOperation({ ctx: hostCtx, coreActive: () => true })
  return { ctx, owner, appends }
}

/** The single session a test's live agent stands for. */
let currentSessionId = null
function sessionIdOf() {
  return currentSessionId
}

async function withLiveOperation(t, { agent } = {}) {
  const kit = bootHost({ agent })
  const session = kit.ctx.sessions.create('delivery-session')
  currentSessionId = session.id
  const first = await kit.owner.request({ sessionId: session.id, message: { kind: 'user-message', text: 'first' } }, { owner: 'consumer-a' })
  assert.equal(first.code, 'accepted', 'the live operation is admitted first')
  return { ...kit, session, operation: first.operation }
}

test('the default same-session conflict is unchanged: already-running, nothing delivered', async (t) => {
  const agent = makeAgent()
  const kit = await withLiveOperation(t, { agent })
  const outcome = await kit.owner.request({ sessionId: kit.session.id, message: { kind: 'user-message', text: 'second' } }, { owner: 'consumer-a' })
  assert.equal(outcome.code, 'already-running')
  assert.equal(outcome.operationRef.id, kit.operation.id)
  assert.deepEqual(agent.steered, [])
  assert.deepEqual(agent.followedUp, [])
  assert.equal(kit.appends.length, 1, 'no second durable write')
})

test('steer splices into the live attempt and references the same operation identity', async (t) => {
  const agent = makeAgent()
  const kit = await withLiveOperation(t, { agent })
  const outcome = await kit.owner.request({ sessionId: kit.session.id, message: { kind: 'user-message', text: 'steer me' }, delivery: 'steer' }, { owner: 'consumer-a' })

  assert.equal(outcome.ok, true)
  assert.equal(outcome.code, 'accepted')
  assert.equal(outcome.delivery, 'steer')
  assert.equal(outcome.operation.id, kit.operation.id, 'steer never mints a second operation')
  assert.equal(agent.steered.length, 1)
  assert.equal(agent.steered[0].role, 'user')
  assert.deepEqual(agent.steered[0].content, [{ type: 'text', text: 'steer me' }])
  assert.equal(agent.steered[0].source.kind, 'user')
  assert.deepEqual(agent.followedUp, [])
  assert.equal(kit.appends.length, 1, 'the official inbox carries the content; the facade does not append a duplicate')
})

test('queue parks the message in the official next-turn inbox with a cancellable reference', async (t) => {
  const agent = makeAgent()
  const kit = await withLiveOperation(t, { agent })
  const outcome = await kit.owner.request({ sessionId: kit.session.id, message: { kind: 'user-message', text: 'queue me' }, delivery: 'queue' }, { owner: 'consumer-a' })

  assert.equal(outcome.code, 'accepted')
  assert.equal(outcome.delivery, 'queue')
  assert.equal(typeof outcome.queuedRef.id, 'string')
  assert.equal(outcome.queuedRef.operationId, kit.operation.id)
  assert.equal(agent.followedUp.length, 1)
  assert.equal(agent.followedUp[0].id, outcome.queuedRef.id, 'the queued reference is the official inbox message identity')
})

test('an unreachable delivery seam refuses typed and writes nothing', async (t) => {
  const kit = bootHost({ agent: null })
  const session = kit.ctx.sessions.create('delivery-no-agent')
  currentSessionId = session.id
  const first = await kit.owner.request({ sessionId: session.id, message: { kind: 'user-message', text: 'first' } }, { owner: 'consumer-a' })
  assert.equal(first.code, 'accepted')

  const outcome = await kit.owner.request({ sessionId: session.id, message: { kind: 'user-message', text: 'steer' }, delivery: 'steer' }, { owner: 'consumer-a' })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'unavailable')
  assert.match(outcome.reason, /seam is unavailable/)
  assert.equal(kit.appends.length, 1, 'no append-and-guess fallback')
})

test('an agent missing the inbox seam is refused rather than half-delivered', async (t) => {
  const agent = makeAgent()
  delete agent.inbox
  const kit = await withLiveOperation(t, { agent })
  const outcome = await kit.owner.request({ sessionId: kit.session.id, message: { kind: 'user-message', text: 'queue' }, delivery: 'queue' }, { owner: 'consumer-a' })
  assert.equal(outcome.code, 'unavailable')
  assert.deepEqual(agent.followedUp, [])
})

test('a throwing delivery seam is contained into a typed unavailable outcome', async (t) => {
  const agent = makeAgent()
  agent.steer = () => {
    throw new Error('driver is gone')
  }
  const kit = await withLiveOperation(t, { agent })
  const outcome = await kit.owner.request({ sessionId: kit.session.id, message: { kind: 'user-message', text: 'steer' }, delivery: 'steer' }, { owner: 'consumer-a' })
  assert.equal(outcome.code, 'unavailable')
  assert.match(outcome.reason, /refused the message/)
})

test('delivery carries attachment blocks through the same fail-closed mapping', async (t) => {
  const agent = makeAgent()
  const kit = await withLiveOperation(t, { agent })
  const ref = { attachmentId: 'att_missing', mediaType: 'image/png', bytes: 68, width: 8, height: 8 }
  const outcome = await kit.owner.request({
    sessionId: kit.session.id,
    message: { kind: 'user-message', text: 'with image', attachmentRefs: [ref] },
    delivery: 'queue',
  }, { owner: 'consumer-a' })
  assert.equal(outcome.code, 'unavailable', 'the delivery path is not exempt from attachment verification')
  assert.match(outcome.reason, /attachment/i, 'the refusal names the attachment failure, not a generic delivery error')
  assert.deepEqual(agent.followedUp, [], 'nothing reaches the inbox when a reference cannot be resolved')
})

test('cancelling a queued delivery removes exactly that inbox message', async (t) => {
  const agent = makeAgent()
  const kit = await withLiveOperation(t, { agent })
  const queued = await kit.owner.request({ sessionId: kit.session.id, message: { kind: 'user-message', text: 'queue me' }, delivery: 'queue' }, { owner: 'consumer-a' })
  assert.equal(queued.code, 'accepted')

  const cancelled = kit.owner.cancel({ sessionId: kit.session.id, queuedRef: queued.queuedRef }, { owner: 'consumer-a' })
  assert.equal(cancelled.ok, true)
  assert.equal(cancelled.code, 'accepted')
  assert.equal(cancelled.scope, 'queue')
  assert.deepEqual(agent.removed, [queued.queuedRef.id])
})

test('a claimed queued delivery whose operation is gone reports stale instead of cancelling a later operation', async (t) => {
  const agent = makeAgent({ removeBehaviour: () => false })
  const kit = await withLiveOperation(t, { agent })
  const queued = await kit.owner.request({ sessionId: kit.session.id, message: { kind: 'user-message', text: 'queue me' }, delivery: 'queue' }, { owner: 'consumer-a' })

  const cancelled = kit.owner.cancel({ sessionId: kit.session.id, queuedRef: { id: queued.queuedRef.id, operationId: 'op_somewhere_else' } }, { owner: 'consumer-a' })
  assert.equal(cancelled.ok, false)
  assert.equal(cancelled.code, 'stale')
  assert.match(cancelled.reason, /already claimed/)
})

test('a claimed queued delivery still tied to the live operation falls through to the live cancel path', async (t) => {
  const agent = makeAgent({ removeBehaviour: () => false })
  const kit = await withLiveOperation(t, { agent })
  const queued = await kit.owner.request({ sessionId: kit.session.id, message: { kind: 'user-message', text: 'queue me' }, delivery: 'queue' }, { owner: 'consumer-a' })

  const cancelled = kit.owner.cancel({ sessionId: kit.session.id, queuedRef: queued.queuedRef }, { owner: 'consumer-a' })
  assert.equal(cancelled.code, 'accepted', 'the live operation inherited the cancel')
  const status = kit.operation.status()
  assert.equal(status.phase, 'terminal')
  assert.equal(status.terminal.outcome, 'aborted', 'cancel is a signal; the terminal is adjudicated by the authority')
})

test('an unreadable queued reference is rejected as invalid input', async (t) => {
  const agent = makeAgent()
  const kit = await withLiveOperation(t, { agent })
  const bad = kit.owner.cancel({ sessionId: kit.session.id, queuedRef: {} }, { owner: 'consumer-a' })
  assert.equal(bad.code, 'invalid-input')
  const missingSession = kit.owner.cancel({ queuedRef: { id: 'msg_1' } }, { owner: 'consumer-a' })
  assert.equal(missingSession.code, 'invalid-input')
})
