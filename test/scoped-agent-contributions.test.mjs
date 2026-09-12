import test from 'node:test'
import assert from 'node:assert/strict'

import { createScopedAgentContributionRegistry } from '../lib/scoped-agent-contributions.js'

/**
 * Minimal official-shape mocks: the agents registry resolves live agents by
 * session id (each agent carries its own context); the target context
 * resolves the host-singleton services, and registrations through it are
 * the scoped-layer installs the module relies on.
 */
function createMockAgents() {
  const agents = new Map()
  const registrations = []
  const listeners = []
  const registry = {
    get(id) {
      return agents.get(id)
    },
    __installRecord(instance) {
      registrations.push(instance)
      return instance
    },
    __registrations: registrations,
    __listeners: listeners,
  }
  return { registry, agents, registrations, listeners }
}

function createTargetCtx({ services, listeners }) {
  const effects = []
  const ctx = {
    __effects: effects,
    get(name) {
      return services[name]
    },
    on(name, listener) {
      listeners.push({ name, listener, ctx })
      return () => {
        const index = listeners.findIndex((entry) => entry.listener === listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
    effect(fn) {
      effects.push(fn)
      return () => {}
    },
  }
  return ctx
}

function createSystemPromptSpy() {
  const calls = []
  const member = (name) => (...args) => {
    calls.push({ name, args, ctx: this })
    return () => calls.push({ name: `dispose:${name}` })
  }
  return {
    __calls: calls,
    section: member('section'),
    context: member('context'),
    variable: member('variable'),
    tools: member('tools'),
    suppressRuntimeContext: member('suppressRuntimeContext'),
  }
}

function createToolsSpy() {
  const calls = []
  const member = (name) => (...args) => {
    calls.push({ name, args })
    return () => calls.push({ name: `dispose:${name}` })
  }
  return {
    __calls: calls,
    register: member('register'),
    restrict: member('restrict'),
  }
}

function createHarness() {
  const mock = createMockAgents()
  const systemPrompt = createSystemPromptSpy()
  const tools = createToolsSpy()
  const diagnostics = []
  let agentA = null
  const registry = createScopedAgentContributionRegistry({
    active: () => true,
    agentsProvider: () => mock.registry,
    resolveOwnerId: (callerCtx) => callerCtx?.owner,
    reportDiagnostics: (message) => diagnostics.push(message),
  })
  const makeAgent = (id) => {
    const listeners = []
    const ctx = createTargetCtx({
      services: { systemPrompt, tools },
      listeners,
    })
    const agent = { id, ctx }
    mock.agents.set(id, agent)
    return { agent, ctx, listeners }
  }
  agentA = makeAgent('agent-a')
  const callerCtx = (owner = 'plugin-a') => {
    const effects = []
    return {
      owner,
      effect(fn) {
        effects.push(fn)
      },
      teardown() {
        for (const fn of effects.splice(0)) fn()()
      },
    }
  }
  return { registry, mock, systemPrompt, tools, diagnostics, agentA, makeAgent, callerCtx }
}

test('scope handle carries the fixed shape plus the recorded target/status extensions', () => {
  const { registry, callerCtx } = createHarness()
  const outcome = registry.registerScope({ agent: 'agent-a' }, callerCtx())
  assert.equal(outcome.ok, true)
  assert.equal(outcome.code, 'registered')
  const handle = outcome.handle
  assert.deepEqual(Object.keys(handle).sort(), ['dispose', 'generation', 'id', 'ownerId', 'status', 'target'])
  assert.equal(handle.ownerId, 'plugin-a')
  assert.equal(handle.target.id, 'agent-a')
  assert.equal(handle.status().status, 'usable')
  assert.ok(Object.isFrozen(handle))
  assert.ok(Object.isFrozen(handle.target))
})

test('unresolvable targets are typed unavailable without global fallback', () => {
  const { registry, callerCtx } = createHarness()
  const missing = registry.registerScope({ agent: 'nope' }, callerCtx())
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'unavailable')
  assert.match(missing.reason, /cannot be resolved/)
  const malformed = registry.registerScope({ agent: 42 }, callerCtx())
  assert.equal(malformed.code, 'invalid-input')
  const ownerless = registry.registerScope({ agent: 'agent-a' }, { owner: undefined })
  assert.equal(ownerless.code, 'unavailable')
})

test('status() reports usable and destroyed without resurrecting the target', () => {
  const { registry, callerCtx, mock } = createHarness()
  const handle = registry.registerScope({ agent: 'agent-a' }, callerCtx()).handle
  assert.equal(handle.status().status, 'usable')
  mock.agents.delete('agent-a')
  assert.equal(handle.status().status, 'destroyed')
  mock.agents.set('agent-a', { id: 'agent-a', ctx: {} })
  assert.equal(handle.status().status, 'usable')
})

test('scoped installation lands in the target context and conflicts per (owner, target, id)', () => {
  const { registry, callerCtx, systemPrompt } = createHarness()
  const handle = registry.registerScope({ agent: 'agent-a' }, callerCtx()).handle
  const first = registry.installScoped({
    ownerId: handle.ownerId,
    targetId: handle.target.id,
    handleId: handle.id,
    kind: 'prompts.section',
    contributionId: 'guide',
    install: (targetCtx) => Reflect.apply(targetCtx.get('systemPrompt').section, targetCtx.get('systemPrompt'), [{ id: 'guide', text: () => 'g' }]),
  }, callerCtx())
  assert.equal(first.ok, true)
  assert.equal(systemPrompt.__calls.length, 1)
  assert.equal(systemPrompt.__calls[0].name, 'section')

  const duplicate = registry.installScoped({
    ownerId: handle.ownerId,
    targetId: handle.target.id,
    handleId: handle.id,
    kind: 'prompts.section',
    contributionId: 'guide',
    install: () => () => {},
  }, callerCtx())
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.code, 'conflict')

  // same owner + id under a DIFFERENT target is an independent record
  const second = registry.installScoped({
    ownerId: handle.ownerId,
    targetId: 'agent-other',
    handleId: handle.id,
    kind: 'prompts.section',
    contributionId: 'guide',
    install: () => () => {},
  }, callerCtx())
  assert.equal(second.ok, false, 'the other target is not live, so the install is unavailable — not a conflict')
  assert.equal(second.code, 'unavailable')
})

test('record tokens are generation-scoped: a stale token never revokes a re-install', () => {
  const { registry, callerCtx } = createHarness()
  const handle = registry.registerScope({ agent: 'agent-a' }, callerCtx()).handle
  const install = () => () => {}
  const first = registry.installScoped({
    ownerId: handle.ownerId, targetId: 'agent-a', handleId: handle.id,
    kind: 'tools.register', contributionId: 'k', install,
  }, callerCtx())
  assert.equal(first.ok, true)
  assert.equal(registry.removeScoped(first.record, 'plugin-a').status, 'ok')

  // a new generation re-installs under the same key
  const second = registry.installScoped({
    ownerId: handle.ownerId, targetId: 'agent-a', handleId: handle.id,
    kind: 'tools.register', contributionId: 'k', install,
  }, callerCtx())
  assert.equal(second.ok, true)
  // the stale first-generation token is a typed no-op now
  assert.equal(registry.removeScoped(first.record, 'plugin-a').status, 'stale')
  assert.equal(registry.inspection().records, 1, 'new generation survives')
  assert.equal(registry.removeScoped(second.record, 'plugin-a').status, 'ok')
})

test('installing through a dead target is typed unavailable with no orphan state', () => {
  const { registry, callerCtx } = createHarness()
  const outcome = registry.installScoped({
    ownerId: 'plugin-a', targetId: 'ghost', handleId: 'scope:1',
    kind: 'tools.register', contributionId: 'k', install: () => () => {},
  }, callerCtx())
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'unavailable')
  assert.equal(registry.inspection().records, 0)
})

test('caller fiber teardown removes the owner-bound installation; missing effect rolls back', () => {
  const { registry, callerCtx, tools } = createHarness()
  const caller = callerCtx()
  const first = registry.installScoped({
    ownerId: 'plugin-a', targetId: 'agent-a', handleId: 'scope:1',
    kind: 'tools.register', contributionId: 'k1', install: (targetCtx) => targetCtx.get('tools').register({ name: 'k1' }),
  }, caller)
  assert.equal(first.ok, true)
  assert.equal(tools.__calls.at(-1).name, 'register')

  // owner unload: the bound effect removes the record and calls the official disposer
  caller.teardown()
  assert.equal(registry.inspection().records, 0)
  assert.equal(tools.__calls.at(-1).name, 'dispose:register')

  // a caller without an effect channel: install is rolled back, typed unavailable
  const noEffect = registry.installScoped({
    ownerId: 'plugin-a', targetId: 'agent-a', handleId: 'scope:1',
    kind: 'tools.register', contributionId: 'k2', install: (targetCtx) => targetCtx.get('tools').register({ name: 'k2' }),
  }, {})
  assert.equal(noEffect.ok, false)
  assert.equal(noEffect.code, 'unavailable')
  assert.equal(tools.__calls.at(-1).name, 'dispose:register', 'the speculative install was rolled back')
  assert.equal(registry.inspection().records, 0)
})

test('handle dispose removes only its own installations (identity-bound)', () => {
  const { registry, callerCtx } = createHarness()
  const handleA = registry.registerScope({ agent: 'agent-a' }, callerCtx('owner-a')).handle
  const handleB = registry.registerScope({ agent: 'agent-a' }, callerCtx('owner-b')).handle
  const install = () => () => {}
  registry.installScoped({
    ownerId: 'owner-a', targetId: 'agent-a', handleId: handleA.id,
    kind: 'prompts.variable', contributionId: 'v', install,
  }, callerCtx('owner-a'))
  registry.installScoped({
    ownerId: 'owner-b', targetId: 'agent-a', handleId: handleB.id,
    kind: 'prompts.variable', contributionId: 'v', install,
  }, callerCtx('owner-b'))
  assert.equal(registry.inspection().records, 2)

  assert.equal(handleA.dispose().status, 'ok')
  assert.equal(registry.inspection().records, 1, 'only handle A record removed')
  assert.equal(handleA.dispose().status, 'stale', 'dispose is idempotent via typed no-op')
})

test('resume re-announcement re-installs dormant records into the new agent context', () => {
  const { registry, callerCtx, mock, makeAgent } = createHarness()
  const handle = registry.registerScope({ agent: 'agent-a' }, callerCtx()).handle
  const installedCtxs = []
  registry.installScoped({
    ownerId: handle.ownerId, targetId: 'agent-a', handleId: handle.id,
    kind: 'prompts.section', contributionId: 'guide',
    install: (targetCtx) => {
      installedCtxs.push(targetCtx)
      return () => {}
    },
  }, callerCtx())
  assert.equal(installedCtxs.length, 1)

  // old instance retires; records go dormant
  registry.attachLifecycle((listener) => {
    mock.registry.__createdListener = listener
    return () => {}
  }, (listener) => {
    mock.registry.__disposedListener = listener
    return () => {}
  })
  mock.registry.__disposedListener(null, 'agent/disposed', { agent: { id: 'agent-a' } })
  assert.equal(registry.inspection().records, 1, 'records stay as resume bookkeeping')

  // same identity resumes as a NEW agent instance
  const resumed = makeAgent('agent-a')
  mock.registry.__createdListener(null, 'agent/created', { agent: resumed.agent })
  assert.equal(installedCtxs.length, 2)
  assert.equal(installedCtxs[1], resumed.ctx, 're-install targets the new instance context')
})

test('lifecycle listeners contain their own faults and never throw outward', () => {
  const { registry, callerCtx, mock, diagnostics, makeAgent } = createHarness()
  registry.registerScope({ agent: 'agent-a' }, callerCtx())
  let installCalls = 0
  registry.installScoped({
    ownerId: 'plugin-a', targetId: 'agent-a', handleId: 'scope:1',
    kind: 'prompts.section', contributionId: 'boom',
    install: () => {
      installCalls += 1
      if (installCalls > 1) throw new Error('re-install exploded')
      return () => {}
    },
  }, callerCtx())
  registry.attachLifecycle((onCreated) => {
    mock.registry.__createdListener = onCreated
    return () => {}
  }, () => () => {})
  const resumed = makeAgent('agent-a')
  assert.doesNotThrow(() => mock.registry.__createdListener(null, 'agent/created', { agent: resumed.agent }))
  assert.ok(diagnostics.some((message) => /re-install failed/.test(message)), 'failure is contained and reported')
  assert.equal(registry.inspection().records, 1)
})

test('snapshot cell exposes the per-step current/assembled pair with capture wiring', () => {
  const { registry, callerCtx, agentA } = createHarness()
  const handle = registry.registerScope({ agent: 'agent-a' }, callerCtx()).handle
  const cell = registry.snapshotCellOf(handle)
  assert.equal(cell.ok, true)
  assert.equal(cell.snapshot.current(), undefined)
  assert.equal(cell.snapshot.assembled(), undefined)

  // the writer (the interactive feature's future obligation; simulated here
  // through the registry writer seam) sets current; the capture listener
  // publishes it as the step's assembled value
  assert.equal(registry.writeSnapshotCurrent(handle, { provider: 'p', model: 'm' }).ok, true)
  assert.deepEqual(cell.snapshot.current(), { provider: 'p', model: 'm' })
  const capture = agentA.listeners.find((entry) => entry.name === 'system-prompt/assemble')
  assert.ok(capture, 'capture listener installed through the target context')
  // a step assembles: capture publishes current as assembled, chain forwarded
  const forwarded = capture.listener({ sections: [] }, { scope: agentA.agent }, () => 'assembled')
  assert.equal(forwarded, 'assembled', 'the capture listener forwards the official chain')
  assert.deepEqual(cell.snapshot.assembled(), { provider: 'p', model: 'm' })

  // switching the selection between steps: next step sees the new value,
  // the already-captured step keeps its value (reader holds the old object)
  const capturedValue = cell.snapshot.assembled()
  registry.writeSnapshotCurrent(handle, { provider: 'p2', model: 'm2' })
  assert.equal(cell.snapshot.assembled(), capturedValue, 'the in-flight step keeps its captured snapshot')
  capture.listener({ sections: [] }, { scope: agentA.agent }, () => 'next')
  assert.deepEqual(cell.snapshot.assembled(), { provider: 'p2', model: 'm2' })
})

test('stale scope handles cannot reach the snapshot cell', () => {
  const { registry, callerCtx } = createHarness()
  const handle = registry.registerScope({ agent: 'agent-a' }, callerCtx()).handle
  handle.dispose()
  const cell = registry.snapshotCellOf(handle)
  assert.equal(cell.ok, false)
  assert.equal(cell.code, 'unavailable')
})
