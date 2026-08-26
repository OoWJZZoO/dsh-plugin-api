import test from 'node:test'
import assert from 'node:assert/strict'
import { createToolSkillApply, CONTRACT_SYMBOL } from '../lib/apply.js'

const VERSIONS = {
  '@deepseek-ai/dsh': '0.1.0-rc.6',
  '@deepseek-ai/dsh-llm': '0.1.0-rc.6',
  '@deepseek-ai/dsh-tool-skill': '0.1.0-rc.6',
  '@deepseek-ai/dsh-plugin-api-tool-skill': '0.1.0-rc.6-0.6',
  '@deepseek-ai/dsh-plugin-api-main': '0.1.0-rc.6-0.6',
}

function goodEnv(overrides = {}) {
  return {
    readPackageVersion: (name) => overrides.versions?.[name] ?? VERSIONS[name],
    readPackageApi: (name) => (name.includes('plugin-api') ? '0.6' : undefined),
    ...overrides,
  }
}

function makeContext({ entries = [], services = new Map(), logger } = {}) {
  const warns = []
  const ctx = {
    logger: logger ?? { warn: (message) => warns.push(message) },
    loader: { entries: () => entries },
    get: (name) => services.get(name),
    set(name, value) {
      services.set(name, value)
      return true
    },
    plugin() { throw new Error('unused') },
    serviceMap: services,
    skills: {
      snapshot() {}, list() {}, get() {}, register() {},
    },
    warns,
  }
  return ctx
}

function officialRow({ disabled = true } = {}) {
  return { options: { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill', disabled } }
}

function replacementRow({ id = 'plugin-api-tool-skill', disabled = false } = {}) {
  return { options: { id, name: '@deepseek-ai/dsh-plugin-api-tool-skill', disabled } }
}

/** Fork that records registration and reports configurable probes. */
function makeForkFactory(state) {
  return function fakeFork({ ctx, config, extension }) {
    if (state.forkThrow) throw state.forkThrow
    state.forkConfigs.push(config)
    state.extensions.push(extension)
    if (state.forkSkillToolThrows) {
      // First registration attempt fails; emulate the fork probe failure path.
      return {
        probes: { skillToolRegistered: false, preStepListeners: 0 },
        disposer: () => { state.disposed += 1 },
      }
    }
    return {
      probes: { skillToolRegistered: true, preStepListeners: state.preStepListeners ?? 2 },
      disposer: () => { state.disposed += 1 },
    }
  }
}

function makeServiceFactory(state) {
  return function fakeService(options) {
    if (state.serviceThrow) throw state.serviceThrow
    state.serviceOptions.push(options)
    if (state.serviceBroken) {
      return { notTheContract: true }
    }
    return {
      [CONTRACT_SYMBOL]: true,
      registerDescriptor() {}, registerSkill() {}, activate() {}, deactivate() {}, exposure() {}, audit() {},
      availability() { return { active: true, seams: options.readSeamStatus() } },
      policy: { registerMinimalCatalogUpdate() {} },
    }
  }
}

function makeEngineFactory(state) {
  return function fakeEngine(options) {
    if (state.engineThrow) throw state.engineThrow
    state.engineOptions.push(options)
    return {
      descriptorOf: () => null,
      activationState: () => ({ status: 'absent', record: undefined }),
      registerDescriptor: (spec) => ({ ok: true, generation: 'g-1', replaced: false }),
      unregisterDescriptor: (skillId, owner) => ({ ok: true }),
      activate: () => ({ ok: true, generation: 'g-2' }),
      deactivate: () => ({ ok: true, generation: 'g' }),
      exposure: () => ({ ok: false, code: 'EXPOSURE_STALE_GENERATION', reason: 'r' }),
      audit: (query) => ({ ok: true, items: [] }),
      policyRegister: () => ({ ok: true, token: {} }),
      policyDispose: () => ({ ok: true, revoked: true }),
      minimalPolicyFor: () => false,
      recordCatalogChange: () => ({ ok: true }),
      availability: () => ({ status: 'active' }),
      readSeamStatus: options.readSeamStatus,
    }
  }
}

function freshState() {
  return {
    forkConfigs: [],
    extensions: [],
    serviceOptions: [],
    engineOptions: [],
    disposed: 0,
    officialCalls: 0,
    forkThrow: undefined,
    engineThrow: undefined,
    serviceThrow: undefined,
    serviceBroken: false,
    forkSkillToolThrows: false,
    preStepListeners: 2,
  }
}

function buildApply(state, env = goodEnv()) {
  const officialApplyFn = () => { state.officialCalls += 1 }
  return createToolSkillApply({
    ...env,
    officialApplyFn,
    createFork: makeForkFactory(state),
    createService: makeServiceFactory(state),
    createEngine: makeEngineFactory(state),
  })
}

test('apply: loader composition probe failure stays inert', () => {
  const state = freshState()
  const apply = buildApply(state)
  const ctx = makeContext()
  ctx.loader.entries = () => { throw new Error('loader boom') }
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(state.officialCalls, 0)
  assert.equal(state.serviceOptions.length, 0)
  assert.ok(ctx.warns.some((message) => message.includes('loader composition')))
})

test('apply: official row enabled leaves it in place without touching anything', () => {
  const state = freshState()
  const apply = buildApply(state)
  const services = new Map()
  const ctx = makeContext({ entries: [officialRow({ disabled: false }), replacementRow()], services })
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(state.officialCalls, 0)
  assert.equal(services.has('skillActivation'), false)
  assert.equal(state.forkConfigs.length, 0)
  assert.ok(ctx.warns.some((message) => message.includes('official tool-skill row is enabled')))
})

test('apply: absent or duplicate replacement rows stay inert', () => {
  for (const entries of [[officialRow()], [officialRow(), replacementRow(), replacementRow({ id: 'plugin-api-tool-skill-dup' })]]) {
    const state = freshState()
    const apply = buildApply(state)
    const ctx = makeContext({ entries })
    assert.doesNotThrow(() => apply(ctx))
    assert.equal(state.officialCalls, 0)
    assert.equal(state.forkConfigs.length, 0)
  }
})

test('apply: identity ok assembles the full matrix and publishes the contract service', () => {
  const state = freshState()
  const apply = buildApply(state)
  const services = new Map()
  const ctx = makeContext({ entries: [officialRow(), replacementRow()], services })
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(state.forkConfigs.length, 1)
  assert.deepEqual(state.forkConfigs[0], { catalogDescriptionMaxLength: 500 })
  assert.equal(typeof state.extensions[0].scopeKeysOf, 'function')
  assert.equal(state.engineOptions.length, 1)
  assert.equal(state.serviceOptions.length, 1)
  const service = services.get('skillActivation')
  assert.ok(service)
  assert.equal(service[CONTRACT_SYMBOL], true)
  assert.ok(ctx.warns.some((message) => message.includes('replacement active')))
  assert.equal(state.officialCalls, 0)
  // availability reflects the truthfully probed seams.
  assert.deepEqual(service.availability().seams, { skillTool: true, preStepInjection: true, catalogProvider: true })
})

test('apply: runtime, owner and main-facade identity mismatches fall back to official', () => {
  const cases = [
    { versions: { '@deepseek-ai/dsh': '0.1.0-rc.7' }, label: 'runtime' },
    { versions: { '@deepseek-ai/dsh-tool-skill': '0.1.0-rc.7' }, label: 'owner' },
    { versions: { '@deepseek-ai/dsh-plugin-api-main': '0.1.0-rc.7-0.6' }, label: 'main version' },
    { versions: { '@deepseek-ai/dsh-plugin-api-main': '0.1.0-rc.6-0.7' }, label: 'main api' },
  ]
  for (const { versions, label } of cases) {
    const state = freshState()
    const apply = buildApply(state, goodEnv({ versions }))
    const services = new Map()
    const ctx = makeContext({ entries: [officialRow(), replacementRow()], services })
    assert.doesNotThrow(() => apply(ctx), label)
    assert.equal(state.officialCalls, 1, `${label}: official apply runs`)
    assert.equal(services.has('skillActivation'), false, `${label}: no extension service`)
    assert.equal(state.forkConfigs.length, 0, `${label}: no fork assembly`)
  }
})

test('apply: official fallback failure stays inert without throwing', () => {
  const state = freshState()
  const env = goodEnv({ versions: { '@deepseek-ai/dsh': '0.1.0-rc.9' } })
  const apply = createToolSkillApply({
    ...env,
    officialApplyFn: () => { throw new Error('official apply boom') },
    createFork: makeForkFactory(state),
    createService: makeServiceFactory(state),
    createEngine: makeEngineFactory(state),
  })
  const ctx = makeContext({ entries: [officialRow(), replacementRow()] })
  assert.doesNotThrow(() => apply(ctx))
  assert.ok(ctx.warns.some((message) => message.includes('official apply failed')))
})

test('apply: fork setup and engine failures stay inert', () => {
  for (const kind of ['forkThrow', 'engineThrow']) {
    const state = freshState()
    if (kind === 'forkThrow') state.forkThrow = new Error('fork boom')
    else state.engineThrow = new Error('engine boom')
    const apply = buildApply(state)
    const services = new Map()
    const ctx = makeContext({ entries: [officialRow(), replacementRow()], services })
    assert.doesNotThrow(() => apply(ctx))
    assert.equal(services.has('skillActivation'), false)
    assert.equal(state.officialCalls, 0, kind)
  }
})

test('apply: probe failures dispose the fork and restore official behavior', () => {
  const state = freshState()
  state.forkSkillToolThrows = true
  const apply = buildApply(state)
  const services = new Map()
  const ctx = makeContext({ entries: [officialRow(), replacementRow()], services })
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(state.disposed, 1)
  assert.equal(state.officialCalls, 1)
  assert.equal(services.get('skillActivation'), undefined)
  assert.ok(ctx.warns.some((message) => message.includes('boot self-check failed')))
})

test('apply: contract probe failure publishes nothing and falls back', () => {
  const state = freshState()
  state.serviceBroken = true
  const apply = buildApply(state)
  const services = new Map()
  const ctx = makeContext({ entries: [officialRow(), replacementRow()], services })
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(state.disposed, 1)
  assert.equal(state.officialCalls, 1)
  assert.equal(services.get('skillActivation'), undefined)
})

test('apply: idempotent re-apply and competitor ownership', () => {
  const state = freshState()
  const apply = buildApply(state)
  const services = new Map()
  const entries = [officialRow(), replacementRow()]
  const ctx = makeContext({ entries, services })
  apply(ctx)
  // Re-apply: the marker service short-circuits.
  apply(ctx)
  assert.equal(state.serviceOptions.length, 1)
  assert.equal(state.forkConfigs.length, 1)

  // A competitor owns ctx.skillActivation without the contract marker.
  const competitor = makeContext({
    entries,
    services: new Map([['skillActivation', { other: true }]]),
  })
  assert.doesNotThrow(() => apply(competitor))
  assert.ok(competitor.warns.some((message) => message.includes('another provider already owns')))
})

test('apply: invalid config stays inert with a diagnostic', () => {
  const state = freshState()
  const apply = buildApply(state)
  const ctx = makeContext({ entries: [officialRow(), replacementRow()] })
  assert.doesNotThrow(() => apply(ctx, { catalogDescriptionMaxLength: 0 }))
  assert.equal(state.forkConfigs.length, 0)
  assert.ok(ctx.warns.some((message) => message.includes('invalid config')))
})
import { createSkillActivationService } from '../lib/apply.js'
import { createSkillActivationEngine } from '../lib/skill-activation-engine.js'

test('activation timeout: deadline expiry returns the typed timeout without mutations', async () => {
  const engine = createSkillActivationEngine({})
  engine.registerDescriptor({ skillId: 'demo-skill', owner: 'plugin-a', summary: 'Demo summary', sourceKind: 'explicit' })
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const ctx = {
    skills: {
      async list() {
        await gate
        return [{ name: 'demo-skill', source: 'rt', provider: 'rt' }]
      },
    },
  }
  const service = createSkillActivationService({ ctx, engine, readSeamStatus: () => ({}), log: () => {} })

  // Deadline expires while the registry verification is still pending.
  const timedOut = await service.activate('demo-skill', { scope: { kind: 'session', key: 's-1' }, deadline: 30 })
  assert.equal(timedOut.ok, false)
  assert.equal(timedOut.code, 'ACTIVATION_TIMEOUT')
  // No mutation landed: no activation record, no lifecycle noise.
  assert.equal(engine.activationState('session:s-1', 'demo-skill').status, 'absent')
  const audits = engine.audit({ limit: 50 }).items
  assert.ok(audits.every((item) => item.kind !== 'activate' && item.kind !== 'supersede' && item.kind !== 'expire'))

  // Without a deadline the same slow verification completes normally.
  const pending = service.activate('demo-skill', { scope: { kind: 'session', key: 's-1' } })
  release()
  const noDeadline = await pending
  assert.equal(noDeadline.ok, true)
  assert.equal(engine.activationState('session:s-1', 'demo-skill').status, 'active')
})

test('activation timeout: completion inside the deadline activates normally', async () => {
  const engine = createSkillActivationEngine({})
  engine.registerDescriptor({ skillId: 'demo-skill', owner: 'plugin-a', summary: 'Demo summary', sourceKind: 'explicit' })
  const ctx = {
    skills: {
      async list() {
        return [{ name: 'demo-skill', source: 'rt', provider: 'rt' }]
      },
    },
  }
  const service = createSkillActivationService({ ctx, engine, readSeamStatus: () => ({}), log: () => {} })
  const result = await service.activate('demo-skill', { scope: { kind: 'session', key: 's-1' }, deadline: 1000 })
  assert.equal(result.ok, true)
  assert.equal(result.state, 'active')
  assert.equal(engine.activationState('session:s-1', 'demo-skill').status, 'active')
})
