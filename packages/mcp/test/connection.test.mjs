import test from 'node:test'
import assert from 'node:assert/strict'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  startConnection,
  resolveReconnectPolicy,
  RECONNECT_DEFAULTS,
  GENERATION_CLOSE_TIMEOUT_MS,
} from '../lib/connection.js'
import { transportTarget } from '../lib/transports.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function makeFakeClient({ connectError = null, clients } = {}) {
  const closed = Promise.withResolvers()
  const state = { closed: false }
  const client = {
    onclose: undefined,
    _handlers: new Map(),
    request(params) {
      if (params.method === 'tools/list') {
        return Promise.resolve({
          tools: [{ name: 'alpha', inputSchema: { type: 'object' } }],
        })
      }
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
      state.closed = true
      const onclose = client.onclose
      if (onclose) queueMicrotask(() => onclose())
      closed.resolve()
      return Promise.resolve()
    },
  }
  return { client, state, closed, clients }
}

function makeHarness({ connectError = null } = {}) {
  const published = []
  const registered = new Map()
  const created = []
  const ctx = {
    logger: { error() {}, warn() {}, info() {} },
    tools: {
      register(def) {
        const disposer = () => registered.delete(def.name)
        registered.set(def.name, disposer)
        return disposer
      },
    },
  }
  const hooks = {
    onPublish: (payload) => published.push(payload),
    createClient: () => {
      const { client } = makeFakeClient({ connectError })
      created.push(client)
      return client
    },
  }
  return { published, registered, created, ctx, hooks }
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
const policy = resolveReconnectPolicy(baseConfig.reconnect, 'reconnect')

test('resolveReconnectPolicy returns frozen defaults on omission', () => {
  const frozen = resolveReconnectPolicy(undefined, 'x')
  assert.deepEqual(frozen, RECONNECT_DEFAULTS)
  assert.ok(Object.isFrozen(frozen))
})

test('resolveReconnectPolicy rejects invalid/unknown options', () => {
  assert.throws(() => resolveReconnectPolicy({ initialDelayMs: 0 }, 'x'), /initialDelayMs/)
  assert.throws(() => resolveReconnectPolicy({ maxDelayMs: -1 }, 'x'), /maxDelayMs/)
  assert.throws(() => resolveReconnectPolicy({ initialDelayMs: 5, maxDelayMs: 1 }, 'x'), /less than or equal/)
  assert.throws(() => resolveReconnectPolicy({ maxAttempts: 0 }, 'x'), /maxAttempts/)
  assert.throws(() => resolveReconnectPolicy({ maxAttempts: 1.5 }, 'x'), /maxAttempts/)
  assert.throws(() => resolveReconnectPolicy({ bogus: true }, 'x'), /not a reconnect option/)
})

test('startConnection publishes pending then available with full tool set', async () => {
  const { published, hooks } = makeHarness()
  const ctx = {
    logger: { error() {}, warn() {}, info() {} },
    tools: {
      register(def) {
        return () => {}
      },
    },
  }
  const handle = startConnection(ctx, baseConfig, policy, hooks)
  const ready = await handle.ready
  assert.deepEqual(ready, {})
  const states = new Map(published.map((p) => [p.lifecycleState, p]))
  assert.ok(states.has('pending'))
  const available = states.get('available')
  assert.equal(available.generation, 'github#1')
  assert.equal(available.provenance.source, 'config')
  assert.equal(available.transport, 'stdio')
  assert.equal(available.tools.length, 1)
  assert.equal(available.tools[0].publicName, 'mcp__github__alpha')
  assert.equal(available.tools[0].lifecycleState, 'available')
  await handle.dispose()
})

test('startConnection disconnect triggers unavailable(reconnecting) and a reconnect generation', async () => {
  const { published, created, hooks } = makeHarness()
  const ctx = {
    logger: { error() {}, warn() {}, info() {} },
    tools: {
      register(def) {
        return () => {}
      },
    },
  }
  const handle = startConnection(ctx, baseConfig, policy, hooks)
  await handle.ready
  const first = created[0]
  const connectedAtCount = published.filter((p) => p.lifecycleState === 'available').length
  first.onclose?.()
  await sleep(60) // let one reconnect round + availability republish settle
  const states = published.map((p) => p.lifecycleState)
  assert.ok(states.includes('unavailable'), `expected unavailable, got ${JSON.stringify(states)}`)
  const unavailable = published.filter((p) => p.lifecycleState === 'unavailable').at(-1)
  assert.equal(unavailable.reason.code, 'reconnecting')
  assert.equal(unavailable.provenance.source, 'reconnect')
  // reconnect created a new client generation and re-published available
  assert.ok(created.length >= 2, 'expected at least one reconnect generation')
  assert.ok(published.filter((p) => p.lifecycleState === 'available').length > connectedAtCount)
  await handle.dispose()
})

test('startConnection exhausts the attempt budget and unregisters tools', async () => {
  const { published, hooks } = makeHarness({ connectError: new Error("conn") })
  const ctx = {
    logger: { error() {}, warn() {}, info() {} },
    tools: {
      register(def) {
        return () => {}
      },
    },
  }
  const failing = { ...baseConfig, reconnect: { enabled: true, initialDelayMs: 5, maxDelayMs: 10, maxAttempts: 2 } }
  const handle = startConnection(ctx, failing, resolveReconnectPolicy(failing.reconnect, 'r'), hooks)
  // startup connect immediately rejects; wait for exhaustion publication
  await sleep(80)
  const exhausted = published.find((p) => p.reason?.code === 'reconnect-exhausted')
  assert.ok(exhausted, `expected reconnect-exhausted, got ${JSON.stringify(published.map((p) => p.reason?.code))}`)
  assert.equal(exhausted.lifecycleState, 'unavailable')
  assert.equal(exhausted.provenance.source, 'reconnect')
  assert.deepEqual(exhausted.tools, [])
  await handle.dispose()
})

test('startConnection disposal publishes disposed and stays idempotent', async () => {
  const { published, hooks } = makeHarness()
  const ctx = {
    logger: { error() {}, warn() {}, info() {} },
    tools: {
      register(def) {
        return () => {}
      },
    },
  }
  const handle = startConnection(ctx, baseConfig, policy, hooks)
  await handle.ready
  await handle.dispose()
  const disposed = published.filter((p) => p.lifecycleState === 'disposed')
  assert.equal(disposed.length, 1)
  assert.equal(disposed[0].reason.code, 'disposed')
  // second dispose must not throw
  await handle.dispose()
})

test('startConnection list_changed notification re-syncs with list_changed provenance', async () => {
  const { published, created, hooks } = makeHarness()
  const ctx = {
    logger: { error() {}, warn() {}, info() {} },
    tools: {
      register(def) {
        return () => {}
      },
    },
  }
  const handle = startConnection(ctx, baseConfig, policy, hooks)
  await handle.ready
  const client = created[0]
  const handler = client._handlers.get(ToolListChangedNotificationSchema)
  assert.ok(typeof handler === 'function', 'list_changed handler registered')
  await handler()
  await sleep(10)
  const listChanged = published.filter((p) => p.provenance?.source === 'list_changed')
  assert.ok(listChanged.length >= 1)
  assert.equal(listChanged.at(-1).lifecycleState, 'available')
  await handle.dispose()
})

test('startConnection startup failure surfaces failOnStartupError semantics', async () => {
  const { hooks } = makeHarness({ connectError: new Error("conn") })
  const ctx = {
    logger: { error() {}, warn() {}, info() {} },
    tools: {
      register(def) {
        return () => {}
      },
    },
  }
  const failing = { ...baseConfig, reconnect: { enabled: false } }
  const handle = startConnection(ctx, failing, resolveReconnectPolicy(failing.reconnect, 'r'), hooks)
  const ready = await handle.ready
  assert.ok(ready.error, 'expected an initial connection error')
  await handle.dispose()
})

test('reconnect-disabled publishes unavailable with code reconnect-disabled', async () => {
  const { published, hooks } = makeHarness({ connectError: new Error("conn") })
  const ctx = {
    logger: { error() {}, warn() {}, info() {} },
    tools: {
      register(def) {
        return () => {}
      },
    },
  }
  const failing = { ...baseConfig, reconnect: { enabled: false } }
  const handle = startConnection(ctx, failing, resolveReconnectPolicy(failing.reconnect, 'r'), hooks)
  await handle.ready
  await sleep(5)
  const reasons = published.filter((p) => p.reason).map((p) => p.reason.code)
  assert.ok(reasons.includes('reconnect-disabled'), JSON.stringify(reasons))
  await handle.dispose()
})

test('GENERATION_CLOSE_TIMEOUT_MS is a bounded positive constant', () => {
  assert.ok(Number.isFinite(GENERATION_CLOSE_TIMEOUT_MS) && GENERATION_CLOSE_TIMEOUT_MS > 0)
})

test('egress gate deny fails closed before any transport connection', async () => {
  const { published, hooks } = makeHarness()
  let connectCalls = 0
  hooks.gate = () => ({ ok: false, outcome: 'deny', reason: 'blocked by egress policy' })
  hooks.createClient = () => {
    const { client } = makeFakeClient()
    const originalConnect = client.connect
    client.connect = (...args) => {
      connectCalls += 1
      return originalConnect(...args)
    }
    return client
  }
  const ctx = {
    logger: { error() {}, warn() {}, info() {} },
    tools: {
      register(def) {
        return () => {}
      },
    },
  }
  const handle = startConnection(ctx, baseConfig, policy, hooks)
  const ready = await handle.ready
  assert.ok(ready.error, 'a denied connection surfaces an initial error')
  assert.equal(connectCalls, 0, 'the transport connect is never invoked on deny')
  const denied = published.filter((p) => p.reason?.code === 'egress-denied')
  assert.ok(denied.length >= 1, 'egress-denied is published')
  assert.equal(denied[0].lifecycleState, 'unavailable')
  await handle.dispose()
})

test('egress gate allow lets the connection proceed normally', async () => {
  const { published, created, hooks } = makeHarness()
  hooks.gate = () => ({ ok: true, outcome: 'allow' })
  const ctx = {
    logger: { error() {}, warn() {}, info() {} },
    tools: {
      register(def) {
        return () => {}
      },
    },
  }
  const handle = startConnection(ctx, baseConfig, policy, hooks)
  const ready = await handle.ready
  assert.deepEqual(ready, {})
  assert.equal(created.length, 1, 'exactly one client generation connects')
  const states = new Map(published.map((p) => [p.lifecycleState, p]))
  assert.ok(states.has('available'))
  await handle.dispose()
})

test('a throwing egress gate is contained to a fail-closed deny', async () => {
  const { published, hooks } = makeHarness()
  let connectCalls = 0
  hooks.gate = () => { throw new Error('gate exploded') }
  hooks.createClient = () => {
    const { client } = makeFakeClient()
    const originalConnect = client.connect
    client.connect = (...args) => {
      connectCalls += 1
      return originalConnect(...args)
    }
    return client
  }
  const ctx = {
    logger: { error() {}, warn() {}, info() {} },
    tools: {
      register(def) {
        return () => {}
      },
    },
  }
  const handle = startConnection(ctx, baseConfig, policy, hooks)
  const ready = await handle.ready
  assert.ok(ready.error)
  assert.equal(connectCalls, 0, 'a throwing gate never reaches the transport')
  const denied = published.filter((p) => p.reason?.code === 'egress-denied')
  assert.ok(denied.length >= 1)
  await handle.dispose()
})

test('stdio gate target uses the command descriptor and http uses the url', () => {
  const stdio = transportTarget({ transport: 'stdio', command: 'npx' })
  assert.deepEqual(stdio, { kind: 'subprocess', destination: 'npx' })
  const http = transportTarget({ transport: 'streamable-http', url: 'https://mcp.example/endpoint' })
  assert.deepEqual(http, { kind: 'http', destination: 'https://mcp.example/endpoint' })
})
