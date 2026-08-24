import test from 'node:test'
import assert from 'node:assert/strict'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { applyPayload, sharedFor, createCatalogQuery } from '../lib/catalog.js'
import { startConnection, resolveReconnectPolicy } from '../lib/connection.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function baseCtx() {
  return {
    logger: { error() {}, warn() {}, info() {} },
    tools: { register: () => () => {} },
  }
}

function wire(shared, rootCtx) {
  return { onPublish: (p) => applyPayload(shared, rootCtx, p) }
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
  reconnect: { enabled: true, initialDelayMs: 5, maxDelayMs: 20, maxAttempts: 3 },
}
const policy = resolveReconnectPolicy(baseConfig.reconnect, 'r')

test('racing: consecutive list_changed notifications are serialized and latest-wins', async () => {
  const shared = sharedFor({ root: {} })
  const rootCtx = { emit: () => {} }
  const created = []
  let listCalls = 0
  const hooks = {
    ...wire(shared, rootCtx),
    createClient: () => {
      const client = {
        onclose: undefined,
        _handlers: new Map(),
        request(params) {
          if (params.method === 'tools/list') {
            const n = ++listCalls
            return Promise.resolve({ tools: [{ name: `tool${n}`, inputSchema: { type: 'object' } }] })
          }
          return Promise.resolve({})
        },
        setNotificationHandler(schema, handler) {
          client._handlers.set(schema, handler)
        },
        connect: () => Promise.resolve(),
        close() {

          if (client.onclose) queueMicrotask(() => client.onclose())

          return Promise.resolve()

        },
      }
      created.push(client)
      return client
    },
  }
  const handle = startConnection(baseCtx(), baseConfig, policy, hooks)
  await handle.ready
  const handler = created[0]._handlers.get(ToolListChangedNotificationSchema)
  await handler()
  await handler()
  await sleep(10)
  const query = createCatalogQuery(shared)
  const tools = query.tools()
  assert.equal(tools.length, 1)
  assert.equal(tools[0].publicName, 'mcp__github__tool3') // initial + 2 notifications, last wins
  await handle.dispose()
})

test('racing: a stale generation finishing sync must not publish its tools as current', async () => {
  const shared = sharedFor({ root: {} })
  const rootCtx = { emit: () => {} }
  const created = []
  let generations = 0
  const gate = Promise.withResolvers()
  const hooks = {
    ...wire(shared, rootCtx),
    createClient: () => {
      generations += 1
      const isFirst = generations === 1
      const client = {
        onclose: undefined,
        _handlers: new Map(),
        request(params) {
          if (isFirst && params.method === 'tools/list') {
            // first generation's sync stays in flight while a newer one takes over
            return gate.promise
          }
          if (params.method === 'tools/list') {
            return Promise.resolve({ tools: [{ name: 'fresh', inputSchema: { type: 'object' } }] })
          }
          return Promise.resolve({})
        },
        setNotificationHandler(schema, handler) {
          client._handlers.set(schema, handler)
        },
        connect: () => Promise.resolve(),
        close() {

          if (client.onclose) queueMicrotask(() => client.onclose())

          return Promise.resolve()

        },
      }
      created.push(client)
      return client
    },
  }
  const handle = startConnection(baseCtx(), baseConfig, policy, hooks)
  // let the initial sync start and hang on the first generation
  await sleep(5)
  // force a generation switch (disconnect) before the first sync completes
  created[0].onclose?.()
  // slight delay then let the newer generation complete its sync
  await sleep(20)
  gate.resolve({ tools: [{ name: 'stale', inputSchema: { type: 'object' } }] })
  await sleep(15)
  const query = createCatalogQuery(shared)
  const tools = query.tools()
  assert.equal(tools.length, 1)
  assert.equal(tools[0].publicName, 'mcp__github__fresh')
  await handle.dispose()
})

test('racing: failed re-sync keeps the last valid generation untouched', async () => {
  const shared = sharedFor({ root: {} })
  const rootCtx = { emit: () => {} }
  const created = []
  let listCalls = 0
  const hooks = {
    ...wire(shared, rootCtx),
    createClient: () => {
      const client = {
        onclose: undefined,
        _handlers: new Map(),
        request(params) {
          if (params.method === 'tools/list') {
            listCalls += 1
            if (listCalls >= 2) return Promise.reject(new Error('list failed'))
            return Promise.resolve({ tools: [{ name: 'alpha', inputSchema: { type: 'object' } }] })
          }
          return Promise.resolve({})
        },
        setNotificationHandler(schema, handler) {
          client._handlers.set(schema, handler)
        },
        connect: () => Promise.resolve(),
        close() {

          if (client.onclose) queueMicrotask(() => client.onclose())

          return Promise.resolve()

        },
      }
      created.push(client)
      return client
    },
  }
  const handle = startConnection(baseCtx(), baseConfig, policy, hooks)
  await handle.ready
  const handler = created[0]._handlers.get(ToolListChangedNotificationSchema)
  await handler()
  await sleep(10)
  const query = createCatalogQuery(shared)
  // alpha remains current and available
  assert.equal(query.tools().length, 1)
  assert.equal(query.tools()[0].publicName, 'mcp__github__alpha')
  await handle.dispose()
})

test('racing: duplicate disconnect signals are idempotent', async () => {
  const shared = sharedFor({ root: {} })
  const rootCtx = { emit: () => {} }
  const created = []
  const hooks = {
    ...wire(shared, rootCtx),
    createClient: () => {
      const client = {
        onclose: undefined,
        _handlers: new Map(),
        request(params) {
          if (params.method === 'tools/list') {
            return Promise.resolve({ tools: [{ name: 'alpha', inputSchema: { type: 'object' } }] })
          }
          return Promise.resolve({})
        },
        setNotificationHandler(schema, handler) {
          client._handlers.set(schema, handler)
        },
        connect: () => Promise.resolve(),
        close() {

          if (client.onclose) queueMicrotask(() => client.onclose())

          return Promise.resolve()

        },
      }
      created.push(client)
      return client
    },
  }
  const handle = startConnection(baseCtx(), baseConfig, policy, hooks)
  await handle.ready
  created[0].onclose?.()
  created[0].onclose?.()
  await sleep(20)
  // still settle to an available state via reconnect without throwing
  await handle.dispose()
})
