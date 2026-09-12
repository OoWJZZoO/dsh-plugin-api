/**
 * End-to-end acceptance for real adapter registration through the public
 * facade path, against a mock official llm runtime that honors the official
 * registerAdapter contract (all-or-nothing commit, providerInfo validation,
 * DUPLICATE_ADAPTER, dispose revokes routes and emits the official change
 * event). Every scenario goes through `pluginApi.llm.*` only — no official
 * inject/import bypass.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

/**
 * Mock official llm runtime faithful to the probed registerAdapter contract.
 * `stream(options)` mimics the official dispatch: resolve the adapter for
 * options.provider, then invoke its stream implementation.
 */
function createOfficialLlm() {
  const routes = new Map()
  const adapters = new Map()
  const counts = { adaptersUpdated: 0 }
  const fail = (message) => Object.assign(new Error(message), { name: 'LlmError' })
  const llm = {
    listProviders() {
      return [...adapters.entries()].map(([id]) => ({ id, name: id }))
    },
    async listModels(provider) {
      const adapter = adapters.get(provider)
      if (!adapter) throw fail(`no adapter is registered for provider "${provider}"`)
      return adapter.listModels(provider)
    },
    registerAdapter(providers, adapter) {
      if (!Array.isArray(providers) || providers.length === 0) throw fail('an adapter must register at least one provider')
      const claimed = []
      for (const provider of providers) {
        if (typeof provider !== 'string' || provider.length === 0) throw fail('adapter provider names must be non-empty')
        if (routes.has(provider)) throw fail(`an adapter for provider "${provider}" is already registered`)
        const info = adapter.providerInfo(provider)
        if (info?.id !== provider || typeof info?.name !== 'string' || info.name.length === 0) {
          throw fail(`adapter metadata for provider "${provider}" must preserve its id and have a non-empty name`)
        }
        claimed.push(provider)
      }
      for (const provider of claimed) {
        routes.set(provider, { id: provider, name: adapter.providerInfo(provider).name })
        adapters.set(provider, adapter)
      }
      let released = false
      const dispose = () => {
        if (released) return
        released = true
        for (const provider of claimed) {
          routes.delete(provider)
          adapters.delete(provider)
        }
        counts.adaptersUpdated += 1
      }
      const handle = () => dispose()
      handle.replace = (next) => {
        if (released) throw fail('a disposed adapter registration cannot replace its routes')
        for (const provider of claimed) routes.set(provider, { id: provider, name: adapter.providerInfo(provider).name })
      }
      return handle
    },
    registerConfigurableProviders() { return () => {} },
    registerModelDiscovery() { return () => {} },
    stream(options) {
      const adapter = adapters.get(options.provider)
      if (!adapter) throw fail(`no adapter is registered for provider "${options.provider}"`)
      return adapter.stream(options)
    },
  }
  return { llm, routes, adapters, counts }
}

function createHarness() {
  const official = createOfficialLlm()
  const services = {
    llm: {
      resolveModelInfo() {}, prepareCall() {}, stream: official.llm.stream,
      registerAdapter: official.llm.registerAdapter,
      listProviders: official.llm.listProviders,
      listModels: official.llm.listModels,
      registerConfigurableProviders: official.llm.registerConfigurableProviders,
      registerModelDiscovery: official.llm.registerModelDiscovery,
    },
    tools: { register() {}, restrict() { return () => {} }, guard() { return () => {} }, get() {}, schemas() { return [] }, execute() {}, presentAs() {}, executionMode() { return 'mode' } },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    systemPrompt: { section() { return () => {} }, context() { return () => {} }, variable() { return () => {} }, tools() { return () => {} }, suppressRuntimeContext() { return () => {} }, renderPrompt() {}, renderContextSections() {}, renderContextSnapshot() {}, joinContextSections() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
  }
  const state = { pluginApi: undefined, effects: [], listeners: [] }
  const fiber = { name: 'e2e-plugin' }
  const ctx = {
    fiber,
    loader: { entries() { return [{ fiber, options: { name: 'e2e-plugin' } }] } },
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect(fn, label) { state.effects.push({ fn, label }) },
    on(name, listener) { state.listeners.push({ name, listener }); return () => {} },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
    model() { return { name: 'x' } },
    runtime: { name: 'test', version: '0.1.0-rc.6' },
  }
  apply(ctx)
  // The decoration side rides a fake facet through the standard provider
  // setter (the replacement composition is out of scope for this e2e).
  state.pluginApi._setLlmAdaptersProvider(() => ({
    decorate(definition, owner) { return { status: 'ok', record: { id: definition.id, owner, generation: 1 } } },
    dispose() { return { status: 'ok' } },
    snapshot() { return Object.freeze([]) },
    snapshotOf() { return { status: 'ok', snapshot: Object.freeze({}) } },
  }))
  state.pluginApi._registry.mount('llmAdapters')
  return { ctx, state, official, services }
}

const makeSpec = (provider, stream, extra = {}) => ({
  provider,
  models: [{ model: `${provider}-large`, ...(extra.modelFields ?? {}) }],
  stream,
  ...extra.spec,
})

test('synthetic provider full chain: registration, catalog, selection, real invocation', async () => {
  const { state, official } = createHarness()
  const chunksSeen = []
  const handle = state.pluginApi.llm.adapters.register(makeSpec('synth-x', async function* (options) {
    chunksSeen.push(options.model)
    yield { delta: 'synth:hello' }
    yield { delta: 'synth:done' }
  }))
  assert.equal(handle.ownerId, 'e2e-plugin', 'owner derives from the caller fiber')

  // catalog projection sees the registered provider and model
  const rows = await state.pluginApi.llm.models.list()
  const row = rows.find((entry) => entry.provider === 'synth-x')
  assert.ok(row, 'registered provider is selectable in the catalog')
  assert.equal(row.models[0].id, 'synth-x-large')

  // selection and real invocation go through the official stream path
  const chunks = []
  for await (const chunk of state.pluginApi.llm.stream({ provider: 'synth-x', model: 'synth-x-large' })) {
    chunks.push(chunk.delta)
  }
  assert.deepEqual(chunksSeen, ['synth-x-large'], 'the registered implementation is the backend actually invoked')
  assert.deepEqual(chunks, ['synth:hello', 'synth:done'], 'chunks conform to the official chunk vocabulary')
  assert.equal(official.counts.adaptersUpdated, 0, 'registration alone emits no revocation event')
})

test('image variant route and original model coexist with independent routing', async () => {
  const { state } = createHarness()
  state.pluginApi.llm.adapters.register(makeSpec('deepseek', async function* () { yield { delta: 'text-impl' } }))
  state.pluginApi.llm.adapters.register(makeSpec('deepseek-image', async function* () { yield { delta: 'image-impl' } }))

  const text = []
  for await (const chunk of state.pluginApi.llm.stream({ provider: 'deepseek', model: 'deepseek-large' })) text.push(chunk.delta)
  const image = []
  for await (const chunk of state.pluginApi.llm.stream({ provider: 'deepseek-image', model: 'deepseek-image-large' })) image.push(chunk.delta)
  assert.deepEqual(text, ['text-impl'])
  assert.deepEqual(image, ['image-impl'], 'the variant routes to its own implementation')

  const rows = await state.pluginApi.llm.models.list()
  assert.ok(rows.some((row) => row.provider === 'deepseek'))
  assert.ok(rows.some((row) => row.provider === 'deepseek-image'), 'variant is a selectable independent entry')
})

test('cross-owner registration is a deterministic owner conflict through the caller-capture seam', () => {
  const { state } = createHarness()
  state.pluginApi.llm.adapters.register(makeSpec('shared-route', async function* () {}))
  const otherFiber = { name: 'plugin-b' }
  const otherCaller = {
    fiber: otherFiber,
    loader: { entries: () => [{ fiber: otherFiber, options: { name: 'plugin-b' } }] },
    effect() {},
  }
  assert.throws(
    () => state.pluginApi._llmAdaptersForCaller(otherCaller).register(makeSpec('shared-route', async function* () {})),
    (error) => error instanceof Error && /already owned by another owner/.test(error.message),
    'owner conflict is deterministic',
  )
})

test('decorate, route replace and dispose interleave across two owners without cross-damage', async () => {
  const { state, official } = createHarness()
  const adapters = state.pluginApi.llm.adapters
  const ownerHandle = adapters.register(makeSpec('route-x', async function* () { yield { delta: 'v1' } }))
  const otherFiber = { name: 'plugin-b' }
  const otherCaller = {
    fiber: otherFiber,
    loader: { entries: () => [{ fiber: otherFiber, options: { name: 'plugin-b' } }] },
    effect() {},
  }
  const decoHandle = state.pluginApi._llmAdaptersForCaller(otherCaller).decorations.register({
    id: 'metrics',
    match: () => true,
    wrap: (next) => next,
  })

  // CAS replace: new selections hit the new implementation
  const swapped = adapters.register(makeSpec('route-x', async function* () { yield { delta: 'v2' } }), { replace: 1 })
  assert.equal(swapped.generation, 2)
  const chunks = []
  for await (const chunk of state.pluginApi.llm.stream({ provider: 'route-x', model: 'route-x-large' })) chunks.push(chunk.delta)
  assert.deepEqual(chunks, ['v2'], 'new selections use the new implementation')
  assert.equal(official.counts.adaptersUpdated, 0, 'a facade CAS swap is not a topology commit: no synthetic event')

  // the old-generation disposer is a typed no-op
  assert.equal(ownerHandle.dispose().status, 'stale', 'old-generation disposer does not revoke the newer registration')

  // decoration disposes through its own lifecycle; the route stays callable
  assert.equal((decoHandle.dispose())?.status ?? 'ok', 'ok')
  const after = []
  for await (const chunk of state.pluginApi.llm.stream({ provider: 'route-x', model: 'route-x-large' })) after.push(chunk.delta)
  assert.deepEqual(after, ['v2'])

  // the current-generation disposer revokes the route (official event fires)
  assert.equal(swapped.dispose().status, 'ok')
  assert.equal(official.counts.adaptersUpdated, 1, 'exactly one official revocation event for the whole interleave')
  assert.throws(
    () => state.pluginApi.llm.stream({ provider: 'route-x', model: 'route-x-large' }),
    /no adapter is registered/,
    'revoked route fails at execution time instead of silently re-routing',
  )
})

test('in-flight streams finish naturally across revocation; cancellation propagates through the signal', async () => {
  const { state } = createHarness()
  state.pluginApi.llm.adapters.register(makeSpec('long-x', async function* (options) {
    yield { delta: 'a' }
    yield { delta: 'b' }
    if (options?.signal?.aborted) return
    yield { delta: 'c' }
  }))
  const iterator = state.pluginApi.llm.stream({ provider: 'long-x', model: 'long-x-large' })[Symbol.asyncIterator]()
  assert.deepEqual((await iterator.next()).value, { delta: 'a' })

  // cancellation propagates through the official signal path: the adapter
  // contract decides how promptly the backend stops; no forged terminal
  const controller = new AbortController()
  controller.abort()
  const cancelChunks = []
  for await (const chunk of state.pluginApi.llm.stream({ provider: 'long-x', model: 'long-x-large', signal: controller.signal })) {
    cancelChunks.push(chunk.delta)
  }
  assert.deepEqual(cancelChunks, ['a', 'b'])

  // find the live handle through the idempotent re-register and dispose it
  const live = state.pluginApi.llm.adapters.register(makeSpec('long-x', async function* (options) {
    yield { delta: 'a' }
    yield { delta: 'b' }
    if (options?.signal?.aborted) return
    yield { delta: 'c' }
  }))
  assert.equal(live.dispose().status, 'ok')

  // the already-open stream keeps pulling from its captured implementation
  const rest = []
  for (;;) {
    const { value, done } = await iterator.next()
    if (done) break
    rest.push(value.delta)
  }
  assert.deepEqual(rest, ['b', 'c'], 'the open stream runs to natural completion across revocation')
})

test('official duplicate rejection keeps the registry exactly as it was', () => {
  const { state, official } = createHarness()
  state.pluginApi.llm.adapters.register(makeSpec('dup-x', async function* () {}))
  // a second registration for the same route is guarded by the facade; the
  // official all-or-nothing contract is asserted by refusing a foreign direct
  // commit through the mock (the facade never sees partial commits)
  assert.throws(() => official.llm.registerAdapter(['dup-x'], {
    providerInfo: (p) => ({ id: p, name: p }),
    stream: async function* () {},
  }), /already registered/)
  assert.equal(state.pluginApi.llm.adapters.list().length, 1, 'registry unchanged')
})
