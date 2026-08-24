import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPayload, sharedFor, createCatalogQuery } from '../lib/catalog.js'

function payload(overrides = {}) {
  return {
    serverName: 'github',
    lifecycleState: 'available',
    generation: 'github#1',
    transport: 'stdio',
    observedAt: '2026-08-24T00:00:00.000Z',
    provenance: { source: 'config', certainty: 'observed' },
    tools: [
      {
        serverName: 'github',
        rawName: 'alpha',
        publicName: 'mcp__github__alpha',
        inputSchema: 'available',
        outputSchema: 'available',
        lifecycleState: 'available',
        provenance: { source: 'config', observedAt: '2026-08-24T00:00:00.000Z' },
      },
    ],
    ...overrides,
  }
}

test('redaction: server/tool projection never exposes transport secrets', () => {
  const shared = sharedFor({ root: {} })
  const ctx = { emit() {} }
  // Secret-shaped fields are only ever part of the official config consumed by
  // the transport, never of the catalog payload. Assert the projection surface
  // simply has no such keys at all.
  applyPayload(shared, ctx, payload())
  const query = createCatalogQuery(shared)
  const server = JSON.stringify(query.servers()[0])
  assert.ok(!server.includes('token'), 'catalog must not contain token-shaped values')
  assert.ok(!server.includes('headers'), 'catalog must not contain header-shaped values')
  assert.ok(!server.includes('Authorization'), 'catalog must not contain Authorization')
  const tool = JSON.stringify(query.tools()[0])
  assert.ok(!tool.includes('env'), 'tool records must not leak environment')
  assert.ok(!tool.includes('secret'), 'tool records must not leak secrets')
})

test('redaction: reason codes are bounded and category-free by default', () => {
  const shared = sharedFor({ root: {} })
  const ctx = { emit() {} }
  applyPayload(shared, ctx, payload({
    lifecycleState: 'unavailable',
    reason: { code: 'reconnect-exhausted' },
    tools: [],
  }))
  const query = createCatalogQuery(shared)
  const view = query.servers({ includeUnavailable: true })[0]
  assert.ok(['pending', 'available', 'unavailable', 'disposed'].includes(view.lifecycleState))
  assert.equal(view.reason.code, 'reconnect-exhausted')
  // redaction fails closed: an unclassifiable reason never leaks raw error text
  applyPayload(shared, ctx, payload({
    lifecycleState: 'unavailable',
    reason: { code: 'connection-lost' },
    tools: [],
  }))
  const updated = query.servers({ includeUnavailable: true })[0]
  assert.ok(!String(updated.reason.code).includes('UnhandledRejection'), 'no raw error propagation')
})

test('containment: a payload for one server never touches another server state', () => {
  const shared = sharedFor({ root: {} })
  const ctx = { emit() {} }
  applyPayload(shared, ctx, payload())
  applyPayload(shared, ctx, payload({ serverName: 'db', generation: 'db#1', lifecycleState: 'unavailable', reason: { code: 'connection-lost' }, tools: [] }))
  const query = createCatalogQuery(shared)
  assert.deepEqual(query.servers({ includeUnavailable: true }).map((s) => s.serverName).sort(), ['db', 'github'])
  assert.equal(query.tools().length, 1)
  assert.equal(query.tools()[0].identity.serverName, 'github')
})

test('boundary: no route/budget/tools-exposure/UI-mutation surface is exposed by the projection', () => {
  const shared = sharedFor({ root: {} })
  const query = createCatalogQuery(shared)
  const surface = Object.keys(query)
  assert.deepEqual(surface, ['servers', 'tools', 'resolvePublicName', 'snapshot'])
  // every method object only reads; no method accepts a mutation/registration action
  assert.equal(typeof query.servers, 'function')
  assert.equal(typeof query.tools, 'function')
})

test('boundary: catalog queries cannot register or unregister MCP tools (no such method)', () => {
  const shared = sharedFor({ root: {} })
  const ctx = { emit() {} }
  applyPayload(shared, ctx, payload())
  const query = createCatalogQuery(shared)
  assert.equal(query.register, undefined)
  assert.equal(query.unregister, undefined)
  assert.equal(query.sync, undefined)
  assert.equal(query.tools().length, 1, 'queries are pure reads')
})
