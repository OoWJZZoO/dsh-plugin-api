import test from 'node:test'
import assert from 'node:assert/strict'
import { LlmRuntime, LlmError } from '../lib/forked-runtime.js'

/**
 * Minimal Cordis-shaped harness for the LlmRuntime contract matrix. The
 * runtime only needs `effect` (disposer registration), `waterfall` (the
 * `llm/stream` outer dispatch), `events.dispatch` (adapter-topology
 * listeners) and `logger`. No real Cordis app is required.
 */
function createHarness() {
  const listeners = new Map()
  const ctx = {
    reflect: {
      provide(name, instance) {
        ctx[name] = instance
      },
    },
    logger: { warn() {} },
    events: {
      dispatch(mode, [name]) {
        return [...(listeners.get(name) ?? [])]
      },
    },
    waterfall(self, name, arg, callback) {
      return callback()
    },
    effect(fn) {
      const iterator = fn()
      let cleanup = () => {}
      let result
      while (!(result = iterator.next()).done) {
        if (typeof result.value === 'function') cleanup = result.value
      }
      let released = false
      return () => {
        if (released) return
        released = true
        cleanup()
      }
    },
    on(name, listener) {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      return () => {
        const index = list.indexOf(listener)
        if (index >= 0) list.splice(index, 1)
      }
    },
    emit(name) {
      for (const listener of listeners.get(name) ?? []) listener()
    },
  }
  return { ctx, listeners }
}

function makeAdapter({ streamImpl, listModelsImpl, resolveModelImpl, retryPolicy } = {}) {
  return {
    providerInfo(provider) {
      return { id: provider, name: provider }
    },
    providerRetryPolicy() {
      return retryPolicy
    },
    async listModels(provider) {
      if (listModelsImpl) return listModelsImpl(provider)
      return [{ provider, id: `${provider}-m1`, name: 'Model 1' }]
    },
    async resolveModel(provider, model) {
      if (resolveModelImpl) return resolveModelImpl(provider, model)
      return { provider, id: model, name: 'Model 1' }
    },
    stream(options) {
      if (streamImpl) return streamImpl(options)
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: 'ok' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

async function collect(iterable) {
  const chunks = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function instantiate() {
  const { ctx, listeners } = createHarness()
  const runtime = new LlmRuntime(ctx)
  return { ctx, listeners, runtime }
}

test('registerAdapter registers routes and listProviders returns detached metadata', async () => {
  const { runtime } = instantiate()
  const handle = runtime.registerAdapter(['alpha', 'beta'], makeAdapter())
  const providers = runtime.listProviders()
  assert.deepEqual(providers, [
    { id: 'alpha', name: 'alpha' },
    { id: 'beta', name: 'beta' },
  ])
  handle()
  assert.deepEqual(runtime.listProviders(), [])
})

test('registerAdapter emits llm/adapters-updated exactly once per commit point', async () => {
  const { ctx, runtime } = instantiate()
  let emissions = 0
  ctx.on('llm/adapters-updated', () => emissions++)
  const handle = runtime.registerAdapter(['alpha'], makeAdapter())
  assert.equal(emissions, 1, 'initial registration emits once')
  handle.replace(['beta'])
  assert.equal(emissions, 2, 'replace emits once')
  handle()
  assert.equal(emissions, 3, 'dispose emits once')
})

test('registerAdapter rejects empty providers with INVALID_ADAPTER before committing', async () => {
  const { ctx, runtime } = instantiate()
  let emissions = 0
  ctx.on('llm/adapters-updated', () => emissions++)
  assert.throws(() => runtime.registerAdapter([], makeAdapter()), (error) => {
    assert.ok(error instanceof LlmError)
    assert.equal(error.code, 'INVALID_ADAPTER')
    return true
  })
  assert.equal(emissions, 0)
})

test('registerAdapter rejects a duplicate provider all-or-nothing with DUPLICATE_ADAPTER', async () => {
  const { runtime } = instantiate()
  runtime.registerAdapter(['alpha'], makeAdapter())
  assert.throws(() => runtime.registerAdapter(['alpha'], makeAdapter()), (error) => {
    assert.equal(error.code, 'DUPLICATE_ADAPTER')
    return true
  })
  // all-or-nothing: a second valid route must not be committed alongside the duplicate
  assert.deepEqual(runtime.listProviders(), [{ id: 'alpha', name: 'alpha' }])
})

test('registerAdapter rejects invalid provider metadata with INVALID_ADAPTER', async () => {
  const { runtime } = instantiate()
  const bad = {
    ...makeAdapter(),
    providerInfo() {
      return { id: 'other', name: 'x' }
    },
  }
  assert.throws(() => runtime.registerAdapter(['alpha'], bad), (error) => {
    assert.equal(error.code, 'INVALID_ADAPTER')
    return true
  })
  assert.deepEqual(runtime.listProviders(), [])
})

test('replace is atomic and a disposed registration cannot replace (REGISTRATION_DISPOSED)', async () => {
  const { runtime } = instantiate()
  const handle = runtime.registerAdapter(['alpha'], makeAdapter())
  handle.replace(['alpha', 'gamma'])
  assert.deepEqual(runtime.listProviders(), [
    { id: 'alpha', name: 'alpha' },
    { id: 'gamma', name: 'gamma' },
  ])
  handle()
  assert.throws(() => handle.replace(['delta']), (error) => {
    assert.equal(error.code, 'REGISTRATION_DISPOSED')
    return true
  })
  assert.deepEqual(runtime.listProviders(), [])
})

test('registerConfigurableProviders validates, replaces atomically, and disposes', async () => {
  const { ctx, runtime } = instantiate()
  let emissions = 0
  ctx.on('llm/adapters-updated', () => emissions++)
  const entry = (provider) => ({
    provider,
    displayName: provider,
    settingsNs: `ns.${provider}`,
    settingsPath: ['providers', provider],
  })
  assert.throws(() => runtime.registerConfigurableProviders([]), (error) => {
    assert.equal(error.code, 'INVALID_DIRECTORY')
    return true
  })
  const handle = runtime.registerConfigurableProviders([entry('p1'), entry('p2')])
  assert.deepEqual(runtime.listConfigurableProviders().map((e) => e.provider), ['p1', 'p2'])
  assert.throws(() => runtime.registerConfigurableProviders([entry('p1')]), (error) => {
    assert.equal(error.code, 'DUPLICATE_DIRECTORY')
    return true
  })
  handle.replace([entry('p1'), entry('p3')])
  assert.deepEqual(runtime.listConfigurableProviders().map((e) => e.provider), ['p1', 'p3'])
  assert.throws(() => handle.replace([{ ...entry('p1'), settingsPath: [''] }]), (error) => {
    assert.equal(error.code, 'INVALID_DIRECTORY')
    return true
  })
  handle()
  assert.deepEqual(runtime.listConfigurableProviders(), [])
  assert.equal(emissions, 3, 'initial + replace emit once each; rejected replace emits nothing; dispose emits once')
})

test('registerModelDiscovery and discoverModels validate and deduplicate', async () => {
  const { runtime } = instantiate()
  assert.throws(() => runtime.registerModelDiscovery('', () => {}), (error) => {
    assert.equal(error.code, 'INVALID_DISCOVERY')
    return true
  })
  const dispose = runtime.registerModelDiscovery('ns', async () => [
    { id: 'a', name: 'A' },
    { id: 'a' },
    { id: 'b' },
  ])
  assert.throws(() => runtime.registerModelDiscovery('ns', async () => []), (error) => {
    assert.equal(error.code, 'DUPLICATE_DISCOVERY')
    return true
  })
  const models = await runtime.discoverModels('ns', { provider: 'x' })
  assert.deepEqual(models, [{ id: 'a', name: 'A' }, { id: 'b' }])
  await assert.rejects(() => runtime.discoverModels('other', { provider: 'x' }), (error) => {
    assert.equal(error.code, 'NO_DISCOVERY')
    return true
  })
  dispose()
  await assert.rejects(() => runtime.discoverModels('ns', { provider: 'x' }), (error) => {
    assert.equal(error.code, 'NO_DISCOVERY')
    return true
  })
})

test('listModels validates catalog entries with INVALID_CATALOG', async () => {
  const { runtime } = instantiate()
  runtime.registerAdapter(['alpha'], makeAdapter({
    listModelsImpl: async (provider) => [{ provider: 'wrong', id: 'x', name: 'X' }],
  }))
  await assert.rejects(() => runtime.listModels('alpha'), (error) => {
    assert.equal(error.code, 'INVALID_CATALOG')
    return true
  })
})

test('resolveModelInfo validates exact model metadata with INVALID_MODEL_*', async () => {
  const { runtime } = instantiate()
  runtime.registerAdapter(['alpha'], makeAdapter({
    resolveModelImpl: async () => ({ provider: 'wrong', id: 'x', name: 'X' }),
  }))
  await assert.rejects(() => runtime.resolveModelInfo('alpha', 'm'), (error) => {
    assert.equal(error.code, 'INVALID_MODEL_INFO')
    return true
  })
})

test('resolveCallConfig rejects unsupported reasoning effort with UNSUPPORTED_REASONING_EFFORT', async () => {
  const { runtime } = instantiate()
  runtime.registerAdapter(['alpha'], makeAdapter({
    resolveModelImpl: async (provider, model) => ({
      provider,
      id: model,
      name: 'M',
      reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' },
    }),
  }))
  await assert.rejects(() => runtime.resolveCallConfig({ provider: 'alpha', model: 'm', reasoningEffort: 'high' }), (error) => {
    assert.equal(error.code, 'UNSUPPORTED_REASONING_EFFORT')
    return true
  })
})

test('prepareCall is one-shot and rejects a config change with INVALID_PREPARED_CALL', async () => {
  const { runtime } = instantiate()
  runtime.registerAdapter(['alpha'], makeAdapter())
  const prepared = await runtime.prepareCall({ provider: 'alpha', model: 'alpha-m1', messages: [] })
  const chunks = await collect(prepared.stream({ provider: 'alpha', model: 'alpha-m1', messages: [] }))
  assert.equal(chunks[chunks.length - 1].type, 'finish')
  assert.throws(() => prepared.stream({ provider: 'alpha', model: 'alpha-m1', messages: [] }), (error) => {
    assert.equal(error.code, 'INVALID_PREPARED_CALL')
    return true
  })
})

test('stream passes through the official waterfall and normalizes an adapter throw', async () => {
  const { ctx, runtime } = instantiate()
  let waterfallSeen = false
  const originalWaterfall = ctx.waterfall
  ctx.waterfall = (self, name, arg, callback) => {
    if (name === 'llm/stream') waterfallSeen = true
    return originalWaterfall(self, name, arg, callback)
  }
  runtime.registerAdapter(['alpha'], makeAdapter({
    streamImpl() {
      return (async function* () {
        throw new LlmError('boom', 'SERVER')
      })()
    },
  }))
  const chunks = await collect(runtime.stream({ provider: 'alpha', model: 'alpha-m1', messages: [] }))
  assert.equal(waterfallSeen, true)
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].type, 'finish')
  assert.equal(chunks[0].reason.kind, 'error')
  assert.equal(chunks[0].reason.failure.code, 'SERVER')
})

test('stream maps caller abort to the aborted finish kind', async () => {
  const { runtime } = instantiate()
  const controller = new AbortController()
  controller.abort()
  runtime.registerAdapter(['alpha'], makeAdapter({
    streamImpl(options) {
      return (async function* () {
        throw options.signal.reason
      })()
    },
  }))
  const chunks = await collect(runtime.stream({ provider: 'alpha', model: 'alpha-m1', messages: [], signal: controller.signal }))
  assert.equal(chunks[0].type, 'finish')
  assert.equal(chunks[0].reason.kind, 'aborted')
})

test('adapterStream cleans up an abandoned iterator', async () => {
  const { runtime } = instantiate()
  let returned = false
  runtime.registerAdapter(['alpha'], makeAdapter({
    streamImpl() {
      return {
        [Symbol.asyncIterator]() {
          let index = 0
          return {
            async next() {
              index += 1
              if (index === 1) return { done: false, value: { type: 'text-delta', index: 0, text: 'a' } }
              await new Promise(() => {})
              return { done: true }
            },
            async return() {
              returned = true
              return { done: true }
            },
          }
        },
      }
    },
  }))
  const stream = runtime.stream({ provider: 'alpha', model: 'alpha-m1', messages: [] })
  const first = await stream.next()
  assert.equal(first.value.type, 'text-delta')
  await stream.return()
  assert.equal(returned, true, 'an abandoned stream must close the adapter iterator')
})

test('providerRetryPolicy resolves the provider-owned policy', async () => {
  const { runtime } = instantiate()
  const retryPolicy = { mode: 'normal', maxRetries: 5, retryableCodes: ['SERVER'], backoff: { initialDelayMs: 10, maxDelayMs: 20, jitterRatio: 0.1 } }
  runtime.registerAdapter(['alpha'], makeAdapter({ retryPolicy }))
  const resolved = runtime.providerRetryPolicy('alpha')
  assert.equal(resolved.mode, 'normal')
  assert.equal(resolved.maxRetries, 5)
})

test('no-decoration streams match the official chunk contract (text + finish)', async () => {
  const { runtime } = instantiate()
  runtime.registerAdapter(['alpha'], makeAdapter())
  const chunks = await collect(runtime.stream({ provider: 'alpha', model: 'alpha-m1', messages: [] }))
  assert.deepEqual(chunks, [
    { type: 'text-delta', index: 0, text: 'ok' },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
})
