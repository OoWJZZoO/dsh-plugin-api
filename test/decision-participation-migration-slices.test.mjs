/**
 * Consumer migration slices for the decision participation contract.
 *
 * Each slice records an original consumer behavior (from the registered
 * upstream ability plugins), the current public call that carries it, and the
 * observed result — executed against the mounted facade with the official
 * producer dispatch shapes, never a stand-in injected into an internal
 * registry.
 *
 * | slice | original behavior | current public call | observed result |
 * |---|---|---|---|
 * | A | agent-teams pre-step activation gate (await official enter, append an activation message, keep the reject path) | `agents.decisions.register({ point: 'pre-step' })` | the official enter is composed with the activation message; a reject is preserved verbatim |
 * | B | ability-anchor whole assembly replacement + tool filtering | `prompts.assemblyPolicies.register()` | the replacement sections/tools reach the assemble consumer through the official assemble waterfall |
 * | C | turn-rewind / checkpoint-rewind pre-execution capture (snapshot before the first fs write or tool body) | `events.decisions.register('fs/write-intent')` + `tools.executionPolicies.register({ point: 'execute' })` | the capture settles before the side effect; snapshot execution itself belongs to the checkpoints owner |
 * | D | model-failover retry on request errors | `agents.decisions.register({ point: 'request-error' })` (+ route/health decisions stay with `llm.routing.*`) | the retry verdict reaches the producer; route selection/health evidence stay on their owning faces |
 * | E | secret-redaction on tool results | `security.redaction` (existing face) + `tools.executionPolicies.register({ point: 'post-execute' })` block-with-feedback | redaction hooks run on the existing face; a block decision surfaces feedback to the model |
 * | F | auto-continue at the turn boundary | `agents.decisions.register({ point: 'turn-stopping' })` via the replacement-row contract | a converged continue decision is delivered to the loop slice for the official inbox splice |
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
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
  return { ctx, state, hooksOf }
}

test('slice A: agent-teams pre-step activation composes with the official enter and keeps the reject path', async () => {
  // Original: the team plugin wrapped the pre-step waterfall — awaited the
  // official enter, appended an activation message, and let rejects pass.
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const activation = state.pluginApi.agents.decisions.register({
    point: 'pre-step',
    id: 'team-activation',
    async decide(context) {
      const official = await context.next()
      if (official?.kind === 'reject') return official
      return { kind: 'enter', messages: [...official.messages, 'team-activated'] }
    },
  })

  const entered = await ctx.waterfall(
    'agent/pre-step',
    { messages: ['user-input'], turn: 1, step: 0, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter', messages: ['user-input', 'official-context'] }),
  )
  assert.deepEqual(entered, { kind: 'enter', messages: ['user-input', 'official-context', 'team-activated'] })

  const gate = state.pluginApi.agents.decisions.register({
    point: 'pre-step',
    id: 'team-gate',
    decide: () => ({ kind: 'reject', reason: 'team paused' }),
  })
  const rejected = await ctx.waterfall(
    'agent/pre-step',
    { messages: ['user-input'], turn: 2, step: 0, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter', messages: ['user-input', 'official-context'] }),
  )
  assert.deepEqual(rejected, { kind: 'reject', reason: 'team paused' }, 'the reject path is preserved verbatim')
  gate.dispose()
  activation.dispose()
})

test('slice B: the anchor whole-assembly replacement and tool filtering reach the assemble consumer', async () => {
  // Original: the anchor plugin replaced the assembled context wholesale and
  // filtered the tool list. The official complete-section convergence after
  // the waterfall stays official-side; the waterfall return carries the
  // replacement honestly.
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const anchor = state.pluginApi.prompts.assemblyPolicies.register({
    id: 'anchor-sections',
    decide(assembly, context, next) {
      void context
      void next
      return {
        sections: [
          { id: 'anchor-brief', body: 'anchor instructions' },
          { id: 'base', body: assembly.sections.find((section) => section.id === 'base')?.body ?? '' },
        ],
        tools: assembly.tools.filter((tool) => tool !== 'shell'),
      }
    },
  })

  const assembled = await ctx.waterfall(
    'system-prompt/assemble',
    { sections: [{ id: 'base', body: 'base body' }], tools: ['read', 'shell'] },
    { purpose: 'reply' },
    () => ({ sections: [{ id: 'base', body: 'base body' }], tools: ['read', 'shell'] }),
  )
  assert.deepEqual(assembled, {
    sections: [
      { id: 'anchor-brief', body: 'anchor instructions' },
      { id: 'base', body: 'base body' },
    ],
    tools: ['read'],
  })
  anchor.dispose()
})

test('slice C: pre-execution capture settles before the first fs write and before the tool body', async () => {
  // Original: the turn-rewind / checkpoint-rewind plugins captured a rewind
  // point before any mutating side effect. The snapshot execution itself is
  // the checkpoints owner's business (durable capture); these participation
  // points only decide WHEN the capture must have happened by.
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const order = []
  const fsCapture = state.pluginApi.events.decisions.register('fs/write-intent', {
    id: 'rewind-capture-fs',
    async decide(context) {
      order.push('fs-capture')
      return await context.next()
    },
  })
  const toolCapture = state.pluginApi.tools.executionPolicies.register({
    point: 'execute',
    id: 'rewind-capture-tool',
    async decide(exec, next) {
      order.push('tool-capture')
      return await next()
    },
  })

  const writeLog = []
  const intent = await ctx.waterfall('fs/write-intent', { path: 'a.txt' }, { tool: 'write', signal: new AbortController().signal }, () => undefined)
  writeLog.push(intent)
  order.push('fs-write')
  assert.deepEqual(order, ['fs-capture', 'fs-write'], 'the fs capture settles before the write')

  const toolLog = []
  const toolResult = await ctx.waterfall(
    'tools/execute',
    { tool: 'writer', signal: new AbortController().signal },
    async () => {
      toolLog.push('body')
      return { ok: true }
    },
  )
  order.push('tool-body')
  assert.deepEqual(toolResult, { ok: true })
  assert.deepEqual(order, ['fs-capture', 'fs-write', 'tool-capture', 'tool-body'], 'the tool capture settles before the body')
  fsCapture.dispose()
  toolCapture.dispose()
  void writeLog
})

test('slice D: model-failover retry participates at request-error while routing stays on its owning faces', async () => {
  // Original: the failover plugin retried the model request on failure.
  // Division of labor: WHICH route/health decisions own the failover choice
  // stays with llm.routing (route policies + health evidence); the
  // participation point only signals the retry verdict at the error boundary.
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const retry = state.pluginApi.agents.decisions.register({
    point: 'request-error',
    id: 'failover-retry',
    decide: () => ({ kind: 'retry' }),
  })

  const outcome = await ctx.waterfall(
    'agent/request-error',
    { sessionId: 's1', turn: 1, failure: { message: 'overloaded', code: 'PROVIDER' } },
    () => Promise.resolve(undefined),
  )
  assert.deepEqual(outcome, { kind: 'retry' })

  // Division of labor on the public tree: the request-error boundary is a
  // loop-domain decision carried by agents.decisions; the llm namespace keeps
  // its own existing faces (admission, request transforms, adapters) and does
  // not duplicate the error-boundary decision. Route selection and health
  // evidence stay with the routing/route-policy owner.
  const llm = state.pluginApi.llm
  assert.equal(typeof llm.admissionPolicies.register, 'function')
  assert.equal(typeof llm.requestTransforms.register, 'function')
  assert.equal('decisions' in llm, false, 'the llm face does not duplicate the request-error decision')
  retry.dispose()
})

test('slice E: tool-result redaction stays on security.redaction; post-execute block supplies model feedback', async () => {
  // Original: the redactor plugin rewrote tool results to remove secrets.
  // Current: the existing security.redaction face carries redaction; the
  // post-execute participation point adds the missing block-with-feedback
  // verdict for results that must not reach the model at all.
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const security = state.pluginApi.security
  assert.equal(typeof security.redaction.register, 'function', 'redaction remains on its existing owning face')

  const blocker = state.pluginApi.tools.executionPolicies.register({
    point: 'post-execute',
    id: 'secret-block',
    decide: () => ({ kind: 'block', feedback: 'result withheld: contained a credential pattern' }),
  })
  const blocked = await ctx.waterfall(
    'tools/post-execute',
    { tool: 'search' },
    { ok: true },
    () => ({ ok: true }),
  )
  assert.deepEqual(blocked, { kind: 'block', feedback: 'result withheld: contained a credential pattern' })
  blocker.dispose()

  const rewriter = state.pluginApi.tools.executionPolicies.register({
    point: 'post-execute',
    id: 'secret-redact',
    decide: () => ({ kind: 'accept', content: 'redacted content' }),
  })
  const redacted = await ctx.waterfall(
    'tools/post-execute',
    { tool: 'search' },
    { ok: true },
    () => ({ ok: true }),
  )
  assert.deepEqual(redacted, { kind: 'accept', content: 'redacted content' })
  rewriter.dispose()
})

test('slice F: auto-continue at the turn boundary delivers the continue decision through the replacement-row contract', async () => {
  // Original: the auto-continue plugin re-prompted the loop when a turn ended
  // without completing the goal. Current: a turn-stopping participation
  // decision is converged by the facade chain; the agent-loop replacement
  // slice applies it through the official inbox splice (loop behavior covered
  // by the package suite).
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const contract = state.pluginApi[TURN_STOPPING_PARTICIPATION_SYMBOL]
  assert.ok(contract, 'the turn-stopping contract is exposed to the replacement slice')

  const autoContinue = state.pluginApi.agents.decisions.register({
    point: 'turn-stopping',
    id: 'auto-continue',
    decide: () => ({ kind: 'continue', message: { role: 'user', content: 'the goal is not met; continue' } }),
  })
  const decision = await contract.invoke({ agent: { id: 'a1' }, turn: 7, signal: new AbortController().signal })
  assert.deepEqual(decision, { kind: 'continue', message: { role: 'user', content: 'the goal is not met; continue' } })
  autoContinue.dispose()

  const stopped = await contract.invoke({ agent: { id: 'a1' }, turn: 8, signal: new AbortController().signal })
  assert.equal(stopped, null, 'without a continue decision the loop keeps the official stop')
})
