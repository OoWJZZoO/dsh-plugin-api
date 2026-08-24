import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sharedFor,
  applyPayload,
  createCatalogQuery,
  deepFreeze,
  MCP_CATALOG_CHANGED,
} from '../lib/catalog.js'

function freshShared(root = {}) {
  return sharedFor({ root })
}

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
        description: 'lists repos',
        inputSchema: 'available',
        outputSchema: 'available',
        lifecycleState: 'available',
        provenance: { source: 'config', observedAt: '2026-08-24T00:00:00.000Z' },
      },
    ],
    ...overrides,
  }
}

function makeEmitCtx() {
  const emitted = []
  const ctx = { emit: (name, value) => emitted.push({ name, value }) }
  return { emitted, ctx }
}

test('servers() projects server records and respects includeUnavailable', () => {
  const shared = freshShared()
  const { ctx } = makeEmitCtx()
  applyPayload(shared, ctx, payload()) // github available
  applyPayload(shared, ctx, payload({
    serverName: 'db',
    generation: 'db#1',
    lifecycleState: 'unavailable',
    reason: { code: 'connection-lost' },
    tools: [],
  }))
  const query = createCatalogQuery(shared)
  // default: only available servers
  assert.deepEqual(query.servers().map((s) => s.serverName), ['github'])
  assert.deepEqual(
    query.servers({ includeUnavailable: true }).map((s) => s.serverName).sort(),
    ['db', 'github'],
  )
})

test('tools() returns current generation only; generation/serverName filters apply', () => {
  const shared = freshShared()
  const { ctx } = makeEmitCtx()
  applyPayload(shared, ctx, payload())
  applyPayload(shared, ctx, payload({ generation: 'github#2', tools: [{ serverName: 'github', rawName: 'beta', publicName: 'mcp__github__beta', inputSchema: 'available', outputSchema: 'unavailable' }] }))
  const query = createCatalogQuery(shared)
  const tools = query.tools()
  assert.equal(tools.length, 1)
  assert.equal(tools[0].publicName, 'mcp__github__beta')
  // stale generation is not current
  assert.equal(query.tools({ generation: 'github#1' }).length, 0)
  // filter by server
  assert.equal(query.tools({ serverName: 'nope' }).length, 0)
})

test('resolvePublicName maps a public name back to its identity', () => {
  const shared = freshShared()
  const { ctx } = makeEmitCtx()
  applyPayload(shared, ctx, payload())
  const query = createCatalogQuery(shared)
  assert.deepEqual(query.resolvePublicName('mcp__github__alpha'), {
    identity: { serverName: 'github', rawName: 'alpha' },
    publicName: 'mcp__github__alpha',
  })
  assert.equal(query.resolvePublicName('mcp__nope__x'), undefined)
})

test('catalog outputs are deeply read-only; mutation attempts throw', () => {
  const shared = freshShared()
  const { ctx } = makeEmitCtx()
  applyPayload(shared, ctx, payload())
  const query = createCatalogQuery(shared)
  const [server] = query.servers()
  assert.ok(Object.isFrozen(server))
  assert.ok(Object.isFrozen(server.provenance))
  assert.throws(() => { server.serverName = 'hacked' }, TypeError)
  const [tool] = query.tools()
  assert.throws(() => { tool.publicName = 'hacked' }, TypeError)
  assert.throws(() => { tool.identity.rawName = 'hacked' }, TypeError)
})

test('lifecycleState vocabulary never contains superseded', () => {
  const shared = freshShared()
  const { ctx } = makeEmitCtx()
  applyPayload(shared, ctx, payload({ lifecycleState: 'unavailable', reason: { code: 'reconnect-exhausted' }, tools: [] }))
  const query = createCatalogQuery(shared)
  const states = new Set(query.servers({ includeUnavailable: true }).map((s) => s.lifecycleState))
  assert.deepEqual([...states].sort(), ['unavailable'])
  assert.ok(!states.has('superseded'))
  for (const server of query.servers({ includeUnavailable: true })) {
    assert.ok(['pending', 'available', 'unavailable', 'disposed'].includes(server.lifecycleState))
  }
})

test('queries are side-effect free (no mutation, no version bump)', () => {
  const shared = freshShared()
  const { ctx } = makeEmitCtx()
  applyPayload(shared, ctx, payload())
  const before = shared.version
  const query = createCatalogQuery(shared)
  query.servers()
  query.servers({ includeUnavailable: true })
  query.tools()
  query.tools({ generation: 'github#1' })
  query.resolvePublicName('mcp__github__alpha')
  query.snapshot()
  assert.equal(shared.version, before)
  assert.equal(shared.toolsByServer.get('github').size, 1)
})

test('applyPayload emits a frozen mcp/catalog-changed snapshot', () => {
  const shared = freshShared()
  const { emitted, ctx } = makeEmitCtx()
  applyPayload(shared, ctx, payload())
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].name, MCP_CATALOG_CHANGED)
  assert.ok(Object.isFrozen(emitted[0].value))
  assert.ok(Object.isFrozen(emitted[0].value.servers[0]))
  assert.equal(emitted[0].value.servers[0].serverName, 'github')
  assert.equal(emitted[0].value.tools[0].publicName, 'mcp__github__alpha')
})

test('bad payloads are ignored fail-safe', () => {
  const shared = freshShared()
  const { emitted, ctx } = makeEmitCtx()
  applyPayload(shared, ctx, undefined)
  applyPayload(shared, ctx, { serverName: 42 })
  applyPayload(shared, ctx, {})
  assert.equal(emitted.length, 0)
  assert.equal(createCatalogQuery(shared).servers().length, 0)
})

test('deepFreeze handles nested arrays and objects', () => {
  const obj = { a: { b: [1, { c: 2 }] } }
  const frozen = deepFreeze(obj)
  assert.ok(Object.isFrozen(frozen.a.b[1]))
  assert.throws(() => { frozen.a.b.push(3) }, TypeError)
})
