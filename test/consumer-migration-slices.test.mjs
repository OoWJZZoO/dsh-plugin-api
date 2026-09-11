/**
 * Consumer migration slices over the existing approved contract.
 *
 * Each slice records the original consumer behavior, the current public call
 * that carries it, and the observed result — executed against the real
 * component or the real mounted facade, never a stand-in injected straight
 * into an internal registry (slice A runs the real events bus with a Cordis-
 * shaped ctx; B–E boot the mounted facade/leaf path). Slices only cover
 * behavior the current contract already claims; anything that needs a new shape
 * is recorded as a gap instead of being silently approximated.
 *
 * | slice | original behavior | current public call | observed result |
 * |---|---|---|---|
 * | A | plugin-private event emit/subscribe | `events.define` + `events.observe` | payload round-trip and disposer semantics on the real events bus |
 * | B | inject an official browser service directly | `pluginApi.services.<leaf>` | typed-fails while the leaf is pending; serves the official business call once active |
 * | C | publish a remote through a Typert subclass | `pluginApi.remotes.register(name, plain object)` | published through the official boundary and invoked with its own return values |
 * | D | declare a storage domain through a `defineDomain` helper | `pluginApi.storage.open(declarative spec)` | namespaced official unit opened; business records round-trip through the official table; purge deletes |
 * | E | import llm helpers from the package root | `pluginApi.services.llm.<member>` | the official service and artifacts answer the real call |
 *
 * Carried by existing tests instead of being duplicated here (re-checked
 * against these slice semantics, never inferred from a file name):
 * - the six official llm directory methods as a leaf member set:
 *   `test/official-host-namespaces.test.mjs` (member set and receiver/argument
 *   preservation); their merged wiring under the mounted `services.llm` leaf:
 *   `test/host-namespace-integration.test.mjs`;
 * - the client capability self-description over these same leaves:
 *   `test/client-capability-availability.test.mjs`.
 *
 * Non-functional, recorded instead of approximated: the original consumers'
 * TypeScript types and UI dependencies are not part of the current contract
 * (no SDK/TS surface in this milestone), so no slice claims them. Segments that
 * need a new shape (attachment content-block mapping to the durable layer, and
 * the other registered gaps) stay with their owning feature and are never
 * dressed up as equivalent here.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEventsBus } from '../lib/events-bus.js'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { composeCatalogs } from '../lib/catalog-compose.js'
import { agentEventsCatalog } from '../lib/agent-events-catalog.js'
import { llmEventsCatalog } from '../lib/llm-events-catalog.js'
import { systemPromptEventsCatalog } from '../lib/system-prompt-events-catalog.js'
import { settingsEventsCatalog } from '../lib/settings-events-catalog.js'
import { apply } from '../lib/client-runtime.js'
import { CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS } from '../lib/client-official-passthrough.js'
import { apply as applyHostFacade } from '../lib/index.js'
import { bootFixture, settleAll } from './official-passthrough-fixture.mjs'

function noOp() {}

/** Official typert registry shape the remote boundary expects (as other host fixtures use). */
function createTypertRegistry() {
  return {
    register: noOp, get: noOp, resolve: noOp, list: noOp, getPackage: noOp, listPackages: noOp, toJSONSchema: noOp,
    local: { get: noOp, hasSeen: noOp, list: noOp, subscribe: noOp },
    remotes: { register: noOp, get: noOp, list: noOp, subscribe: noOp },
    lookups: { register: noOp, configure: noOp, get: noOp, definitions: noOp, keys: noOp, subscribe: noOp },
    contexts: { registerHost: noOp, configureHost: noOp, registerClient: noOp, getHost: noOp, getClient: noOp, subscribe: noOp },
  }
}

/**
 * Minimal host ctx that boots the real facade (the same contract-faithful
 * shape the other host integration fixtures use): official services behind
 * `ctx.get`, an official typert registry for the remote boundary and a
 * storage-domain facility for the declarative domain slice.
 */
function bootHostFacade({ llm, storageDomain } = {}) {
  const services = {
    loader: { entries() { return [] } },
    llm: llm ?? {
      resolveModelInfo: noOp, prepareCall: noOp, stream: noOp, registerAdapter: noOp,
      registerConfigurableProviders: noOp, registerModelDiscovery: noOp,
    },
    agents: { get: noOp, list: noOp, roots: noOp },
    tools: { register: noOp, restrict: noOp, guard: noOp, get: noOp, schemas: noOp, execute: noOp, presentAs: noOp },
    sessions: { get: noOp, list: noOp, fork: noOp },
    settings: { register: noOp, describe() { return [] }, get: noOp, mutate: noOp },
    typert: createTypertRegistry(),
    web: { registerSearchProvider: noOp, registerFetchProvider: noOp, search: noOp, fetch: noOp },
    systemPrompt: { section: noOp, context: noOp, variable: noOp, tools: noOp, suppressRuntimeContext: noOp },
    apiProxy: { sessions: { prompt: noOp, selectModel: noOp } },
  }
  const state = { pluginApi: undefined, providedServices: [] }
  const ctx = {
    logger: { error: noOp, warn: noOp },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') {
          state.pluginApi = value
          return () => {}
        }
        state.providedServices.push({ name, value })
        return () => true
      },
    },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      return services[name]
    },
    plugin(Class) { new Class(ctx) },
    effect: noOp,
    on() { return () => true },
    once: noOp, emit: noOp, serial: noOp, parallel: noOp, bail: noOp, waterfall: noOp,
  }
  if (storageDomain !== undefined) ctx.storage = { domain: storageDomain }
  return { ctx, state }
}

const coreCatalog = composeCatalogs(
  baseEventsCatalog,
  agentEventsCatalog,
  llmEventsCatalog,
  systemPromptEventsCatalog,
  settingsEventsCatalog,
)

function createMockCordisCtx() {
  const hooks = new Map()
  const hooksOf = (name) => {
    let list = hooks.get(name)
    if (!list) {
      list = []
      hooks.set(name, list)
    }
    return list
  }
  return {
    hooksOf,
    on(name, listener) {
      hooksOf(name).push({ callback: listener })
      let removed = false
      return () => {
        if (removed) return false
        removed = true
        const index = hooksOf(name).findIndex((hook) => hook.callback === listener)
        if (index >= 0) hooksOf(name).splice(index, 1)
        return true
      }
    },
    emit(name, ...args) {
      for (const hook of [...hooksOf(name)]) hook.callback(...args)
    },
    serial(name, ...args) {
      let value = args[0]
      for (const hook of [...hooksOf(name)]) value = hook.callback(value)
      return value
    },
    waterfall: undefined,
  }
}

test('slice A: a plugin-private event becomes a defined event with the same payload round-trip', async () => {
  // Original: the plugin emitted and subscribed its own private event names.
  // Current: `events.define` publishes the name, `events.observe` subscribes.
  const ctx = createMockCordisCtx()
  const bus = createEventsBus({ ctx, catalog: coreCatalog })
  const publisher = bus.define({ name: 'plugin-a.custom' })
  const seen = []
  const disposer = bus.observe('plugin-a.custom').subscribe((payload) => seen.push(payload))
  publisher.emit({ kind: 'ping', n: 1 })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(seen, [{ kind: 'ping', n: 1 }], 'the defined event carries the original payload')
  disposer()
  publisher.emit({ kind: 'ping', n: 2 })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(seen.length, 1, 'the disposer stops delivery')
})

test('slice B: an official browser service is consumed through the facade leaf, not by direct injection', async () => {
  // Original: the plugin injected an official browser service directly.
  // Current: `pluginApi.services.<leaf>` publishes the same face through the
  // facade; while the leaf is pending it typed-fails instead of lying.
  const { ctx, loader } = bootFixture({ deferred: true })
  const dispose = apply(ctx)
  const api = ctx.get('pluginApi')
  const descriptor = CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS[0]
  assert.ok(api.services[descriptor.serviceName], 'the leaf face is published synchronously')
  assert.throws(
    () => api.services.conversation.send('x'),
    (error) => error?.feature === 'client.conversation',
    'a pending shell typed-fails instead of silently dropping the call',
  )
  for (const item of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) loader.resolvePending(item.moduleId)
  await settleAll()
  assert.equal(api.capabilities.get('services').status, 'active')
  // Active means serving, not merely labelled: the official conversation
  // service answers its real business call through the same leaf, including
  // the rejection path, so `active` is never a capability flag over a shell.
  assert.equal(await api.services.conversation.send('hello'), 'sent:hello')
  await assert.rejects(
    () => api.services.conversation.send('boom'),
    (error) => error?.message === 'conversation rejects',
    'the official rejection reaches the consumer unchanged',
  )
  await dispose()
})

test('slice C: a remote published with plain methods is invocable through the official boundary', async () => {
  // Original: the plugin published its remote through a Typert subclass.
  // Current: a plain object with methods is registered and re-served through
  // the official boundary with its own arguments and return values.
  const { ctx, state } = bootHostFacade()
  applyHostFacade(ctx)
  const applied = []
  const anchorConfig = {
    get: (key) => ({ value: { key, enabled: true } }),
    set: (value) => {
      applied.push(value)
      return { ok: true, applied: value }
    },
  }
  const disposer = state.pluginApi.remotes.register('anchorConfig', anchorConfig)
  const published = state.providedServices.find((entry) => entry.name === 'anchorConfig')
  assert.ok(published, 'the plain-method service is published through the official boundary')
  assert.deepEqual(published.value.get('theme'), { value: { key: 'theme', enabled: true } })
  assert.deepEqual(published.value.set({ enabled: false }), { ok: true, applied: { enabled: false } })
  assert.deepEqual(applied, [{ enabled: false }], 'the call reached the plugin method exactly once')
  assert.equal(typeof disposer, 'function')
  disposer()
})

test('slice D: a declarative storage domain carries the plugin business records', async () => {
  // Original: the plugin described its domain through a defineDomain helper.
  // Current: the declarative spec goes to `pluginApi.storage.open`, which
  // opens one owner/scope-namespaced official unit and hands back the official
  // domain, so the plugin keeps its own snapshot business on the official table.
  const tables = new Map()
  const domain = {
    closed: 0,
    table(name) {
      if (!tables.has(name)) tables.set(name, new Map())
      const records = tables.get(name)
      return {
        keys: () => [...records.keys()],
        get: (key) => records.get(key),
        put: (key, value) => {
          records.set(key, value)
          return true
        },
        delete: (key) => records.delete(key),
      }
    },
    async close() { this.closed += 1 },
  }
  const opened = []
  const { ctx, state } = bootHostFacade({ storageDomain: { async open(spec) { opened.push(spec); return domain } } })
  applyHostFacade(ctx)
  const result = await state.pluginApi.storage.open({
    scope: 'workspace',
    owner: 'pluginx',
    schema: 'com.example.todo',
    version: 1,
    name: 'todos',
    tables: { items: { valueSchema: 'plugin-owned-schema' } },
  })
  assert.equal(result.code, 'opened')
  assert.equal(opened.length, 1)
  assert.equal(opened[0].name, 'workspace__pluginx__todos', 'the official unit is owner/scope namespaced')
  const items = result.handle.domain.table('items')
  items.put('todo-1', { title: 'ship it' })
  assert.deepEqual(items.get('todo-1'), { title: 'ship it' }, 'business data round-trips through the official table')
  assert.equal((await result.handle.purge()).code, 'purged')
  assert.equal(items.get('todo-1'), undefined, 'purge is the explicit deletion operation')
  assert.equal((await result.handle.dispose()).code, 'disposed')
  assert.equal(domain.closed, 1)
})

test('slice E: the official llm members answer through the current services.<leaf> path', async () => {
  // Original: the consumer imported the llm helpers from the package root.
  // Current: the audited members and artifacts ride under `services.llm` and
  // still reach the official service/module with real arguments and results.
  const calls = []
  const { ctx, state } = bootHostFacade({
    llm: {
      listProviders: () => {
        calls.push('listProviders')
        return ['provider-a']
      },
      discoverModels: (ns, options) => {
        calls.push(['discoverModels', ns, options])
        return ['model-a']
      },
    },
  })
  applyHostFacade(ctx)
  const llm = state.pluginApi.services.llm
  assert.deepEqual(llm.listProviders(), ['provider-a'])
  assert.deepEqual(llm.discoverModels('ns', { filter: 'vision' }), ['model-a'])
  assert.deepEqual(calls, ['listProviders', ['discoverModels', 'ns', { filter: 'vision' }]])
  const message = llm.createUserMessage({ content: [{ type: 'text', text: 'hi' }] })
  assert.equal(message.role, 'user', 'the artifact is the real official producer, not a facade copy')
  assert.deepEqual(message.content, [{ type: 'text', text: 'hi' }])
  assert.equal(typeof message.id, 'string')
})
