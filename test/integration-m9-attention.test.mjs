import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { createBrowserAttentionRuntime } from '../packages/client-runtime/lib/browser-runtime.js'

/**
 * Integration wave — attention end-to-end (host hub → shared event stream →
 * api-remotes forwarder → connection frame → browser receiver feed →
 * browser attention runtime), plus per-stream audience trimming and the
 * official eleven-event allowlist boundary.
 */

function makeBootCtx() {
  const services = {
    loader: { entries() { return [] } },
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    agents: { get() {}, list() {}, roots() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {} },
    sessions: { get() {}, list() {}, fork() {} },
  }
  const state = { listeners: [], frames: [], effects: [], provides: 0 }
  const ctx = {
    listeners: state.listeners,
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') { state.pluginApi = value; state.provides += 1 } } },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      if (name === 'connection') {
        return {
          pushFrame(frame) { state.frames.push(frame) },
          rpc: { call() {}, handle() {} },
        }
      }
      return services[name]
    },
    plugin(Class) { new Class(ctx) },
    effect(fn) { state.effects.push(fn); return fn },
    on(name, listener) { state.listeners.push({ name, listener }); return () => true },
    once() {}, emit(name, payload) { for (const entry of state.listeners.filter((l) => l.name === name)) entry.listener(payload) },
    serial() {}, parallel() {}, bail() {}, waterfall() {},
  }
  return { ctx, state, services }
}

test('attention: host hub update rides the event stream into the api-remotes forwarder frames', async () => {
  const { ctx, state } = makeBootCtx()
  apply(ctx)

  const hub = state.pluginApi.attention
  // contribution over the host surface (owner derived from the caller token)
  const outcome = hub.contribute({
    id: 'n-1', title: 'hello', level: 'info', body: 'world',
    audience: ['web'], scope: { sessionId: 's1' },
  })
  assert.equal(outcome.ok, true)

  // Mount the api-remotes replacement with its default seams: it subscribes
  // to the shared event stream, resolves the host snapshot through
  // pluginApi.attention.hubSnapshot, and pushes frames on the connection.
  const { createApiRemotesApply, fullVersionContractsMatch } = await import('../packages/api-remotes/lib/apply.js')
  const apiRemotes = createApiRemotesApply({
    readPackageVersion: (name) => {
      if (name === '@deepseek-ai/dsh-api-remotes') return '0.1.0-rc.6'
      if (name === '@deepseek-ai/dsh-plugin-api-api-remotes') return '0.1.0-rc.6-0.1.0'
      if (name === '@deepseek-ai/dsh-plugin-api-main') return '0.1.0-rc.6-0.1.0'
      return undefined
    },
    readPackageApi: (name) => (name.includes('plugin-api') ? '0.1' : undefined),
  })
  const attachHandlers = new Map()
  const originalHandle = ctx.get('connection').rpc.handle
  ctx.get('connection').rpc.handle = (path, handler) => { attachHandlers.set(path, handler); return () => attachHandlers.delete(path) }
  apiRemotes(ctx)

  // The forwarder attached (post-register verification passed): now emit the
  // hub update over the shared event stream; the forwarder re-emits a frame.
  ctx.emit('attention/update', {
    kind: 'attention.delta', epoch: 1, seq: 2,
    changes: [{ op: 'add', id: 'n-1', item: { id: 'n-1', title: 'hello', level: 'info', audience: ['web'], scope: { sessionId: 's1' } } }],
  })
  const frames = state.frames
  // The contribution itself already produced one hub delta on the stream; the
  // explicit emit above adds a second frame. Every attention frame rides the
  // official host/remote-event carrier only.
  assert.ok(frames.length >= 1, 'attention frames are pushed on the connection')
  for (const frame of frames) {
    assert.equal(frame.type, 'host/remote-event')
    assert.equal(frame.event, 'attention/update')
    assert.equal(typeof frame.args[0]?.kind, 'string')
  }
  const deltaFrames = frames.filter((frame) => frame.args[0]?.kind?.startsWith('attention.'))
  assert.ok(deltaFrames.length > 0, 'delta frames present; frames=' + JSON.stringify(frames))
  const last = deltaFrames[deltaFrames.length - 1]
  assert.equal(last.args[0].kind, 'attention.delta')
  assert.equal(last.args[0].changes[0].id, 'n-1')
})

test('attention: per-stream audience trimming keeps cross-audience items out of the stream', () => {
  const { ctx, state } = makeBootCtx()
  apply(ctx)
  const hub = state.pluginApi.attention

  hub.contribute({ id: 'web-only', title: 'w', level: 'info', audience: ['web'], scope: {} })
  hub.contribute({ id: 'all-kinds', title: 'a', level: 'info', audience: 'all', scope: {} })

  const view = hub.current({ kind: ['tui'], scopes: null })
  assert.deepEqual(view.map((item) => item.id), ['all-kinds'], 'tui stream trims web-only items')
  const snapshot = hub.hubSnapshot('tui')
  assert.deepEqual(snapshot.items.map((item) => item.id), ['all-kinds'])
})

test('attention: browser receiver feed delivers frames to the attention runtime', async () => {
  const { ctx, state } = makeBootCtx()
  apply(ctx)
  const receiverSymbol = Symbol.for('dsh-plugin-api.attention.receiver')
  const g = globalThis
  // the api-remotes client wrapper registers the receiver channel once; a
  // duplicate registration keeps the first channel (no double-run receivers)
  if (g[receiverSymbol] === undefined) {
    await import('../packages/api-remotes/lib/client-src/replacement.js')
  }

  const channel = g[receiverSymbol]
  assert.ok(channel && typeof channel.subscribe === 'function' && typeof channel.receive === 'function')

  const runtime = createBrowserAttentionRuntime({ receive: channel, send: null, fetchSnapshot: null, onReset: null })
  runtime.attach()

  // feed a snapshot frame as the api-remotes pipeline would deliver it
  channel.receive({
    kind: 'attention.snapshot', epoch: 3, seq: 7,
    items: [{ id: 'n-9', title: 'snapped', level: 'info', audience: ['web'], scope: {} }],
  })
  const items = runtime.current()
  assert.equal(items.length, 1)
  assert.equal(items[0].id, 'n-9')

  // duplicate/reordered delivery is deduped by item id (no double render)
  channel.receive({
    kind: 'attention.delta', epoch: 3, seq: 8,
    changes: [{ op: 'add', id: 'n-9', item: { id: 'n-9', title: 'snapped', level: 'info', audience: ['web'], scope: {} } }],
  })
  assert.equal(runtime.current().length, 1)

  runtime.dispose?.()
})

test('attention: the official eleven-event allowlist stays intact (attention/update never enters $on)', async () => {
  const { API_REMOTE_FORWARDED_EVENTS } = await import('../packages/api-remotes/lib/forked-host.js')
  assert.equal(API_REMOTE_FORWARDED_EVENTS.length, 11)
  assert.ok(!API_REMOTE_FORWARDED_EVENTS.includes('attention/update'), 'attention/update stays out of the consumer allowlist')
})

test('attention: host hub never becomes an activity authority (correlation stays unknown)', () => {
  const { ctx, state } = makeBootCtx()
  apply(ctx)
  const hub = state.pluginApi.attention
  const outcome = hub.contribute({ id: 'n-2', title: 'x', level: 'info', audience: ['web'], scope: { sessionId: 's1' } })
  assert.equal(outcome.ok, true)
  // The hub holds no activity facts; an invocation of an undeclared action is
  // a typed unavailable, and no session state is written anywhere.
  const invoke = hub.invoke('n-2', 'run')
  assert.equal(invoke.ok, false)
  assert.ok(['not-found', 'conflict', 'unavailable'].includes(invoke.code))
})