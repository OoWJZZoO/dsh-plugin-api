import test from 'node:test'
import assert from 'node:assert/strict'
import { createCompactionEventsApply, inject, name, fullVersionContractsMatch, parseFullVersion } from '../lib/apply.js'
import { COMPACTION_EVENTS_ACTIVE_SYMBOL } from '../lib/forked-engine.js'

const CONSISTENT = { version: '0.1.0-rc.6-0.7', api: '0.7' }

class FakeForkedEngine {
  constructor(ctx, config) {
    this.config = config
    this[COMPACTION_EVENTS_ACTIVE_SYMBOL] = true
    this.compactIfNeeded = () => {}
    this.compactNow = () => {}
    this.compactRegion = () => {}
    this.summarize = () => {}
  }
}

class FakeBrokenEngine extends FakeForkedEngine {
  constructor(ctx, config) {
    super(ctx, config)
    delete this.compactNow
  }
}

class FakeOfficialEngine {
  constructor(ctx, config) {
    this.config = config
    this.compactIfNeeded = () => {}
    this.compactNow = () => {}
    this.compactRegion = () => {}
    this.summarize = () => {}
  }
}

function makeApplyCtx({ entries = [], existing } = {}) {
  const services = new Map()
  if (existing !== undefined) services.set('compaction', existing)
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
    waterfall() {},
    plugin(PluginClass, config) {
      const instance = new PluginClass(ctx, config)
      services.set('compaction', instance)
      return () => services.delete('compaction')
    },
    loader: {
      entries() {
        return entries[Symbol.iterator]()
      },
    },
    fiber: { entry: { options: { config: { auto: false } } } },
  }
  return { ctx, services, warns }
}

function officialEntry({ disabled = false, id = 'compaction-basic', name: rowName = '@deepseek-ai/dsh-compaction-basic' } = {}) {
  return { options: { id, name: rowName, config: {} }, fiber: {}, disabled }
}

function makeVersionReaders({ own = CONSISTENT, main = CONSISTENT, runtime = '0.1.0-rc.6', forkBase = '0.1.0-rc.6' } = {}) {
  return {
    readPackageVersion(packageName) {
      if (packageName === '@deepseek-ai/dsh-plugin-api-compaction-events') return own.version
      if (packageName === '@deepseek-ai/dsh-plugin-api-main') return main.version
      if (packageName === '@deepseek-ai/dsh-llm') return runtime
      if (packageName === '@deepseek-ai/dsh-compaction-basic') return forkBase
      return '0.1.0-rc.6'
    },
    readPackageApi(packageName) {
      if (packageName === '@deepseek-ai/dsh-plugin-api-compaction-events') return own.api
      if (packageName === '@deepseek-ai/dsh-plugin-api-main') return main.api
      return undefined
    },
  }
}

function makeApply(overrides = {}) {
  return createCompactionEventsApply({
    ...makeVersionReaders(),
    forkedEngine: FakeForkedEngine,
    officialEngine: FakeOfficialEngine,
    officialAvailable: true,
    ...overrides,
  })
}

test('plugin entry exports the expected name and inject list', () => {
  assert.equal(name, 'dsh-plugin-api-compaction-events')
  assert.deepEqual(inject, ['loader'])
})

test('full version contract helpers parse and compare full unique versions', () => {
  assert.deepEqual(parseFullVersion('0.1.0-rc.6-0.7'), { runtime: '0.1.0-rc.6', api: '0.7' })
  assert.equal(fullVersionContractsMatch({
    ownVersion: '0.1.0-rc.6-0.7', ownApi: '0.7',
    mainVersion: '0.1.0-rc.6-0.7', mainApi: '0.7',
  }), true)
  assert.equal(fullVersionContractsMatch({
    ownVersion: '0.1.0-rc.6-0.7', ownApi: '0.7',
    mainVersion: '0.1.0-rc.6-0.4', mainApi: '0.4',
  }), false)
})

test('idempotent re-apply returns without touching an existing forked provider', () => {
  const apply = makeApply()
  const existing = new FakeForkedEngine({}, {})
  const { ctx, services, warns } = makeApplyCtx({ existing })
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('compaction'), existing)
  assert.equal(warns.length, 0)
})

test('a prior non-forked claimant makes the replacement stay inert with a conflict diagnostic', () => {
  const apply = makeApply()
  const existing = new FakeOfficialEngine({}, {})
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry({ disabled: true })], existing })
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('compaction'), existing)
  assert.ok(warns.some((message) => message.includes('conflict')), `expected conflict diagnostic: ${JSON.stringify(warns)}`)
})

test('version ok + official row enabled → replacement stays inert', () => {
  const apply = makeApply()
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry()] })
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('compaction'), undefined)
  assert.ok(warns.some((message) => message.includes('official compaction-basic row is enabled')))
})

test('version ok + official row disabled → forked provider is registered with the contract symbol', () => {
  const apply = makeApply()
  const { ctx, services } = makeApplyCtx({ entries: [officialEntry({ disabled: true })] })
  assert.equal(apply(ctx), undefined)
  const service = services.get('compaction')
  assert.ok(service, 'expected a registered compaction provider')
  assert.equal(service[COMPACTION_EVENTS_ACTIVE_SYMBOL], true)
  assert.equal(typeof service.compactIfNeeded, 'function')
  assert.equal(typeof service.compactNow, 'function')
  assert.equal(typeof service.compactRegion, 'function')
  assert.equal(typeof service.summarize, 'function')
})

test('version ok + official row absent → replacement is the sole forked provider', () => {
  const apply = makeApply()
  const { ctx, services } = makeApplyCtx()
  assert.equal(apply(ctx), undefined)
  const service = services.get('compaction')
  assert.ok(service)
  assert.equal(service[COMPACTION_EVENTS_ACTIVE_SYMBOL], true)
})

test('post-register verification failure rolls back and stays inert', () => {
  const apply = makeApply({ forkedEngine: FakeBrokenEngine })
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry({ disabled: true })] })
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('compaction'), undefined, 'broken provider must be rolled back')
  assert.ok(warns.some((message) => message.includes('post-register verification failed')))
})

test('a throwing post-register probe is contained, rolls back, and never throws through apply', () => {
  const apply = makeApply()
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry({ disabled: true })] })
  const originalGet = ctx.get
  ctx.get = (name) => {
    if (name === 'compaction' && services.has('compaction')) throw new Error('post-register get boom')
    return originalGet(name)
  }
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('compaction'), undefined, 'throwing post-register probe must roll the provider back')
  assert.ok(warns.some((message) => message.includes('post-register verification failed')))
})

test('runtime mismatch + official row enabled → inert (official provider stays)', () => {
  const apply = makeApply({ ...makeVersionReaders({ runtime: '9.9.9' }) })
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry()] })
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('compaction'), undefined)
  assert.ok(warns.some((message) => message.includes('runtime/package identity mismatch')))
})

test('main facade version mismatch + official disabled → fallback without replacement events', () => {
  const apply = makeApply({ ...makeVersionReaders({ main: { version: '0.1.0-rc.6-0.4', api: '0.4' } }) })
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry({ disabled: true })] })
  assert.equal(apply(ctx), undefined)
  const service = services.get('compaction')
  assert.ok(service, 'the row still provides the original service contract via the fallback provider')
  assert.equal(service[COMPACTION_EVENTS_ACTIVE_SYMBOL], undefined)
  assert.ok(warns.some((message) => message.includes('main facade version mismatch')))
  assert.ok(warns.some((message) => message.includes('replacement events disabled')))
})

test('runtime mismatch + official disabled + official resolvable → official fallback without events', () => {
  const apply = makeApply({ ...makeVersionReaders({ runtime: '9.9.9' }) })
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry({ disabled: true })] })
  assert.equal(apply(ctx), undefined)
  const service = services.get('compaction')
  assert.ok(service, 'expected an official-equivalent fallback provider')
  assert.equal(service[COMPACTION_EVENTS_ACTIVE_SYMBOL], undefined)
  assert.ok(warns.some((message) => message.includes('official-equivalent fallback provider')))
})

test('runtime mismatch + official disabled + official not resolvable → inert with a loud diagnostic', () => {
  const apply = makeApply({ ...makeVersionReaders({ runtime: '9.9.9' }), officialAvailable: false })
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry({ disabled: true })] })
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('compaction'), undefined)
  assert.ok(warns.some((message) => message.includes('not resolvable; staying inert')))
})

test('main facade mismatch + official absent → fallback with replacement events disabled', () => {
  const apply = makeApply({ ...makeVersionReaders({ main: { version: '0.1.0-rc.6-0.4', api: '0.4' } }) })
  const { ctx, services, warns } = makeApplyCtx()
  assert.equal(apply(ctx), undefined)
  const service = services.get('compaction')
  assert.ok(service, 'expected the official-equivalent fallback for the absent case')
  assert.equal(service[COMPACTION_EVENTS_ACTIVE_SYMBOL], undefined)
  assert.ok(warns.some((message) => message.includes('main facade version mismatch')))
  assert.ok(warns.some((message) => message.includes('official compaction-basic row is absent')))
})

test('loader enumeration throwing is treated as absent and never throws through apply', () => {
  const apply = makeApply()
  const { ctx, services } = makeApplyCtx()
  ctx.loader.entries = () => {
    throw new Error('loader boom')
  }
  assert.equal(apply(ctx), undefined)
  assert.ok(services.get('compaction'), 'absent-with-version-ok must register the forked provider')
})

test('ctx.get throwing is contained and rolls back the registered provider', () => {
  const apply = makeApply()
  const { ctx, services, warns } = makeApplyCtx()
  ctx.get = () => {
    throw new Error('get boom')
  }
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('compaction'), undefined, 'throwing probes must roll back the provider')
  assert.ok(warns.some((message) => message.includes('post-register verification failed')))
})
