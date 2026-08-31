import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { createPluginApiService } from '../../../lib/plugin-api-service.js'
import { createFeatureRegistry } from '../../../lib/feature-registry.js'
import { runFeatureGuard } from '../../../lib/guards.js'
import {
  LlmAdaptersConflictError,
  LlmAdaptersUnavailableError,
  LlmAdaptersValidationError,
  PluginApiFeatureDisabledError,
  PluginApiInactiveError,
} from '../../../lib/errors.js'
import { resolveMarkedLlmDecoration, mountLlmAdaptersFeature } from '../../../lib/index.js'
import { attachDecorationRegistry } from '../lib/decoration-registry.js'
import { LlmRuntime } from '../lib/forked-runtime.js'

const LLM_COMPONENT_MARKER = Symbol.for('dsh-plugin-api.llm.contract')
const LLM_DECORATION_FACET = Symbol.for('dsh-plugin-api.llm.decoration')

function makeCtx({ entries = [], root } = {}) {
  const ctx = new Context()
  ctx.root = root ?? ctx
  ctx.loader = {
    entries() {
      return entries[Symbol.iterator]()
    },
  }
  return ctx
}

function llmEntry({ disabled = false, id = 'llm', rowName = '@deepseek-ai/dsh-llm' } = {}) {
  return { options: { id, name: rowName }, fiber: {}, disabled }
}

function replacementEntry({ disabled = false, id = 'plugin-api-llm', rowName = '@deepseek-ai/dsh-plugin-api-llm' } = {}) {
  return { options: { id, name: rowName }, fiber: {}, disabled }
}

function activeService({ ctx, provider = null, registry }) {
  const reg = registry ?? createFeatureRegistry()
  const ServiceClass = createPluginApiService({
    apiVersion: '0.1',
    registry: reg,
    coreActive: true,
  })
  const service = new ServiceClass(ctx)
  if (provider) service._setLlmAdaptersProvider(provider)
  return { service, registry: reg }
}

function makeReplacementFacet() {
  const ctx = new Context()
  const runtime = new LlmRuntime(ctx)
  const attached = attachDecorationRegistry(runtime)
  return attached
}

function callerCtx(name = 'my-plugin') {
  const fiber = { name }
  const ctx = { fiber, loader: { entries: () => [{ fiber, options: { name } }] }, effect() {} }
  return ctx
}

/** Decorate through a caller-bound surface so owner derivation resolves. */
function decorateViaCaller(service, definition, name = 'my-plugin') {
  return service._llmAdaptersForCaller(callerCtx(name)).register(definition)
}

const validDefinition = {
  id: 'metrics',
  match: () => true,
  capabilities: { execution: { phases: ['stream'], retry: 'none' } },
  wrap: async function* (op) {
    yield* await op.next()
  },
}

test('the llmAdapters guard passes with exactly one active replacement row and the official row disabled', () => {
  const ctx = makeCtx({ entries: [llmEntry({ disabled: true }), replacementEntry()] })
  const result = runFeatureGuard('llmAdapters', ctx, {})
  assert.equal(result.ok, true, JSON.stringify(result.problems))
})

test('the llmAdapters guard fails when the official row is still enabled', () => {
  const ctx = makeCtx({ entries: [llmEntry(), replacementEntry()] })
  const result = runFeatureGuard('llmAdapters', ctx, {})
  assert.equal(result.ok, false)
})

test('the llmAdapters guard fails on a duplicate replacement row', () => {
  const ctx = makeCtx({ entries: [llmEntry({ disabled: true }), replacementEntry(), replacementEntry()] })
  const result = runFeatureGuard('llmAdapters', ctx, {})
  assert.equal(result.ok, false)
})

test('the llmAdapters guard fails when the loader is unavailable', () => {
  const ctx = makeCtx({ entries: [] })
  delete ctx.loader
  const result = runFeatureGuard('llmAdapters', ctx, {})
  assert.equal(result.ok, false)
})

test('pluginApi.llm.adapters exists but throws typed errors while the registry is inactive', () => {
  const { service } = activeService({ ctx: makeCtx() })
  assert.equal(typeof service.llm.adapters.register, 'function')
  assert.equal(typeof service.llm.adapters.list, 'function')
  assert.throws(
    () => service.llm.adapters.register({}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      assert.equal(error.feature, 'llmAdapters')
      return true
    },
  )
})

test('pluginApi.llm.adapters throws PluginApiInactiveError when the facade is inactive', () => {
  const registry = createFeatureRegistry()
  const ctx = makeCtx()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: false })
  const service = new ServiceClass(ctx)
  assert.throws(
    () => service.llm.adapters.register({}),
    (error) => error instanceof PluginApiInactiveError,
  )
})

test('register with an unresolved replacement facet throws a typed disabled error', () => {
  const registry = createFeatureRegistry()
  registry.mount('llmAdapters')
  const { service } = activeService({ ctx: makeCtx(), registry, provider: () => null })
  assert.throws(
    () => service.llm.adapters.register({}),
    (error) => {
      assert.ok(error instanceof PluginApiFeatureDisabledError)
      return true
    },
  )
})

test('register without a resolvable caller owner throws typed unavailable (never the facade)', () => {
  const registry = createFeatureRegistry()
  registry.mount('llmAdapters')
  const attached = makeReplacementFacet()
  const { service } = activeService({ ctx: makeCtx(), registry, provider: () => attached.facet })
  // A caller context with no fiber and no loader cannot be attributed; the
  // facade must not invent an owner.
  const anonymousCtx = { effect() {} }
  assert.throws(
    () => service._llmAdaptersForCaller(anonymousCtx).register(validDefinition),
    (error) => {
      assert.ok(error instanceof LlmAdaptersUnavailableError)
      return true
    },
  )
})

test('a caller-owned decoration succeeds, returns a handle, and is reflected in the projection', () => {
  const registry = createFeatureRegistry()
  registry.mount('llmAdapters')
  const attached = makeReplacementFacet()
  // Register an adapter so the decoration has bindings to match
  const runCtx = new Context()
  const runtime = new LlmRuntime(runCtx)
  const handle = runtime.registerAdapter(['demo'], {
    providerInfo: (p) => ({ id: p, name: p }),
    providerRetryPolicy: () => {},
    async listModels(p) { return [] },
    async resolveModel(p, m) { return { provider: p, id: m, name: 'M' } },
    stream() { return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })() },
  })
  attached.registry.adapter.onAdapterRoutesCommitted(
    new Set(['demo']),
    [{ adapter: runtime.adapters.get('demo'), provider: { id: 'demo', name: 'demo' }, retryPolicy: { mode: 'normal', maxRetries: 1, retryableCodes: ['SERVER'] } }],
    {},
  )
  const { service } = activeService({ ctx: makeCtx(), registry, provider: () => attached.facet })
  // Use a crafted caller context with a resolvable fiber/loader entry
  const fiber = { name: 'my-plugin' }
  const callerCtx = {
    fiber,
    loader: { entries: () => [{ fiber, options: { name: 'my-plugin' } }] },
    effect() {},
  }
  const surface = service._llmAdaptersForCaller(callerCtx)
  const decoHandle = surface.register({
    id: 'metrics',
    match: () => true,
    capabilities: { execution: { phases: ['stream'], retry: 'none' } },
    wrap: async function* (op) { yield* await op.next() },
  })
  assert.equal(typeof decoHandle.dispose, 'function')
  assert.equal(typeof decoHandle.snapshot, 'function')
  const list = decoHandle.snapshot()
  assert.equal(list.id, 'metrics')
  assert.equal(list.owner, 'my-plugin')
  assert.ok(Object.isFrozen(list))
  handle()
})

test('a conflicting same-owner registration raises a typed conflict error', () => {
  const registry = createFeatureRegistry()
  registry.mount('llmAdapters')
  const attached = makeReplacementFacet()
  const { service } = activeService({ ctx: makeCtx(), registry, provider: () => attached.facet })
  decorateViaCaller(service, validDefinition)
  assert.throws(
    () => decorateViaCaller(service, { ...validDefinition, priority: 'high' }),
    (error) => error instanceof LlmAdaptersConflictError,
  )
})

test('an invalid decoration definition raises a typed validation error', () => {
  const registry = createFeatureRegistry()
  registry.mount('llmAdapters')
  const attached = makeReplacementFacet()
  const { service } = activeService({ ctx: makeCtx(), registry, provider: () => attached.facet })
  assert.throws(
    () => decorateViaCaller(service, { id: '', match: () => true, wrap: async function* () {} }),
    (error) => error instanceof LlmAdaptersValidationError,
  )
})

test('dispose is idempotent and a disposed handle snapshot is a no-op', () => {
  const registry = createFeatureRegistry()
  registry.mount('llmAdapters')
  const attached = makeReplacementFacet()
  const { service } = activeService({ ctx: makeCtx(), registry, provider: () => attached.facet })
  const handle = decorateViaCaller(service, {
    id: 'temp',
    match: () => true,
    capabilities: { execution: { phases: ['stream'], retry: 'none' } },
    wrap: async function* (op) {
      yield* await op.next()
    },
  })
  handle.dispose()
  handle.dispose() // idempotent
  assert.equal(handle.snapshot(), undefined)
})

test('a caller whose loader entry resolves to the facade itself is rejected as unavailable', () => {
  const registry = createFeatureRegistry()
  registry.mount('llmAdapters')
  const attached = makeReplacementFacet()
  const { service } = activeService({ ctx: makeCtx(), registry, provider: () => attached.facet })
  // access through a caller context that resolves to the facade's own row
  const facadeCtx = callerCtx('@deepseek-ai/dsh-plugin-api-main')
  assert.throws(
    () => service._llmAdaptersForCaller(facadeCtx).register({
      id: 'metrics',
      match: () => true,
      capabilities: { execution: { phases: ['stream'], retry: 'none' } },
      wrap: async function* (op) {
        yield* await op.next()
      },
    }),
    (error) => error instanceof LlmAdaptersUnavailableError,
  )
})

test('pluginApi.llm existing members are unaffected by the adapters surface', () => {
  const registry = createFeatureRegistry()
  registry.mount('llmAdapters')
  const { service } = activeService({ ctx: makeCtx(), registry })
  assert.equal(typeof service.llm.modelInfo, 'function')
  assert.equal(typeof service.llm.prepareCall, 'function')
  assert.equal(typeof service.llm.stream, 'function')
  assert.equal(typeof service.llm.adapters.register, 'function')
  assert.equal(typeof service.llm.providers.register, 'function')
  assert.equal(typeof service.llm.models.register, 'function')
})

test('resolveMarkedLlmDecoration resolves the replacement facet when the marker, composition and version agree', () => {
  const ctx = makeCtx({ entries: [llmEntry({ disabled: true }), replacementEntry()] })
  const root = ctx
  root[LLM_COMPONENT_MARKER] = {
    package: '@deepseek-ai/dsh-plugin-api-llm',
    rowId: 'plugin-api-llm',
    runtime: '0.1.0-rc.6',
    api: '0.1',
  }
  const attached = makeReplacementFacet()
  root[LLM_DECORATION_FACET] = attached.facet
  const facet = resolveMarkedLlmDecoration(ctx, {
    readManifest: (name) => {
      if (name === '@deepseek-ai/dsh-plugin-api-llm') return { version: '0.1.0-rc.6-0.1.0', api: '0.1' }
      return undefined
    },
  })
  assert.equal(facet, attached.facet)
})

test('resolveMarkedLlmDecoration returns null when the official row is enabled', () => {
  const ctx = makeCtx({ entries: [llmEntry(), replacementEntry()] })
  const root = ctx
  root[LLM_COMPONENT_MARKER] = {
    package: '@deepseek-ai/dsh-plugin-api-llm',
    rowId: 'plugin-api-llm',
    runtime: '0.1.0-rc.6',
    api: '0.1',
  }
  const attached = makeReplacementFacet()
  root[LLM_DECORATION_FACET] = attached.facet
  const facet = resolveMarkedLlmDecoration(ctx, {
    readManifest: (name) => (name === '@deepseek-ai/dsh-plugin-api-llm' ? { version: '0.1.0-rc.6-0.1.0', api: '0.1' } : undefined),
  })
  assert.equal(facet, null)
})

test('resolveMarkedLlmDecoration returns null on a marker mismatch', () => {
  const ctx = makeCtx({ entries: [llmEntry({ disabled: true }), replacementEntry()] })
  const root = ctx
  root[LLM_COMPONENT_MARKER] = { package: 'someone-else', rowId: 'plugin-api-llm', runtime: '0.1.0-rc.6', api: '0.1' }
  const attached = makeReplacementFacet()
  root[LLM_DECORATION_FACET] = attached.facet
  const facet = resolveMarkedLlmDecoration(ctx, {
    readManifest: (name) => (name === '@deepseek-ai/dsh-plugin-api-llm' ? { version: '0.1.0-rc.6-0.1.0', api: '0.1' } : undefined),
  })
  assert.equal(facet, null)
})

test('mountLlmAdaptersFeature disables the feature on an auxiliary manifest mismatch', () => {
  const registry = createFeatureRegistry()
  const ctx = makeCtx({ entries: [llmEntry({ disabled: true }), replacementEntry()] })
  const diagnostics = []
  mountLlmAdaptersFeature({
    ctx,
    service: {},
    featureRegistry: registry,
    logger: { error: (message) => diagnostics.push(message) },
    facadeContract: { runtime: '0.1.0-rc.6', api: '0.1' },
    auxiliaryManifests: { llm: { version: '0.1.0-rc.6-0.8', api: '0.8' } },
  })
  assert.equal(registry.isActive('llmAdapters'), false, 'a version mismatch must not mount the feature')
  assert.ok(diagnostics.length >= 1, 'a bounded diagnostic must be recorded')
})

test('mountLlmAdaptersFeature mounts the feature and installs the resolver on a matching contract', () => {
  const registry = createFeatureRegistry()
  const ctx = makeCtx({ entries: [llmEntry({ disabled: true }), replacementEntry()] })
  let providerInstalled = false
  const service = {
    _setLlmAdaptersProvider(provider) {
      providerInstalled = typeof provider === 'function'
      return true
    },
  }
  mountLlmAdaptersFeature({
    ctx,
    service,
    featureRegistry: registry,
    logger: { error: () => {} },
    facadeContract: { runtime: '0.1.0-rc.6', api: '0.1' },
    auxiliaryManifests: { llm: { version: '0.1.0-rc.6-0.1.0', api: '0.1' } },
  })
  assert.equal(registry.isActive('llmAdapters'), true, 'a matching contract must mount the feature')
  assert.equal(providerInstalled, true, 'the decoration-facet resolver must be installed')
})

test('mountLlmAdaptersFeature disables the feature when the official row is enabled', () => {
  const registry = createFeatureRegistry()
  const ctx = makeCtx({ entries: [llmEntry(), replacementEntry()] })
  mountLlmAdaptersFeature({
    ctx,
    service: {},
    featureRegistry: registry,
    logger: { error: () => {} },
    facadeContract: { runtime: '0.1.0-rc.6', api: '0.1' },
    auxiliaryManifests: { llm: { version: '0.1.0-rc.6-0.1.0', api: '0.1' } },
  })
  assert.equal(registry.isActive('llmAdapters'), false)
})
