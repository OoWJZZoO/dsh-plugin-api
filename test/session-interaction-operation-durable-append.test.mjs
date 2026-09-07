/**
 * End-to-end durable write tests for the session request operation.
 *
 * The public request message (`{ kind: 'user-message', text, attachmentRefs? }`)
 * must reach the real durable append layer (official `Session` + the audited
 * surface message contracts), never only a mock append that accepts anything.
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
    admitted: [],
    admit(spec) {
      this.admitted.push(spec)
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

/** Real official session + real durable append, observed through `appends`. */
function bootHost() {
  const ctx = new Context()
  new SessionStore(ctx)
  const appends = []
  const durableAppendMessage = (session, kind, payload, options) => {
    const result = appendMessage(session, kind, payload, options, { Session, sessions: ctx.sessions, contracts })
    appends.push({ kind, payload })
    return result
  }
  const hostCtx = {
    get(name) {
      if (name === 'pluginApi') {
        return { isActive: true, sessions: { durable: { appendMessage: durableAppendMessage } } }
      }
      if (name === 'sessions') return { get: (id) => ctx.sessions.get(id) }
      if (name === 'agentLoop') return { [INTERACTION_BOUNDARY_SYMBOL]: makeBoundary() }
      return undefined
    },
    logger: { warn: () => {} },
  }
  const owner = createSessionInteractionOperation({ ctx: hostCtx, coreActive: () => true })
  return { ctx, owner, appends }
}

test('a public user-message request is written through the real durable layer', async () => {
  const { ctx, owner, appends } = bootHost()
  const session = ctx.sessions.create('durable-e2e')
  const outcome = await owner.request({ sessionId: session.id ?? 'durable-e2e', message: { kind: 'user-message', text: 'hello' } }, { owner: 'consumer-a' })
  assert.equal(outcome.code, 'accepted', 'the durable write must not fail against the real surface contract')
  assert.equal(appends.length, 1)
  assert.equal(appends[0].kind, 'user/message', 'the public kind maps onto the durable surface kind')
  assert.equal(appends[0].payload.role, 'user')
  assert.equal(appends[0].payload.content[0].text, 'hello')
  assert.equal(appends[0].payload.source.kind, 'user')
})

test('attachment refs are never silently dropped: the request fails typed and writes nothing', async () => {
  const { ctx, owner, appends } = bootHost()
  const session = ctx.sessions.create('durable-e2e-attachments')
  const outcome = await owner.request({
    sessionId: session.id ?? 'durable-e2e-attachments',
    message: { kind: 'user-message', text: 'see image', attachmentRefs: ['att_1'] },
  }, { owner: 'consumer-a' })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'unavailable')
  assert.match(outcome.reason, /attachment/i)
  assert.deepEqual(appends, [], 'no partial write without the attachment content')
})

test('a request without content starts no durable write and still returns an operation', async () => {
  const { ctx, owner, appends } = bootHost()
  const session = ctx.sessions.create('durable-e2e-empty')
  const outcome = await owner.request({ sessionId: session.id ?? 'durable-e2e-empty' }, { owner: 'consumer-a' })
  assert.equal(outcome.code, 'accepted')
  assert.deepEqual(appends, [])
})
