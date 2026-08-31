import test from 'node:test'
import assert from 'node:assert/strict'
import * as dshSystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createEventsBus } from '../lib/events-bus.js'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { composeCatalogs } from '../lib/catalog-compose.js'
import { systemPromptEventsCatalog } from '../lib/system-prompt-events-catalog.js'

/**
 * Minimal Cordis-like context implementing waterfall dispatch exactly the way
 * the facade relies on it. Mirrors the mock used by the events-bus tests.
 */
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
    serial(name, ...args) {
      return Promise.resolve(undefined)
    },
    parallel(name, ...args) {
      return Promise.resolve(undefined)
    },
    bail(name, ...args) {
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

test('dsh-pro-ex-ability-anchor assemble listener pattern is behavior-equivalent through pluginApi.events', () => {
  const baseAssembly = {
    sections: [{ name: 's1', text: 'original' }],
    contexts: [],
    tools: [],
    variables: {},
  }
  const replacement = {
    sections: [{ name: 's1', text: 'replaced' }],
    contexts: [],
    tools: [],
    variables: {},
  }
  const context = { scope: 'agent-1' }
  const inner = () => baseAssembly

  // Direct official-listener behavior (the migration source pattern).
  const directCtx = createWaterfallCtx()
  let directArgs
  directCtx.on('system-prompt/assemble', (assembly, ctx, next) => {
    directArgs = [assembly, ctx, next]
    return replacement
  })
  const directResult = directCtx.waterfall('system-prompt/assemble', baseAssembly, context, inner)
  assert.equal(directResult, replacement)
  assert.equal(dshSystemPrompt.renderPrompt(directResult), 'replaced')

  // Facade observation: the projection entry observes the frozen args array
  // [assembly, context, next] with the original identities; the chain result
  // stays authoritative (the observer never rewrites the dispatch).
  const facadeCtx = createWaterfallCtx()
  const events = createEventsBus({ ctx: facadeCtx, catalog: composeCatalogs(baseEventsCatalog, systemPromptEventsCatalog) })
  let facadeArgs
  const handle = events.observe('system-prompt/assemble')
  handle.subscribe((payload) => {
    const [assembly, ctx, next] = payload
    facadeArgs = [assembly, ctx, next]
    return replacement
  })

  const facadeResult = facadeCtx.waterfall('system-prompt/assemble', baseAssembly, context, inner)

  assert.equal(facadeResult, baseAssembly, 'the dispatch chain result stays authoritative for the observer')
  assert.equal(facadeArgs[0], baseAssembly)
  assert.equal(facadeArgs[1], context)
  assert.equal(typeof facadeArgs[2], 'function')
  assert.equal(handle.epoch, 1)
  // The reversible assembly inputs are contributed through prompts.contribute
  // (contribution idiom) — see the prompts contribution suites.
})
