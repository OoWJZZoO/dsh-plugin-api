import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPayload, sharedFor, createCatalogQuery } from '../lib/catalog.js'
import { startConnection, resolveReconnectPolicy } from '../lib/connection.js'
import { createExecutor } from '../lib/tools.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function makeFakeClient({ connectError = null, listError = null } = {}) {
  const closed = Promise.withResolvers()
  const client = {
    onclose: undefined,
    _handlers: new Map(),
    request(params) {
      if (listError) return Promise.reject(listError)
      if (params.method === 'tools/list') {
        return Promise.resolve({ tools: [{ name: 'alpha', inputSchema: { type: 'object' } }] })
      }
      if (params.method === 'tools/call') return Promise.resolve({ content: [{ type: 'text', text: 'ok' }] })
      return Promise.resolve({})
    },
    setNotificationHandler(schema, handler) {
      client._handlers.set(schema, handler)
    },
    connect() {
      if (connectError) return Promise.reject(connectError)
      return Promise.resolve()
    },
    close() {
      if (client.onclose) queueMicrotask(() => client.onclose())
      closed.resolve()
      return Promise.resolve()
    },
  }
  return { client }
}

/** Wire a connection supervisor's publications into a shared catalog. */
function integrate({ connectError = null, listError = null } = {}) {
  const shared = sharedFor({ root: {} })
  const emits = []
  const rootCtx = { emit: (_name, value) => emits.push(value) }
  const created = []
  const ctx = {
    logger: { error() {}, warn() {}, info() {} },
    tools: {
      register(def) {
        return () => {}
      },
    },
  }
  const hooks = {
    gate: () => ({ ok: true, outcome: 'allow' }),
    onPublish: (payload) => applyPayload(shared, rootCtx, payload),
    createClient: () => {
      const { client } = makeFakeClient({ connectError, listError })
      created.push(client)
      return client
    },
  }
  return { shared, emits, rootCtx, created, ctx, hooks, query: createCatalogQuery(shared) }
}

const baseConfig = {
  serverName: 'github',
  transport: 'stdio',
  command: 'npx',
  args: [],
  env: {},
  cwd: '',
  toolCallTimeoutMs: 1000,
  failOnStartupError: false,
  reconnect: { enabled: true, initialDelayMs: 10, maxDelayMs: 40, maxAttempts: 2 },
}
const policy = resolveReconnectPolicy(baseConfig.reconnect, 'r')

test('lifecycle: available -> disconnect -> reconnect keeps a stable catalog', async () => {
  const c = integrate()
  const handle = startConnection(c.ctx, baseConfig, policy, c.hooks)
  await handle.ready
  const ok = c.query.servers().find((s) => s.serverName === 'github')
  assert.equal(ok.lifecycleState, 'available')
  assert.equal(c.query.tools().length, 1)
  await handle.dispose()
})

test('lifecycle: reconnect-disabled leaves the server explicitly unavailable', async () => {
  const c = integrate()
  const cfg = { ...baseConfig, reconnect: { enabled: false } }
  const handle = startConnection(c.ctx, cfg, resolveReconnectPolicy(cfg.reconnect, 'r'), c.hooks)
  await handle.ready
  const first = c.created[0]
  first.onclose?.()
  await sleep(20)
  const server = c.query.servers({ includeUnavailable: true }).find((s) => s.serverName === 'github')
  assert.equal(server.lifecycleState, 'unavailable')
  assert.equal(server.reason.code, 'reconnect-disabled')
  // default query hides unavailable; tools are gone
  assert.equal(c.query.servers().length, 0)
  assert.equal(c.query.tools().length, 0)
  await handle.dispose()
})

test('lifecycle: exhaustion unregisters tools and marks unavailable(reconnect-exhausted)', async () => {
  const c = integrate({ connectError: new Error('boom') })
  const cfg = { ...baseConfig, reconnect: { enabled: true, initialDelayMs: 5, maxDelayMs: 10, maxAttempts: 1 } }
  const handle = startConnection(c.ctx, cfg, resolveReconnectPolicy(cfg.reconnect, 'r'), c.hooks)
  await sleep(60)
  const server = c.query.servers({ includeUnavailable: true }).find((s) => s.serverName === 'github')
  assert.ok(server, 'server should be recorded')
  assert.equal(server.lifecycleState, 'unavailable')
  assert.equal(server.reason.code, 'reconnect-exhausted')
  assert.equal(c.query.tools().length, 0)
  await handle.dispose()
})

test('lifecycle: disposal publishes a disposed terminal state', async () => {
  const c = integrate()
  const handle = startConnection(c.ctx, baseConfig, policy, c.hooks)
  await handle.ready
  await handle.dispose()
  const server = c.query.servers({ includeUnavailable: true }).find((s) => s.serverName === 'github')
  assert.equal(server.lifecycleState, 'disposed')
  assert.equal(server.reason.code, 'disposed')
})

test('lifecycle: one broken server does not affect an independent available server', async () => {
  const shared = sharedFor({ root: {} })
  const emits = []
  const rootCtx = { emit: (_n, v) => emits.push(v) }
  const mk = (serverName, connectError = null) => {
    const created = []
    const ctx = {
      logger: { error() {}, warn() {}, info() {} },
      tools: { register: () => () => {} },
    }
    const hooks = {
      gate: () => ({ ok: true, outcome: 'allow' }),
      onPublish: (p) => applyPayload(shared, rootCtx, p),
      createClient: () => {
        const { client } = makeFakeClient({ connectError })
        created.push(client)
        return client
      },
    }
    return { ctx, hooks }
  }
  const broken = mk('broken', new Error('boom'))
  const healthy = mk('healthy')
  const cfgBroken = { ...baseConfig, serverName: 'broken', reconnect: { enabled: true, initialDelayMs: 5, maxDelayMs: 10, maxAttempts: 2 } }
  const cfgHealthy = { ...baseConfig, serverName: 'healthy', reconnect: { enabled: true, initialDelayMs: 5, maxDelayMs: 10, maxAttempts: 2 } }
  const h1 = startConnection(broken.ctx, cfgBroken, resolveReconnectPolicy(cfgBroken.reconnect, 'r'), broken.hooks)
  const h2 = startConnection(healthy.ctx, cfgHealthy, resolveReconnectPolicy(cfgHealthy.reconnect, 'r'), healthy.hooks)
  await h2.ready
  await sleep(60) // let broken exhaust, healthy stay available
  const query = createCatalogQuery(shared)
  assert.equal(query.servers().length, 1)
  assert.equal(query.servers()[0].serverName, 'healthy')
  const brokenView = query.servers({ includeUnavailable: true }).find((s) => s.serverName === 'broken')
  assert.equal(brokenView.lifecycleState, 'unavailable')
  await h1.dispose()
  await h2.dispose()
})

test('lifecycle: executor rejects when the captured generation is no longer current', async () => {
  const client = {
    request() {
      return Promise.resolve({ content: [{ type: 'text', text: 'ok' }] })
    },
  }
  const fresh = createExecutor(client, 'raw', false, { toolCallTimeoutMs: 1000, isCurrent: () => true })
  assert.deepEqual(await fresh({}, {}), { content: [{ type: 'text', text: 'ok' }] })
  const stale = createExecutor(client, 'raw', false, { toolCallTimeoutMs: 1000, isCurrent: () => false })
  await assert.rejects(() => stale({}, {}), /no longer current/)
})

test('lifecycle: no isCurrent guard keeps official executor behavior', async () => {
  const client = {
    request() {
      return Promise.resolve({ content: [{ type: 'text', text: 'ok' }] })
    },
  }
  const exec = createExecutor(client, 'raw', false, { toolCallTimeoutMs: 1000 })
  assert.deepEqual(await exec({}, {}), { content: [{ type: 'text', text: 'ok' }] })
})
