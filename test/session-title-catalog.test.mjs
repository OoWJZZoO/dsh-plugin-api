import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { createEventsBus } from '../lib/events-bus.js'
import { sessionTitleEventsCatalogSlice, isSessionTitleReplacementActive } from '../lib/session-title-events-catalog.js'
import { createServicesNamespace } from '../lib/services.js'

const CONTRACT_SYMBOL = Symbol.for('dsh-plugin-api.session-title-r1.active')
const AUX_NAME = '@deepseek-ai/dsh-plugin-api-session-title'

// ---------------------------------------------------------------------------
// Fake Cordis dispatch context mirroring Cordis dispatch mechanics (mirrors
// test/events-bus.test.mjs createMockCordisCtx): the leading optional thisArg
// and the event name are shifted before listeners run, and waterfall runs
// outermost-first with a short-circuit when a listener returns without next().
// ---------------------------------------------------------------------------
function makeDispatchCtx() {
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

  const ctx = {
    hooksOf,
    logger: { warn() {}, error() {} },
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
      for (const callback of dispatch('emit', callArgs)) callback(...callArgs)
    },
    serial: async (name, ...args) => {
      const callArgs = [name, ...args]
      for (const callback of dispatch('serial', callArgs)) {
        const result = await callback(...callArgs)
        if (result !== undefined && result !== null && result !== false) return result
      }
      return undefined
    },
    parallel: async (name, ...args) => {
      const callArgs = [name, ...args]
      await Promise.allSettled(dispatch('parallel', callArgs).map((callback) => callback(...callArgs)))
    },
    bail(name, ...args) {
      const callArgs = [name, ...args]
      for (const callback of dispatch('bail', callArgs)) {
        const result = callback(...callArgs)
        if (result !== undefined && result !== null && result !== false) return result
      }
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
  return ctx
}

function makeBusCtx() {
  const ctx = makeDispatchCtx()
  let active = false
  ctx.get = () => (active ? { [CONTRACT_SYMBOL]: true, get() {}, rename() {}, refresh() {}, register() {} } : undefined)
  ctx.loader = { entries: () => [{ options: { name: AUX_NAME }, fiber: {}, disabled: !active }] }
  return {
    ctx,
    setActive(value) {
      active = value
    },
  }
}

test('the R slice exposes exactly one session-title/candidate entry with the required schema', () => {
  assert.equal(sessionTitleEventsCatalogSlice.name, 'session-title-r1')
  assert.equal(sessionTitleEventsCatalogSlice.entries.length, 1)
  const entry = sessionTitleEventsCatalogSlice.entries[0]
  assert.equal(entry.name, 'session-title/candidate')
  assert.equal(entry.type, 'R')
  assert.equal(entry.mode, 'waterfall')
  assert.equal(entry.scopeFiltered, false)
  assert.equal(entry.scopeKey, null)
  assert.equal(entry.fault, 'contain')
  assert.deepEqual(entry.freeze, { deep: ['message'] })
  assert.equal(entry.feature, 'plugin-api-session-title-r1')
  assert.ok(Object.isFrozen(entry), 'entry must be frozen')
  assert.ok('payload' in entry && 'args' in entry && 'source' in entry)
  assert.ok(Object.isFrozen(sessionTitleEventsCatalogSlice))
})

test('isSessionTitleReplacementActive is true only when the aux row is live and the marker is present', () => {
  const liveRow = () => [{ options: { name: AUX_NAME }, fiber: {}, disabled: false }]
  const marker = (present) => (present ? { [CONTRACT_SYMBOL]: true } : undefined)
  const ctx = (row, service) => ({ loader: { entries: () => row[Symbol.iterator]() }, get: () => service })

  assert.equal(isSessionTitleReplacementActive(ctx(liveRow(), marker(true))), true)
  assert.equal(isSessionTitleReplacementActive(ctx(liveRow(), marker(false))), false)
  assert.equal(isSessionTitleReplacementActive(ctx([], marker(true))), false)
  assert.equal(
    isSessionTitleReplacementActive(ctx([{ options: { name: AUX_NAME }, fiber: undefined, disabled: false }], marker(true))),
    false,
  )
  assert.equal(
    isSessionTitleReplacementActive(ctx([{ options: { name: AUX_NAME }, fiber: {}, disabled: true }], marker(true))),
    false,
  )
  assert.equal(
    isSessionTitleReplacementActive({
      loader: { entries() { throw new Error('boom') } },
      get: () => marker(true),
    }),
    false,
  )
})

test('the public catalog accessor filters the R slice by guard while subscriptions use static metadata', () => {
  const { ctx, setActive } = makeBusCtx()
  const bus = createEventsBus({ ctx, catalog: baseEventsCatalog, rSlices: [sessionTitleEventsCatalogSlice] })

  assert.ok(!('session-title/candidate' in bus.catalog), 'inactive: hidden from the public snapshot')
  const listener = () => {}
  bus.on('session-title/candidate', listener, { priority: 'high' })
  assert.equal(ctx.hooksOf('session-title/candidate').length, 1)
  const wrapped = ctx.hooksOf('session-title/candidate')[0]
  assert.notEqual(wrapped, listener, 'facade subscription must be wrapped, not passed through')

  setActive(true)
  const catalog = bus.catalog
  assert.equal(Object.keys(catalog).length, Object.keys(baseEventsCatalog).length + 1)
  assert.equal(catalog['session-title/candidate'].type, 'R')
  assert.ok(Object.isFrozen(catalog['session-title/candidate']))
  assert.ok(Object.isFrozen(catalog), 'catalog snapshot must be deeply frozen')
})

test('R-slice composition keeps duplicate detection fail-loud and composes with compaction', async () => {
  const { ctx } = makeBusCtx()
  const { compactionEventsCatalogSlice } = await import('../lib/compaction-events-catalog.js')
  const bus = createEventsBus({ ctx, catalog: baseEventsCatalog, rSlices: [compactionEventsCatalogSlice, sessionTitleEventsCatalogSlice] })
  assert.ok(bus, 'both R slices compose without weakening the catalog')

  const dupA = { name: 'a', entries: [{ name: 'session-title/candidate' }], isActive: () => true }
  const dupB = { name: 'b', entries: [{ name: 'session-title/candidate' }], isActive: () => true }
  assert.throws(() => createEventsBus({ ctx, catalog: baseEventsCatalog, rSlices: [dupA, dupB] }), /duplicate catalog entry/)
})

test('facade waterfall decision and next() are passed through (req 5.1/6.2)', () => {
  const { ctx, setActive } = makeBusCtx()
  setActive(true)
  const bus = createEventsBus({ ctx, catalog: baseEventsCatalog, rSlices: [sessionTitleEventsCatalogSlice] })

  bus.on('session-title/candidate', (payload, next) => {
    if (payload?.message?.seq === 1) return { kind: 'exclude', reason: 'synthetic' }
    return next()
  }, { priority: 'high' })

  // a settled decision short-circuits the waterfall
  const decision = ctx.waterfall('session-title/candidate', { agent: undefined, session: 's', message: { seq: 1 } }, () => undefined)
  assert.deepEqual(decision, { kind: 'exclude', reason: 'synthetic' })

  // a no-decision listener calls next() to continue to the built-in behavior
  const passthrough = ctx.waterfall('session-title/candidate', { agent: undefined, session: 's', message: { seq: 9 } }, () => undefined)
  assert.equal(passthrough, undefined)
})

test('raw ctx.on observation works without the facade (req 6.3)', () => {
  const ctx = makeDispatchCtx()
  const seen = []
  ctx.on('session-title/candidate', (payload) => {
    seen.push(payload)
  })
  const payload = { agent: undefined, session: 's', message: { seq: 3 } }
  const decision = ctx.waterfall('session-title/candidate', payload, () => undefined)
  assert.equal(seen.length, 1)
  assert.equal(seen[0], payload)
  assert.equal(decision, undefined, 'the raw listener made no decision')
})

test('the main facade does not import the auxiliary replacement package', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const indexSource = readFileSync(join(here, '..', 'lib', 'index.js'), 'utf8')
  const sliceSource = readFileSync(join(here, '..', 'lib', 'session-title-events-catalog.js'), 'utf8')
  const combined = `${indexSource}\n${sliceSource}`
  assert.ok(!combined.includes("from '@deepseek-ai/dsh-plugin-api-session-title'"),
    'main facade must not import the auxiliary package (requirements 1.5)')
  assert.ok(indexSource.includes('rSlices: [compactionEventsCatalogSlice, sessionTitleEventsCatalogSlice]'),
    'mountEventsFeature must wire the session-title R slice into createEventsBus')
})

// ---------------------------------------------------------------------------
// SV13 passthrough regression (req 3.7 / task 5.3): the delivered
// pluginApi.services.sessionTitle seam operates against the replacement service.
// ---------------------------------------------------------------------------
function makeReplacementProvider() {
  const calls = []
  const provider = {
    [CONTRACT_SYMBOL]: true,
    get() { calls.push('get'); return { title: 'T' } },
    rename() { calls.push('rename'); return 'renamed' },
    refresh() { calls.push('refresh'); return Promise.resolve('refreshed') },
    register() { calls.push('register'); return () => {} },
  }
  return { provider, calls }
}

test('pluginApi.services.sessionTitle passthrough resolves to the replacement service (req 3.7/5.3)', () => {
  const { provider, calls } = makeReplacementProvider()
  const serviceCtx = { get(name) { return name === 'sessionTitle' ? provider : undefined } }
  const namespace = createServicesNamespace({ ctx: serviceCtx, active: true })

  assert.equal(namespace.sessionTitle.isActive, true)
  assert.ok('get' in namespace.sessionTitle && 'rename' in namespace.sessionTitle && 'refresh' in namespace.sessionTitle && 'register' in namespace.sessionTitle)

  assert.deepEqual(namespace.sessionTitle.get('session-1'), { title: 'T' })
  assert.equal(namespace.sessionTitle.rename('session-1', 'Explicit'), 'renamed')
  const refreshResult = namespace.sessionTitle.refresh('session-1')
  assert.ok(refreshResult && typeof refreshResult.then === 'function', 'refresh is delegated as-is (provider promise)')
  const disposer = namespace.sessionTitle.register({ id: 'p', automatic: 'first-prompt', generate() {} })
  assert.equal(typeof disposer, 'function')

  assert.deepEqual(calls, ['get', 'rename', 'refresh', 'register'], 'each seam delegates to the replacement service object')
})
