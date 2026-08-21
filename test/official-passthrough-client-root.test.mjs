import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply, CLIENT_OFFICIAL_LEAVES } from '../lib/client-runtime.js'
import { CLIENT_ENTRY_URL, CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS } from '../lib/client-official-passthrough.js'
import { PluginApiFeatureDisabledError, PluginApiInactiveError } from '../lib/errors.js'

const CORDIS_TRACKER = Symbol.for('cordis.tracker')
const LEAF_KEY = (surfaceKey) => surfaceKey.slice('client.'.length)
const DESCRIPTOR_BY_SURFACE = new Map(CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.map((d) => [d.surfaceKey, d]))
const DESCRIPTOR_BY_KEY = new Map(CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.map((d) => [LEAF_KEY(d.surfaceKey), d]))

/**
 * Raw module loader fake with the public RC.6 contract: three-argument
 * `import`, a `loadCache` map of `{ id, exports }` records, and `invalidate`.
 */
function createModulesLoader() {
  const loadCache = new Map()
  const calls = []
  return {
    loadCache,
    calls,
    async import(specifier, parentURL, attrs) {
      calls.push({ specifier, parentURL, attrs })
      const record = loadCache.get(specifier)
      if (record) return record.exports
      throw new Error(`no cached module for ${specifier}`)
    },
    invalidate(id) {
      loadCache.delete(id)
    },
  }
}

/** Deferred loader: imports settle only when the test resolves/rejects them. */
function createDeferredLoader() {
  const base = createModulesLoader()
  const pending = new Map()
  const loader = {
    ...base,
    resolvePending(id) {
      const queue = pending.get(id)
      if (!queue?.length) throw new Error(`no pending import for ${id}`)
      const entry = queue.shift()
      entry.resolve(loader.loadCache.get(id)?.exports)
      if (!queue.length) pending.delete(id)
    },
    rejectPending(id) {
      const queue = pending.get(id)
      if (!queue?.length) throw new Error(`no pending import for ${id}`)
      const entry = queue.shift()
      entry.reject(new Error(`import rejected for ${id}`))
      if (!queue.length) pending.delete(id)
    },
  }
  loader.import = (specifier, parentURL, attrs) => {
    loader.calls.push({ specifier, parentURL, attrs })
    return new Promise((resolve, reject) => {
      const queue = pending.get(specifier) ?? []
      queue.push({ resolve, reject })
      pending.set(specifier, queue)
    })
  }
  return loader
}

/**
 * Namespace fakes grouped by bare module id: the loader cache holds exactly
 * one namespace per module, and `@deepseek-ai/dsh-client-runtime` exports both
 * registry constructors, matching the bundled runtime modules.
 */
function createNamespaceFakes() {
  const namespaces = new Map()
  namespaces.set('@deepseek-ai/dsh-client-ui-input-trigger', { InputTriggerService: class InputTriggerService {
    constructor() { this.sources = [] }
    registerSource(src) { this.sources.push(src); return () => { this.sources = this.sources.filter((x) => x !== src) } }
    sessionOf(actx) { return { menu: actx, pick() {}, dismiss() {} } }
  } })
  namespaces.set('@deepseek-ai/dsh-client-ui-commands', { CommandUiRuntime: class CommandUiRuntime {
    register(contribution) { return () => contribution }
    decorate(decoration) { return () => decoration }
    popupFor(actx) { return { actx } }
  } })
  namespaces.set('@deepseek-ai/dsh-client-ui-model-selection', { ModelDirectoryResolver: class ModelDirectoryResolver {
    directoryFor(sessionId) { return { sessionId } }
  } })
  namespaces.set('@deepseek-ai/dsh-client-ui-conversation', { ConversationController: class ConversationController {
    constructor() { this.input = { draft: '' }; this.blocks = [] }
    send(text) { return Promise.resolve(`sent:${text}`) }
    updateQueue(id, action) { return Promise.resolve({ id, action }) }
    cancel() { return Promise.resolve() }
    loadOlder() { return Promise.resolve(1) }
  } })
  namespaces.set('@deepseek-ai/dsh-client-runtime', {
    ConversationEventRegistry: class ConversationEventRegistry {
      constructor() { this.definitions = []; this.listeners = [] }
      entries() { return [...this.definitions] }
      subscribe(listener) { this.listeners.push(listener); return () => { this.listeners = this.listeners.filter((l) => l !== listener) } }
      register(definition) { this.definitions.push(definition); return () => { this.definitions = this.definitions.filter((e) => e !== definition) } }
      registerFallback(definition) { this.fallback = definition; return () => { this.fallback = undefined } }
      fallbackEntry() { return this.fallback }
    },
    ConversationViewRegistry: class ConversationViewRegistry {
      constructor() { this.definitions = []; this.listeners = [] }
      entries() { return [...this.definitions] }
      subscribe(listener) { this.listeners.push(listener); return () => { this.listeners = this.listeners.filter((l) => l !== listener) } }
      register(definition) { this.definitions.push(definition); return () => { this.definitions = this.definitions.filter((e) => e !== definition) } }
    },
  })
  namespaces.set('@deepseek-ai/dsh-cordis-client-runner', { ClientTimerService: class ClientTimerService {
    setTimeout(callback, ms) { return () => ms }
    setInterval(callback, ms) { return () => ms }
    timeout(callback, ms) { if (typeof callback === 'function') return () => ms; return Promise.resolve(callback) }
    interval(callback, ms) {
      if (typeof callback === 'function') return () => ms
      return (async function* gen() { yield callback })()
    }
    throttle(fn, ms) { return Object.assign((...args) => fn(...args), { dispose() {} }) }
    debounce(fn, ms) { return Object.assign((...args) => fn(...args), { dispose() {} }) }
  } })
  return namespaces
}

/**
 * Independent fixture: a raw `modules` service, seven valid namespaces with
 * matching loadCache identities, and provider instances of the namespace
 * constructors. The M3 browser substrates are provided in their minimal
 * official shape. No M4-specific facade is registered anywhere.
 */
function bootFixture({ deferred = false } = {}) {
  const ctx = new Context()
  const logs = []
  ctx.logger.error = (line) => logs.push(line)
  const loader = deferred ? createDeferredLoader() : createModulesLoader()
  const namespaces = createNamespaceFakes()
  for (const descriptor of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) {
    const namespace = namespaces.get(descriptor.moduleId)
    const Constructor = namespace[descriptor.constructorExport]
    ctx.reflect.provide(descriptor.serviceName, new Constructor())
    loader.loadCache.set(descriptor.moduleId, { exports: namespace })
  }
  ctx.reflect.provide('modules', loader)
  ctx.reflect.provide('connection', {
    rpc: { call(_base, endpoint, body, signal) { return Promise.resolve({ endpoint, body, signal }) } },
    api: { settings: { describe() {} } },
  })
  const remoteListeners = new Map()
  ctx.reflect.provide('remote', {
    $on(name, listener) {
      const bucket = remoteListeners.get(name) ?? new Set()
      bucket.add(listener)
      remoteListeners.set(name, bucket)
      return () => bucket.delete(listener)
    },
    $dispatch(name, args) {
      for (const listener of [...(remoteListeners.get(name) ?? [])]) listener(...args)
    },
    async $mount(contribution) {
      for (const descriptorRow of contribution.descriptors) {
        this[descriptorRow.namespace] ??= { [descriptorRow.method]: () => ({ ok: true }) }
      }
      return () => true
    },
  })
  ctx.reflect.provide('settingsScope', { bind() { return { getSnapshot() {}, subscribe() {}, set() {}, unset() {} } } })
  ctx.reflect.provide('slots', {
    register() { return () => {} },
    inject() { return () => {} },
    entries() { return [] },
    subscribe() { return () => {} },
  })
  return { ctx, loader, namespaces, logs }
}

async function settleAll() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

const leafState = (api, surfaceKey) => api.client.features
  .find((f) => f.name === DESCRIPTOR_BY_SURFACE.get(surfaceKey).featureName).isActive

test('the root and all seven pending shells are observable synchronously while M3 faces stay usable', async () => {
  const { ctx, loader } = bootFixture({ deferred: true })
  const dispose = apply(ctx)
  assert.equal(typeof dispose, 'function')
  const api = ctx.get('pluginApi')
  assert.ok(api?.client)
  assert.equal(api.client.connection.isActive, true)
  assert.equal(typeof api.client.slots.register, 'function')
  assert.equal(typeof api.client.codec, 'object')
  const features = api.client.features
  assert.deepEqual(features.slice(0, 9).map((f) => f.name), [
    'clientManifest', 'clientConnection', 'clientCodec', 'clientRemoteContribution',
    'clientSettingsRemote', 'clientSettingsScope', 'clientSlots', 'clientSlotEvents', 'clientRemoteEvents',
  ])
  assert.deepEqual(features.slice(9).map((f) => f.name).sort(), [...CLIENT_OFFICIAL_LEAVES].sort())
  for (const feature of features) assert.equal(typeof feature.isActive, 'boolean')
  // Pending leaves typed-fail with their surface key.
  assert.throws(() => api.client.conversation.send('x'), (error) =>
    error instanceof PluginApiFeatureDisabledError && error.feature === 'client.conversation')
  for (const descriptor of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) loader.resolvePending(descriptor.moduleId)
  await settleAll()
  for (const feature of ctx.get('pluginApi').client.features.slice(9)) assert.equal(feature.isActive, true)
  await dispose()
})

test('apply returns a disposer and active reapply reuses the exact same disposer; second dispose is false', async () => {
  const { ctx, loader } = bootFixture({ deferred: true })
  const first = apply(ctx)
  assert.equal(apply(ctx), first)
  for (const descriptor of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) loader.resolvePending(descriptor.moduleId)
  assert.equal(await first(), true)
  assert.equal(await first(), false)
})

test('every leaf import uses the exact bare module id, the descriptor parent URL, and a fresh empty attributes record', async () => {
  const { ctx, loader } = bootFixture()
  apply(ctx)
  assert.equal(loader.calls.length, 7, 'one import per leaf descriptor')
  const byModule = new Map()
  for (const call of loader.calls) {
    assert.equal(call.parentURL, CLIENT_ENTRY_URL)
    assert.deepEqual(call.attrs, {})
    byModule.set(call.specifier, (byModule.get(call.specifier) ?? 0) + 1)
  }
  for (const descriptor of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) {
    assert.ok(byModule.has(descriptor.moduleId), `${descriptor.moduleId} must be imported`)
  }
  // `@deepseek-ai/dsh-client-runtime` hosts two leaves and therefore gets two
  // imports against the same cached namespace.
  assert.equal(byModule.get('@deepseek-ai/dsh-client-runtime'), 2)
  const identities = new Set(loader.calls.map((call) => call.attrs))
  assert.equal(identities.size, 7, 'every call must receive its own fresh attributes object')
})

test('an import that settles without a matching loadCache identity disables only that leaf', async () => {
  const { ctx, loader, logs } = bootFixture({ deferred: true })
  const timerDescriptor = DESCRIPTOR_BY_SURFACE.get('client.timer')
  loader.loadCache.delete(timerDescriptor.moduleId)
  apply(ctx)
  loader.resolvePending(timerDescriptor.moduleId)
  for (const descriptor of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) {
    if (descriptor.surfaceKey !== 'client.timer') loader.resolvePending(descriptor.moduleId)
  }
  await settleAll()
  const api = ctx.get('pluginApi')
  assert.equal(leafState(api, 'client.timer'), false)
  assert.ok(logs.some((line) => line.includes('client.timer') && line.includes('invalid-export')))
  assert.throws(() => api.client.timer.setTimeout(() => {}, 1), (error) =>
    error instanceof PluginApiFeatureDisabledError && error.feature === 'client.timer')
  for (const surfaceKey of ['client.inputTriggers', 'client.commandUi', 'client.modelDirectories', 'client.conversation',
    'client.conversationEvents', 'client.conversationViews']) {
    assert.equal(leafState(api, surfaceKey), true, `${surfaceKey} must stay active`)
  }
})

test('caller-scoped resolution: the provider sees the consuming context and receives exact arguments', async () => {
  const { ctx, namespaces } = bootFixture()
  const conversationDescriptor = DESCRIPTOR_BY_SURFACE.get('client.conversation')
  class ScopeConversation {
    constructor() { this.scopeCtx = null; this.lastArgs = null }
    get input() { return { scope: this.scopeCtx } }
    get blocks() { return [] }
    send(text) { this.scopeCtx = this.ctx; this.lastArgs = [text]; return Promise.resolve(this.ctx) }
    updateQueue() { return Promise.resolve() }
    cancel() { return Promise.resolve() }
    loadOlder() { return Promise.resolve() }
  }
  Object.defineProperty(ScopeConversation.prototype, CORDIS_TRACKER, {
    value: { associate: 'conversation', property: 'ctx' },
  })
  namespaces.get(conversationDescriptor.moduleId).ConversationController = ScopeConversation
  ctx.reflect.set(conversationDescriptor.serviceName, new ScopeConversation())
  apply(ctx)
  await settleAll()
  const api = ctx.get('pluginApi')
  const childA = ctx.extend()
  const childB = ctx.extend()
  assert.equal(await api.client.conversation.send('from-root'), ctx)
  assert.equal(await childA.get('pluginApi').client.conversation.send('from-A'), childA)
  assert.equal(await childB.get('pluginApi').client.conversation.send('from-B'), childB)
  assert.equal(await api.client.conversation.send('again'), ctx, 'readings through separate compositions stay caller-scoped')
})

test('each client getter read creates a fresh composition while member identities stay stable', async () => {
  const { ctx } = bootFixture()
  apply(ctx)
  const api = ctx.get('pluginApi')
  const first = api.client
  const second = api.client
  assert.notEqual(first, second, 'every client read must create a fresh caller-bound composition')
  assert.equal(first.codec, second.codec)
  assert.equal(first.connection, second.connection)
  assert.notEqual(first.conversation, second.conversation)
  assert.equal(first.features.length, 16)
})

test('cache invalidation retires only the affected leaf, typed-fails old references, logs once, and never rebinds', async () => {
  const { ctx, loader, logs } = bootFixture()
  apply(ctx)
  await settleAll()
  const api = ctx.get('pluginApi')
  const inputDescriptor = DESCRIPTOR_BY_SURFACE.get('client.inputTriggers')
  assert.equal(leafState(api, 'client.inputTriggers'), true)
  const retained = api.client.inputTriggers
  loader.invalidate(inputDescriptor.moduleId)
  assert.throws(() => retained.registerSource({}), (error) =>
    error instanceof PluginApiFeatureDisabledError
    && error.feature === 'client.inputTriggers'
    && /invalid-export/.test(error.message))
  assert.equal(leafState(api, 'client.inputTriggers'), false)
  assert.equal(logs.filter((line) => line.includes('client.inputTriggers')).length, 1, 'retirement must log once')
  assert.equal(await api.client.conversation.send('ok'), 'sent:ok', 'sibling leaves remain fully usable')
  // A reborn namespace in the cache must not silently rebind the retired leaf.
  loader.loadCache.set(inputDescriptor.moduleId, {
    exports: { InputTriggerService: class InputTriggerService {
      registerSource() { return () => {} }
      sessionOf() { return {} }
    } },
  })
  assert.throws(() => retained.registerSource({}), (error) => error.feature === 'client.inputTriggers')
  assert.equal(leafState(api, 'client.inputTriggers'), false)
})

test('disposal during an in-flight import retires the root generation and ignores late completions', async () => {
  const { ctx, loader } = bootFixture({ deferred: true })
  let unhandled = 0
  const onUnhandled = () => { unhandled += 1 }
  process.on('unhandledRejection', onUnhandled)
  try {
    const dispose = apply(ctx)
    const api = ctx.get('pluginApi')
    assert.equal(await dispose(), true)
    for (const descriptor of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) loader.resolvePending(descriptor.moduleId)
    await settleAll()
    for (const feature of api.client.features.slice(9)) assert.equal(feature.isActive, false)
    assert.throws(() => api.client.conversation.send('x'), (error) => error instanceof PluginApiInactiveError)
    assert.equal(unhandled, 0)
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('a clean apply after disposal creates a new root generation and old references type-fail', async () => {
  const { ctx, loader } = bootFixture()
  const firstDispose = apply(ctx)
  const firstApi = ctx.get('pluginApi')
  assert.equal(await firstDispose(), true)
  assert.equal(ctx.get('pluginApi'), undefined)
  const secondDispose = apply(ctx)
  assert.notEqual(secondDispose, firstDispose)
  await settleAll()
  const secondApi = ctx.get('pluginApi')
  for (const feature of secondApi.client.features.slice(9)) assert.equal(feature.isActive, true)
  assert.throws(() => firstApi.client.conversation.send('old'), (error) => error instanceof PluginApiInactiveError)
  assert.equal(await secondApi.client.conversation.send('new'), 'sent:new')
})

test('an absent module loader disables all seven leaves with missing-service while the M3 face publishes', async () => {
  const ctx = new Context()
  const logs = []
  ctx.logger.error = (line) => logs.push(line)
  const dispose = apply(ctx)
  assert.equal(typeof dispose, 'function')
  const api = ctx.get('pluginApi')
  assert.ok(api?.client)
  assert.equal(typeof api.client.slots.register, 'function', 'M3 faces stay published without the module loader')
  assert.equal(api.client.features.length, 16)
  for (const feature of api.client.features.slice(9)) assert.equal(feature.isActive, false)
  for (const surfaceKey of ['client.inputTriggers', 'client.commandUi', 'client.modelDirectories', 'client.conversation',
    'client.conversationEvents', 'client.conversationViews', 'client.timer']) {
    assert.ok(logs.some((line) => line.includes(surfaceKey) && line.includes('missing-service')), `missing diagnostic for ${surfaceKey}`)
  }
  assert.throws(() => api.client.timer.setTimeout(() => {}, 1), (error) =>
    error instanceof PluginApiFeatureDisabledError && error.feature === 'client.timer')
  assert.throws(() => api.client.conversation.send('x'), (error) => error.feature === 'client.conversation')
  await dispose()
})

test('independence fixture: a raw modules service plus seven valid namespaces activate every leaf without an M4 facade', async () => {
  const { ctx, loader } = bootFixture()
  const dispose = apply(ctx)
  await settleAll()
  const api = ctx.get('pluginApi')
  assert.equal(api.client.modules, undefined, 'no client.modules facade is invented')
  assert.equal(api.client.features.length, 16)
  for (const feature of api.client.features.slice(9)) assert.equal(feature.isActive, true, `${feature.name} must activate`)
  const input = api.client.inputTriggers
  const source = { id: 1 }
  const unregisterSource = input.registerSource(source)
  assert.deepEqual(input.sessionOf('actx').menu, 'actx')
  unregisterSource()
  assert.equal(input.sessionOf('actx').menu, 'actx') // opaque controller identity stays official
  const ui = api.client.commandUi
  assert.equal(ui.register('c1')(), 'c1')
  assert.equal(ui.decorate('d1')(), 'd1')
  assert.deepEqual(ui.popupFor('pctx'), { actx: 'pctx' })
  assert.deepEqual(api.client.modelDirectories.directoryFor('sid'), { sessionId: 'sid' })
  const conversation = api.client.conversation
  assert.equal(typeof conversation.input, 'object')
  assert.equal(await conversation.send('hi'), 'sent:hi')
  assert.deepEqual(await conversation.updateQueue('qi', 'action'), { id: 'qi', action: 'action' })
  assert.equal(await conversation.cancel(), undefined)
  assert.equal(await conversation.loadOlder(), 1)
  const events = api.client.conversationEvents
  const definition = { id: 'def' }
  const unregisterDef = events.register(definition)
  assert.deepEqual(events.entries(), [definition])
  assert.equal(unregisterDef(), undefined)
  assert.deepEqual(events.entries(), [])
  events.registerFallback({ id: 'fb' })
  assert.equal(events.fallbackEntry().id, 'fb')
  events.subscribe(() => {})
  const views = api.client.conversationViews
  views.register({ id: 'view' })
  assert.deepEqual(views.entries().map((entry) => entry.id), ['view'])
  const timer = api.client.timer
  assert.equal(typeof timer.setTimeout(() => {}, 1), 'function')
  assert.equal(await timer.timeout(10), 10)
  const iterator = timer.interval(10)
  assert.equal(typeof iterator[Symbol.asyncIterator], 'function')
  assert.equal(await iterator.next().then((next) => next.value), 10)
  const throttled = timer.throttle((x) => x, 5)
  assert.equal(throttled(3), 3)
  assert.equal(typeof throttled.dispose, 'function')
  assert.equal(timer.dispose, undefined, 'the timer service has no public dispose member')
  void dispose
})

test('a rejected import disables only its leaf and never becomes an unhandled rejection', async () => {
  const { ctx, loader } = bootFixture({ deferred: true })
  let unhandled = 0
  const onUnhandled = () => { unhandled += 1 }
  process.on('unhandledRejection', onUnhandled)
  try {
    apply(ctx)
    loader.rejectPending(DESCRIPTOR_BY_SURFACE.get('client.modelDirectories').moduleId)
    for (const descriptor of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) {
      if (descriptor.surfaceKey !== 'client.modelDirectories') loader.resolvePending(descriptor.moduleId)
    }
    await settleAll()
    const api = ctx.get('pluginApi')
    assert.equal(leafState(api, 'client.modelDirectories'), false)
    for (const surfaceKey of ['client.inputTriggers', 'client.commandUi', 'client.conversation',
      'client.conversationEvents', 'client.conversationViews', 'client.timer']) {
      assert.equal(leafState(api, surfaceKey), true)
    }
    assert.throws(() => api.client.modelDirectories.directoryFor('x'), (error) =>
      error instanceof PluginApiFeatureDisabledError && error.feature === 'client.modelDirectories')
    assert.equal(unhandled, 0)
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})