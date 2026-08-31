import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { scopeTarget } from '@deepseek-ai/dsh-scope'

/**
 * End-to-end catalog gates every contributed slice must receive
 * REAL facade treatment through pluginApi.events after apply() — priority
 * ordering, freeze policy, fault policy, and scope gating — not raw ctx.on
 * passthrough. This file is the regression gate for the session session lifecycle defect
 * fixed by the earlier bus unification.
 */

function createFullCtx({ withCompactionReplacement = false } = {}) {
  const hooks = new Map()
  const hooksOf = (name) => {
    let list = hooks.get(name)
    if (!list) {
      list = []
      hooks.set(name, list)
    }
    return list
  }
  const dispatch = (callArgs) => {
    // callArgs is [thisArg?, name, ...payload]; returns bound callbacks and the payload-only args
    const arr = [...callArgs]
    const thisArg = typeof arr[0] === 'object' || typeof arr[0] === 'function' ? arr.shift() : null
    const name = arr.shift()
    return { thisArg, name, callbacks: hooksOf(name).map((hook) => hook.callback.bind(thisArg)), payloadArgs: arr }
  }

  const services = {
    llm: {
      resolveModelInfo() {},
      prepareCall() {},
      stream() {},
      registerAdapter() {},
      registerConfigurableProviders() {},
      registerModelDiscovery() {},
    },
    agents: { get() {}, list() {}, roots() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    sessions: { get() {}, list() {}, fork() {} },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
  }

  let compactionRows = []
  if (withCompactionReplacement) {
    services.compaction = {
      [Symbol.for('dsh-plugin-api.compaction-events.contract')]: true,
      compactIfNeeded() {},
      compactNow() {},
      compactRegion() {},
      summarize() {},
    }
    compactionRows = [
      { options: { name: '@deepseek-ai/dsh-plugin-api-compaction-events' }, fiber: {}, disabled: false },
    ]
  }

  const state = { pluginApi: undefined, listeners: [], effects: [] }
  const ctx = {
    logger: { error() {}, warn() {} },
    hooks,
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') state.pluginApi = value
      },
    },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      return services[name]
    },
    plugin(Class) {
      new Class(ctx)
    },
    effect(fn, label) {
      state.effects.push({ fn, label })
    },
    on(name, listener) {
      const list = hooksOf(name)
      const entry = { callback: listener }
      list.push(entry)
      state.listeners.push({ name, listener })
      let removed = false
      return () => {
        if (removed) return false
        removed = true
        const index = list.findIndex((hook) => hook === entry)
        if (index >= 0) {
          list.splice(index, 1)
          return true
        }
        return false
      }
    },
    once(name, listener) {
      const dispose = ctx.on(name, function onceWrapper(...args) {
        dispose()
        return listener.apply(this, args)
      })
      state.listeners.push({ name, listener, once: true })
      return dispose
    },
    emit(name, ...args) {
      const { callbacks, payloadArgs } = dispatch([name, ...args])
      for (const callback of callbacks) callback(...payloadArgs)
    },
    scopedEmit(thisArg, name, ...args) {
      const { callbacks, payloadArgs } = dispatch([thisArg, name, ...args])
      for (const callback of callbacks) callback(...payloadArgs)
    },
    serial(name, ...args) {
      const { callbacks, payloadArgs } = dispatch([name, ...args])
      let result
      for (const callback of callbacks) result = callback(...payloadArgs)
      return result
    },
    parallel(name, ...args) {
      const { callbacks, payloadArgs } = dispatch([name, ...args])
      return Promise.all(callbacks.map((callback) => callback(...payloadArgs))).then(() => {})
    },
    bail(name, ...args) {
      const { callbacks, payloadArgs } = dispatch([name, ...args])
      for (const callback of callbacks) {
        const result = callback(...payloadArgs)
        if (result !== undefined) return result
      }
      return undefined
    },
    waterfall(name, ...args) {
      const { callbacks } = dispatch([name, ...args])
      const chain = [...callbacks]
      const run = (index) => {
        if (index >= chain.length) {
          const terminal = args[args.length - 1]
          return typeof terminal === 'function' ? terminal() : undefined
        }
        const callback = chain[index]
        return callback(...args.slice(0, -1), () => run(index + 1))
      }
      return run(0)
    },
  }
  if (withCompactionReplacement) {
    ctx.loader = {
      entries() {
        return compactionRows[Symbol.iterator]()
      },
    }
  }
  return { ctx, state, services }
}


/** Observe projection shim: subscribe and unwrap multi-arg payload arrays. */
function observeOn(events, name, listener, opts) {
  const handle = events.observe(name, opts)
  handle.subscribe((payload) => {
    const args = Array.isArray(payload) ? payload : [payload]
    listener(...args)
  })
  return handle
}

test('catalog composition after apply covers all 47 stabilized events', () => {
  const { ctx, state } = createFullCtx()
  apply(ctx)
  assert.equal(Object.keys(state.pluginApi.events.catalog()).length, 47)
  for (const name of ['session/created', 'agent/created', 'llm/stream', 'system-prompt/assemble', 'settings/updated', 'tools/execute']) {
    assert.ok(state.pluginApi.events.catalog()[name], `${name} must be cataloged`)
  }
})

test('session slice gate: session/created receives freeze + containment + scope gating through pluginApi.events (session lifecycle regression)', () => {
  const { ctx, state } = createFullCtx()
  apply(ctx)

  // deep-freeze of payload
  const received = []
  observeOn(state.pluginApi.events, 'session/created', (session) => received.push(session))
  const session = { header: { id: 's1' } }
  ctx.scopedEmit(scopeTarget({}, 'agent-1'), 'session/created', session)
  assert.equal(received.length, 1)
  assert.ok(Object.isFrozen(received[0]), 'session payload must be deep-frozen')
  assert.ok(Object.isFrozen(received[0].header), 'nested payload must be deep-frozen')

  // containment: throwing listener does not break dispatch
  const order = []
  observeOn(state.pluginApi.events, 'session/disposed', () => {
    order.push('first')
    throw new Error('boom')
  })
  observeOn(state.pluginApi.events, 'session/disposed', () => order.push('second'))
  assert.doesNotThrow(() => ctx.scopedEmit(scopeTarget({}, 'agent-1'), 'session/disposed', { id: 's1' }))
  assert.deepEqual(order, ['first', 'second'], 'listener failure must be contained')

  // scope gating: scoped listener only receives matching carrier
  const scoped = []
  const global = []
  observeOn(state.pluginApi.events, 'session/event', (s, e) => scoped.push(e.kind), { scope: 'agent-1' })
  observeOn(state.pluginApi.events, 'session/event', (s, e) => global.push(e.kind))
  ctx.scopedEmit(scopeTarget({}, 'agent-2'), 'session/event', { id: 's2' }, { kind: 'other' })
  ctx.scopedEmit(scopeTarget({}, 'agent-1'), 'session/event', { id: 's1' }, { kind: 'mine' })
  assert.deepEqual(scoped, ['mine'], 'scoped listener must only see its carrier')
  assert.deepEqual(global, ['other', 'mine'])
})

test('agent slice gate: fault policies survive the unified bus', () => {
  const { ctx, state } = createFullCtx()
  apply(ctx)

  // agent/created: the projection entry contains the listener failure;
  // the observer still runs, but the throw never reaches the dispatch.
  observeOn(state.pluginApi.events, 'agent/created', () => {
    throw new Error('veto')
  })
  assert.doesNotThrow(() => ctx.scopedEmit(scopeTarget({}, 'agent-1'), 'agent/created', { agent: 'agent-1' }))

  // agent/disposed: contained
  const order = []
  observeOn(state.pluginApi.events, 'agent/disposed', () => {
    order.push('first')
    throw new Error('boom')
  })
  observeOn(state.pluginApi.events, 'agent/disposed', () => order.push('second'))
  assert.doesNotThrow(() => ctx.scopedEmit(scopeTarget({}, 'agent-1'), 'agent/disposed', { agent: 'agent-1' }))
  assert.deepEqual(order, ['first', 'second'])

  // agent/pre-step: waterfall dispatch with live agent/signal not deep-frozen;
  // the projection observer cannot rewrite the chain (monitor tier) but
  // observes the fully frozen payload.
  observeOn(state.pluginApi.events, 'agent/pre-step', (payload) => {
    assert.ok(!Object.isFrozen(payload.agent), 'live agent must not be frozen')
    assert.ok(!Object.isFrozen(payload.signal), 'live signal must not be frozen')
    assert.ok(Object.isFrozen(payload.messages), 'messages must be deep-frozen')
    return { kind: 'reject' }
  })
  const result = ctx.waterfall('agent/pre-step', {
    agent: { id: 'agent-1' },
    messages: [{ role: 'user' }],
    turn: 1,
    step: 1,
    signal: new AbortController().signal,
  }, () => ({ kind: 'continue' }))
  assert.deepEqual(result, { kind: 'continue' }, 'monitor-tier observers cannot rewrite the chain result')
})

test('system-prompt slice gate: assemble scope filtering uses args[1].scope', () => {
  const { ctx, state } = createFullCtx()
  apply(ctx)

  const seen = []
  observeOn(state.pluginApi.events, 'system-prompt/assemble', (assembly, context, next) => {
    seen.push(context.scope)
    return next()
  }, { scope: 'agent-1' })

  ctx.waterfall('system-prompt/assemble', { sections: [] }, { scope: 'agent-2' }, () => 'inner-2')
  ctx.waterfall('system-prompt/assemble', { sections: [] }, { scope: 'agent-1' }, () => 'inner-1')
  assert.deepEqual(seen, ['agent-1'], 'only matching scope must be delivered')
})

test('tools slice gate: tools/execute applies except-signal freezing through the mounted catalog', () => {
  const { ctx, state } = createFullCtx()
  apply(ctx)

  const replacement = new AbortController().signal
  let observed
  observeOn(state.pluginApi.events, 'tools/execute', (exec, next) => {
    observed = exec
    assert.equal(Object.getOwnPropertyDescriptor(exec, 'signal').writable, true, 'signal stays writable')
    assert.equal(Object.getOwnPropertyDescriptor(exec, 'name').writable, false, 'other fields hardened')
    assert.ok(Object.isFrozen(exec.token), 'nested payload frozen')
    exec.signal = replacement
    return next()
  })

  const exec = { signal: new AbortController().signal, agent: 'agent-1', token: { id: 1 }, name: 'run_code' }
  ctx.waterfall('tools/execute', exec, () => 'body')
  assert.equal(observed, exec)
  assert.equal(exec.signal, replacement, 'official signal-replacement contract preserved')
})

test('llm slice gate: llm/stream waterfall freezes options and passes the result through', () => {
  const { ctx, state } = createFullCtx()
  apply(ctx)

  const seen = []
  observeOn(state.pluginApi.events, 'llm/stream', (options, next) => {
    seen.push(options)
    return next()
  })
  const options = { provider: 'deepseek', model: 'chat', messages: [] }
  const result = ctx.waterfall('llm/stream', options, () => 'stream-result')
  assert.equal(result, 'stream-result')
  assert.equal(seen.length, 1)
  assert.ok(Object.isFrozen(seen[0]), 'llm/stream options must be deep-frozen')
})

test('settings slice gate: settings/updated dispatches with frozen args through the mounted catalog', () => {
  const { ctx, state } = createFullCtx()
  apply(ctx)

  const received = []
  observeOn(state.pluginApi.events, 'settings/updated', (ns, next, prev, source) => received.push([ns, source]))
  ctx.emit('settings/updated', { name: 'my-plugin' }, { a: 1 }, { a: 0 }, 'update')
  assert.equal(received.length, 1)
  assert.ok(Object.isFrozen(received[0][0]), 'ns argument must be deep-frozen')
  assert.deepEqual(received[0][1], 'update')
})

// ---------------------------------------------------------------------------
// 5.x replacement catalog (compaction-events)
// ---------------------------------------------------------------------------

const COMPACTION_EVENTS = [
  'compaction/request',
  'compaction/started',
  'compaction/completed',
  'compaction/failed',
  'compaction/skipped',
]

test('without the replacement row the public catalog does not list compaction/* events', () => {
  const { ctx, state } = createFullCtx()
  apply(ctx)
  assert.equal(Object.keys(state.pluginApi.events.catalog()).length, 47)
  for (const name of COMPACTION_EVENTS) {
    assert.ok(!(name in state.pluginApi.events.catalog()), `${name} must be hidden when the replacement is inactive`)
  }
})

test('with the replacement row active the public catalog lists all five compaction replacement events', () => {
  const { ctx, state } = createFullCtx({ withCompactionReplacement: true })
  apply(ctx)
  const catalog = state.pluginApi.events.catalog()
  assert.equal(Object.keys(catalog).length, 52)
  for (const name of COMPACTION_EVENTS) {
    const entry = catalog[name]
    assert.ok(entry, `${name} must be cataloged`)
    assert.equal(entry.feature, 'compaction-events')
    assert.ok(!('type' in entry), 'governance class letters must not leak into the catalog')
    assert.equal(entry.scopeFiltered, false)
    assert.equal(entry.scopeKey, null)
    assert.equal(entry.fault, 'contain')
    assert.ok(Object.isFrozen(entry), `${name} entry must be frozen`)
  }
  assert.equal(catalog['compaction/request'].mode, 'waterfall')
  assert.equal(catalog['compaction/completed'].mode, 'emit')
  assert.deepEqual(catalog['compaction/completed'].freeze, { deep: ['range', 'result'] })
})

test('compaction/request is wrapped through the facade even while the row is inactive (static metadata)', () => {
  const { ctx, state } = createFullCtx()
  apply(ctx)
  assert.ok(!('compaction/request' in state.pluginApi.events.catalog()))

  const bucket = []
  observeOn(state.pluginApi.events, 'compaction/request', (payload, next) => {
    bucket.push(payload)
    return next()
  })
  const payload = { agent: {}, session: {}, trigger: 'manual', range: { start: 1, end: 3 } }
  const result = ctx.waterfall('compaction/request', payload, () => 'done')
  assert.equal(result, 'done')
  assert.equal(bucket.length, 1, 'facade subscription must be wrapped even when the slice is inactive')
  assert.ok(Object.isFrozen(bucket[0]), 'request payload must be frozen by the facade freeze policy')
})
