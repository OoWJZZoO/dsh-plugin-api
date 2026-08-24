import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyPayload,
  sharedFor,
  McpCatalogService,
  MCP_CATALOG_CHANGED,
} from '../lib/catalog.js'

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

/** A minimal Cordis-looking root context: records onChange listeners and
 *  dispatches emitted events back to them (with listener containment). */
function makeEventCtx() {
  const listeners = new Set()
  const ctx = {
    reflect: { provide() {} },
    on(name, listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(name, value) {
      for (const listener of [...listeners]) {
        try {
          listener(value)
        } catch {
          // containment here mirrors what a real bus would do per-listener
        }
      }
    },
  }
  return { ctx, listeners }
}

test('ctx.mcpCatalog service exposes projection + onChange subscription', () => {
  const shared = sharedFor({ root: {} })
  const { ctx } = makeEventCtx()
  const api = new McpCatalogService(ctx, shared)
  const received = []
  const disposer = api.onChange((snapshot) => received.push(snapshot))
  applyPayload(shared, ctx, payload())
  assert.equal(received.length, 1)
  assert.equal(received[0].name === undefined, true) // snapshot object, not an event envelope
  assert.equal(api.servers().length, 1)
  assert.equal(api.tools()[0].publicName, 'mcp__github__alpha')
  assert.equal(api.resolvePublicName('mcp__github__alpha').identity.rawName, 'alpha')
  disposer()
  applyPayload(shared, ctx, payload({ generation: 'github#2', tools: [] }))
  assert.equal(received.length, 1, 'unsubscribed listener no longer receives events')
})

test('every catalog state change emits exactly one frozen mcp/catalog-changed snapshot', () => {
  const shared = sharedFor({ root: {} })
  const emitted = []
  const ctx = {
    reflect: { provide() {} },
    on() {
      return () => {}
    },
    emit(name, value) {
      emitted.push({ name, value })
    },
  }
  applyPayload(shared, ctx, payload({ lifecycleState: 'pending', tools: [] }))
  applyPayload(shared, ctx, payload())
  applyPayload(shared, ctx, payload({ lifecycleState: 'unavailable', reason: { code: 'connection-lost' }, tools: [] }))
  assert.equal(emitted.length, 3)
  for (const event of emitted) {
    assert.equal(event.name, MCP_CATALOG_CHANGED)
    assert.ok(Object.isFrozen(event.value))
    assert.ok(Object.isFrozen(event.value.tools))
  }
})

test('a throwing onChange listener does not break publication or other listeners', () => {
  const shared = sharedFor({ root: {} })
  const { ctx } = makeEventCtx()
  const api = new McpCatalogService(ctx, shared)
  const healthy = []
  api.onChange(() => {
    healthy.push(1)
  })
  api.onChange(() => {
    throw new Error('listener exploded')
  })
  assert.doesNotThrow(() => applyPayload(shared, ctx, payload()))
  assert.equal(healthy.length, 1)
})
