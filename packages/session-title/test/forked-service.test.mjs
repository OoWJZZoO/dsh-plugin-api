import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionTitleService, fallbackSessionTitle } from '../lib/forked-service.js'

// ---------------------------------------------------------------------------
// Fake Cordis harness for the vendored fork. Dispatch mode mirrors
// Cordis waterfall: listeners run outermost-first and Short-circuit when a
// listener returns without calling next(). The fake effect() bridge steps
// generator effects and collects every yielded disposable (matching cordis).
// ---------------------------------------------------------------------------

const flush = () => new Promise((resolve) => setImmediate(resolve))

function makeContext({ agents } = {}) {
  const listeners = new Map()
  const sessions = new Map()
  const warns = []
  let waterfallCount = 0

  const ctx = {
    reflect: { provide() {} },
    fiber: { uid: 1, state: 2 },
    logger: {
      warn(message) {
        warns.push(message)
      },
      info() {},
    },
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name).push(listener)
      return () => {
        const arr = listeners.get(name)
        const index = arr.indexOf(listener)
        if (index >= 0) arr.splice(index, 1)
      }
    },
    once() {
      return () => {}
    },
    effect(task) {
      const disposables = []
      const result = task()
      if (typeof result === 'function') {
        disposables.push(result)
      } else if (result != null && typeof result === 'object' && Symbol.iterator in result) {
        const iter = result[Symbol.iterator]()
        for (;;) {
          const step = iter.next()
          if (step.value !== undefined) disposables.push(step.value)
          if (step.done) break
        }
      }
      let chained
      const dispose = () => {
        for (const disposable of [...disposables].reverse()) {
          const run = () => disposable()
          chained = chained ? chained.then(run, run) : Promise.resolve().then(run)
        }
        return chained
      }
      return dispose
    },
    inject(deps, fn) {
      if (Array.isArray(deps) && fn) fn({ sessionProjections: { register() {} } })
    },
    get(name) {
      return name === 'agents' ? agents : undefined
    },
    sessions: {
      get(id) {
        return sessions.get(id)
      },
      set(session) {
        sessions.set(session.id, session)
      },
    },
    emit(name, ...args) {
      for (const listener of [...(listeners.get(name) ?? [])]) listener(...args)
    },
    waterfall(name, payload, next) {
      if (name !== 'session-title/candidate') return next?.() ?? undefined
      waterfallCount += 1
      const cbs = [...(listeners.get(name) ?? [])]
      const run = (index) => {
        if (index >= cbs.length) return next()
        return cbs[index](payload, () => run(index + 1))
      }
      return run(0)
    },
    _waterfallCount() {
      return waterfallCount
    },
    _warns() {
      return warns
    },
  }
  return ctx
}

function userMessageEvent(seq, { text, form } = {}) {
  return {
    seq,
    type: 'user/message',
    data: {
      source: { kind: 'user', ...(form === undefined ? {} : { form }) },
      content: [{ type: 'text', text: text ?? `text-${seq}` }],
    },
  }
}

function makeSession({ messages = [], requestHeaderConfig, parentSession } = {}) {
  // The real log is dense (index === seq); fill every slot with a benign
  // placeholder so iterators (collect/fold) never see a hole.
  const events = []
  events[0] = { seq: 0, type: 'internal/placeholder', data: {} }
  for (const message of messages) {
    if (message?.seq === undefined || message.seq < 0) continue
    for (let s = events.length; s <= message.seq; s += 1) {
      if (events[s] === undefined) events[s] = { seq: s, type: 'internal/placeholder', data: {} }
    }
    events[message.seq] = message
  }
  const session = {
    id: 'session-1',
    events,
    header: { parentSession, config: requestHeaderConfig },
    requestHeader() {
      return requestHeaderConfig === undefined ? undefined : { config: requestHeaderConfig }
    },
    append(type, data) {
      const seq = events.length
      const event = { seq, type, data, time: Date.now() }
      events.push(event)
      return event
    },
  }
  return session
}

function emitUserMessage(ctx, session, { text, form } = {}) {
  const seq = session.events.length
  const event = userMessageEvent(seq, { text, form })
  session.events.push(event)
  ctx.emit('session/event', session, event)
  return event
}

const CONFIG = { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 }

function makeHarness({ messages = [], policyListeners = [], agents, requestHeaderConfig } = {}) {
  const ctx = makeContext({ agents })
  const session = makeSession({ messages, requestHeaderConfig })
  ctx.sessions.set(session)
  for (const listener of policyListeners) ctx.on('session-title/candidate', listener)
  const service = new SessionTitleService(ctx, CONFIG)
  return { ctx, session, service }
}

// ---------------------------------------------------------------------------
// Zero-listener equivalence and durable shape
// ---------------------------------------------------------------------------

test('zero listeners: fallback derives from the first eligible user message', async () => {
  const { ctx, session, service } = makeHarness({
    messages: [userMessageEvent(1, { text: 'first real' }), userMessageEvent(2, { text: 'second' })],
  })
  await service.ensureFallback(session)
  const snapshot = service.get(session)
  assert.ok(snapshot, 'a fallback title must be appended')
  assert.equal(snapshot.source.kind, 'fallback')
  assert.deepEqual(snapshot.messageSeqs, [1])
  assert.equal(snapshot.title, fallbackSessionTitle('first real', 5, 40))
  assert.equal(ctx._waterfallCount(), 2, 'one dispatch per candidate in the fallback attempt')
  const appended = session.events.filter((event) => event?.type === 'session/title')
  assert.equal(appended.length, 1)
  assert.deepEqual(appended[0].data, { title: snapshot.title, messageSeqs: [1], source: { kind: 'fallback' } })
})

test('zero listeners: onUserMessage schedules the fallback from the first user message', async () => {
  const { ctx, session, service } = makeHarness({
    messages: [userMessageEvent(1, { text: 'first real' }), userMessageEvent(2, { text: 'second' })],
  })
  emitUserMessage(ctx, session, { text: 'third' })
  await flush()
  const snapshot = service.get(session)
  assert.ok(snapshot)
  assert.equal(snapshot.source.kind, 'fallback')
  assert.deepEqual(snapshot.messageSeqs, [1])
  assert.equal(snapshot.title, fallbackSessionTitle('first real', 5, 40))
})

// ---------------------------------------------------------------------------
// Provider face, cadence, and shared post-policy candidate set
// ---------------------------------------------------------------------------

test('refresh reuses ONE post-policy collection for fallback and provider; each candidate dispatched once per attempt', async () => {
  const calls = []
  const provider = {
    id: 'test-provider',
    automatic: 'all-prompts',
    async generate({ messages }) {
      calls.push(messages.map((message) => message.seq))
      return { title: 'Provider Title', messageSeqs: [messages[0].seq], model: { provider: 'p', model: 'm' } }
    },
  }
  const { ctx, session, service } = makeHarness({
    messages: [userMessageEvent(1, { text: 'one' }), userMessageEvent(2, { text: 'two' })],
  })
  service.register(provider)
  const before = ctx._waterfallCount()
  const result = await service.refresh(session)
  assert.deepEqual(calls, [[1, 2]], 'the provider receives the full post-policy set exactly once')
  assert.equal(ctx._waterfallCount() - before, 2, 'refresh attempt: exactly one dispatch per candidate (2 candidates)')
  assert.ok(result)
  assert.equal(result.source.kind, 'provider')
  assert.deepEqual(result.messageSeqs, [1], 'provider title cites the first candidate')
})

test('first-prompt cadence: pending is scheduled only for the first eligible user message', async () => {
  const provider = {
    id: 'p',
    automatic: 'first-prompt',
    async generate() {
      return { title: 'x', messageSeqs: [1] }
    },
  }
  const { ctx, session, service } = makeHarness({ messages: [userMessageEvent(1, { text: 'one' })] })
  service.register(provider)
  const state = service.stateFor(session)
  emitUserMessage(ctx, session, { text: 'second' })
  assert.equal(state.pending, undefined, 'first-prompt must not schedule on the second eligible message')
})

test('all-prompts cadence: pending is rescheduled for every eligible user message', async () => {
  const provider = {
    id: 'p',
    automatic: 'all-prompts',
    async generate() {
      return { title: 'x', messageSeqs: [1] }
    },
  }
  const { ctx, session, service } = makeHarness({ messages: [] })
  service.register(provider)
  const state = service.stateFor(session)
  emitUserMessage(ctx, session, { text: 'one' })
  assert.ok(state.pending, 'pending scheduled for the first message')
  const firstRevision = state.pending.revision
  emitUserMessage(ctx, session, { text: 'two' })
  assert.ok(state.pending, 'all-prompts reschedules on every message')
  assert.ok(state.pending.revision > firstRevision, 'a newer pending revision is published')
})

// ---------------------------------------------------------------------------
// Policy decisions
// ---------------------------------------------------------------------------

test('exclude removes the synthetic candidate; fallback and provider see the same post-policy set', async () => {
  const calls = []
  const provider = {
    id: 'p',
    automatic: 'all-prompts',
    async generate({ messages }) {
      calls.push(messages.map((message) => message.seq))
      return { title: 'T', messageSeqs: [messages[0].seq] }
    },
  }
  const policy = (payload, next) => {
    if (payload.message.source.form === 'anchor') return { kind: 'exclude', reason: 'synthetic' }
    return next()
  }
  const { ctx, session, service } = makeHarness({
    messages: [userMessageEvent(1, { text: 'virtual', form: 'anchor' }), userMessageEvent(2, { text: 'real' })],
    policyListeners: [policy],
  })
  service.register(provider)
  const result = await service.refresh(session)
  assert.deepEqual(calls, [[2]], 'provider observes only the post-policy candidate (real)')
  const snapshot = service.get(session)
  assert.equal(snapshot.source.kind, 'provider')
  assert.deepEqual(snapshot.messageSeqs, [2])
  const virtualTitles = session.events.filter((event) => event?.type === 'session/title' && event.data.messageSeqs.includes(1))
  assert.equal(virtualTitles.length, 0, 'exclusion must not leak into any durable title')
  assert.equal(ctx._waterfallCount(), 2, 'refresh attempt evaluated both raw candidates once (1 excluded, 1 kept)')
})

test('replace substitutes a referenced message single-pass', async () => {
  const policy = (payload, next) => {
    if (payload.message.seq === 1) return { kind: 'replace', message: { seq: 5 }, reason: 'use the real ask' }
    return next()
  }
  const { session, service } = makeHarness({
    messages: [userMessageEvent(1, { text: 'one' }), userMessageEvent(2, { text: 'two' }), userMessageEvent(5, { text: 'five' })],
    policyListeners: [policy],
  })
  await service.ensureFallback(session)
  const snapshot = service.get(session)
  assert.equal(snapshot.source.kind, 'fallback')
  assert.equal(snapshot.title, fallbackSessionTitle('five', 5, 40))
  assert.deepEqual(snapshot.messageSeqs, [5], 'the replacement identity is cited')
})

test('replace with an unresolvable reference keeps the original and logs a redacted diagnostic', async () => {
  const policy = (payload, next) => {
    if (payload.message.seq === 1) return { kind: 'replace', message: { seq: 99 } }
    return next()
  }
  const { ctx, session, service } = makeHarness({
    messages: [userMessageEvent(1, { text: 'one' })],
    policyListeners: [policy],
  })
  await service.ensureFallback(session)
  const snapshot = service.get(session)
  assert.equal(snapshot.title, fallbackSessionTitle('one', 5, 40), 'original candidate retained on failed replace')
  assert.deepEqual(snapshot.messageSeqs, [1])
  const diagnostic = ctx._warns().find((message) => message.includes('could not be resolved'))
  assert.ok(diagnostic, 'one redacted replace diagnostic expected')
  assert.ok(!diagnostic.includes('one'), 'diagnostic must not leak candidate text')
})

test('a malformed decision is treated as no decision with one redacted diagnostic', async () => {
  const policy = (payload, next) => {
    if (payload.message.seq === 1) return { kind: 'bogus' }
    return next()
  }
  const { ctx, session, service } = makeHarness({
    messages: [userMessageEvent(1, { text: 'one' })],
    policyListeners: [policy],
  })
  await service.ensureFallback(session)
  assert.equal(service.get(session)?.title, fallbackSessionTitle('one', 5, 40))
  assert.ok(ctx._warns().some((message) => message.includes('session-title/candidate')), 'one redacted malformed diagnostic')
})

test('a throwing listener is contained as no decision', async () => {
  const policy = (payload, next) => {
    if (payload.message.seq === 1) throw new Error('listener boom')
    return next()
  }
  const { ctx, session, service } = makeHarness({
    messages: [userMessageEvent(1, { text: 'one' })],
    policyListeners: [policy],
  })
  await service.ensureFallback(session)
  assert.equal(service.get(session)?.title, fallbackSessionTitle('one', 5, 40), 'a throwing listener must not alter generation')
  assert.ok(ctx._warns().some((message) => message.includes('session-title/candidate')), 'one redacted throw diagnostic')
})

test('a thenable return is treated as no decision and its rejection is converged', async () => {
  const policy = (payload, next) => {
    if (payload.message.seq === 1) return Promise.reject(new TypeError('async boom'))
    return next()
  }
  const { ctx, session, service } = makeHarness({
    messages: [userMessageEvent(1, { text: 'one' })],
    policyListeners: [policy],
  })
  await service.ensureFallback(session)
  await flush()
  assert.equal(service.get(session)?.title, fallbackSessionTitle('one', 5, 40))
  assert.ok(ctx._warns().some((message) => message.includes('session-title/candidate')), 'one redacted thenable diagnostic')
})

test('the first decision in listener order settles the candidate', async () => {
  const calls = []
  const firstSeen = []
  const policyA = (payload, next) => {
    calls.push('a')
    if (payload.message.seq === 1) return { kind: 'exclude' }
    return next()
  }
  const policyB = (payload, next) => {
    calls.push('b')
    return next()
  }
  const { session, service } = makeHarness({
    messages: [userMessageEvent(1, { text: 'one' })],
    policyListeners: [policyA, policyB],
  })
  const listenerCapture = (payload, next) => {
    firstSeen.push(payload.message.seq)
    return next()
  }
  // register the capture listener AFTER the two policies so it never precedes them
  const ctx = service.ctx
  ctx.on('session-title/candidate', listenerCapture)
  await service.ensureFallback(session)
  // Candidate 1 is settled by policyA (exclude); policyB is never invoked for it.
  assert.equal(calls.filter((call) => call === 'b').length, 0, 'later listeners must not be invoked once a decision settles the candidate')
  assert.ok(calls.includes('a'), 'the deciding listener ran')
})

// ---------------------------------------------------------------------------
// Empty candidate set and no-collection no-dispatch
// ---------------------------------------------------------------------------

test('policy excluding every candidate yields the official no-candidate outcome', async () => {
  let generateCalls = 0
  const provider = {
    id: 'p',
    automatic: 'all-prompts',
    async generate() {
      generateCalls += 1
      return { title: 'x', messageSeqs: [1] }
    },
  }
  const excludeAll = () => ({ kind: 'exclude' })
  const { ctx, session, service } = makeHarness({
    messages: [userMessageEvent(1, { text: 'one' })],
    policyListeners: [excludeAll],
  })
  service.register(provider)
  const result = await service.refresh(session)
  assert.equal(generateCalls, 0, 'provider must not be called with zero eligible candidates')
  assert.equal(result, undefined, 'official no-candidate outcome: no new title, no new error type')
  assert.ok(!service.get(session), 'nothing appended')
  assert.equal(ctx._waterfallCount(), 1, 'the single candidate was evaluated once during the attempt')
})

test('runProvider with an empty candidate set skips provider.generate', async () => {
  let generateCalls = 0
  const ctx = makeContext()
  const session = makeSession({ messages: [userMessageEvent(1, { text: 'one' })] })
  ctx.sessions.set(session)
  const service = new SessionTitleService(ctx, CONFIG)
  const registration = {
    provider: {
      id: 'p',
      automatic: 'all-prompts',
      async generate() {
        generateCalls += 1
        return { title: 'x', messageSeqs: [1] }
      },
    },
    active: new Set(),
    closing: false,
  }
  const state = service.stateFor(session)
  state.revision = 1
  service.registration = registration
  const controller = new AbortController()
  const work = {
    registration,
    revision: 1,
    throughSeq: 1,
    messages: [],
    signal: AbortSignal.any([controller.signal, service.lifetime.signal]),
    controller,
  }
  state.active = work
  const result = await service.runProvider(session, work, undefined)
  assert.equal(generateCalls, 0)
  assert.equal(result, undefined)
  assert.ok(!service.get(session))
  assert.equal(state.active, undefined, 'the work must still be cleaned up on the empty path')
})

test('no eligible user messages dispatch nothing', async () => {
  const { ctx, session, service } = makeHarness()
  const result = await service.refresh(session)
  assert.equal(result, undefined)
  assert.equal(ctx._waterfallCount(), 0)
})

test('rename is policy-free and dispatches nothing', async () => {
  const excludeAll = (payload, next) => ({ kind: 'exclude' })
  const { ctx, session, service } = makeHarness({
    messages: [userMessageEvent(1, { text: 'one' })],
    policyListeners: [excludeAll],
  })
  const snapshot = service.rename(session, 'Explicit Title')
  assert.equal(snapshot.source.kind, 'user')
  assert.deepEqual(snapshot.messageSeqs, [])
  assert.equal(snapshot.title, 'Explicit Title')
  assert.equal(ctx._waterfallCount(), 0, 'an explicit rename must bypass the eligibility policy')
})

// ---------------------------------------------------------------------------
// Payload immutability and agent resolution
// ---------------------------------------------------------------------------

test('listeners cannot mutate the candidate through the payload', async () => {
  let mutationThrew = false
  const policy = (payload, next) => {
    try {
      payload.message.source.form = 'hacked'
      payload.message.text = 'evil'
    } catch {
      mutationThrew = true
    }
    return next()
  }
  const { session, service } = makeHarness({
    messages: [userMessageEvent(1, { text: 'one', form: 'anchor' })],
    policyListeners: [policy],
  })
  await service.ensureFallback(session)
  assert.equal(mutationThrew, true, 'assignments through a frozen snapshot must throw')
  assert.equal(service.get(session)?.title, fallbackSessionTitle('one', 5, 40))
})

test('payload.agent resolves lazily from the agents service; undefined when absent', async () => {
  const agent = { id: 'agent-1', session: { id: 'session-1' } }
  const agents = {
    list() {
      return [agent]
    },
  }
  const captured = []
  const { ctx, session, service } = makeHarness({ messages: [userMessageEvent(1, { text: 'one' })], agents })
  ctx.on('session-title/candidate', (payload) => {
    captured.push(payload.agent)
    return undefined
  })
  await service.ensureFallback(session)
  assert.equal(captured.length, 1)
  assert.equal(captured[0], agent, 'the matching live agent is exposed')
  assert.equal(captured[0].session.id, 'session-1')

  const captured2 = []
  const { ctx: ctx2, session: session2, service: service2 } = makeHarness({ messages: [userMessageEvent(1, { text: 'one' })] })
  ctx2.on('session-title/candidate', (payload) => {
    captured2.push(payload.agent)
    return undefined
  })
  await service2.ensureFallback(session2)
  assert.deepEqual(captured2, [undefined], 'the agent key is present with undefined when no agents service matches')
})
