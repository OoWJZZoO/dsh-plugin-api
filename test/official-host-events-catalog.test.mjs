import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  CATALOG_ENTRY_FIELDS,
  HOST_EVENT_CONTRACTS,
  HOST_EVENT_SLICES,
} from './official-passthrough-contracts.mjs'
import { officialHostEventCatalogSlices } from '../lib/official-host-events-catalog.js'

const PROVIDER_NAMES = [
  'agentLoop',
  'agentPresets',
  'dynamicCordisRunner',
  'cordisInspect',
  'storageDomain',
]

function assertFrozenRecursively(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  assert.ok(Object.isFrozen(value))
  for (const child of Object.values(value)) assertFrozenRecursively(child, seen)
}

test('the host event leaves contain exactly five groups and nine names', () => {
  assert.deepEqual(
    officialHostEventCatalogSlices.map((slice) => Object.keys(slice.catalog)),
    HOST_EVENT_SLICES.map((slice) => slice.events),
  )
  assert.equal(
    officialHostEventCatalogSlices.reduce((count, slice) => count + Object.keys(slice.catalog).length, 0),
    9,
  )
  assert.deepEqual(officialHostEventCatalogSlices.map((slice) => slice.name), [
    'agentLoopConfigStartFailed',
    'agentPresetSelected',
    'cordisDynamicLifecycle',
    'cordisInspectLifecycle',
    'storageDomainChanged',
  ])
})

test('every row uses the exact approved metadata schema and policy', () => {
  const entries = officialHostEventCatalogSlices.flatMap((slice) => Object.values(slice.catalog))
  assert.deepEqual(entries.map((entry) => entry.name), HOST_EVENT_CONTRACTS.map((entry) => entry.name))

  for (const entry of entries) {
    const expected = HOST_EVENT_CONTRACTS.find((contract) => contract.name === entry.name)
    assert.deepEqual(entry, expected)
    assert.deepEqual(Object.keys(entry), CATALOG_ENTRY_FIELDS)
    assert.equal(entry.mode, 'emit')
    assert.equal(entry.scopeFiltered, false)
    assert.equal(entry.scopeKey, undefined)
    assert.equal(entry.fault, 'contain')
    assert.equal(entry.freeze, 'all')
    assert.ok(!('source' in entry))
    assert.ok(!('type' in entry))
  }
})

test('the slices and catalog rows are deeply immutable', () => {
  assertFrozenRecursively(officialHostEventCatalogSlices)
  for (const slice of officialHostEventCatalogSlices) {
    assertFrozenRecursively(slice.catalog)
    assert.throws(() => {
      slice.catalog[slice.name] = undefined
    }, TypeError)
  }

  const entry = officialHostEventCatalogSlices[0].catalog['agent-loop/config-start-failed']
  assert.throws(() => {
    entry.args = '()'
  }, TypeError)
})

test('availability probes isolate missing, malformed, and throwing providers', () => {
  for (const [index, slice] of officialHostEventCatalogSlices.entries()) {
    const calls = []
    const ctx = {
      get(name) {
        calls.push(name)
        return name === PROVIDER_NAMES[index] ? Object.create(null) : undefined
      },
    }
    assert.equal(slice.isAvailable(ctx), true)
    assert.deepEqual(calls, [PROVIDER_NAMES[index]])
  }

  const absentProvider = PROVIDER_NAMES[0]
  const active = officialHostEventCatalogSlices.filter((slice, index) => {
    return slice.isAvailable({
      get(name) {
        if (name === absentProvider) return undefined
        return index === 0 ? undefined : {}
      },
    })
  })
  assert.deepEqual(active.map((slice) => slice.name), officialHostEventCatalogSlices.slice(1).map((slice) => slice.name))

  assert.equal(
    officialHostEventCatalogSlices[0].isAvailable({ get() { return 'malformed' } }),
    false,
  )
  assert.equal(
    officialHostEventCatalogSlices[1].isAvailable({ get() { throw new Error('provider lookup failed') } }),
    false,
  )
  assert.equal(officialHostEventCatalogSlices[2].isAvailable({}), false)
})

test('the leaf module contains no producer or central composition wiring', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const source = readFileSync(join(here, '..', 'lib', 'official-host-events-catalog.js'), 'utf8')
  assert.doesNotMatch(source, /ctx\.(on|once|emit|serial|parallel|bail|waterfall)\b/)
  assert.doesNotMatch(source, /createEventsBus|composeCatalogs/)
})
