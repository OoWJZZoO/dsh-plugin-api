import test from 'node:test'
import assert from 'node:assert/strict'
import { renderContextSections, renderContextSnapshot, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { deriveEventMessage } from '@deepseek-ai/dsh-session'
import { createAgentLoopApply } from '../lib/apply.js'
import {
  ASSEMBLED_CONTEXT_EVENT,
  EVIDENCE_ACTIVE_SYMBOL,
  buildAssembledEvidence,
  emitAssembledEvidence,
  interpolateSection,
  deriveMessageRanges,
} from '../lib/evidence-slice.js'
import {
  ROUTE_POLICY_ACTIVE_SYMBOL,
  ROUTE_POLICY_COMPONENT_SYMBOL,
} from '../lib/route-policy.js'

const VERSION = '0.1.0-rc.6-0.1.0'
const API = '0.1'

function hasContentLikeKeys(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  for (const key of Object.keys(value)) {
    if (key === 'content' || key === 'secret') return true
    if (hasContentLikeKeys(value[key], seen)) return true
  }
  return false
}

function eventOf(type, data, seq) {
  return { type, data, seq }
}

test('evidence vocabulary is neutral and the payload contract is identifiers-only', () => {
  assert.equal(ASSEMBLED_CONTEXT_EVENT, 'agent-loop/assembled-context')
  assert.equal(EVIDENCE_ACTIVE_SYMBOL.toString(), 'Symbol(dsh-plugin-api.agent-loop.assembled-evidence)')
})

test('buildAssembledEvidence emits a frozen identifiers-only payload', () => {
  const session = {
    id: 'session-1',
    surface: { nodes: [10, 11, 12] },
    events: [eventOf('user/message', { content: [{ type: 'text', text: 'hi' }] }, 10), eventOf('assistant/message', { message: { content: [{ type: 'text', text: 'ok' }] } }, 11), eventOf('tool/result', { message: { content: [{ type: 'text', text: 'r' }] } }, 12)],
    deriveEventMessage,
  }
  const payload = buildAssembledEvidence({
    assembly: { sections: [{ name: 'deployment:persona', text: 'You are deep.' }], contexts: [], tools: [], variables: {} },
    session,
    generation: 1,
    now: () => new Date('2026-08-26T10:00:00.000Z'),
  })
  assert.ok(Object.isFrozen(payload))
  assert.equal(payload.sessionId, 'session-1')
  assert.equal(payload.generation, 1)
  assert.deepEqual(payload.systemSections, [{ sectionKey: 'deployment:persona', sourceTags: [] }])
  assert.deepEqual(payload.messageRanges, [{ fromSeq: 10, toSeq: 12, count: 3 }])
  assert.deepEqual(payload.dropped, [])
  assert.equal(payload.observedAt, '2026-08-26T10:00:00.000Z')
  assert.equal(hasContentLikeKeys(payload), false)
})

test('rendering mirrors the official renderPrompt for sections and renderContextSections for contexts', () => {
  const assemblies = [
    { sections: [{ name: 'a', text: 'plain nothing' }, { name: 'b', text: 'has {{var}}' }], contexts: [], tools: [], variables: { var: 'value' } },
    { sections: [{ name: 'a', text: '' }, { name: 'b', text: 'non-empty' }], contexts: [], tools: [], variables: {} },
    { sections: [{ name: 'a', text: 'lone {{ stays literal' }], contexts: [], tools: [], variables: {} },
    { sections: [], contexts: [{ name: 'ctx-1', text: 'context value' }, { name: 'ctx-2', text: '' }], tools: [], variables: {} },
  ]
  for (const assembly of assemblies) {
    const session = { id: 's', surface: { nodes: [] }, events: [], deriveEventMessage }
    const payload = buildAssembledEvidence({ assembly, session, generation: 1 })
    const renderedSections = payload.systemSections
      .filter((entry) => renderedSectionOrder(assembly.sections, entry.sectionKey) >= 0)
      .map((entry) => interpolateSection(assembly.sections.find((s) => s.name === entry.sectionKey).text, assembly.variables))
    if (assembly.sections.length > 0) {
      assert.equal(renderedSections.join('\n\n'), renderPrompt(assembly), `renderPrompt parity for ${JSON.stringify(assembly.sections.map((s) => s.name))}`)
    }
    if (assembly.contexts.length > 0) {
      const body = payload.systemSections
        .filter((entry) => assembly.contexts.some((c) => c.name === entry.sectionKey))
        .map((entry) => interpolateSection(assembly.contexts.find((c) => c.name === entry.sectionKey).text, assembly.variables))
        .join('\n\n')
      const snapshot = renderContextSnapshot(assembly)
      const officialBody = renderContextSections(assembly).map((s) => s.text).join('\n\n')
      assert.equal(body, officialBody, 'context body parity')
      assert.equal(snapshot === '' ? body === '' : snapshot.endsWith(body), true, 'snapshot parity')
    }
  }
  // defensive unreachable state: the official renderer throws on an unknown
  // variable (the emission point sits after a successful render, so this
  // assembly can never reach the loop); the slice treats it as dropped.
  const defensive = buildAssembledEvidence({
    assembly: { sections: [{ name: 'a', text: '{{missing}}' }], contexts: [], tools: [], variables: {} },
    session: { id: 's', surface: { nodes: [] }, events: [], deriveEventMessage },
    generation: 1,
  })
  assert.equal(defensive.systemSections.length, 0)
  assert.deepEqual(defensive.dropped, [{ ref: 'a', reason: 'rendered-empty' }])
})

function renderedSectionOrder(sections, key) {
  return sections.findIndex((s) => s.name === key)
}

test('dropped refs are recorded for sections and contexts that render empty', () => {
  const session = { id: 's', surface: { nodes: [] }, events: [], deriveEventMessage }
  const payload = buildAssembledEvidence({
    assembly: {
      sections: [{ name: 'empty-text', text: '' }, { name: 'placeholder', text: '{{gone}}' }, { name: 'kept', text: 'real' }],
      contexts: [{ name: 'ctx-empty', text: '' }, { name: 'ctx-kept', text: 'value' }],
      tools: [],
      variables: {},
    },
    session,
    generation: 1,
  })
  assert.deepEqual(payload.systemSections.map((e) => e.sectionKey), ['kept', 'ctx-kept'])
  assert.deepEqual(payload.dropped.map((e) => e.ref), ['empty-text', 'placeholder', 'ctx-empty'])
  assert.ok(payload.dropped.every((entry) => entry.reason === 'rendered-empty'))
})

test('interpolateSection matches the official strict-variable semantics', () => {
  assert.equal(interpolateSection('a {{x}} b', { x: '1' }), 'a 1 b')
  assert.equal(interpolateSection('a {{x}} {{y}}', { x: '1', y: '2' }), 'a 1 2')
  assert.equal(interpolateSection('lone {{ literal', {}), 'lone {{ literal')
  assert.equal(interpolateSection('open {{x', { x: 'v' }), 'open {{x')
  assert.equal(interpolateSection('{{missing}}', {}), '')
  assert.equal(interpolateSection('{{undefined}}', { undefined: undefined }), '')
  assert.equal(interpolateSection('{{Bad Name}}', {}), '{{Bad Name}}')
  // substituted values are not scanned again
  assert.equal(interpolateSection('{{x}}', { x: 'has {{y}}' }), 'has {{y}}')
  // official renderPrompt agrees on the same inputs
  assert.equal(renderPrompt({ sections: [{ name: 'a', text: 'a {{x}} b' }, { name: 'b', text: 'lone {{ literal' }], contexts: [], tools: [], variables: { x: '1' } }), 'a 1 b\n\nlone {{ literal')
})

test('deriveMessageRanges follows the official per-node message projection rule', () => {
  const events = [
    eventOf('user/message', { content: [{ type: 'text', text: 'u' }] }, 1),
    eventOf('assistant/message', { message: { content: [] } }, 2), // empty assistant message -> null
    eventOf('assistant/message', { message: { content: [{ type: 'text', text: 'a' }] } }, 3),
    eventOf('tool/result', { message: { content: [{ type: 'text', text: 't' }] } }, 4),
    eventOf('tool/call', {}, 5), // not a message-producing event
    eventOf('user/message', { content: [{ type: 'text', text: 'u2' }] }, 7), // gap at seq 6
  ]
  const session = {
    id: 's',
    surface: { nodes: [1, 2, 3, 4, 5, 7] },
    events,
    deriveEventMessage,
  }
  const ranges = deriveMessageRanges(session)
  assert.deepEqual(ranges, [
    { fromSeq: 1, toSeq: 1, count: 1 },
    { fromSeq: 3, toSeq: 4, count: 2 },
    { fromSeq: 7, toSeq: 7, count: 1 },
  ])
  // parity with the official rule: same events projected per node
  const expecting = events.filter((event) => deriveEventMessage(event) !== null).map((event) => event.seq).sort((a, b) => a - b)
  assert.deepEqual(ranges.flatMap((r) => Array.from({ length: r.count }, (_, i) => r.fromSeq + i)), expecting)
  // unsorted surface input is normalized deterministically
  const shuffled = { ...session, surface: { nodes: [7, 3, 1] } }
  assert.deepEqual(deriveMessageRanges(shuffled), [
    { fromSeq: 1, toSeq: 1, count: 1 },
    { fromSeq: 3, toSeq: 3, count: 1 },
    { fromSeq: 7, toSeq: 7, count: 1 },
  ])
  assert.deepEqual(deriveMessageRanges({ id: 's' }), [])
})

test('emission is contained: a failing emitter or payload never throws and never reaches dispatch', () => {
  const session = { id: 's', surface: { nodes: [] }, events: [], deriveEventMessage }
  const assembly = { sections: [{ name: 'a', text: 'x' }], contexts: [], tools: [], variables: {} }
  const throwingCtx = { emit() { throw new Error('listener exploded') } }
  const result = emitAssembledEvidence({ loopCtx: throwingCtx, session, assembly, generation: 1 })
  assert.equal(result, null)
  // a payload that cannot be built never throws
  const broken = emitAssembledEvidence({ loopCtx: null, session: null, assembly: null, generation: 1 })
  assert.equal(broken, null)
  // a working emitter delivers exactly one frozen payload
  const emitted = []
  const goodCtx = { emit(name, payload) { emitted.push({ name, payload }) } }
  const delivered = emitAssembledEvidence({ loopCtx: goodCtx, session, assembly, generation: 3 })
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].name, 'agent-loop/assembled-context')
  assert.equal(emitted[0].payload.generation, 3)
  assert.equal(delivered, emitted[0].payload)
  assert.ok(Object.isFrozen(delivered))
  // a bad listener is contained even when the emit itself reports normally
  const reporting = { emit() { return undefined } }
  assert.notEqual(emitAssembledEvidence({ loopCtx: reporting, session, assembly, generation: 1 }), null)
})

test('apply self-check degrades evidence-only when the slice marker is absent and stays silent when present', async () => {
  const readers = (overrides = {}) => {
    const versions = {
      '@deepseek-ai/dsh-llm': '0.1.0-rc.6',
      '@deepseek-ai/dsh-agent-loop': '0.1.0-rc.6',
      '@deepseek-ai/dsh-plugin-api-agent-loop': VERSION,
      '@deepseek-ai/dsh-plugin-api-main': VERSION,
      ...overrides,
    }
    return {
      readPackageVersion: (name) => versions[name],
      readPackageApi: (name) => (name.includes('plugin-api') ? API : undefined),
    }
  }
  class FakeRoutePolicyService {
    constructor() {
      this.name = 'routePolicy'
      this[ROUTE_POLICY_ACTIVE_SYMBOL] = true
      this.policy = { register() { return () => {} } }
      this.candidates = { register() { return () => {} }, list() { return Promise.resolve([]) } }
      this.health = { observe() {}, registerCircuitPolicy() { return () => {} }, registerProbe() { return () => {} } }
      this.circuit = { status() { return { state: 'closed' } } }
      this.decisions = { get() {}, history() { return { items: [], truncated: false } } }
      this.availability = () => ({ status: 'active' })
      this.decide = async ({ windowKey, seed }) => ({
        decisionId: 'd',
        windowKey,
        provider: seed.provider,
        model: seed.model,
        config: seed,
        candidates: [],
        reason: { code: 'OFFICIAL_SEED' },
        commitState: 'success',
        observedAt: new Date().toISOString(),
      })
    }
  }
  const forkedFactory = (withEvidence) => class FakeForkedAgentLoop {
    constructor(ctx, config) {
      this.name = 'agentLoop'
      this.config = config
      this[ROUTE_POLICY_COMPONENT_SYMBOL] = { package: '@deepseek-ai/dsh-plugin-api-agent-loop', rowId: 'plugin-api-agent-loop' }
      if (withEvidence) this[EVIDENCE_ACTIVE_SYMBOL] = true
      this.create = () => {}
      this.createAgent = () => Promise.resolve()
      this.resume = () => Promise.resolve()
      ctx.serviceMap.set('agentLoop', this)
    }
  }
  class FakeOfficialAgentLoop {
    constructor(ctx, config) {
      this.name = 'agentLoop'
      this.config = config
      this.create = () => {}
      this.createAgent = () => Promise.resolve()
      this.resume = () => Promise.resolve()
      ctx.serviceMap.set('agentLoop', this)
    }
  }
  const makeContext = () => {
    const serviceMap = new Map()
    const warns = []
    const effects = []
    const ctx = {
      root: {},
      serviceMap,
      warns,
      effects,
      fiber: { entry: { options: { config: { maxParallelToolCalls: 4, agents: [] } } } },
      logger: { warn(message) { warns.push(message) }, error(message) { warns.push(message) } },
      loader: { entries() { return [
        { options: { id: 'agent-loop', disabled: true } },
        { options: { id: 'plugin-api-agent-loop', disabled: false } },
      ] } },
      get(name) { return serviceMap.get(name) },
      effect(fn, label) { effects.push({ fn, label }); return () => {} },
      plugin(Class, config) {
        const instance = new Class(ctx, config)
        if (instance.name === 'routePolicy') serviceMap.set('routePolicy', instance)
        if (instance.name === 'agentLoop') serviceMap.set('agentLoop', instance)
        return () => {
          if (instance.name) serviceMap.delete(instance.name)
        }
      },
    }
    return ctx
  }
  const applyFor = (withEvidence) => createAgentLoopApply({
    ...readers(),
    forkedAgentLoop: forkedFactory(withEvidence),
    officialAgentLoop: FakeOfficialAgentLoop,
    createRoutePolicyService: () => FakeRoutePolicyService,
  })

  const absent = makeContext()
  await applyFor(false)(absent)
  assert.ok(absent.serviceMap.has('agentLoop'))
  assert.ok(absent.serviceMap.has('routePolicy'))
  assert.ok(absent.warns.some((message) => message.includes('assembled-context evidence capability is unavailable')))
  assert.ok(absent.warns.some((message) => message.includes('replacement active')))

  const present = makeContext()
  await applyFor(true)(present)
  assert.ok(present.serviceMap.has('agentLoop'))
  assert.equal(present.serviceMap.get('agentLoop')[EVIDENCE_ACTIVE_SYMBOL], true)
  assert.equal(present.warns.some((message) => message.includes('evidence capability is unavailable')), false)
  assert.ok(present.warns.some((message) => message.includes('replacement active')))
})