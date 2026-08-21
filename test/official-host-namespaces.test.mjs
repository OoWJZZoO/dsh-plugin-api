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

test('agent, session, and tool operations preserve identity and call contracts', async () => {
  const agentCalls = []
  const owner = { id: 'owner' }
  const initiator = { id: 'initiator' }
  const callback = () => 'callback'
  const callbackWithout = () => 'callback-without'
  const currentResult = { kind: 'current' }
  const requireResult = { kind: 'required' }
  const withResult = { kind: 'with' }
  const disposer = () => 'disposed'
  const ownedResult = false
  const agentError = new Error('agent failure')
  const agentSource = {
    currentInitiator(...args) {
      agentCalls.push({ name: 'currentInitiator', receiver: this, args })
      return currentResult
    },
    requireInitiator(...args) {
      agentCalls.push({ name: 'requireInitiator', receiver: this, args })
      return requireResult
    },
    withInitiator(...args) {
      agentCalls.push({ name: 'withInitiator', receiver: this, args })
      return withResult
    },
    withoutInitiator(...args) {
      agentCalls.push({ name: 'withoutInitiator', receiver: this, args })
      return disposer
    },
    isOwnedBy(...args) {
      agentCalls.push({ name: 'isOwnedBy', receiver: this, args })
      return ownedResult
    },
  }
  const agentLeaf = createOfficialAgentLeaf({ registry: agentSource, agentOptions: {} }).api
  assert.strictEqual(agentLeaf.currentInitiator(owner), currentResult)
  assert.strictEqual(agentLeaf.requireInitiator(initiator), requireResult)
  assert.strictEqual(agentLeaf.withInitiator(initiator, callback), withResult)
  assert.strictEqual(agentLeaf.withoutInitiator(callbackWithout), disposer)
  assert.strictEqual(agentLeaf.isOwnedBy(owner, initiator), ownedResult)
  assert.deepEqual(agentCalls.map(({ name, args }) => ({ name, args })), [
    { name: 'currentInitiator', args: [owner] },
    { name: 'requireInitiator', args: [initiator] },
    { name: 'withInitiator', args: [initiator, callback] },
    { name: 'withoutInitiator', args: [callbackWithout] },
    { name: 'isOwnedBy', args: [owner, initiator] },
  ])
  for (const call of agentCalls) assert.strictEqual(call.receiver, agentSource)

  const failingAgentLeaf = createOfficialAgentLeaf({
    registry: {
      requireInitiator() {
        throw agentError
      },
    },
    agentOptions: {},
  }).api
  assert.throws(() => failingAgentLeaf.requireInitiator(initiator), (error) => error === agentError)

  const sessionCalls = []
  const sessionResults = {
    create: { kind: 'created' },
    prepare: { kind: 'prepared' },
    enter: { kind: 'entered' },
    announce: { kind: 'announced' },
  }
  const flushPromise = Promise.resolve({ kind: 'flushed' })
  const sessionSource = {
    create(...args) {
      sessionCalls.push({ name: 'create', receiver: this, args })
      return sessionResults.create
    },
    prepare(...args) {
      sessionCalls.push({ name: 'prepare', receiver: this, args })
      return sessionResults.prepare
    },
    enter(...args) {
      sessionCalls.push({ name: 'enter', receiver: this, args })
      return sessionResults.enter
    },
    announce(...args) {
      sessionCalls.push({ name: 'announce', receiver: this, args })
      return sessionResults.announce
    },
    flush(...args) {
      sessionCalls.push({ name: 'flush', receiver: this, args })
      return flushPromise
    },
  }
  const sessionLeaf = createOfficialSessionLeaf({ sessions: sessionSource }).api
  const session = { id: 'session' }
  const scope = { id: 'scope' }
  const announcement = { id: 'announcement' }
  assert.strictEqual(sessionLeaf.create(scope), sessionResults.create)
  assert.strictEqual(sessionLeaf.prepare(session, { mode: 'read' }), sessionResults.prepare)
  assert.strictEqual(sessionLeaf.enter(session), sessionResults.enter)
  assert.strictEqual(sessionLeaf.announce(session, announcement), sessionResults.announce)
  assert.strictEqual(sessionLeaf.flush(session), flushPromise)
  assert.deepEqual(sessionCalls.map(({ name, args }) => ({ name, args })), [
    { name: 'create', args: [scope] },
    { name: 'prepare', args: [session, { mode: 'read' }] },
    { name: 'enter', args: [session] },
    { name: 'announce', args: [session, announcement] },
    { name: 'flush', args: [session] },
  ])
  for (const call of sessionCalls) assert.strictEqual(call.receiver, sessionSource)

  const sessionError = new Error('session failure')
  const failingSessionLeaf = createOfficialSessionLeaf({
    sessions: { create() { throw sessionError } },
  }).api
  assert.throws(() => failingSessionLeaf.create(scope), (error) => error === sessionError)

  const toolCalls = []
  const execution = { id: 'execution' }
  const options = { name: 'tool' }
  const modeResult = false
  const definitionResult = { kind: 'definition' }
  const toolSource = {
    executionMode(...args) {
      toolCalls.push({ name: 'executionMode', receiver: this, args })
      return modeResult
    },
  }
  const publicTools = {
    defineTool(...args) {
      toolCalls.push({ name: 'defineTool', receiver: this, args })
      return definitionResult
    },
  }
  const toolsLeaf = createOfficialToolsLeaf({ tools: toolSource, publicExports: publicTools }).api
  assert.strictEqual(toolsLeaf.executionMode(execution), modeResult)
  assert.strictEqual(toolsLeaf.defineTool(options), definitionResult)
  assert.deepEqual(toolCalls.map(({ name, receiver, args }) => ({ name, receiver, args })), [
    { name: 'executionMode', receiver: toolSource, args: [execution] },
    { name: 'defineTool', receiver: publicTools, args: [options] },
  ])
  const toolError = new Error('tool failure')
  const failingToolsLeaf = createOfficialToolsLeaf({
    tools: { executionMode() { throw toolError } },
    publicExports: { defineTool() { return definitionResult } },
  }).api
  assert.throws(() => failingToolsLeaf.executionMode(execution), (error) => error === toolError)
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
