/**
 * Projection-contract coverage for `system-prompt/assemble`: the observe
 * entry is the merged subscription surface, observers receive the fully
 * frozen assembly/context payloads, listener failures are contained, and
 * the waterfall dispatch of the assemble decision point returns the
 * documented dispatch outcome. The reversible assembly inputs themselves
 * are contributed through `prompts.contribute` (contribution idiom) — see
 * the prompts contribution suites — so the assembly mutation capability is
 * exercised there, not through the projection listeners.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEventsBus } from '../lib/events-bus.js'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { composeCatalogs } from '../lib/catalog-compose.js'
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

function makeAssembly() {
  return {
    sections: [{ name: 's1', text: 'original' }],
    contexts: [],
    tools: [],
    variables: {},
  }
}

test('assemble observation delivers the frozen assembly payload through the projection handle', async () => {
  const { ctx, events } = createBus()
  const assembly = makeAssembly()
  const context = { scope: 'agent-1' }
  const seen = []

  const handle = events.observe('system-prompt/assemble')
  handle.subscribe((payload) => {
    // The projection delivers the single-arg event payload: the assembly.
    seen.push(payload)
    assert.ok(Object.isFrozen(payload), 'assembly is delivered frozen')
    assert.ok(Object.isFrozen(payload.sections), 'sections are deep-frozen')
    assert.equal(payload.sections[0].text, 'original')
  })

  ctx.waterfall('system-prompt/assemble', assembly, context, () => Promise.resolve(assembly))
  assert.equal(seen.length, 1)
  assert.equal(handle.epoch, 1)
})

test('a throwing or rejecting observer is contained and never reaches the dispatch caller', async () => {
  const { ctx, events } = createBus()
  const assembly = makeAssembly()
  const context = { scope: 'agent-1' }
  const seen = []

  const handle = events.observe('system-prompt/assemble')
  handle.subscribe(() => {
    throw new Error('observer boom')
  })
  handle.subscribe(async () => {
    await Promise.resolve()
    throw new Error('observer async boom')
  })
  handle.subscribe((payload) => seen.push(payload))

  const result = await ctx.waterfall('system-prompt/assemble', assembly, context, () => Promise.resolve(assembly))
  assert.equal(result, assembly, 'the dispatch chain resolves with the innermost assembly')
  assert.equal(seen.length, 1, 'peer observers still receive the payload')
  assert.equal(handle.epoch, 1)
})

test('scope and signal identity are preserved and scope filtering still applies', async () => {
  const { ctx, events } = createBus()
  const assembly = makeAssembly()
  const context = { scope: 'agent-1', signal: new AbortController().signal }
  const seen = []

  // system-prompt/assemble scope filtering is args[1].scope based; the
  // scope value is the context scope key, not the context object.
  const scoped = events.observe('system-prompt/assemble', { scope: context.scope })
  scoped.subscribe((payload) => seen.push(['scoped', payload[0]]))
  const global = events.observe('system-prompt/assemble')
  global.subscribe((payload) => seen.push(['global', payload[0]]))

  ctx.waterfall('system-prompt/assemble', assembly, context, () => Promise.resolve(assembly))
  assert.deepEqual(seen.map(([kind]) => kind), ['scoped', 'global'])
  assert.equal(seen[0][1], assembly, 'the identity of the assembled document is preserved')

  const other = { scope: 'agent-2' }
  ctx.waterfall('system-prompt/assemble', assembly, other, () => Promise.resolve(assembly))
  assert.deepEqual(seen.map(([kind]) => kind), ['scoped', 'global', 'global'], 'the scoped observer only matches its own scope')
})

test('monitor-tier observers stay contained and never own the waterfall result', async () => {
  const { ctx, events } = createBus()
  const assembly = makeAssembly()
  const seen = []

  events.observe('system-prompt/assemble').subscribe((payload) => {
    seen.push(payload[0])
    // A monitor observer attempting to rewrite the chain is ignored.
    return { sections: [{ name: 'ignored', text: 'x' }] }
  })

  const result = await ctx.waterfall('system-prompt/assemble', assembly, { scope: 'agent-1' }, () => Promise.resolve(assembly))
  assert.equal(result, assembly, 'the observer return value never replaces the chain result')
  assert.equal(seen.length, 1)
})

test('unrelated events keep their freeze policies unchanged', () => {
  const { ctx, events } = createBus()
  const seen = []
  events.observe('goal/changed').subscribe((payload) => seen.push(payload))

  const payload = { agent: 'a', change: 'x' }
  ctx.emit('goal/changed', payload)
  assert.deepEqual(seen, [payload])
  assert.ok(Object.isFrozen(seen[0]))
})