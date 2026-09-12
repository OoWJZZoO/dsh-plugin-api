/**
 * End-to-end acceptance for the decision participation contract.
 *
 * Dispatches run through the real official producer call shapes against the
 * mounted facade's public registration entries — no in-process mock bypasses
 * a public entry: policies register through `pluginApi.<domain>.decisions`
 * / `executionPolicies` / `assemblyPolicies` / `events.decisions`, and the
 * producers below replicate the official dispatch shapes verified against the
 * locked runtime sources (waterfall payload objects with the trailing
 * continuation; the fs-intent waterfall return consumed as the write's CAS
 * expected; the turn-stopping contract invoked by the agent-loop replacement
 * slice through the global contract symbol).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { FsIntentDeniedError } from '../lib/decision-participation.js'
import { TURN_STOPPING_PARTICIPATION_SYMBOL } from '../packages/agent-loop/lib/participation-slice.js'
import { ROUTE_POLICY_COMPONENT_SYMBOL } from '../packages/agent-loop/lib/route-policy.js'

function createMockCtx() {
  const agents = {
    get() { return undefined },
    list() { return [] },
    roots() { return [] },
  }
  const tools = {
    register() { return () => {} },
    restrict() { return () => {} },
    guard() { return () => {} },
    get() { return {} },
    schemas() { return [] },
    execute() { return Promise.resolve({ isError: false, content: [] }) },
    presentAs() { return () => {} },
  }
  const systemPrompt = {
    section() { return () => {} },
    context() { return () => {} },
    variable() { return () => {} },
    tools() { return () => {} },
    suppressRuntimeContext() { return () => {} },
  }
  const services = {
    llm: { resolveModelInfo() {} },
    agents,
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: {
      registerSearchProvider() {},
      registerFetchProvider() {},
      search() {},
      fetch() {},
    },
    tools,
    systemPrompt,
    // The agent-loop replacement row's service: the component marker is
    // installed by the replacement's own apply boot self-check after its
    // runtime identity check passed.
    agentLoop: {
      config: {},
      create() {},
      createAgent() { return Promise.resolve({}) },
      resume() { return Promise.resolve({}) },
      [ROUTE_POLICY_COMPONENT_SYMBOL]: { package: '@deepseek-ai/dsh-plugin-api-agent-loop', rowId: 'plugin-api-agent-loop' },
    },
  }
  const hooks = new Map()
  const hooksOf = (name) => {
    let list = hooks.get(name)
    if (!list) {
      list = []
      hooks.set(name, list)
    }
    return list
  }
  const state = { pluginApi: undefined }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') state.pluginApi = value
      },
    },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      if (name in services) return services[name]
      return undefined
    },
    plugin(Class) {
      new Class(ctx)
    },
    effect() {},
    on(name, listener) {
      const list = hooksOf(name)
      list.push(listener)
      let removed = false
      return () => {
        if (removed) return false
        removed = true
        const index = list.indexOf(listener)
        if (index >= 0) {
          list.splice(index, 1)
          return true
        }
        return false
      }
    },
    once() { return () => {} },
    emit() {},
    serial() {},
    parallel() {},
    bail() {},
    waterfall(name, ...args) {
      // Cordis waterfall: hooks receive the payload args plus the trailing
      // continuation; the event name selects the hook list.
      const callArgs = [...args]
      const callbacks = hooksOf(name).slice()
      const inner = callArgs.pop()
      const next = () => (callbacks.shift() ?? inner)(...callArgs)
      callArgs.push(next)
      return next()
    },
    loader: {
      entries() {
        return [
          { options: { id: 'agent-loop', name: '@deepseek-ai/dsh-agent-loop', disabled: true } },
          { options: { id: 'plugin-api-agent-loop', name: '@deepseek-ai/dsh-plugin-api-agent-loop', disabled: false }, fiber: {} },
        ]
      },
    },
  }
  return { ctx, state, hooks, hooksOf }
}

/** Official agent/pre-step producer shape (dsh-agent-loop preStep). */
async function officialPreStep(ctx, { claimed, turn, step, signal }) {
  return await ctx.waterfall(
    'agent/pre-step',
    { messages: claimed, turn, step, signal },
    () => Promise.resolve({ kind: 'enter', messages: [...claimed, 'official-context'] }),
  )
}

/** Official agent/request producer shape (seedConfig continuation). */
async function officialAgentRequest(ctx, seedConfig) {
  return await ctx.waterfall(
    'agent/request',
    { sessionId: 's1', turn: 1, attemptEpoch: '0' },
    () => Promise.resolve(seedConfig),
  )
}

/** Official agent/request-error producer shape (undefined continuation). */
async function officialAgentRequestError(ctx, failure) {
  return await ctx.waterfall(
    'agent/request-error',
    { sessionId: 's1', turn: 1, failure },
    () => Promise.resolve(undefined),
  )
}

/** Official system-prompt/assemble producer shape (whole-assembly continuation). */
async function officialAssemble(ctx, assembly) {
  return await ctx.waterfall(
    'system-prompt/assemble',
    assembly,
    { purpose: 'reply' },
    () => assembly,
  )
}

/** Official tools/execute around producer shape (the continuation executes the tool). */
async function officialToolExecution(ctx, exec, body) {
  return await ctx.waterfall(
    'tools/execute',
    exec,
    async () => {
      body()
      return { ok: true }
    },
  )
}

/** Official tools/post-execute producer shape (exec, result, continuation). */
async function officialPostExecute(ctx, exec, result) {
  return await ctx.waterfall(
    'tools/post-execute',
    exec,
    result,
    () => result,
  )
}

/** Official fs write producer shape: the waterfall return is the CAS expected; deny errors propagate. */
async function officialFsWrite(ctx, target, writeLog) {
  let expected
  try {
    expected = await ctx.waterfall(
      'fs/write-intent',
      target,
      { tool: 'write', signal: new AbortController().signal },
      () => undefined,
    )
  } catch (error) {
    return { isError: true, error }
  }
  writeLog.push({ target, expected })
  return { isError: false, expected }
}

test('two pre-step policies at different priorities compose in priority order into one final decision', async () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)

  // Priority order runs lowest first: the low policy sees the official enter
  // and appends after it; the high policy runs last, so its message lands
  // closest to the official context — the final decision carries both.
  const low = state.pluginApi.agents.decisions.register({
    point: 'pre-step',
    id: 'low-append',
    priority: 'low',
    async decide(context) {
      const official = await context.next()
      return { kind: 'enter', messages: [...official.messages, 'low-suffix'] }
    },
  })
  const high = state.pluginApi.agents.decisions.register({
    point: 'pre-step',
    id: 'high-append',
    priority: 'high',
    async decide(context) {
      const official = await context.next()
      return { kind: 'enter', messages: [...official.messages, 'high-suffix'] }
    },
  })
  assert.ok(low.generation && high.generation)

  const decision = await officialPreStep(ctx, { claimed: ['user-input'], turn: 1, step: 0, signal: new AbortController().signal })
  assert.deepEqual(decision.messages, ['user-input', 'official-context', 'high-suffix', 'low-suffix'])
  low.dispose()
  high.dispose()
})

test('a pre-step reject reaches the producer and blocks the step entry', async () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const handle = state.pluginApi.agents.decisions.register({
    point: 'pre-step',
    id: 'gate',
    decide: () => ({ kind: 'reject', reason: 'held' }),
  })

  const decision = await officialPreStep(ctx, { claimed: ['user-input'], turn: 1, step: 0, signal: new AbortController().signal })
  assert.deepEqual(decision, { kind: 'reject', reason: 'held' }, 'the producer receives the reject and marks the turn blocked')
  handle.dispose()

  const recovered = await officialPreStep(ctx, { claimed: ['user-input'], turn: 2, step: 0, signal: new AbortController().signal })
  assert.deepEqual(recovered, { kind: 'enter', messages: ['user-input', 'official-context'] }, 'disposal restores the official enter')
})

test('request rewriting and request-error retry participation reach the producer', async () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const request = state.pluginApi.agents.decisions.register({
    point: 'request',
    id: 'reroute',
    decide: () => ({ provider: 'fallback', model: 'fallback-model' }),
  })
  const rewritten = await officialAgentRequest(ctx, { provider: 'seed', model: 'seed-model' })
  assert.deepEqual(rewritten, { provider: 'fallback', model: 'fallback-model' }, 'the rewritten request config reaches the producer')
  request.dispose()

  const retry = state.pluginApi.agents.decisions.register({
    point: 'request-error',
    id: 'retry-once',
    decide: () => ({ kind: 'retry' }),
  })
  const outcome = await officialAgentRequestError(ctx, { message: 'boom', code: 'UNKNOWN' })
  assert.deepEqual(outcome, { kind: 'retry' }, 'the retry verdict reaches the producer for a controlled re-dispatch')
  retry.dispose()

  const official = await officialAgentRequestError(ctx, { message: 'boom', code: 'UNKNOWN' })
  assert.equal(official, undefined, 'without participation the producer keeps the official no-retry default')
})

test('message rewrite, whole-assembly replacement, and post-execute rewrite reach their stages', async () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const rewrite = state.pluginApi.agents.decisions.register({
    point: 'pre-step',
    id: 'rewriter',
    async decide(context) {
      const official = await context.next()
      return { kind: 'enter', messages: [...official.messages, 'injected-by-policy'] }
    },
  })
  const stepDecision = await officialPreStep(ctx, { claimed: ['user-input'], turn: 1, step: 0, signal: new AbortController().signal })
  assert.deepEqual(
    stepDecision.messages,
    ['user-input', 'official-context', 'injected-by-policy'],
    'the rewritten enter messages become the step messages',
  )
  rewrite.dispose()

  const assemblyPolicy = state.pluginApi.prompts.assemblyPolicies.register({
    id: 'whole-replacement',
    decide(assembly, context, next) {
      assert.deepEqual(context, { purpose: 'reply' }, 'the assembly policy receives the official assemble context')
      return { sections: [{ id: 'policy-section', body: 'replacement' }], tools: assembly.tools.filter((tool) => tool !== 'dangerous') }
    },
  })
  const assembled = await officialAssemble(ctx, { sections: [{ id: 'base', body: 'base' }], tools: ['safe', 'dangerous'] })
  assert.deepEqual(
    assembled,
    { sections: [{ id: 'policy-section', body: 'replacement' }], tools: ['safe'] },
    'the whole-assembly replacement and tool filtering reach the assemble consumer',
  )
  assemblyPolicy.dispose()

  const postPolicy = state.pluginApi.tools.executionPolicies.register({
    point: 'post-execute',
    id: 'redact',
    decide: () => ({ kind: 'accept', content: 'redacted-result' }),
  })
  const postOutcome = await officialPostExecute(ctx, { tool: 'search' }, { ok: true })
  assert.deepEqual(postOutcome, { kind: 'accept', content: 'redacted-result' }, 'the content rewrite reaches the model result')
  postPolicy.dispose()

  const valuePolicy = state.pluginApi.tools.executionPolicies.register({
    point: 'post-execute',
    id: 'value-arm',
    decide: () => ({ kind: 'accept', value: { structured: true } }),
  })
  const valueOutcome = await officialPostExecute(ctx, { tool: 'search' }, { ok: true })
  assert.deepEqual(valueOutcome, { kind: 'accept', value: { structured: true } }, 'the value arm reaches the model result')
  valuePolicy.dispose()
})

test('the around policy captures before the tool side effect and receives the officially dispatched exec identity', async () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const order = []
  let execUsedByBody
  const dispatchedExec = { tool: 'writer', args: { path: 'a.txt' }, signal: new AbortController().signal }
  const handle = state.pluginApi.tools.executionPolicies.register({
    point: 'execute',
    id: 'pre-capture',
    async decide(exec, next) {
      order.push('capture')
      assert.equal(exec, dispatchedExec, 'the around policy receives the same exec object the official dispatch carries')
      const result = await next()
      order.push('after-next')
      return result
    },
  })
  const result = await officialToolExecution(ctx, dispatchedExec, () => {
    execUsedByBody = dispatchedExec
    order.push('tool-body')
  })
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(order, ['capture', 'tool-body', 'after-next'], 'the capture completes before the tool side effect')
  assert.equal(execUsedByBody, dispatchedExec, 'the body executes against the officially dispatched exec object')
  handle.dispose()
})

test('the fs intent barrier settles before the write and a deny blocks the write through the official error channel', async () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const writeLog = []
  const capture = state.pluginApi.events.decisions.register('fs/write-intent', {
    id: 'pre-write-capture',
    async decide(context) {
      writeLog.push('capture')
      return await context.next()
    },
  })
  const outcome = await officialFsWrite(ctx, { path: 'a.txt' }, writeLog)
  assert.deepEqual(outcome, { isError: false, expected: undefined }, 'an undecided intent leaves the official CAS path intact')
  assert.deepEqual(
    writeLog,
    ['capture', { target: { path: 'a.txt' }, expected: undefined }],
    'the barrier settles before the write happens',
  )
  capture.dispose()

  const deny = state.pluginApi.events.decisions.register('fs/write-intent', {
    id: 'deny-writes',
    decide: () => ({ kind: 'deny', reason: 'policy: read-only window' }),
  })
  const denied = await officialFsWrite(ctx, { path: 'b.txt' }, writeLog)
  assert.equal(denied.isError, true, 'the deny reaches the producer as the official error result')
  assert.ok(denied.error instanceof FsIntentDeniedError, 'the deny propagates as the deliberate typed denial error')
  assert.match(denied.error.message, /read-only window/)
  assert.deepEqual(writeLog.length, 2, 'no write happened after the deny')
  deny.dispose()
})

test('a throwing or rejecting participant is contained; a stale disposer is never invoked', async () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const seen = []
  const thrower = state.pluginApi.agents.decisions.register({
    point: 'pre-step',
    id: 'thrower',
    priority: 'low',
    decide: () => { throw new Error('policy exploded') },
  })
  const rejecter = state.pluginApi.agents.decisions.register({
    point: 'pre-step',
    id: 'rejecter',
    priority: 'low',
    decide: () => Promise.reject(new Error('async rejection')),
  })
  const witness = state.pluginApi.agents.decisions.register({
    point: 'pre-step',
    id: 'witness',
    priority: 'high',
    async decide(context) {
      const official = await context.next()
      seen.push(official)
      return official
    },
  })
  const decision = await officialPreStep(ctx, { claimed: ['user-input'], turn: 1, step: 0, signal: new AbortController().signal })
  assert.deepEqual(decision, { kind: 'enter', messages: ['user-input', 'official-context'] }, 'the official enter survives broken participants')
  assert.equal(seen.length, 1, 'healthy participants still run')
  thrower.dispose()
  rejecter.dispose()
  witness.dispose()

  const stale = state.pluginApi.agents.decisions.register({
    point: 'pre-step',
    id: 'stale',
    decide: () => ({ kind: 'reject', reason: 'must-not-run' }),
  })
  assert.equal(stale.dispose(), true)
  assert.equal(stale.dispose(), false, 'double disposal is a no-op')
  const after = await officialPreStep(ctx, { claimed: ['user-input'], turn: 2, step: 0, signal: new AbortController().signal })
  assert.deepEqual(after, { kind: 'enter', messages: ['user-input', 'official-context'] }, 'a stale disposer never affects later dispatches')
})

test('an observer returning a reject-shaped value does not change the decision result', async () => {
  const { ctx, state, hooksOf } = createMockCtx()
  apply(ctx)

  // Observe feed: a read-only observer sees the dispatch and returns a
  // reject-shaped value; observation never decides.
  const seen = []
  const disposer = state.pluginApi.events.observe('agent/pre-step').subscribe((payload) => {
    seen.push(payload)
    return { kind: 'reject', reason: 'observer-cannot-veto' }
  })
  assert.equal(typeof disposer, 'function')

  const decision = await officialPreStep(ctx, { claimed: ['user-input'], turn: 1, step: 0, signal: new AbortController().signal })
  assert.deepEqual(decision, { kind: 'enter', messages: ['user-input', 'official-context'] }, 'the official decision is unchanged by observation')
  assert.equal(seen.length, 1, 'the observe feed still delivered the dispatch payload')
  disposer()
})

test('turn-stopping participation converges through the replacement-row contract symbol', async () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const contract = state.pluginApi[TURN_STOPPING_PARTICIPATION_SYMBOL]
  assert.ok(contract, 'the facade exposes the turn-stopping contract for the replacement slice')
  assert.equal(contract.contractVersion, 1)
  assert.equal(typeof contract.invoke, 'function')

  const handle = state.pluginApi.agents.decisions.register({
    point: 'turn-stopping',
    id: 'auto-continue',
    decide: () => ({ kind: 'continue', message: { role: 'user', content: 'continue the work' } }),
  })
  assert.ok(handle.generation, 'turn-stopping registration is available with the replacement row active')
  const decision = await contract.invoke({ agent: { id: 'a1' }, turn: 4, signal: new AbortController().signal })
  assert.deepEqual(decision, { kind: 'continue', message: { role: 'user', content: 'continue the work' } }, 'the chain converges the continue decision for the loop slice')
  handle.dispose()

  const stopped = await contract.invoke({ agent: { id: 'a1' }, turn: 5, signal: new AbortController().signal })
  assert.equal(stopped, null, 'without participation the loop keeps the official stop')
})

test('events.decisions rejects diverted decision needs with the carrying face named', async () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const streamResult = state.pluginApi.events.decisions.register('llm/stream', { id: 'x', decide: () => undefined })
  assert.equal(streamResult.ok, false)
  assert.equal(streamResult.code, 'unsupported')
  assert.match(streamResult.reason, /llm\.adapters/)
  assert.match(streamResult.reason, /llm\.requestTransforms/)

  const guardResult = state.pluginApi.events.decisions.register('tools/pre-execute', { id: 'x', decide: () => undefined })
  assert.equal(guardResult.ok, false)
  assert.equal(guardResult.code, 'unsupported')
  assert.match(guardResult.reason, /tools\.guard\.register/)

  const unknownResult = state.pluginApi.events.decisions.register('agent/created', { id: 'x', decide: () => undefined })
  assert.equal(unknownResult.code, 'unsupported')
  assert.match(unknownResult.reason, /fs\/write-intent/)
})
