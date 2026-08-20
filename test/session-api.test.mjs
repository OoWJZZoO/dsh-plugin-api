import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionApi, mountSessionFeature } from '../lib/session-feature.js'
import { SESSION_LIFECYCLE_EVENT_NAMES } from '../lib/session-events-catalog.js'

function createMockSession() {
  const internalNodes = [1, 2, 3]
  const requestHeaderValue = Object.freeze({ config: { provider: 'p', model: 'm' } })
  const requestContextValue = Object.freeze({ provider: 'p', model: 'm' })
  return {
    header: Object.freeze({ id: 's1' }),
    events: Object.freeze([{ type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } }]),
    seq: 1,
    surface: {
      nodes: internalNodes,
      replaceGeneration: 2,
    },
    requestHeader() {
      return requestHeaderValue
    },
    requestContext() {
      return requestContextValue
    },
    deriveMessages() {
      return [{ role: 'user', content: 'hello' }]
    },
  }
}

function createMocks() {
  const rawCalls = []
  const rawOnceCalls = []
  const delegated = []
  const delegatedOnce = []
  const onDisposer = () => true
  const onceDisposer = () => true
  const eventsApi = {
    on(name, listener, opts) {
      delegated.push({ name, listener, opts })
      return onDisposer
    },
    once(name, listener, opts) {
      delegatedOnce.push({ name, listener, opts })
      return onceDisposer
    },
  }

  const session = createMockSession()
  const forkError = new Error('fork boom')
  const forkCalls = []
  const sessions = {
    get(id) {
      return id === 's1' ? session : undefined
    },
    list() {
      return [session]
    },
    fork(source, boundary, childSessionId) {
      forkCalls.push({ source, boundary, childSessionId })
      if (source === 'bad') throw forkError
      return { id: 'child' }
    },
  }

  const ctx = {
    get(name) {
      return name === 'sessions' ? sessions : undefined
    },
    on(name, listener) {
      rawCalls.push({ name, listener })
      return () => false
    },
    once(name, listener) {
      rawOnceCalls.push({ name, listener })
      return () => false
    },
  }

  return {
    ctx,
    eventsApi,
    sessions,
    session,
    forkError,
    forkCalls,
    rawCalls,
    rawOnceCalls,
    delegated,
    delegatedOnce,
    onDisposer,
    onceDisposer,
  }
}

test('session lifecycle: lifecycle names delegate to pluginApi.events.on/once and return its disposer', () => {
  const mocks = createMocks()
  const api = createSessionApi({
    ctx: mocks.ctx,
    sessions: mocks.sessions,
    eventsApi: mocks.eventsApi,
    dshSession: { knownSessionEventTypes: new Set(), isSurfaceEligibleType: () => false },
  })

  const listener = () => {}
  for (const name of SESSION_LIFECYCLE_EVENT_NAMES) {
    const opts = { priority: 'high' }
    assert.equal(api.on(name, listener, opts), mocks.onDisposer)
  }
  assert.equal(mocks.delegated.length, 4)
  assert.deepEqual(mocks.delegated.map((call) => call.name), [...SESSION_LIFECYCLE_EVENT_NAMES])
  for (const call of mocks.delegated) {
    assert.equal(call.listener, listener)
    assert.deepEqual(call.opts, { priority: 'high' })
  }

  const onceListener = () => {}
  for (const name of SESSION_LIFECYCLE_EVENT_NAMES) {
    assert.equal(api.once(name, onceListener, { priority: 'low' }), mocks.onceDisposer)
  }
  assert.equal(mocks.delegatedOnce.length, 4)
  assert.deepEqual(mocks.delegatedOnce.map((call) => call.name), [...SESSION_LIFECYCLE_EVENT_NAMES])
})

test('session lifecycle: non-lifecycle names pass through to ctx.on/ctx.once raw and ignore opts', () => {
  const mocks = createMocks()
  const api = createSessionApi({
    ctx: mocks.ctx,
    sessions: mocks.sessions,
    eventsApi: mocks.eventsApi,
    dshSession: { knownSessionEventTypes: new Set(), isSurfaceEligibleType: () => false },
  })

  const listener = () => {}
  api.on('goal/changed', listener, { priority: 'high' })
  assert.equal(mocks.delegated.length, 0)
  assert.equal(mocks.rawCalls.length, 1)
  assert.equal(mocks.rawCalls[0].name, 'goal/changed')
  assert.equal(mocks.rawCalls[0].listener, listener)

  const onceListener = () => {}
  api.once('skills/change', onceListener, { priority: 'low' })
  assert.equal(mocks.delegatedOnce.length, 0)
  assert.equal(mocks.rawOnceCalls.length, 1)
  assert.equal(mocks.rawOnceCalls[0].name, 'skills/change')
  assert.equal(mocks.rawOnceCalls[0].listener, onceListener)
})

test('session read surface: get/list/fork delegate to the sessions service with arguments and errors unchanged', () => {
  const mocks = createMocks()
  const api = createSessionApi({
    ctx: mocks.ctx,
    sessions: mocks.sessions,
    eventsApi: mocks.eventsApi,
    dshSession: { knownSessionEventTypes: new Set(), isSurfaceEligibleType: () => false },
  })

  assert.equal(api.get('s1'), mocks.session)
  assert.equal(api.get('missing'), undefined)
  assert.deepEqual(api.list(), [mocks.session])

  const source = { id: 'src' }
  const child = api.fork(source, 3, undefined)
  assert.deepEqual(child, { id: 'child' })
  assert.equal(mocks.forkCalls.length, 1)
  assert.equal(mocks.forkCalls[0].source, source)
  assert.equal(mocks.forkCalls[0].boundary, 3)
  assert.equal(mocks.forkCalls[0].childSessionId, undefined)

  assert.throws(() => api.fork('bad'), (error) => error === mocks.forkError)
})

test('read-only state accessors: read-only accessors return frozen snapshots without mutating the session', () => {
  const mocks = createMocks()
  const api = createSessionApi({
    ctx: mocks.ctx,
    sessions: mocks.sessions,
    eventsApi: mocks.eventsApi,
    dshSession: { knownSessionEventTypes: new Set(), isSurfaceEligibleType: () => false },
  })
  const session = mocks.session

  assert.equal(api.header(session), session.header)
  assert.equal(api.events(session), session.events)
  assert.equal(api.seq(session), 1)
  assert.equal(api.requestHeader(session), session.requestHeader())
  assert.equal(api.requestContext(session), session.requestContext())

  const surface = api.surface(session)
  assert.deepEqual(surface.nodes, [1, 2, 3])
  assert.equal(surface.replaceGeneration, 2)
  assert.ok(Object.isFrozen(surface), 'surface snapshot must be frozen')
  assert.ok(Object.isFrozen(surface.nodes), 'surface nodes snapshot must be frozen')
  assert.throws(() => surface.nodes.push(999), TypeError)
  assert.deepEqual(session.surface.nodes, [1, 2, 3], 'internal surface nodes must not be mutated')

  const messages = api.deriveMessages(session)
  assert.deepEqual(messages, [{ role: 'user', content: 'hello' }])
  assert.ok(Object.isFrozen(messages), 'deriveMessages array must be frozen')
  assert.ok(Object.isFrozen(messages[0]), 'deriveMessages entries must be frozen')
})

test('session type catalogs: catalogs and type guards come from createSessionTypeCatalogs; invalid input degrades with warn', () => {
  const mocks = createMocks()
  const logger = { warns: [], warn(message) { this.warns.push(message) } }
  const api = createSessionApi({
    ctx: mocks.ctx,
    sessions: mocks.sessions,
    eventsApi: mocks.eventsApi,
    dshSession: {
      knownSessionEventTypes: new Set(['session/end-seed', 'session/title', 'user/message']),
      isSurfaceEligibleType: (type) => type === 'user/message',
    },
    logger,
  })

  assert.deepEqual(api.sessionEventTypes, ['session/end-seed', 'session/title', 'user/message'])
  assert.deepEqual(api.surfaceEventTypes, ['user/message'])
  assert.equal(api.isSessionEventType('session/title'), true)
  assert.equal(api.isSessionEventType('turn/start'), false)
  assert.equal(api.isSurfaceEventType('user/message'), true)
  assert.equal(api.isSurfaceEventType('session/title'), false)

  const degraded = createSessionApi({
    ctx: mocks.ctx,
    sessions: mocks.sessions,
    eventsApi: mocks.eventsApi,
    dshSession: null,
    logger,
  })
  assert.deepEqual(degraded.sessionEventTypes, [])
  assert.deepEqual(degraded.surfaceEventTypes, [])
  assert.equal(degraded.isSessionEventType('session/title'), false)
  assert.equal(degraded.isSurfaceEventType('user/message'), false)
  assert.ok(logger.warns.length >= 1)
})

test('mountSessionFeature returns null when dependencies are missing and mounts when active', () => {
  const mocks = createMocks()

  const serviceMissingEvents = {
    session: undefined,
    events: undefined,
    features: [{ name: 'events', isActive: true }],
    mountFeature() {
      throw new Error('must not mount')
    },
  }
  assert.equal(
    mountSessionFeature({ ctx: mocks.ctx, service: serviceMissingEvents }),
    null,
  )

  const serviceEventsNotActive = {
    session: undefined,
    events: mocks.eventsApi,
    features: [{ name: 'events', isActive: false }],
    mountFeature() {
      throw new Error('must not mount')
    },
  }
  assert.equal(
    mountSessionFeature({ ctx: mocks.ctx, service: serviceEventsNotActive }),
    null,
  )

  const mounted = []
  const service = {
    session: undefined,
    events: mocks.eventsApi,
    features: [{ name: 'events', isActive: true }],
    mountFeature(name, api) {
      mounted.push({ name, api })
    },
  }
  const disposer = mountSessionFeature({ ctx: mocks.ctx, service })
  assert.equal(typeof disposer, 'function')
  assert.equal(mounted.length, 1)
  assert.equal(mounted[0].name, 'session')
  assert.equal(mounted[0].api.isActive, true)
})
