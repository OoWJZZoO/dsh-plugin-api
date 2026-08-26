import test from 'node:test'
import assert from 'node:assert/strict'
import { apply as officialApply } from '@deepseek-ai/dsh-tool-skill'
import { createForkedToolSkill, SKILL_LOAD_DENIED } from '../lib/forked-tool-skill.js'
import { createSkillActivationEngine } from '../lib/skill-activation-engine.js'

function makeSkillRegistry(entries) {
  const byName = new Map(entries.map((entry) => [entry.name, entry]))
  return {
    register() { return () => {} },
    async snapshot() {
      return {
        skills: [...byName.values()].map((entry) => ({
          name: entry.name,
          description: entry.description,
          invocation: entry.invocation,
          source: 'rt',
          provider: 'rt',
          ...(entry.resourceBase === undefined ? {} : { resourceBase: entry.resourceBase }),
        })),
        complete: true,
      }
    },
    async list() {
      return (await this.snapshot()).skills
    },
    async get(name, lookup) {
      if (lookup?.signal) {
        try { lookup.signal.throwIfAborted() } catch { return undefined }
      }
      const entry = byName.get(name)
      if (entry === undefined) return undefined
      return {
        name: entry.name,
        description: entry.description,
        invocation: entry.invocation,
        source: 'rt',
        provider: 'rt',
        content: entry.content ?? 'instructions for ' + entry.name,
        ...(entry.resourceBase === undefined ? {} : { resourceBase: entry.resourceBase }),
      }
    },
  }
}

function makeCtx({ skills, toolsView }) {
  const registered = []
  const listeners = new Map()
  const ctx = {
    logger: { warn() {} },
    tools: {
      register(tool) {
        registered.push(tool)
        return () => {}
      },
      get(name, scope) {
        if (toolsView && scope !== undefined) {
          const view = toolsView(scope)
          if (view === false) return undefined
        }
        return registered.find((tool) => tool.name === name)
      },
    },
    skills,
    on(event, listener) {
      const group = listeners.get(event) ?? []
      group.push(listener)
      listeners.set(event, group)
      return () => {
        const current = listeners.get(event) ?? []
        listeners.set(event, current.filter((item) => item !== listener))
      }
    },
  }
  return { ctx, registered, listeners }
}

function makeAgent({ id = 's-1', cwd = '/work', events = [], nodes = [] } = {}) {
  return {
    id,
    session: {
      header: { id, cwd },
      surface: { nodes },
      events,
    },
  }
}

function baseDecision(messages = []) {
  return { kind: 'enter', messages }
}

function userMessage(text, kind = 'user') {
  return {
    id: `msg-${Math.random()}`,
    role: 'user',
    source: { kind },
    content: [{ type: 'text', text }],
  }
}

/** Structural compare of decisions (strip random message ids). */
function stripIds(messages) {
  return messages.map((message) => {
    const { id, ...rest } = message
    return rest
  })
}

const SKILLS = [
  { name: 'alpha-skill', description: 'Alpha instructions', invocation: { modelInvocable: true, userInvocable: true } },
  { name: 'beta-skill', description: 'Beta instructions', invocation: { modelInvocable: true, userInvocable: true } },
  { name: 'locked-skill', description: 'Locked instructions', invocation: { modelInvocable: false, userInvocable: false } },
]

function runCatalogListener(listeners, agent, messages = []) {
  const [, catalogListener] = listeners.get('agent/pre-step')
  return catalogListener({ agent, signal: { throwIfAborted() {} } }, () => baseDecision(messages))
}

function runInjectionListener(listeners, agent, messages) {
  const [injectionListener] = listeners.get('agent/pre-step')
  return injectionListener({ agent, messages, signal: { throwIfAborted() {} } }, () => baseDecision([]))
}

test('parity: official apply and the null-extension fork produce identical surfaces', async () => {
  const officialCtx = makeCtx({ skills: makeSkillRegistry(SKILLS) })
  const forkCtx = makeCtx({ skills: makeSkillRegistry(SKILLS) })
  officialApply(officialCtx.ctx, {})
  createForkedToolSkill({ ctx: forkCtx.ctx, config: {} })

  const [officialTool] = officialCtx.registered
  const [forkTool] = forkCtx.registered
  for (const field of ['name', 'description', 'parameters', 'output.schema']) {
    const get = (value) => field.split('.').reduce((acc, key) => acc?.[key], value)
    assert.deepEqual(get(forkTool), get(officialTool), field)
  }
  assert.deepEqual(forkTool.output.render({ name: 'alpha-skill' }, { name: 'alpha-skill', provider: 'rt', content: 'x' }),
    officialTool.output.render({ name: 'alpha-skill' }, { name: 'alpha-skill', provider: 'rt', content: 'x' }))
  assert.deepEqual(forkTool.presentCall({ name: 'alpha-skill' }), officialTool.presentCall({ name: 'alpha-skill' }))

  // Execute parity: resolutions, error texts, and abort propagation.
  const exec = (agent = makeAgent()) => ({ agent, signal: { throwIfAborted() {} } })
  assert.deepEqual(await forkTool.execute({ name: 'alpha-skill' }, exec()), await officialTool.execute({ name: 'alpha-skill' }, exec()))
  await assert.rejects(forkTool.execute({ name: 'missing-skill' }, exec()), /unknown or no longer available/)
  await assert.rejects(officialTool.execute({ name: 'missing-skill' }, exec()), /unknown or no longer available/)
  await assert.rejects(forkTool.execute({ name: 'locked-skill' }, exec()), /not available for model invocation/)
  await assert.rejects(officialTool.execute({ name: 'locked-skill' }, exec()), /not available for model invocation/)
  await assert.rejects(forkTool.execute({ name: 'Bad Name' }, exec()), /invalid skill name/)
})

test('parity: catalog first publish, digest change and idempotent no-op', async () => {
  const officialCtx = makeCtx({ skills: makeSkillRegistry(SKILLS) })
  const forkCtx = makeCtx({ skills: makeSkillRegistry(SKILLS) })
  officialApply(officialCtx.ctx, {})
  const fork = createForkedToolSkill({ ctx: forkCtx.ctx, config: {} })
  assert.equal(fork.probes.skillToolRegistered, true)
  assert.equal(fork.probes.preStepListeners, 2)

  const agent = makeAgent()
  const officialFirst = await runCatalogListener(officialCtx.listeners, agent)
  const forkFirst = await runCatalogListener(forkCtx.listeners, agent)
  assert.deepEqual(stripIds(forkFirst.messages), stripIds(officialFirst.messages))
  const forkedMessage = forkFirst.messages.at(-1)
  assert.equal(forkedMessage.source.kind, 'skill-catalog')
  assert.equal(forkedMessage.source.update, undefined)
  // A real session folds the decision batch into its event log; mirror it so
  // the digest history is visible to the next turn on both sides.
  for (const [target, decision] of [[officialCtx, officialFirst], [forkCtx, forkFirst]]) {
    const message = decision.messages.at(-1)
    agent.session.events.push({ seq: target === officialCtx ? 1 : 2, type: 'user/message', data: { source: message.source } })
    agent.session.surface.nodes.push(target === officialCtx ? 1 : 2)
  }

  // Same digest: no change — a fresh batch gets no catalog injection (the
  // published message lives in the session history, exactly like official).
  const officialSame = await runCatalogListener(officialCtx.listeners, agent)
  const forkSame = await runCatalogListener(forkCtx.listeners, agent)
  assert.deepEqual(stripIds(forkSame.messages), stripIds(officialSame.messages))
  assert.equal(forkSame.messages.length, 0)

  // Skills change: replacement catalog with identical vocabulary.
  officialCtx.ctx.skills = makeSkillRegistry([...SKILLS, { name: 'gamma-skill', description: 'Gamma instructions', invocation: { modelInvocable: true, userInvocable: true } }])
  forkCtx.ctx.skills = makeSkillRegistry([...SKILLS, { name: 'gamma-skill', description: 'Gamma instructions', invocation: { modelInvocable: true, userInvocable: true } }])
  const officialChanged = await runCatalogListener(officialCtx.listeners, agent)
  const forkChanged = await runCatalogListener(forkCtx.listeners, agent)
  assert.deepEqual(stripIds(forkChanged.messages), stripIds(officialChanged.messages))
  assert.equal(forkChanged.messages.at(-1).source.update, true)
  const textOf = (decision) => decision.messages.at(-1).content[0].text
  assert.equal(textOf(forkChanged), textOf(officialChanged))
})

test('parity: user-invocation injection and digest history carry-over', async () => {
  const officialCtx = makeCtx({ skills: makeSkillRegistry(SKILLS) })
  const forkCtx = makeCtx({ skills: makeSkillRegistry(SKILLS) })
  officialApply(officialCtx.ctx, {})
  createForkedToolSkill({ ctx: forkCtx.ctx, config: {} })

  const agent = makeAgent()
  const request = [userMessage('please check /beta-skill for me', 'user')]
  const officialInjection = await runInjectionListener(officialCtx.listeners, agent, request)
  const forkInjection = await runInjectionListener(forkCtx.listeners, agent, request)
  assert.deepEqual(stripIds(forkInjection.messages), stripIds(officialInjection.messages))
  assert.equal(forkInjection.messages[0].source.kind, 'skill-invocation')
  assert.match(forkInjection.messages[0].content[0].text, /<skill_content name="beta-skill">/)

  // Non-invocable and unknown gestures are silently skipped on both sides.
  const locked = [userMessage('/locked-skill please')]
  assert.deepEqual(stripIds((await runInjectionListener(forkCtx.listeners, agent, locked)).messages), [])
  assert.deepEqual(stripIds((await runInjectionListener(officialCtx.listeners, agent, locked)).messages), [])
})

test('parity: session events history survives across turns (digest based)', async () => {
  const forkCtx = makeCtx({ skills: makeSkillRegistry(SKILLS) })
  createForkedToolSkill({ ctx: forkCtx.ctx, config: {} })
  const agent = makeAgent()
  const first = await runCatalogListener(forkCtx.listeners, agent)
  const catalogMessage = first.messages.at(-1)
  // The decision batch is folded into the session event log like a real session.
  agent.session.events.push({
    seq: 1,
    type: 'user/message',
    data: { source: catalogMessage.source },
  })
  agent.session.surface.nodes = [1]
  const again = await runCatalogListener(forkCtx.listeners, agent, [])
  assert.equal(again.messages.length, 0)
})

function buildExtension(engine, diagnostics = []) {
  return {
    descriptorOf: (skillId) => engine.descriptorOf(skillId),
    stateOf: (scopeKey, skillId) => {
      const state = engine.activationState(scopeKey, skillId)
      return { status: state.status, sourceKind: state.record?.sourceKind }
    },
    scopeKeysOf: (agent) => {
      const keys = []
      const sessionId = agent?.session?.header?.id
      const agentId = agent?.id
      if (sessionId !== undefined) keys.push(`session:${sessionId}`)
      if (agentId !== undefined) keys.push(`agent:${agentId}`)
      return keys
    },
    noticeMode: (scopeKey) => (engine.minimalPolicyFor(scopeKey) ? 'minimal' : 'full'),
    recordCatalogChange: (scopeKey, reason) => engine.recordCatalogChange({ scopeKey, reason }),
    diagnostic: (ownerId, detail) => diagnostics.push({ ownerId, detail }),
  }
}

function makeExtensionCtx({ skills = SKILLS, toolsView } = {}) {
  const engine = createSkillActivationEngine({})
  const diagnostics = []
  const harness = makeCtx({ skills: makeSkillRegistry(skills), toolsView })
  const fork = createForkedToolSkill({
    ctx: harness.ctx,
    config: {},
    extension: buildExtension(engine, diagnostics),
  })
  return { ...harness, engine, diagnostics, fork }
}

test('gate: catalog/load/injection follow activation state for descriptor-covered skills', async () => {
  const { ctx, listeners, engine, diagnostics, registered } = makeExtensionCtx()
  const descriptor = engine.registerDescriptor({
    skillId: 'alpha-skill', owner: 'plugin-a', summary: 'Alpha summary', sourceKind: 'userInvocable',
  })
  assert.equal(descriptor.ok, true)
  const agent = makeAgent()

  // Not active: excluded from catalog, load denied, injection skipped.
  let decision = await runCatalogListener(listeners, agent)
  assert.equal(decision.messages.at(-1).source.entries.find((entry) => entry.name === 'alpha-skill'), undefined)
  const exec = { agent, signal: { throwIfAborted() {} } }
  let tool = registered[0]
  await assert.rejects(tool.execute({ name: 'alpha-skill' }, exec), (error) => {
    assert.equal(error.code, SKILL_LOAD_DENIED)
    return true
  })
  let injection = await runInjectionListener(listeners, agent, [userMessage('/alpha-skill please')])
  assert.equal(injection.messages.length, 0)
  assert.ok(diagnostics.some((entry) => entry.detail.includes('alpha-skill')))

  // Active in the session: catalog includes, load allowed, injection proceeds.
  const activation = engine.activate({ skillId: 'alpha-skill', scope: { kind: 'session', key: 's-1' }, sourceKind: 'userInvocable' })
  assert.equal(activation.ok, true)
  decision = await runCatalogListener(listeners, agent)
  const entries = decision.messages.at(-1).source.entries
  assert.ok(entries.some((entry) => entry.name === 'alpha-skill'))
  const skill = await tool.execute({ name: 'alpha-skill' }, exec)
  assert.equal(skill.name, 'alpha-skill')
  assert.match(skill.content, /instructions/)
  injection = await runInjectionListener(listeners, agent, [userMessage('/alpha-skill please')])
  assert.equal(injection.messages.length, 1)
  assert.equal(injection.messages[0].source.name, 'alpha-skill')

  // Deactivated: all three paths revert immediately.
  engine.deactivate('alpha-skill', activation.generation)
  decision = await runCatalogListener(listeners, agent)
  assert.equal(decision.messages.at(-1).source.entries.find((entry) => entry.name === 'alpha-skill'), undefined)
  await assert.rejects(tool.execute({ name: 'alpha-skill' }, exec), (error) => error.code === SKILL_LOAD_DENIED)
  injection = await runInjectionListener(listeners, agent, [userMessage('/alpha-skill please')])
  assert.equal(injection.messages.length, 0)
})

test('gate: overlay-less skills keep official parity on all three paths', async () => {
  const { listeners, registered } = makeExtensionCtx()
  const agent = makeAgent()
  const decision = await runCatalogListener(listeners, agent)
  const entries = decision.messages.at(-1).source.entries.map((entry) => entry.name)
  assert.deepEqual(entries, ['alpha-skill', 'beta-skill', 'locked-skill'].filter((name) => name !== 'locked-skill'))
  const skill = await registered[0].execute({ name: 'alpha-skill' }, { agent, signal: { throwIfAborted() {} } })
  assert.equal(skill.name, 'alpha-skill')
  const injection = await runInjectionListener(listeners, agent, [userMessage('/beta-skill please')])
  assert.equal(injection.messages.length, 1)
})

test('gate: explicit-class skills only load through explicit activations and never inject', async () => {
  const { engine, listeners, registered, diagnostics } = makeExtensionCtx()
  engine.registerDescriptor({
    skillId: 'beta-skill', owner: 'plugin-b', summary: 'Beta summary', sourceKind: 'explicit',
  })
  const agent = makeAgent()
  const exec = { agent, signal: { throwIfAborted() {} } }
  // Non-explicit activation does not open the loading path.
  engine.activate({ skillId: 'beta-skill', scope: { kind: 'session', key: 's-1' }, sourceKind: 'userInvocable' })
  await assert.rejects(registered[0].execute({ name: 'beta-skill' }, exec), (error) => error.code === SKILL_LOAD_DENIED)
  // Explicit activation opens the loading path.
  engine.activate({ skillId: 'beta-skill', scope: { kind: 'session', key: 's-1' }, sourceKind: 'explicit' })
  const skill = await registered[0].execute({ name: 'beta-skill' }, exec)
  assert.equal(skill.name, 'beta-skill')
  // Pre-step injection is always skipped for explicit-only skills.
  const injection = await runInjectionListener(listeners, agent, [userMessage('/beta-skill please')])
  assert.equal(injection.messages.length, 0)
  assert.ok(diagnostics.some((entry) => entry.detail.includes('explicit-only')))
})

test('gate: TTL expiry excludes descriptor-covered skills; fail-closed on unresolved scope', async () => {
  const { engine, listeners, registered, diagnostics } = makeExtensionCtx()
  engine.registerDescriptor({
    skillId: 'alpha-skill', owner: 'plugin-a', summary: 'Alpha summary', sourceKind: 'userInvocable',
  })
  const result = engine.activate({ skillId: 'alpha-skill', scope: { kind: 'session', key: 's-1' }, sourceKind: 'userInvocable', ttl: 100 })
  assert.equal(result.ok, true)
  // TTL expiry is covered by the engine unit tests; here we assert the
  // fail-closed path with an unresolved scope (no session header id).
  const agent = { id: undefined, session: { header: { cwd: '/work' }, surface: { nodes: [] }, events: [] } }
  const decision = await runCatalogListener(listeners, agent)
  assert.ok(decision.messages.length >= 1)
  assert.equal(decision.messages.at(-1).source.entries.find((entry) => entry.name === 'alpha-skill'), undefined)
  await assert.rejects(registered[0].execute({ name: 'alpha-skill' }, { agent, signal: { throwIfAborted() {} } }), (error) => error.code === SKILL_LOAD_DENIED)
  assert.ok(diagnostics.some((entry) => entry.detail.includes('scope unresolved')))
})

test('gate: newer generation supersedes; gates follow current state only', async () => {
  const { engine, listeners } = makeExtensionCtx()
  engine.registerDescriptor({
    skillId: 'alpha-skill', owner: 'plugin-a', summary: 'Alpha summary', sourceKind: 'userInvocable',
  })
  const agent = makeAgent()
  const first = engine.activate({ skillId: 'alpha-skill', scope: { kind: 'session', key: 's-1' }, sourceKind: 'userInvocable' })
  engine.deactivate('alpha-skill', first.generation)
  const second = engine.activate({ skillId: 'alpha-skill', scope: { kind: 'session', key: 's-1' }, sourceKind: 'userInvocable' })
  assert.equal(second.ok, true)
  const decision = await runCatalogListener(listeners, agent)
  const entries = decision.messages.at(-1).source.entries
  assert.ok(entries.some((entry) => entry.name === 'alpha-skill'))
  // The superseded generation is not current anywhere.
  assert.equal(engine.activationState('session:s-1', 'alpha-skill').record.generation, second.generation)
})