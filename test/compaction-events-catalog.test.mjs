import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { composeCatalogs } from '../lib/catalog-compose.js'
import { createEventsBus } from '../lib/events-bus.js'
import { compactionEventsCatalogSlice, isCompactionEventsReplacementActive } from '../lib/compaction-events-catalog.js'

const COMPACTION_EVENT_NAMES = [
  'compaction/request',
  'compaction/started',
  'compaction/completed',
  'compaction/failed',
  'compaction/skipped',
]

const CONTRACT_SYMBOL = Symbol.for('dsh-plugin-api.compaction-events-r1.active')
const AUX_NAME = '@deepseek-ai/dsh-plugin-api-compaction-events'

test('the R slice exposes exactly the five compaction/* entries with the required schema', () => {
  assert.equal(compactionEventsCatalogSlice.name, 'compaction-events-r1')
  assert.deepEqual(compactionEventsCatalogSlice.entries.map((entry) => entry.name), COMPACTION_EVENT_NAMES)
  for (const entry of compactionEventsCatalogSlice.entries) {
    assert.equal(entry.type, 'R')
    assert.equal(entry.scopeFiltered, false)
    assert.equal(entry.scopeKey, null)
    assert.equal(entry.fault, 'contain')
    assert.equal(entry.feature, 'compaction-events-r1')
    assert.ok(Object.isFrozen(entry), `${entry.name} entry must be frozen`)
    assert.ok('mode' in entry && 'payload' in entry && 'args' in entry && 'freeze' in entry)
  }
  assert.equal(compactionEventsCatalogSlice.entries[0].mode, 'waterfall')
  assert.deepEqual(compactionEventsCatalogSlice.entries[2].freeze, { deep: ['range', 'result'] })
  assert.ok(Object.isFrozen(compactionEventsCatalogSlice))
})

test('isCompactionEventsReplacementActive is true only when the aux row is live and the marker is present', () => {
  const liveRow = () => [{ options: { name: AUX_NAME }, fiber: {}, disabled: false }]
  const marker = (present) => (present ? { [CONTRACT_SYMBOL]: true } : undefined)
  const ctx = (row, service) => ({
    loader: { entries: () => row[Symbol.iterator]() },
    get: () => service,
  })

  assert.equal(isCompactionEventsReplacementActive(ctx(liveRow(), marker(true))), true)
  assert.equal(isCompactionEventsReplacementActive(ctx(liveRow(), marker(false))), false)
  assert.equal(isCompactionEventsReplacementActive(ctx([], marker(true))), false)
  assert.equal(
    isCompactionEventsReplacementActive(
      ctx([{ options: { name: AUX_NAME }, fiber: undefined, disabled: false }], marker(true)),
    ),
    false,
  )
  assert.equal(
    isCompactionEventsReplacementActive(
      ctx([{ options: { name: AUX_NAME }, fiber: {}, disabled: true }], marker(true)),
    ),
    false,
  )
  assert.equal(
    isCompactionEventsReplacementActive({
      loader: { entries() { throw new Error('boom') } },
      get: () => marker(true),
    }),
    false,
  )
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
        ? { [CONTRACT_SYMBOL]: true, compactIfNeeded() {}, compactNow() {}, compactRegion() {}, summarize() {} }
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

test('the public catalog accessor filters R slices by guard while subscriptions use static metadata', () => {
  const { ctx, hooks, setActive } = makeBusCtx()
  const bus = createEventsBus({ ctx, catalog: baseEventsCatalog, rSlices: [compactionEventsCatalogSlice] })

  // inactive: entries hidden from the public snapshot...
  assert.ok(!('compaction/request' in bus.catalog))
  // ...but a facade subscription is still wrapped (static full catalog).
  const listener = () => {}
  bus.on('compaction/request', listener, { priority: 'high' })
  assert.equal(hooks.length, 1)
  assert.equal(hooks[0].name, 'compaction/request')
  assert.notEqual(hooks[0].listener, listener, 'facade subscription must be wrapped, not passed through')

  // active: the same bus instance now exposes all five R entries in a frozen snapshot.
  setActive(true)
  const catalog = bus.catalog
  assert.equal(Object.keys(catalog).length, Object.keys(baseEventsCatalog).length + COMPACTION_EVENT_NAMES.length)
  for (const name of COMPACTION_EVENT_NAMES) {
    assert.equal(catalog[name].type, 'R')
    assert.ok(Object.isFrozen(catalog[name]))
  }
  assert.ok(Object.isFrozen(catalog), 'catalog snapshot must be deeply frozen')
})

test('a duplicate R event name fails loud at bus construction', () => {
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
    'main facade must not import the auxiliary package (requirements 1.5)')
  assert.ok(indexSource.includes('rSlices: [compactionEventsCatalogSlice, sessionTitleEventsCatalogSlice]'),
    'mountEventsFeature must wire the R slices into createEventsBus')
})
