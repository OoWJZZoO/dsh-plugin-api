import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../lib/client-runtime.js'
import { CLIENT_ENTRY_URL, CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS } from '../lib/client-official-passthrough.js'
import { PluginApiInactiveError } from '../lib/errors.js'
import {
  bootFixture,
  CORDIS_TRACKER,
  DESCRIPTOR_BY_SURFACE,
  leafState,
  PluginApiFeatureDisabledError,
  settleAll,
} from './official-passthrough-fixture.mjs'

// Matches the fixture conversation fake's pre-created send promise value.
const providerValue = 'sent:hello'

test('the root and all seven pending shells are observable synchronously while the existing client faces stay usable', async () => {
  const { ctx, loader } = bootFixture({ deferred: true })
  const dispose = apply(ctx)
  assert.equal(typeof dispose, 'function')
  const api = ctx.get('pluginApi')
  assert.ok(api)
  assert.equal(api.connection.isActive, true)
  assert.equal(typeof api.slots.contribute, 'function')
  assert.equal(typeof api.slots.list, 'function')
  assert.equal(typeof api.slots.observe, 'function')
  assert.equal(typeof api.codec, 'object')
  // Top-level capability paths match the published root members.
  const expectedPaths = ['isActive', 'apiVersion', 'assertCompatible', 'capabilities', 'connection',
    'events', 'remotes', 'settings', 'slots', 'lifecycle', 'codec', 'services']
  assert.deepEqual([...api.capabilities.list()].sort(), [...expectedPaths].sort())
  for (const path of expectedPaths) {
    assert.equal(api.capabilities.get(path).status, 'active', `${path} must be reported as active`)
  }
  // All seven official leaves are published under services.* as pending shells.
  for (const descriptor of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) {
    const leafName = descriptor.serviceName
    assert.ok(api.services[leafName], `services.${leafName} must be published as a pending shell`)
    assert.equal(leafState(api, descriptor.surfaceKey), false, `${descriptor.surfaceKey} must be inactive while pending`)
  }
  // Pending leaves typed-fail with their surface key.
  assert.throws(() => api.services.conversation.send('x'), (error) =>
    error instanceof PluginApiFeatureDisabledError && error.feature === 'client.conversation')
  for (const descriptor of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS) loader.resolvePending(descriptor.moduleId)
  await settleAll()
  for (const surfaceKey of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.map((d) => d.surfaceKey)) {
    assert.equal(leafState(ctx.get('pluginApi'), surfaceKey), true, `${surfaceKey} must be active after resolving`)
  }
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
  assert.throws(() => api.services.timer.setTimeout(() => {}, 1), (error) =>
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
  assert.equal(await api.services.conversation.send('from-root'), ctx)
  assert.equal(await childA.get('pluginApi').services.conversation.send('from-A'), childA)
  assert.equal(await childB.get('pluginApi').services.conversation.send('from-B'), childB)
  assert.equal(await api.services.conversation.send('again'), ctx, 'readings through separate compositions stay caller-scoped')
})

test('each client getter read creates a fresh composition while member identities stay stable', async () => {
  const { ctx } = bootFixture()
  apply(ctx)
  const api = ctx.get('pluginApi')
  // The root identity is stable across reads; the composition is created per
  // member access (caller-bound services differ across reads).
  const first = api
  const second = api
  assert.equal(first, second, 'the root identity is stable across reads')
  assert.equal(first.codec, second.codec)
  assert.equal(first.connection, second.connection)
  assert.notEqual(first.services.conversation, second.services.conversation)
  // Top-level capabilities list contains the expected paths.
  assert.equal(api.capabilities.list().length, 12)
})

test('cache invalidation retires only the affected leaf, typed-fails old references, logs once, and never rebinds', async () => {
  const { ctx, loader, logs } = bootFixture()
  apply(ctx)
  await settleAll()
  const api = ctx.get('pluginApi')
  const inputDescriptor = DESCRIPTOR_BY_SURFACE.get('client.inputTriggers')
  assert.equal(leafState(api, 'client.inputTriggers'), true)
  const retained = api.services.inputTriggers
  loader.invalidate(inputDescriptor.moduleId)
  assert.throws(() => retained.registerSource({}), (error) =>
    error instanceof PluginApiFeatureDisabledError
    && error.feature === 'client.inputTriggers'
    && /invalid-export/.test(error.message))
  assert.equal(leafState(api, 'client.inputTriggers'), false)
  assert.equal(logs.filter((line) => line.includes('client.inputTriggers')).length, 1, 'retirement must log once')
  assert.equal(await api.services.conversation.send('ok'), providerValue, 'sibling leaves remain fully usable')
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
    // After disposal all leaves are inactive.
    for (const surfaceKey of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.map((d) => d.surfaceKey)) {
      assert.equal(leafState(api, surfaceKey), false, `${surfaceKey} must be inactive after disposal`)
    }
    assert.throws(() => api.services.conversation.send('x'), (error) => error instanceof PluginApiInactiveError)
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
  // All seven official leaves are published under services.* and are active.
  for (const surfaceKey of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.map((d) => d.surfaceKey)) {
    assert.equal(leafState(secondApi, surfaceKey), true, `${surfaceKey} must be active on the new generation`)
  }
  assert.throws(() => firstApi.services.conversation.send('old'), (error) => error instanceof PluginApiInactiveError)
  assert.equal(await secondApi.services.conversation.send('new'), providerValue)
})

test('an absent module loader disables all seven leaves with missing-service while the existing client face publishes', async () => {
  const ctx = new Context()
  const logs = []
  ctx.logger.error = (line) => logs.push(line)
  const dispose = apply(ctx)
  assert.equal(typeof dispose, 'function')
  const api = ctx.get('pluginApi')
  assert.ok(api)
  assert.equal(typeof api.slots.contribute, 'function', 'existing client faces stay published without the module loader')
  // All seven official leaves are published under services.* and are disabled.
  for (const surfaceKey of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.map((d) => d.surfaceKey)) {
    assert.equal(leafState(api, surfaceKey), false, `${surfaceKey} must be disabled without the module loader`)
  }
  for (const surfaceKey of ['client.inputTriggers', 'client.commandUi', 'client.modelDirectories', 'client.conversation',
    'client.conversationEvents', 'client.conversationViews', 'client.timer']) {
    assert.ok(logs.some((line) => line.includes(surfaceKey) && line.includes('missing-service')), `missing diagnostic for ${surfaceKey}`)
  }
  assert.throws(() => api.services.timer.setTimeout(() => {}, 1), (error) =>
    error instanceof PluginApiFeatureDisabledError && error.feature === 'client.timer')
  assert.throws(() => api.services.conversation.send('x'), (error) => error.feature === 'client.conversation')
  await dispose()
})

test('independence fixture: a raw modules service plus seven valid namespaces activate every leaf without a client.modules facade', async () => {
  const { ctx, loader } = bootFixture()
  const dispose = apply(ctx)
  await settleAll()
  const api = ctx.get('pluginApi')
  // All seven official leaves are published under services.* and are active.
  for (const surfaceKey of CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS.map((d) => d.surfaceKey)) {
    assert.equal(leafState(api, surfaceKey), true, `${surfaceKey} must activate`)
  }
  const input = api.services.inputTriggers
  const source = { id: 1 }
  const unregisterSource = input.registerSource(source)
  assert.deepEqual(input.sessionOf('actx').menu, 'actx')
  unregisterSource()
  assert.equal(input.sessionOf('actx').menu, 'actx') // opaque controller identity stays official
  const ui = api.services.commandUi
  assert.equal(ui.register('c1')(), 'c1')
  assert.equal(ui.decorate('d1')(), 'd1')
  assert.deepEqual(ui.popupFor('pctx'), { actx: 'pctx' })
  assert.deepEqual(api.services.modelDirectories.directoryFor('sid'), { sessionId: 'sid' })
  const conversation = api.services.conversation
  assert.equal(typeof conversation.input, 'object')
  assert.equal(await conversation.send('hi'), providerValue)
  assert.deepEqual(await conversation.updateQueue('qi', 'action'), { id: 'q1', action: 'replace' }, 'the fixture queue promise value is forwarded')
  assert.equal(await conversation.cancel(), undefined)
  assert.equal(await conversation.loadOlder(), 1)
  const events = api.services.conversationEvents
  const definition = { id: 'def' }
  const unregisterDef = events.register(definition)
  assert.deepEqual(events.entries(), [definition])
  assert.equal(unregisterDef(), undefined)
  assert.deepEqual(events.entries(), [])
  events.registerFallback({ id: 'fb' })
  assert.equal(events.fallbackEntry().id, 'fb')
  events.subscribe(() => {})
  const views = api.services.conversationViews
  views.register({ id: 'view' })
  assert.deepEqual(views.entries().map((entry) => entry.id), ['view'])
  const timer = api.services.timer
  assert.equal(typeof timer.setTimeout(() => {}, 1), 'function')
  assert.equal(await timer.timeout(10), 10)
  const iterator = timer.interval(10)
  assert.equal(typeof iterator[Symbol.asyncIterator], 'function')
  assert.equal(await iterator.next().then((next) => next.value), 60, 'the fixture iterator value is forwarded')
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
    assert.throws(() => api.services.modelDirectories.directoryFor('x'), (error) =>
      error instanceof PluginApiFeatureDisabledError && error.feature === 'client.modelDirectories')
    assert.equal(unhandled, 0)
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})
