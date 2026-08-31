import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { llmEventsCatalog } from '../lib/llm-events-catalog.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

function createMockCtx(options = {}) {
  const llm = options.llm ?? {
    resolveModelInfo() {},
    prepareCall() {},
    stream() {},
    registerAdapter() {},
    registerConfigurableProviders() {},
    registerModelDiscovery() {},
  }
  const services = {
    llm,
    agents: { get() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: {
      registerSearchProvider() {},
      registerFetchProvider() {},
      search() {},
      fetch() {},
    },
    ...(options.services ?? {}),
  }
  const state = {
    pluginApi: undefined,
    provideCount: 0,
    effects: [],
    listeners: [],
  }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') {
          state.pluginApi = value
          state.provideCount += 1
        }
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
      return () => {}
    },
    once() {},
    emit() {},
    serial() {},
    parallel() {},
    bail() {},
    ...(options.events === false ? {} : { waterfall() {} }),
  }
  return { ctx, state, services }
}

test('llm feature guard passes: apply mounts all six llm methods and keeps admission surface', () => {
  const { ctx, state } = createMockCtx()
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)
  assert.equal(state.pluginApi.llm.isActive, true)

  for (const method of [
    'modelInfo',
    'prepareCall',
    'stream',
    'registerAdapter',
    'registerConfigurableProviders',
    'registerModelDiscovery',
  ]) {
    assert.equal(typeof state.pluginApi.llm[method], 'function', `missing llm.${method}`)
  }
  assert.equal(typeof state.pluginApi.llm.admissionPolicies, 'object')
  assert.equal(typeof state.pluginApi.llm.admissionPolicies.register, 'function')
  // admission.isActive is retired; the feature registry is the sole signal.
  assert.equal('isActive' in state.pluginApi.llm.admissionPolicies, false)
  assert.equal(typeof state.pluginApi.llm.requestTransforms.register, 'function')
})

test('llm guard failure disables only llm, keeps facade active, and excludes LLM catalog entries', () => {
  const llm = {
    resolveModelInfo() {},
    stream() {},
    registerAdapter() {},
    registerConfigurableProviders() {},
    registerModelDiscovery() {},
    // prepareCall intentionally missing
  }
  const { ctx, state } = createMockCtx({ llm })
  assert.doesNotThrow(() => apply(ctx))

  assert.ok(state.pluginApi)
  assert.equal(state.pluginApi.isActive, true)
  assert.equal(state.pluginApi.llm.isActive, false)

  const features = state.pluginApi._registry.snapshot().filter((feature) => feature.name !== 'officialPassthrough')
  const llmFeature = features.find((f) => f.name === 'llm')
  assert.ok(llmFeature, 'llm feature must be registered as disabled')
  assert.equal(llmFeature.isActive, false)
  assert.match(llmFeature.reason, /llm\.prepareCall/)

  assert.ok(llmEventsCatalog['llm/stream'])
  assert.ok(llmEventsCatalog['llm/adapters-updated'])
  assert.equal(state.pluginApi.events.catalog()['llm/stream'], undefined, 'disabled feature slice is excluded')
  assert.equal(state.pluginApi.events.catalog()['llm/adapters-updated'], undefined, 'disabled feature slice is excluded')

  for (const method of [
    'modelInfo',
    'prepareCall',
    'stream',
    'registerAdapter',
    'registerConfigurableProviders',
    'registerModelDiscovery',
  ]) {
    assert.throws(
      () => state.pluginApi.llm[method](),
      (error) => {
        assert.ok(error instanceof PluginApiFeatureDisabledError)
        assert.equal(error.feature, 'llm')
        return true
      },
    )
  }
})

test('llm feature mount is idempotent on re-apply', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)
  const firstLlm = state.pluginApi.llm
  const provideCount = state.provideCount

  assert.doesNotThrow(() => apply(ctx))

  assert.deepEqual(Object.keys(state.pluginApi.llm), Object.keys(firstLlm))
  assert.ok(Object.isFrozen(state.pluginApi.llm))
  assert.equal(state.provideCount, provideCount)
  assert.equal(state.pluginApi.llm.isActive, true)
})

test('apply never throws when ctx.get is hostile', () => {
  const base = createMockCtx()
  const hostile = {
    ...base.ctx,
    get() {
      throw new Error('hostile get')
    },
  }
  assert.doesNotThrow(() => apply(hostile))
})
