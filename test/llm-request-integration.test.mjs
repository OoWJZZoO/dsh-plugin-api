import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import {
  LlmInputPolicyError,
  LlmRequestInvalidResultError,
} from '../lib/errors.js'

const imageBlock = (attachmentId = 'attachment-1') => ({
  type: 'image',
  attachment: { attachmentId, mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
})
const textBlock = (text) => ({ type: 'text', text })

function makeRequest(content, signal = new AbortController().signal) {
  return {
    provider: 'provider-a',
    model: 'model-a',
    sessionId: 'session-1',
    messages: [{ id: 'message-1', role: 'user', source: { kind: 'user' }, content }],
    signal,
  }
}

/**
 * Full facade integration harness: apply() mounts every feature, the mock
 * llm.stream dispatches the registered raw llm/stream listener chain like the
 * official waterfall, and apiProxy sessions run the official admission check
 * shape inside gateway scopes.
 */
function createHarness(options = {}) {
  const originalInfo = options.originalInfo ?? {
    provider: 'provider-a',
    id: 'model-a',
    name: 'model-a',
    inputModalities: ['text'],
  }
  const state = { pluginApi: undefined, effects: [], listeners: [], streamCalls: 0 }
  const resolverCalls = []
  const services = {
    llm: {
      async resolveModelInfo(provider, model) {
        resolverCalls.push({ provider, model })
        if (options.resolveModelInfo) return options.resolveModelInfo(provider, model)
        return originalInfo
      },
      prepareCall() {},
      stream(request) {
        state.streamCalls += 1
        const listeners = state.listeners.filter((l) => l.name === 'llm/stream').map((l) => l.listener)
        let index = 0
        const next = () => {
          const current = listeners[index++]
          if (!current) return options.streamTerminal ? options.streamTerminal(request) : 'official-terminal'
          return current(request, next)
        }
        return next()
      },
      registerAdapter() {},
      registerConfigurableProviders() {},
      registerModelDiscovery() {},
    },
    agents: { get() { return options.agent } },
    apiProxy: {
      sessions: {
        async prompt(request) {
          const info = await services.llm.resolveModelInfo('provider-a', 'model-a')
          if (info.inputModalities !== undefined && !info.inputModalities.includes('image')) {
            return { ok: false, code: 'attachment-error' }
          }
          if (options.promptBody) await options.promptBody(services.llm)
          return { ok: true, accepted: true }
        },
        async selectModel(request) {
          const info = await services.llm.resolveModelInfo(request.payload.provider, request.payload.model)
          if (info.inputModalities !== undefined && !info.inputModalities.includes('image')) {
            return { ok: false, code: 'model-unavailable' }
          }
          return { ok: true, selected: true }
        },
      },
    },
    tools: {
      register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {},
    },
    sessions: { get() {}, list() {}, fork() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
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
      return () => {}
    },
    once() {},
    emit() {},
    serial() {},
    parallel() {},
    bail() {},
    waterfall() {},
  }
  apply(ctx)
  const streamListeners = state.listeners.filter((l) => l.name === 'llm/stream')
  assert.equal(streamListeners.length, 1, 'the request owner installs exactly one raw llm/stream listener')
  const streamListener = streamListeners[0].listener

  function streamEntry(request, finalNext) {
    return streamListener(request, finalNext ?? (() => 'official-terminal'))
  }

  function registerPolicy(policy) {
    return state.pluginApi.llm.admission.register({ id: 'img-policy', input: 'image', match() { return true }, process() { return { kind: 'pass' } }, validate() { return true }, ...policy })
  }

  return { ctx, state, services, resolverCalls, streamEntry, registerPolicy }
}

test('no synthetic llm/request catalog entry is exposed', () => {
  const harness = createHarness()
  assert.equal(harness.state.pluginApi.events.catalog['llm/request'], undefined,
    'the unified pipeline must not expose a synthetic llm/request event')
  assert.equal(harness.state.pluginApi.events.catalog['llm/admission'], undefined)
})

test('native-image target bypasses the policy phase and continues with the original request', async () => {
  const harness = createHarness({
    originalInfo: { provider: 'provider-a', id: 'model-a', name: 'model-a', inputModalities: ['text', 'image'] },
  })
  let processCalls = 0
  harness.registerPolicy({
    process() { processCalls += 1; return { kind: 'pass' } },
  })
  let continuationCalls = 0

  const result = await harness.streamEntry(makeRequest([imageBlock()]), () => {
    continuationCalls += 1
    return 'original-continuation'
  })

  assert.equal(result, 'original-continuation')
  assert.equal(continuationCalls, 1)
  assert.equal(processCalls, 0, 'native-image input must bypass image admission processing')
  assert.equal(harness.resolverCalls.length, 1)
})

test('image-absent request never queries capability and continues synchronously', () => {
  const harness = createHarness()
  harness.registerPolicy({})
  let continuationCalls = 0

  const result = harness.streamEntry(makeRequest([textBlock('plain')]), () => {
    continuationCalls += 1
    return 'original-continuation'
  })

  assert.equal(result, 'original-continuation')
  assert.equal(continuationCalls, 1)
  assert.equal(harness.resolverCalls.length, 0, 'no capability lookup for image-absent input')
})

test('matching non-native policy projects the image and re-enters once', async () => {
  const harness = createHarness()
  let processCalls = 0
  let validateCalls = 0
  harness.registerPolicy({
    process(snapshot) {
      processCalls += 1
      return {
        kind: 'replace-messages',
        messages: [{
          ...snapshot.messages[0],
          content: [textBlock('[Image #1]')],
        }],
      }
    },
    validate() { validateCalls += 1; return true },
  })
  let continuationCalls = 0
  const request = makeRequest([imageBlock()])

  const result = await harness.streamEntry(request, () => {
    continuationCalls += 1
    return 'must-not-run'
  })

  assert.equal(result, 'official-terminal')
  assert.equal(continuationCalls, 0, 'a valid replacement suppresses the original continuation')
  assert.equal(processCalls, 1)
  assert.equal(validateCalls, 1)
  assert.equal(harness.resolverCalls.length, 1)
  assert.equal(harness.state.streamCalls, 1, 'the compatibility re-entry is called at most once')
})

test('validator failure rejects the non-native image operation', async () => {
  const harness = createHarness()
  harness.registerPolicy({
    process() {
      return {
        kind: 'replace-messages',
        messages: [{ id: 'message-1', role: 'user', source: { kind: 'user' }, content: [textBlock('[Image #1]')] }],
      }
    },
    validate() { return false },
  })
  let continuationCalls = 0

  await assert.rejects(
    harness.streamEntry(makeRequest([imageBlock()]), () => { continuationCalls += 1 }),
    (error) => error instanceof LlmInputPolicyError,
  )
  assert.equal(continuationCalls, 0)
})

test('residual image after policy processing is rejected', async () => {
  const harness = createHarness()
  harness.registerPolicy({
    process() { return { kind: 'pass' } },
  })
  let continuationCalls = 0

  await assert.rejects(
    harness.streamEntry(makeRequest([imageBlock('a'), imageBlock('b')]), () => { continuationCalls += 1 }),
    (error) => error instanceof LlmRequestInvalidResultError,
  )
  assert.equal(continuationCalls, 0)
})

test('no matching policy for non-native image rejects without continuation or re-entry', async () => {
  const harness = createHarness()
  let continuationCalls = 0

  await assert.rejects(
    harness.streamEntry(makeRequest([imageBlock()]), () => { continuationCalls += 1 }),
    (error) => error instanceof LlmRequestInvalidResultError && error.code === 'LLM_REQUEST_INVALID_RESULT',
  )
  assert.equal(continuationCalls, 0)
})

test('compat request-introduced image input is handled by the unified image admission pipeline', async () => {
  const harness = createHarness()
  const request = makeRequest([textBlock('hello')])
  harness.state.pluginApi.llm.request.transform({
    id: 'introduce-image',
    mode: 'compat',
    apply() {
      return {
        kind: 'replace-messages',
        messages: [{ ...request.messages[0], content: [textBlock('hello'), imageBlock('late-image')] }],
      }
    },
    isConverged() { return true },
  })
  let processCalls = 0
  harness.registerPolicy({
    process(snapshot) {
      processCalls += 1
      return {
        kind: 'replace-messages',
        messages: [{
          ...snapshot.messages[0],
          content: snapshot.messages[0].content.map((block) => (block.type === 'image' ? textBlock('[Image #1]') : block)),
        }],
      }
    },
    validate() { return true },
  })
  let continuationCalls = 0

  const result = await harness.streamEntry(request, () => {
    continuationCalls += 1
    return 'must-not-run'
  })

  assert.equal(result, 'official-terminal')
  assert.equal(continuationCalls, 0)
  assert.equal(processCalls, 1, 'the compat request-introduced image must reach the image admission policy phase')
  assert.equal(harness.state.streamCalls, 1, 'the compatibility re-entry is called at most once')
})

test('unknown content fails closed at the unified boundary', () => {
  const harness = createHarness()
  harness.registerPolicy({})
  let continuationCalls = 0

  assert.throws(
    () => harness.streamEntry(makeRequest([{ type: 'audio', data: 'unsupported' }]), () => { continuationCalls += 1 }),
    (error) => error instanceof LlmRequestInvalidResultError,
  )
  assert.equal(continuationCalls, 0)
})

test('an active gateway scope cannot make stream classification observe overlay metadata', async () => {
  const harness = createHarness({
    promptBody: async (llm) => {
      // A stream entry inside the gateway RPC scope: the official resolver is
      // overlaid (text+image), but the owner must classify against the
      // authoritative pre-overlay result and run the policy phase.
      const result = await llm.stream(makeRequest([imageBlock('in-scope')]))
      assert.equal(result, 'official-terminal')
    },
  })
  let processCalls = 0
  harness.registerPolicy({
    process(snapshot) {
      processCalls += 1
      return {
        kind: 'replace-messages',
        messages: [{
          ...snapshot.messages[0],
          content: [textBlock('[Image #1]')],
        }],
      }
    },
    validate() { return true },
  })

  const result = await harness.ctx.get('apiProxy').sessions.prompt({ payload: { sessionId: 's1' } })

  assert.deepEqual(result, { ok: true, accepted: true })
  assert.equal(processCalls, 1,
    'the owner must see the authoritative text-only capability even inside a gateway overlay scope')
})

test('policy mutation during an operation cannot affect the current policy snapshot', async () => {
  const harness = createHarness()
  let latePolicyRan = false
  let processCalls = 0
  const latePolicy = {
    id: 'late-policy',
    input: 'image',
    match() { return true },
    process() { latePolicyRan = true; return { kind: 'pass' } },
    validate() { return true },
  }

  harness.registerPolicy({
    process(snapshot) {
      processCalls += 1
      // Register a new policy mid-operation; the op-start snapshot is frozen.
      harness.state.pluginApi.llm.admission.register(latePolicy)
      // Strict progress without elimination: two images -> one image. The
      // policy loop must continue past this policy, so a snapshot violation
      // (the late policy joining this operation's selection) would invoke its
      // process and flip latePolicyRan.
      return {
        kind: 'replace-messages',
        messages: [{
          ...snapshot.messages[0],
          content: [imageBlock('first')],
        }],
      }
    },
    validate() { return true },
  })
  let continuationCalls = 0

  await assert.rejects(
    harness.streamEntry(makeRequest([imageBlock('a'), imageBlock('b')]), () => { continuationCalls += 1 }),
    (error) => error instanceof LlmRequestInvalidResultError,
    'residual image after the op-start policy snapshot must reject',
  )
  assert.equal(continuationCalls, 0)
  assert.equal(processCalls, 1)
  assert.equal(latePolicyRan, false, 'a policy registered mid-operation must not join the current snapshot')
})