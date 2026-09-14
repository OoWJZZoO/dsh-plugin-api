import test from 'node:test'
import assert from 'node:assert/strict'
import { createEventsBus } from '../lib/events-bus.js'
import { baseEventsCatalog, FACADE_PRODUCER_OWNERS } from '../lib/events-catalog.js'
import { composeCatalogs } from '../lib/catalog-compose.js'
import { agentEventsCatalog } from '../lib/agent-events-catalog.js'
import { attentionEventsCatalog } from '../lib/attention-events-catalog.js'
import { llmEventsCatalog } from '../lib/llm-events-catalog.js'
import { sessionLifecycleEventsCatalog } from '../lib/session-events-catalog.js'
import { settingsEventsCatalog } from '../lib/settings-events-catalog.js'
import { systemPromptEventsCatalog } from '../lib/system-prompt-events-catalog.js'
import { toolsEventsCatalog } from '../lib/tools-events-catalog.js'
import { compactionEventsCatalogSlice } from '../lib/compaction-events-catalog.js'
import { sessionTitleEventsCatalogSlice } from '../lib/session-title-events-catalog.js'
import { agentAttemptFactsCatalogSlice } from '../lib/session-interaction-operation-events-catalog.js'
import {
  agentLoopConfigStartFailedEventsCatalog,
  agentPresetSelectedEventsCatalog,
  cordisDynamicLifecycleEventsCatalog,
  cordisInspectLifecycleEventsCatalog,
  storageDomainChangedEventsCatalog,
} from '../lib/official-host-events-catalog.js'

const FACADE_OWNER = '@deepseek-ai/dsh-plugin-api-main'
const THIRD_PARTY_OWNER = '@deepseek-ai/third-party-plugin'

const coreCatalog = composeCatalogs(
  baseEventsCatalog,
  agentEventsCatalog,
  attentionEventsCatalog,
  llmEventsCatalog,
  sessionLifecycleEventsCatalog,
  settingsEventsCatalog,
  systemPromptEventsCatalog,
  toolsEventsCatalog,
)

const hostLeaves = [
  agentLoopConfigStartFailedEventsCatalog,
  agentPresetSelectedEventsCatalog,
  cordisDynamicLifecycleEventsCatalog,
  cordisInspectLifecycleEventsCatalog,
  storageDomainChangedEventsCatalog,
]

/** The static host catalog plus every dynamic replacement slice's entries. */
const everyEntry = (() => {
  const entries = {}
  const catalogs = [
    ...hostLeaves,
    baseEventsCatalog,
    agentEventsCatalog,
    attentionEventsCatalog,
    llmEventsCatalog,
    sessionLifecycleEventsCatalog,
    settingsEventsCatalog,
    systemPromptEventsCatalog,
    toolsEventsCatalog,
  ]
  for (const catalog of catalogs) Object.assign(entries, catalog)
  for (const slice of [compactionEventsCatalogSlice, sessionTitleEventsCatalogSlice, agentAttemptFactsCatalogSlice]) {
    for (const entry of slice.entries) entries[entry.name] = entry
  }
  return entries
})()

/**
 * Minimal Cordis-like context: hook registration plus the five dispatch modes
 * the facade mirrors, with a call log so a denied dispatch can be proven to
 * never reach the cordis context.
 */
function createMockCordisCtx(overrides = {}) {
  const hooks = new Map()
  const calls = []
  const hooksOf = (name) => {
    let list = hooks.get(name)
    if (!list) {
      list = []
      hooks.set(name, list)
    }
    return list
  }
  const context = {
    hooksOf,
    calls,
    on(name, listener) {
      hooksOf(name).push({ callback: listener })
      let removed = false
      return () => {
        if (removed) return false
        removed = true
        const index = hooksOf(name).findIndex((hook) => hook.callback === listener)
        if (index >= 0) {
          hooksOf(name).splice(index, 1)
          return true
        }
        return false
      }
    },
    once(name, listener) {
      const dispose = context.on(name, function onceWrapper(...args) {
        dispose()
        return listener.apply(this, args)
      })
      return dispose
    },
    emit(name, ...args) {
      calls.push({ mode: 'emit', name, args })
      for (const hook of [...hooksOf(name)]) hook.callback(...args)
    },
    async serial(name, ...args) {
      calls.push({ mode: 'serial', name, args })
      for (const hook of [...hooksOf(name)]) await hook.callback(...args)
      return undefined
    },
    async parallel(name, ...args) {
      calls.push({ mode: 'parallel', name, args })
      await Promise.all([...hooksOf(name)].map((hook) => hook.callback(...args)))
      return []
    },
    bail(name, ...args) {
      calls.push({ mode: 'bail', name, args })
      for (const hook of [...hooksOf(name)]) hook.callback(...args)
      return undefined
    },
    waterfall(name, ...args) {
      calls.push({ mode: 'waterfall', name, args })
      const callbacks = [...hooksOf(name)].map((hook) => hook.callback)
      const callArgs = [...args]
      const inner = callArgs.pop()
      const next = () => (callbacks.shift() ?? inner)(...callArgs)
      callArgs.push(next)
      return next()
    },
    ...overrides,
  }
  return context
}

/** Caller-bound owner derivation mirroring the platform fiber/loader trace. */
const resolveOwnerId = (callerCtx) => {
  const fiber = callerCtx?.fiber ?? callerCtx?.ctx?.fiber
  return typeof fiber?.name === 'string' && fiber.name.length > 0 ? fiber.name : undefined
}

const facadeCaller = { ctx: { fiber: { name: FACADE_OWNER } } }
const thirdPartyCaller = { ctx: { fiber: { name: THIRD_PARTY_OWNER } } }

function createHostBus(ctx, options = {}) {
  return createEventsBus({ ctx, catalog: coreCatalog, resolveOwnerId, ...options })
}

// ---------------------------------------------------------------------------
// Catalog declarations
// ---------------------------------------------------------------------------

test('every runtime catalog entry carries a frozen, machine-usable producer declaration', () => {
  const names = Object.keys(everyEntry)
  assert.ok(names.length >= 65, `expected the full host event vocabulary, saw ${names.length}`)
  for (const name of names) {
    const producer = everyEntry[name].producer
    assert.ok(producer && typeof producer === 'object', `${name} must declare a producer`)
    assert.ok(Object.isFrozen(producer), `${name} producer declaration must be frozen`)
    assert.ok(['facade', 'official'].includes(producer.kind), `${name} producer kind must be declared`)
    assert.equal(typeof producer.authority, 'string', `${name} producer authority must be a token`)
    assert.ok(producer.authority.length > 0, `${name} producer authority must be non-empty`)
    assert.ok(Array.isArray(producer.owners), `${name} producer owners must be a list`)
    assert.ok(Object.isFrozen(producer.owners), `${name} producer owners must be frozen`)
  }
})

test('the facade-produced set is exactly the facade-side production paths', () => {
  const facadeProduced = Object.keys(everyEntry)
    .filter((name) => everyEntry[name].producer.kind === 'facade')
    .sort()
  assert.deepEqual(facadeProduced, [
    'agent/attempt/end',
    'agent/attempt/start',
    'attention/update',
    'compaction/completed',
    'compaction/failed',
    'compaction/request',
    'compaction/skipped',
    'compaction/started',
    'session-title/candidate',
  ])
  for (const name of facadeProduced) {
    assert.deepEqual(everyEntry[name].producer.owners, FACADE_PRODUCER_OWNERS)
  }
})

test('official-produced events declare no facade dispatch owner', () => {
  for (const name of ['goal/changed', 'tools/change', 'llm/stream', 'fs/observed', 'session/created', 'agent/created']) {
    assert.equal(everyEntry[name].producer.kind, 'official', `${name} is produced by the official runtime`)
    assert.deepEqual(everyEntry[name].producer.owners, [])
  }
  for (const name of ['attention/update', 'fs/observed']) {
    assert.ok(everyEntry[name].producer.authority.length > 0, `${name} keeps its producing authority token`)
  }
})

test('the public catalog exposes the producer declaration of every visible event', () => {
  const ctx = createMockCordisCtx()
  const events = createHostBus(ctx)
  const catalog = events.catalog()
  assert.equal(catalog['goal/changed'].producer.kind, 'official')
  assert.equal(catalog['goal/changed'].producer.authority, 'goal')
  assert.equal(catalog['attention/update'].producer.kind, 'facade')
  assert.equal(catalog['attention/update'].producer.authority, 'attention')
  assert.ok(Object.isFrozen(catalog['attention/update'].producer))
})

// ---------------------------------------------------------------------------
// Producer decision
// ---------------------------------------------------------------------------

test('the facade production path dispatches facade-produced events and observers see them', async () => {
  const ctx = createMockCordisCtx()
  const events = createHostBus(ctx)
  const seen = []
  events.observe('attention/update').subscribe((payload) => seen.push(payload))

  const emitted = events.emit.call(facadeCaller, 'attention/update', { seq: 1 })
  assert.deepEqual(emitted, { ok: true, code: 'dispatched', outcome: null })
  assert.deepEqual(seen, [{ seq: 1 }], 'the facade-produced event reached facade observers')

  const serial = events.serial.call(facadeCaller, 'attention/update', { seq: 2 })
  assert.equal(typeof serial.then, 'function', 'async modes keep native await semantics')
  assert.deepEqual(await serial, { ok: true, code: 'dispatched', outcome: null })

  const waterfall = events.waterfall.call(facadeCaller, 'attention/update', { seq: 3 }, () => 'chain')
  assert.deepEqual(waterfall, { ok: true, code: 'dispatched', outcome: 'chain' })

  const payloads = seen.map((entry) => (Array.isArray(entry) ? entry[0] : entry))
  assert.deepEqual(payloads, [{ seq: 1 }, { seq: 2 }, { seq: 3 }], 'every allowed dispatch reached the observe feed')
})

test('replacement-produced events admit the facade identity through the dynamic slices', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({
    ctx,
    catalog: coreCatalog,
    rSlices: [compactionEventsCatalogSlice, sessionTitleEventsCatalogSlice, agentAttemptFactsCatalogSlice],
    resolveOwnerId,
  })

  for (const name of ['compaction/started', 'session-title/candidate', 'agent/attempt/end']) {
    const result = events.emit.call(facadeCaller, name, { seq: 1 })
    assert.equal(result.ok, true, `${name} must stay dispatchable by the facade production path`)
    assert.equal(result.code, 'dispatched')
  }
  assert.equal(ctx.calls.length, 3)
})

test('a third-party caller is denied and nothing reaches the cordis context', () => {
  const ctx = createMockCordisCtx()
  const events = createHostBus(ctx)

  const deniedFacadeEvent = events.emit.call(thirdPartyCaller, 'attention/update', { seq: 1 })
  assert.deepEqual(deniedFacadeEvent, {
    ok: false,
    code: 'denied',
    reason: `caller ${THIRD_PARTY_OWNER} is not a declared producer of event attention/update`,
  })
  assert.ok(Object.isFrozen(deniedFacadeEvent))
  assert.deepEqual(Object.keys(deniedFacadeEvent), ['ok', 'code', 'reason'], 'no outcome and no operation identity')

  const deniedOfficialEvent = events.emit.call(thirdPartyCaller, 'goal/changed', { agent: 'a' })
  assert.equal(deniedOfficialEvent.ok, false)
  assert.equal(deniedOfficialEvent.code, 'denied')
  assert.equal(deniedOfficialEvent.reason, 'event goal/changed is produced by the official runtime and cannot be dispatched through the facade')
  assert.ok(Object.isFrozen(deniedOfficialEvent))

  assert.equal(ctx.calls.length, 0, 'a denied dispatch never reaches the cordis context')
})

test('official-produced events stay observation-only for every facade caller', () => {
  const ctx = createMockCordisCtx()
  const events = createHostBus(ctx)

  for (const caller of [facadeCaller, thirdPartyCaller, undefined]) {
    const result = caller === undefined
      ? events.emit('tools/change')
      : events.emit.call(caller, 'tools/change')
    assert.equal(result.code, 'denied', 'the official runtime dispatches this event natively')
    assert.match(result.reason, /produced by the official runtime/)
  }
  assert.equal(ctx.calls.length, 0)
})

test('an untraceable caller falls back to the root token and is denied', () => {
  const ctx = createMockCordisCtx()
  const events = createHostBus(ctx)
  const result = events.emit('attention/update', { seq: 1 })
  assert.equal(result.code, 'denied')
  assert.match(result.reason, /caller root is not a declared producer/)
  assert.equal(ctx.calls.length, 0)
})

test('an entry without a producer declaration is fail-closed for every caller', () => {
  const ctx = createMockCordisCtx()
  const undeclared = {
    'synthetic/undeclared': {
      name: 'synthetic/undeclared',
      mode: 'emit',
      scopeFiltered: false,
      scopeKey: undefined,
      payload: 'none',
      args: '()',
      fault: 'contain',
      freeze: 'all',
    },
  }
  const events = createEventsBus({
    ctx,
    catalog: composeCatalogs(coreCatalog, undeclared),
    resolveOwnerId,
  })

  for (const caller of [facadeCaller, thirdPartyCaller, undefined]) {
    const result = caller === undefined
      ? events.emit('synthetic/undeclared')
      : events.emit.call(caller, 'synthetic/undeclared')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'denied')
    assert.equal(result.reason, 'event synthetic/undeclared declares no producer and cannot be dispatched through the facade')
    assert.ok(Object.isFrozen(result))
  }
  assert.equal(ctx.calls.length, 0)
})

test('a throwing or non-string owner resolver never throws through dispatch', () => {
  const throwingCtx = createMockCordisCtx()
  const throwing = createEventsBus({
    ctx: throwingCtx,
    catalog: coreCatalog,
    resolveOwnerId: () => {
      throw new Error('resolver exploded')
    },
  })
  const denied = throwing.emit.call(facadeCaller, 'attention/update', { seq: 1 })
  assert.equal(denied.code, 'denied')
  assert.match(denied.reason, /caller root is not a declared producer/)
  assert.equal(throwingCtx.calls.length, 0)

  const nonStringCtx = createMockCordisCtx()
  const nonString = createEventsBus({
    ctx: nonStringCtx,
    catalog: coreCatalog,
    resolveOwnerId: () => 42,
  })
  assert.equal(nonString.emit.call(facadeCaller, 'attention/update', { seq: 2 }).code, 'denied')
  assert.equal(nonStringCtx.calls.length, 0)

  const hostileCaller = {
    get ctx() {
      throw new Error('hostile receiver')
    },
  }
  const hostileCtx = createMockCordisCtx()
  const hostile = createEventsBus({ ctx: hostileCtx, catalog: coreCatalog, resolveOwnerId })
  const hostileResult = hostile.emit.call(hostileCaller, 'attention/update', { seq: 3 })
  assert.equal(hostileResult.code, 'denied')
  assert.equal(hostileCtx.calls.length, 0)
})

test('denied is returned synchronously for async modes and keeps the unsupported/error paths intact', async () => {
  const ctx = createMockCordisCtx()
  const events = createHostBus(ctx)

  const denied = events.serial.call(thirdPartyCaller, 'attention/update', { seq: 1 })
  assert.equal(denied.code, 'denied', 'async modes report the typed denial without a promise wrapper')
  assert.deepEqual(await denied, {
    ok: false,
    code: 'denied',
    reason: `caller ${THIRD_PARTY_OWNER} is not a declared producer of event attention/update`,
  })

  const unsupported = events.emit.call(facadeCaller, 'not/cataloged', {})
  assert.deepEqual(unsupported, {
    ok: false,
    code: 'unsupported',
    reason: 'event not/cataloged is not part of the facade event vocabulary',
  })

  const failingCtx = createMockCordisCtx({
    emit() {
      throw new Error('cordis emit exploded')
    },
  })
  const failing = createHostBus(failingCtx)
  const errored = failing.emit.call(facadeCaller, 'attention/update', { seq: 2 })
  assert.deepEqual(errored, { ok: false, code: 'error', reason: 'cordis emit exploded' })
  assert.ok(Object.isFrozen(errored))
})

// ---------------------------------------------------------------------------
// Facade translation path through the mounted facade
// ---------------------------------------------------------------------------

/**
 * Minimal host context for mounting the real facade (`apply`): hook
 * registration with working dispatch, the services the mounted features probe,
 * and a `pluginApi` slot filled by the service's `reflect.provide`.
 */
function createMountedFacadeHarness() {
  const hooks = new Map()
  const hooksOf = (name) => {
    let list = hooks.get(name)
    if (!list) {
      list = []
      hooks.set(name, list)
    }
    return list
  }
  const services = {
    loader: { entries() { return [] } },
    llm: {
      resolveModelInfo() {},
      prepareCall() {},
      stream() {},
      registerAdapter() {},
      registerConfigurableProviders() {},
      registerModelDiscovery() {},
    },
    agents: { get() {}, list() {}, roots() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    sessions: { get() {}, list() {}, fork() {} },
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
  }
  const state = { pluginApi: undefined }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect(fn) { if (typeof fn === 'function') fn() },
    on(name, listener) { hooksOf(name).push(listener); return () => {} },
    once() {},
    emit(name, ...args) { for (const listener of [...hooksOf(name)]) listener(...args) },
    serial() {},
    parallel() {},
    bail() {},
    waterfall() {},
  }
  return { ctx, state }
}

test('the mounted facade translation path publishes without the dispatch member', async () => {
  const { apply } = await import('../lib/index.js')
  const { ctx, state } = createMountedFacadeHarness()
  assert.doesNotThrow(() => apply(ctx))
  const api = state.pluginApi
  assert.equal(typeof api?.events?.emit, 'function')
  assert.equal(typeof api?.attention?.contribute, 'function')

  // The facade's own translation path: a public attention contribution reaches
  // the host hub, whose update the facade publishes natively as
  // `attention/update`. Facade observers receive it without any caller ever
  // touching the producer-guarded dispatch member.
  const seen = []
  api.events.observe('attention/update').subscribe((payload) => seen.push(payload))
  const committed = api.attention.contribute({ id: 'translation-probe', title: 'probe' })
  assert.notEqual(committed.ok, false, 'the contribution path stays available')
  assert.ok(seen.length >= 1, 'the facade translation path still delivers its produced event')
  assert.equal(typeof seen[0], 'object', 'the published message is the attention update payload')

  // The dispatch member is still guarded on the same mounted surface: the
  // untraceable harness caller and a third party cannot produce that event.
  const untraced = api.events.emit('attention/update', {})
  assert.equal(untraced.code, 'denied')
  const thirdParty = api.events.emit.call(
    { ctx: { fiber: { name: THIRD_PARTY_OWNER } } },
    'attention/update',
    {},
  )
  assert.equal(thirdParty.code, 'denied')
  const official = api.events.emit('goal/changed', { change: 'x' })
  assert.equal(official.code, 'denied')
  assert.match(official.reason, /official runtime/)
})

// ---------------------------------------------------------------------------
// Custom publisher path stays unchanged
// ---------------------------------------------------------------------------
test('events.define keeps its owner-scoped publisher semantics beside the producer decision', () => {
  const ctx = createMockCordisCtx()
  const events = createHostBus(ctx)

  const first = events.define.call(thirdPartyCaller, { name: 'plugin-a.custom', freeze: 'all' })
  assert.equal(first.ownerId, THIRD_PARTY_OWNER, 'the publisher owner is derived from the caller context')
  assert.equal(first.name, 'plugin-a.custom')
  assert.deepEqual(Object.keys(first).sort(), ['dispose', 'emit', 'generation', 'id', 'name', 'ownerId'])
  assert.ok(Object.isFrozen(first))

  assert.throws(
    () => events.define.call(thirdPartyCaller, { name: 'goal/changed' }),
    (error) => error.code === 'PLUGIN_API_EVENT_DEFINITION_INVALID' && error.message.includes('canonical event'),
    'a canonical name stays unavailable to the custom publisher entry',
  )
  assert.throws(
    () => events.define({ name: 'plugin-a.custom' }),
    (error) => error.code === 'PLUGIN_API_EVENT_DEFINITION_CONFLICT',
  )

  const seen = []
  events.observe('plugin-a.custom').subscribe((payload) => seen.push(payload))
  assert.deepEqual(first.emit({ seq: 1 }), { ok: true, code: 'dispatched', outcome: null })
  assert.deepEqual(seen, [{ seq: 1 }], 'the owner-scoped publisher dispatches its own custom event')

  assert.equal(first.dispose(), true)
  const stale = first.emit({ seq: 2 })
  assert.equal(stale.code, 'stale', 'the stale publisher result is unchanged')
  assert.equal(first.dispose(), false, 'repeated disposal stays idempotent')
})

test('a denied canonical dispatch never disturbs custom event publishing', () => {
  const ctx = createMockCordisCtx()
  const events = createHostBus(ctx)
  const publisher = events.define.call(thirdPartyCaller, { name: 'plugin-a.unrelated' })
  const seen = []
  events.observe('plugin-a.unrelated').subscribe((payload) => seen.push(payload))

  assert.equal(events.emit.call(thirdPartyCaller, 'attention/update', { seq: 1 }).code, 'denied')
  assert.equal(publisher.emit({ seq: 2 }).ok, true)
  assert.deepEqual(seen, [{ seq: 2 }], 'custom publishing is a separate, unaffected path')
})
