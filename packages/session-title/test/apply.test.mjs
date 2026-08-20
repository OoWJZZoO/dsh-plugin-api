import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionTitleApply, inject, name, fullVersionContractsMatch, parseFullVersion } from '../lib/apply.js'
import { SESSION_TITLE_ACTIVE_SYMBOL } from '../lib/forked-service.js'

const DEFAULT_CONFIG = { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 }
const CUSTOM_CONFIG = { fallbackMaxWords: 9, fallbackMaxBytes: 30, maxTitleBytes: 90 }
const CONSISTENT = { version: '0.1.0-rc.6-0.5', api: '0.5' }

class FakeForkedService {
  constructor(ctx, config) {
    this.config = config
    this[SESSION_TITLE_ACTIVE_SYMBOL] = true
    this.get = () => undefined
    this.rename = () => {}
    this.refresh = () => {}
    this.register = () => () => {}
  }
}

class FakeBrokenService extends FakeForkedService {
  constructor(ctx, config) {
    super(ctx, config)
    delete this.get
  }
}

class FakeOfficialService {
  constructor(ctx, config) {
    this.config = config
    this.get = () => undefined
    this.rename = () => {}
    this.refresh = () => {}
    this.register = () => () => {}
  }
}

function makeApplyCtx({ entries = [], existing, ownConfig = { ...DEFAULT_CONFIG }, waterfall = () => undefined } = {}) {
  const services = new Map()
  if (existing !== undefined) services.set('sessionTitle', existing)
  const warns = []
  const ctx = {
    reflect: { provide() {} },
    get(name) {
      return services.get(name)
    },
    logger: {
      warn(message) {
        warns.push(message)
      },
      info() {},
    },
    on() {
      return () => {}
    },
    emit() {},
    waterfall,
    plugin(PluginClass, config) {
      const instance = new PluginClass(ctx, config)
      services.set('sessionTitle', instance)
      return () => services.delete('sessionTitle')
    },
    loader: {
      entries() {
        return entries[Symbol.iterator]()
      },
    },
    fiber: { entry: { options: { config: ownConfig } } },
  }
  return { ctx, services, warns }
}

function officialEntry({ disabled = false, id = 'session-title', name: rowName = '@deepseek-ai/dsh-session-title', config = { ...DEFAULT_CONFIG } } = {}) {
  return { options: { id, name: rowName, config }, fiber: {}, disabled }
}

function makeVersionReaders({ own = CONSISTENT, main = CONSISTENT, runtime = '0.1.0-rc.6', forkBase = '0.1.0-rc.6' } = {}) {
  return {
    readPackageVersion(packageName) {
      if (packageName === '@deepseek-ai/dsh-plugin-api-session-title') return own.version
      if (packageName === '@deepseek-ai/dsh-plugin-api-main') return main.version
      if (packageName === '@deepseek-ai/dsh-llm') return runtime
      if (packageName === '@deepseek-ai/dsh-session-title') return forkBase
      return '0.1.0-rc.6'
    },
    readPackageApi(packageName) {
      if (packageName === '@deepseek-ai/dsh-plugin-api-session-title') return own.api
      if (packageName === '@deepseek-ai/dsh-plugin-api-main') return main.api
      return undefined
    },
  }
}

function makeApply(overrides = {}) {
  return createSessionTitleApply({
    ...makeVersionReaders(),
    forkedEngine: FakeForkedService,
    officialEngine: FakeOfficialService,
    officialAvailable: true,
    ...overrides,
  })
}

test('plugin entry exports the expected name and inject list', () => {
  assert.equal(name, 'dsh-plugin-api-session-title')
  assert.deepEqual(inject, ['loader'])
})

test('full version contract helpers parse and compare full unique versions', () => {
  assert.deepEqual(parseFullVersion('0.1.0-rc.6-0.5'), { runtime: '0.1.0-rc.6', api: '0.5' })
  assert.equal(fullVersionContractsMatch({
    ownVersion: '0.1.0-rc.6-0.5', ownApi: '0.5',
    mainVersion: '0.1.0-rc.6-0.5', mainApi: '0.5',
  }), true)
  assert.equal(fullVersionContractsMatch({
    ownVersion: '0.1.0-rc.6-0.5', ownApi: '0.5',
    mainVersion: '0.1.0-rc.6-0.4', mainApi: '0.4',
  }), false)
})

test('idempotent re-apply returns without touching an existing forked provider', () => {
  const apply = makeApply()
  const existing = new FakeForkedService({}, {})
  const { ctx, services, warns } = makeApplyCtx({ existing })
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('sessionTitle'), existing)
  assert.equal(warns.length, 0)
})

test('a prior non-forked claimant makes the replacement stay inert with a conflict diagnostic', () => {
  const apply = makeApply()
  const existing = new FakeOfficialService({}, {})
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry({ disabled: true })], existing })
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('sessionTitle'), existing)
  assert.ok(warns.some((message) => message.includes('conflict')), `expected conflict diagnostic: ${JSON.stringify(warns)}`)
})

test('version ok + official row enabled → replacement stays inert', () => {
  const apply = makeApply()
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry()] })
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('sessionTitle'), undefined)
  assert.ok(warns.some((message) => message.includes('official session-title row is enabled')))
})

test('version ok + official row disabled → forked provider is registered with the contract symbol', () => {
  const apply = makeApply()
  const { ctx, services } = makeApplyCtx({ entries: [officialEntry({ disabled: true })] })
  assert.equal(apply(ctx), undefined)
  const service = services.get('sessionTitle')
  assert.ok(service, 'expected a registered sessionTitle provider')
  assert.equal(service[SESSION_TITLE_ACTIVE_SYMBOL], true)
  assert.equal(typeof service.get, 'function')
  assert.equal(typeof service.rename, 'function')
  assert.equal(typeof service.refresh, 'function')
  assert.equal(typeof service.register, 'function')
})

test('version ok + official row absent → replacement is the sole forked provider', () => {
  const apply = makeApply()
  const { ctx, services } = makeApplyCtx()
  assert.equal(apply(ctx), undefined)
  const service = services.get('sessionTitle')
  assert.ok(service)
  assert.equal(service[SESSION_TITLE_ACTIVE_SYMBOL], true)
})

test('post-register verification failure rolls back and stays inert', () => {
  const apply = makeApply({ forkedEngine: FakeBrokenService })
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry({ disabled: true })] })
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('sessionTitle'), undefined, 'broken provider must be rolled back')
  assert.ok(warns.some((message) => message.includes('post-register verification failed')))
})

test('a missing ctx.waterfall fails post-register verification and rolls back', () => {
  const apply = makeApply()
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry({ disabled: true })] })
  delete ctx.waterfall
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('sessionTitle'), undefined, 'without a waterfall-capable ctx no forked provider may be published')
  assert.ok(warns.some((message) => message.includes('post-register verification failed')))
})

test('a throwing post-register probe is contained, rolls back, and never throws through apply', () => {
  const apply = makeApply()
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry({ disabled: true })] })
  const originalGet = ctx.get
  ctx.get = (name) => {
    if (name === 'sessionTitle' && services.has('sessionTitle')) throw new Error('post-register get boom')
    return originalGet(name)
  }
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('sessionTitle'), undefined, 'throwing post-register probe must roll the provider back')
  assert.ok(warns.some((message) => message.includes('post-register verification failed')))
})

test('runtime mismatch + official row enabled → inert (official provider stays)', () => {
  const apply = makeApply({ ...makeVersionReaders({ runtime: '9.9.9' }) })
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry()] })
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('sessionTitle'), undefined)
  assert.ok(warns.some((message) => message.includes('runtime/package identity mismatch')))
})

test('main facade version mismatch + official disabled → fallback without replacement feature', () => {
  const apply = makeApply({ ...makeVersionReaders({ main: { version: '0.1.0-rc.6-0.4', api: '0.4' } }) })
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry({ disabled: true })] })
  assert.equal(apply(ctx), undefined)
  const service = services.get('sessionTitle')
  assert.ok(service, 'the row still provides the original service contract via the fallback provider')
  assert.equal(service[SESSION_TITLE_ACTIVE_SYMBOL], undefined, 'fallback carries no new event vocabulary')
  assert.ok(warns.some((message) => message.includes('main facade version mismatch')))
  assert.ok(warns.some((message) => message.includes('replacement feature disabled')))
})

test('runtime mismatch + official disabled + official resolvable → official fallback without events', () => {
  const apply = makeApply({ ...makeVersionReaders({ runtime: '9.9.9' }) })
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry({ disabled: true })] })
  assert.equal(apply(ctx), undefined)
  const service = services.get('sessionTitle')
  assert.ok(service, 'expected an official-equivalent fallback provider')
  assert.equal(service[SESSION_TITLE_ACTIVE_SYMBOL], undefined, 'fallback carries no new event vocabulary')
  assert.ok(warns.some((message) => message.includes('official-equivalent fallback provider')))
})

test('runtime mismatch + official disabled + official not resolvable → inert with a loud diagnostic', () => {
  const apply = makeApply({ ...makeVersionReaders({ runtime: '9.9.9' }), officialAvailable: false })
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry({ disabled: true })] })
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('sessionTitle'), undefined)
  assert.ok(warns.some((message) => message.includes('not resolvable; staying inert')))
})

test('main facade mismatch + official absent → fallback with replacement feature disabled', () => {
  const apply = makeApply({ ...makeVersionReaders({ main: { version: '0.1.0-rc.6-0.4', api: '0.4' } }) })
  const { ctx, services, warns } = makeApplyCtx()
  assert.equal(apply(ctx), undefined)
  const service = services.get('sessionTitle')
  assert.ok(service, 'expected the official-equivalent fallback for the absent case')
  assert.equal(service[SESSION_TITLE_ACTIVE_SYMBOL], undefined)
  assert.ok(warns.some((message) => message.includes('main facade version mismatch')))
  assert.ok(warns.some((message) => message.includes('official session-title row is absent')))
})

test('loader enumeration throwing is treated as absent and never throws through apply', () => {
  const apply = makeApply()
  const { ctx, services } = makeApplyCtx()
  ctx.loader.entries = () => {
    throw new Error('loader boom')
  }
  assert.equal(apply(ctx), undefined)
  assert.ok(services.get('sessionTitle'), 'absent-with-version-ok must register the forked provider')
})

test('ctx.get throwing is contained and rolls back the registered provider', () => {
  const apply = makeApply()
  const { ctx, services, warns } = makeApplyCtx()
  ctx.get = () => {
    throw new Error('get boom')
  }
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('sessionTitle'), undefined, 'throwing probes must roll back the provider')
  assert.ok(warns.some((message) => message.includes('post-register verification failed')))
})

test('a throwing config probe falls back to defaults and never throws through apply', () => {
  const apply = makeApply()
  const { ctx, services } = makeApplyCtx()
  ctx.fiber = null
  assert.equal(apply(ctx), undefined)
  const service = services.get('sessionTitle')
  assert.ok(service, 'the forked provider still registers with default config')
})

test('a valid custom config on the disabled official row is honored (user config continuity)', () => {
  const apply = makeApply()
  const { ctx, services } = makeApplyCtx({
    entries: [officialEntry({ disabled: true, config: { ...CUSTOM_CONFIG } })],
  })
  assert.equal(apply(ctx), undefined)
  assert.deepEqual(services.get('sessionTitle').config, CUSTOM_CONFIG)
})

test('an invalid official row config falls back to this bundle config with a diagnostic', () => {
  const apply = makeApply()
  const { ctx, services, warns } = makeApplyCtx({
    ownConfig: { ...DEFAULT_CONFIG },
    entries: [officialEntry({ disabled: true, config: { fallbackMaxWords: 0, fallbackMaxBytes: 40, maxTitleBytes: 80 } })],
  })
  assert.equal(apply(ctx), undefined)
  assert.deepEqual(services.get('sessionTitle').config, DEFAULT_CONFIG)
  assert.ok(warns.some((message) => message.includes('official session-title row config is invalid')))
})

test('an invalid own config falls back to builtin defaults with a diagnostic', () => {
  const apply = makeApply()
  const { ctx, services, warns } = makeApplyCtx({ ownConfig: null })
  assert.equal(apply(ctx), undefined)
  assert.deepEqual(services.get('sessionTitle').config, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 })
  assert.ok(warns.some((message) => message.includes('builtin defaults')))
})

test('official row absent → this bundle config is used (standalone activation)', () => {
  const apply = makeApply()
  const { ctx, services } = makeApplyCtx({ ownConfig: { ...CUSTOM_CONFIG } })
  assert.equal(apply(ctx), undefined)
  assert.deepEqual(services.get('sessionTitle').config, CUSTOM_CONFIG)
})
