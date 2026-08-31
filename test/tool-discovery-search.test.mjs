import test from 'node:test'
import assert from 'node:assert/strict'
import { createToolDiscoveryEngine } from '../lib/tool-discovery.js'

let sequence = 0
function engine(options = {}) {
  sequence += 1
  return createToolDiscoveryEngine({
    idFactory: () => `gen-${sequence}-${(sequence += 1)}`,
    now: () => new Date('2026-08-25T00:00:00.000Z'),
    reportDiagnostics: () => {},
    ...options,
  })
}

const DEFS = [{ name: 'alpha_run', description: 'Runs alpha', parameters: { type: 'object', properties: {} } }]

function register(engineApi, overrides = {}) {
  return engineApi.catalog.register({
    id: 'alpha',
    owner: 'owner-a',
    summary: 'Alpha tool',
    capabilities: ['vision'],
    activate: () => DEFS,
    ...overrides,
  })
}

function toolsetNames(engineApi, scopeKey) {
  return engineApi.provider({ scope: { session: { id: scopeKey } } }).schemas.map((tool) => tool.name)
}

test('descriptor projections are frozen read-only and pin the model-visible field set', () => {
  const api = engine()
  register(api, { toolNames: ['already_registered_tool'] })
  const result = api.list('', { scope: 's1' })
  assert.ok(Object.isFrozen(result))
  assert.ok(Object.isFrozen(result.descriptors[0]))
  assert.deepEqual(Object.keys(result.descriptors[0]).sort(), ['capabilities', 'id', 'sourceKind', 'summary'])
  assert.equal(result.descriptors[0].owner, undefined, 'owner never model-visible')
  assert.equal(result.descriptors[0].toolNames, undefined, 'toolNames never model-visible')
  assert.throws(() => { result.descriptors[0].summary = 'mutated' }, TypeError)
})

test('search excludes entries forbidden by the scope constraint and records the reason', () => {
  const api = engine({
    scopeConstraint: (scopeKey) => scopeKey === 's1'
      ? { status: 'applied', reason: 'route-denied', forbidden: [{ entryId: 'alpha', reason: 'forbidden-by-route' }] }
      : { status: 'applied', reason: 'route-ok', forbidden: [] },
  })
  register(api)
  register(api, { id: 'beta', activate: () => DEFS })
  const s1 = api.list('', { scope: 's1' })
  assert.deepEqual(s1.descriptors.map((entry) => entry.id), ['beta'])
  assert.deepEqual(s1.exclusions, [{ entryId: 'alpha', reason: 'forbidden-by-route' }])
  assert.equal(s1.constraint.status, 'applied')
  assert.equal(s1.constraint.reason, 'route-denied')
  assert.ok(Object.isFrozen(s1))
  const excludeAudit = api.audit.list({ kind: 'exclude' })
  assert.deepEqual(excludeAudit.items.map((record) => record.entryId), ['alpha'])
  assert.equal(excludeAudit.items[0].owner, 'owner-a')
  const s2 = api.list('', { scope: 's2' })
  assert.deepEqual(s2.descriptors.map((entry) => entry.id), ['alpha', 'beta'])
  assert.equal(s2.exclusions.length, 0)
})

test('search constraint source failures degrade to unknown metadata without blocking', () => {
  const api = engine({
    scopeConstraint: () => { throw new Error('source down') },
  })
  register(api)
  const result = api.list('', { scope: 's1' })
  assert.equal(result.constraint.status, 'unknown')
  assert.equal(result.descriptors.length, 1, 'search proceeds despite the broken source')
})

test('search with no matches returns an explicit empty result, never fabricated suggestions', () => {
  const api = engine()
  register(api)
  const result = api.list('zzz-no-match', { scope: 's1' })
  assert.deepEqual(result.descriptors, [])
  assert.deepEqual(result.exclusions, [])
  assert.equal(result.constraint.status, 'none')
})

test('search has no activation side effects', async () => {
  const api = engine()
  register(api)
  api.list('alpha', { scope: 's1' })
  assert.deepEqual(toolsetNames(api, 's1'), [], 'search alone never activates')
  assert.equal(api.audit.list({ kind: 'activate' }).items.length, 0)
})
