import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { createEventsBus } from '../lib/events-bus.js'
import { createCompactionEventsCatalogSlice, COMPACTION_EVENTS_CONTRACT_SYMBOL } from '../lib/compaction-events-catalog.js'

const COMPACTION_EVENT_NAMES = [
  'compaction/request',
  'compaction/started',
  'compaction/completed',
  'compaction/failed',
  'compaction/skipped',
]

const AUX_NAME = '@deepseek-ai/dsh-plugin-api-compaction-events'
const MATCHING_CONTRACT = { runtime: '0.1.0-rc.6', api: '0.6' }
const MATCHING_MANIFEST = { version: '0.1.0-rc.6-0.6', api: '0.6' }

test('the replacement slice exposes exactly the five compaction entries with the required schema', () => {
  const slice = createCompactionEventsCatalogSlice()
  assert.equal(slice.name, 'compaction-events')
  assert.deepEqual(slice.entries.map((entry) => entry.name), COMPACTION_EVENT_NAMES)
  for (const entry of slice.entries) {
    assert.equal(entry.scopeFiltered, false)
    assert.equal(entry.scopeKey, null)
    assert.equal(entry.fault, 'contain')
    assert.equal(entry.feature, 'compaction-events')
    assert.ok(Object.isFrozen(entry), `${entry.name} entry must be frozen`)
    assert.ok('mode' in entry && 'payload' in entry && 'args' in entry && 'freeze' in entry)
    assert.ok(!('source' in entry), 'governance source ids must not leak into the catalog')
    assert.ok(!('type' in entry), 'governance class letters must not leak into the catalog')
  }
  assert.equal(slice.entries[0].mode, 'waterfall')
  assert.deepEqual(slice.entries[2].freeze, { deep: ['range', 'result'] })
  assert.ok(Object.isFrozen(slice))
})

test('the slice guard requires live row, contract marker, and matching auxiliary version', () => {
  const liveRow = () => [{ options: { name: AUX_NAME }, fiber: {}, disabled: false }]
  const marker = (present) => (present ? { [COMPACTION_EVENTS_CONTRACT_SYMBOL]: true } : undefined)
  const makeCtx = (row, service) => ({
    loader: { entries: () => row[Symbol.iterator]() },
    get: () => service,
  })

  const slice = createCompactionEventsCatalogSlice({ expectedContract: MATCHING_CONTRACT, auxiliaryManifest: MATCHING_MANIFEST })
  assert.equal(slice.isActive(makeCtx(liveRow(), marker(true))), true)
  assert.equal(slice.isActive(makeCtx(liveRow(), marker(false))), false)
  assert.equal(slice.isActive(makeCtx([], marker(true))), false)
  assert.equal(slice.isActive(makeCtx([{ options: { name: AUX_NAME }, fiber: undefined, disabled: false }], marker(true))), false)
  assert.equal(slice.isActive(makeCtx([{ options: { name: AUX_NAME }, fiber: {}, disabled: true }], marker(true))), false)

  const mismatched = createCompactionEventsCatalogSlice({
    expectedContract: MATCHING_CONTRACT,
    auxiliaryManifest: { version: '0.1.0-rc.6-0.4', api: '0.4' },
    logger: { warn() {} },
  })
  assert.equal(mismatched.isActive(makeCtx(liveRow(), marker(true))), false, 'aux version mismatch disables only this replacement slice')

  assert.equal(slice.isActive({
    loader: { entries() { throw new Error('boom') } },
    get: () => marker(true),
  }), false)
})

test('aux version mismatch is reported once and leaves the rest of the facade untouched', () => {
  const warns = []
  const slice = createCompactionEventsCatalogSlice({
    expectedContract: MATCHING_CONTRACT,
    auxiliaryManifest: { version: '0.1.0-rc.6-0.4', api: '0.4' },
    logger: { warn(message) { warns.push(message) } },
  })
  const ctx = {
    loader: { entries: () => [{ options: { name: AUX_NAME }, fiber: {}, disabled: false }] },
    get: () => ({ [COMPACTION_EVENTS_CONTRACT_SYMBOL]: true }),
  }
  assert.equal(slice.isActive(ctx), false)
  assert.equal(slice.isActive(ctx), false)
  assert.equal(warns.length, 1)
  assert.match(warns[0], /does not match the main facade contract/)
})

function makeBusCtx() {
  let active = false
  const hooks = []
  const ctx = {
    logger: { warn() {}, error() {} },
    on(name, listener) {
      hooks.push({ name, listener })
      return () => {}
    },
    once(name, listener) {
      hooks.push({ name, listener, once: true })
      return () => {}
    },
    emit() {},
    serial() {},
    parallel() {},
    bail() {},
    waterfall() {},
    get() {
      return active
        ? { [COMPACTION_EVENTS_CONTRACT_SYMBOL]: true, compactIfNeeded() {}, compactNow() {}, compactRegion() {}, summarize() {} }
        : undefined
    },
    loader: {
      entries() {
        return [{ options: { name: AUX_NAME }, fiber: {}, disabled: !active }]
      },
    },
  }
  return {
    ctx,
    hooks,
    setActive(value) {
      active = value
    },
  }
}

test('the public catalog accessor filters replacement slices by guard while subscriptions use static metadata', () => {
  const { ctx, hooks, setActive } = makeBusCtx()
  const slice = createCompactionEventsCatalogSlice({ expectedContract: MATCHING_CONTRACT, auxiliaryManifest: MATCHING_MANIFEST })
  const bus = createEventsBus({ ctx, catalog: baseEventsCatalog, rSlices: [slice] })

  // inactive: entries hidden from the public snapshot...
  assert.ok(!('compaction/request' in bus.catalog))
  // ...but a facade subscription is still wrapped (static full catalog).
  const listener = () => {}
  bus.on('compaction/request', listener, { priority: 'high' })
  assert.equal(hooks.length, 1)
  assert.equal(hooks[0].name, 'compaction/request')
  assert.notEqual(hooks[0].listener, listener, 'facade subscription must be wrapped, not passed through')

  // active: the same bus instance now exposes all five replacement entries.
  setActive(true)
  const catalog = bus.catalog
  assert.equal(Object.keys(catalog).length, Object.keys(baseEventsCatalog).length + COMPACTION_EVENT_NAMES.length)
  for (const name of COMPACTION_EVENT_NAMES) {
    assert.equal(catalog[name].feature, 'compaction-events')
    assert.ok(Object.isFrozen(catalog[name]))
  }
  assert.ok(Object.isFrozen(catalog), 'catalog snapshot must be deeply frozen')
})

test('a duplicate replacement event name fails loud at bus construction', () => {
  const sliceA = { name: 'a', entries: [{ name: 'compaction/request' }], isActive: () => true }
  const sliceB = { name: 'b', entries: [{ name: 'compaction/request' }], isActive: () => true }
  const { ctx } = makeBusCtx()
  assert.throws(
    () => createEventsBus({ ctx, catalog: baseEventsCatalog, rSlices: [sliceA, sliceB] }),
    /duplicate catalog entry "compaction\/request"/,
  )
})

test('the main facade does not import the auxiliary replacement package', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const indexSource = readFileSync(join(here, '..', 'lib', 'index.js'), 'utf8')
  const sliceSource = readFileSync(join(here, '..', 'lib', 'compaction-events-catalog.js'), 'utf8')
  const combined = `${indexSource}\n${sliceSource}`
  assert.ok(!combined.includes("from '@deepseek-ai/dsh-plugin-api-compaction-events'"),
    'main facade must not import the auxiliary package')
  assert.ok(indexSource.includes('createCompactionEventsCatalogSlice'),
    'mountEventsFeature must build the replacement slice with the facade contract')
  assert.ok(indexSource.includes("readPackageManifest('@deepseek-ai/dsh-plugin-api-compaction-events')"),
    'main facade must verify the installed auxiliary package version')
})
