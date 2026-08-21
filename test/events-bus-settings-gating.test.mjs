import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { createEventsBus } from '../lib/events-bus.js'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { composeCatalogs } from '../lib/catalog-compose.js'
import { settingsEventsCatalog } from '../lib/settings-events-catalog.js'

const settingsCatalog = composeCatalogs(baseEventsCatalog, settingsEventsCatalog)

function createBusMockCtx() {
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
    hooks,
    on(name, listener) {
      const list = hooksOf(name)
      list.push(listener)
      let removed = false
      return () => {
        if (removed) return false
        removed = true
        const index = list.findIndex((hook) => hook === listener)
        if (index >= 0) {
          list.splice(index, 1)
          return true
        }
        return false
      }
    },
    emit(name, ...args) {
      for (const listener of hooksOf(name)) listener(...args)
    },
  }
}

// Mount-time exclusion is the one and only gating mechanism the
// bus itself performs NO feature gating at subscribe time.

test('bus subscriptions to settings events are ungated when the entries are cataloged', () => {
  const ctx = createBusMockCtx()
  const bus = createEventsBus({ ctx, catalog: settingsCatalog })

  let updated
  let documentUpdated
  assert.doesNotThrow(() => {
    bus.on('settings/updated', (...args) => {
      updated = args
    })
    bus.on('settings/document-updated', (...args) => {
      documentUpdated = args
    })
  })

  ctx.emit('settings/updated', 'my-plugin', { a: 1 }, { a: 0 }, 'update')
  ctx.emit('settings/document-updated', 'my-plugin', 7)

  assert.deepEqual(updated, ['my-plugin', { a: 1 }, { a: 0 }, 'update'])
  assert.deepEqual(documentUpdated, ['my-plugin', 7])
})

function createApplyMockCtx(services) {
  const state = {
    pluginApi: undefined,
    effects: [],
    listeners: [],
  }
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
    effect(fn, label) {
      state.effects.push({ fn, label })
    },
    on(name, listener) {
      state.listeners.push({ name, listener })
      return () => false
    },
    once(name, listener) {
      state.listeners.push({ name, listener, once: true })
      return () => false
    },
    emit() {},
    serial() {},
    parallel() {},
    bail() {},
    waterfall() {},
  }
  return { ctx, state }
}

const FULL_SERVICES_EXCEPT_SETTINGS = {
  llm: {
    resolveModelInfo() {},
    prepareCall() {},
    stream() {},
    registerAdapter() {},
    registerConfigurableProviders() {},
    registerModelDiscovery() {},
  },
  agents: { get() {}, list() {}, roots() {} },
  tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
  sessions: { get() {}, list() {}, fork() {} },
  systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
  apiProxy: { sessions: { prompt() {}, selectModel() {} } },
  web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
}

test('settings guard failure excludes the settings slice from the composed catalog', () => {
  // settings service present but malformed (missing register) => guard fails
  const { ctx, state } = createApplyMockCtx({
    ...FULL_SERVICES_EXCEPT_SETTINGS,
    settings: { describe() {}, get() {}, mutate() {} },
  })
  assert.doesNotThrow(() => apply(ctx))

  const settingsFeature = state.pluginApi.features.find((f) => f.name === 'settings')
  assert.equal(settingsFeature.isActive, false)

  assert.equal(state.pluginApi.events.catalog['settings/updated'], undefined)
  assert.equal(state.pluginApi.events.catalog['settings/document-updated'], undefined)

  // non-cataloged name: subscription falls through to raw ctx.on (no facade treatment)
  const listener = () => {}
  state.pluginApi.events.on('settings/updated', listener)
  assert.ok(state.listeners.some((l) => l.name === 'settings/updated'))
})

test('settings guard pass keeps the settings slice in the composed catalog', () => {
  const { ctx, state } = createApplyMockCtx({
    ...FULL_SERVICES_EXCEPT_SETTINGS,
    settings: { register() {}, describe() {}, get() {}, mutate() {} },
  })
  assert.doesNotThrow(() => apply(ctx))

  const settingsFeature = state.pluginApi.features.find((f) => f.name === 'settings')
  assert.equal(settingsFeature.isActive, true)
  assert.ok(state.pluginApi.events.catalog['settings/updated'])
  assert.ok(state.pluginApi.events.catalog['settings/document-updated'])
})
