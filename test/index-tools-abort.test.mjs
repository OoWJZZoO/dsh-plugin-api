import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, buildToolAbortedErrorFactory } from '../lib/index.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

// Minimal but faithful fiber-ctx mock (mirrors index-tools.test.mjs): provides
// the services the feature guards need, and records `get('tools')` calls so we
// can prove the abort helper never resolves the official tools service.
function createMockCtx({ tools = true } = {}) {
  const toolsService = tools
    ? { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} }
    : undefined
  const state = { pluginApi: undefined, getCalls: [] }
  const services = {
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    ...(toolsService ? { tools: toolsService } : {}),
  }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') state.pluginApi = value
      },
    },
    get(name) {
      state.getCalls.push(name)
      if (name === 'pluginApi') return state.pluginApi
      if (name in services) return services[name]
      return undefined
    },
    plugin(Class) {
      new Class(ctx)
    },
    effect() {},
    on() { return () => {} },
    once() {},
    emit() {},
    serial() {},
    parallel() {},
    bail() {},
    waterfall() {},
  }
  return { ctx, state }
}

test('active tools: toolAbortedError returns the AbortError identity without touching the tools service', async () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(state.pluginApi.tools.isActive, true)
  assert.equal(typeof state.pluginApi.services.tools.toolAbortedError, 'function')

  const toolsGetsBefore = state.getCalls.filter((n) => n === 'tools').length
  const err = state.pluginApi.services.tools.toolAbortedError()
  const toolsGetsAfter = state.getCalls.filter((n) => n === 'tools').length
  assert.equal(toolsGetsAfter, toolsGetsBefore)

  assert.ok(err instanceof Error)
  assert.equal(err.name, 'AbortError')
  assert.equal(err.message, 'tool call aborted')

  // When the real dsh-tools package resolves in the test environment, the
  // full typed identity holds; otherwise only the degraded
  // shape is asserted (mirrors the lazy-import/skip strategy).
  let TOOL_ABORTED
  try {
    const dshTools = await import('@deepseek-ai/dsh-tools')
    TOOL_ABORTED = dshTools.TOOL_ABORTED
  } catch {
    TOOL_ABORTED = undefined
  }
  if (TOOL_ABORTED !== undefined) {
    assert.equal(err.code, TOOL_ABORTED)
    assert.equal(err.code, 'ABORTED')
  } else {
    assert.equal('code' in err, false)
  }
})

test('disabled tools: toolAbortedError exists and throws PluginApiFeatureDisabledError, never crashing apply', () => {
  const { ctx, state } = createMockCtx({ tools: false })
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(state.pluginApi.tools.isActive, false)
  assert.equal(typeof state.pluginApi.services.tools.toolAbortedError, 'function')
  assert.throws(
    () => state.pluginApi.services.tools.toolAbortedError(),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'services.tools')
      return true
    },
  )
})

test('buildToolAbortedErrorFactory degrades to a usable factory when dsh-tools resolution fails', () => {
  const throwing = () => buildToolAbortedErrorFactory(() => { throw new Error('module not found') })
  const empty = () => buildToolAbortedErrorFactory(() => ({}))
  for (const build of [throwing, empty]) {
    let make
    assert.doesNotThrow(() => { make = build() })
    const e = make()
    assert.ok(e instanceof Error)
    assert.equal(e.name, 'AbortError')
    assert.equal(e.message, 'tool call aborted')
    assert.equal('code' in e, false)
  }
})
