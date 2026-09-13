/**
 * Acceptance for the compaction replacement's operation sub-face.
 *
 * The sub-face is the additive extension the main facade's `sessions.compaction`
 * projects over: it mirrors the engine's own internal sequences and reports a
 * frozen discriminated outcome instead of the public methods' overloaded
 * `null`. The public four-method contract and every `compaction/*` fact stay
 * exactly as they are.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { BasicCompactionEngine, OpenTurnRequiredError, InvalidRangeError } from '../lib/forked-engine.js'
import { createOperationSubface, hasOperationSubface, OPERATION_SUBFACE_SYMBOL } from '../lib/operation-subface.js'

function makeSession({ nodes = [1, 2, 3, 4, 5], openTurn = true } = {}) {
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
    const event = append('assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: `m${seq}` }] } })
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
  const ctx = {
    reflect: { provide() {} },
    get() {
      return undefined
    },
    logger: { warn() {}, info() {} },
    tokenMeter: makeMeter(),
    sessions: { async flush() {} },
    llm: {
      async resolveModelInfo() {
        return { context: { contextWindow: 1000 } }
      },
      stream() {
        throw new Error('llm.stream must not be reached')
      },
    },
    waterfall(name, payload) {
      return Promise.resolve(typeof decision === 'function' ? decision(payload) : decision)
    },
    emit(name, payload) {
      emitted.push({ name, payload })
    },
  }
  return { ctx, emitted }
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

function makeAgent(session, { idle = true } = {}) {
  return {
    session,
    options: { provider: 'p', model: 'm' },
    runMaintenance(fn) {
      if (!idle) throw new Error(`agent "${session.id}": already has active work`)
      return fn(new AbortController().signal)
    },
  }
}

function build({ decision, openTurn = true, idle = true, config = {}, summarizeImpl, nodes } = {}) {
  const { ctx, emitted } = makeContext({ decision })
  const engine = new TestEngine(ctx, config, summarizeImpl ?? defaultSummarize)
  const session = makeSession({ openTurn, ...(nodes === undefined ? {} : { nodes }) })
  const agent = makeAgent(session, { idle })
  const subface = createOperationSubface(engine)
  return { engine, ctx, emitted, session, agent, subface }
}

test('the sub-face is additive: the public methods and the fact stream are untouched', async () => {
  const { engine, session, agent, subface, emitted } = build({ decision: undefined, openTurn: false })
  assert.equal(hasOperationSubface(engine), false, 'the raw engine does not carry the marker')
  assert.equal(subface[OPERATION_SUBFACE_SYMBOL], true)

  const manual = await engine.compactNow(agent, new AbortController().signal, undefined)
  assert.ok(manual, 'the public manual method still commits')
  assert.equal(emitted.filter((entry) => entry.name === 'compaction/started').length, 1)
  assert.equal(emitted.filter((entry) => entry.name === 'compaction/completed').length, 1)
  assert.equal(session.events.some((event) => event.type === 'compaction/end'), true)
})

test('a committed compaction reports the declared lineage without the summary body', async () => {
  const { subface, agent } = build({ openTurn: false })
  const outcome = await subface.run({ agent, mode: 'now' })
  assert.equal(outcome.kind, 'compacted')
  assert.equal(Object.isFrozen(outcome), true)
  assert.deepEqual(Object.keys(outcome.lineage).sort(), [
    'compactionId', 'endSeq', 'shadowedRange', 'shadowedSeqs', 'shadowedTokenCount', 'startSeq', 'summarySeq',
  ].sort())
  assert.equal(JSON.stringify(outcome).includes('compacted checkpoint'), false, 'the summary body never leaves the engine')
  assert.equal(typeof outcome.lineage.compactionId, 'string')
})

test('the veto carries its decision reason and stays distinct from no-candidate', async () => {
  const vetoed = build({ decision: { kind: 'reject', reason: 'policy says no' }, openTurn: false })
  const rejected = await vetoed.subface.run({ agent: vetoed.agent, mode: 'now' })
  assert.equal(rejected.kind, 'rejected')
  assert.equal(rejected.reason, 'policy says no')
  assert.equal(vetoed.emitted.filter((entry) => entry.name === 'compaction/skipped').length, 1)
  assert.equal(vetoed.emitted.some((entry) => entry.name === 'compaction/started'), false, 'a veto starts no transaction')

  // No candidate: the engine's own selection finds no safe useful range.
  const empty = build({ openTurn: false, nodes: [1] })
  const skipped = await empty.subface.run({ agent: empty.agent, mode: 'now' })
  assert.equal(skipped.kind, 'skipped')
  assert.equal(skipped.reason, 'no-candidate')
  assert.equal(empty.emitted.some((entry) => entry.name === 'compaction/started'), false, 'a skip starts no transaction')
})

test('the range mode routes through the direct path and classifies its failures', async () => {
  const direct = build({ openTurn: true })
  const compacted = await direct.subface.run({ agent: direct.agent, mode: 'range', range: { start: 1, end: 4 } })
  assert.equal(compacted.kind, 'compacted')

  const noTurn = build({ openTurn: false })
  const refused = await noTurn.subface.run({ agent: noTurn.agent, mode: 'range', range: { start: 1, end: 4 } })
  assert.equal(refused.kind, 'failed')
  assert.equal(refused.code, 'open-turn-required')

  const badRange = build({ openTurn: true })
  const invalid = await badRange.subface.run({ agent: badRange.agent, mode: 'range', range: { start: 99, end: 100 } })
  assert.equal(invalid.code, 'invalid-range')
  assert.equal(OpenTurnRequiredError.prototype instanceof Error, true)
  assert.equal(InvalidRangeError.prototype instanceof Error, true)
})

test('a non-idle manual request is busy, and a pre-aborted signal is aborted', async () => {
  const busy = build({ openTurn: false, idle: false })
  const busyOutcome = await busy.subface.run({ agent: busy.agent, mode: 'now' })
  assert.equal(busyOutcome.kind, 'failed')
  assert.equal(busyOutcome.code, 'busy')

  const controller = new AbortController()
  controller.abort()
  const aborted = build({ openTurn: false })
  const abortedOutcome = await aborted.subface.run({ agent: aborted.agent, mode: 'now', signal: controller.signal })
  assert.equal(abortedOutcome.kind, 'aborted')
})

test('malformed specs are refused typed without touching the engine', async () => {
  const { subface, agent, emitted } = build({ openTurn: false })
  assert.equal((await subface.run(null)).code, 'invalid-arguments')
  assert.equal((await subface.run({ agent, mode: 'whenever' })).code, 'invalid-arguments')
  assert.equal((await subface.run({ agent: {}, mode: 'now' })).code, 'invalid-target')
  assert.equal((await subface.run({ agent, mode: 'range', range: { start: 1.5, end: 2 } })).code, 'invalid-arguments')
  assert.equal(emitted.length, 0, 'no refusal reached the engine')
})

test('a summary failure is classified with its stage', async () => {
  const failing = build({
    openTurn: false,
    summarizeImpl: () => {
      throw new Error('summarizer unavailable')
    },
  })
  const outcome = await failing.subface.run({ agent: failing.agent, mode: 'now' })
  assert.equal(outcome.kind, 'failed')
  assert.equal(outcome.code, 'summary-failed')
  assert.equal(outcome.stage, 'summary')
})

test('a range-path failure keeps its stage for the sub-face classification', async () => {
  const failing = build({
    openTurn: true,
    summarizeImpl: () => {
      throw new Error('summarizer unavailable')
    },
  })
  const outcome = await failing.subface.run({ agent: failing.agent, mode: 'range', range: { start: 1, end: 4 } })
  assert.equal(outcome.kind, 'failed')
  assert.equal(outcome.code, 'summary-failed')
  assert.equal(outcome.stage, 'summary')
})
