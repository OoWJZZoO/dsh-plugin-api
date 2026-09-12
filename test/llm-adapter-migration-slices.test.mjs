/**
 * Consumer migration slices for real adapter registration.
 *
 * The original consumers (image-input variant adapters in a vision toolkit,
 * a TUI vision-ask adapter) registered private adapters directly on the
 * official runtime inside their own packages. This feature gives them one
 * public path: `pluginApi.llm.adapters.register(spec)` for the callable
 * route, `pluginApi.llm.models.list()` for catalog/selector visibility,
 * `llm.stream` (official vocabulary) for invocation. The consumer repos are
 * not present in this workspace, so each slice executes the exact call
 * shapes those consumers will migrate to, against the mounted facade and a
 * registerAdapter-faithful official llm mock — the same evidence pattern as
 * `test/consumer-migration-slices.test.mjs`.
 *
 * | slice | original consumer behavior | migrated public call | observed result |
 * |---|---|---|---|
 * | A | vision toolkit registers an image-variant adapter under a separate provider id so the selector lists it independently | `llm.adapters.register` + `llm.models.list` | variant route registered, catalog lists variant and original independently, each streams through its own implementation |
 * | B | TUI vision-ask ships its own vision adapter implementation | same public registration path with a providerName display label | wrapper passes the display name through the official providerInfo contract; invocation answers from the TUI-shaped implementation |
 * | C | consumers re-apply on plugin reload with a fresh implementation instance | idempotent re-register | same handle generation, no duplicate official commit, already-registered implementation preserved |
 * | D | a consumer needs to swap its adapter implementation atomically on config change | `register(spec, { replace: expectedGeneration })` | generation advances, new calls hit the new implementation, no synthetic change event |
 *
 * Non-functional, recorded instead of approximated: the consumers'
 * TypeScript declaration merging and UI picker components are not part of
 * this contract (no SDK/TS surface in this milestone), so no slice claims
 * them.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

function createOfficialLlm() {
  const routes = new Map()
  const adapters = new Map()
  const llm = {
    listProviders() {
      return [...adapters.entries()].map(([id]) => ({ id, name: id }))
    },
    async listModels(provider) {
      const adapter = adapters.get(provider)
      if (!adapter) throw Object.assign(new Error(`no adapter for "${provider}"`), { name: 'LlmError' })
      return adapter.listModels(provider)
    },
    registerAdapter(providers, adapter) {
      const claimed = []
      for (const provider of providers) {
        if (routes.has(provider)) throw Object.assign(new Error(`an adapter for provider "${provider}" is already registered`), { name: 'LlmError' })
        const info = adapter.providerInfo(provider)
        if (info?.id !== provider || typeof info?.name !== 'string' || info.name.length === 0) {
          throw Object.assign(new Error(`invalid adapter metadata for "${provider}"`), { name: 'LlmError' })
        }
        claimed.push(provider)
      }
      for (const provider of claimed) {
        routes.set(provider, { id: provider, name: adapter.providerInfo(provider).name })
        adapters.set(provider, adapter)
      }
      let released = false
      const handle = () => {
        if (released) return
        released = true
        for (const provider of claimed) {
          routes.delete(provider)
          adapters.delete(provider)
        }
      }
      handle.replace = () => {}
      return handle
    },
    registerConfigurableProviders() { return () => {} },
    registerModelDiscovery() { return () => {} },
    stream(options) {
      const adapter = adapters.get(options.provider)
      if (!adapter) throw Object.assign(new Error(`no adapter is registered for provider "${options.provider}"`), { name: 'LlmError' })
      return adapter.stream(options)
    },
  }
  return { llm, routes }
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
  const fiber = { name: 'vision-toolkit' }
  const ctx = {
    fiber,
    loader: { entries() { return [{ fiber, options: { name: 'vision-toolkit' } }] } },
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
  return { state, official }
}

const drain = async (iterator) => {
  const deltas = []
  for await (const chunk of iterator) deltas.push(chunk.delta)
  return deltas
}

test('slice A: image-variant adapter migrates to the public registration path', async () => {
  const { state } = createHarness()
  const { adapters } = state.pluginApi.llm

  // original provider route (the toolkit also stabilizes the base call here)
  adapters.register({
    provider: 'deepseek',
    models: [{ model: 'deepseek-chat' }],
    stream: async function* () { yield { delta: 'text' } },
  })
  // image variant as a selector-independent route
  adapters.register({
    provider: 'deepseek-image',
    models: [{ model: 'deepseek-chat-image', inputModalities: ['image'] }],
    providerName: 'DeepSeek (image variants)',
    stream: async function* () { yield { delta: 'image' } },
  })

  const rows = await state.pluginApi.llm.models.list()
  const original = rows.find((row) => row.provider === 'deepseek')
  const variant = rows.find((row) => row.provider === 'deepseek-image')
  assert.ok(original?.models.some((model) => model.id === 'deepseek-chat'), 'original model stays selectable')
  assert.ok(variant?.models.some((model) => model.id === 'deepseek-chat-image'), 'variant is selectable')
  assert.deepEqual(variant.models[0].inputModalities, ['image'])

  assert.deepEqual(await drain(state.pluginApi.llm.stream({ provider: 'deepseek', model: 'deepseek-chat' })), ['text'])
  assert.deepEqual(await drain(state.pluginApi.llm.stream({ provider: 'deepseek-image', model: 'deepseek-chat-image' })), ['image'])
})

test('slice B: a self-owned adapter carries its display name through the official contract', async () => {
  const { state, official } = createHarness()
  state.pluginApi.llm.adapters.register({
    provider: 'tui-vision',
    providerName: 'TUI Vision Ask',
    models: [{ model: 'vision-ask' }],
    stream: async function* () { yield { delta: 'tui-answer' } },
  })
  assert.equal(official.routes.get('tui-vision').name, 'TUI Vision Ask', 'display name flows through providerInfo')
  assert.deepEqual(await drain(state.pluginApi.llm.stream({ provider: 'tui-vision', model: 'vision-ask' })), ['tui-answer'])
})

test('slice C: plugin reload re-applies idempotently with a fresh implementation instance', async () => {
  const { state } = createHarness()
  const { adapters } = state.pluginApi.llm
  const first = adapters.register({
    provider: 'reload-route',
    models: [{ model: 'reload-model' }],
    stream: async function* () { yield { delta: 'one' } },
  })
  // re-apply with an equivalent declaration and a new function instance
  const second = adapters.register({
    provider: 'reload-route',
    models: [{ model: 'reload-model' }],
    stream: async function* () { yield { delta: 'two' } },
  })
  assert.equal(second.generation, first.generation, 'no generation bump for an identical re-apply')
  // the already-registered implementation keeps answering
  assert.deepEqual(await drain(state.pluginApi.llm.stream({ provider: 'reload-route', model: 'reload-model' })), ['one'])
})

test('slice D: config-change swap replaces the implementation atomically', async () => {
  const { state } = createHarness()
  const { adapters } = state.pluginApi.llm
  adapters.register({
    provider: 'swap-route',
    models: [{ model: 'swap-model' }],
    stream: async function* () { yield { delta: 'old' } },
  })
  const swapped = adapters.register({
    provider: 'swap-route',
    models: [{ model: 'swap-model' }],
    stream: async function* () { yield { delta: 'new' } },
  }, { replace: 1 })
  assert.equal(swapped.generation, 2)
  assert.deepEqual(await drain(state.pluginApi.llm.stream({ provider: 'swap-route', model: 'swap-model' })), ['new'])
})
