import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionTitleService, fallbackSessionTitle } from '../lib/forked-service.js'

// ---------------------------------------------------------------------------
// Migration fixture for the pro-ex title-correction use case (tasks 7.1-7.3,
// design C7, requirements 7.1-7.3 — evidence, not the feature's purpose).
//
// The pro-ex ability anchor injects a VIRTUAL user message stamped
// `source.form === 'extrapro-anchor'` (official ANCHOR_USER_SOURCE_FORM) so the
// trajectory opens a real user turn. The official session-title service titles
// the session from the VIRTUAL request. The `session-title/candidate` policy
// expresses the equivalent of pro-ex's title-correction hack (lib/index.js
// ~574-691): excluding that anchor form makes the fallback AND the first-prompt
// provider (`session-title-llm`, which picks `messages[0]`) both start from the
// REAL first user message — no post hoc title rewrite, no private-field reads.
// ---------------------------------------------------------------------------

const ANCHOR_USER_SOURCE_FORM = 'extrapro-anchor'
const CONFIG = { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 }

const flush = () => new Promise((resolve) => setImmediate(resolve))

// The design C7 migration listener verbatim.
const anchorExcludeListener = (payload, next) => {
  if (payload?.message?.source?.form === ANCHOR_USER_SOURCE_FORM) {
    return { kind: 'exclude', reason: 'trajectory anchor virtual request' }
  }
  return next()
}

// ---------------------------------------------------------------------------
// Minimal Cordis dispatch harness (mirrors the forked-service test harness).
// ---------------------------------------------------------------------------
function makeContext() {
  const listeners = new Map()
  const sessions = new Map()
  const ctx = {
    reflect: { provide() {} },
    fiber: { uid: 1, state: 2 },
    logger: { warn() {}, info() {} },
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
      if (typeof result === 'function') disposables.push(result)
      else if (result != null && typeof result === 'object' && Symbol.iterator in result) {
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
    get() {
      return undefined
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
      const cbs = [...(listeners.get(name) ?? [])]
      const run = (index) => {
        if (index >= cbs.length) return next()
        return cbs[index](payload, () => run(index + 1))
      }
      return run(0)
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

function makeSession(messages) {
  const events = [{ seq: 0, type: 'internal/placeholder', data: {} }]
  for (const message of messages) {
    for (let s = events.length; s <= message.seq; s += 1) {
      if (events[s] === undefined) events[s] = { seq: s, type: 'internal/placeholder', data: {} }
    }
    events[message.seq] = message
  }
  const session = {
    id: 'session-1',
    events,
    header: { parentSession: undefined, config: undefined },
    requestHeader() {
      return undefined
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

function makeHarness({ messages, policyListeners }) {
  const ctx = makeContext()
  const session = makeSession(messages)
  ctx.sessions.set(session)
  for (const listener of policyListeners) ctx.on('session-title/candidate', listener)
  const service = new SessionTitleService(ctx, CONFIG)
  return { ctx, session, service }
}

test('anchor scenario: excluding the virtual anchor makes fallback + first-prompt provider start from the REAL message (design C7)', async () => {
  // A virtual anchor user message followed by the real first user message.
  const messages = [
    userMessageEvent(1, { text: 'please do that thing (anchored)', form: ANCHOR_USER_SOURCE_FORM }),
    userMessageEvent(2, { text: 'now my real request' }),
  ]

  // Fallback path: no provider; refresh must derive from the real message.
  {
    const { session, service } = makeHarness({ messages, policyListeners: [anchorExcludeListener] })
    const result = await service.refresh(session)
    assert.ok(result, 'a fallback title is produced')
    assert.equal(result.source.kind, 'fallback')
    assert.deepEqual(result.messageSeqs, [2], 'fallback cites the real first message, not the anchor')
    assert.equal(result.title, fallbackSessionTitle('now my real request', 5, 40))
    const titles = session.events.filter((event) => event?.type === 'session/title')
    assert.equal(titles.length, 1)
    assert.ok(!titles[0].data.messageSeqs.includes(1), 'the anchor seq never leaks into a durable title')
  }

  // First-prompt provider path: a registered provider consumes the post-policy
  // candidate set, so messages[0] is the REAL message.
  {
    const generateCalls = []
    const provider = {
      id: 'migration-provider',
      automatic: 'first-prompt',
      async generate({ messages: candidates }) {
        generateCalls.push(candidates.map((candidate) => candidate.seq))
        return { title: 'Provider Title', messageSeqs: [candidates[0].seq] }
      },
    }
    const { session, service } = makeHarness({ messages, policyListeners: [anchorExcludeListener] })
    service.register(provider)
    const result = await service.refresh(session)
    assert.ok(result)
    assert.equal(result.source.kind, 'provider')
    assert.deepEqual(generateCalls, [[2]], 'provider.generate receives only the post-policy candidate set, messages[0] = real')
    assert.deepEqual(result.messageSeqs, [2])
  }
})

test('anchor scenario: the virtual anchor does not schedule title work at the onUserMessage level', async () => {
  const { ctx, session, service } = makeHarness({
    messages: [],
    policyListeners: [anchorExcludeListener],
  })
  const emitUserMessage = (text, form) => {
    const seq = session.events.length
    const event = userMessageEvent(seq, { text, form })
    session.events.push(event)
    ctx.emit('session/event', session, event)
  }
  // Emit the virtual anchor first.
  emitUserMessage('anchored virtual', ANCHOR_USER_SOURCE_FORM)
  await flush()
  assert.ok(!service.get(session), 'no fallback may be derived from the excluded anchor alone')

  // Emit the real first message.
  emitUserMessage('real first message')
  await flush()
  const snapshot = service.get(session)
  assert.ok(snapshot, 'the real message produces the title')
  assert.deepEqual(snapshot.messageSeqs, [2], 'title cites the real message seq')
  assert.equal(snapshot.title, fallbackSessionTitle('real first message', 5, 40))
})
