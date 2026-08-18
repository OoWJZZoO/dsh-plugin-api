import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createTransformRegistry,
  mountLlmRequestFeature,
  runAuthoritative,
  isInAuthoritativeBypass,
  isNativeImageCapability,
  TRANSFORM_PRIORITIES,
} from '../lib/llm-request.js'
import {
  LlmInputPolicyError,
  LlmRequestCompatibilityError,
  LlmRequestInvalidResultError,
  LlmRequestTransformError,
  LlmRequestTransformRegistrationError,
} from '../lib/errors.js'

const contentHasImage = (content) => content.some((block) => (
  block.type === 'image' || (block.type === 'tool-result' && contentHasImage(block.content))
))

function imageBlock(attachmentId = 'attachment-1') {
  return {
    type: 'image',
    attachment: { attachmentId, mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
  }
}

function textBlock(text) {
  return { type: 'text', text }
}

function makeRequest(signal = new AbortController().signal, contentOverride) {
  return {
    provider: 'provider-a',
    model: 'model-a',
    sessionId: 'session-1',
    messages: [{
      id: 'message-1',
      role: 'user',
      source: { kind: 'user' },
      content: contentOverride ?? [textBlock('hello')],
    }],
    system: 'system text',
    signal,
    nested: { keep: ['value'] },
  }
}

function projectedMessages(request, text = 'projected') {
  return request.messages.map((message) => ({
    ...message,
    content: message.content.map((block) => (block.type === 'text' ? textBlock(text) : block)),
  }))
}

function disabledSignal(request) {
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  return { ...request, signal: controller.signal }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createHarness(options = {}) {
  const listeners = []
  const state = {
    streamCalls: [],
    resolverCalls: [],
    warns: [],
    continuationCalls: 0,
    lastContinuationOptions: undefined,
  }

  const ctx = {
    on(name, listener) {
      assert.equal(name, 'llm/stream')
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
  }

  const policyHandle = {
    snapshotPolicies: () => [...(options.policies ?? [])],
    isPolicyAvailable: (token) => (options.isPolicyAvailable ? options.isPolicyAvailable(token) : true),
  }

  const llm = {
    stream(request) {
      state.streamCalls.push(request)
      let index = 0
      const next = () => {
        const current = listeners[index++]
        if (!current) return state.streamTerminal ? state.streamTerminal() : 'terminal-result'
        return current(request, next)
      }
      return next()
    },
    async resolveModelInfo(provider, model) {
      state.resolverCalls.push({ provider, model })
      if (options.resolveModelInfo) return options.resolveModelInfo(provider, model)
      return { provider, id: model, name: model, inputModalities: ['text'] }
    },
  }

  const resolveAuthoritative = options.resolveAuthoritative
    ?? ((provider, model, signal) => llm.resolveModelInfo(provider, model, signal))

  const owner = mountLlmRequestFeature({
    ctx,
    llm,
    contentHasImage,
    agents: options.agents ?? { get() { return undefined } },
    policyHandle,
    resolveAuthoritative,
    logger: { warn: (message) => state.warns.push(message) },
  })

  function dispatch(request, finalNext) {
    let index = 0
    const next = () => {
      const current = listeners[index++]
      if (!current) {
        if (finalNext) return finalNext(request)
        return 'outer-terminal'
      }
      return current(request, next)
    }
    return next()
  }

  return {
    state,
    ctx,
    listeners,
    llm,
    policyHandle,
    resolveAuthoritative,
    owner,
    dispatch,
  }
}

test('registry validates atomically, orders by priority then sequence, disposes by exact token', () => {
  const registry = createTransformRegistry()
  const calls = []
  const make = (id, priority) => ({
    id,
    mode: 'compat',
    priority,
    apply: () => calls.push(`${id}:apply`),
    isConverged: () => calls.push(`${id}:assert`),
  })

  const a = registry.register(make('a', 'high'))
  const b = registry.register(make('b', 'normal'))
  const c = registry.register(make('c', 'low'))

  assert.deepEqual(registry.snapshot().map((e) => e.id), ['a', 'b', 'c'])
  assert.equal(registry.size, 3)

  assert.throws(() => registry.register(make('b', 'high')), LlmRequestTransformRegistrationError)
  assert.throws(() => registry.register({ id: 'x', mode: 'async', apply() {}, isConverged() {} }), LlmRequestTransformRegistrationError)
  assert.throws(() => registry.register({ id: 'x', mode: 'compat', apply() {} }), LlmRequestTransformRegistrationError)
  assert.throws(() => registry.register({ id: 'x', mode: 'compat', priority: 'ultra', apply() {}, isConverged() {} }), LlmRequestTransformRegistrationError)
  assert.throws(() => registry.register({ id: '  ', mode: 'compat', apply() {}, isConverged() {} }), LlmRequestTransformRegistrationError)

  const aToken = registry.snapshot().find((e) => e.id === 'a').token
  assert.equal(registry.isAvailable(aToken), true)

  // dispose removes only the exact token; a newer registration with the same id survives
  assert.equal(a(), true)
  assert.equal(a(), false)
  assert.equal(registry.size, 2)
  assert.equal(registry.isAvailable(aToken), false)

  const bToken = registry.snapshot().find((e) => e.id === 'b').token
  assert.equal(b(), true, 'dispose the original b registration')
  assert.equal(b(), false)
  assert.equal(registry.snapshot().map((e) => e.id).join(','), 'c')
  const b2 = registry.register(make('b', 'lowest'))
  assert.equal(bToken !== registry.snapshot().find((e) => e.id === 'b').token, true,
    'a newer registration carries a fresh token')
  assert.equal(registry.snapshot().map((e) => e.id).join(','), 'c,b')
  assert.equal(b2(), true)
  assert.equal(registry.snapshot().map((e) => e.id).join(','), 'c')

  registry.dispose()
  assert.throws(() => registry.register(make('d', 'normal')), LlmRequestTransformRegistrationError)

  assert.deepEqual(
    TRANSFORM_PRIORITIES,
    ['highest', 'high', 'normal', 'low', 'lowest'],
  )
})

test('all-pass operation calls the original continuation exactly once with the original request', () => {
  const harness = createHarness()
  const request = makeRequest()

  const result = harness.dispatch(request, (original) => {
    harness.state.continuationCalls += 1
    harness.state.lastContinuationOptions = original
    return 'original-result'
  })

  assert.equal(result, 'original-result')
  assert.equal(harness.state.continuationCalls, 1)
  assert.equal(harness.state.lastContinuationOptions, request)
  assert.equal(harness.state.streamCalls.length, 0)
})

test('non-inspectable input passes through without a record', () => {
  const harness = createHarness()
  let continuationCalls = 0
  const result = harness.dispatch({ no: 'messages' }, () => {
    continuationCalls += 1
    return 'passthrough'
  })
  assert.equal(result, 'passthrough')
  assert.equal(continuationCalls, 1)
  assert.equal(harness.state.streamCalls.length, 0)
})

test('replacement suppresses the original continuation and re-enters llm.stream once with the candidate', () => {
  const harness = createHarness()
  const request = makeRequest()
  let applyCalls = 0
  const disposer = harness.owner.api.transform({
    id: 'project',
    mode: 'compat',
    apply(snapshot) {
      applyCalls += 1
      assert.ok(Object.isFrozen(snapshot))
      assert.notEqual(snapshot, request)
      return { kind: 'replace-messages', messages: projectedMessages(request) }
    },
    isConverged() {
      return true
    },
  })

  const result = harness.dispatch(request, (original) => {
    harness.state.continuationCalls += 1
    return 'must-not-run'
  })

  assert.equal(result, 'terminal-result')
  assert.equal(applyCalls, 1)
  assert.equal(harness.state.continuationCalls, 0)
  assert.equal(harness.state.streamCalls.length, 1)
  const candidate = harness.state.streamCalls[0]
  assert.notEqual(candidate, request)
  assert.equal(candidate.provider, request.provider)
  assert.equal(candidate.signal, request.signal)
  assert.equal(candidate.messages[0].content[0].text, 'projected')
  assert.ok(Object.isFrozen(candidate))
  assert.ok(Object.isFrozen(candidate.messages))
  assert.ok(!Object.isFrozen(candidate.signal))
  assert.equal(request.messages[0].content[0].text, 'hello')

  assert.equal(disposer(), true)
  assert.equal(disposer(), false)
})

test('self-reentry bypasses the pipeline: apply runs once and the marked candidate continues once', () => {
  const harness = createHarness()
  const request = makeRequest()
  let applyCalls = 0
  const disposer = harness.owner.api.transform({
    id: 'project',
    mode: 'compat',
    apply(snapshot) {
      applyCalls += 1
      return { kind: 'replace-messages', messages: projectedMessages(request) }
    },
    isConverged() {
      return true
    },
  })

  const result = harness.dispatch(request, (original) => {
    harness.state.continuationCalls += 1
    return 'must-not-run'
  })

  assert.equal(result, 'terminal-result')
  assert.equal(applyCalls, 1, 'L4 apply must not re-run for the marked candidate')
  assert.equal(harness.state.continuationCalls, 0)
  assert.equal(harness.state.streamCalls.length, 1)
  assert.equal(harness.state.streamCalls[0].messages[0].content[0].text, 'projected')
  disposer()
})

test('foreign owner marker is preserved: a second owner processes the marked candidate as a fresh operation', () => {
  const harness = createHarness()
  const request = makeRequest()
  const firstOrder = []
  let firstApplies = 0
  let secondApplies = 0

  const first = mountLlmRequestFeature({
    ctx: harness.ctx,
    llm: harness.llm,
    contentHasImage,
    agents: { get() { return undefined } },
    policyHandle: { snapshotPolicies: () => [], isPolicyAvailable: () => true },
    resolveAuthoritative: harness.resolveAuthoritative,
    logger: { warn() {} },
  })
  first.api.transform({
    id: 'first',
    mode: 'compat',
    apply(snapshot) {
      firstOrder.push('first-apply')
      firstApplies += 1
      return { kind: 'replace-messages', messages: projectedMessages(request, 'first') }
    },
    isConverged() {
      return true
    },
  })

  const second = mountLlmRequestFeature({
    ctx: harness.ctx,
    llm: harness.llm,
    contentHasImage,
    agents: { get() { return undefined } },
    policyHandle: { snapshotPolicies: () => [], isPolicyAvailable: () => true },
    resolveAuthoritative: harness.resolveAuthoritative,
    logger: { warn() {} },
  })
  second.api.transform({
    id: 'second',
    mode: 'compat',
    apply(snapshot) {
      firstOrder.push('second-apply')
      secondApplies += 1
      return { kind: 'pass' }
    },
    isConverged() {
      return true
    },
  })

  const result = harness.dispatch(request, () => 'outer-terminal')

  assert.equal(result, 'terminal-result')
  assert.equal(firstApplies, 1, 'first owner must not re-run its pipeline on its marked candidate')
  assert.equal(secondApplies, 1, 'second owner processes the marked candidate once as a fresh unmarked operation')
  assert.deepEqual(firstOrder, ['first-apply', 'second-apply'],
    'the outer dispatch reaches first, which re-enters; the re-entry reaches second once')
  first.disposer()
  second.disposer()
})

test('nested and concurrent operations keep isolated records', () => {
  const harness = createHarness()
  const request = makeRequest()
  const nested = makeRequest(new AbortController().signal, [textBlock('nested')])
  let applyCalls = 0
  const seen = []

  harness.owner.api.transform({
    id: 'trace',
    mode: 'compat',
    apply(snapshot) {
      applyCalls += 1
      seen.push(snapshot.messages[0].content[0].text)
      if (applyCalls === 1) {
        // Nested unmarked call from within the outer transform
        const nestedResult = harness.llm.stream(nested)
        assert.equal(nestedResult, 'terminal-result')
      }
      return { kind: 'pass' }
    },
    isConverged() {
      return true
    },
  })

  const result = harness.dispatch(request, () => 'outer-terminal')

  assert.equal(result, 'outer-terminal')
  assert.equal(applyCalls, 2, 'one outer operation + one nested operation')
  assert.deepEqual(seen, ['hello', 'nested'])
  assert.equal(harness.state.streamCalls.length, 1, 'only the nested stream call is recorded')
  assert.equal(harness.state.streamCalls[0], nested)
})

test('operation-start transform snapshot is fixed: mid-operation registration and disposal do not alter it', () => {
  const harness = createHarness()
  const request = makeRequest()
  const order = []
  let secondDisposer = null
  let lateRegistered = false

  harness.owner.api.transform({
    id: 'first',
    mode: 'compat',
    apply(snapshot) {
      order.push('first')
      // Mutate the registry mid-operation: register a new transform and
      // dispose a later one. Neither may affect the current operation's
      // frozen op-start snapshot.
      if (!lateRegistered) {
        lateRegistered = true
        harness.owner.api.transform({
          id: 'late',
          mode: 'compat',
          apply() { order.push('late'); return { kind: 'pass' } },
          isConverged() { order.push('late-assert'); return true },
        })
      }
      secondDisposer()
      return { kind: 'pass' }
    },
    isConverged() { order.push('first-assert'); return true },
  })
  secondDisposer = harness.owner.api.transform({
    id: 'second',
    mode: 'compat',
    apply() { order.push('second'); return { kind: 'pass' } },
    isConverged() { order.push('second-assert'); return true },
  })

  harness.dispatch(request, () => 'outer-terminal')
  assert.deepEqual(order, ['first', 'second', 'first-assert', 'second-assert'],
    'only the op-start snapshot runs, in deterministic transform order')

  // A later operation observes the mutation: second is gone, late is present.
  order.length = 0
  harness.dispatch(request, () => 'outer-terminal')
  assert.deepEqual(order, ['first', 'late', 'first-assert', 'late-assert'])
})

test('transform apply throw rejects with LlmRequestTransformError and never continues or re-enters', () => {
  const harness = createHarness()
  const request = makeRequest()
  harness.owner.api.transform({
    id: 'boom',
    mode: 'compat',
    apply() {
      throw new Error('apply exploded')
    },
    isConverged() { return true },
  })

  assert.throws(
    () => harness.dispatch(request, () => { harness.state.continuationCalls += 1 }),
    (error) => error instanceof LlmRequestTransformError && error.code === 'LLM_REQUEST_TRANSFORM_FAILED',
  )
  assert.equal(harness.state.continuationCalls, 0)
  assert.equal(harness.state.streamCalls.length, 0)
  assert.equal(harness.state.warns.some((w) => w.includes('apply-failed')), true)
  assert.equal(harness.state.warns.filter((w) => w.includes('apply-failed')).length, 1, 'one redacted diagnostic per operation identity')
})

test('thenable apply result rejects with LlmRequestTransformError and never continues', () => {
  const harness = createHarness()
  const request = makeRequest()
  harness.owner.api.transform({
    id: 'async',
    mode: 'compat',
    apply() {
      return Promise.resolve({ kind: 'pass' })
    },
    isConverged() { return true },
  })

  assert.throws(
    () => harness.dispatch(request, () => { harness.state.continuationCalls += 1 }),
    (error) => error instanceof LlmRequestTransformError,
  )
  assert.equal(harness.state.continuationCalls, 0)
})

test('invalid transform result rejects with LlmRequestInvalidResultError and never continues', () => {
  for (const result of [
    { kind: 'continue' },
    { kind: 'pass', extra: true },
    { kind: 'replace-messages', messages: null },
    { kind: 'replace-messages', messages: 'nope' },
  ]) {
    const harness = createHarness()
    const request = makeRequest()
    harness.owner.api.transform({
      id: 'bad',
      mode: 'compat',
      apply() { return result },
      isConverged() { return true },
    })

    assert.throws(
      () => harness.dispatch(request, () => { harness.state.continuationCalls += 1 }),
      (error) => error instanceof LlmRequestInvalidResultError && error.code === 'LLM_REQUEST_INVALID_RESULT',
      JSON.stringify(result),
    )
    assert.equal(harness.state.continuationCalls, 0)
  }
})

test('replacement that corrupts protected fields is rejected without any continuation or re-entry', () => {
  const harness = createHarness()
  const request = makeRequest()
  harness.owner.api.transform({
    id: 'corrupt',
    mode: 'compat',
    apply() {
      return {
        kind: 'replace-messages',
        messages: [{ ...request.messages[0], content: [textBlock('x')], extra: 'field' }],
      }
    },
    isConverged() { return true },
  })

  assert.throws(
    () => harness.dispatch(request, () => { harness.state.continuationCalls += 1 }),
    (error) => error instanceof LlmRequestInvalidResultError,
  )
  assert.equal(harness.state.continuationCalls, 0)
  assert.equal(harness.state.streamCalls.length, 0)
})

test('non-boolean assertion rejects with LlmRequestTransformError', () => {
  const harness = createHarness()
  const request = makeRequest()
  harness.owner.api.transform({
    id: 'bad-assert',
    mode: 'compat',
    apply() { return { kind: 'pass' } },
    isConverged() { return 'yes' },
  })

  assert.throws(
    () => harness.dispatch(request, () => { harness.state.continuationCalls += 1 }),
    (error) => error instanceof LlmRequestTransformError,
  )
  assert.equal(harness.state.continuationCalls, 0)
})

test('false assertion rejects the operation without continuing or re-entering', () => {
  const harness = createHarness()
  const request = makeRequest()
  harness.owner.api.transform({
    id: 'never-converged',
    mode: 'compat',
    apply() { return { kind: 'pass' } },
    isConverged() { return false },
  })

  assert.throws(
    () => harness.dispatch(request, () => { harness.state.continuationCalls += 1 }),
    (error) => error instanceof LlmRequestTransformError,
  )
  assert.equal(harness.state.continuationCalls, 0)
  assert.equal(harness.state.streamCalls.length, 0)
})

test('original continuation throw propagates the exact error object and settles the record', () => {
  const harness = createHarness()
  const request = makeRequest()
  const boom = new Error('adapter exploded')
  harness.owner.api.transform({
    id: 'noop',
    mode: 'compat',
    apply() { return { kind: 'pass' } },
    isConverged() { return true },
  })

  let thrown
  try {
    harness.dispatch(request, () => { throw boom })
  } catch (error) {
    thrown = error
  }
  assert.equal(thrown, boom)

  // A second operation still works (record settled cleanly).
  const result = harness.dispatch(request, () => 'second-ok')
  assert.equal(result, 'second-ok')
})

test('compatibility re-entry terminal throw propagates the exact error object once dispatched', () => {
  const harness = createHarness()
  const request = makeRequest()
  const boom = new Error('re-entry adapter exploded')
  harness.owner.api.transform({
    id: 'project',
    mode: 'compat',
    apply() { return { kind: 'replace-messages', messages: projectedMessages(request) } },
    isConverged() { return true },
  })
  const state = { calls: 0 }
  harness.state.streamTerminal = () => {
    state.calls += 1
    throw boom
  }

  let thrown
  try {
    harness.dispatch(request, () => 'must-not-run')
  } catch (error) {
    thrown = error
  }
  assert.equal(thrown, boom)
  assert.equal(state.calls, 1)
  assert.equal(harness.state.continuationCalls, 0)
  assert.equal(harness.state.streamCalls.length, 1)
})

test('marker/re-entry failure rejects with LlmRequestCompatibilityError and never continues', () => {
  const harness = createHarness()
  const request = makeRequest()
  harness.owner.api.transform({
    id: 'project',
    mode: 'compat',
    apply() { return { kind: 'replace-messages', messages: projectedMessages(request) } },
    isConverged() { return true },
  })
  const boom = new Error('stream infrastructure unavailable')
  const originalStream = harness.llm.stream
  harness.llm.stream = () => { throw boom }

  assert.throws(
    () => harness.dispatch(request, () => { harness.state.continuationCalls += 1 }),
    (error) => error instanceof LlmRequestCompatibilityError && error.code === 'LLM_REQUEST_COMPATIBILITY_FAILED',
  )
  assert.equal(harness.state.continuationCalls, 0)
  harness.llm.stream = originalStream
})

test('image-absent operation never queries target capability', () => {
  const harness = createHarness()
  const request = makeRequest(undefined, [textBlock('no images here')])
  harness.owner.api.transform({
    id: 'noop',
    mode: 'compat',
    apply() { return { kind: 'pass' } },
    isConverged() { return true },
  })

  harness.dispatch(request, () => 'outer-terminal')
  assert.equal(harness.state.resolverCalls.length, 0)
})

test('native-image target bypasses the policy phase and continues with the L4 candidate', async () => {
  const harness = createHarness({
    resolveModelInfo: async () => ({ provider: 'provider-a', id: 'model-a', name: 'model-a', inputModalities: ['text', 'image'] }),
  })
  const request = makeRequest(undefined, [imageBlock()])
  let policyProcessed = false
  const entry = {
    id: 'img-policy',
    token: { policy: true },
    match() { return true },
    process() { policyProcessed = true; return { kind: 'pass' } },
    validate() { return true },
  }
  harness.policyHandle.snapshotPolicies = () => [entry]

  const result = await harness.dispatch(request, () => {
    harness.state.continuationCalls += 1
    return 'outer-terminal'
  })

  assert.equal(result, 'outer-terminal')
  assert.equal(harness.state.continuationCalls, 1)
  assert.equal(policyProcessed, false, 'native-image input must bypass L2 processing')
  assert.equal(harness.state.resolverCalls.length, 1)
})

test('non-native terminal image with no matching policy rejects without continuation or re-entry', async () => {
  const harness = createHarness()
  const request = makeRequest(undefined, [imageBlock()])

  await assert.rejects(
    harness.dispatch(request, () => { harness.state.continuationCalls += 1 }),
    (error) => error instanceof LlmRequestInvalidResultError && error.code === 'LLM_REQUEST_INVALID_RESULT',
  )
  assert.equal(harness.state.continuationCalls, 0)
  assert.equal(harness.state.streamCalls.length, 0)
})

test('non-native image is processed by selected policies and re-enters only after image elimination', async () => {
  const harness = createHarness()
  const request = makeRequest(undefined, [imageBlock('attachment-1')])
  const processCalls = []
  let validateCalls = 0
  const entry = {
    id: 'img-policy',
    token: { policy: true },
    match(scope) {
      assert.equal(scope.provider, 'provider-a')
      assert.equal(scope.model, 'model-a')
      return true
    },
    process(snapshot) {
      processCalls.push(snapshot.messages[0].content.map((b) => b.type).join(','))
      return {
        kind: 'replace-messages',
        messages: [{
          ...request.messages[0],
          content: [textBlock('[Image #1]')],
        }],
      }
    },
    validate() {
      validateCalls += 1
      return true
    },
  }
  harness.policyHandle.snapshotPolicies = () => [entry]

  const result = await harness.dispatch(request, (original) => {
    harness.state.continuationCalls += 1
    return 'must-not-run'
  })

  assert.equal(result, 'terminal-result')
  assert.equal(harness.state.continuationCalls, 0, 'replacement suppresses the original continuation')
  assert.equal(harness.state.streamCalls.length, 1)
  const candidate = harness.state.streamCalls[0]
  assert.equal(candidate.messages[0].content[0].text, '[Image #1]')
  assert.equal(candidate.signal, request.signal)
  assert.deepEqual(processCalls, ['image'])
  assert.equal(validateCalls, 1)
})

test('policy replacement without strict image progress is rejected', async () => {
  const harness = createHarness()
  const request = makeRequest(undefined, [imageBlock('attachment-1'), imageBlock('attachment-2')])
  const entry = {
    id: 'stall-policy',
    token: { policy: true },
    match() { return true },
    process() {
      return {
        kind: 'replace-messages',
        messages: [{
          ...request.messages[0],
          content: [imageBlock('attachment-1'), imageBlock('attachment-2')],
        }],
      }
    },
    validate() { return true },
  }
  harness.policyHandle.snapshotPolicies = () => [entry]

  await assert.rejects(
    harness.dispatch(request, () => { harness.state.continuationCalls += 1 }),
    (error) => error instanceof LlmInputPolicyError,
  )
  assert.equal(harness.state.continuationCalls, 0)
  assert.equal(harness.state.streamCalls.length, 0)
})

test('policy validator failure rejects the non-native image operation', async () => {
  const harness = createHarness()
  const request = makeRequest(undefined, [imageBlock('attachment-1')])
  const entry = {
    id: 'bad-validator',
    token: { policy: true },
    match() { return true },
    process() {
      return {
        kind: 'replace-messages',
        messages: [{
          ...request.messages[0],
          content: [textBlock('[Image #1]')],
        }],
      }
    },
    validate() { return false },
  }
  harness.policyHandle.snapshotPolicies = () => [entry]

  await assert.rejects(
    harness.dispatch(request, () => { harness.state.continuationCalls += 1 }),
    (error) => error instanceof LlmInputPolicyError,
  )
  assert.equal(harness.state.continuationCalls, 0)
  assert.equal(harness.state.streamCalls.length, 0)
})

test('capability resolution failure rejects the operation with a compatibility error', async () => {
  const harness = createHarness({
    resolveAuthoritative: async () => { throw new Error('adapter lookup broken') },
  })
  const request = makeRequest(undefined, [imageBlock()])

  await assert.rejects(
    harness.dispatch(request, () => { harness.state.continuationCalls += 1 }),
    (error) => error instanceof LlmRequestCompatibilityError && error.code === 'LLM_REQUEST_COMPATIBILITY_FAILED',
  )
  assert.equal(harness.state.continuationCalls, 0)
  assert.equal(harness.state.streamCalls.length, 0)
})

test('unusable capability result is rejected rather than classified as non-native', async () => {
  const harness = createHarness({
    resolveAuthoritative: async () => null,
  })
  const request = makeRequest(undefined, [imageBlock()])

  await assert.rejects(
    harness.dispatch(request, () => { harness.state.continuationCalls += 1 }),
    (error) => error instanceof LlmRequestCompatibilityError,
  )
  assert.equal(harness.state.continuationCalls, 0)
})

test('disposal during processing rejects the in-flight operation and never continues', async () => {
  const gate = deferred()
  const harness = createHarness({
    resolveAuthoritative: () => gate.promise,
  })
  const request = makeRequest(undefined, [imageBlock()])

  const pending = harness.dispatch(request, () => { harness.state.continuationCalls += 1 })
  await Promise.resolve()
  assert.equal(harness.owner.disposer(), true)

  gate.resolve({ provider: 'provider-a', id: 'model-a', name: 'model-a', inputModalities: ['text'] })

  await assert.rejects(
    pending,
    (error) => error instanceof LlmRequestCompatibilityError && error.code === 'LLM_REQUEST_COMPATIBILITY_FAILED',
  )
  assert.equal(harness.state.continuationCalls, 0)
  assert.equal(harness.state.streamCalls.length, 0)
})

test('already-aborted signal settles the operation without resolving capability or continuing', async () => {
  const harness = createHarness()
  const request = disabledSignal(makeRequest(undefined, [imageBlock()]))

  const result = await harness.dispatch(request, () => { harness.state.continuationCalls += 1 })

  assert.equal(result, undefined)
  assert.equal(harness.state.resolverCalls.length, 0)
  assert.equal(harness.state.continuationCalls, 0)
  assert.equal(harness.state.streamCalls.length, 0)
})

test('abort during the async capability wait settles without continuing or re-entering', async () => {
  const gate = deferred()
  const harness = createHarness({
    resolveAuthoritative: () => gate.promise,
  })
  const controller = new AbortController()
  const request = makeRequest(controller.signal, [imageBlock()])

  const pending = harness.dispatch(request, () => { harness.state.continuationCalls += 1 })
  await Promise.resolve()
  controller.abort() // live signal flips mid-wait

  gate.resolve({ provider: 'provider-a', id: 'model-a', name: 'model-a', inputModalities: ['text'] })

  const result = await pending
  assert.equal(result, undefined)
  assert.equal(harness.state.continuationCalls, 0)
  assert.equal(harness.state.streamCalls.length, 0)
})

test('standard image progress through nested tool-result projection is accepted', async () => {
  const harness = createHarness()
  const request = makeRequest(undefined, [{
    type: 'tool-result',
    toolCallId: 'call-1',
    content: [textBlock('text'), imageBlock('attachment-1')],
  }])
  const entry = {
    id: 'nested-policy',
    token: { policy: true },
    match() { return true },
    process() {
      return {
        kind: 'replace-messages',
        messages: [{
          ...request.messages[0],
          content: [{
            type: 'tool-result',
            toolCallId: 'call-1',
            content: [textBlock('text'), textBlock('[Image #1]')],
          }],
        }],
      }
    },
    validate() { return true },
  }
  harness.policyHandle.snapshotPolicies = () => [entry]

  const result = await harness.dispatch(request, () => 'must-not-run')

  assert.equal(result, 'terminal-result')
  assert.equal(harness.state.streamCalls.length, 1)
  assert.equal(harness.state.streamCalls[0].messages[0].content[0].content[1].text, '[Image #1]')
})

test('unsnapshotable text-only request passes through unchanged with one diagnostic', () => {
  const harness = createHarness()
  const request = makeRequest(undefined, [textBlock('hello')])
  request.nested = new Date() // not a snapshotable graph

  let continuationCalls = 0
  let lastOptions
  const result = harness.dispatch(request, (original) => {
    continuationCalls += 1
    lastOptions = original
    return 'passthrough'
  })

  assert.equal(result, 'passthrough')
  assert.equal(continuationCalls, 1)
  assert.equal(lastOptions, request)
  assert.equal(harness.state.streamCalls.length, 0)
  assert.equal(harness.state.warns.some((w) => w.includes('uninspectable')), true)
})

test('unsnapshotable image-bearing request is rejected with a typed error', () => {
  const harness = createHarness()
  const request = makeRequest(undefined, [imageBlock()])
  request.nested = new Date()

  assert.throws(
    () => harness.dispatch(request, () => { harness.state.continuationCalls += 1 }),
    (error) => error instanceof LlmRequestInvalidResultError && error.code === 'LLM_REQUEST_INVALID_RESULT',
  )
  assert.equal(harness.state.continuationCalls, 0)
  assert.equal(harness.state.streamCalls.length, 0)
})

test('unsnapshotable text-only request with transforms passes through without running them', () => {
  const harness = createHarness()
  const request = makeRequest(undefined, [textBlock('hello')])
  request.nested = new Date()
  let applyCalls = 0
  harness.owner.api.transform({
    id: 'noop',
    mode: 'compat',
    apply() { applyCalls += 1; return { kind: 'pass' } },
    isConverged() { return true },
  })

  const result = harness.dispatch(request, () => 'passthrough')
  assert.equal(result, 'passthrough')
  assert.equal(applyCalls, 0)
  assert.equal(harness.state.streamCalls.length, 0)
})

test('match returning an object with a throwing then getter is a no-match with one diagnostic', async () => {
  const harness = createHarness()
  const request = makeRequest(undefined, [imageBlock()])
  const hostile = {}
  Object.defineProperty(hostile, 'then', {
    get() { throw new Error('hostile then getter') },
  })
  let processCalls = 0
  const entry = {
    id: 'hostile-match',
    token: { policy: true },
    match() { return hostile },
    process() { processCalls += 1; return { kind: 'pass' } },
    validate() { return true },
  }
  harness.policyHandle.snapshotPolicies = () => [entry]

  // No matching policy survives, so the non-native image operation is rejected
  // with a TYPED error; the hostile getter never escapes as a raw throw.
  await assert.rejects(
    harness.dispatch(request, () => { harness.state.continuationCalls += 1 }),
    (error) => error instanceof LlmRequestInvalidResultError && error.code === 'LLM_REQUEST_INVALID_RESULT',
  )
  assert.equal(processCalls, 0)
  assert.equal(harness.state.continuationCalls, 0)
  assert.equal(harness.state.warns.some((w) => w.includes('policy-match')), true)
})

test('diagnostics are deduplicated per operation identity and redact request content', () => {
  const harness = createHarness()

  harness.owner.api.transform({
    id: 'thrower',
    mode: 'compat',
    apply() { throw new Error('boom') },
    isConverged() { return true },
  })

  for (let index = 0; index < 3; index += 1) {
    const fresh = makeRequest(undefined, [textBlock('secret prompt text')])
    assert.throws(() => harness.dispatch(fresh, () => {}), LlmRequestTransformError)
  }

  const applyWarns = harness.state.warns.filter((w) => w.includes('apply-failed'))
  assert.equal(applyWarns.length, 3, 'one diagnostic per distinct operation identity')
  for (const warn of harness.state.warns) {
    assert.equal(warn.includes('secret'), false, 'diagnostics must not expose request content')
  }
})

test('runAuthoritative enters a bypass scope visible to isInAuthoritativeBypass', () => {
  let inside = false
  let outside = false
  const result = runAuthoritative(() => {
    inside = isInAuthoritativeBypass()
    return 'value'
  })
  outside = isInAuthoritativeBypass()
  assert.equal(result, 'value')
  assert.equal(inside, true)
  assert.equal(outside, false)
})

test('isNativeImageCapability classifies only explicit image input modality', () => {
  assert.equal(isNativeImageCapability({ inputModalities: ['text', 'image'] }), true)
  assert.equal(isNativeImageCapability({ inputModalities: ['text'] }), false)
  assert.equal(isNativeImageCapability({}), false)
  assert.equal(isNativeImageCapability(null), false)
  assert.equal(isNativeImageCapability(undefined), false)
})

test('mounter returns null when required dependencies are missing', () => {
  const llm = { stream() {} }
  assert.equal(mountLlmRequestFeature({}), null)
  assert.equal(mountLlmRequestFeature({
    ctx: { on: () => () => {} },
    llm,
    contentHasImage,
  }), null) // resolveAuthoritative missing
  const result = mountLlmRequestFeature({
    ctx: { on: () => () => {} },
    llm,
    contentHasImage,
    resolveAuthoritative: async () => ({}),
  })
  assert.ok(result)
  result.disposer()
})

test('disposer is idempotent and stops future translation', () => {
  const harness = createHarness()
  const request = makeRequest()
  harness.owner.api.transform({
    id: 'noop',
    mode: 'compat',
    apply() { return { kind: 'pass' } },
    isConverged() { return true },
  })

  assert.equal(harness.owner.disposer(), true)
  assert.equal(harness.owner.disposer(), false)
  assert.throws(() => harness.owner.api.transform({
    id: 'after-dispose',
    mode: 'compat',
    apply() { return { kind: 'pass' } },
    isConverged() { return true },
  }), /disposed/i)
})