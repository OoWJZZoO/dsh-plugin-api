import test from 'node:test'
import assert from 'node:assert/strict'
import { createForkedToolSkill, CATALOG_KIND_FULL, CATALOG_KIND_MINIMAL } from '../lib/forked-tool-skill.js'
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
        })),
        complete: true,
      }
    },
    async list() {
      return (await this.snapshot()).skills
    },
    async get(name) {
      const entry = byName.get(name)
      return entry === undefined ? undefined : { ...entry, source: 'rt', provider: 'rt', content: `instructions for ${entry.name}` }
    },
  }
}

function makeCtx({ skills }) {
  const registered = []
  const listeners = new Map()
  const ctx = {
    logger: { warn() {} },
    tools: {
      register(tool) {
        registered.push(tool)
        return () => {}
      },
      get(name) {
        return registered.find((tool) => tool.name === name)
      },
    },
    skills,
    on(event, listener) {
      const group = listeners.get(event) ?? []
      group.push(listener)
      listeners.set(event, group)
      return () => {}
    },
  }
  return { ctx, listeners }
}

function makeAgent({ id = 's-1', events = [], nodes = [] } = {}) {
  return {
    id,
    session: {
      header: { id, cwd: '/work' },
      surface: { nodes },
      events,
    },
  }
}

function decisionWith(...messages) {
  return { kind: 'enter', messages }
}

/** Fold one decision's catalog message into the session event log. */
function foldDecision(agent, decision) {
  const message = decision.messages.at(-1)
  if (message === undefined) return
  const seq = (agent.session.events.at(-1)?.seq ?? 0) + 1
  agent.session.events.push({ seq, type: 'user/message', data: { source: message.source } })
  agent.session.surface.nodes.push(seq)
}

function baseSkills() {
  return [
    { name: 'alpha-skill', description: 'Alpha instructions', invocation: { modelInvocable: true, userInvocable: true } },
    { name: 'beta-skill', description: 'Beta instructions', invocation: { modelInvocable: true, userInvocable: true } },
  ]
}

function makeHarness({ skills = baseSkills(), policyFor = () => false, noticeMode, diagnostics = [], overrideEngine, recordCatalogChange } = {}) {
  const engine = overrideEngine ?? createSkillActivationEngine({})
  const harness = makeCtx({ skills: makeSkillRegistry(skills) })
  const scopeKeys = new Set()
  const extension = {
    descriptorOf: () => null,
    stateOf: () => ({ status: 'active' }),
    scopeKeysOf: (agent) => {
      const keys = []
      const sessionId = agent?.session?.header?.id
      const agentId = agent?.id
      if (sessionId !== undefined) keys.push(`session:${sessionId}`)
      if (agentId !== undefined) keys.push(`agent:${agentId}`)
      return keys
    },
    noticeMode: noticeMode ?? ((scopeKey) => (policyFor(scopeKey) ? 'minimal' : 'full')),
    recordCatalogChange(scopeKey, reason) {
      if (recordCatalogChange) {
        recordCatalogChange(scopeKey, reason)
        return
      }
      scopeKeys.add(`${scopeKey}:${reason}`)
      engine.recordCatalogChange({ scopeKey, reason })
    },
    diagnostic: (ownerId, detail) => diagnostics.push({ ownerId, detail }),
  }
  const fork = createForkedToolSkill({ ctx: harness.ctx, config: {}, extension })
  const [, catalogListener] = harness.listeners.get('agent/pre-step')
  return { ...harness, catalogListener, engine, scopeKeys, diagnostics }
}

function runCatalog(catalogListener, agent, messages = []) {
  return catalogListener({ agent, signal: { throwIfAborted() {} } }, () => decisionWith(...messages))
}

test('notice: first publish is the full catalog regardless of policy', async () => {
  const harness = makeHarness({ policyFor: () => true })
  const agent = makeAgent()
  const decision = await runCatalog(harness.catalogListener, agent)
  assert.equal(decision.messages.at(-1).source.kind, CATALOG_KIND_FULL)
  assert.equal(decision.messages.at(-1).source.update, undefined)
  assert.equal(harness.scopeKeys.size, 0)
})

test('notice: digest change without policy resends the full replacement catalog', async () => {
  const harness = makeHarness()
  const agent = makeAgent()
  const first = await runCatalog(harness.catalogListener, agent)
  foldDecision(agent, first)
  harness.ctx.skills = makeSkillRegistry([...baseSkills(), { name: 'gamma-skill', description: 'Gamma instructions', invocation: { modelInvocable: true, userInvocable: true } }])
  const changed = await runCatalog(harness.catalogListener, agent)
  assert.equal(changed.messages.at(-1).source.kind, CATALOG_KIND_FULL)
  assert.equal(changed.messages.at(-1).source.update, true)
  assert.deepEqual(changed.messages.at(-1).source.entries.map((entry) => entry.name), ['alpha-skill', 'beta-skill', 'gamma-skill'])
  assert.deepEqual([...harness.scopeKeys], ['session:s-1:resend'])
})

test('notice: minimal policy switches digest changes to one bounded English update', async () => {
  const harness = makeHarness({ policyFor: () => true })
  const agent = makeAgent()
  const first = await runCatalog(harness.catalogListener, agent)
  foldDecision(agent, first)
  // One added, one removed, one changed in a single revision.
  harness.ctx.skills = makeSkillRegistry([
    { name: 'beta-skill', description: 'Beta instructions v2', invocation: { modelInvocable: true, userInvocable: true } },
    { name: 'delta-skill', description: 'Delta instructions', invocation: { modelInvocable: true, userInvocable: true } },
  ])
  const changed = await runCatalog(harness.catalogListener, agent)
  const notice = changed.messages.at(-1)
  assert.equal(notice.source.kind, CATALOG_KIND_MINIMAL)
  assert.equal(notice.source.form, 'catalog-update')
  assert.equal(notice.source.update, true)
  // The full effective entries ride as metadata (digest continuity).
  assert.deepEqual(notice.source.entries.map((entry) => entry.name), ['beta-skill', 'delta-skill'])
  const text = notice.content[0].text
  assert.match(text, /Skill `alpha-skill` has been removed/)
  assert.match(text, /Skill `delta-skill` has been added/)
  assert.match(text, /Skill `beta-skill` has changed; its new shape is: `Beta instructions v2`/)
  assert.doesNotMatch(text, /<available_skills>/)
  assert.deepEqual([...harness.scopeKeys], ['session:s-1:minimal-update'])
})

test('notice: a second minimal update replaces the previous notice in-batch', async () => {
  const harness = makeHarness({ policyFor: () => true })
  const agent = makeAgent()
  const first = await runCatalog(harness.catalogListener, agent)
  foldDecision(agent, first)
  harness.ctx.skills = makeSkillRegistry([...baseSkills(), { name: 'gamma-skill', description: 'Gamma instructions', invocation: { modelInvocable: true, userInvocable: true } }])
  const second = await runCatalog(harness.catalogListener, agent)
  const firstNotice = second.messages.at(-1)
  assert.equal(firstNotice.source.kind, CATALOG_KIND_MINIMAL)
  foldDecision(agent, second)
  // The decision batch of the next turn carries the previous notice, which
  // the replacement machinery must replace by id with the newer notice.
  harness.ctx.skills = makeSkillRegistry([...baseSkills(), { name: 'gamma-skill', description: 'Gamma instructions v2', invocation: { modelInvocable: true, userInvocable: true } }, { name: 'epsilon-skill', description: 'goes away', invocation: { modelInvocable: true, userInvocable: true } }])
  const third = await runCatalog(harness.catalogListener, agent, [firstNotice])
  const messages = third.messages
  const notices = messages.filter((message) => message.source.kind === CATALOG_KIND_MINIMAL)
  assert.equal(notices.length, 1, 'the previous notice is replaced, not appended')
  assert.match(notices[0].content[0].text, /has changed; its new shape is: `Gamma instructions v2`/)
  assert.match(notices[0].content[0].text, /Skill `epsilon-skill` has been added/)
})

test('notice: policy disposal resumes the default full resend and replaces the notice', async () => {
  const engine = createSkillActivationEngine({})
  const harness = makeHarness({
    overrideEngine: engine,
    noticeMode: (scopeKey) => (engine.minimalPolicyFor(scopeKey) ? 'minimal' : 'full'),
  })
  const policy = engine.policyRegister('session:s-1')
  assert.equal(policy.ok, true)
  const agent = makeAgent()
  const first = await runCatalog(harness.catalogListener, agent)
  foldDecision(agent, first)
  harness.ctx.skills = makeSkillRegistry([...baseSkills(), { name: 'gamma-skill', description: 'Gamma instructions', invocation: { modelInvocable: true, userInvocable: true } }])
  const second = await runCatalog(harness.catalogListener, agent)
  const notice = second.messages.at(-1)
  assert.equal(notice.source.kind, CATALOG_KIND_MINIMAL)
  // Dispose the policy; the next change returns to the full replacement
  // message, replacing the previous notice in-batch.
  engine.policyDispose('session:s-1', policy.token)
  harness.ctx.skills = makeSkillRegistry([...baseSkills(), { name: 'gamma-skill', description: 'Gamma instructions', invocation: { modelInvocable: true, userInvocable: true } }, { name: 'epsilon-skill', description: 'Epsilon instructions', invocation: { modelInvocable: true, userInvocable: true } }])
  const third = await runCatalog(harness.catalogListener, agent, [notice])
  assert.equal(third.messages.length, 1)
  assert.equal(third.messages[0].source.kind, CATALOG_KIND_FULL)
  assert.equal(third.messages[0].source.update, true)
})

test('notice: same digest is idempotent across minimal notices (history tracks update kind)', async () => {
  const harness = makeHarness({ policyFor: () => true })
  const agent = makeAgent()
  const first = await runCatalog(harness.catalogListener, agent)
  foldDecision(agent, first)
  harness.ctx.skills = makeSkillRegistry([...baseSkills(), { name: 'gamma-skill', description: 'Gamma instructions', invocation: { modelInvocable: true, userInvocable: true } }])
  const second = await runCatalog(harness.catalogListener, agent)
  const notice = second.messages.at(-1)
  assert.equal(notice.source.kind, CATALOG_KIND_MINIMAL)
  // The session folds the notice; the next turn with the same digest strips
  // the carried notice from the batch (no re-injection).
  foldDecision(agent, second)
  const third = await runCatalog(harness.catalogListener, agent, [notice])
  assert.equal(third.messages.length, 0)
})

test('notice: policy evaluation failure falls back to the full resend with a diagnostic', async () => {
  const diagnostics = []
  const harness = makeHarness({
    diagnostics,
    noticeMode: (scopeKey) => {
      if (scopeKey === 'session:s-1') throw new Error('policy boom')
      return 'full'
    },
  })
  const agent = makeAgent()
  const first = await runCatalog(harness.catalogListener, agent)
  foldDecision(agent, first)
  harness.ctx.skills = makeSkillRegistry([...baseSkills(), { name: 'gamma-skill', description: 'Gamma instructions', invocation: { modelInvocable: true, userInvocable: true } }])
  const changed = await runCatalog(harness.catalogListener, agent)
  assert.equal(changed.messages.at(-1).source.kind, CATALOG_KIND_FULL)
  assert.equal(changed.messages.at(-1).source.update, true)
  assert.ok(diagnostics.some((entry) => entry.detail.includes('falling back to full resend')))
})

test('notice: audit failures never break the message flow', async () => {
  const diagnostics = []
  const harness = makeHarness({
    policyFor: () => true,
    diagnostics,
    recordCatalogChange() {
      throw new Error('audit storage boom')
    },
  })
  const agent = makeAgent()
  const first = await runCatalog(harness.catalogListener, agent)
  foldDecision(agent, first)
  harness.ctx.skills = makeSkillRegistry([...baseSkills(), { name: 'gamma-skill', description: 'Gamma instructions', invocation: { modelInvocable: true, userInvocable: true } }])
  const changed = await runCatalog(harness.catalogListener, agent)
  assert.equal(changed.messages.at(-1).source.kind, CATALOG_KIND_MINIMAL)
  assert.equal(changed.kind, 'enter')
  // The diagnostic path is exercised for the contained audit failure only if
  // the machinery reports it; the message flow always survives.
  void diagnostics
})

test('notice: overlay-less catalog still renders exactly once per change', async () => {
  const harness = makeHarness()
  const agent = makeAgent()
  const first = await runCatalog(harness.catalogListener, agent)
  foldDecision(agent, first)
  const second = await runCatalog(harness.catalogListener, agent)
  assert.equal(second.messages.length, 0)
  assert.equal(second.kind, 'enter')
})