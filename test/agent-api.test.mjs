import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

function createMockCtx() {
  const agentA = { id: 'agent-a' }
  const agentB = { id: 'agent-b' }
  const agents = {
    getCalls: [],
    listCalls: 0,
    rootsCalls: 0,
    get(id) {
      this.getCalls.push(id)
      return id === agentA.id ? agentA : id === agentB.id ? agentB : undefined
    },
    list() {
      this.listCalls += 1
      return [agentA, agentB]
    },
    roots() {
      this.rootsCalls += 1
      return [agentA]
    },
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
    on() { return () => {} },
    once() {},
    emit() {},
    serial() {},
    parallel() {},
    bail() {},
    waterfall() {},
  }
  return { ctx, state, agents, agentA, agentB }
}

test('pluginApi.agent.get returns the official registry value unchanged', () => {
  const { ctx, state, agents, agentA, agentB } = createMockCtx()
  apply(ctx)

  assert.equal(state.pluginApi.agent.get('agent-a'), agentA)
  assert.equal(state.pluginApi.agent.get('agent-b'), agentB)
  assert.equal(state.pluginApi.agent.get('missing'), undefined)
  assert.deepEqual(agents.getCalls, ['agent-a', 'agent-b', 'missing'])
})

test('pluginApi.agent.list and roots return fresh arrays and are not cached', () => {
  const { ctx, state, agents, agentA } = createMockCtx()
  apply(ctx)

  const list1 = state.pluginApi.agent.list()
  const list2 = state.pluginApi.agent.list()
  assert.notEqual(list1, list2, 'list() must return a fresh array each call')
  assert.equal(list1[0].id, 'agent-a')
  assert.equal(list2[1].id, 'agent-b')
  assert.equal(agents.listCalls, 2)

  const roots1 = state.pluginApi.agent.roots()
  const roots2 = state.pluginApi.agent.roots()
  assert.notEqual(roots1, roots2, 'roots() must return a fresh array each call')
  assert.equal(roots1[0], agentA)
  assert.equal(agents.rootsCalls, 2)

  // Mutating a returned array must not affect later calls.
  roots1.length = 0
  assert.equal(state.pluginApi.agent.roots().length, 1)
})
