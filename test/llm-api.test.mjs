import test from 'node:test'
import assert from 'node:assert/strict'
import { createLlmApi } from '../lib/llm-api.js'
import { deepFreeze } from '../lib/deep-freeze.js'

function createMockLlm(overrides = {}) {
  const noAdapter = () => {
    throw new Error('NO_ADAPTER')
  }
  return {
    resolveModelInfo: async () => ({ provider: 'p', model: 'm', name: 'M' }),
    prepareCall: async () => ({ config: {}, stream() {}, retryPolicy: {}, adapterDefaults: {} }),
    stream: () => ({ [Symbol.asyncIterator]() { return this } }),
    registerAdapter: () => () => {},
    registerConfigurableProviders: () => () => {},
    registerModelDiscovery: () => () => {},
    ...overrides,
  }
}

test('modelInfo delegates with provider/model and returns a deep-frozen detached result', async () => {
  const seen = []
  const resolved = {
    provider: 'deepseek',
    id: 'chat',
    name: 'DeepSeek Chat',
    inputModalities: ['text'],
    context: { contextWindow: 128000 },
  }
  const llm = createMockLlm({
    resolveModelInfo(provider, model, signal) {
      seen.push([provider, model, signal])
      return Promise.resolve(resolved)
    },
  })
  const api = createLlmApi({ llm, deepFreeze })

  const info = await api.modelInfo('deepseek', 'chat')

  assert.equal(info, resolved)
  assert.ok(Object.isFrozen(info))
  assert.ok(Object.isFrozen(info.inputModalities))
  assert.ok(Object.isFrozen(info.context))
  assert.deepEqual(seen, [['deepseek', 'chat', undefined]])
  assert.equal('resolveModelInfo' in api, false)
})

test('modelInfo forwards the provided signal as the third argument', async () => {
  const seen = []
  const signal = new AbortController().signal
  const llm = createMockLlm({
    resolveModelInfo(provider, model, receivedSignal) {
      seen.push([provider, model, receivedSignal])
      return Promise.resolve({ provider, id: model, name: model })
    },
  })
  const api = createLlmApi({ llm, deepFreeze })

  await api.modelInfo('p', 'm', signal)

  assert.deepEqual(seen, [['p', 'm', signal]])
})

test('modelInfo rejects with the same error object from the official service', async () => {
  const boom = new Error('INVALID_MODEL_INFO')
  const llm = createMockLlm({
    async resolveModelInfo() {
      throw boom
    },
  })
  const api = createLlmApi({ llm, deepFreeze })

  await assert.rejects(
    () => api.modelInfo('p', 'm'),
    (error) => error === boom,
  )
})

test('prepareCall delegates without signal and returns the official value unchanged', async () => {
  const seen = []
  const prepared = { config: { provider: 'p', model: 'm' }, stream() {} }
  const llm = createMockLlm({
    async prepareCall(config, signal) {
      seen.push([config, signal])
      return prepared
    },
  })
  const api = createLlmApi({ llm, deepFreeze })
  const config = { provider: 'p', model: 'm' }

  const result = await api.prepareCall(config)

  assert.equal(result, prepared)
  assert.deepEqual(seen, [[config, undefined]])
})

test('prepareCall forwards the provided signal and rejects with the same error', async () => {
  const signal = new AbortController().signal
  const boom = new Error('PREPARE_BOOM')
  const seen = []
  const llm = createMockLlm({
    async prepareCall(config, receivedSignal) {
      seen.push([config, receivedSignal])
      throw boom
    },
  })
  const api = createLlmApi({ llm, deepFreeze })
  const config = { provider: 'p', model: 'm' }

  await assert.rejects(
    () => api.prepareCall(config, signal),
    (error) => error === boom,
  )
  assert.deepEqual(seen, [[config, signal]])
})

test('stream delegates and returns the official value unchanged', () => {
  const streamResult = { [Symbol.asyncIterator]() { return this } }
  const seen = []
  const llm = createMockLlm({
    stream(options) {
      seen.push(options)
      return streamResult
    },
  })
  const api = createLlmApi({ llm, deepFreeze })
  const options = { provider: 'p', model: 'm', messages: [] }

  const result = api.stream(options)

  assert.equal(result, streamResult)
  assert.equal(seen[0], options)
})

test('stream rethrows the same error object from the official service', () => {
  const boom = new Error('STREAM_BOOM')
  const llm = createMockLlm({
    stream() {
      throw boom
    },
  })
  const api = createLlmApi({ llm, deepFreeze })

  assert.throws(
    () => api.stream({ provider: 'p', model: 'm', messages: [] }),
    (error) => error === boom,
  )
})

test('registerAdapter delegates with the same arguments and returns the official handle unchanged', () => {
  const seen = []
  const handle = () => {}
  handle.replace = () => {}
  const llm = createMockLlm({
    registerAdapter(providers, adapter) {
      seen.push([providers, adapter])
      return handle
    },
  })
  const api = createLlmApi({ llm, deepFreeze })
  const providers = ['p']
  const adapter = { providerInfo() {}, providerRetryPolicy() {}, listModels() {}, resolveModel() {}, stream() {} }

  const result = api.registerAdapter(providers, adapter)

  assert.equal(result, handle)
  assert.equal(seen[0][0], providers)
  assert.equal(seen[0][1], adapter)
})

test('registerAdapter rethrows the same error object from the official service', () => {
  const boom = new Error('DUPLICATE_ADAPTER')
  const llm = createMockLlm({
    registerAdapter() {
      throw boom
    },
  })
  const api = createLlmApi({ llm, deepFreeze })

  assert.throws(
    () => api.registerAdapter(['p'], {}),
    (error) => error === boom,
  )
})

test('registerConfigurableProviders delegates with the same arguments and returns the official handle unchanged', () => {
  const seen = []
  const handle = () => {}
  handle.replace = () => {}
  const llm = createMockLlm({
    registerConfigurableProviders(entries) {
      seen.push(entries)
      return handle
    },
  })
  const api = createLlmApi({ llm, deepFreeze })
  const entries = [{ provider: 'p', displayName: 'P', settingsNs: 'ns', settingsPath: [] }]

  const result = api.registerConfigurableProviders(entries)

  assert.equal(result, handle)
  assert.equal(seen[0], entries)
})

test('registerModelDiscovery delegates with the same arguments and returns the official disposer unchanged', () => {
  const seen = []
  const disposer = () => {}
  const discover = async () => []
  const llm = createMockLlm({
    registerModelDiscovery(settingsNs, receivedDiscover) {
      seen.push([settingsNs, receivedDiscover])
      return disposer
    },
  })
  const api = createLlmApi({ llm, deepFreeze })

  const result = api.registerModelDiscovery('ns', discover)

  assert.equal(result, disposer)
  assert.deepEqual(seen, [['ns', discover]])
})

test('registerConfigurableProviders and registerModelDiscovery rethrow official errors unchanged', () => {
  const directoryBoom = new Error('DUPLICATE_DIRECTORY')
  const discoveryBoom = new Error('DUPLICATE_DISCOVERY')
  const llm = createMockLlm({
    registerConfigurableProviders() {
      throw directoryBoom
    },
    registerModelDiscovery() {
      throw discoveryBoom
    },
  })
  const api = createLlmApi({ llm, deepFreeze })

  assert.throws(
    () => api.registerConfigurableProviders([]),
    (error) => error === directoryBoom,
  )
  assert.throws(
    () => api.registerModelDiscovery('ns', async () => []),
    (error) => error === discoveryBoom,
  )
})
