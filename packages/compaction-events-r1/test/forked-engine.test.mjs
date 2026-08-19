import test from 'node:test'
import assert from 'node:assert/strict'
import { BasicCompactionEngine } from '../lib/forked-engine.js'

// ---------------------------------------------------------------------------
// Fake harness: plain-message surface satisfies the official tool-pairing
// balance predicates (all cuts balanced), so the vendored engine runs a full
// durable compaction transaction with a stubbed summarize() hook.
// ---------------------------------------------------------------------------

function makeSession({ nodes = [1, 2, 3, 4, 5], openTurn = true } = {}) {
  // Index 0 is reserved so every surface node sits at `events[seq] === seq`,
  // which the official tool-pairing balance cache requires. When idle, index 0
  // holds a benign placeholder so the durable-state scanner never reads a hole.
  const events = new Array(1)
  const surface = { nodes: [...nodes], replaceGeneration: 0 }
  events[0] = openTurn
    ? { seq: 0, type: 'turn/start', data: { turn: 'turn-1' } }
    : { seq: 0, type: 'internal/placeholder', data: {} }
  let nextSeq = events.length
  function append(type, data) {
    const seq = nextSeq
    const event = { seq, type, data }
    events[seq] = event
    nextSeq += 1
    return event
  }
  for (const seq of nodes) {
    const event = append('assistant/message', {
      message: { role: 'assistant', content: [{ type: 'text', text: `m${seq}` }] },
    })
    event._message = { role: 'assistant', content: [{ type: 'text', text: `m${seq}` }] }
  }
  return {
    id: 'session-1',
    events,
    surface,
    append,
    requestHeader() {
      return { system: 'sys', tools: [], config: { provider: 'p', model: 'm' } }
    },
    deriveEventMessage(event) {
      return event?._message ?? null
    },
  }
}

function makeMeter() {
  return {
    measure(session) {
      const nodes = session.surface.nodes.map((seq) => ({ seq, tokens: 100 }))
      return { nodes, totalTokens: nodes.reduce((sum, node) => sum + node.tokens, 0) }
    },
    estimateMessage() {
      return 1
    },
  }
}

function makeContext({ decision } = {}) {
  const emitted = []
  const waterfallCalls = []
  const warns = []
  const ctx = {
    reflect: { provide() {} },
    get() {
      return undefined
    },
    logger: {
      warn(message) {
        warns.push(message)
      },
      info() {},
    },
    tokenMeter: null,
    sessions: {
      async flush() {
        ctx.flushCalls += 1
        if (ctx.flushError) throw ctx.flushError
      },
    },
    llm: {
      async resolveModelInfo() {
        return { context: { contextWindow: 1000 } }
      },
      stream() {
        throw new Error('llm.stream must not be reached when summarize is stubbed')
      },
    },
    waterfall(name, payload, next) {
      waterfallCalls.push({ name, payload })
      return (async () => {
        const value = typeof decision === 'function' ? await decision(payload) : decision
        return value
      })()
    },
    emit(name, payload) {
      if (ctx.emitShouldThrow) throw new Error(`emit ${name} listener failed`)
      emitted.push({ name, payload })
    },
    flushCalls: 0,
    flushError: undefined,
    emitShouldThrow: false,
  }
  return { ctx, emitted, waterfallCalls, warns }
}

class TestEngine extends BasicCompactionEngine {
  constructor(ctx, config = {}, summarizeImpl = defaultSummarize) {
    super(ctx, { auto: false, ...config })
    this._summarizeImpl = summarizeImpl
  }

  async summarize(input, agent, signal) {
    return this._summarizeImpl(input, agent, signal)
  }
}

function defaultSummarize() {
  return {
    summary: [{ type: 'text', text: 'compacted checkpoint' }],
    rawOutput: { blocks: [{ type: 'text', text: 'compacted checkpoint' }] },
    llmStreamCall: true,
    provider: 'p',
    model: 'm',
    maxTokens: 100,
  }
}

function makeAgent(session) {
  return {
    session,
    options: { provider: 'p', model: 'm' },
    runMaintenance(fn) {
      return fn(new AbortController().signal)
    },
  }
}

async function runTransaction({ trigger, decision, sourceCommandId, openTurn = true, config = {}, summarizeImpl, flushError } = {}) {
  const { ctx, emitted, waterfallCalls, warns } = makeContext({ decision })
  ctx.tokenMeter = makeMeter()
  ctx.flushError = flushError
  const engine = new TestEngine(ctx, config, summarizeImpl)
  const session = makeSession({ openTurn })
  const agent = makeAgent(session)
  const manual = trigger === 'manual'
  let result
  let error
  if (manual) {
    try {
      const signal = new AbortController().signal
      result = await engine.compactNow(agent, signal, sourceCommandId)
    } catch (err) {
      error = err
    }
  } else {
    try {
      result = await engine.compactRegionInternal(1, 4, agent, trigger, undefined, sourceCommandId)
    } catch (err) {
      error = err
    }
  }
  return { engine, ctx, emitted, waterfallCalls, warns, session, agent, result, error }
}

// ---------------------------------------------------------------------------
// 3.1 trigger threading + 3.4 happy-path event sequence
// ---------------------------------------------------------------------------

test('compactionRegionInternal threads all four triggers and emits started then completed', async () => {
  for (const trigger of ['direct', 'pressure', 'context-overflow', 'manual']) {
    const h = await runTransaction({ trigger, openTurn: trigger !== 'manual' })
    assert.equal(h.error, undefined)
    assert.ok(h.result, `${trigger} should produce a committed result`)
    assert.equal(typeof h.result.compactionId, 'string')
    assert.ok(h.result.endSeq >= h.result.startSeq)

    assert.equal(h.waterfallCalls.length, 1)
    assert.equal(h.waterfallCalls[0].name, 'compaction/request')
    assert.equal(h.waterfallCalls[0].payload.trigger, trigger)
    assert.deepEqual(h.waterfallCalls[0].payload.range, { start: 1, end: 4 })

    const names = h.emitted.map((entry) => entry.name)
    assert.deepEqual(names, ['compaction/started', 'compaction/completed'], `${trigger} order`)
    assert.equal(h.emitted[0].payload.trigger, trigger)
    assert.deepEqual(h.emitted[0].payload.range, { start: 1, end: 4 })
    assert.equal(h.emitted[1].payload.result.startSeq, h.result.startSeq)
    assert.equal(h.emitted[1].payload.result.endSeq, h.result.endSeq)

    const types = h.session.events.map((event) => event?.type)
    assert.ok(types.includes('compaction/start'))
    assert.ok(types.includes('compaction/end'))

    if (trigger === 'manual') {
      assert.equal(h.ctx.flushCalls, 1, 'manual path runs the durability checkpoint')
    }
  }
})

test('compactNow delegates through the manual trigger with a durable checkpoint', async () => {
  const h = await runTransaction({ trigger: 'manual', sourceCommandId: 'cmd-9', openTurn: false })
  assert.equal(h.error, undefined)
  assert.equal(h.waterfallCalls[0].payload.trigger, 'manual')
  assert.equal(h.waterfallCalls[0].payload.sourceCommandId, 'cmd-9')
  assert.equal(h.ctx.flushCalls, 1)
})

// ---------------------------------------------------------------------------
// 5.2 / repeated single request + 3.4 no range -> zero events
// ---------------------------------------------------------------------------

test('proceeding with no decision behaves like the official implementation apart from dispatch', async () => {
  const h = await runTransaction({ trigger: 'pressure' })
  assert.equal(h.error, undefined)
  assert.equal(h.waterfallCalls.length, 1)
  const names = h.emitted.map((entry) => entry.name)
  assert.ok(names.includes('compaction/started'))
  assert.ok(names.includes('compaction/completed'))
  assert.ok(!names.includes('compaction/skipped'))
  assert.ok(!names.includes('compaction/failed'))
})

test('no compactable range emits zero compaction events', async () => {
  const { ctx, emitted, waterfallCalls } = makeContext({ decision: { kind: 'reject', reason: 'x' } })
  ctx.tokenMeter = makeMeter()
  const engine = new TestEngine(ctx, { auto: false })
  const session = makeSession({ nodes: [] })
  const agent = makeAgent(session)
  const result = await engine.compactNow(agent, new AbortController().signal)
  assert.equal(result, null)
  assert.equal(emitted.length, 0)
  assert.equal(waterfallCalls.length, 0)

  const lowPressure = await engine.compactIfNeeded(agent, 'pressure', undefined)
  assert.equal(lowPressure, null)
  assert.equal(emitted.length, 0)
  assert.equal(waterfallCalls.length, 0)
})

// ---------------------------------------------------------------------------
// 3.2 reject / veto
// ---------------------------------------------------------------------------

test('reject cancels before any durable marker, emits skipped, and returns null', async () => {
  const { ctx, emitted, waterfallCalls } = makeContext({ decision: { kind: 'reject', reason: 'indexes stale' } })
  ctx.tokenMeter = makeMeter()
  const engine = new TestEngine(ctx, { auto: false })
  const session = makeSession({})
  const agent = makeAgent(session)
  const result = await engine.compactRegion(1, 4, agent, undefined)
  assert.equal(result, null)
  assert.deepEqual(emitted.map((entry) => entry.name), ['compaction/skipped'])
  assert.equal(emitted[0].payload.reason, 'indexes stale')
  const types = session.events.map((event) => event?.type)
  assert.ok(!types.includes('compaction/start'), 'reject must not write a durable compaction marker')
  assert.ok(!types.includes('compaction/end'))
  assert.equal(waterfallCalls.length, 1)
})

test('a veto short-circuits compactIfNeeded so the retry loop never re-dispatches', async () => {
  // pressure path: one dispatch, immediate null, no second loop iteration.
  const pressure = makeContext({ decision: { kind: 'reject' } })
  pressure.ctx.tokenMeter = makeMeter()
  const engine = new TestEngine(pressure.ctx, { auto: false, thresholdRatio: 0.4 })
  const session = makeSession({})
  const agent = makeAgent(session)
  const result = await engine.compactIfNeeded(agent, 'pressure', undefined)
  assert.equal(result, null)
  assert.equal(pressure.waterfallCalls.length, 1, 'veto must stop the pressure retry loop after one dispatch')
  assert.deepEqual(pressure.emitted.map((entry) => entry.name), ['compaction/skipped'])

  // context-overflow path: also one dispatch and null.
  const overflow = makeContext({ decision: { kind: 'reject', reason: 'no' } })
  overflow.ctx.tokenMeter = makeMeter()
  const engine2 = new TestEngine(overflow.ctx, { auto: false })
  const overflowResult = await engine2.compactIfNeeded(agent, 'context-overflow', undefined)
  assert.equal(overflowResult, null)
  assert.equal(overflow.waterfallCalls.length, 1)
  assert.deepEqual(overflow.emitted.map((entry) => entry.name), ['compaction/skipped'])
})

// ---------------------------------------------------------------------------
// 3.3 replace-range
// ---------------------------------------------------------------------------

test('valid replace-range replaces the selected range', async () => {
  const h = await runTransaction({ trigger: 'pressure', decision: { kind: 'replace-range', start: 2, end: 4 } })
  assert.equal(h.error, undefined)
  assert.deepEqual(h.emitted[0].payload.range, { start: 2, end: 4 })
  assert.deepEqual(h.emitted[1].payload.range, { start: 2, end: 4 })
  assert.deepEqual(h.emitted[1].payload.result.shadowedRange, { start: 2, end: 4 })
})

test('invalid replace-range falls back to the original range with a redacted diagnostic', async () => {
  const h = await runTransaction({ trigger: 'pressure', decision: { kind: 'replace-range', start: 2, end: 99 } })
  assert.equal(h.error, undefined)
  assert.deepEqual(h.emitted[0].payload.range, { start: 1, end: 4 })
  assert.deepEqual(h.emitted[1].payload.range, { start: 1, end: 4 })
  assert.ok(
    h.warns.some((message) => message.includes('replace-range revalidation failed')),
    `expected a revalidation diagnostic, got: ${JSON.stringify(h.warns)}`,
  )
})

// ---------------------------------------------------------------------------
// 5.7 / 5.12 listener failures
// ---------------------------------------------------------------------------

test('a throwing request listener is contained and treated as no decision', async () => {
  const h = await runTransaction({
    trigger: 'pressure',
    decision() {
      throw new Error('listener boom')
    },
  })
  assert.equal(h.error, undefined)
  assert.ok(h.result, 'transaction must proceed after listener failure')
  const names = h.emitted.map((entry) => entry.name)
  assert.ok(names.includes('compaction/started'))
  assert.ok(names.includes('compaction/completed'))
  assert.ok(!names.includes('compaction/failed'))
})

test('a throwing observer listener cannot break the compaction transaction', async () => {
  const h = await runTransaction({ trigger: 'pressure' })
  h.ctx.emitShouldThrow = true
  // Re-run through the public compactRegion path with the throwing emitter.
  const ctx2 = makeContext({ decision: undefined })
  ctx2.ctx.emitShouldThrow = true
  ctx2.ctx.tokenMeter = makeMeter()
  const engine = new TestEngine(ctx2.ctx, { auto: false })
  const result = await engine.compactRegion(1, 4, makeAgent(makeSession()), undefined)
  assert.ok(result, 'transaction commits even when every observer dispatch throws')
})

// ---------------------------------------------------------------------------
// 5.10 failure paths
// ---------------------------------------------------------------------------

test('failure after start emits failed exactly once and throws the official error redacted', async () => {
  const boom = new Error('secret summary failure')
  boom.code = 'LLM_FAILED'
  const h = await runTransaction({
    trigger: 'pressure',
    summarizeImpl() {
      throw boom
    },
  })
  assert.ok(h.error, 'the official error must still propagate')
  const names = h.emitted.map((entry) => entry.name)
  assert.deepEqual(names, ['compaction/started', 'compaction/failed'])
  const failed = h.emitted[1].payload
  assert.deepEqual(failed.failure, { stage: 'summary', name: 'Error', code: 'LLM_FAILED' })
  assert.ok(!('message' in failed.failure), 'failed payload must be redacted')
  assert.ok(!('stack' in failed.failure))
  assert.equal(h.emitted.filter((entry) => entry.name === 'compaction/failed').length, 1)
})

test('flush failure after a successful commit emits completed then failed and throws persistence (internal transaction)', async () => {
  const { ctx, emitted } = makeContext({ decision: undefined })
  ctx.tokenMeter = makeMeter()
  ctx.flushError = new Error('flush checkpoint failed')
  const engine = new TestEngine(ctx, { auto: false })
  const session = makeSession({ openTurn: false })
  const agent = makeAgent(session)
  let error
  try {
    await engine.compactRegionInternal(1, 4, agent, 'manual', undefined, 'cmd-1')
  } catch (err) {
    error = err
  }
  assert.ok(error, 'flush failure must throw')
  assert.equal(error.code, 'persistence')
  const names = emitted.map((entry) => entry.name)
  assert.deepEqual(names, ['compaction/started', 'compaction/completed', 'compaction/failed'])
  assert.equal(emitted[2].payload.failure.stage, 'commit')
  assert.equal(ctx.flushCalls, 1)
  // The public compactNow path preserves the same ManualCompactionError
  // semantics ('persistence' for a failed durability checkpoint; the outer
  // guard only maps synchronous runMaintenance admission failures to 'busy',
  // per req 3.5).
  const ctx2 = makeContext({ decision: undefined })
  ctx2.ctx.tokenMeter = makeMeter()
  ctx2.ctx.flushError = new Error('flush checkpoint failed')
  const engine2 = new TestEngine(ctx2.ctx, { auto: false })
  let publicError
  try {
    await engine2.compactNow(makeAgent(makeSession({ openTurn: false })), new AbortController().signal, 'cmd-1')
  } catch (err) {
    publicError = err
  }
  assert.equal(publicError?.code, 'persistence')
})

// ---------------------------------------------------------------------------
// 5.13 immutable payloads
// ---------------------------------------------------------------------------

test('emitted payloads are frozen snapshots while live agent/session stay live', async () => {
  const h = await runTransaction({ trigger: 'pressure' })
  for (const { payload } of h.emitted) {
    assert.ok(Object.isFrozen(payload), `payload for ${h.emitted.find((e) => e.payload === payload).name} is frozen`)
    assert.ok(Object.isFrozen(payload.range))
    if (payload.result) {
      assert.ok(Object.isFrozen(payload.result))
      assert.ok(Object.isFrozen(payload.result.shadowedSeqs))
    }
    if (payload.failure) assert.ok(Object.isFrozen(payload.failure))
    assert.equal(Object.isFrozen(payload.agent), false)
    assert.equal(Object.isFrozen(payload.session), false)
  }
})
