/**
 * Writable-waterfall contract: `system-prompt/assemble` keeps the runtime
 * assembly and context argument graphs writable before and after `await
 * next()`, lets listeners replace fields or return a replacement assembly,
 * propagates normal listener failures before/after `next()` exactly like the
 * official waterfall, contains only `monitor` listeners, and leaves every
 * other event's freeze behavior unchanged.
 *
 * The harness mirrors the migration-parity mock: Cordis dispatches waterfall
 * listeners outermost-first over the trailing `next`; a listener that does
 * not call `next()` vetoes the rest of the chain and its return becomes the
 * result (the official `dsh-system-prompt` passes `() => Promise.resolve(assembly)`
 * as the innermost callback and treats the transformed assembly as
 * authoritative).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEventsBus, EVENT_PRIORITIES } from '../lib/events-bus.js'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { composeCatalogs } from '../lib/catalog-compose.js'
import { freezeByPolicy } from '../lib/deep-freeze.js'
import { systemPromptEventsCatalog } from '../lib/system-prompt-events-catalog.js'

function createWaterfallCtx() {
  const hooks = new Map()

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

  return {
    hooksOf,
    on(name, listener) {
      const list = hooksOf(name)
      list.push({ callback: listener, options: {} })
      return () => {
        const index = list.findIndex((hook) => hook.callback === listener)
        if (index >= 0) list.splice(index, 1)
        return index >= 0
      }
    },
    once(name, listener) {
      const dispose = this.on(name, function onceWrapper(...args) {
        dispose()
        return listener.apply(this, args)
      })
      return dispose
    },
    emit(name, ...args) {
      const callArgs = [name, ...args]
      for (const callback of dispatch('emit', callArgs)) callback(...callArgs)
    },
    serial() {
      return Promise.resolve(undefined)
    },
    parallel() {
      return Promise.resolve(undefined)
    },
    bail() {
      return undefined
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
}

function createBus() {
  const ctx = createWaterfallCtx()
  const events = createEventsBus({
    ctx,
    catalog: composeCatalogs(baseEventsCatalog, systemPromptEventsCatalog),
  })
  return { ctx, events }
}

function makeAssembly(overrides = {}) {
  return {
    sections: [{ name: 's1', text: 'original' }],
    contexts: [],
    tools: [],
    variables: {},
    ...overrides,
  }
}

test('assembly sections, contexts, tools, and variables stay writable before and after await next()', async () => {
  const { ctx, events } = createBus()
  const assembly = makeAssembly()
  const context = { scope: 'agent-1' }
  const inner = () => Promise.resolve(assembly)

  events.on('system-prompt/assemble', async (current, currentCtx, next) => {
    // Mutate all four approved fields before continuing the chain.
    assert.equal(Object.isFrozen(current), false, 'assembly is not frozen')
    assert.equal(Object.isFrozen(currentCtx), false, 'context is not frozen')
    current.sections.push({ name: 's2', text: 'added-before' })
    current.contexts.push({ name: 'c1', text: 'ctx' })
    current.tools.push({ name: 'tool-1' })
    current.variables.alpha = 1
    await next()
    // Mutation after the downstream chain completed must survive into the
    // authoritative result when the listener returns the assembly.
    current.variables.beta = 2
    current.sections[0].text = 'rewritten-after'
    return current
  })
  events.on('system-prompt/assemble', (current) => {
    assert.deepEqual(current.variables, { alpha: 1 }, 'pre-next mutation is visible to later listeners')
    current.contexts.push({ name: 'c2', text: 'ctx' })
    return Promise.resolve(current)
  })

  const result = await ctx.waterfall('system-prompt/assemble', assembly, context, inner)

  assert.equal(result, assembly, 'identity preserved through the chain')
  assert.deepEqual(result.sections.map((section) => section.name), ['s1', 's2'])
  assert.deepEqual(result.contexts.map((entry) => entry.name), ['c1', 'c2'])
  assert.deepEqual(result.tools, [{ name: 'tool-1' }])
  assert.deepEqual(result.variables, { alpha: 1, beta: 2 })
  assert.equal(result.sections[0].text, 'rewritten-after')
})

test('listeners may replace top-level assembly fields before and after next()', async () => {
  const { ctx, events } = createBus()
  const assembly = makeAssembly()
  const inner = () => Promise.resolve(assembly)

  events.on('system-prompt/assemble', async (current, _context, next) => {
    current.sections = [{ name: 'replaced-before', text: 'r' }] // replace before next
    await next()
    current.tools = [{ name: 'tool-after' }] // replace after next
    return current
  })
  events.on('system-prompt/assemble', (current) => {
    assert.equal(current.sections[0].name, 'replaced-before', 'replacement is visible downstream')
    return Promise.resolve(current)
  })

  const result = await ctx.waterfall('system-prompt/assemble', assembly, {}, inner)
  assert.deepEqual(result.sections, [{ name: 'replaced-before', text: 'r' }])
  assert.deepEqual(result.tools, [{ name: 'tool-after' }])
})

test('a returned replacement assembly is authoritative (veto without next())', async () => {
  const { ctx, events } = createBus()
  const assembly = makeAssembly()
  const replacement = makeAssembly({ sections: [{ name: 'replaced', text: 's' }] })
  const inner = () => Promise.resolve(assembly)
  let downstreamRan = false
  events.on('system-prompt/assemble', () => {
    // This listener aborts the chain: it never calls next().
    downstreamRan = true
    return replacement
  })
  events.on('system-prompt/assemble', () => {
    throw new Error('the chain must be vetoed before this listener')
  })

  const result = await ctx.waterfall('system-prompt/assemble', assembly, { scope: 'agent-1' }, inner)
  assert.equal(downstreamRan, true)
  assert.equal(result, replacement, 'the returned assembly is used verbatim')
})

test('scope and signal identity are preserved and scope filtering still applies', async () => {
  const { ctx, events } = createBus()
  const scope = { id: 'agent-1' }
  const signal = new AbortController().signal
  const context = { scope, signal }
  const seen = []
  const inner = () => Promise.resolve(makeAssembly())

  events.on('system-prompt/assemble', (assembly, currentCtx, next) => {
    seen.push(currentCtx.scope)
    return next()
  }, { scope })

  events.on('system-prompt/assemble', (assembly, currentCtx, next) => {
    throw new Error('non-matching scope must not be delivered')
  }, { scope: { id: 'other' } })

  const result = await ctx.waterfall('system-prompt/assemble', makeAssembly(), context, inner)
  assert.equal(result !== undefined, true)
  assert.deepEqual(seen, [scope], 'only the matching scope listener is delivered')
})

test('normal listener failures propagate: sync throw before next() reaches the caller unchanged', () => {
  const { ctx, events } = createBus()
  const expected = new Error('sync failure before next')
  events.on('system-prompt/assemble', () => {
    throw expected
  })
  assert.throws(() => ctx.waterfall('system-prompt/assemble', makeAssembly(), {}, () => makeAssembly()), (error) => error === expected)
})

test('normal listener failures propagate: rejection returned by next() is unchanged', async () => {
  const { ctx, events } = createBus()
  const expected = new Error('inner rejected')
  events.on('system-prompt/assemble', async (_assembly, _context, next) => {
    await next()
  })
  await assert.rejects(
    ctx.waterfall('system-prompt/assemble', makeAssembly(), {}, () => Promise.reject(expected)),
    (error) => error === expected,
  )
})

test('normal listener failures propagate: rejection after await next() is unchanged', async () => {
  const { ctx, events } = createBus()
  const expected = new Error('failure after next')
  events.on('system-prompt/assemble', async (_assembly, _context, next) => {
    await next()
    throw expected
  })
  await assert.rejects(
    ctx.waterfall('system-prompt/assemble', makeAssembly(), {}, () => Promise.resolve(makeAssembly())),
    (error) => error === expected,
  )
})

test('monitor listeners stay contained and never own the waterfall result', async () => {
  const { ctx, events } = createBus()
  const assembly = makeAssembly()
  let normalRan = false
  let monitorRan = false

  events.on('system-prompt/assemble', (current, _context, next) => {
    normalRan = true
    return next()
  })
  events.on('system-prompt/assemble', () => {
    monitorRan = true
    return makeAssembly({ sections: [{ name: 'monitor-replacement', text: 'x' }] })
  }, { priority: 'monitor' })
  events.on('system-prompt/assemble', () => {
    throw new Error('monitor failure must be contained')
  }, { priority: 'monitor' })

  const result = await ctx.waterfall('system-prompt/assemble', assembly, {}, () => Promise.resolve(assembly))
  assert.equal(normalRan, true, 'the normal listener continues the chain')
  assert.equal(monitorRan, true, 'monitors observe after the chain')
  assert.equal(result, assembly, 'the monitor return never becomes the waterfall result')
  assert.ok(EVENT_PRIORITIES.includes('monitor'))
})

test('freezeByPolicy waterfall policy leaves the argument graph untouched', () => {
  const nested = { list: [{ value: 1 }] }
  const returned = freezeByPolicy(nested, 'waterfall')
  assert.equal(returned, nested)
  assert.equal(Object.isFrozen(nested), false)
  assert.equal(Object.isFrozen(nested.list), false)
  assert.equal(Object.isFrozen(nested.list[0]), false)
  nested.list[0].value = 2
  nested.extra = true
  assert.equal(nested.list[0].value, 2)
  assert.equal(nested.extra, true)
})

test('unrelated events keep their freeze policies unchanged', () => {
  const { ctx, events } = createBus()
  const payload = { target: { targetKey: 'k', displayPath: 'p' }, observation: { kind: 'present' }, actor: 'a' }
  events.on('fs/observed', (received) => {
    assert.ok(Object.isFrozen(received), 'fs payload stays deep-frozen')
    assert.ok(Object.isFrozen(received.target))
    assert.ok(Object.isFrozen(received.observation))
  })
  ctx.emit('fs/observed', payload)
  assert.ok(Object.isFrozen(payload))
})