import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

/**
 * Full-facade assembly test: the four participation members must exist on
 * their composed namespaces with the standard member shape, and a
 * registration through the public tree must govern a real dispatch.
 */
function createMockCtx() {
  const agents = {
    get() { return undefined },
    list() { return [] },
    roots() { return [] },
  }
  const services = {
    llm: { resolveModelInfo() {} },
    agents,
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: {
      registerSearchProvider() {},
      registerFetchProvider() {},
      search() {},
      fetch() {},
    },
  }
  const hooks = new Map()
  const hooksOf = (name) => {
    let list = hooks.get(name)
    if (!list) {
      list = []
      hooks.set(name, list)
    }
    return list
  }
  const state = { pluginApi: undefined }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: {
      provide(name, value) {
        if (name === 'pluginApi') state.pluginApi = value
      },
    },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      if (name in services) return services[name]
      return undefined
    },
    plugin(Class) {
      new Class(ctx)
    },
    effect() {},
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
    once() { return () => {} },
    emit() {},
    serial() {},
    parallel() {},
    bail() {},
    waterfall(name, ...args) {
      // Cordis waterfall: hooks receive the payload args plus the trailing
      // continuation; the event name selects the hook list.
      const callArgs = [...args]
      const callbacks = hooksOf(name).slice()
      const inner = callArgs.pop()
      const next = () => (callbacks.shift() ?? inner)(...callArgs)
      callArgs.push(next)
      return next()
    },
  }
  return { ctx, state, hooks, hooksOf, agents }
}

test('the four participation members exist on their composed namespaces', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)

  for (const [path, memberName] of [
    ['agents', 'decisions'],
    ['tools', 'executionPolicies'],
    ['prompts', 'assemblyPolicies'],
    ['events', 'decisions'],
  ]) {
    const namespace = state.pluginApi[path]
    const member = namespace?.[memberName]
    assert.equal(typeof member?.register, 'function', `${path}.${memberName}.register must exist`)
    assert.equal(typeof member?.availability, 'function', `${path}.${memberName}.availability must exist`)
    const availability = member.availability()
    assert.ok(availability && typeof availability.status === 'string', `${path}.${memberName}.availability() returns the frozen status vocabulary`)
  }
})

test('a registration through the public agents.decisions governs the official dispatch', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const handle = state.pluginApi.agents.decisions.register({
    point: 'pre-step',
    id: 'assembly-gate',
    decide: (context) => {
      assert.equal(context.turn, 3)
      assert.equal(typeof context.next, 'function')
      return { kind: 'reject', reason: 'held' }
    },
  })
  assert.ok(handle.generation)

  const outcome = ctx.waterfall('agent/pre-step', { agent: {}, messages: [], turn: 3, step: 0 }, () => ({
    kind: 'enter',
    messages: ['default'],
  }))
  assert.deepEqual(outcome, { kind: 'reject', reason: 'held' })
  handle.dispose()
})

test('events.decisions on the public tree rejects fact events and admits fs intents', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const member = state.pluginApi.events.decisions
  assert.equal(member.register('agent/created', { id: 'x', decide: () => undefined }).code, 'unsupported')
  assert.equal(member.register('tools/code-dispatch-log', { id: 'x', decide: () => undefined }).code, 'unsupported')
  const handle = member.register('fs/edit-intent', { id: 'capture', decide: () => undefined })
  assert.ok(handle.generation)
  handle.dispose()
})

test('the namespace member availability reports the turn-stopping backing honestly', () => {
  const { ctx, state } = createMockCtx()
  apply(ctx)

  const agents = state.pluginApi.agents.decisions
  const result = agents.register({ point: 'turn-stopping', id: 'p', decide: () => undefined })
  // The agent-loop replacement row is not installed in this assembly fixture:
  // the point reports typed unavailable while the other points stay usable.
  assert.equal(result.code, 'unavailable')
  assert.match(result.reason, /agent-loop/)
  const active = agents.register({ point: 'pre-step', id: 'q', decide: () => undefined })
  assert.ok(active.generation)
  active.dispose()
})
