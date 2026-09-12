import test from 'node:test'
import assert from 'node:assert/strict'
import { createDecisionParticipationFeature, createDisabledDecisionProviders } from '../lib/decision-participation-facade.js'
import { createEventsBus } from '../lib/events-bus.js'
import { baseEventsCatalog } from '../lib/events-catalog.js'
import { composeCatalogs } from '../lib/catalog-compose.js'
import { agentEventsCatalog } from '../lib/agent-events-catalog.js'
import { toolsEventsCatalog } from '../lib/tools-events-catalog.js'
import { systemPromptEventsCatalog } from '../lib/system-prompt-events-catalog.js'
import { PluginApiFeatureDisabledError } from '../lib/errors.js'

const coreCatalog = composeCatalogs(
  baseEventsCatalog,
  agentEventsCatalog,
  toolsEventsCatalog,
  systemPromptEventsCatalog,
)

function createLogger(warns = []) {
  return { warn: (message) => warns.push(String(message)), error: () => {} }
}

function createMockCordisCtx() {
  const hooks = new Map()
  const hooksOf = (name) => {
    let list = hooks.get(name)
    if (!list) {
      list = []
      hooks.set(name, list)
    }
    return list
  }
  return {
    hooks,
    hooksOf,
    loader: { entries: () => [] },
    on(name, listener) {
      const list = hooksOf(name)
      list.push(listener)
      let removed = false
      return () => {
        if (removed) return false
        removed = true
        const index = list.indexOf(listener)
        if (index >= 0) {
          list.splice(index, 1)
          return true
        }
        return false
      }
    },
    waterfall(name, ...args) {
      // Cordis waterfall hooks receive the payload args plus the trailing
      // continuation — the event name selects the hook list, never the args.
      const callArgs = [...args]
      const callbacks = hooksOf(name).slice()
      const inner = callArgs.pop()
      const next = () => (callbacks.shift() ?? inner)(...callArgs)
      callArgs.push(next)
      return next()
    },
  }
}

const FACADE_CONTRACT = { runtime: '0.1.0-rc.6', api: '0.1' }

function createFeature({ aux = {}, catalog = coreCatalog, ctx } = {}) {
  const warns = []
  const cordisCtx = ctx ?? createMockCordisCtx()
  const bus = createEventsBus({ ctx: cordisCtx, catalog, logger: createLogger(warns) })
  const feature = createDecisionParticipationFeature({
    ctx: cordisCtx,
    eventsBus: bus,
    logger: createLogger(warns),
    facadeContract: FACADE_CONTRACT,
    auxiliaryManifests: aux,
  })
  return { cordisCtx, bus, feature, warns }
}

test('facade: agents.decisions registers at the official pre-step waterfall and the decision governs', () => {
  const { cordisCtx, bus, feature } = createFeature()
  const member = feature.providers.agents({})
  const handle = member.register({ point: 'pre-step', id: 'gate', decide: (context) => ({ kind: 'reject', reason: 'no entry' }) })
  assert.equal(handle.ownerId, 'root', 'untraceable callers fall back to the root owner token')
  assert.ok(handle.generation)
  const outcome = cordisCtx.waterfall('agent/pre-step', { agent: {}, messages: [], turn: 1, step: 0 }, () => ({
    kind: 'enter',
    messages: ['default'],
  }))
  assert.deepEqual(outcome, { kind: 'reject', reason: 'no entry' })
  handle.dispose()
  const after = cordisCtx.waterfall('agent/pre-step', { agent: {}, messages: [], turn: 1, step: 0 }, () => ({
    kind: 'enter',
    messages: ['default'],
  }))
  assert.deepEqual(after, { kind: 'enter', messages: ['default'] })
  assert.ok(bus)
})

test('facade: the decide context carries the payload plus the next continuation', () => {
  const { cordisCtx, feature } = createFeature()
  const member = feature.providers.agents({})
  let seen = null
  member.register({ point: 'pre-step', id: 'observer', decide: (context) => {
    seen = context
    return undefined
  } })
  cordisCtx.waterfall('agent/pre-step', { agent: { id: 'a' }, messages: [], turn: 2, step: 1, signal: null }, () => ({
    kind: 'enter',
    messages: [],
  }))
  assert.equal(seen.agent.id, 'a')
  assert.equal(seen.turn, 2)
  assert.equal(typeof seen.next, 'function', 'the continuation is reachable through the context')
})

test('facade: same-owner latest-wins and cross-owner conflict on the public member', () => {
  const { feature } = createFeature()
  const member = feature.providers.agents({})
  const first = member.register({ point: 'request', id: 'p', decide: () => undefined })
  const second = member.register({ point: 'request', id: 'p', decide: () => ({ provider: 'x', model: 'y' }) })
  assert.equal(first.dispose(), false)
  assert.notEqual(first.generation, second.generation)
})

test('facade: unsupported points are typed rejections that install nothing', () => {
  const { cordisCtx, feature } = createFeature()
  const agents = feature.providers.agents({})
  const hooksBefore = cordisCtx.hooksOf('agent/pre-step').length
  assert.equal(agents.register({ point: 'created', id: 'x', decide: () => undefined }).code, 'unsupported')
  assert.equal(agents.register({ point: 'nonsense', id: 'x', decide: () => undefined }).code, 'unsupported')
  const events = feature.providers.events({})
  assert.equal(events.register('llm/stream', { id: 'x', decide: () => undefined }).code, 'unsupported', 'llm/stream is carried by decoration + requestTransforms')
  assert.equal(events.register('agent/created', { id: 'x', decide: () => undefined }).code, 'unsupported', 'fact events are never admitted')
  assert.equal(events.register('fs/write-intent-nonsense', { id: 'x', decide: () => undefined }).code, 'unsupported')
  assert.equal(cordisCtx.hooksOf('agent/pre-step').length, hooksBefore, 'no listener was installed by rejected registrations')
})

test('facade: events.decisions admits the enumerated fs intent points and the deny governs', () => {
  const { cordisCtx, feature } = createFeature()
  const member = feature.providers.events({})
  assert.deepEqual(member.admitted(), ['fs/write-intent', 'fs/edit-intent', 'compaction/request', 'session-title/candidate'])
  const handle = member.register('fs/write-intent', { id: 'capture', decide: () => ({ kind: 'deny', reason: 'snapshot first' }) })
  assert.ok(handle.generation)
  assert.throws(
    () => cordisCtx.waterfall('fs/write-intent', { targetKey: 'k', displayPath: 'p' }, { signal: null }, () => undefined),
    (error) => error.message.includes('snapshot first'),
  )
})

test('facade: fs intent barrier settles all policies before the producer continues', async () => {
  const { cordisCtx, feature } = createFeature()
  const member = feature.providers.events({})
  const order = []
  member.register('fs/write-intent', { id: 'slow', decide: async (context) => {
    order.push('capture-start')
    await new Promise((resolve) => setTimeout(resolve, 5))
    order.push('capture-done')
    return undefined
  } })
  const outcome = await cordisCtx.waterfall('fs/write-intent', { targetKey: 'k', displayPath: 'p' }, { signal: null }, () => {
    order.push('write-applied')
    return 'intent'
  })
  assert.deepEqual(order, ['capture-start', 'capture-done', 'write-applied'])
  assert.equal(outcome, 'intent')
})

test('facade: availability gating reports degraded while the replacement row is absent', () => {
  const { feature } = createFeature()
  const agents = feature.providers.agents({})
  const availability = agents.availability()
  assert.equal(availability.status, 'degraded', 'turn-stopping backing (replacement row) is absent in this environment')
  const result = agents.register({ point: 'turn-stopping', id: 'p', decide: () => undefined })
  assert.equal(result.code, 'unavailable')
  assert.match(result.reason, /agent-loop replacement row/)
})

test('facade: turn-stopping registration is typed unavailable but other points stay active', () => {
  const { cordisCtx, feature } = createFeature()
  const agents = feature.providers.agents({})
  const unavailable = agents.register({ point: 'turn-stopping', id: 'p', decide: () => undefined })
  assert.equal(unavailable.code, 'unavailable')
  const active = agents.register({ point: 'request-error', id: 'retry', decide: () => ({ kind: 'retry' }) })
  assert.ok(active.generation)
  const outcome = cordisCtx.waterfall('agent/request-error', { agent: {}, turn: 1, step: 0, provider: 'p', failure: {}, retryPolicy: null, signal: null }, () => undefined)
  assert.deepEqual(outcome, { kind: 'retry' })
})

test('facade: the turn-stopping contract is exposed with a version for the replacement slice', () => {
  const { feature } = createFeature()
  assert.equal(typeof feature.contract.symbol, 'symbol')
  assert.equal(feature.contract.contractVersion, 1)
  const decision = feature.turnStoppingChain.invoke
  assert.equal(typeof decision, 'function')
})

test('facade: post-execute rewrite and block reach the producing stage', () => {
  const { cordisCtx, feature } = createFeature()
  const member = feature.providers.tools({})
  member.register({ point: 'post-execute', id: 'gate', decide: (context) => {
    assert.equal(context.exec.name, 'demo')
    assert.ok(context.result)
    assert.equal(typeof context.next, 'function')
    return { kind: 'accept', content: [{ type: 'text', text: 'rewritten' }] }
  } })
  const decision = cordisCtx.waterfall('tools/post-execute', { name: 'demo', agent: {} }, { value: 'original' }, () => ({ kind: 'accept' }))
  assert.deepEqual(decision, { kind: 'accept', content: [{ type: 'text', text: 'rewritten' }] })
})

test('facade: assembly policies receive the merged assembly and can replace it wholly', () => {
  const { cordisCtx, feature } = createFeature()
  const member = feature.providers.prompts({})
  member.register({ id: 'anchor', decide: (assembly, context, next) => {
    assert.ok(Array.isArray(assembly.sections))
    assert.equal(typeof next, 'function')
    return { sections: [{ name: 'anchor', text: 'replaced' }], contexts: [], tools: [], variables: {} }
  } })
  const outcome = cordisCtx.waterfall('system-prompt/assemble', { sections: [{ name: 'base', text: 'x' }], contexts: [], tools: [], variables: {} }, { scope: null }, () => 'default-assembly')
  assert.deepEqual(outcome, { sections: [{ name: 'anchor', text: 'replaced' }], contexts: [], tools: [], variables: {} })
})

test('facade: disabled providers keep the member shape with typed disabled errors', () => {
  const providers = createDisabledDecisionProviders()
  const member = providers.agents({})
  assert.throws(() => member.register({ point: 'pre-step', id: 'x', decide: () => undefined }), PluginApiFeatureDisabledError)
  assert.equal(member.availability().status, 'unavailable')
  const eventsMember = providers.events({})
  assert.throws(() => eventsMember.register('fs/write-intent', { id: 'x', decide: () => undefined }), PluginApiFeatureDisabledError)
})

test('facade: the feature disposer removes every registry entry and stops the chain', () => {
  const { cordisCtx, bus, feature } = createFeature()
  const member = feature.providers.agents({})
  member.register({ point: 'pre-step', id: 'gate', decide: () => ({ kind: 'reject', reason: 'blocked' }) })
  feature.disposer()
  const outcome = cordisCtx.waterfall('agent/pre-step', { agent: {}, messages: [], turn: 1, step: 0 }, () => ({
    kind: 'enter',
    messages: ['default'],
  }))
  assert.deepEqual(outcome, { kind: 'enter', messages: ['default'] })
  assert.equal(bus.hooksOf ? true : true, true)
})
