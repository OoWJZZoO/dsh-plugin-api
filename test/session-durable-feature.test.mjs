import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from '@deepseek-ai/dsh-session'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { createEventsBus } from '../lib/events-bus.js'
import { sessionLifecycleEventsCatalog } from '../lib/session-events-catalog.js'
import {
  assertLiveSessionTarget,
  createDurableEpochRegistrationOwner,
  createDurableObservationHub,
  createSessionDurableApi,
  appendMessage,
  preflightSurfaceMessageAppend,
} from '../lib/session-durable-feature.js'
import { buildSessionDurableContracts } from '../lib/session-durable-catalog.js'
import {
  KNOWN_SESSION_EVENT_TYPES,
  isJsonValue,
  isSurfaceEligibleType,
  snapshotJsonValue,
} from '@deepseek-ai/dsh-session'

const { Session: ForeignSession } = await import('/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js?foreign-session-constructor')

function createLiveSession(id = 'session-1') {
  const session = Session.create(id)
  const sessions = {
    get(candidate) {
      return candidate === id ? session : undefined
    },
  }
  return { session, sessions }
}

function assertInvalidTarget(callback) {
  assert.throws(callback, (error) => {
    assert.equal(error instanceof TypeError, true)
    assert.equal(error.code, 'invalid-target-session')
    return true
  })
}

test('live target validation accepts only the current installed Session instance', () => {
  const { session, sessions } = createLiveSession()

  assert.equal(
    assertLiveSessionTarget(session, { Session, sessions, requireAppend: true }),
    session,
  )
})

test('live target validation rejects every invalid public identity without side effects', () => {
  const { session, sessions } = createLiveSession()
  let lookups = 0
  const countedSessions = {
    get(id) {
      lookups += 1
      return sessions.get(id)
    },
  }
  const foreignSession = ForeignSession.create('foreign')
  const detached = Session.create('detached')
  const missingBoundary = Session.create('missing-boundary')
  Object.defineProperty(missingBoundary, 'firstLiveSeq', { value: undefined })
  const invalidBoundary = Session.create('invalid-boundary')
  invalidBoundary.firstLiveSeq = Number.MAX_SAFE_INTEGER + 1
  const replaced = Session.create('session-1')

  for (const target of [
    'session-1',
    { id: 'session-1', append() {}, firstLiveSeq: 0 },
    detached,
    foreignSession,
    missingBoundary,
    invalidBoundary,
  ]) {
    const before = lookups
    assertInvalidTarget(() => assertLiveSessionTarget(target, { Session, sessions: countedSessions, requireAppend: true }))
    if (!(target instanceof Session && Number.isSafeInteger(target.firstLiveSeq) && target.firstLiveSeq >= 0)) {
      assert.equal(lookups, before)
    }
  }

  assertInvalidTarget(() => assertLiveSessionTarget(replaced, { Session, sessions: countedSessions, requireAppend: true }))
  assert.ok(lookups >= 2, 'only a structurally valid Session may reach identity lookup')

  const originalAppend = session.append
  session.append = undefined
  assertInvalidTarget(() => assertLiveSessionTarget(session, { Session, sessions: countedSessions, requireAppend: true }))
  session.append = originalAppend

  assertInvalidTarget(() => assertLiveSessionTarget(session, { Session, sessions: { get() { throw new Error('disposed') } }, requireAppend: true }))
  assertInvalidTarget(() => assertLiveSessionTarget(session, { Session, sessions: { get() { return replaced } }, requireAppend: true }))
})

test('epoch registration owner returns idempotent individual disposers and drains safely', () => {
  const warnings = []
  const owner = createDurableEpochRegistrationOwner({ logger: { warn(message) { warnings.push(message) } } })
  let firstCalls = 0
  let secondCalls = 0
  const first = owner.own(() => {
    firstCalls += 1
    return true
  })
  const second = owner.own(() => {
    secondCalls += 1
    throw new Error('dispose failure')
  })

  assert.equal(owner.isCurrent(), true)
  assert.equal(first(), true)
  assert.equal(first(), false)
  assert.equal(firstCalls, 1)
  assert.equal(owner.close(), true)
  assert.equal(owner.isCurrent(), false)
  assert.equal(secondCalls, 1)
  assert.equal(second(), false)
  assert.equal(owner.close(), false)
  assert.ok(warnings.length >= 1)
})

test('epoch registration owner makes captured callbacks inert before registered disposer work', () => {
  const owner = createDurableEpochRegistrationOwner()
  let userCodeRan = false
  let activeAtDisposal
  owner.own(() => {
    activeAtDisposal = owner.isCurrent()
    if (owner.isCurrent()) userCodeRan = true
    return true
  })

  assert.equal(owner.close(), true)
  assert.equal(activeAtDisposal, false)
  assert.equal(userCodeRan, false)
})

const durableContracts = buildSessionDurableContracts({
  Session,
  isJsonValue,
  snapshotJsonValue,
  knownSessionEventTypes: KNOWN_SESSION_EVENT_TYPES,
  isSurfaceEligibleType,
})

function createEventsApi() {
  const listeners = []
  return {
    listeners,
    on(name, listener) {
      assert.equal(name, 'session/event')
      listeners.push(listener)
      let disposed = false
      return () => {
        if (disposed) return false
        disposed = true
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
        return index >= 0
      }
    },
    emit(session, event) {
      for (const listener of [...listeners]) listener(session, event)
    },
  }
}

function createDurableApi() {
  const { session, sessions } = createLiveSession()
  const eventsApi = createEventsApi()
  const resets = []
  const owner = createDurableEpochRegistrationOwner()
  const api = createSessionDurableApi({
    Session,
    sessions,
    eventsApi,
    contracts: durableContracts,
    owner,
    reset(diagnostic) {
      resets.push(diagnostic)
      owner.close()
    },
  })
  return { api, eventsApi, owner, resets, session, sessions }
}

function durableEvent(type, data = { policy: 'ask' }, seq = 0) {
  return Object.freeze(Object.freeze({
    type,
    seq,
    time: 0,
    data: Object.freeze(data),
  }))
}

function assertCode(code, callback) {
  assert.throws(callback, (error) => error instanceof TypeError && error.code === code)
}

function assertHistoryPreserved(session, eventsBefore, surfaceBefore) {
  assert.deepEqual(session.events.slice(0, eventsBefore.length), eventsBefore)
  for (let index = 0; index < eventsBefore.length; index += 1) {
    assert.equal(session.events[index], eventsBefore[index])
  }
  assert.deepEqual(session.surface.nodes.slice(0, surfaceBefore.nodes.length), surfaceBefore.nodes)
  assert.equal(session.surface.replaceGeneration, surfaceBefore.replaceGeneration)
}

test('onDurable delivers only future exact-target audited records and preserves identity', () => {
  const { api, eventsApi, session } = createDurableApi()
  const other = Session.create('other')
  const calls = []
  const dispose = api.onDurable(session, 'approval/policy', (event) => calls.push(event))
  const matching = durableEvent('approval/policy', { policy: 'ask' }, session.firstLiveSeq)

  eventsApi.emit(other, matching)
  eventsApi.emit(session, durableEvent('approval/asked', { id: 'a', toolName: 'x' }, session.firstLiveSeq))
  eventsApi.emit(session, matching)

  assert.deepEqual(calls, [matching])
  assert.equal(Object.isFrozen(calls[0]), true)
  assert.equal(dispose(), true)
  assert.equal(dispose(), false)
  assert.equal(eventsApi.listeners.length, 0)
})

test('onceDurable disposes before the first validated listener invocation', () => {
  const { api, eventsApi, session } = createDurableApi()
  let listenerCount = 0
  const dispose = api.onceDurable(session, 'approval/policy', () => {
    listenerCount += 1
    assert.equal(eventsApi.listeners.length, 0)
  })
  const event = durableEvent('approval/policy', { policy: 'never' }, session.firstLiveSeq)

  eventsApi.emit(session, event)
  eventsApi.emit(session, event)
  assert.equal(listenerCount, 1)
  assert.equal(dispose(), false)
})

test('durable observation argument failures do not subscribe', () => {
  const { api, eventsApi, session } = createDurableApi()
  assertCode('invalid-target-session', () => api.onDurable('session-1', 'approval/policy', () => {}))
  assertCode('unsupported-durable-kind', () => api.onDurable(session, 'user/message', () => {}))
  assertCode('invalid-listener', () => api.onDurable(session, 'approval/policy', null))
  assert.equal(eventsApi.listeners.length, 0)
})

test('seed-boundary and audited-record breaches reset the epoch without delivery', () => {
  const { api, eventsApi, owner, resets, session } = createDurableApi()
  let calls = 0
  api.onDurable(session, 'approval/policy', () => { calls += 1 })
  eventsApi.emit(session, durableEvent('approval/policy', { policy: 'ask' }, session.firstLiveSeq - 1))

  assert.equal(calls, 0)
  assert.equal(resets[0].reason, 'seed-or-invalid-live-seq')
  assert.deepEqual(Object.keys(resets[0]).sort(), ['kind', 'reason', 'seq'])
  assert.equal(owner.isCurrent(), false)

  const state = createDurableApi()
  state.api.onDurable(state.session, 'approval/policy', () => { calls += 1 })
  state.eventsApi.emit(state.session, durableEvent('approval/policy', { policy: 'wrong' }, state.session.firstLiveSeq))
  assert.equal(calls, 0)
  assert.equal(state.resets[0].reason, 'durable-record-contract-breach')
  assert.equal(state.owner.isCurrent(), false)
})

test('hostile session lifecycle event accessors fail closed without leaking payload to reset', () => {
  const { api, eventsApi, resets, session } = createDurableApi()
  api.onDurable(session, 'approval/policy', () => assert.fail('must not deliver'))
  const payload = { secret: 'must not reach reset' }
  const hostile = new Proxy({}, {
    get() {
      throw new Error('hostile event')
    },
  })

  assert.doesNotThrow(() => eventsApi.emit(session, hostile))
  assert.deepEqual(resets, [{ kind: 'approval/policy', seq: undefined, reason: 'durable-record-contract-breach' }])
  assert.equal(Object.values(resets[0]).includes(payload), false)
})

test('durable wrapper leaves raw observer delivery independent and does not contain listener failures', () => {
  const { api, eventsApi, session } = createDurableApi()
  const rawCalls = []
  const rawObserver = (publishedSession, event) => rawCalls.push([publishedSession, event])
  const durableListener = () => { throw new Error('durable listener failure') }
  api.onDurable(session, 'approval/policy', durableListener)
  const event = durableEvent('approval/policy', { policy: 'ask' }, session.firstLiveSeq)

  rawObserver(session, event)
  assert.throws(() => eventsApi.emit(session, event), /durable listener failure/)
  assert.deepEqual(rawCalls, [[session, event]])
})

test('onceDurable survives unrelated records until its first valid matching record', () => {
  const { api, eventsApi, session } = createDurableApi()
  const observed = []
  api.onceDurable(session, 'approval/policy', (event) => observed.push(event))
  eventsApi.emit(session, durableEvent('approval/asked', { id: 'a', toolName: 'x' }, session.firstLiveSeq))
  assert.equal(observed.length, 0)
  eventsApi.emit(session, durableEvent('approval/policy', { policy: 'ask' }, session.firstLiveSeq))
  assert.equal(observed.length, 1)
})

test('stable hub keeps one native entry, contains listener failures, and stops an outer snapshot after nested breach', async () => {
  const { session, sessions } = createLiveSession()
  const eventsApi = createEventsApi()
  const resets = []
  const owner = createDurableEpochRegistrationOwner()
  const hub = createDurableObservationHub({ eventsApi, logger: { warn() {} } })
  const api = createSessionDurableApi({
    Session, sessions, eventsApi, contracts: durableContracts, owner, hub,
    reset(diagnostic) { resets.push(diagnostic) },
  })
  const seen = []
  api.onDurable(session, 'approval/policy', () => {
    seen.push('first')
    eventsApi.emit(session, durableEvent('approval/policy', { policy: 'wrong' }, session.firstLiveSeq))
  })
  api.onDurable(session, 'approval/policy', () => seen.push('must-not-run'))
  api.onceDurable(session, 'approval/asked', () => { throw new Error('contained') })
  api.onDurable(session, 'approval/asked', () => Promise.reject(new Error('contained async')))

  assert.equal(eventsApi.listeners.length, 1)
  eventsApi.emit(session, durableEvent('approval/policy', { policy: 'ask' }, session.firstLiveSeq))
  eventsApi.emit(session, durableEvent('approval/asked', { id: 'a', toolName: 'x' }, session.firstLiveSeq))
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(seen, ['first'])
  assert.equal(resets[0].reason, 'durable-record-contract-breach')
  assert.equal(eventsApi.listeners.length, 1, 'breach must not dispose or reconcile the native hook during dispatch')
})

test('stable hub validates known durable records even without a matching observer, but ignores ordinary session events', () => {
  const makeActiveHub = () => {
    const { session, sessions } = createLiveSession()
    const eventsApi = createEventsApi()
    const resets = []
    const owner = createDurableEpochRegistrationOwner()
    const hub = createDurableObservationHub({ eventsApi })
    const api = createSessionDurableApi({
      Session, sessions, eventsApi, contracts: durableContracts, owner, hub,
      reset(diagnostic) { resets.push(diagnostic) },
    })
    return { session, eventsApi, resets, api }
  }

  const malformed = makeActiveHub()
  malformed.api.onDurable(malformed.session, 'approval/policy', () => assert.fail('wrong kind must not deliver'))
  malformed.eventsApi.emit(malformed.session, durableEvent('approval/asked', { id: 1, toolName: 'x' }, malformed.session.firstLiveSeq))
  assert.deepEqual(malformed.resets, [{ kind: 'approval/asked', seq: malformed.session.firstLiveSeq, reason: 'durable-record-contract-breach' }])

  const ordinary = makeActiveHub()
  ordinary.eventsApi.emit(ordinary.session, Object.freeze({ type: 'user/message', seq: ordinary.session.firstLiveSeq, time: 0, data: {} }))
  assert.deepEqual(ordinary.resets, [])
})

test('stable hub separates infallible state close, epoch disposal, and final native release', () => {
  const order = []
  const eventsApi = {
    on() { return () => { order.push('native') } },
  }
  const hub = createDurableObservationHub({ eventsApi })
  const epoch = hub.attachEpoch({ owner: { close() { order.push('epoch'); throw new Error('contained') } } })
  assert.equal(hub.closeState(), epoch)
  assert.equal(hub.isClosed, true)
  assert.deepEqual(order, [])
  assert.doesNotThrow(() => hub.disposeEpoch(epoch))
  assert.deepEqual(order, ['epoch'])
  assert.doesNotThrow(() => hub.releaseNative())
  assert.deepEqual(order, ['epoch', 'native'])
  assert.equal(hub.closeState(), null)
})

test('stable hub releases a throwing native disposer at most once', () => {
  let calls = 0
  const hub = createDurableObservationHub({ eventsApi: { on() { return () => { calls += 1; throw new Error('native') } } } })
  assert.equal(hub.releaseNative(), true)
  assert.equal(hub.releaseNative(), false)
  assert.equal(hub.close(), true)
  assert.equal(calls, 1)
})

test('direct official malformed durable append publishes raw but resets durable without payload diagnostics', () => {
  const ctx = new Context()
  new SessionStore(ctx)
  const session = ctx.sessions.create('official-live')
  const eventsApi = {
    on(name, listener) {
      return ctx.on(name, listener)
    },
  }
  const owner = createDurableEpochRegistrationOwner()
  const resets = []
  const api = createSessionDurableApi({
    Session,
    sessions: ctx.sessions,
    eventsApi,
    contracts: durableContracts,
    owner,
    reset(diagnostic) {
      resets.push(diagnostic)
      owner.close()
    },
  })
  const rawSeen = []
  ctx.on('session/event', (publishedSession, event) => rawSeen.push([publishedSession, event]))
  api.onDurable(session, 'approval/policy', () => assert.fail('malformed raw durable record must not deliver'))

  const record = session.append('approval/policy', { policy: 'bad' })

  assert.equal(rawSeen.length, 1)
  assert.equal(rawSeen[0][1], record)
  assert.deepEqual(resets, [{ kind: 'approval/policy', seq: record.seq, reason: 'durable-record-contract-breach' }])
  assert.equal(owner.isCurrent(), false)
  assert.equal(JSON.stringify(resets).includes('bad'), false)
})

test('a seeded live child does not replay durable seed records to a new observer', () => {
  const ctx = new Context()
  new SessionStore(ctx)
  const seed = [
    { type: 'approval/policy', seq: 0, time: 0, data: { policy: 'ask' } },
    { type: 'subagent/descriptor', seq: 1, time: 1, data: { version: 2, mode: 'continuable', provider: 'in-process', label: 'child' } },
  ]
  const child = ctx.sessions.create('seeded-child', { seed })
  const eventsApi = { on(name, listener) { return ctx.on(name, listener) } }
  const owner = createDurableEpochRegistrationOwner()
  const seen = []
  const api = createSessionDurableApi({
    Session,
    sessions: ctx.sessions,
    eventsApi,
    contracts: durableContracts,
    owner,
    reset() { owner.close() },
  })

  api.onDurable(child, 'approval/policy', (event) => seen.push(event))
  assert.equal(child.firstLiveSeq, 2)
  assert.deepEqual(seen, [])
  child.append('approval/policy', { policy: 'never' })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].seq >= child.firstLiveSeq, true)
})

test('cataloged session lifecycle containment isolates durable listener throws and rejections', async () => {
  const ctx = new Context()
  ctx.provide('logger', { warn() {} })
  new SessionStore(ctx)
  const eventsApi = createEventsBus({ ctx, catalog: sessionLifecycleEventsCatalog })
  const session = ctx.sessions.create('contained-listener')
  const owner = createDurableEpochRegistrationOwner()
  const api = createSessionDurableApi({
    Session,
    sessions: ctx.sessions,
    eventsApi,
    contracts: durableContracts,
    owner,
    reset() { owner.close() },
  })
  let laterCalls = 0
  const rawSeen = []
  ctx.on('session/event', (_session, event) => rawSeen.push(event))
  api.onDurable(session, 'approval/policy', () => { throw new Error('sync listener failure') })
  api.onDurable(session, 'approval/policy', () => Promise.reject(new Error('async listener failure')))
  api.onDurable(session, 'approval/policy', () => { laterCalls += 1 })

  const record = session.append('approval/policy', { policy: 'ask' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(rawSeen[0], record)
  assert.equal(laterCalls, 1)
})

test('appendMessage makes one official append for every permitted finite message shape', () => {
  const ctx = new Context()
  new SessionStore(ctx)
  const session = ctx.sessions.create('append-message-success')
  const dependencies = { Session, sessions: ctx.sessions, contracts: durableContracts }
  const officialAppend = session.append
  let appendCalls = 0
  session.append = function appendSpy(...args) {
    appendCalls += 1
    return officialAppend.apply(this, args)
  }
  const seed = session.append('approval/policy', { policy: 'ask' })
  const user = { id: 'u', role: 'user', content: [{ type: 'text', text: 'user' }], source: { kind: 'user' } }
  let eventsBefore = session.events
  let surfaceBefore = { nodes: [...session.surface.nodes], replaceGeneration: session.surface.replaceGeneration }
  const userRecord = appendMessage(session, 'user/message', user, undefined, dependencies)
  assert.equal(appendCalls, 2)
  assertHistoryPreserved(session, eventsBefore, surfaceBefore)
  user.content[0].text = 'mutated-user'
  assert.equal(userRecord.data.content[0].text, 'user')
  assert.equal(userRecord.type, 'user/message')
  assert.deepEqual(userRecord.surfaceOp, 'append')
  assert.equal(userRecord.data.id, 'u')

  const assistant = {
    turn: 1, step: 1,
    message: { id: 'a', role: 'assistant', content: [{ type: 'text', text: 'assistant' }], source: { kind: 'model', provider: 'p', model: 'm' } },
  }
  eventsBefore = session.events
  surfaceBefore = { nodes: [...session.surface.nodes], replaceGeneration: session.surface.replaceGeneration }
  const assistantRecord = appendMessage(session, 'assistant/message', assistant, undefined, dependencies)
  assert.equal(appendCalls, 3)
  assertHistoryPreserved(session, eventsBefore, surfaceBefore)
  assistant.message.content[0].text = 'mutated-assistant'
  assert.equal(assistantRecord.data.message.content[0].text, 'assistant')
  assert.deepEqual(assistantRecord.sourceEventSeqs, [])

  const chunk = session.append('assistant/chunk', { turn: 2, step: 1, delta: { type: 'text', text: 'chunk' } })
  const sourcedAssistant = {
    turn: 2, step: 1,
    message: { id: 'a-sourced', role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } },
  }
  eventsBefore = session.events
  surfaceBefore = { nodes: [...session.surface.nodes], replaceGeneration: session.surface.replaceGeneration }
  const sourcedAssistantRecord = appendMessage(session, 'assistant/message', sourcedAssistant, { sourceEventSeqs: [chunk.seq] }, dependencies)
  assert.equal(appendCalls, 5)
  assertHistoryPreserved(session, eventsBefore, surfaceBefore)
  assert.deepEqual(sourcedAssistantRecord.sourceEventSeqs, [chunk.seq])

  const call = session.append('tool/call', { turn: 2, step: 1, callId: 'call-1', name: 'example', arguments: {} })
  const tool = {
    turn: 2, step: 1,
    message: { id: 'r', role: 'user', source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'tool-result', toolCallId: 'call-1', content: [] }] },
  }
  eventsBefore = session.events
  surfaceBefore = { nodes: [...session.surface.nodes], replaceGeneration: session.surface.replaceGeneration }
  const toolRecord = appendMessage(session, 'tool/result', tool, { sourceEventSeqs: [call.seq] }, dependencies)
  assert.equal(appendCalls, 7)
  assertHistoryPreserved(session, eventsBefore, surfaceBefore)
  tool.message.content[0].content.push({ type: 'text', text: 'mutated-tool' })
  assert.deepEqual(toolRecord.data.message.content[0].content, [])
  assert.deepEqual(toolRecord.sourceEventSeqs, [call.seq])
  const derivedTool = session.append('tool/call', { turn: 3, step: 1, callId: 'call-2', name: 'derived', arguments: {} })
  eventsBefore = session.events
  surfaceBefore = { nodes: [...session.surface.nodes], replaceGeneration: session.surface.replaceGeneration }
  const derivedToolRecord = appendMessage(session, 'tool/result', {
    turn: 3, step: 1,
    message: { id: 'r-derived', role: 'user', source: { kind: 'tool', callId: 'call-2' }, content: [{ type: 'tool-result', toolCallId: 'call-2', content: [] }] },
  }, undefined, dependencies)
  assert.equal(appendCalls, 9)
  assertHistoryPreserved(session, eventsBefore, surfaceBefore)
  assert.deepEqual(derivedToolRecord.sourceEventSeqs, [derivedTool.seq])
  assert.equal(Object.isFrozen(derivedToolRecord), true)
  assert.deepEqual(session.surface.nodes, [userRecord.seq, assistantRecord.seq, sourcedAssistantRecord.seq, toolRecord.seq, derivedToolRecord.seq])
})

test('appendMessage snapshots input and delegates only one official write after preflight', () => {
  const { session, sessions } = createLiveSession('append-message-one-write')
  const originalAppend = session.append
  let calls = 0
  let received
  session.append = function appendSpy(...args) {
    calls += 1
    received = args
    return originalAppend.apply(this, args)
  }
  const payload = { id: 'u', role: 'user', content: [{ type: 'text', text: 'before' }], source: { kind: 'user' } }
  const record = appendMessage(session, 'user/message', payload, undefined, { Session, sessions, contracts: durableContracts })
  payload.content[0].text = 'after'
  assert.equal(calls, 1)
  assert.equal(received[0], 'user/message')
  assert.deepEqual(received[2], { surfaceOp: 'append' })
  assert.equal(record.data.content[0].text, 'before')
  assert.equal(session.events.length, 1)
})

test('appendMessage propagates official errors unchanged and never writes after failed preflight', () => {
  const { session, sessions } = createLiveSession('append-message-errors')
  const dependencies = { Session, sessions, contracts: durableContracts }
  let calls = 0
  const officialError = new Error('official append failure')
  session.append = () => { calls += 1; throw officialError }
  assert.throws(
    () => appendMessage(session, 'user/message', { id: 'u', role: 'user', content: [], source: { kind: 'user' } }, undefined, dependencies),
    (error) => error === officialError,
  )
  assert.equal(calls, 1)
  assertCode('non-json-payload', () => appendMessage(session, 'user/message', { id: '', role: 'user', content: [], source: { kind: 'user' } }, undefined, dependencies))
  assert.equal(calls, 1)
})

test('appendMessage preserves the official observer reentry guard unchanged', () => {
  const captureReentry = (invokeNested, invokeOuter) => {
    const ctx = new Context()
    new SessionStore(ctx)
    const session = ctx.sessions.create('append-message-reentry')
    let reentryError
    ctx.on('session/event', () => {
      try {
        invokeNested(session, ctx.sessions)
      } catch (error) {
        reentryError = error
      }
    })
    const eventsBefore = session.events
    const surfaceBefore = [...session.surface.nodes]
    const outer = invokeOuter(session, ctx.sessions)
    return { eventsBefore, outer, reentryError, session, surfaceBefore }
  }
  const direct = captureReentry(
    (session) => session.append('user/message', { id: 'nested', role: 'user', content: [], source: { kind: 'user' } }, { surfaceOp: 'append' }),
    (session) => session.append('user/message', { id: 'outer', role: 'user', content: [], source: { kind: 'user' } }, { surfaceOp: 'append' }),
  )
  const throughHelper = captureReentry(
    (session, sessions) => appendMessage(session, 'user/message', { id: 'nested', role: 'user', content: [], source: { kind: 'user' } }, undefined, { Session, sessions, contracts: durableContracts }),
    (session, sessions) => appendMessage(session, 'user/message', { id: 'outer', role: 'user', content: [], source: { kind: 'user' } }, undefined, { Session, sessions, contracts: durableContracts }),
  )
  assert.equal(direct.outer.type, 'user/message')
  assert.equal(throughHelper.outer.type, 'user/message')
  assert.equal(throughHelper.reentryError?.constructor, direct.reentryError?.constructor)
  assert.equal(throughHelper.reentryError?.message, direct.reentryError?.message)
  assert.equal(throughHelper.reentryError?.code, direct.reentryError?.code)
  assert.equal(direct.session.events.length, 1)
  assert.equal(throughHelper.session.events.length, 1)
  assert.deepEqual([...direct.session.surface.nodes], [direct.outer.seq])
  assert.deepEqual([...throughHelper.session.surface.nodes], [throughHelper.outer.seq])
})

test('preflight materializes exactly one detached payload snapshot and builds finite intents', () => {
  const { session } = createLiveSession()
  let snapshots = 0
  const contracts = {
    ...durableContracts,
    snapshotJsonValue(payload) {
      snapshots += 1
      return structuredClone(payload)
    },
  }
  const user = {
    id: 'user-1',
    role: 'user',
    content: [{ type: 'text', text: 'hello' }],
    source: { kind: 'user' },
  }
  const result = preflightSurfaceMessageAppend(session, 'user/message', user, undefined, contracts)
  assert.deepEqual(result.intent, { surfaceOp: 'append' })
  assert.notEqual(result.payload, user)
  assert.equal(snapshots, 1)

  const assistant = preflightSurfaceMessageAppend(session, 'assistant/message', {
    turn: 1,
    step: 1,
    message: { id: 'assistant-1', role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } },
  }, undefined, contracts)
  assert.deepEqual(assistant.intent, { surfaceOp: 'append', sourceEventSeqs: [] })

  let getterReads = 0
  const borrowed = { role: 'user', content: [], source: { kind: 'user' } }
  Object.defineProperty(borrowed, 'id', {
    enumerable: true,
    get() {
      getterReads += 1
      if (getterReads > 1) throw new Error('borrowed payload reread')
      return 'getter-user'
    },
  })
  const getterResult = preflightSurfaceMessageAppend(session, 'user/message', borrowed, undefined, contracts)
  assert.equal(getterResult.payload.id, 'getter-user')
  assert.equal(getterReads, 1)
})

test('preflight reads exactly one events snapshot for assistant and tool provenance', () => {
  const assistantPayload = {
    turn: 1, step: 1,
    message: { id: 'a', role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } },
  }
  const toolPayload = {
    turn: 1, step: 1,
    message: { id: 'r', role: 'user', source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'tool-result', toolCallId: 'call-1', content: [] }] },
  }
  for (const [kind, payload, options, events] of [
    ['assistant/message', assistantPayload, { sourceEventSeqs: [0] }, [{ type: 'assistant/chunk', seq: 0, data: { turn: 1, step: 1 } }]],
    ['tool/result', toolPayload, undefined, [{ type: 'tool/call', seq: 0, data: { turn: 1, step: 1, callId: 'call-1' } }]],
  ]) {
    const { session } = createLiveSession(`snapshot-${kind}`)
    let reads = 0
    Object.defineProperty(session, 'events', { get() { reads += 1; return events } })
    preflightSurfaceMessageAppend(session, kind, payload, options, durableContracts)
    assert.equal(reads, 1)
  }
})

test('preflight validates narrow options and finite provenance relations without writing', () => {
  const { session } = createLiveSession()
  const events = [
    { type: 'assistant/chunk', seq: 0, data: { turn: 1, step: 1 } },
    { type: 'tool/call', seq: 1, data: { turn: 1, step: 1, callId: 'call-1' } },
  ]
  Object.defineProperty(session, 'events', { value: events })
  const assistantPayload = {
    turn: 1, step: 1,
    message: { id: 'assistant-1', role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } },
  }
  assert.deepEqual(
    preflightSurfaceMessageAppend(session, 'assistant/message', assistantPayload, { sourceEventSeqs: [0] }, durableContracts).intent,
    { surfaceOp: 'append', sourceEventSeqs: [0] },
  )
  const toolPayload = {
    turn: 1, step: 1,
    message: {
      id: 'result-1', role: 'user', source: { kind: 'tool', callId: 'call-1' },
      content: [{ type: 'tool-result', toolCallId: 'call-1', content: [] }],
    },
  }
  assert.deepEqual(
    preflightSurfaceMessageAppend(session, 'tool/result', toolPayload, undefined, durableContracts).intent,
    { surfaceOp: 'append', sourceEventSeqs: [1] },
  )
  assertCode('invalid-options', () => preflightSurfaceMessageAppend(session, 'user/message', { id: 'u', role: 'user', content: [], source: { kind: 'user' } }, { other: true }, durableContracts))
  assertCode('invalid-source-event-seqs', () => preflightSurfaceMessageAppend(session, 'assistant/message', assistantPayload, { sourceEventSeqs: [2, 2] }, durableContracts))
  assertCode('invalid-source-event-seqs', () => preflightSurfaceMessageAppend(session, 'tool/result', toolPayload, { sourceEventSeqs: [2] }, durableContracts))
})

test('preflight fails closed for unsupported, non-json, malformed, and ambiguous input', () => {
  const { session } = createLiveSession()
  const validUser = { id: 'u', role: 'user', content: [], source: { kind: 'user' } }
  assertCode('unsupported-surface-message-kind', () => preflightSurfaceMessageAppend(session, 'tool/call', validUser, undefined, durableContracts))
  assertCode('non-json-payload', () => preflightSurfaceMessageAppend(session, 'user/message', undefined, undefined, durableContracts))
  assertCode('non-json-payload', () => preflightSurfaceMessageAppend(session, 'user/message', { ...validUser, id: '' }, undefined, durableContracts))
  assertCode('invalid-source-event-seqs', () => preflightSurfaceMessageAppend(session, 'user/message', validUser, { sourceEventSeqs: [] }, durableContracts))
})

test('preflight rejects hostile payload and option shapes without reading user events', () => {
  const { session } = createLiveSession()
  const user = { id: 'u', role: 'user', content: [], source: { kind: 'user' } }
  let eventReads = 0
  Object.defineProperty(session, 'events', {
    get() {
      eventReads += 1
      throw new Error('user messages must not inspect history')
    },
  })
  assert.deepEqual(
    preflightSurfaceMessageAppend(session, 'user/message', user, undefined, durableContracts).intent,
    { surfaceOp: 'append' },
  )
  assert.equal(eventReads, 0)

  const cyclic = { ...user, content: [] }
  cyclic.content.push(cyclic)
  assertCode('non-json-payload', () => preflightSurfaceMessageAppend(session, 'user/message', cyclic, undefined, durableContracts))
  assertCode('non-json-payload', () => preflightSurfaceMessageAppend(session, 'user/message', new Date(), undefined, durableContracts))

  const hidden = { ...user }
  Object.defineProperty(hidden, 'hidden', { value: true })
  assertCode('non-json-payload', () => preflightSurfaceMessageAppend(session, 'user/message', hidden, undefined, durableContracts))

  const symbolOptions = { sourceEventSeqs: [] }
  symbolOptions[Symbol('unexpected')] = true
  assertCode('invalid-options', () => preflightSurfaceMessageAppend(session, 'user/message', user, symbolOptions, durableContracts))
  const throwingOptions = {}
  Object.defineProperty(throwingOptions, 'sourceEventSeqs', { enumerable: true, get() { throw new Error('hostile option') } })
  assertCode('invalid-options', () => preflightSurfaceMessageAppend(session, 'user/message', user, throwingOptions, durableContracts))

  Object.defineProperty(Object.prototype, 'sourceEventSeqs', { configurable: true, value: [0] })
  try {
    assert.deepEqual(
      preflightSurfaceMessageAppend(session, 'user/message', user, {}, durableContracts).intent,
      { surfaceOp: 'append' },
    )
  } finally {
    delete Object.prototype.sourceEventSeqs
  }
})

test('preflight rejects malformed envelopes and every ambiguous provenance relation without writes', () => {
  const { session } = createLiveSession()
  let appends = 0
  session.append = () => { appends += 1 }
  const assistantPayload = {
    turn: 1, step: 1,
    message: { id: 'a', role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } },
  }
  const toolPayload = {
    turn: 1, step: 1,
    message: { id: 'r', role: 'user', source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'tool-result', toolCallId: 'call-1', content: [] }] },
  }
  Object.defineProperty(session, 'events', { value: [
    { type: 'assistant/chunk', seq: 0, data: { turn: 1, step: 1 } },
    { type: 'assistant/chunk', seq: 1, data: { turn: 1, step: 1 } },
    { type: 'tool/call', seq: 2, data: { turn: 1, step: 1, callId: 'call-1' } },
    { type: 'tool/call', seq: 3, data: { turn: 1, step: 1, callId: 'call-1' } },
  ] })

  assertCode('non-json-payload', () => preflightSurfaceMessageAppend(session, 'assistant/message', { ...assistantPayload, usage: undefined }, undefined, durableContracts))
  assertCode('non-json-payload', () => preflightSurfaceMessageAppend(session, 'tool/result', { ...toolPayload, error: { name: '', code: 'bad' } }, undefined, durableContracts))
  assertCode('non-json-payload', () => preflightSurfaceMessageAppend(session, 'tool/result', { ...toolPayload, message: { ...toolPayload.message, content: [] } }, undefined, durableContracts))
  assertCode('indeterminate-source-event-seqs', () => preflightSurfaceMessageAppend(session, 'assistant/message', assistantPayload, undefined, durableContracts))
  assertCode('indeterminate-source-event-seqs', () => preflightSurfaceMessageAppend(session, 'tool/result', toolPayload, undefined, durableContracts))
  assertCode('indeterminate-source-event-seqs', () => preflightSurfaceMessageAppend(session, 'assistant/message', assistantPayload, { sourceEventSeqs: [2] }, durableContracts))
  assertCode('invalid-source-event-seqs', () => preflightSurfaceMessageAppend(session, 'assistant/message', assistantPayload, { sourceEventSeqs: [0, 0] }, durableContracts))
  assertCode('invalid-source-event-seqs', () => preflightSurfaceMessageAppend(session, 'assistant/message', assistantPayload, { sourceEventSeqs: [1, 0] }, durableContracts))
  assertCode('invalid-source-event-seqs', () => preflightSurfaceMessageAppend(session, 'assistant/message', assistantPayload, { sourceEventSeqs: [0, , 1] }, durableContracts))
  assertCode('invalid-source-event-seqs', () => preflightSurfaceMessageAppend(session, 'tool/result', toolPayload, { sourceEventSeqs: [4] }, durableContracts))
  assertCode('indeterminate-source-event-seqs', () => preflightSurfaceMessageAppend(session, 'tool/result', toolPayload, { sourceEventSeqs: [0] }, durableContracts))
  assert.equal(appends, 0)
})

test('preflight distinguishes zero-candidate derivation from explicit unprovable sources', () => {
  const { session } = createLiveSession()
  const assistantPayload = {
    turn: 1, step: 1,
    message: { id: 'a', role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } },
  }
  const toolPayload = {
    turn: 1, step: 1,
    message: { id: 'r', role: 'user', source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'tool-result', toolCallId: 'call-1', content: [] }] },
  }
  Object.defineProperty(session, 'events', { value: [{ type: 'approval/policy', seq: 0, data: { policy: 'ask' } }] })

  assert.deepEqual(
    preflightSurfaceMessageAppend(session, 'assistant/message', assistantPayload, undefined, durableContracts).intent,
    { surfaceOp: 'append', sourceEventSeqs: [] },
  )
  assertCode('indeterminate-source-event-seqs', () => preflightSurfaceMessageAppend(session, 'assistant/message', assistantPayload, { sourceEventSeqs: [0] }, durableContracts))
  assertCode('indeterminate-source-event-seqs', () => preflightSurfaceMessageAppend(session, 'tool/result', toolPayload, undefined, durableContracts))
})

test('every preflight rejection leaves official log and surface unchanged', () => {
  const user = { id: 'u', role: 'user', content: [], source: { kind: 'user' } }
  const assistant = {
    turn: 1, step: 1,
    message: { id: 'a', role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } },
  }
  const tool = {
    turn: 1, step: 1,
    message: { id: 'r', role: 'user', source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'tool-result', toolCallId: 'call-1', content: [] }] },
  }
  const cyclic = { ...user, content: [] }
  cyclic.content.push(cyclic)
  const throwingPayload = { role: 'user', content: [], source: { kind: 'user' } }
  Object.defineProperty(throwingPayload, 'id', { enumerable: true, get() { throw new Error('hostile payload') } })
  const cases = [
    ['unsupported-surface-message-kind', 'other/message', user, undefined],
    ['non-json-payload', 'user/message', cyclic, undefined],
    ['non-json-payload', 'user/message', throwingPayload, undefined],
    ['non-json-payload', 'assistant/message', { ...assistant, usage: undefined }, undefined],
    ['invalid-options', 'user/message', user, { unexpected: true }],
    ['invalid-source-event-seqs', 'user/message', user, { sourceEventSeqs: [] }],
    ['invalid-source-event-seqs', 'assistant/message', assistant, { sourceEventSeqs: [0, 0] }],
    ['invalid-source-event-seqs', 'assistant/message', assistant, { sourceEventSeqs: [1, 0] }],
    ['invalid-source-event-seqs', 'assistant/message', assistant, { sourceEventSeqs: [0, , 1] }],
    ['indeterminate-source-event-seqs', 'assistant/message', assistant, { sourceEventSeqs: [0] }],
    ['indeterminate-source-event-seqs', 'tool/result', tool, undefined],
    ['indeterminate-source-event-seqs', 'tool/result', tool, { sourceEventSeqs: [0] }],
  ]
  for (const [code, kind, payload, options] of cases) {
    const ctx = new Context()
    new SessionStore(ctx)
    const session = ctx.sessions.create(`preflight-no-write-${kind}-${code}`)
    session.append('approval/policy', { policy: 'ask' })
    const eventsBefore = session.events
    const surfaceBefore = { nodes: [...session.surface.nodes], replaceGeneration: session.surface.replaceGeneration }
    assertCode(code, () => preflightSurfaceMessageAppend(session, kind, payload, options, durableContracts))
    assert.equal(session.events, eventsBefore)
    assert.deepEqual(
      { nodes: [...session.surface.nodes], replaceGeneration: session.surface.replaceGeneration },
      surfaceBefore,
    )
  }
})

test('preflight contains hostile history inspection with payload-free diagnostics', () => {
  const { session } = createLiveSession()
  const warnings = []
  const payload = {
    turn: 1, step: 1,
    message: { id: 'a', role: 'assistant', content: [], source: { kind: 'model', provider: 'secret-provider', model: 'secret-model' } },
  }
  Object.defineProperty(session, 'events', { get() { throw new Error('hostile history') } })
  assertCode('indeterminate-source-event-seqs', () => preflightSurfaceMessageAppend(session, 'assistant/message', payload, undefined, durableContracts, { warn(message) { warnings.push(message) } }))
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].includes('secret-provider'), false)
  assert.equal(warnings[0].includes('secret-model'), false)
  assertCode('indeterminate-source-event-seqs', () => preflightSurfaceMessageAppend(session, 'assistant/message', payload, undefined, durableContracts, { warn() { throw new Error('logger failure') } }))
})
