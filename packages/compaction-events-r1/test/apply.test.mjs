import test from 'node:test'
import assert from 'node:assert/strict'
import { createCompactionEventsApply, inject, name } from '../lib/apply.js'
import { COMPACTION_EVENTS_ACTIVE_SYMBOL } from '../lib/forked-engine.js'

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

function makeApply(overrides = {}) {
  return createCompactionEventsApply({
    readPackageVersion: () => '0.1.0-rc.6',
    forkedEngine: FakeForkedEngine,
    officialEngine: FakeOfficialEngine,
    officialAvailable: true,
    ...overrides,
  })
}

function mismatchedVersions() {
  return () => '9.9.9'
}

test('plugin entry exports the expected name and inject list', () => {
  assert.equal(name, 'dsh-plugin-api-compaction-events')
  assert.deepEqual(inject, ['loader'])
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

test('version mismatch + official row enabled → inert (official provider stays)', () => {
  const apply = makeApply({ readPackageVersion: mismatchedVersions() })
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry()] })
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('compaction'), undefined)
  assert.ok(warns.some((message) => message.includes('identity mismatch and the official row is enabled')))
})

test('version mismatch + official disabled + official resolvable → official fallback without events', () => {
  const apply = makeApply({ readPackageVersion: mismatchedVersions() })
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry({ disabled: true })] })
  assert.equal(apply(ctx), undefined)
  const service = services.get('compaction')
  assert.ok(service, 'expected an official-equivalent fallback provider')
  assert.equal(service[COMPACTION_EVENTS_ACTIVE_SYMBOL], undefined)
  assert.ok(warns.some((message) => message.includes('official-equivalent fallback provider')))
})

test('version mismatch + official disabled + official not resolvable → inert with a loud diagnostic', () => {
  const apply = makeApply({ readPackageVersion: mismatchedVersions(), officialAvailable: false })
  const { ctx, services, warns } = makeApplyCtx({ entries: [officialEntry({ disabled: true })] })
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('compaction'), undefined)
  assert.ok(warns.some((message) => message.includes('not resolvable; staying inert')))
})

test('version mismatch + official absent + official resolvable → fallback with an absent-row diagnostic', () => {
  const apply = makeApply({ readPackageVersion: mismatchedVersions() })
  const { ctx, services, warns } = makeApplyCtx()
  assert.equal(apply(ctx), undefined)
  const service = services.get('compaction')
  assert.ok(service, 'expected the official-equivalent fallback for the absent case')
  assert.equal(service[COMPACTION_EVENTS_ACTIVE_SYMBOL], undefined)
  assert.ok(
    warns.some((message) => message.includes('official compaction-basic row is absent') && message.includes('fallback provider')),
    `expected a distinct absent fallback diagnostic: ${JSON.stringify(warns)}`,
  )
})

test('version mismatch + official absent + official not resolvable → inert with a loud absent diagnostic', () => {
  const apply = makeApply({ readPackageVersion: mismatchedVersions(), officialAvailable: false })
  const { ctx, services, warns } = makeApplyCtx()
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('compaction'), undefined)
  assert.ok(
    warns.some((message) => message.includes('official compaction-basic row is absent') && message.includes('not resolvable')),
    `expected a loud absent diagnostic: ${JSON.stringify(warns)}`,
  )
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

test('ctx.get throwing is contained and rolls back the registered provider (4.5/4.7)', () => {
  const apply = makeApply()
  const { ctx, services, warns } = makeApplyCtx()
  ctx.get = () => {
    throw new Error('get boom')
  }
  assert.equal(apply(ctx), undefined)
  assert.equal(services.get('compaction'), undefined, 'throwing probes must roll back the provider per 4.7')
  assert.ok(warns.some((message) => message.includes('post-register verification failed')))
})
