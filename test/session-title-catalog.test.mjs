import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { createEventsBus } from '../lib/events-bus.js'
import { createSessionTitleEventsCatalogSlice, SESSION_TITLE_CONTRACT_SYMBOL } from '../lib/session-title-events-catalog.js'
import { createServicesNamespace } from '../lib/services.js'

const AUX_NAME = '@deepseek-ai/dsh-plugin-api-session-title'
const MATCHING_CONTRACT = { runtime: '0.1.0-rc.6', api: '0.6' }
const MATCHING_MANIFEST = { version: '0.1.0-rc.6-0.6', api: '0.6' }

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
  ctx.get = () => (active ? { [SESSION_TITLE_CONTRACT_SYMBOL]: true, get() {}, rename() {}, refresh() {}, register() {} } : undefined)
  ctx.loader = { entries: () => [{ options: { name: AUX_NAME }, fiber: {}, disabled: !active }] }
  return {
    ctx,
    setActive(value) {
      active = value
    },
  }
}

test('the replacement slice exposes exactly one session-title candidate entry with the required schema', () => {
  const slice = createSessionTitleEventsCatalogSlice()
  assert.equal(slice.name, 'session-title')
  assert.equal(slice.entries.length, 1)
  const entry = slice.entries[0]
  assert.equal(entry.name, 'session-title/candidate')
  assert.equal(entry.mode, 'waterfall')
  assert.equal(entry.scopeFiltered, false)
  assert.equal(entry.scopeKey, null)
  assert.equal(entry.fault, 'contain')
  assert.deepEqual(entry.freeze, { deep: ['message'] })
  assert.equal(entry.feature, 'session-title')
  assert.ok(Object.isFrozen(entry), 'entry must be frozen')
  assert.ok('payload' in entry && 'args' in entry)
  assert.ok(!('source' in entry), 'governance source ids must not leak into the catalog')
  assert.ok(!('type' in entry), 'governance class letters must not leak into the catalog')
  assert.ok(Object.isFrozen(slice))
})

test('the slice guard requires live row, contract marker, and matching auxiliary version', () => {
  const liveRow = () => [{ options: { name: AUX_NAME }, fiber: {}, disabled: false }]
  const marker = (present) => (present ? { [SESSION_TITLE_CONTRACT_SYMBOL]: true } : undefined)
  const makeCtx = (row, service) => ({ loader: { entries: () => row[Symbol.iterator]() }, get: () => service })

  const slice = createSessionTitleEventsCatalogSlice({ expectedContract: MATCHING_CONTRACT, auxiliaryManifest: MATCHING_MANIFEST })
  assert.equal(slice.isActive(makeCtx(liveRow(), marker(true))), true)
  assert.equal(slice.isActive(makeCtx(liveRow(), marker(false))), false)
  assert.equal(slice.isActive(makeCtx([], marker(true))), false)
  assert.equal(slice.isActive(makeCtx([{ options: { name: AUX_NAME }, fiber: undefined, disabled: false }], marker(true))), false)
  assert.equal(slice.isActive(makeCtx([{ options: { name: AUX_NAME }, fiber: {}, disabled: true }], marker(true))), false)

  const mismatched = createSessionTitleEventsCatalogSlice({
    expectedContract: MATCHING_CONTRACT,
    auxiliaryManifest: { version: '0.1.0-rc.6-0.4', api: '0.4' },
  })
  assert.equal(mismatched.isActive(makeCtx(liveRow(), marker(true))), false, 'aux version mismatch disables only this replacement slice')

  assert.equal(slice.isActive({
    loader: { entries() { throw new Error('boom') } },
    get: () => marker(true),
  }), false)
})

test('the public catalog accessor filters the replacement slice by guard while subscriptions use static metadata', () => {
  const { ctx, setActive } = makeBusCtx()
  const slice = createSessionTitleEventsCatalogSlice({ expectedContract: MATCHING_CONTRACT, auxiliaryManifest: MATCHING_MANIFEST })
  const bus = createEventsBus({ ctx, catalog: baseEventsCatalog, rSlices: [slice] })

  assert.ok(!('session-title/candidate' in bus.catalog), 'inactive: hidden from the public snapshot')
  const listener = () => {}
  bus.on('session-title/candidate', listener, { priority: 'high' })
  assert.equal(ctx.hooksOf('session-title/candidate').length, 1)
  const wrapped = ctx.hooksOf('session-title/candidate')[0]
  assert.notEqual(wrapped, listener, 'facade subscription must be wrapped, not passed through')

  setActive(true)
  const catalog = bus.catalog
  assert.equal(Object.keys(catalog).length, Object.keys(baseEventsCatalog).length + 1)
  assert.equal(catalog['session-title/candidate'].feature, 'session-title')
  assert.ok(Object.isFrozen(catalog['session-title/candidate']))
  assert.ok(Object.isFrozen(catalog), 'catalog snapshot must be deeply frozen')
})

test('replacement-slice composition keeps duplicate detection fail-loud and composes with compaction', async () => {
  const { ctx } = makeBusCtx()
  const { createCompactionEventsCatalogSlice } = await import('../lib/compaction-events-catalog.js')
  const compaction = createCompactionEventsCatalogSlice({ expectedContract: MATCHING_CONTRACT, auxiliaryManifest: MATCHING_MANIFEST })
  const title = createSessionTitleEventsCatalogSlice({ expectedContract: MATCHING_CONTRACT, auxiliaryManifest: MATCHING_MANIFEST })
  const bus = createEventsBus({ ctx, catalog: baseEventsCatalog, rSlices: [compaction, title] })
  assert.ok(bus, 'both replacement slices compose without weakening the catalog')

  const dupA = { name: 'a', entries: [{ name: 'session-title/candidate' }], isActive: () => true }
  const dupB = { name: 'b', entries: [{ name: 'session-title/candidate' }], isActive: () => true }
  assert.throws(() => createEventsBus({ ctx, catalog: baseEventsCatalog, rSlices: [dupA, dupB] }), /duplicate catalog entry/)
})

test('facade waterfall decision and next() are passed through', () => {
  const { ctx, setActive } = makeBusCtx()
  setActive(true)
  const slice = createSessionTitleEventsCatalogSlice({ expectedContract: MATCHING_CONTRACT, auxiliaryManifest: MATCHING_MANIFEST })
  const bus = createEventsBus({ ctx, catalog: baseEventsCatalog, rSlices: [slice] })

  bus.on('session-title/candidate', (payload, next) => {
    if (payload?.message?.seq === 1) return { kind: 'exclude', reason: 'synthetic' }
    return next()
  }, { priority: 'high' })

  const decision = ctx.waterfall('session-title/candidate', { agent: undefined, session: 's', message: { seq: 1 } }, () => undefined)
  assert.deepEqual(decision, { kind: 'exclude', reason: 'synthetic' })

  const passthrough = ctx.waterfall('session-title/candidate', { agent: undefined, session: 's', message: { seq: 9 } }, () => undefined)
  assert.equal(passthrough, undefined)
})

test('raw ctx.on observation works without the facade', () => {
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
    'main facade must not import the auxiliary package')
  assert.ok(indexSource.includes('createSessionTitleEventsCatalogSlice'),
    'mountEventsFeature must build the replacement slice with the facade contract')
  assert.ok(indexSource.includes("readPackageManifest('@deepseek-ai/dsh-plugin-api-session-title')"),
    'main facade must verify the installed auxiliary package version')
})

function makeReplacementProvider() {
  const calls = []
  const provider = {
    [SESSION_TITLE_CONTRACT_SYMBOL]: true,
    get() { calls.push('get'); return { title: 'T' } },
    rename() { calls.push('rename'); return 'renamed' },
    refresh() { calls.push('refresh'); return Promise.resolve('refreshed') },
    register() { calls.push('register'); return () => {} },
  }
  return { provider, calls }
}

test('pluginApi.services.sessionTitle passthrough resolves to the replacement service', () => {
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
