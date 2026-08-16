import test from 'node:test'
import assert from 'node:assert/strict'
import { createEventsBus } from '../lib/events-bus.js'
import { eventsCatalog, mergeEventCatalogs } from '../lib/events-catalog.js'
import { toolsEventsCatalog } from '../lib/tools-events-catalog.js'
import { PluginApiEventPriorityError } from '../lib/errors.js'
import { scopeTarget } from '@deepseek-ai/dsh-scope'

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

test('events.on registers a cataloged listener and returns an idempotent disposer', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })
  const calls = []
  const dispose = events.on('goal/changed', (payload) => calls.push(payload))

  const payload = { agent: 'agent-1', change: 'created' }
  ctx.emit('goal/changed', payload)
  assert.equal(calls.length, 1)
  assert.equal(calls[0], payload)

  assert.equal(dispose(), true)
  assert.equal(dispose(), false)
  ctx.emit('goal/changed', payload)
  assert.equal(calls.length, 1)
})

test('events.once invokes the listener at most once and removes it before invocation', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })
  const calls = []
  const dispose = events.once('goal/changed', (payload) => calls.push(payload))

  ctx.emit('goal/changed', { agent: 'a' })
  ctx.emit('goal/changed', { agent: 'a' })
  assert.equal(calls.length, 1)

  // Once semantics mirror Cordis: the hook is removed before the listener runs,
  // so no facade hook remains after the first dispatch.
  assert.equal(ctx.hooksOf('goal/changed').length, 0)

  // The returned disposer reports that the entry is already gone.
  assert.equal(dispose(), false)
})

test('non-cataloged names are passed through to ctx.on/ctx.once untouched', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })

  const listener = () => {}
  events.on('custom/event', listener)
  const hooks = ctx.hooksOf('custom/event')
  assert.equal(hooks.length, 1)
  assert.equal(hooks[0].callback, listener, 'non-cataloged listener must not be wrapped')

  const onceListener = () => {}
  events.once('custom/once', onceListener)
  ctx.emit('custom/once')
  ctx.emit('custom/once')
  assert.equal(ctx.hooksOf('custom/once').length, 0, 'ctx.once should self-dispose')
})

test('priority tiers order listeners lowest → low → normal → high → highest → monitor', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })
  const calls = []

  events.on('goal/changed', () => calls.push('normal-1'), { priority: 'normal' })
  events.on('goal/changed', () => calls.push('highest'), { priority: 'highest' })
  events.on('goal/changed', () => calls.push('low'), { priority: 'low' })
  events.on('goal/changed', () => calls.push('normal-2'), { priority: 'normal' })
  events.on('goal/changed', () => calls.push('monitor'), { priority: 'monitor' })
  events.on('goal/changed', () => calls.push('lowest'), { priority: 'lowest' })

  ctx.emit('goal/changed', { agent: 'a', change: 'x' })
  assert.deepEqual(calls, ['lowest', 'low', 'normal-1', 'normal-2', 'highest', 'monitor'])
})

test('same priority tier preserves registration order', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })
  const calls = []

  events.on('goal/changed', () => calls.push('first'), { priority: 'high' })
  events.on('goal/changed', () => calls.push('second'), { priority: 'high' })
  events.on('goal/changed', () => calls.push('third'), { priority: 'high' })

  ctx.emit('goal/changed', { agent: 'a' })
  assert.deepEqual(calls, ['first', 'second', 'third'])
})

test('disposing a listener updates the priority order', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })
  const calls = []

  const disposeLow = events.on('goal/changed', () => calls.push('low'), { priority: 'low' })
  events.on('goal/changed', () => calls.push('high'), { priority: 'high' })

  assert.equal(disposeLow(), true)
  ctx.emit('goal/changed', { agent: 'a' })
  assert.deepEqual(calls, ['high'])
})

test('invalid priority throws a typed error and registers nothing', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })

  assert.throws(
    () => events.on('goal/changed', () => {}, { priority: 'urgent' }),
    (error) => error instanceof PluginApiEventPriorityError && error.priority === 'urgent',
  )
  assert.equal(ctx.hooksOf('goal/changed').length, 0)
})

test('facade listeners receive a deep-frozen payload', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })

  events.on('goal/changed', (payload) => {
    assert.ok(Object.isFrozen(payload))
  })
  ctx.emit('goal/changed', { agent: 'a', change: 'x' })
})

test('emit contains a throwing listener and continues dispatching', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })
  const calls = []

  events.on('goal/changed', () => {
    throw new Error('boom')
  })
  events.on('goal/changed', () => calls.push('second'))

  assert.doesNotThrow(() => ctx.emit('goal/changed', { agent: 'a' }))
  assert.deepEqual(calls, ['second'])
})

test('bail contains a throwing listener and returns the next bail value', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })

  events.on('goal/changed', () => {
    throw new Error('boom')
  })
  events.on('goal/changed', () => 'allowed')

  assert.equal(ctx.bail('goal/changed', { agent: 'a' }), 'allowed')
})

test('serial contains a rejected listener and continues to the next bail value', async () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })

  events.on('goal/changed', async () => {
    throw new Error('async boom')
  })
  events.on('goal/changed', async () => 'allowed')

  assert.equal(await ctx.serial('goal/changed', { agent: 'a' }), 'allowed')
})

test('parallel contains sync throws and rejections and resolves', async () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })
  const calls = []

  events.on('goal/changed', () => {
    throw new Error('sync boom')
  })
  events.on('goal/changed', async () => {
    throw new Error('async boom')
  })
  events.on('goal/changed', () => calls.push('third'))

  await assert.doesNotReject(() => ctx.parallel('goal/changed', { agent: 'a' }))
  assert.deepEqual(calls, ['third'])
})

test('monitor listeners cannot bail (observe-only)', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })
  let called = false

  events.on('goal/changed', () => {
    called = true
    return 'ignored'
  }, { priority: 'monitor' })

  assert.equal(ctx.bail('goal/changed', { agent: 'a' }), undefined)
  assert.equal(called, true)
})

test('monitor listeners cannot alter serial dispatch', async () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })
  let called = false

  events.on('goal/changed', async () => {
    called = true
    return 'ignored'
  }, { priority: 'monitor' })

  assert.equal(await ctx.serial('goal/changed', { agent: 'a' }), undefined)
  assert.equal(called, true)
})

test('scope-filtered emit delivers only to a matching opts.scope', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })
  const scopedCalls = []
  const globalCalls = []

  events.on('goal/changed', (payload) => scopedCalls.push(payload.agent), { scope: 'agent-1' })
  events.on('goal/changed', (payload) => globalCalls.push(payload.agent))

  ctx.emit('goal/changed', { agent: 'agent-2', change: 'x' })
  ctx.emit('goal/changed', { agent: 'agent-1', change: 'x' })

  assert.deepEqual(scopedCalls, ['agent-1'])
  assert.deepEqual(globalCalls, ['agent-2', 'agent-1'])
})

test('scope mismatch in a waterfall continues the chain via next()', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })
  const calls = []

  events.on('approval/request', () => {
    calls.push('scoped')
    return 'allowed-once'
  }, { scope: 'agent-1' })

  const resultForOther = ctx.waterfall(
    'approval/request',
    { agent: 'agent-2', toolName: 'tool' },
    () => 'unavailable',
  )
  assert.equal(resultForOther, 'unavailable')
  assert.deepEqual(calls, [])

  const resultForMatch = ctx.waterfall(
    'approval/request',
    { agent: 'agent-1', toolName: 'tool' },
    () => 'unavailable',
  )
  assert.equal(resultForMatch, 'allowed-once')
  assert.deepEqual(calls, ['scoped'])
})

test('presence-only scoped events match via the dispatch scope carrier', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })
  const scopedCalls = []

  events.on('subagent/start', (info) => scopedCalls.push(info.runId), { scope: 'agent-1' })

  ctx.scopedEmit(scopeTarget({}, 'agent-2'), 'subagent/start', { runId: 'run-2', provider: 'p', id: 'x', local: false })
  ctx.scopedEmit(scopeTarget({}, 'agent-1'), 'subagent/start', { runId: 'run-1', provider: 'p', id: 'y', local: false })

  assert.deepEqual(scopedCalls, ['run-1'])
})

test('opts.scope is ignored for non-scope-filtered events', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })
  let called = false

  events.on('fs/observed', () => {
    called = true
  }, { scope: 'anything' })

  ctx.emit('fs/observed', { targetKey: 't' }, { kind: 'present' }, {})
  assert.equal(called, true)
})

test('waterfall contains a throwing listener and continues with next()', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })
  const calls = []

  events.on('session-telemetry/record', () => {
    calls.push('first')
    throw new Error('boom')
  })
  events.on('session-telemetry/record', () => {
    calls.push('second')
    return 'from-second'
  })

  const result = ctx.waterfall('session-telemetry/record', { record: {} }, () => 'final')
  assert.equal(result, 'from-second')
  assert.deepEqual(calls, ['first', 'second'])
})

test('waterfall contains an async rejection and continues with next()', async () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })
  const calls = []

  events.on('session-telemetry/record', async () => {
    calls.push('first')
    throw new Error('async boom')
  })
  events.on('session-telemetry/record', () => {
    calls.push('second')
    return 'from-second'
  })

  const result = await ctx.waterfall('session-telemetry/record', { record: {} }, () => 'final')
  assert.equal(result, 'from-second')
  assert.deepEqual(calls, ['first', 'second'])
})

test('monitor waterfall listeners cannot veto or rewrite the chain result', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: eventsCatalog })
  let called = false

  events.on('session-telemetry/record', () => {
    called = true
    return 'ignored'
  }, { priority: 'monitor' })

  const result = ctx.waterfall('session-telemetry/record', { record: {} }, () => 'final')
  assert.equal(result, 'final')
  assert.equal(called, true)
})

test('events.emit/serial/parallel/bail/waterfall delegate to ctx and return its result', async () => {
  const base = createMockCordisCtx()
  const calls = []
  const ctx = { ...base }

  for (const method of ['emit', 'serial', 'parallel', 'bail', 'waterfall']) {
    const original = base[method].bind(base)
    ctx[method] = (name, ...args) => {
      calls.push([method, name, ...args])
      return original(name, ...args)
    }
  }

  const events = createEventsBus({ ctx, catalog: eventsCatalog })
  const received = []
  events.on('goal/changed', (payload) => received.push(payload))

  const payload = { agent: 'a', change: 'x' }
  events.emit('goal/changed', payload)
  assert.equal(received.length, 1)
  assert.deepEqual(calls.shift(), ['emit', 'goal/changed', payload])

  events.bail('goal/changed', payload)
  assert.deepEqual(calls.shift(), ['bail', 'goal/changed', payload])

  await events.serial('goal/changed', payload)
  assert.deepEqual(calls.shift(), ['serial', 'goal/changed', payload])

  await events.parallel('goal/changed', payload)
  assert.deepEqual(calls.shift(), ['parallel', 'goal/changed', payload])

  const waterfallResult = events.waterfall('session-telemetry/record', { record: {} }, () => 'done')
  assert.equal(waterfallResult, 'done')
  const waterfallCall = calls.shift()
  assert.equal(waterfallCall[0], 'waterfall')
  assert.equal(waterfallCall[1], 'session-telemetry/record')
  assert.deepEqual(waterfallCall[2], { record: {} })
  assert.equal(typeof waterfallCall[3], 'function')
})

test('tools/change is cataloged as a global emit and receives no payload', () => {
  const ctx = createMockCordisCtx()
  const catalog = mergeEventCatalogs(eventsCatalog, toolsEventsCatalog)
  const events = createEventsBus({ ctx, catalog })
  const calls = []

  events.on('tools/change', (...args) => calls.push(args), { scope: 'agent-1' })

  ctx.emit('tools/change')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], [])
})

test('scope-filtered tools events deliver only to matching opts.scope', () => {
  const ctx = createMockCordisCtx()
  const catalog = mergeEventCatalogs(eventsCatalog, toolsEventsCatalog)
  const events = createEventsBus({ ctx, catalog })
  const scoped = []
  const global = []

  events.on('tools/result', (exec) => scoped.push(exec.agent), { scope: 'agent-1' })
  events.on('tools/result', (exec) => global.push(exec.agent))

  ctx.emit('tools/result', { agent: 'agent-2', name: 'x' }, { isError: false, content: [] })
  ctx.emit('tools/result', { agent: 'agent-1', name: 'x' }, { isError: false, content: [] })

  assert.deepEqual(scoped, ['agent-1'])
  assert.deepEqual(global, ['agent-2', 'agent-1'])
})

test('tools/execute applies except-signal freezing and observes in-place signal replacement', () => {
  const ctx = createMockCordisCtx()
  const catalog = mergeEventCatalogs(eventsCatalog, toolsEventsCatalog)
  const events = createEventsBus({ ctx, catalog })
  const replacement = new AbortController().signal
  let bodySignal

  const exec = {
    signal: new AbortController().signal,
    agent: 'agent-1',
    token: { id: 1 },
    name: 'run_code',
  }

  events.on('tools/execute', (received, next) => {
    assert.equal(received, exec, 'listener must receive the same exec object')
    assert.equal(Object.isFrozen(received), false, 'exec itself is not fully frozen')
    assert.equal(Object.getOwnPropertyDescriptor(received, 'signal').writable, true)
    assert.equal(Object.getOwnPropertyDescriptor(received, 'name').writable, false)
    assert.ok(Object.isFrozen(received.token))
    received.signal = replacement
    return next()
  })

  const result = ctx.waterfall('tools/execute', exec, () => {
    bodySignal = exec.signal
    return 'body-done'
  })

  assert.equal(result, 'body-done')
  assert.equal(bodySignal, replacement)
})

test('tools/pre-execute waterfall receives a fully frozen exec payload', () => {
  const ctx = createMockCordisCtx()
  const catalog = mergeEventCatalogs(eventsCatalog, toolsEventsCatalog)
  const events = createEventsBus({ ctx, catalog })
  const exec = { agent: 'agent-1', signal: new AbortController().signal, name: 'tool' }

  events.on('tools/pre-execute', (received, next) => {
    assert.equal(received, exec)
    assert.ok(Object.isFrozen(received), 'pre-execute exec must be fully frozen')
    return next()
  })

  const result = ctx.waterfall('tools/pre-execute', exec, () => ({ kind: 'allow' }))
  assert.deepEqual(result, { kind: 'allow' })
})

test('tools/post-execute waterfall receives frozen exec and frozen result', () => {
  const ctx = createMockCordisCtx()
  const catalog = mergeEventCatalogs(eventsCatalog, toolsEventsCatalog)
  const events = createEventsBus({ ctx, catalog })
  const exec = { agent: 'agent-1', signal: new AbortController().signal }
  const result = { isError: false, content: [], value: { ok: true } }

  events.on('tools/post-execute', (receivedExec, receivedResult, next) => {
    assert.ok(Object.isFrozen(receivedExec))
    assert.ok(Object.isFrozen(receivedResult))
    return next()
  })

  const decision = ctx.waterfall('tools/post-execute', exec, result, () => ({ kind: 'accept' }))
  assert.deepEqual(decision, { kind: 'accept' })
})

test('tools/code-dispatch-log waterfall receives frozen dispatch and can replace content', () => {
  const ctx = createMockCordisCtx()
  const catalog = mergeEventCatalogs(eventsCatalog, toolsEventsCatalog)
  const events = createEventsBus({ ctx, catalog })
  const dispatch = {
    agent: 'agent-1',
    exec: { agent: 'agent-1', name: 'run_code' },
    subCallId: 'run:code:0',
    name: 'bash',
    isError: false,
    content: [{ type: 'text', text: 'original' }],
  }
  const replacementContent = [{ type: 'text', text: 'replaced' }]

  events.on('tools/code-dispatch-log', (received, next) => {
    assert.equal(received, dispatch)
    assert.ok(Object.isFrozen(received))
    return replacementContent
  })

  const result = ctx.waterfall('tools/code-dispatch-log', dispatch, () => dispatch.content)
  assert.deepEqual(result, replacementContent)
})

test('tools/result emit receives frozen exec and frozen result', () => {
  const ctx = createMockCordisCtx()
  const catalog = mergeEventCatalogs(eventsCatalog, toolsEventsCatalog)
  const events = createEventsBus({ ctx, catalog })
  const exec = { agent: 'agent-1', signal: new AbortController().signal }
  const result = { isError: false, content: [], value: { ok: true } }

  events.on('tools/result', (receivedExec, receivedResult) => {
    assert.ok(Object.isFrozen(receivedExec))
    assert.ok(Object.isFrozen(receivedResult))
  })

  ctx.emit('tools/result', exec, result)
})
