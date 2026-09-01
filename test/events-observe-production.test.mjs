import test from 'node:test'
import assert from 'node:assert/strict'
import { createEventsBus } from '../lib/events-bus.js'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { composeCatalogs } from '../lib/catalog-compose.js'
import { agentEventsCatalog } from '../lib/agent-events-catalog.js'
import { llmEventsCatalog } from '../lib/llm-events-catalog.js'
import { systemPromptEventsCatalog } from '../lib/system-prompt-events-catalog.js'
import { settingsEventsCatalog } from '../lib/settings-events-catalog.js'

const coreCatalog = composeCatalogs(
  baseEventsCatalog,
  agentEventsCatalog,
  llmEventsCatalog,
  systemPromptEventsCatalog,
  settingsEventsCatalog,
)

/**
 * Minimal Cordis-like context: hook registration plus the four dispatch modes
 * the facade mirrors. Same shape as the events-bus unit tests.
 */
function createMockCordisCtx() {
  const hooks = new Map()
  const hooksOf = (name) => {
    let list = hooks.get(name)
    if (!list) {
      list = []
      hooks.set(name, list)
    }
    return list
  }
  const dispatch = (name) => hooksOf(name).map((hook) => hook.callback)
  const context = {
    hooksOf,
    on(name, listener) {
      hooksOf(name).push({ callback: listener })
      let removed = false
      return () => {
        if (removed) return false
        removed = true
        const index = hooksOf(name).findIndex((hook) => hook.callback === listener)
        if (index >= 0) {
          hooksOf(name).splice(index, 1)
          return true
        }
        return false
      }
    },
    once(name, listener) {
      const dispose = context.on(name, function onceWrapper(...args) {
        dispose()
        return listener.apply(this, args)
      })
      return dispose
    },
    emit(name, ...args) {
      for (const callback of dispatch(name)) callback(...args)
    },
    bail(name, ...args) {
      for (const callback of dispatch(name)) {
        const result = callback(...args)
        if (result !== null && result !== false && result !== undefined) return result
      }
      return undefined
    },
    serial(name, ...args) {
      return (async () => {
        for (const callback of dispatch(name)) {
          const result = await callback(...args)
          if (result !== null && result !== false && result !== undefined) return result
        }
        return undefined
      })()
    },
    parallel(name, ...args) {
      return Promise.all(dispatch(name).map((callback) => callback(...args)))
    },
    waterfall(name, ...args) {
      const callbacks = dispatch(name)
      const callArgs = [...args]
      const inner = callArgs.pop()
      const next = () => (callbacks.shift() ?? inner)(...callArgs)
      callArgs.push(next)
      return next()
    },
  }
  return context
}

test('events.catalog() is a frozen pure query that never exposes a fake define entry', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })

  const first = events.catalog()
  const second = events.catalog()
  assert.ok(Object.isFrozen(first), 'the vocabulary snapshot must be frozen')
  assert.deepEqual(first, second, 'repeated reads return the same frozen composition')
  assert.ok(first['goal/changed'], 'the query is name-keyed')
  assert.equal(first['define'], undefined, 'no custom publisher entry may be claimed')

  // the query is a plain member, not a getter
  assert.equal(typeof events.catalog, 'function')
  assert.equal(events.catalog, events.catalog, 'stable member identity')
})

test('fact and observation events never acquire decision semantics through the shared bus', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })
  const catalog = events.catalog()
  for (const name of ['goal/changed', 'settings/updated']) {
    assert.ok(catalog[name], `${name} must stay cataloged`)
    assert.equal(catalog[name].decisionPrecedence, undefined, `${name} carries no decision precedence`)
    assert.equal(catalog[name].conflictConvergence, undefined, `${name} carries no conflict convergence`)
    assert.equal(catalog[name].listenerFailureDefault, undefined, `${name} carries no listener failure default`)
  }
})

test('events.observe returns a projection handle with current/subscribe/dispose/epoch', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })

  const seen = []
  const handle = events.observe('goal/changed')
  assert.equal(typeof handle.current, 'function')
  assert.equal(typeof handle.subscribe, 'function')
  assert.equal(typeof handle.dispose, 'function')
  assert.equal(typeof handle.epoch, 'number')
  assert.equal(handle.epoch, 0)
  assert.equal(handle.current(), null, 'no value observed yet')

  const detach = handle.subscribe((payload) => seen.push(payload))
  assert.equal(typeof detach, 'function')

  ctx.emit('goal/changed', { agent: 'a', change: 'x' })
  assert.equal(seen.length, 1)
  assert.equal(handle.epoch, 1)
  assert.deepEqual(handle.current(), { agent: 'a', change: 'x' })

  ctx.emit('goal/changed', { agent: 'a', change: 'y' })
  assert.equal(seen.length, 2)
  assert.equal(handle.epoch, 2)

  assert.equal(detach(), true, 'detach removes the listener')
  assert.equal(detach(), false, 'detach is idempotent')
  ctx.emit('goal/changed', { agent: 'a', change: 'z' })
  assert.equal(seen.length, 2, 'detached listener receives nothing')
  assert.equal(handle.epoch, 3, 'the feed itself still observes')
})

test('events.observe dispose is idempotent, silences the handle, and leaves peers intact', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })

  const first = []
  const second = []
  const a = events.observe('goal/changed')
  const b = events.observe('goal/changed')
  const offA = a.subscribe((payload) => first.push(payload))
  b.subscribe((payload) => second.push(payload))

  ctx.emit('goal/changed', { change: 1 })
  assert.equal(first.length, 1)
  assert.equal(second.length, 1)

  assert.equal(a.dispose(), true, 'first dispose reports removal')
  assert.equal(a.dispose(), false, 'second dispose is a no-op')
  ctx.emit('goal/changed', { change: 2 })
  assert.equal(first.length, 1, 'disposed handle is silent')
  assert.equal(second.length, 2, 'independent handle still observes')
  assert.equal(typeof offA, 'function')

  assert.equal(b.dispose(), true)
  ctx.emit('goal/changed', { change: 3 })
  assert.equal(second.length, 2)
})

test('a throwing or rejecting observe listener is contained and never starves peers', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })

  const seen = []
  const handle = events.observe('goal/changed')
  handle.subscribe(() => {
    throw new Error('sync boom')
  })
  handle.subscribe(async () => {
    await Promise.resolve()
    throw new Error('async boom')
  })
  handle.subscribe((payload) => seen.push(payload))

  ctx.emit('goal/changed', { change: 1 })
  assert.equal(seen.length, 1, 'peer listeners still receive the payload')
  assert.equal(handle.epoch, 1)
  ctx.emit('goal/changed', { change: 2 })
  assert.equal(seen.length, 2, 'a throwing listener never starves later deliveries')
})

test('an observer registration grants no dispatch rights and define is a separate custom seam', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })

  const handle = events.observe('goal/changed')
  const members = Object.keys(handle).filter((key) => typeof handle[key] === 'function')
  assert.deepEqual(members.sort(), ['current', 'dispose', 'subscribe'], 'the handle has no dispatch member')
  // The custom publisher entry lives in the separate custom-definition
  // registry; the canonical catalog never exposes it.
  assert.equal(events.catalog().define, undefined)
  const publisher = events.define({ name: 'plugin-a.custom' })
  assert.deepEqual(
    Object.keys(publisher).sort(),
    ['dispose', 'emit', 'generation', 'id', 'name', 'ownerId'],
    'define returns the capability-limited publisher handle, not an unrestricted emitter',
  )
  assert.equal(publisher.dispose(), true)
})

test('dispatch returns a frozen discriminated outcome and reports unsupported names', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })

  const result = events.emit('goal/changed', { change: 'x' })
  assert.deepEqual(result, { ok: true, code: 'dispatched', outcome: null })
  assert.ok(Object.isFrozen(result))

  const unsupported = events.emit('not/cataloged', {})
  assert.equal(unsupported.ok, false)
  assert.equal(unsupported.code, 'unsupported')
  assert.ok(Object.isFrozen(unsupported))

  const fault = events.waterfall('goal/changed')
  assert.equal(fault.ok, false)
  assert.equal(fault.code, 'error')
  assert.match(fault.reason, /not a function|is not a function/)

  const asyncResult = events.serial('goal/changed', { change: 'async' })
  assert.equal(typeof asyncResult.then, 'function', 'async modes keep native await semantics')
  return asyncResult.then((outcome) => {
    assert.deepEqual(outcome, { ok: true, code: 'dispatched', outcome: null })
  })
})

test('events.availability reports the active bus and the unavailable stub shape', () => {
  const ctx = createMockCordisCtx()
  const events = createEventsBus({ ctx, catalog: coreCatalog })
  assert.deepEqual(events.availability(), { status: 'active' })
  assert.ok(Object.isFrozen(events.availability()))
})