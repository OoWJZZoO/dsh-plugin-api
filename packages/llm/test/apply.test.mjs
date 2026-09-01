import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createLlmApply,
  inspectComposition,
  inject,
  name,
  LLM_COMPONENT_MARKER,
  LLM_DECORATION_FACET,
} from '../lib/apply.js'
import {
  fullVersionContractsMatch,
  parseFullVersion,
} from '../lib/version.js'

const CONSISTENT = { version: '0.1.0-rc.6-0.1.0', api: '0.1' }
const RUNTIME = '0.1.0-rc.6'

const OFFICIAL_MEMBERS = [
  'registerAdapter',
  'listProviders',
  'registerConfigurableProviders',
  'listConfigurableProviders',
  'registerModelDiscovery',
  'discoverModels',
  'providerRetryPolicy',
  'listModels',
  'resolveModelInfo',
  'resolveCallConfig',
  'prepareCall',
  'stream',
]

function surfaceMembers() {
  const surface = {}
  for (const member of OFFICIAL_MEMBERS) surface[member] = () => {}
  return surface
}

class FakeForkedRuntime {
  constructor(ctx, config) {
    this.config = config
    this.disposed = false
    Object.assign(this, surfaceMembers())
  }
}

class FakeBrokenRuntime extends FakeForkedRuntime {
  constructor(ctx, config) {
    super(ctx, config)
    delete this.stream
  }
}

class FakeOfficialRuntime {
  constructor(ctx, config) {
    this.config = config
    this.disposed = false
    Object.assign(this, surfaceMembers())
  }
}

function makeApplyCtx({ entries = [], existing, pluginImpl, attachSpy } = {}) {
  const services = new Map()
  if (existing !== undefined) services.set('llm', existing)
  const warns = []
  const cleanups = []
  const ctx = {
    root: null,
    get(name) {
      return services.get(name)
    },
    logger: {
      warn(message) {
        warns.push(message)
      },
      info() {},
    },
    plugin(PluginClass, config) {
      if (pluginImpl) return pluginImpl(PluginClass, config, services)
      const instance = new PluginClass(ctx, config)
      services.set('llm', instance)
      return () => services.delete('llm')
    },
    loader: {
      entries() {
        return entries[Symbol.iterator]()
      },
    },
    effect(fn) {
      cleanups.push(fn)
      return fn
    },
  }
  ctx.root = ctx
  return { ctx, services, warns, cleanups, attachSpy }
}

function officialEntry({ disabled = false, id = 'llm', rowName = '@deepseek-ai/dsh-llm' } = {}) {
  return { options: { id, name: rowName }, fiber: {}, disabled }
}

function replacementEntry({ disabled = false, id = 'plugin-api-llm', rowName = '@deepseek-ai/dsh-plugin-api-llm' } = {}) {
  return { options: { id, name: rowName }, fiber: {}, disabled }
}

function makeVersionReaders({ own = CONSISTENT, main = CONSISTENT, runtime = RUNTIME } = {}) {
  return {
    readPackageVersion(packageName) {
      if (packageName === '@deepseek-ai/dsh-plugin-api-llm') return own.version
      if (packageName === '@deepseek-ai/dsh-plugin-api-main') return main.version
      if (packageName === '@deepseek-ai/dsh-llm') return runtime
      return undefined
    },
    readPackageApi(packageName) {
      if (packageName === '@deepseek-ai/dsh-plugin-api-llm') return own.api
      if (packageName === '@deepseek-ai/dsh-plugin-api-main') return main.api
      return undefined
    },
  }
}

test('package entry exports the loader-facing named exports', () => {
  assert.equal(name, 'plugin-api-llm')
  assert.deepEqual(inject, ['loader'])
})

test('apply attaches the egress gate when the policy authority contract is present', () => {
  const apply = createLlmApply({
    ...makeVersionReaders(),
    forkedRuntime: FakeForkedRuntime,
    officialRuntime: FakeOfficialRuntime,
  })
  const { ctx, services } = makeApplyCtx({
    entries: [officialEntry({ disabled: true }), replacementEntry()],
  })
  const admitted = []
  ctx[Symbol.for('dsh-plugin-api.policyAuthority')] = {
    version: 1,
    egress: {
      admit: (target, context) => {
        admitted.push({ target, context })
        return { ok: true, outcome: 'allow' }
      },
      release: async () => ({ ok: true, code: 'released' }),
    },
    recovery: { decide: async () => ({ ok: true }), commit: async () => ({ ok: true }) },
    policy: { status: () => 'unavailable' },
  }
  apply(ctx)
  const runtime = services.get('llm')
  assert.equal(typeof runtime._egressGate, 'function', 'the runtime carries the egress gate')
  const decision = runtime._egressGate({ kind: 'http', destination: 'https://models.example' }, 'llm/modelDiscovery')
  assert.equal(decision.ok, true)
  assert.equal(admitted.length, 1)
  assert.deepEqual(admitted[0].target, { kind: 'http', destination: 'https://models.example' })
  assert.equal(admitted[0].context.component, 'llm/modelDiscovery')
})

test('apply leaves the egress gate null when the contract is absent (selective-install semantics)', () => {
  const apply = createLlmApply({
    ...makeVersionReaders(),
    forkedRuntime: FakeForkedRuntime,
    officialRuntime: FakeOfficialRuntime,
  })
  const { ctx, services } = makeApplyCtx({
    entries: [officialEntry({ disabled: true }), replacementEntry()],
  })
  apply(ctx)
  const runtime = services.get('llm')
  assert.equal(runtime._egressGate, null, 'no contract means no interception and degraded coverage')
})

test('parseFullVersion and fullVersionContractsMatch follow the main facade rule', () => {
  assert.deepEqual(parseFullVersion('0.1.0-rc.6-0.1.0'), { runtime: '0.1.0-rc.6', api: '0.1', maintenance: '0' })
  assert.equal(parseFullVersion('0.1.0-rc.6'), null)
  assert.equal(
    fullVersionContractsMatch({ ownVersion: '0.1.0-rc.6-0.1.0', ownApi: '0.1', mainVersion: '0.1.0-rc.6-0.1.0', mainApi: '0.1' }),
    true,
  )
  assert.equal(
    fullVersionContractsMatch({ ownVersion: '0.1.0-rc.6-0.8', ownApi: '0.8', mainVersion: '0.1.0-rc.6-0.1.0', mainApi: '0.1' }),
    false,
  )
})

test('inspectComposition counts official and replacement rows', () => {
  const { ctx } = makeApplyCtx({
    entries: [officialEntry({ disabled: true }), replacementEntry()],
  })
  const composition = inspectComposition(ctx)
  assert.equal(composition.officialPresent, true)
  assert.equal(composition.anyOfficialEnabled, false)
  assert.equal(composition.replacementCount, 1)
})

test('apply registers the forked runtime and attaches the decoration facet on success', () => {
  const attachCalls = []
  const apply = createLlmApply({
    ...makeVersionReaders(),
    forkedRuntime: FakeForkedRuntime,
    officialRuntime: FakeOfficialRuntime,
    attachRegistry(runtime, { logger }) {
      attachCalls.push({ runtime, logger: Boolean(logger) })
      runtime.attached = true
      return { facet: { decorate: () => {}, snapshot: () => {} }, dispose: () => {} }
    },
  })
  const { ctx, services, warns, cleanups } = makeApplyCtx({
    entries: [officialEntry({ disabled: true }), replacementEntry()],
  })
  apply(ctx)
  const runtime = services.get('llm')
  assert.ok(runtime instanceof FakeForkedRuntime, 'the forked runtime must be registered')
  assert.equal(runtime[LLM_COMPONENT_MARKER], true, 'the forked runtime must carry the instance marker')
  assert.equal(attachCalls.length, 1, 'the decoration registry must be attached once')
  assert.equal(ctx[LLM_COMPONENT_MARKER]?.package, '@deepseek-ai/dsh-plugin-api-llm')
  assert.equal(ctx[LLM_COMPONENT_MARKER]?.rowId, 'plugin-api-llm')
  assert.equal(ctx[LLM_COMPONENT_MARKER]?.runtime, RUNTIME)
  assert.equal(typeof ctx[LLM_DECORATION_FACET]?.decorate, 'function')
  assert.equal(cleanups.length, 1, 'a teardown cleanup must be registered')
  assert.equal(warns.length, 0, 'no diagnostics expected on the success path')
})

test('apply stays inert when the official row is still enabled', () => {
  const apply = createLlmApply({
    ...makeVersionReaders(),
    forkedRuntime: FakeForkedRuntime,
    officialRuntime: FakeOfficialRuntime,
  })
  const { ctx, services, warns } = makeApplyCtx({
    entries: [officialEntry(), replacementEntry()],
  })
  apply(ctx)
  assert.equal(services.get('llm'), undefined, 'nothing must be registered when the official row is enabled')
  assert.ok(
    warns.some((message) => message.includes('official') && message.includes('enabled')),
    `expected an official-enabled diagnostic, got: ${JSON.stringify(warns)}`,
  )
})

test('apply stays inert on a duplicate replacement row', () => {
  const apply = createLlmApply({
    ...makeVersionReaders(),
    forkedRuntime: FakeForkedRuntime,
    officialRuntime: FakeOfficialRuntime,
  })
  const { ctx, services, warns } = makeApplyCtx({
    entries: [officialEntry({ disabled: true }), replacementEntry(), replacementEntry()],
  })
  apply(ctx)
  assert.equal(services.get('llm'), undefined)
  assert.ok(warns.some((message) => message.includes('expected exactly one active replacement row')))
})

test('apply stays inert when the replacement row is absent', () => {
  const apply = createLlmApply({
    ...makeVersionReaders(),
    forkedRuntime: FakeForkedRuntime,
    officialRuntime: FakeOfficialRuntime,
  })
  const { ctx, services, warns } = makeApplyCtx({
    entries: [officialEntry({ disabled: true })],
  })
  apply(ctx)
  assert.equal(services.get('llm'), undefined)
  assert.ok(warns.some((message) => message.includes('expected exactly one active replacement row')))
})

test('apply stays inert on an owner conflict (another provider owns ctx.llm)', () => {
  const apply = createLlmApply({
    ...makeVersionReaders(),
    forkedRuntime: FakeForkedRuntime,
    officialRuntime: FakeOfficialRuntime,
  })
  const other = { ...surfaceMembers(), provider: 'other' }
  const { ctx, services, warns } = makeApplyCtx({
    entries: [officialEntry({ disabled: true }), replacementEntry()],
    existing: other,
  })
  apply(ctx)
  assert.equal(services.get('llm'), other, 'the existing provider must be left in place')
  assert.ok(warns.some((message) => message.includes('another provider already owns')))
})

test('apply re-apply is idempotent when the forked runtime already owns ctx.llm', () => {
  const apply = createLlmApply({
    ...makeVersionReaders(),
    forkedRuntime: FakeForkedRuntime,
    officialRuntime: FakeOfficialRuntime,
  })
  const { ctx, services, warns } = makeApplyCtx({
    entries: [officialEntry({ disabled: true }), replacementEntry()],
  })
  apply(ctx)
  const runtime = services.get('llm')
  runtime[LLM_COMPONENT_MARKER] = true
  apply(ctx)
  assert.equal(services.get('llm'), runtime, 're-apply must not replace the forked runtime')
  assert.equal(warns.length, 0, 'idempotent re-apply must stay silent')
})

test('apply rolls back and stays inert when post-register verification fails', () => {
  const apply = createLlmApply({
    ...makeVersionReaders(),
    forkedRuntime: FakeBrokenRuntime,
    officialRuntime: FakeOfficialRuntime,
    officialAvailable: true,
  })
  const { ctx, services, warns } = makeApplyCtx({
    entries: [officialEntry({ disabled: true }), replacementEntry()],
  })
  apply(ctx)
  assert.equal(services.get('llm'), undefined, 'the broken fork must be rolled back')
  assert.ok(warns.some((message) => message.includes('post-register verification failed')))
})

test('apply falls back to the official-equivalent runtime on version mismatch (official row disabled)', () => {
  const apply = createLlmApply({
    ...makeVersionReaders({ own: { version: '0.1.0-rc.6-0.8', api: '0.8' }, main: CONSISTENT }),
    forkedRuntime: FakeForkedRuntime,
    officialRuntime: FakeOfficialRuntime,
    officialAvailable: true,
  })
  const { ctx, services, warns } = makeApplyCtx({
    entries: [officialEntry({ disabled: true }), replacementEntry()],
  })
  apply(ctx)
  const runtime = services.get('llm')
  assert.ok(runtime instanceof FakeOfficialRuntime, 'the official-equivalent fallback must be registered')
  assert.notEqual(runtime[LLM_COMPONENT_MARKER], true, 'the fallback must not carry the decoration marker')
  assert.ok(warns.some((message) => message.includes('replacement feature disabled')))
})

test('apply stays inert on version mismatch when the official package is not resolvable', () => {
  const apply = createLlmApply({
    ...makeVersionReaders({ own: { version: '0.1.0-rc.6-0.8', api: '0.8' }, main: CONSISTENT }),
    forkedRuntime: FakeForkedRuntime,
    officialRuntime: FakeOfficialRuntime,
    officialAvailable: false,
  })
  const { ctx, services, warns } = makeApplyCtx({
    entries: [officialEntry({ disabled: true }), replacementEntry()],
  })
  apply(ctx)
  assert.equal(services.get('llm'), undefined)
  assert.ok(warns.some((message) => message.includes('not resolvable')))
})

test('apply stays inert on a runtime identity mismatch with the official row enabled', () => {
  const apply = createLlmApply({
    ...makeVersionReaders({ runtime: '0.1.0-rc.7' }),
    forkedRuntime: FakeForkedRuntime,
    officialRuntime: FakeOfficialRuntime,
    officialAvailable: true,
  })
  const { ctx, services, warns } = makeApplyCtx({
    entries: [officialEntry(), replacementEntry()],
  })
  apply(ctx)
  assert.equal(services.get('llm'), undefined)
  assert.ok(warns.some((message) => message.includes('official') && message.includes('enabled')))
})

test('apply never throws on a malformed loader', () => {
  const apply = createLlmApply({
    ...makeVersionReaders(),
    forkedRuntime: FakeForkedRuntime,
    officialRuntime: FakeOfficialRuntime,
  })
  const { ctx, warns } = makeApplyCtx({ entries: [] })
  ctx.loader.entries = () => {
    throw new Error('loader exploded')
  }
  apply(ctx)
  assert.ok(warns.length >= 0)
})
