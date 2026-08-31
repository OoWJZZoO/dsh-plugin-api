import test from 'node:test'
import assert from 'node:assert/strict'
import { createSecurityOwner } from '../lib/security-owner.js'
import { apply } from '../lib/index.js'

/**
 * Migration-equivalent regression (design Testing Strategy #6 / §3.4): when
 * no policy/rule is registered, every official seam the facade binds must
 * behave EXACTLY as before — listeners delegate through `next()` and the
 * official default shapes surface unchanged.
 */

function createMockCtx() {
  const listeners = new Map()
  const ctx = {
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name).push(listener)
      const entry = listeners.get(name).at(-1)
      return () => {
        const arr = listeners.get(name)
        const index = arr?.indexOf(entry)
        if (arr && index !== -1) arr.splice(index, 1)
      }
    },
  }
  const waterfall = async (name, base, ...args) => {
    const chain = listeners.get(name) ?? []
    let index = 0
    const next = async () => {
      const listener = chain[index++]
      if (!listener) return base
      return listener(...args, next)
    }
    return next()
  }
  return { ctx, listeners, waterfall }
}

test('no registration: approval/request delegates next() with the official default untouched', async () => {
  const { ctx, listeners, waterfall } = createMockCtx()
  const owner = createSecurityOwner({ ctx, logger: { warn() {} } })
  assert.ok(owner)
  const outcome = await waterfall('approval/request', Promise.resolve('unavailable'), { toolName: 'bash' })
  assert.equal(outcome, 'unavailable', 'official default ApprovalOutcome flows through untouched')
  await waterfall('approval/request', Promise.resolve('allowed-once'), { toolName: 'bash' })
})

test('no registration: tools/pre-execute delegates and the official allow default survives', async () => {
  const { ctx, listeners, waterfall } = createMockCtx()
  const owner = createSecurityOwner({ ctx, logger: { warn() {} } })
  const decision = await waterfall('tools/pre-execute', { kind: 'allow' }, { name: 'bash', callId: 'c1' })
  assert.deepEqual(decision, { kind: 'allow' })
})

test('no registration: tools/post-execute leaves the tool result byte-for-byte unchanged', async () => {
  const { ctx, listeners, waterfall } = createMockCtx()
  const owner = createSecurityOwner({ ctx, logger: { warn() {} } })
  const result = { content: [{ type: 'text', text: 'password=super-secret-1234567890' }], value: { ok: 1 } }
  const decision = await waterfall('tools/post-execute', { kind: 'accept' }, { name: 'x' }, result)
  assert.equal(decision.kind, 'accept')
  assert.equal(decision.content, undefined, 'no rewrite surfaces without redaction rules')
})

test('no registration: llm/stream forwards the official stream untouched', async () => {
  const { ctx, listeners, waterfall } = createMockCtx()
  const owner = createSecurityOwner({ ctx, logger: { warn() {} } })
  const stream = await waterfall('llm/stream', (async function* () { yield 'chunk-a'; yield 'chunk-b' })(), { sessionId: 's1' })
  const collected = []
  for await (const chunk of stream) collected.push(chunk)
  assert.deepEqual(collected, ['chunk-a', 'chunk-b'])
})

test('no registration: audit stays empty and availability reports active-but-idle truthfully', async () => {
  const { ctx } = createMockCtx()
  const owner = createSecurityOwner({ ctx, logger: { warn() {} } })
  assert.equal(owner.api.audit.list({}).records.length, 0)
  const availability = owner.api.availability
  assert.deepEqual(availability.faces, { policy: 'active', redaction: 'active', egress: 'active', audit: 'active' })
})

test('full apply without registration leaves all official seam listeners delegating (snapshot)', async () => {
  const listeners = []
  const state = { pluginApi: undefined }
  const services = {
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
  }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect() {},
    on(name, listener) {
      listeners.push({ name, listener })
      return () => {}
    },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  assert.doesNotThrow(() => apply(ctx))
  const seamNames = new Set(['approval/request', 'tools/pre-execute', 'tools/post-execute', 'llm/stream'])
  const seamListeners = listeners.filter((entry) => seamNames.has(entry.name))
  assert.ok(seamListeners.length >= 4, 'security binds all four seams (other features may bind the same events)')

  // drive each seam against its official default; nothing may throw
  const run = async (name, base, ...args) => {
    const chain = listeners.filter((entry) => entry.name === name).map((entry) => entry.listener)
    let index = 0
    const next = async () => {
      const listener = chain[index++]
      if (!listener) return base
      return listener(...args, next)
    }
    return next()
  }
  const approval = await run('approval/request', Promise.resolve('unavailable'), { toolName: 'bash' })
  assert.equal(approval, 'unavailable')
  const pre = await run('tools/pre-execute', { kind: 'allow' }, { name: 'bash' })
  assert.equal(pre.kind, 'allow')
  const post = await run('tools/post-execute', { kind: 'accept' }, { name: 'x' }, { content: [{ type: 'text', text: 'api_key=abcdef1234567890' }] })
  assert.equal(post.kind, 'accept')
  assert.equal(post.content, undefined)
  const audit = state.pluginApi.security.audit.list({})
  assert.equal(audit.records.length, 0, 'no registration -> no fabricated audit records')
})