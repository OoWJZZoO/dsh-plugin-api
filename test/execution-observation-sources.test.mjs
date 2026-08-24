import test from 'node:test'
import assert from 'node:assert/strict'
import { createExecutionReducer } from '../lib/execution-observation-reducer.js'
import { createExecutionSources } from '../lib/execution-observation-sources.js'

function createMockCtx(throwFor = null) {
  const listeners = new Map()
  const ctx = {
    on(name, listener) {
      if (throwFor === name) throw new Error(`cannot register ${name}`)
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name).push(listener)
      return () => {
        const arr = listeners.get(name)
        if (arr) {
          const idx = arr.indexOf(listener)
          if (idx !== -1) arr.splice(idx, 1)
        }
      }
    },
    off() {},
  }
  return { ctx, listeners }
}

function call(listeners, name, ...args) {
  return listeners.get(name)?.map((fn) => fn(...args))
}

test('sources register one listener per official seam and produce a start fragment', () => {
  const reducer = createExecutionReducer()
  const { ctx, listeners } = createMockCtx()
  const sources = createExecutionSources({ ctx, reducer })
  assert.deepEqual(Object.keys(sources.availability).sort(), ['agent', 'llm', 'session', 'tools'])
  for (const name of ['tools/pre-execute', 'tools/execute', 'tools/result', 'agent/request', 'agent/error', 'session/created', 'session/event', 'llm/stream']) {
    assert.ok(listeners.has(name), `expected listener for ${name}`)
  }
  const exec = {}
  const result = call(listeners, 'tools/pre-execute', exec, () => 'continued')
  assert.equal(result[0], 'continued')
  assert.equal(reducer.size, 1)
  sources.dispose()
})

test('llm/stream adapter calls next exactly once, returns its exact result and observes a promise resolution', async () => {
  const reducer = createExecutionReducer()
  const { ctx, listeners } = createMockCtx()
  createExecutionSources({ ctx, reducer })
  const options = {}
  let nextCalls = 0
  const value = Promise.resolve('done')
  const returned = call(listeners, 'llm/stream', options, () => {
    nextCalls += 1
    return value
  })[0]
  assert.equal(nextCalls, 1)
  assert.equal(returned, value)

  await value
  await new Promise((resolve) => setTimeout(resolve, 0))
  const snap = reducer.get(reducer.allHistory()[0].executionId)
  assert.equal(snap.outcome, 'success')
  assert.equal(snap.start.sourceKind, 'llm')
})

test('llm/stream adapter preserves a synchronous throw while recording an error fragment', () => {
  const reducer = createExecutionReducer()
  const { ctx, listeners } = createMockCtx()
  createExecutionSources({ ctx, reducer })
  const options = {}
  assert.throws(() => {
    call(listeners, 'llm/stream', options, () => {
      throw new Error('boom')
    })
  }, /boom/)
  const snap = reducer.get(reducer.allHistory()[0].executionId)
  assert.equal(snap.outcome, 'error')
})

test('AbortSignal alone never commits aborted; only a committed terminal observation does', () => {
  const reducer = createExecutionReducer()
  const { ctx, listeners } = createMockCtx()
  createExecutionSources({ ctx, reducer })
  const exec = { signal: { aborted: true } }
  call(listeners, 'tools/pre-execute', exec, () => {})
  call(listeners, 'tools/result', exec, { value: 1 })
  const snap = reducer.get(reducer.allHistory()[0].executionId)
  assert.equal(snap.outcome, 'success')
  assert.notEqual(snap.outcome, 'aborted')
})

test('a failing source registration degrades only that source and never throws', () => {
  const reducer = createExecutionReducer()
  const { ctx, listeners } = createMockCtx('tools/pre-execute')
  const logger = { warn() {}, error() {} }
  assert.doesNotThrow(() => createExecutionSources({ ctx, reducer, logger }))
  assert.equal(listeners.has('tools/pre-execute'), false)
  assert.ok(listeners.has('agent/request'))
})

test('dispose is idempotent and removes all listeners', () => {
  const reducer = createExecutionReducer()
  const { ctx, listeners } = createMockCtx()
  const sources = createExecutionSources({ ctx, reducer })
  let count = 0
  for (const arr of listeners.values()) count += arr.length
  assert.equal(sources.dispose(), true)
  assert.equal(sources.dispose(), false)
  let after = 0
  for (const arr of listeners.values()) after += arr.length
  assert.equal(after, 0)
  assert.equal(count > 0, true)
})
