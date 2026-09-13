/**
 * Attachment-bearing request tests for the session request operation.
 *
 * The public `message.attachmentRefs` are official durable image references.
 * They must be verified through the attachments authority, mapped one-to-one
 * into `{ type: 'image', attachment: <canonical ref> }` blocks in order, and
 * fail the whole request typed (with a per-reference bounded reason) when any
 * single reference cannot be resolved — never a partial or text-only write.
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

function imageRef(attachmentId, overrides = {}) {
  return Object.freeze({
    attachmentId,
    mediaType: 'image/png',
    bytes: 68,
    width: 8,
    height: 8,
    ...overrides,
  })
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

/**
 * Real official session + real durable append + a probe attachments store that
 * implements the official `AttachmentStore` read contract (verifies the
 * reference and answers with the canonical one).
 */
function bootHost({ known = null, readThrows = null } = {}) {
  const ctx = new Context()
  new SessionStore(ctx)
  const appends = []
  const reads = []
  const readable = known ?? new Map()
  const durableAppendMessage = (session, kind, payload, options) => {
    const result = appendMessage(session, kind, payload, options, { Session, sessions: ctx.sessions, contracts })
    appends.push({ kind, payload })
    return result
  }
  const attachments = {
    imageLimits: Object.freeze({ maxImageBytes: 1024, maxImagesPerMessage: 4, maxMessageImageBytes: 4096, maxImagePixels: 4096, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] }),
    async readImage(ref) {
      reads.push(ref)
      if (typeof readThrows === 'function' && readThrows(ref)) {
        const error = new Error('attachment is not stored')
        error.code = 'ATTACHMENT_NOT_FOUND'
        throw error
      }
      const canonical = readable.get(ref.attachmentId)
      if (canonical === undefined) {
        const error = new Error('attachment is not stored')
        error.code = 'ATTACHMENT_NOT_FOUND'
        throw error
      }
      return { ref: canonical, data: new Uint8Array(canonical.bytes) }
    },
  }
  const hostCtx = {
    get(name) {
      if (name === 'pluginApi') {
        return { isActive: true, sessions: { durable: { appendMessage: durableAppendMessage } } }
      }
      if (name === 'sessions') return { get: (id) => ctx.sessions.get(id) }
      if (name === 'attachments') return attachments
      if (name === 'agentLoop') return { [INTERACTION_BOUNDARY_SYMBOL]: makeBoundary() }
      return undefined
    },
    logger: { warn: () => {} },
  }
  const owner = createSessionInteractionOperation({ ctx: hostCtx, coreActive: () => true })
  return { ctx, owner, appends, reads }
}

test('a resolvable reference becomes one image block preserving the declared order', async () => {
  const first = imageRef('att_1')
  const second = imageRef('att_2', { mediaType: 'image/jpeg', bytes: 128, name: 'photo.jpg' })
  const { ctx, owner, appends, reads } = bootHost({ known: new Map([['att_1', first], ['att_2', second]]) })
  const session = ctx.sessions.create('attachments-order')
  const outcome = await owner.request({
    sessionId: session.id,
    message: { kind: 'user-message', text: 'two images', attachmentRefs: [first, second] },
  }, { owner: 'consumer-a' })

  assert.equal(outcome.code, 'accepted', 'the mapped write must commit')
  assert.equal(appends.length, 1)
  const content = appends[0].payload.content
  assert.deepEqual(content.map((block) => block.type), ['text', 'image', 'image'])
  assert.equal(content[0].text, 'two images')
  assert.deepEqual(content[1].attachment, first, 'the canonical reference is carried verbatim')
  assert.deepEqual(content[2].attachment, second, 'order follows the request, never a re-order')
  assert.deepEqual(reads.map((ref) => ref.attachmentId), ['att_1', 'att_2'], 'every declared ref is verified once, in order')
  assert.equal(appends[0].payload.source.kind, 'user', 'the source-audited provenance is unchanged')
  assert.deepEqual(Object.keys(appends[0].payload).sort(), ['content', 'id', 'role', 'source'], 'the durable message keeps its exact record shape')
})

test('one unresolvable reference fails the whole request with a per-reference reason and writes nothing', async () => {
  const known = imageRef('att_ok')
  const missing = imageRef('att_missing')
  const { ctx, owner, appends, reads } = bootHost({ known: new Map([['att_ok', known]]) })
  const session = ctx.sessions.create('attachments-fail-closed')
  const outcome = await owner.request({
    sessionId: session.id,
    message: { kind: 'user-message', text: 'mixed', attachmentRefs: [known, missing] },
  }, { owner: 'consumer-a' })

  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'unavailable')
  assert.match(outcome.reason, /att_missing/, 'the reason names the offending reference')
  assert.match(outcome.reason, /ATTACHMENT_NOT_FOUND/, 'the reason carries the failure class, not a generic message')
  assert.deepEqual(appends, [], 'no partial message is written')
  assert.equal(reads.length, 2, 'verification stops at the failing reference only after reading it')
})

test('an unreachable attachments authority refuses attachment-bearing requests but not plain text', async () => {
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
      if (name === 'pluginApi') return { isActive: true, sessions: { durable: { appendMessage: durableAppendMessage } } }
      if (name === 'sessions') return { get: (id) => ctx.sessions.get(id) }
      if (name === 'agentLoop') return { [INTERACTION_BOUNDARY_SYMBOL]: makeBoundary() }
      // no attachments service on this deployment
      return undefined
    },
    logger: { warn: () => {} },
  }
  const owner = createSessionInteractionOperation({ ctx: hostCtx, coreActive: () => true })
  const session = ctx.sessions.create('attachments-absent')

  const withImage = await owner.request({
    sessionId: session.id,
    message: { kind: 'user-message', text: 'image', attachmentRefs: [imageRef('att_1')] },
  }, { owner: 'consumer-a' })
  assert.equal(withImage.code, 'unavailable')
  assert.match(withImage.reason, /attachments authority is unavailable/)
  assert.deepEqual(appends, [], 'nothing is guessed into the durable log')

  const text = await owner.request({
    sessionId: session.id,
    message: { kind: 'user-message', text: 'plain' },
  }, { owner: 'consumer-a' })
  assert.equal(text.code, 'accepted', 'the plain-text path is untouched by the attachment gate')
  assert.deepEqual(appends[0].payload.content, [{ type: 'text', text: 'plain' }])
})

test('an empty reference list behaves exactly like no references at all', async () => {
  const { ctx, owner, appends, reads } = bootHost({ known: new Map() })
  const session = ctx.sessions.create('attachments-empty')
  const withEmpty = await owner.request({
    sessionId: session.id,
    message: { kind: 'user-message', text: 'nothing attached', attachmentRefs: [] },
  }, { owner: 'consumer-a' })
  assert.equal(withEmpty.code, 'accepted')
  assert.deepEqual(reads, [], 'an empty list never probes the store')
  assert.deepEqual(appends[0].payload.content, [{ type: 'text', text: 'nothing attached' }])
})

test('the declared reference is never mutated and the canonical one is re-frozen', async () => {
  const declared = imageRef('att_1')
  const canonical = imageRef('att_1', { bytes: 96 })
  const { ctx, owner, appends } = bootHost({ known: new Map([['att_1', canonical]]) })
  const session = ctx.sessions.create('attachments-canonical')
  await owner.request({
    sessionId: session.id,
    message: { kind: 'user-message', text: 'canonical', attachmentRefs: [declared] },
  }, { owner: 'consumer-a' })
  const block = appends[0].payload.content[1]
  assert.deepEqual(block.attachment, canonical, 'the store-verified reference wins over the declared copy')
  assert.ok(Object.isFrozen(block.attachment), 'the carried reference is frozen')
  assert.notEqual(block.attachment, canonical, 'the durable block never holds the store-owned object')
})
