import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CLIENT_CONNECTION_METHODS,
  createClientOfficialConnection,
  createDisabledClientOfficialConnection,
} from '../lib/client-official-connection.js'

function makeConnection(calls, results = {}) {
  const llm = {}
  for (const name of CLIENT_CONNECTION_METHODS) {
    llm[name] = function (...args) {
      assert.equal(this, llm)
      calls.push({ name, args })
      return results[name]
    }
  }
  return { api: { llm } }
}

test('connection exposes exactly the nested LLM face and preserves receiver, arguments, and Promise identity', () => {
  const calls = []
  const results = {
    providers: Promise.resolve(['provider']),
    models: Promise.resolve(['model']),
    discoverModels: Promise.resolve(['discovered']),
  }
  const connection = makeConnection(calls, results)
  const facade = createClientOfficialConnection({ connection })
  assert.deepEqual(Object.keys(facade.api), ['isActive', 'api'])
  assert.deepEqual(Object.keys(facade.api.api), ['llm'])
  assert.deepEqual(Object.keys(facade.api.api.llm), CLIENT_CONNECTION_METHODS)
  assert.equal(facade.api.isActive, true)

  const payload = { provider: 'example' }
  const signal = new AbortController().signal
  assert.equal(facade.api.api.llm.providers(payload, signal), results.providers)
  assert.equal(facade.api.api.llm.models(payload), results.models)
  assert.equal(facade.api.api.llm.discoverModels(payload, signal), results.discoverModels)
  assert.deepEqual(calls, [
    { name: 'providers', args: [payload, signal] },
    { name: 'models', args: [payload] },
    { name: 'discoverModels', args: [payload, signal] },
  ])
})

test('connection preserves official throws and rejected Promise identity', async () => {
  const thrown = new Error('official connection failure')
  const rejected = Promise.reject(new Error('official connection rejection'))
  const calls = []
  const connection = makeConnection(calls, { providers: Promise.resolve(), models: rejected, discoverModels: Promise.resolve() })
  connection.api.llm.providers = function () { throw thrown }
  const facade = createClientOfficialConnection({ connection })
  assert.throws(() => facade.api.api.llm.providers(), (error) => error === thrown)
  assert.equal(facade.api.api.llm.models(), rejected)
  await assert.rejects(rejected, (error) => error.message === 'official connection rejection')
})

test('connection method accessors are validated again at call time', () => {
  let reads = 0
  const llm = {}
  Object.defineProperty(llm, 'providers', {
    get() {
      reads += 1
      return reads === 1 ? function () {} : undefined
    },
  })
  llm.models = function () {}
  llm.discoverModels = function () {}
  const facade = createClientOfficialConnection({ connection: { api: { llm } } })

  assert.equal(facade.api.isActive, true)
  assert.throws(
    () => facade.api.api.llm.providers(),
    (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'client.connection',
  )
  assert.equal(facade.api.isActive, false)
})

test('connection resolution is lazy and malformed providers disable only the connection leaf', () => {
  const calls = []
  const connection = makeConnection(calls)
  let reads = 0
  const facade = createClientOfficialConnection({
    resolveConnection() {
      reads += 1
      return connection
    },
  })
  assert.equal(reads, 0)
  assert.equal(facade.api.isActive, true)
  assert.equal(reads, 1)

  const malformed = createClientOfficialConnection({ connection: { api: { llm: { providers() {} } } } })
  assert.equal(malformed.api.isActive, false)
  assert.throws(
    () => malformed.api.api.llm.providers(),
    (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'client.connection',
  )
})

test('root inactivity wins before resolving the official connection', () => {
  let reads = 0
  const facade = createClientOfficialConnection({
    active: () => false,
    resolveConnection() {
      reads += 1
      return makeConnection([])
    },
  })
  assert.equal(facade.api.isActive, false)
  assert.equal(reads, 0)
  assert.throws(() => facade.api.api.llm.providers(), (error) => error.code === 'PLUGIN_API_INACTIVE')
})

test('reapplying a connection leaf protects the newer owner from stale cleanup', () => {
  const ownerScope = {}
  const first = createClientOfficialConnection({ ownerScope, connection: makeConnection([]) })
  const second = createClientOfficialConnection({ ownerScope, connection: makeConnection([]) })
  assert.equal(first.api.isActive, false)
  assert.equal(second.api.isActive, true)
  assert.equal(first.dispose(), false)
  assert.equal(second.api.isActive, true)
})

test('connection publication cleanup rejection is contained and the disabled face keeps its shape', async () => {
  const logs = []
  const cleanupError = new Error('connection cleanup failed')
  const facade = createClientOfficialConnection({
    connection: makeConnection([]),
    logger: { error(message, error) { logs.push([message, error]) } },
    publish() {
      return () => Promise.reject(cleanupError)
    },
  })
  await facade.dispose()
  assert.equal(logs[0][1], cleanupError)
  assert.equal(facade.api.isActive, false)

  const disabled = createDisabledClientOfficialConnection()
  assert.deepEqual(Object.keys(disabled.api.api.llm), CLIENT_CONNECTION_METHODS)
  assert.throws(
    () => disabled.api.api.llm.providers(),
    (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED' && error.feature === 'client.connection',
  )
})
