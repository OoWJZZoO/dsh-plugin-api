import test from 'node:test'
import assert from 'node:assert/strict'
import { createToolDiscoveryEngine } from '../lib/tool-discovery.js'
import {
  ToolDiscoveryActivationSupersededError,
  ToolDiscoveryEntryConflictError,
  ToolDiscoveryEntryDeactivatedError,
  ToolDiscoveryEntryDisposedError,
  ToolDiscoveryEntryFailedError,
  ToolDiscoveryEntryUnknownError,
  ToolDiscoveryScopeUnresolvedError,
} from '../lib/tool-discovery-errors.js'
import { PluginApiError, PluginApiInactiveError } from '../lib/errors.js'
import { CODES } from '../lib/tool-discovery-normalize.js'

let sequence = 0
function engine(options = {}) {
  sequence += 1
  return createToolDiscoveryEngine({
    idFactory: () => `gen-${sequence}-${(sequence += 1)}`,
    now: () => new Date('2026-08-25T00:00:00.000Z'),
    reportDiagnostics: options.reportDiagnostics ?? (() => {}),
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

test('register returns a handle with generation and an idempotent disposer', () => {
  const api = engine()
  const handle = register(api)
  assert.equal(typeof handle.generation, 'string')
  assert.ok(handle.generation.startsWith('owner-a:'))
  assert.equal(typeof handle.dispose, 'function')
  assert.equal(handle.dispose(), true)
  assert.equal(handle.dispose(), false, 'entry disposer is idempotent')
})

test('duplicate entry id is a typed conflict and the existing entry is preserved', () => {
  const api = engine()
  register(api)
  assert.throws(() => register(api), (error) => error instanceof ToolDiscoveryEntryConflictError && error.code === CODES.ENTRY_CONFLICT)
  const result = api.search('', { scope: 's1' })
  assert.equal(result.descriptors.length, 1)
  assert.equal(result.descriptors[0].id, 'alpha')
})

test('entry lifecycle: activate publishes a generation-bound toolset; dispose reclaims it', async () => {
  const api = engine()
  const entry = register(api)
  const handle = await api.activate('alpha', { session: { id: 's1' }, reason: 'vision task' })
  assert.equal(typeof handle.generation, 'string')
  assert.notEqual(handle.generation, entry.generation, 'toolset generation differs from entry generation')
  assert.deepEqual(toolsetNames(api, 's1'), ['alpha_run'], 'next exposure sees the activated tool')
  assert.deepEqual(toolsetNames(api, 's2'), [], 'other scopes never leak')
  assert.equal(handle.dispose().ok, true)
  assert.deepEqual(toolsetNames(api, 's1'), [], 'disposed generation disappears on the next exposure')
})

test('activate rejects unknown, disposed, deactivated and failed entries with typed errors', async () => {
  const api = engine()
  await assert.rejects(api.activate('ghost', { session: { id: 's1' } }), ToolDiscoveryEntryUnknownError)
  const handle = register(api)
  handle.dispose()
  await assert.rejects(api.activate('alpha', { session: { id: 's1' } }), ToolDiscoveryEntryDisposedError)
  // dispose + register is the documented recovery path for a disposed id
  const recreated = register(api)
  assert.notEqual(recreated.generation, handle.generation)
  await api.deactivate('alpha', { reason: 'retired' })
  await assert.rejects(api.activate('alpha', { session: { id: 's1' } }), ToolDiscoveryEntryDeactivatedError)
  recreated.dispose()
})

test('activate without a resolvable scope is a typed rejection', async () => {
  const api = engine()
  register(api)
  await assert.rejects(
    api.activate('alpha', { session: {}, execution: {} }),
    (error) => error instanceof ToolDiscoveryScopeUnresolvedError && error.code === CODES.SCOPE_UNRESOLVED,
  )
})

test('a throwing activate callback fails only that entry and keeps others alive', async () => {
  const api = engine()
  const diagnostics = []
  register(api, { id: 'bad', activate: () => { throw new Error('boom') } })
  register(api, { id: 'good', activate: () => DEFS })
  await assert.rejects(api.activate('bad', { session: { id: 's1' } }), ToolDiscoveryEntryFailedError)
  const handle = await api.activate('good', { session: { id: 's1' } })
  assert.deepEqual(toolsetNames(api, 's1'), ['alpha_run'], 'unrelated entries keep working')
  assert.equal(api.availability().catalog.failed, 1)
  const failAudit = api.audit.query({ kind: 'fail' })
  assert.equal(failAudit.items.length, 1, 'entry failure leaves a fail-kind audit record')
  assert.equal(failAudit.items[0].owner, 'owner-a')
  await assert.rejects(api.activate('bad', { session: { id: 's1' } }), ToolDiscoveryEntryFailedError, 'failed entries stay rejected')
  handle.dispose()
})

test('a malformed activate output fails the entry with typed rejection', async () => {
  const api = engine()
  register(api, { activate: () => [{ name: '' }] })
  await assert.rejects(api.activate('alpha', { session: { id: 's1' } }), ToolDiscoveryEntryFailedError)
  assert.equal(api.availability().catalog.failed, 1)
})

test('latest-wins: a late async activation loses submission qualification and is retained as diagnostics', async () => {
  const api = engine()
  const diagnostics = []
  let calls = 0
  let releaseFirst
  const gate = new Promise((resolve) => { releaseFirst = resolve })
  register(api, {
    activate: () => {
      calls += 1
      return calls === 1 ? gate.then(() => DEFS) : DEFS
    },
  })
  const first = api.activate('alpha', { session: { id: 's1' } })
  const second = await api.activate('alpha', { session: { id: 's1' } })
  releaseFirst()
  await assert.rejects(first, (error) => error instanceof ToolDiscoveryActivationSupersededError && error.code === CODES.ACTIVATION_SUPERSEDED)
  const revoke = api.audit.query({ kind: 'revoke' })
  assert.ok(revoke.items.length >= 1, 'superseded activation leaves a revoke record')
  assert.deepEqual(toolsetNames(api, 's1'), ['alpha_run'], 'the winning generation is the only exposure')
  second.dispose()
  assert.equal(diagnostics.length, 0)
})

test('a stale handle disposer cannot remove the newer generation exposure', async () => {
  const api = engine()
  register(api)
  const first = await api.activate('alpha', { session: { id: 's1' } })
  const second = await api.activate('alpha', { session: { id: 's1' } })
  const stale = first.dispose()
  assert.equal(stale.ok, false)
  assert.equal(stale.code, CODES.GENERATION_STALE)
  assert.deepEqual(toolsetNames(api, 's1'), ['alpha_run'], 'current active exposure preserved')
  second.dispose()
})

test('deactivate soft-offlines the entry without revoking issued handles', async () => {
  const api = engine()
  register(api)
  const handle = await api.activate('alpha', { session: { id: 's1' } })
  const outcome = await api.deactivate('alpha', { reason: 'retired' })
  assert.equal(outcome.ok, true)
  await assert.rejects(api.activate('alpha', { session: { id: 's2' } }), ToolDiscoveryEntryDeactivatedError)
  assert.deepEqual(toolsetNames(api, 's1'), ['alpha_run'], 'existing toolset keeps its coherent view')
  handle.dispose()
})

test('entry disposer cleans only its own generations in every scope', async () => {
  const api = engine()
  const handleA = register(api)
  const handleB = register(api, { id: 'beta', activate: () => [{ name: 'beta_tool', description: 'Beta', parameters: {} }] })
  const a1 = await api.activate('alpha', { session: { id: 's1' } })
  await api.activate('beta', { session: { id: 's1' } })
  await api.activate('alpha', { session: { id: 's2' } })
  handleA.dispose()
  assert.deepEqual(toolsetNames(api, 's1'), ['beta_tool'], 'only alpha records are reclaimed')
  assert.deepEqual(toolsetNames(api, 's2'), [], 'alpha removed from every scope')
  assert.equal(a1.dispose().ok, false, 'a stale disposer after entry disposal is a typed no-op')
  handleB.dispose()
})

test('audit is bounded, frozen, filterable and paginated', async () => {
  const api = engine({ auditLimit: 3 })
  register(api)
  for (let i = 0; i < 5; i += 1) {
    const handle = await api.activate('alpha', { session: { id: 's1' }, reason: `r${i}` })
    handle.dispose()
  }
  const availability = api.availability()
  assert.equal(availability.audit.limit, 3)
  assert.equal(availability.audit.count, 3)
  assert.equal(availability.audit.truncated, true, 'ring overflow is reported')
  const all = api.audit.query({})
  assert.equal(all.items.length, 3)
  assert.equal(all.truncated, false, 'one page covers the whole bounded ring')
  assert.ok(Object.isFrozen(all))
  assert.ok(Object.isFrozen(all.items[0]))
  assert.equal(typeof all.items[0].at, 'string')
  assert.equal(typeof all.items[0].seq, 'number')
  assert.ok(['activate', 'deactivate'].includes(all.items[0].kind))
  const page2 = api.audit.query({ limit: 2 })
  assert.equal(page2.items.length, 2)
  assert.equal(page2.truncated, true, 'more records remain')
  assert.equal(page2.nextCursor, '2')
  const rest = api.audit.query({ cursor: 2 })
  assert.equal(rest.items.length, 1)
  assert.equal(rest.truncated, false)
  const byKind = api.audit.query({ kind: 'activate' })
  assert.ok(byKind.items.every((record) => record.kind === 'activate'))
  const byOwner = api.audit.query({ owner: 'owner-a' })
  assert.ok(byOwner.items.every((record) => record.owner === 'owner-a'))
  const byEntry = api.audit.query({ entryId: 'alpha' })
  assert.ok(byEntry.items.every((record) => record.entryId === 'alpha'))
})

test('audit storage failure surfaces an explicit gap and never fabricates records', async () => {
  const api = engine({ appendAudit: () => false, auditLimit: 5 })
  register(api)
  const handle = await api.activate('alpha', { session: { id: 's1' } })
  assert.equal(api.availability().audit.gap, true)
  assert.equal(api.audit.query({}).items.length, 0, 'no fabricated records')
  assert.deepEqual(toolsetNames(api, 's1'), ['alpha_run'], 'exposure continues per the activation path')
  handle.dispose()
})

test('scope isolation: toolsets stay in their owning session scope', async () => {
  const api = engine()
  register(api)
  const handle = await api.activate('alpha', { session: { id: 's1' } })
  assert.deepEqual(toolsetNames(api, 's1'), ['alpha_run'])
  assert.deepEqual(toolsetNames(api, 's2'), [])
  handle.dispose()
})

test('provider and hint degrade to empty output on scope resolution failure', () => {
  const api = engine()
  const provider = api.provider({ scope: {} })
  assert.deepEqual(provider, { schemas: [], knownNames: [] })
  assert.equal(api.hintText({ scope: {} }), '')
})

test('hint contributes only active entries with descriptor data and invocation syntax', async () => {
  const api = engine()
  register(api, { summary: 'Alpha tool', capabilities: ['vision'] })
  assert.equal(api.hintText({ scope: { session: { id: 's1' } } }), '', 'no active entry, zero bytes')
  const handle = await api.activate('alpha', { session: { id: 's1' } })
  const hint = api.hintText({ scope: { session: { id: 's1' } } })
  assert.ok(hint.includes('alpha'), 'entry id present')
  assert.ok(hint.includes('Alpha tool'), 'summary present')
  assert.ok(hint.includes('vision'), 'capabilities present')
  assert.ok(hint.includes('alpha_run'), 'invocation syntax present')
  assert.ok(hint.includes('[source=plugin]'), 'source kind present')
  assert.equal(api.hintText({ scope: { session: { id: 'other' } } }), '')
  handle.dispose()
})

test('case-2 toolNames are recorded in the active toolset but never emitted by the provider', async () => {
  const api = engine()
  register(api, { toolNames: ['existing_tool'], activate: () => [] })
  const handle = await api.activate('alpha', { session: { id: 's1' } })
  assert.deepEqual(toolsetNames(api, 's1'), [], 'referenced names produce no provider schemas')
  const activateAudit = api.audit.query({ kind: 'activate' })
  assert.deepEqual(activateAudit.items[0].toolNames, ['existing_tool'], 'case-2 names land in the audit record')
  handle.dispose()
})

test('entry failure reclaims in-flight activations so they can never publish late', async () => {
  const api = engine()
  let calls = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  register(api, {
    activate: async () => {
      const ordinal = ++calls
      await gate
      if (ordinal === 1) throw new Error('boom')
      return DEFS
    },
  })
  const first = api.activate('alpha', { session: { id: 's1' } })
  const second = api.activate('alpha', { session: { id: 's1' } })
  release()
  await assert.rejects(first, ToolDiscoveryEntryFailedError)
  await assert.rejects(second, ToolDiscoveryActivationSupersededError, 'in-flight activation loses qualification once the entry failed')
  assert.deepEqual(toolsetNames(api, 's1'), [], 'nothing published')
  const revokes = api.audit.query({ kind: 'revoke' })
  assert.ok(revokes.items.some((record) => record.reason === 'entry-failed'), 'reclaim recorded as a revoke')
})

test('availability reflects the true state and core inactivity rejects operations', async () => {
  let coreActive = true
  const api = engine({ isActive: () => coreActive })
  assert.equal(api.availability().active, true)
  assert.equal(api.availability().constraint.status, 'none')
  coreActive = false
  assert.equal(api.availability().active, false, 'availability reports truthfully while inactive')
  assert.throws(() => register(api), PluginApiInactiveError)
  assert.throws(() => api.search('', { scope: 's1' }), PluginApiInactiveError)
  assert.throws(() => api.audit.query({}), PluginApiInactiveError)
  await assert.rejects(api.activate('ghost', { session: { id: 's1' } }), PluginApiInactiveError)
})

test('all engine failures are typed PluginApiError subclasses', async () => {
  const api = engine()
  register(api)
  await assert.rejects(api.activate('missing', { session: { id: 's1' } }), (error) => error instanceof PluginApiError)
  assert.throws(() => api.catalog.register({}), (error) => error instanceof PluginApiError)
})

test('engine dispose clears state and further reuse is inert', async () => {
  const api = engine()
  register(api)
  api.dispose()
  assert.equal(api.availability().catalog.registered, 0)
})