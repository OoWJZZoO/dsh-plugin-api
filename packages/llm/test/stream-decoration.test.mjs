import test from 'node:test'
import assert from 'node:assert/strict'
import { TimeoutReason } from '@deepseek-ai/dsh-timeout'
import { LlmRuntime } from '../lib/forked-runtime.js'
import { attachDecorationRegistry } from '../lib/decoration-registry.js'

function createHarness() {
  const listeners = new Map()
  const warns = []
  const ctx = {
    reflect: {
      provide(name, instance) {
        ctx[name] = instance
      },
    },
    logger: {
      warn(message) {
        warns.push(message)
      },
    },
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
  return { ctx, listeners, warns }
}

function makeAdapter({ streamImpl } = {}) {
  return {
    providerInfo(provider) {
      return { id: provider, name: provider }
    },
    providerRetryPolicy() {},
    async listModels(provider) {
      return [{ provider, id: `${provider}-m1`, name: 'Model 1' }]
    },
    async resolveModel(provider, model) {
      return { provider, id: model, name: 'Model 1' }
    },
    stream(options) {
      if (streamImpl) return streamImpl(options)
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: 'base' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

function setup({ streamImpl } = {}) {
  const { ctx, listeners, warns } = createHarness()
  const runtime = new LlmRuntime(ctx)
  const attached = attachDecorationRegistry(runtime, { logger: ctx.logger })
  const handle = runtime.registerAdapter(['demo'], makeAdapter({ streamImpl }))
  return { ctx, listeners, warns, runtime, attached, facet: attached.facet, handle }
}

async function collect(iterable) {
  const chunks = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

const streamRequest = () => ({ provider: 'demo', model: 'demo-m1', messages: [] })

function passThroughWrap() {
  return async function* (op) {
    yield* await op.next()
  }
}

test('wrappers compose outermost-first with exactly one downstream adapter call', async () => {
  let adapterCalls = 0
  const { runtime, facet } = setup({
    streamImpl(options) {
      return (async function* () {
        adapterCalls += 1
        yield { type: 'text-delta', index: 0, text: 'base' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  })
  const order = []
  facet.decorate({
    id: 'outer',
    match: () => true,
    priority: 'high',
    capabilities: { execution: { phases: ['stream'], retry: 'none' } },
    wrap: async function* (op) {
      order.push('outer-start')
      yield* await op.next()
      order.push('outer-end')
    },
  }, 'owner-a')
  facet.decorate({
    id: 'inner',
    match: () => true,
    priority: 'low',
    capabilities: { execution: { phases: ['stream'], retry: 'none' } },
    wrap: async function* (op) {
      order.push('inner-start')
      yield* await op.next()
      order.push('inner-end')
    },
  }, 'owner-b')
  const chunks = await collect(runtime.stream(streamRequest()))
  assert.deepEqual(order, ['outer-start', 'inner-start', 'inner-end', 'outer-end'])
  assert.equal(adapterCalls, 1, 'the real adapter must be invoked exactly once')
  assert.equal(chunks[chunks.length - 1].type, 'finish')
})

test('a wrapper that does not call next() fully intercepts without invoking the adapter', async () => {
  let adapterCalls = 0
  const { runtime, facet } = setup({
    streamImpl() {
      return (async function* () {
        adapterCalls += 1
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  })
  facet.decorate({
    id: 'interceptor',
    match: () => true,
    capabilities: { execution: { phases: ['stream'], retry: 'none' } },
    wrap: async function* () {
      yield { type: 'text-delta', index: 0, text: 'intercepted' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }, 'owner-a')
  const chunks = await collect(runtime.stream(streamRequest()))
  assert.deepEqual(chunks, [
    { type: 'text-delta', index: 0, text: 'intercepted' },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  assert.equal(adapterCalls, 0)
})

test('a wrapper throwing mid-stream produces one DECORATION_FAILED finish and other decorations stay intact', async () => {
  const { runtime, facet } = setup()
  const otherCalls = []
  facet.decorate({
    id: 'healthy',
    match: () => true,
    priority: 'high',
    capabilities: { execution: { phases: ['stream'], retry: 'none' } },
    wrap: async function* (op) {
      otherCalls.push('healthy')
      yield* await op.next()
    },
  }, 'owner-a')
  facet.decorate({
    id: 'broken',
    match: () => true,
    priority: 'low',
    capabilities: { execution: { phases: ['stream'], retry: 'none' } },
    wrap: async function* () {
      yield { type: 'text-delta', index: 0, text: 'partial' }
      throw new Error('wrapper exploded')
    },
  }, 'owner-b')
  const chunks = await collect(runtime.stream(streamRequest()))
  const finish = chunks[chunks.length - 1]
  assert.equal(finish.type, 'finish')
  assert.equal(finish.reason.kind, 'error')
  assert.equal(finish.reason.failure.code, 'DECORATION_FAILED')
  // no automatic retry and no fallback to a naked adapter call
  assert.equal(chunks.filter((c) => c.type === 'text-delta').length, 1)
  // the healthy decoration is not deleted or reordered
  assert.deepEqual(otherCalls, ['healthy'])
})

test('a wrapper that throws synchronously is contained as DECORATION_FAILED', async () => {
  const { runtime, facet } = setup()
  facet.decorate({
    id: 'sync-broken',
    match: () => true,
    capabilities: { execution: { phases: ['stream'], retry: 'none' } },
    wrap() {
      throw new Error('sync boom')
    },
  }, 'owner-a')
  const chunks = await collect(runtime.stream(streamRequest()))
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].reason.failure.code, 'DECORATION_FAILED')
})

test('requestTransform may pass a detached request for the same route only when declared', async () => {
  let seenRequest = null
  const { runtime, facet } = setup({
    streamImpl(options) {
      seenRequest = options
      return (async function* () {
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  })
  const original = streamRequest()
  facet.decorate({
    id: 'transform',
    match: () => true,
    capabilities: { execution: { phases: ['stream'], requestTransform: true, retry: 'none' } },
    wrap: async function* (op) {
      const transformed = { ...op.operation.request, maxTokens: 77 }
      yield* await op.next(transformed)
    },
  }, 'owner-a')
  const chunks = await collect(runtime.stream(original))
  assert.equal(chunks[chunks.length - 1].type, 'finish')
  assert.equal(seenRequest.maxTokens, 77)
  assert.equal(seenRequest.provider, 'demo')
  assert.equal(seenRequest.model, 'demo-m1')
  // the caller object is not mutated
  assert.equal(original.maxTokens, undefined)
})

test('passing a transformed request without the declared capability is a typed failure', async () => {
  const { runtime, facet } = setup()
  facet.decorate({
    id: 'no-transform',
    match: () => true,
    capabilities: { execution: { phases: ['stream'], retry: 'none' } },
    wrap: async function* (op) {
      yield* await op.next({ ...op.operation.request, maxTokens: 99 })
    },
  }, 'owner-a')
  const chunks = await collect(runtime.stream(streamRequest()))
  assert.equal(chunks[chunks.length - 1].reason.failure.code, 'DECORATION_FAILED')
})

test('a transformed request that changes the route identity is rejected', async () => {
  const { runtime, facet } = setup()
  facet.decorate({
    id: 'route-mutator',
    match: () => true,
    capabilities: { execution: { phases: ['stream'], requestTransform: true, retry: 'none' } },
    wrap: async function* (op) {
      yield* await op.next({ ...op.operation.request, provider: 'other' })
    },
  }, 'owner-a')
  const chunks = await collect(runtime.stream(streamRequest()))
  assert.equal(chunks[chunks.length - 1].reason.failure.code, 'DECORATION_FAILED')
})

test('next() is single-use: a second call is a typed decoration failure', async () => {
  let adapterCalls = 0
  const { runtime, facet } = setup({
    streamImpl() {
      return (async function* () {
        adapterCalls += 1
        yield { type: 'text-delta', index: 0, text: 'base' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  })
  facet.decorate({
    id: 'double-next',
    match: () => true,
    capabilities: { execution: { phases: ['stream'], retry: 'none' } },
    wrap: async function* (op) {
      const first = await op.next()
      const second = await op.next()
      // The violation surfaces when the second call is consumed.
      yield* second
      yield* first
    },
  }, 'owner-a')
  const chunks = await collect(runtime.stream(streamRequest()))
  assert.equal(adapterCalls, 1, 'the first next() invokes the base exactly once; the second must not')
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].type, 'finish')
  assert.equal(chunks[0].reason.failure.code, 'DECORATION_FAILED')
})

test('caller abort wins: the stream yields an aborted finish and no stale chunks', async () => {
  const { runtime, facet } = setup()
  const controller = new AbortController()
  facet.decorate({
    id: 'slow',
    match: () => true,
    capabilities: { execution: { phases: ['stream'], retry: 'none' } },
    wrap: async function* (op) {
      yield* await op.next()
    },
  }, 'owner-a')
  const stream = runtime.stream({ ...streamRequest(), signal: controller.signal })
  const first = await stream.next()
  assert.equal(first.value.type, 'text-delta')
  controller.abort()
  const rest = await collect(stream)
  assert.equal(rest.length, 1)
  assert.equal(rest[0].type, 'finish')
  assert.equal(rest[0].reason.kind, 'aborted')
})

test('provider replacement supersedes an in-flight chain: no stale chunks are published', async () => {
  const { runtime, facet, handle } = setup()
  const first = facet.decorate({
    id: 'metrics',
    match: () => true,
    capabilities: { execution: { phases: ['stream'], retry: 'none' } },
    wrap: async function* (op) {
      yield* await op.next()
    },
  }, 'owner-a')
  assert.equal(first.status, 'ok')
  const stream = runtime.stream(streamRequest())
  const firstChunk = await stream.next()
  assert.equal(firstChunk.value.type, 'text-delta')
  // provider topology changes mid-stream: the chain binding is rebuilt
  handle.replace(['demo'])
  const rest = await collect(stream)
  // no stale output after supersession; the stream closes cleanly
  assert.equal(rest.length, 0)
})

test('recursion fence: a wrapper re-entering llm.stream for the same binding is not wrapped again', async () => {
  let wrapperEntries = 0
  const { runtime, facet } = setup()
  facet.decorate({
    id: 'fenced',
    match: () => true,
    capabilities: { execution: { phases: ['stream'], retry: 'none' } },
    wrap: async function* (op) {
      wrapperEntries += 1
      // Re-enter the public stream for the same binding. The recursion fence
      // must exclude this decoration from the inner chain.
      const inner = await collect(runtime.stream({ ...op.operation.request, messages: [] }))
      yield { type: 'text-delta', index: 0, text: `inner:${inner.length}` }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }, 'owner-a')
  const chunks = await collect(runtime.stream(streamRequest()))
  assert.equal(wrapperEntries, 1, 'the wrapper must not wrap its own re-entrant stream')
  assert.equal(chunks[0].text, 'inner:2')
})

test('evidence-only retry does not trigger a second next()', async () => {
  let adapterCalls = 0
  const { runtime, facet } = setup({
    streamImpl() {
      return (async function* () {
        adapterCalls += 1
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'nope', code: 'SERVER' } } }
      })()
    },
  })
  const evidence = []
  facet.decorate({
    id: 'evidence',
    match: () => true,
    capabilities: { execution: { phases: ['stream'], retry: 'evidence-only' } },
    wrap: async function* (op) {
      const inner = await op.next()
      for await (const chunk of inner) {
        if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
          evidence.push({ code: chunk.reason.failure.code, bounded: true })
        }
        yield chunk
      }
    },
  }, 'owner-a')
  const chunks = await collect(runtime.stream(streamRequest()))
  assert.equal(adapterCalls, 1, 'evidence-only retry must never invoke next() a second time')
  assert.equal(evidence.length, 1)
  assert.equal(chunks[chunks.length - 1].reason.failure.code, 'SERVER')
})

test('an invalid chunk shape from a wrapper is a bounded decoration failure', async () => {
  const { runtime, facet } = setup()
  facet.decorate({
    id: 'shape',
    match: () => true,
    capabilities: { execution: { phases: ['stream'], retry: 'none' } },
    wrap: async function* () {
      yield { type: 'not-a-real-chunk', payload: 'leak' }
    },
  }, 'owner-a')
  const chunks = await collect(runtime.stream(streamRequest()))
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].reason.failure.code, 'DECORATION_FAILED')
})

test('a disposed decoration handle stops matching on later streams', async () => {
  const { runtime, facet, attached } = setup()
  const decorated = facet.decorate({
    id: 'temp',
    match: () => true,
    capabilities: { execution: { phases: ['stream'], retry: 'none' } },
    wrap: async function* (op) {
      yield { type: 'text-delta', index: 0, text: 'decorated' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }, 'owner-a')
  assert.equal(decorated.status, 'ok')
  const first = await collect(runtime.stream(streamRequest()))
  assert.equal(first[0].text, 'decorated')
  const disposed = attached.registry.handleDispose('owner-a', 'temp', decorated.record.generation)
  assert.equal(disposed.status, 'ok')
  const second = await collect(runtime.stream(streamRequest()))
  assert.equal(second[0].text, 'base', 'the disposed decoration must not match on later streams')
})

test('a deadline abort with the official TimeoutReason maps to error with timeout attribution', async () => {
  const { runtime, facet } = setup()
  facet.decorate({
    id: 'metrics',
    match: () => true,
    capabilities: { execution: { phases: ['stream'], retry: 'none' } },
    wrap: async function* (op) {
      yield* await op.next()
    },
  }, 'owner-a')
  const controller = new AbortController()
  controller.abort(new TimeoutReason('TEST', 1))
  const chunks = await collect(runtime.stream({ ...streamRequest(), signal: controller.signal }))
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].type, 'finish')
  assert.equal(chunks[0].reason.kind, 'error', 'a deadline must not be rewritten to aborted')
  assert.equal(chunks[0].reason.failure.code, 'TIMEOUT')
})

test('owner dispose during an in-flight stream supersedes it: no stale output', async () => {
  const { runtime, facet, attached } = setup()
  const decorated = facet.decorate({
    id: 'metrics',
    match: () => true,
    capabilities: { execution: { phases: ['stream'], retry: 'none' } },
    wrap: async function* (op) {
      yield* await op.next()
    },
  }, 'owner-a')
  assert.equal(decorated.status, 'ok')
  const stream = runtime.stream(streamRequest())
  const first = await stream.next()
  assert.equal(first.value.type, 'text-delta')
  attached.registry.handleDispose('owner-a', 'metrics', decorated.record.generation)
  const rest = await collect(stream)
  assert.equal(rest.length, 0, 'no stale chunks may be published after owner dispose')
})
