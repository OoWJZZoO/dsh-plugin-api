import test from 'node:test'
import assert from 'node:assert/strict'
import { createEventsBus } from '../lib/events-bus.js'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { composeCatalogs } from '../lib/catalog-compose.js'
import { agentEventsCatalog } from '../lib/agent-events-catalog.js'
import { llmEventsCatalog } from '../lib/llm-events-catalog.js'
import { systemPromptEventsCatalog } from '../lib/system-prompt-events-catalog.js'
import { settingsEventsCatalog } from '../lib/settings-events-catalog.js'
import { toolsEventsCatalog } from '../lib/tools-events-catalog.js'
import { scopeTarget } from '@deepseek-ai/dsh-scope'

const coreCatalog = composeCatalogs(
  baseEventsCatalog,
  agentEventsCatalog,
  llmEventsCatalog,
  systemPromptEventsCatalog,
  settingsEventsCatalog,
  toolsEventsCatalog,
)

/**
 * Minimal Cordis-like context for host-side event bus tests.
 * Mimics the parts of Cordis dispatch that the facade relies on:
 * optional thisArg + event name shifting, hook filtering, and `this` binding.
 */
function createMockCordisCtx() {
  const hooks = new Map() // name -> [{ callback, options }]

  const hooksOf = (name) => {
    let list = hooks.get(name)
    if (!list) {
      list = []
      hooks.set(name, list)
    }
    return list
  }

  const dispatch = (type, args) => {
    const thisArg = typeof args[0] === 'object' || typeof args[0] === 'function' ? args.shift() : null
    const name = args.shift()
    return hooksOf(name).map((hook) => hook.callback.bind(thisArg))
  }

  const ctx = {
    hooks,
    hooksOf,
    on(name, listener, options = {}) {
      const list = hooksOf(name)
      list.push({ callback: listener, options })
      let removed = false
      return () => {
        if (removed) return false
        removed = true
        const index = list.findIndex((hook) => hook.callback === listener)
        if (index >= 0) {
          list.splice(index, 1)
          return true
        }
        return false
      }
    },
    once(name, listener, options = {}) {
      const dispose = ctx.on(name, function onceWrapper(...args) {
        dispose()
        return listener.apply(this, args)
      }, options)
      return dispose
    },
    emit(name, ...args) {
      const callArgs = [name, ...args]
      for (const callback of dispatch('emit', callArgs)) {
        callback(...callArgs)
      }
    },
    scopedEmit(thisArg, name, ...args) {
      const callArgs = [thisArg, name, ...args]
      for (const callback of dispatch('emit', callArgs)) {
        callback(...callArgs)
      }
    },
    bail(name, ...args) {
      const callArgs = [name, ...args]
      for (const callback of dispatch('bail', callArgs)) {
        const result = callback(...callArgs)
        if (isBailed(result)) return result
      }
      return undefined
    },
    async serial(name, ...args) {
      const callArgs = [name, ...args]
      for (const callback of dispatch('serial', callArgs)) {
        const result = await callback(...callArgs)
        if (isBailed(result)) return result
      }
      return undefined
    },
    async parallel(name, ...args) {
      const callArgs = [name, ...args]
      const results = await Promise.allSettled(
        dispatch('parallel', callArgs).map((callback) => callback(...callArgs)),
      )
      const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason)
      if (errors.length) throw new AggregateError(errors)
      return results.map((result) => result.status === 'fulfilled' ? result.value : undefined)
    },
    waterfall(name, ...args) {
      const callArgs = [name, ...args]
      const callbacks = dispatch('waterfall', callArgs)
      const inner = callArgs.pop()
      const next = () => (callbacks.shift() ?? inner)(...callArgs)
      callArgs.push(next)
      return next()
    },
  }

  return ctx
}

function isBailed(value) {
  return value !== null && value !== false && value !== undefined
}

test('events.observe returns a frozen projection handle and observes the frozen payload', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })
  const calls = []
  const handle = events.observe('goal/changed')
  assert.ok(Object.isFrozen(handle))
  assert.equal(typeof handle.current, 'function')
  assert.equal(typeof handle.subscribe, 'function')
  assert.equal(typeof handle.dispose, 'function')
  assert.equal(typeof handle.epoch, 'number')
  assert.equal(handle.epoch, 0)

  handle.subscribe((payload) => {
    assert.ok(Object.isFrozen(payload))
    calls.push(payload)
  })
  const payload = { agent: 'agent-1', change: 'created' }
  ctx.emit('goal/changed', payload)
  assert.equal(calls.length, 1)
  assert.equal(calls[0], payload)
  assert.equal(handle.epoch, 1)
  assert.equal(handle.current(), payload)
})

test('disposing the handle is idempotent, silences it, and leaves peers intact', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })
  const first = []
  const second = []
  const a = events.observe('goal/changed')
  const b = events.observe('goal/changed')
  a.subscribe((payload) => first.push(payload))
  b.subscribe((payload) => second.push(payload))

  ctx.emit('goal/changed', { change: 1 })
  assert.equal(first.length, 1)
  assert.equal(second.length, 1)

  assert.equal(a.dispose(), true)
  assert.equal(a.dispose(), false)
  ctx.emit('goal/changed', { change: 2 })
  assert.equal(first.length, 1, 'disposed handle is silent')
  assert.equal(second.length, 2, 'independent handle still observes')
})

test('non-cataloged names are passed through and observed via the same handle contract', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })

  const seen = []
  const handle = events.observe('custom/event')
  handle.subscribe((payload) => seen.push(payload))
  ctx.emit('custom/event', { custom: true })
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0], { custom: true })
  assert.equal(handle.epoch, 1)
})

test('a throwing or rejecting observer is contained and peers keep receiving', async () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })
  const calls = []
  const handle = events.observe('goal/changed')
  handle.subscribe((payload) => {
    throw new Error('boom')
  })
  handle.subscribe(async (payload) => {
    await Promise.resolve()
    throw new Error('async boom')
  })
  handle.subscribe((payload) => calls.push(payload.second))

  assert.doesNotThrow(() => ctx.emit('goal/changed', { second: true }))
  assert.deepEqual(calls, [true])
  await new Promise((resolve) => setImmediate(resolve))
})

test('scope-filtered emit delivers only to a matching opts.scope', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })
  const scopedCalls = []
  const globalCalls = []

  // goal/changed scope filtering is args[0].agent based (string agent).
  events.observe('goal/changed', { scope: 'agent-1' }).subscribe((payload) => scopedCalls.push(payload.agent))
  events.observe('goal/changed').subscribe((payload) => globalCalls.push(payload.agent))

  ctx.emit('goal/changed', { agent: 'agent-2', change: 'x' })
  ctx.emit('goal/changed', { agent: 'agent-1', change: 'x' })

  assert.deepEqual(scopedCalls, ['agent-1'])
  assert.deepEqual(globalCalls, ['agent-2', 'agent-1'])
})

test('presence-only scoped events match via the dispatch scope carrier', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })
  const scopedCalls = []

  events.observe('subagent/start', { scope: 'agent-1' }).subscribe((payload) => {
    scopedCalls.push(payload.runId)
  })

  ctx.scopedEmit(scopeTarget({}, 'agent-2'), 'subagent/start', { runId: 'run-2', provider: 'p', id: 'x', local: false })
  ctx.scopedEmit(scopeTarget({}, 'agent-1'), 'subagent/start', { runId: 'run-1', provider: 'p', id: 'y', local: false })

  assert.deepEqual(scopedCalls, ['run-1'])
})

test('opts.scope is ignored for non-scope-filtered events', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })
  let called = false
  events.observe('fs/observed', { scope: 'anything' }).subscribe(() => {
    called = true
  })

  ctx.emit('fs/observed', { targetKey: 't' }, { kind: 'present' }, {})
  assert.equal(called, true)
})

test('system-prompt/assemble scope filtering uses args[1].scope', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })
  const scopedCalls = []
  const globalCalls = []

  events.observe('system-prompt/assemble', { scope: 'agent-1' }).subscribe((payload) => {
    scopedCalls.push(payload[1].scope)
  })
  events.observe('system-prompt/assemble').subscribe((payload) => {
    globalCalls.push(payload[1].scope)
  })

  const assembly = { sections: [], contexts: [], tools: [], variables: {} }
  const inner = () => assembly
  ctx.waterfall('system-prompt/assemble', assembly, { scope: 'agent-2' }, inner)
  ctx.waterfall('system-prompt/assemble', assembly, { scope: 'agent-1' }, inner)

  assert.deepEqual(scopedCalls, ['agent-1'])
  assert.deepEqual(globalCalls, ['agent-2', 'agent-1'])
})

test('emit/serial/parallel/bail/waterfall delegate to ctx and return the discriminated dispatch outcome', async () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })

  ctx.emit('goal/changed', { agent: 'a' })
  assert.deepEqual(await events.emit('goal/changed', { agent: 'a' }), { ok: true, code: 'dispatched', outcome: null })
  assert.deepEqual(await events.bail('goal/changed', { agent: 'a' }), { ok: true, code: 'dispatched', outcome: null })
  assert.deepEqual(await events.serial('goal/changed', { agent: 'a' }), { ok: true, code: 'dispatched', outcome: null })

  const parallel = await events.parallel('goal/changed', { agent: 'a' })
  assert.equal(parallel.ok, true)
  assert.equal(parallel.code, 'dispatched')
  assert.deepEqual(parallel.outcome, [])

  const waterfall = await events.waterfall('goal/changed', { agent: 'a' }, () => 'inner')
  assert.equal(waterfall.ok, true)
  assert.equal(waterfall.code, 'dispatched')
  assert.equal(waterfall.outcome, 'inner')
})

test('monitor observers cannot bail or reshape serial dispatch', async () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })
  let observed = false
  events.observe('goal/changed').subscribe(() => {
    observed = true
    return 'attempted-bail'
  })

  const bailResult = await events.bail('goal/changed', { agent: 'a' })
  assert.equal(bailResult.outcome, null, 'a monitor observer cannot bail the dispatch')
  const serialResult = await events.serial('goal/changed', { agent: 'a' })
  assert.equal(serialResult.outcome, null, 'a monitor observer cannot reshape serial dispatch')
  assert.equal(observed, true)
})

test('waterfall dispatch contains throwing observers and keeps the chain result', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })
  events.observe('goal/changed').subscribe(() => {
    throw new Error('boom')
  })
  const result = ctx.waterfall('goal/changed', { agent: 'a' }, () => 'chain')
  assert.equal(result, 'chain')
})

test('tools/execute applies except-signal freezing and observes in-place signal replacement', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })
  const replacement = new AbortController().signal
  let bodySignal
  const seen = []

  const exec = {
    signal: new AbortController().signal,
    agent: 'agent-1',
    token: { id: 1 },
    name: 'run_code',
  }

  events.observe('tools/execute').subscribe((payload) => {
    const [received, next] = payload
    assert.equal(received, exec, 'observer must receive the same exec object')
    assert.equal(Object.isFrozen(received), false, 'exec itself is not fully frozen')
    assert.equal(Object.getOwnPropertyDescriptor(received, 'signal').writable, true)
    assert.equal(Object.getOwnPropertyDescriptor(received, 'name').writable, false)
    assert.ok(Object.isFrozen(received.token))
    received.signal = replacement
    seen.push(received)
    return next()
  })

  const result = ctx.waterfall('tools/execute', exec, () => {
    bodySignal = exec.signal
    return 'body-done'
  })

  assert.equal(result, 'body-done')
  assert.equal(bodySignal, replacement, 'the in-place signal replacement is visible to the rest of the chain')
  assert.equal(seen.length, 1)
})

test('tools/result emit delivers the frozen exec payload', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })
  let observed
  events.observe('tools/result').subscribe((payload) => {
    observed = payload[0]
    assert.ok(Object.isFrozen(payload[0]))
  })

  const exec = { id: 'e1', name: 'tool', arguments: {} }
  ctx.emit('tools/result', exec, { isError: false, content: [] })
  assert.equal(observed, exec)
})

test('agent contain emit events contain sync throws while remaining observers run', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })
  const seen = []
  events.observe('agent/disposed').subscribe(() => {
    throw new Error('boom')
  })
  events.observe('agent/disposed').subscribe((payload) => seen.push(payload.agent.id))
  assert.doesNotThrow(() => ctx.emit('agent/disposed', { agent: { id: 'a1' } }))
  assert.deepEqual(seen, ['a1'])
})

test('agent/created sync throw is contained by the projection entry', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })
  let vetoed = false
  events.observe('agent/created').subscribe(() => {
    vetoed = true
    throw new Error('veto')
  })
  events.observe('agent/created').subscribe(() => {
    vetoed = vetoed
  })
  assert.doesNotThrow(() => ctx.emit('agent/created', { agent: { id: 'a1' } }))
  assert.equal(vetoed, true)
})

test('llm/stream facade observer receives the frozen (options, next) args array', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })
  const seen = []

  events.observe('llm/stream').subscribe((payload) => {
    assert.ok(Array.isArray(payload))
    assert.ok(Object.isFrozen(payload), 'the args array is frozen')
    assert.ok(Object.isFrozen(payload[0]), 'options must be deep-frozen for the facade observer')
    seen.push(payload[0])
  })

  const options = { provider: 'deepseek', model: 'chat', messages: [] }
  const result = ctx.waterfall('llm/stream', options, () => 'stream-result')
  assert.equal(result, 'stream-result')
  assert.equal(seen.length, 1)
  assert.equal(seen[0], options)
})

test('events.waterfall("llm/stream") delegates to ctx.waterfall with the same args and returns its result', () => {
  const base = createMockCordisCtx()
  const calls = []
  const ctx = { ...base }
  const original = base.waterfall.bind(base)
  ctx.waterfall = (name, ...args) => {
    calls.push([name, ...args])
    return original(name, ...args)
  }

  const events = createEventsBus({ ctx, catalog: coreCatalog })
  const options = { provider: 'deepseek', model: 'chat', messages: [] }
  const next = () => 'delegated-result'

  const result = events.waterfall('llm/stream', options, next)

  assert.deepEqual(result, { ok: true, code: 'dispatched', outcome: 'delegated-result' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'llm/stream')
  assert.equal(calls[0][1], options)
  assert.equal(calls[0][2], next)
})

test('llm/adapters-updated observer is invoked with the undefined payload for a no-arg dispatch', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })
  const calls = []

  events.observe('llm/adapters-updated').subscribe((payload) => {
    calls.push(payload)
  })

  ctx.emit('llm/adapters-updated')

  assert.equal(calls.length, 1)
  assert.equal(calls[0], undefined)
})
