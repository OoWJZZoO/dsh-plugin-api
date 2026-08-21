import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  PluginApiFeatureDisabledError,
  PluginApiInactiveError,
  PluginApiServiceUnavailableError,
} from '../lib/errors.js'
import {
  createOfficialAgentLeaf,
  createOfficialLlmLeaf,
  createOfficialSessionLeaf,
  createOfficialSettingsLeaf,
  createOfficialSystemPromptLeaf,
  createOfficialToolsLeaf,
} from '../lib/official-host-namespaces.js'

function assertFeatureDisabled(action, feature) {
  assert.throws(action, (error) => (
    error instanceof PluginApiFeatureDisabledError && error.feature === feature
  ))
}

function assertServiceUnavailable(action) {
  assert.throws(action, (error) => (
    error instanceof PluginApiServiceUnavailableError && error.service === 'settings'
  ))
}

function createRecorder(names) {
  const calls = []
  const source = {}
  for (const name of names) {
    source[name] = function (...args) {
      calls.push({ name, receiver: this, args })
      if (name === 'listProviders') return false
      if (name === 'discoverModels') return Promise.resolve(args[1])
      if (name === 'flush') return Promise.resolve('flush-result')
      if (name === 'assemble') return Promise.resolve(args[0])
      if (name === 'update') return Promise.resolve('update-result')
      return `${name}-result`
    }
  }
  return { source, calls }
}

test('each leaf exposes only its approved member names', () => {
  const llm = createRecorder([
    'listProviders', 'listConfigurableProviders', 'discoverModels',
    'providerRetryPolicy', 'listModels', 'resolveCallConfig',
  ])
  const agent = createRecorder([
    'currentInitiator', 'requireInitiator', 'withInitiator', 'withoutInitiator', 'isOwnedBy',
  ])
  const session = createRecorder(['create', 'prepare', 'enter', 'announce', 'flush'])
  const tools = createRecorder(['executionMode'])
  const prompt = createRecorder(['assemble'])
  const settings = {
    writable: false,
    prepareDocument() {},
    get() {},
    update() {},
    replace() {},
    mutate() {},
  }
  const leaves = [
    [createOfficialLlmLeaf({ llm: llm.source, publicExports: { contentHasImage() {}, createUserMessage() {}, BlockAssembler: class {} } }).api,
      ['listProviders', 'listConfigurableProviders', 'discoverModels', 'providerRetryPolicy', 'listModels', 'resolveCallConfig', 'contentHasImage', 'createUserMessage', 'BlockAssembler']],
    [createOfficialAgentLeaf({ registry: agent.source, agentOptions: {} }).api,
      ['currentInitiator', 'requireInitiator', 'withInitiator', 'withoutInitiator', 'isOwnedBy', 'options']],
    [createOfficialSessionLeaf({ sessions: session.source, session: { append() {}, deriveEventMessage() {} } }).api,
      ['create', 'prepare', 'enter', 'announce', 'flush', 'append', 'deriveEventMessage']],
    [createOfficialToolsLeaf({ tools: tools.source, publicExports: { defineTool() {} } }).api,
      ['executionMode', 'defineTool']],
    [createOfficialSystemPromptLeaf({ systemPrompt: prompt.source }).api, ['assemble']],
    [createOfficialSettingsLeaf({ settings }).api,
      ['writable', 'prepareDocument', 'get', 'update', 'replace', 'mutate']],
  ]
  for (const [api, names] of leaves) assert.deepEqual(Object.keys(api), names)
})

test('official methods preserve receiver, arguments, falsey values, promises, and errors', async () => {
  const llm = createRecorder([
    'listProviders', 'listConfigurableProviders', 'discoverModels',
    'providerRetryPolicy', 'listModels', 'resolveCallConfig',
  ])
  const llmLeaf = createOfficialLlmLeaf({ llm: llm.source, publicExports: { contentHasImage() {}, createUserMessage() {}, BlockAssembler: class {} } })
  const signal = { signal: true }
  assert.equal(llmLeaf.api.listProviders('x'), false)
  const discovered = llmLeaf.api.discoverModels('settings', signal)
  assert.equal(await discovered, signal)
  assert.deepEqual(llm.calls[0].args, ['x'])
  assert.strictEqual(llm.calls[0].receiver, llm.source)
  assert.deepEqual(llm.calls[1].args, ['settings', signal])

  const expectedError = new Error('official failure')
  const service = {
    fail(...args) {
      assert.deepEqual(args, ['a', undefined])
      throw expectedError
    },
    promise() {
      return promise
    },
    disposer() {
      return disposer
    },
  }
  const promise = Promise.resolve('done')
  const disposer = () => 'disposed'
  const leaf = createOfficialSystemPromptLeaf({ systemPrompt: { assemble: service.promise, fail: service.fail, disposer: service.disposer } })
  assert.strictEqual(leaf.api.assemble(), promise)
  const generic = createOfficialToolsLeaf({ tools: service, publicExports: { defineTool: service.promise } })
  assert.strictEqual(generic.api.defineTool(), promise)
  assertFeatureDisabled(() => generic.api.executionMode({}), 'tools')
  assert.throws(() => {
    const failing = createOfficialLlmLeaf({ llm: { resolveCallConfig: service.fail }, publicExports: {} })
    failing.api.resolveCallConfig('a', undefined)
  }, (error) => error === expectedError)
  const settings = createOfficialSettingsLeaf({
    settings: {
      writable: true,
      prepareDocument: service.disposer,
      get() {},
      update() {},
      replace() {},
      mutate() {},
    },
  })
  assert.strictEqual(settings.api.prepareDocument(), disposer)
})

test('agent, session, and tool operations preserve their official calls', async () => {
  const agent = createRecorder([
    'currentInitiator', 'requireInitiator', 'withInitiator', 'withoutInitiator', 'isOwnedBy',
  ])
  const agentLeaf = createOfficialAgentLeaf({ registry: agent.source, agentOptions: {} }).api
  const owner = { id: 'owner' }
  const initiator = { id: 'initiator' }
  assert.equal(agentLeaf.currentInitiator(owner), 'currentInitiator-result')
  assert.equal(agentLeaf.requireInitiator(initiator), 'requireInitiator-result')
  assert.equal(agentLeaf.withInitiator(initiator, () => 'callback'), 'withInitiator-result')
  assert.equal(agentLeaf.withoutInitiator(() => 'callback'), 'withoutInitiator-result')
  assert.equal(agentLeaf.isOwnedBy(owner, initiator), 'isOwnedBy-result')
  assert.deepEqual(agent.calls.map(({ name, args }) => ({ name, args })), [
    { name: 'currentInitiator', args: [owner] },
    { name: 'requireInitiator', args: [initiator] },
    { name: 'withInitiator', args: [initiator, assert.match] },
    { name: 'withoutInitiator', args: [assert.match] },
    { name: 'isOwnedBy', args: [owner, initiator] },
  ].map((expected, index) => ({
    name: expected.name,
    args: expected.args.map((arg, argIndex) => arg === assert.match ? agent.calls[index].args[argIndex] : arg),
  })))
  for (const call of agent.calls) assert.strictEqual(call.receiver, agent.source)

  const session = createRecorder(['create', 'prepare', 'enter', 'announce', 'flush'])
  const sessionLeaf = createOfficialSessionLeaf({ sessions: session.source }).api
  const sessionArgs = [
    ['create', 'scope'],
    ['prepare', 'session', { mode: 'read' }],
    ['enter', 'session'],
    ['announce', 'session', 'message'],
    ['flush', 'session'],
  ]
  const sessionResults = [
    sessionLeaf.create('scope'),
    sessionLeaf.prepare('session', { mode: 'read' }),
    sessionLeaf.enter('session'),
    sessionLeaf.announce('session', 'message'),
    await sessionLeaf.flush('session'),
  ]
  assert.deepEqual(sessionResults.slice(0, 4), ['create-result', 'prepare-result', 'enter-result', 'announce-result'])
  assert.equal(sessionResults[4], 'flush-result')
  assert.deepEqual(session.calls.map(({ name, args }) => ({ name, args })), sessionArgs.map(([name, ...args]) => ({ name, args })))
  for (const call of session.calls) assert.strictEqual(call.receiver, session.source)

  const tools = createRecorder(['executionMode'])
  const defineTool = function (options) { return options }
  const toolsLeaf = createOfficialToolsLeaf({ tools: tools.source, publicExports: { defineTool } }).api
  const execution = { id: 'execution' }
  const options = { name: 'tool' }
  assert.equal(toolsLeaf.executionMode(execution), 'executionMode-result')
  assert.strictEqual(toolsLeaf.defineTool(options), options)
  assert.deepEqual(tools.calls[0].args, [execution])
  assert.strictEqual(tools.calls[0].receiver, tools.source)
})

test('public construction artifacts retain official identity', () => {
  const contentHasImage = () => true
  const createUserMessage = () => ({})
  class BlockAssembler {}
  const leaf = createOfficialLlmLeaf({
    llm: {},
    publicExports: { contentHasImage, createUserMessage, BlockAssembler },
  })
  assert.strictEqual(leaf.api.contentHasImage, contentHasImage)
  assert.strictEqual(leaf.api.createUserMessage, createUserMessage)
  assert.strictEqual(leaf.api.BlockAssembler, BlockAssembler)
})

test('agent options are an exact frozen snapshot including undefined values', () => {
  const options = { provider: 'provider-a', model: 'model-a', maxTokens: undefined, privateState: {} }
  const agent = { options }
  const registry = createRecorder(['currentInitiator', 'requireInitiator', 'withInitiator', 'withoutInitiator', 'isOwnedBy'])
  registry.source.currentInitiator = function () {
    return agent
  }
  const leaf = createOfficialAgentLeaf({ registry: registry.source })
  assert.deepEqual(Object.keys(leaf.api.options), ['provider', 'model', 'maxTokens'])
  assert.deepEqual(leaf.api.options, { provider: 'provider-a', model: 'model-a', maxTokens: undefined })
  assert.ok(Object.isFrozen(leaf.api.options))
  assert.equal('privateState' in leaf.api.options, false)
  options.provider = 'changed'
  options.model = 'changed'
  assert.deepEqual(leaf.api.options, { provider: 'provider-a', model: 'model-a', maxTokens: undefined })
  assert.equal(leaf.api.options, leaf.api.options)
})

test('malformed agent options remain locally disabled', () => {
  const agent = {}
  Object.defineProperty(agent, 'options', {
    get() {
      throw new Error('options unavailable')
    },
  })
  const registry = { currentInitiator() { return agent } }
  const leaf = createOfficialAgentLeaf({ registry }).api
  assertFeatureDisabled(() => leaf.options, 'agent')
})

test('missing members remain local failures while available members stay usable', () => {
  const llm = createOfficialLlmLeaf({ llm: { listProviders() { return [] } }, publicExports: {} }).api
  assert.deepEqual(llm.listProviders(), [])
  assertFeatureDisabled(() => llm.listModels('x'), 'llm')
  assertFeatureDisabled(() => llm.contentHasImage([]), 'llm')

  const settings = createOfficialSettingsLeaf({ settings: { get() { return 0 } } }).api
  assert.equal(settings.get('x'), 0)
  assertFeatureDisabled(() => settings.update('x', {}), 'settings')
  assertFeatureDisabled(() => settings.writable, 'settings')
})

test('inactive roots fail before touching official members', () => {
  let reads = 0
  const source = {
    get value() {
      reads += 1
      return false
    },
    listProviders() {
      reads += 1
      return []
    },
  }
  const leaf = createOfficialLlmLeaf({ llm: source, publicExports: {}, active: false }).api
  assert.throws(() => leaf.listProviders(), PluginApiInactiveError)
  assert.equal(reads, 0)
})

test('retained references invalidate and stale cleanup cannot remove a newer leaf', () => {
  let current
  const cleanups = []
  const source = { listProviders() { return [] } }
  const firstToken = {}
  const first = createOfficialLlmLeaf({
    llm: source,
    publicExports: {},
    token: firstToken,
    isCurrent: (token) => current === token,
    onDispose: (token) => cleanups.push(token),
  })
  current = firstToken
  const secondToken = {}
  const second = createOfficialLlmLeaf({
    llm: source,
    publicExports: {},
    token: secondToken,
    isCurrent: (token) => current === token,
    onDispose: (token) => cleanups.push(token),
  })
  current = secondToken
  assert.equal(first.dispose(), true)
  assert.deepEqual(cleanups, [])
  assertFeatureDisabled(() => first.api.listProviders(), 'llm')
  assert.equal(second.api.listProviders().length, 0)
  assert.equal(second.dispose(), true)
  assert.deepEqual(cleanups, [secondToken])
  assert.equal(second.dispose(), false)
})

test('settings service lookup failures are distinct from malformed members', () => {
  const missing = createOfficialSettingsLeaf({ ctx: { get() { return undefined } } }).api
  assertServiceUnavailable(() => missing.writable)
  assertServiceUnavailable(() => missing.get('x'))

  const throwing = createOfficialSettingsLeaf({ ctx: { get() { throw new Error('lookup') } } }).api
  assertServiceUnavailable(() => throwing.update('x', {}))

  const partial = createOfficialSettingsLeaf({
    ctx: { get() { return { writable: true, get() { return 'value' }, update: undefined } } },
  }).api
  assert.equal(partial.writable, true)
  assert.equal(partial.get('x'), 'value')
  assertFeatureDisabled(() => partial.update('x', {}), 'settings')
  assertFeatureDisabled(() => partial.replace('x', {}), 'settings')

  const explicitThrowing = {}
  Object.defineProperty(explicitThrowing, 'settings', {
    get() {
      throw new Error('settings lookup failed')
    },
  })
  const throwingExplicit = createOfficialSettingsLeaf(explicitThrowing).api
  assertServiceUnavailable(() => throwingExplicit.get('x'))
})

test('session target methods preserve the target receiver and omit only the explicit target', () => {
  const calls = []
  const target = {
    append(...args) {
      calls.push({ receiver: this, args })
      return false
    },
    deriveEventMessage(...args) {
      calls.push({ receiver: this, args })
      return null
    },
  }
  const api = createOfficialSessionLeaf({ sessions: {}, }).api
  assert.equal(api.append(target, 'kind', { value: 1 }), false)
  assert.equal(api.deriveEventMessage(target, { seq: 1 }), null)
  assert.strictEqual(calls[0].receiver, target)
  assert.deepEqual(calls[0].args, ['kind', { value: 1 }])
  assert.strictEqual(calls[1].receiver, target)
  assert.deepEqual(calls[1].args, [{ seq: 1 }])
})

test('the leaf stays a direct passthrough and does not import shared dispatch semantics', () => {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'official-host-namespaces.js')
  const source = readFileSync(path, 'utf8')
  assert.doesNotMatch(source, /waterfall|deepFreeze|createEventsBus|composeCatalogs/)
})
