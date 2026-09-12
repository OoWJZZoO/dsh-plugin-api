import test from 'node:test'
import assert from 'node:assert/strict'
import { createEventsBus } from '../lib/events-bus.js'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { composeCatalogs } from '../lib/catalog-compose.js'
import { agentEventsCatalog } from '../lib/agent-events-catalog.js'
import { toolsEventsCatalog } from '../lib/tools-events-catalog.js'
import { PluginApiEventPriorityError } from '../lib/errors.js'

const coreCatalog = composeCatalogs(baseEventsCatalog, agentEventsCatalog, toolsEventsCatalog)

/**
 * Minimal Cordis-like context for host-side event bus tests (same shape as
 * the existing events-bus tests): optional thisArg shifting, hook filtering,
 * and native waterfall chaining semantics.
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

function createBus({ catalog = coreCatalog, warns = [] } = {}) {
  const ctx = createMockCordisCtx()
  const logger = { warn: (message) => warns.push(String(message)), error: () => {} }
  const bus = createEventsBus({ ctx, catalog, logger })
  return { ctx, bus, warns }
}

test('participation: undefined return continues the chain with its current input', () => {
  const { ctx, bus } = createBus()
  const dispose = bus.registerParticipation('agent/pre-step', {
    listener: (payload, next) => {
      assert.equal(typeof next, 'function')
      return undefined
    },
    classify: () => 'undecided',
    priority: 'high',
  })
  const outcome = ctx.waterfall('agent/pre-step', { agent: {}, messages: [], turn: 1, step: 0 }, () => ({
    kind: 'enter',
    messages: ['default'],
  }))
  assert.deepEqual(outcome, { kind: 'enter', messages: ['default'] })
  assert.equal(dispose(), true)
})

test('participation: a classified decision vetoes the rest of the chain', () => {
  const { ctx, bus } = createBus()
  let laterReached = false
  bus.registerParticipation('agent/pre-step', {
    listener: () => ({ kind: 'reject', reason: 'blocked' }),
    classify: (value) => (value?.kind === 'reject' ? 'decision' : 'malformed'),
    priority: 'lowest',
  })
  bus.registerParticipation('agent/pre-step', {
    listener: () => {
      laterReached = true
      return undefined
    },
    classify: () => 'undecided',
    priority: 'highest',
  })
  const outcome = ctx.waterfall('agent/pre-step', { agent: {}, messages: [], turn: 1, step: 0 }, () => ({
    kind: 'enter',
    messages: ['default'],
  }))
  assert.deepEqual(outcome, { kind: 'reject', reason: 'blocked' })
  assert.equal(laterReached, false, 'a vetoing decision truncates the chain (official no-next semantics)')
})

test('participation: malformed decision is treated as no decision with one bounded diagnostic', () => {
  const { ctx, bus, warns } = createBus()
  bus.registerParticipation('agent/pre-step', {
    listener: () => ({ totally: 'unexpected' }),
    classify: () => 'malformed',
    priority: 'normal',
  })
  const outcome = ctx.waterfall('agent/pre-step', { agent: {}, messages: ['secret-message-body'], turn: 1, step: 0 }, () => ({
    kind: 'enter',
    messages: ['default'],
  }))
  assert.deepEqual(outcome, { kind: 'enter', messages: ['default'] })
  assert.equal(warns.length, 1)
  assert.match(warns[0], /malformed and treated as no decision/)
  assert.ok(!warns[0].includes('secret-message-body'), 'the diagnostic stays bounded (no payload content)')
})

test('participation: throw and rejection are contained and the producer still completes', async () => {
  const { ctx, bus } = createBus()
  bus.registerParticipation('agent/pre-step', {
    listener: () => {
      throw new Error('policy exploded')
    },
    classify: () => 'undecided',
    priority: 'lowest',
  })
  bus.registerParticipation('agent/pre-step', {
    listener: () => Promise.reject(new Error('policy rejected')),
    classify: () => 'undecided',
    priority: 'highest',
  })
  const outcome = await ctx.waterfall('agent/pre-step', { agent: {}, messages: [], turn: 1, step: 0 }, () => ({
    kind: 'enter',
    messages: ['default'],
  }))
  assert.deepEqual(outcome, { kind: 'enter', messages: ['default'] })
})

test('participation: async decisions are awaited before the chain settles', async () => {
  const { ctx, bus } = createBus()
  let captured = null
  bus.registerParticipation('agent/pre-step', {
    listener: async (payload) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      captured = payload
      return { kind: 'enter', messages: ['async-rewritten'] }
    },
    classify: (value) => (value?.kind === 'enter' ? 'decision' : 'malformed'),
    priority: 'normal',
  })
  const outcome = await ctx.waterfall('agent/pre-step', { agent: {}, messages: [], turn: 1, step: 0 }, () => ({
    kind: 'enter',
    messages: ['default'],
  }))
  assert.deepEqual(outcome, { kind: 'enter', messages: ['async-rewritten'] })
  assert.notEqual(captured, null, 'the payload reached the async policy before the dispatch settled')
})

test('participation: async pre-capture completes before the chain continues to the side effect', async () => {
  const { ctx, bus } = createBus()
  const order = []
  bus.registerParticipation('tools/execute', {
    listener: async (exec, next) => {
      order.push('capture-start')
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push('capture-done')
      return next()
    },
    classify: () => 'decision',
    priority: 'normal',
  })
  const outcome = await ctx.waterfall('tools/execute', { name: 'tool', agent: {} }, () => {
    order.push('side-effect')
    return { ok: true }
  })
  assert.deepEqual(order, ['capture-start', 'capture-done', 'side-effect'])
  assert.deepEqual(outcome, { ok: true })
})

test('participation: denial decisions propagate the typed denial error through the dispatch', () => {
  const { ctx, bus } = createBus()
  bus.registerParticipation('fs/write-intent', {
    listener: () => ({ kind: 'deny', reason: 'pre-capture denied the write' }),
    classify: (value) => (value?.kind === 'deny' ? 'decision' : 'malformed'),
    priority: 'normal',
    denialErrorOf: (value) => new Error(`fs intent denied: ${value.reason}`),
  })
  assert.throws(
    () => ctx.waterfall('fs/write-intent', { targetKey: 'k', displayPath: 'p' }, { signal: null }, () => undefined),
    /fs intent denied: pre-capture denied the write/,
  )
})

test('participation: entries order by fixed priority then successful registration order', () => {
  const { ctx, bus } = createBus()
  const order = []
  // Tier order is lowest → highest (the documented facade ordering contract);
  // same-tier entries keep successful registration order.
  bus.registerParticipation('agent/pre-step', {
    listener: () => {
      order.push('normal-1')
      return undefined
    },
    classify: () => 'undecided',
  })
  bus.registerParticipation('agent/pre-step', {
    listener: () => {
      order.push('highest')
      return undefined
    },
    classify: () => 'undecided',
    priority: 'highest',
  })
  bus.registerParticipation('agent/pre-step', {
    listener: () => {
      order.push('normal-2')
      return undefined
    },
    classify: () => 'undecided',
  })
  ctx.waterfall('agent/pre-step', { agent: {}, messages: [], turn: 1, step: 0 }, () => ({ kind: 'enter', messages: [] }))
  assert.deepEqual(order, ['normal-1', 'normal-2', 'highest'])
})

test('participation: monitor is rejected as a participation priority', () => {
  const { bus } = createBus()
  assert.throws(
    () => bus.registerParticipation('agent/pre-step', {
      listener: () => undefined,
      classify: () => 'undecided',
      priority: 'monitor',
    }),
    PluginApiEventPriorityError,
  )
})

test('participation: scope binding skips non-matching dispatches and continues the chain', () => {
  const { ctx, bus } = createBus()
  const agentA = { id: 'a' }
  const agentB = { id: 'b' }
  let invoked = 0
  bus.registerParticipation('agent/pre-step', {
    listener: () => {
      invoked += 1
      return undefined
    },
    classify: () => 'undecided',
    scope: agentA,
  })
  ctx.waterfall('agent/pre-step', { agent: agentB, messages: [], turn: 1, step: 0 }, () => ({ kind: 'enter', messages: [] }))
  assert.equal(invoked, 0, 'a scope-bound policy is not invoked for a non-matching agent')
  ctx.waterfall('agent/pre-step', { agent: agentA, messages: [], turn: 1, step: 0 }, () => ({ kind: 'enter', messages: [] }))
  assert.equal(invoked, 1)
})

test('participation: the observe feed still observes the dispatch and never participates', async () => {
  const { ctx, bus } = createBus()
  bus.registerParticipation('agent/pre-step', {
    listener: (payload, next) => {
      // The policy passes (no decision): the chain continues through the
      // monitor feed, which observes without participating.
      return next()
    },
    classify: () => 'undecided',
    priority: 'normal',
  })
  const handle = bus.observe('agent/pre-step')
  const seen = []
  const unsubscribe = handle.subscribe((payload) => {
    seen.push(payload)
    return { kind: 'enter', messages: ['observer-veto'] }
  })
  const outcome = await ctx.waterfall('agent/pre-step', { agent: {}, messages: [], turn: 1, step: 0 }, () => ({
    kind: 'enter',
    messages: ['default'],
  }))
  assert.deepEqual(outcome, { kind: 'enter', messages: ['default'] }, "the observer's return value never participates")
  assert.equal(seen.length, 1, 'the observe feed keeps observing dispatches while participation is active')
  unsubscribe()
  handle.dispose()
})

test('participation: disposal removes the slot and restores official-equivalent behavior', () => {
  const { ctx, bus } = createBus()
  const dispose = bus.registerParticipation('agent/pre-step', {
    listener: () => ({ kind: 'reject', reason: 'blocked' }),
    classify: (value) => (value?.kind === 'reject' ? 'decision' : 'malformed'),
  })
  assert.equal(dispose(), true)
  assert.equal(dispose(), false, 'disposal is idempotent')
  const outcome = ctx.waterfall('agent/pre-step', { agent: {}, messages: [], turn: 1, step: 0 }, () => ({
    kind: 'enter',
    messages: ['default'],
  }))
  assert.deepEqual(outcome, { kind: 'enter', messages: ['default'] })
})

test('participation: registration validates the active catalog, dispatch mode, and spec shape', () => {
  const { bus } = createBus()
  assert.throws(
    () => bus.registerParticipation('compaction/request', { listener: () => undefined, classify: () => 'undecided' }),
    /not part of the currently active event vocabulary/,
  )
  assert.throws(
    () => bus.registerParticipation('agent/created', { listener: () => undefined, classify: () => 'undecided' }),
    /not a waterfall decision dispatch/,
  )
  assert.throws(
    () => bus.registerParticipation('agent/pre-step', { listener: () => undefined }),
    /requires a listener and a decision classifier/,
  )
})
