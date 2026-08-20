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
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'
import { buildSessionDurableContracts } from '../lib/session-durable-catalog.js'
import { appendMessage } from '../lib/session-durable-feature.js'

const contracts = buildSessionDurableContracts({
  Session,
  isJsonValue,
  snapshotJsonValue,
  knownSessionEventTypes: KNOWN_SESSION_EVENT_TYPES,
  isSurfaceEligibleType,
})

function createPublishedFacade() {
  const ctx = new Context()
  new SessionStore(ctx)
  const registry = createFeatureRegistry()
  const Service = createPluginApiService({
    apiVersion: '0.5',
    registry,
    coreActive: () => true,
  })
  const service = new Service(ctx)
  service.mountFeature('session', {
    get(id) { return ctx.sessions.get(id) },
    list() { return ctx.sessions.list() },
    fork() {},
  })
  registry.mount('session')

  const facade = {
    appendMessage(session, kind, payload, options) {
      return appendMessage(session, kind, payload, options, {
        Session,
        sessions: ctx.sessions,
        contracts,
      })
    },
  }
  service.mountFeature('sessionDurable', { facade, closeEpoch() {} })
  registry.mount('sessionDurable')
  return { ctx, service }
}

function message(id, role, source, content) {
  return { id, role, source, content }
}

test('ability-anchor finite append mapping appends only supported messages without hand-authored surface metadata', () => {
  const { ctx, service } = createPublishedFacade()
  const session = ctx.sessions.create('ability-anchor-mapping')

  const user = service.session.appendMessage(session, 'user/message', message(
    'user-1',
    'user',
    { kind: 'user' },
    [{ type: 'text', text: 'hello' }],
  ))
  assert.deepEqual(user.surfaceOp, 'append')
  assert.equal(Object.hasOwn(user, 'sourceEventSeqs'), false)

  const assistant = service.session.appendMessage(session, 'assistant/message', {
    turn: 1,
    step: 1,
    message: message(
      'assistant-1',
      'assistant',
      { kind: 'model', provider: 'deepseek', model: 'model' },
      [{ type: 'text', text: 'complete answer' }],
    ),
  })
  assert.deepEqual(assistant.surfaceOp, 'append')
  assert.deepEqual(assistant.sourceEventSeqs, [])

  const rawCall = session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: 'call-1',
    name: 'lookup',
    arguments: { query: 'q' },
  })
  const result = service.session.appendMessage(session, 'tool/result', {
    turn: 1,
    step: 1,
    message: message(
      'tool-1',
      'user',
      { kind: 'tool', callId: 'call-1' },
      [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'result' }] }],
    ),
  }, { sourceEventSeqs: [rawCall.seq] })

  assert.equal(rawCall.type, 'tool/call')
  assert.equal(session.events[rawCall.seq], rawCall)
  assert.deepEqual(result.surfaceOp, 'append')
  assert.deepEqual(result.sourceEventSeqs, [rawCall.seq])
  assert.deepEqual(session.surface.nodes, [user.seq, assistant.seq, result.seq])
})

test('ability-anchor mapping rejects title, replacement, and atomic-turn attempts', () => {
  const { ctx, service } = createPublishedFacade()
  const session = ctx.sessions.create('ability-anchor-unsupported')
  const user = message('user-1', 'user', { kind: 'user' }, [])

  for (const [kind, payload, options] of [
    ['session/title', { title: 'outside finite append' }, undefined],
    ['user/message', user, { surfaceOp: 'replace' }],
    ['virtual-turn/commit', { events: [] }, undefined],
  ]) {
    assert.throws(
      () => service.session.appendMessage(session, kind, payload, options),
      (error) => error instanceof TypeError && [
        'unsupported-surface-message-kind',
        'invalid-options',
        'invalid-source-event-seqs',
      ].includes(error.code),
    )
  }

  assert.equal(session.events.length, 0)
  assert.equal(session.surface.nodes.length, 0)
  assert.throws(() => service.session.appendMessage(null, 'user/message', user), (error) => {
    return error instanceof TypeError && error.code === 'invalid-target-session'
  })
})
