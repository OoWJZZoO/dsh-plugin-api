import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAgentLoopApply,
  fullVersionContractsMatch,
  inject,
  name,
} from '../packages/agent-loop/lib/apply.js'
import {
  ROUTE_POLICY_ACTIVE_SYMBOL,
  ROUTE_POLICY_COMPONENT_SYMBOL,
} from '../packages/agent-loop/lib/route-policy.js'

const VERSION = '0.1.0-rc.6-0.1.0'
const API = '0.1'

function readers(overrides = {}) {
  const versions = {
    '@deepseek-ai/dsh-llm': '0.1.0-rc.6',
    '@deepseek-ai/dsh-agent-loop': '0.1.0-rc.6',
    '@deepseek-ai/dsh-plugin-api-agent-loop': VERSION,
    '@deepseek-ai/dsh-plugin-api-main': VERSION,
    ...overrides,
  }
  return {
    readPackageVersion: (name) => versions[name],
    readPackageApi: (name) => name.includes('plugin-api') ? API : undefined,
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
      decisionId: 'decision-1',
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

class FakeForkedAgentLoop {
  constructor(ctx, config) {
    this.name = 'agentLoop'
    this.config = config
    this[ROUTE_POLICY_COMPONENT_SYMBOL] = {
      package: '@deepseek-ai/dsh-plugin-api-agent-loop',
      rowId: 'plugin-api-agent-loop',
    }
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

function makeContext({ entries = [], marker, pluginError = null } = {}) {
  const serviceMap = new Map()
  const warns = []
  const effects = []
  const root = { ...(marker ? { [ROUTE_POLICY_COMPONENT_SYMBOL]: marker } : {}) }
  const ctx = {
    root,
    serviceMap,
    warns,
    effects,
    fiber: { entry: { options: { config: { maxParallelToolCalls: 4, agents: [] } } } },
    logger: { warn(message) { warns.push(message) }, error(message) { warns.push(message) } },
    loader: { entries() { return entries } },
    get(name) { return serviceMap.get(name) },
    effect(fn, label) { effects.push({ fn, label }); return () => {} },
    plugin(Class, config) {
      if (pluginError) throw pluginError
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

function applyFor(options = {}) {
  return createAgentLoopApply({
    ...readers(),
    forkedAgentLoop: FakeForkedAgentLoop,
    officialAgentLoop: FakeOfficialAgentLoop,
    createRoutePolicyService: () => FakeRoutePolicyService,
    ...options,
  })
}

test('replacement entry exports the expected loader surface and version contract', () => {
  assert.equal(name, 'plugin-api-agent-loop')
  assert.deepEqual(inject, ['loader'])
  assert.equal(fullVersionContractsMatch({ ownVersion: VERSION, ownApi: API, mainVersion: VERSION, mainApi: API }), true)
  assert.equal(fullVersionContractsMatch({ ownVersion: VERSION, ownApi: API, mainVersion: '0.1.0-rc.6-0.4', mainApi: '0.4' }), false)
})

test('enabled official row stays inert and does not double-run', async () => {
  const ctx = makeContext({ entries: [{ options: { id: 'agent-loop', disabled: false } }] })
  await applyFor()(ctx)
  assert.equal(ctx.serviceMap.has('agentLoop'), false)
  assert.ok(ctx.warns.some((message) => message.includes('official agent-loop row is enabled')))
})

test('active replacement registers the route service and forked loop once', async () => {
  const ctx = makeContext({ entries: [
    { options: { id: 'agent-loop', disabled: true, config: { maxParallelToolCalls: 7, agents: [] } } },
    { options: { id: 'plugin-api-agent-loop', disabled: false } },
  ] })
  const apply = applyFor()
  await apply(ctx)
  await apply(ctx)
  assert.equal(ctx.serviceMap.get('agentLoop').config.maxParallelToolCalls, 7)
  assert.equal(ctx.serviceMap.get('routePolicy')[ROUTE_POLICY_ACTIVE_SYMBOL], true)
  assert.equal(ctx.root[ROUTE_POLICY_COMPONENT_SYMBOL].package, '@deepseek-ai/dsh-plugin-api-agent-loop')
  assert.equal(ctx.effects.length, 1)
})

test('identity mismatch falls back to the official loop with route policy disabled', async () => {
  const ctx = makeContext({ entries: [
    { options: { id: 'agent-loop', disabled: true } },
    { options: { id: 'plugin-api-agent-loop', disabled: false } },
  ] })
  await applyFor({ ...readers({ '@deepseek-ai/dsh-llm': '0.1.0-rc.7' }) })(ctx)
  assert.ok(ctx.serviceMap.get('agentLoop') instanceof FakeOfficialAgentLoop)
  assert.equal(ctx.serviceMap.has('routePolicy'), false)
  assert.ok(ctx.warns.some((message) => message.includes('official agent-loop fallback')))
})

test('a competing owner and duplicate replacement rows fail safe', async () => {
  const conflict = { package: 'other-owner', rowId: 'other' }
  const ctx = makeContext({
    marker: conflict,
    entries: [{ options: { id: 'plugin-api-agent-loop', disabled: false } }],
  })
  await applyFor()(ctx)
  assert.equal(ctx.serviceMap.size, 0)
  assert.ok(ctx.warns.some((message) => message.includes('another replacement owns')))

  const duplicate = makeContext({ entries: [
    { options: { id: 'agent-loop', disabled: true } },
    { options: { id: 'plugin-api-agent-loop', disabled: false } },
    { options: { id: 'plugin-api-agent-loop', disabled: false } },
  ] })
  await applyFor()(duplicate)
  assert.equal(duplicate.serviceMap.size, 0)
  assert.ok(duplicate.warns.some((message) => message.includes('duplicate replacement rows')))
})

test('registration failure is rolled back and never escapes apply', async () => {
  const ctx = makeContext({
    entries: [{ options: { id: 'plugin-api-agent-loop', disabled: false } }],
    pluginError: new Error('registration failed'),
  })
  await assert.doesNotReject(() => applyFor()(ctx))
  assert.equal(ctx.serviceMap.size, 0)
  assert.equal(ctx.root[ROUTE_POLICY_COMPONENT_SYMBOL], undefined)
})
