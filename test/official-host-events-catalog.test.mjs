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
import { createEventsBus } from '../lib/events-bus.js'
import { composeCatalogs } from '../lib/catalog-compose.js'

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

  return {
    hooksOf,
    on(name, listener) {
      const list = hooksOf(name)
      const record = { listener }
      list.push(record)
      let active = true
      return () => {
        if (!active) return false
        active = false
        const index = list.indexOf(record)
        if (index < 0) return false
        list.splice(index, 1)
        return true
      }
    },
    emit(name, ...args) {
      for (const { listener } of [...hooksOf(name)]) listener(...args)
    },
  }
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
        return name === PROVIDER_NAMES[index] ? Object.create({ marker: true }) : undefined
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
        return { marker: true }
      },
    })
  })
  assert.deepEqual(active.map((slice) => slice.name), officialHostEventCatalogSlices.slice(1).map((slice) => slice.name))

  assert.equal(
    officialHostEventCatalogSlices[0].isAvailable({ get() { return 'malformed' } }),
    false,
  )
  assert.equal(
    officialHostEventCatalogSlices[0].isAvailable({ get() { return {} } }),
    false,
  )
  assert.equal(
    officialHostEventCatalogSlices[0].isAvailable({ get() { return Promise.resolve({}) } }),
    false,
  )
  assert.equal(
    officialHostEventCatalogSlices[1].isAvailable({ get() { throw new Error('provider lookup failed') } }),
    false,
  )
  assert.equal(officialHostEventCatalogSlices[2].isAvailable({}), false)
})

test('composing available slices omits only the slice with a missing producer', () => {
  const absentProvider = PROVIDER_NAMES[0]
  const ctx = {
    get(name) {
      if (name === absentProvider) return undefined
      return { marker: true }
    },
  }
  const catalog = composeCatalogs(
    ...officialHostEventCatalogSlices
      .filter((slice) => slice.isAvailable(ctx))
      .map((slice) => slice.catalog),
  )

  assert.equal(catalog['agent-loop/config-start-failed'], undefined)
  assert.ok(catalog['agent-preset/selected'])
  assert.ok(catalog['cordis/dynamic-package'])
  assert.ok(catalog['cordis/inspect-query'])
  assert.ok(catalog['domain/changed'])
})

test('availability probes inspect thenable shape without invoking a getter', () => {
  let reads = 0
  const provider = {}
  Object.defineProperty(provider, 'then', {
    configurable: true,
    get() {
      reads += 1
      throw new Error('getter must not run')
    },
  })

  assert.equal(officialHostEventCatalogSlices[0].isAvailable({ get() { return provider } }), false)
  assert.equal(reads, 0)
})

test('an official emit reaches one facade listener with the original payload identity', () => {
  const ctx = createMockCordisCtx()
  const catalog = Object.assign({}, ...officialHostEventCatalogSlices.map((slice) => slice.catalog))
  const events = createEventsBus({ ctx, catalog })
  const seen = []
  events.on('domain/changed', (payload) => seen.push(payload))

  const change = { domain: 'session', revision: 3 }
  ctx.emit('domain/changed', change)

  assert.deepEqual(seen, [change])
  assert.equal(seen[0], change)
  events.dispose()
})

test('emit listener failures are contained and later listeners still receive the same dispatch', () => {
  const ctx = createMockCordisCtx()
  const catalog = Object.assign({}, ...officialHostEventCatalogSlices.map((slice) => slice.catalog))
  const events = createEventsBus({ ctx, catalog, logger: { warn() {} } })
  const seen = []
  events.on('agent-preset/selected', () => {
    throw new Error('observer failed')
  })
  events.on('agent-preset/selected', (...args) => seen.push(args))

  const sessionId = { id: 'session-1' }
  const preset = { name: 'default' }
  assert.doesNotThrow(() => ctx.emit('agent-preset/selected', sessionId, preset))
  assert.deepEqual(seen, [[sessionId, preset]])
  assert.equal(seen[0][0], sessionId)
  assert.equal(seen[0][1], preset)
  events.dispose()
})

test('disposing an older bus does not remove a newer native hook', () => {
  const ctx = createMockCordisCtx()
  const catalog = Object.assign({}, ...officialHostEventCatalogSlices.map((slice) => slice.catalog))
  const first = createEventsBus({ ctx, catalog })
  const second = createEventsBus({ ctx, catalog })
  const seen = []

  first.on('cordis/request-run', () => seen.push('first'))
  second.on('cordis/request-run', () => seen.push('second'))
  first.dispose()

  const request = { id: 'request-1' }
  ctx.emit('cordis/request-run', request)
  assert.deepEqual(seen, ['second'])
  assert.equal(ctx.hooksOf('cordis/request-run').length, 1)
  second.dispose()
  assert.equal(ctx.hooksOf('cordis/request-run').length, 0)
})

test('the leaf module contains no producer or central composition wiring', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const source = readFileSync(join(here, '..', 'lib', 'official-host-events-catalog.js'), 'utf8')
  assert.doesNotMatch(source, /ctx\.(on|once|emit|serial|parallel|bail|waterfall)\b/)
  assert.doesNotMatch(source, /createEventsBus|composeCatalogs/)
})
