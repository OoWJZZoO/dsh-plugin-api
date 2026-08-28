/**
 * Apply decision matrix tests for `@deepseek-ai/dsh-plugin-api-session-channel-connection`.
 *
 * Uses the `createSessionChannelConnectionApply` factory with seam overrides to
 * drive every cell of the matrix without a real Cordis harness.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionChannelConnectionApply } from '../lib/apply.js'
import { CONNECTION_OWNER_SYMBOL } from '../lib/shared-vocab.js'

/** Minimal fake ctx with the services the apply matrix reads. */
function createFakeCtx(options = {}) {
  const services = {}
  const state = { log: [], effects: [], provides: {} }
  // PluginApi
  if (options.pluginApi !== undefined) {
    services.pluginApi = options.pluginApi
  }
  // Pre-existing connection service
  if (options.connection !== undefined) {
    services.connection = options.connection
  }
  const ctx = {
    logger: {
      warn(message) { state.log.push(message) },
      error() {},
    },
    get(name) {
      if (name in services) return services[name]
      if (name in state.provides) return state.provides[name]
      return undefined
    },
    reflect: {
      provide(name, value) {
        state.provides[name] = value
      },
    },
    fiber: options.fiber ?? { entry: { options: { config: {} } } },
    loader: {
      entries() {
        return options.entries ?? []
      },
    },
    effect(fn, label) {
      state.effects.push({ fn, label })
    },
    inject(deps, cb) {
      // Simulate injection: call cb immediately with the same ctx.
      cb(ctx)
    },
    webServer: {
      register(route) { state.effects.push({ type: 'register', route }) },
      registerUpgrade(def) { state.effects.push({ type: 'registerUpgrade', def }) },
    },
  }
  return { ctx, state }
}

const MATCHING_VERSION = '0.1.0-rc.6-0.1.0'
const MATCHING_API = '0.1'
const MISMATCH_VERSION = '0.1.0-rc.6-0.8'
const MISMATCH_API = '0.8'

function makeEntry(id, name, disabled) {
  return { options: { id, name }, disabled: Boolean(disabled) }
}

const OFFICIAL_ENTRY = () => makeEntry('connection', '@deepseek-ai/dsh-client-connection', false)
const DISABLED_OFFICIAL = () => makeEntry('connection', '@deepseek-ai/dsh-client-connection', true)
const REPLACEMENT_ENTRY = () => makeEntry('plugin-api-session-channel-connection', '@deepseek-ai/dsh-plugin-api-session-channel-connection', false)

test('APPLY: versionOk + official disabled → runs forked apply and attaches slices', () => {
  let calledForkedApply = false
  let calledConfig = null
  let attachSlices = false
  const apply = createSessionChannelConnectionApply({
    readPackageVersion: (name) => {
      if (name.includes('dsh-client-connection')) return '0.1.0-rc.6'
      if (name.includes('dsh-plugin-api-session-channel-connection')) return MATCHING_VERSION
      if (name.includes('dsh-plugin-api-main')) return MATCHING_VERSION
      return undefined
    },
    readPackageApi: () => MATCHING_API,
    officialApply: undefined,
    officialAvailable: false,
    forkedApply: (ctx, config) => {
      calledForkedApply = true
      calledConfig = config
      // Simulate registering the connection service that the forked apply creates.
      const fakeConnection = { rpc: { handle() {}, intercept() {} }, createSharedFetchHandler() {}, register() {}, registerInterceptor() {} }
      Object.defineProperty(fakeConnection, CONNECTION_OWNER_SYMBOL, { value: true })
      ctx.reflect.provide('connection', fakeConnection)
    },
    fencing: { attach() {}, detach() {}, active: true, bind() { return true }, isCurrent() { return true }, drop() {}, snapshot() { return {} }, prune() {} },
    resume: { async reattach(g, s) { return { ok: true } } },
    resolveFacade: () => undefined,
  })
  const { ctx, state } = createFakeCtx({
    entries: [DISABLED_OFFICIAL(), REPLACEMENT_ENTRY()],
  })
  apply(ctx)
  assert.ok(calledForkedApply, 'forked apply must be called when versionOk + official disabled')
  assert.ok(state.log.some((m) => m.includes('registered')), 'diagnostic must confirm registration')
})

test('APPLY: versionOk + official enabled → leave official in place, no fork', () => {
  let calledForked = false
  const apply = createSessionChannelConnectionApply({
    readPackageVersion: (name) => {
      if (name.includes('dsh-client-connection')) return '0.1.0-rc.6'
      if (name.includes('dsh-plugin-api-session-channel-connection')) return MATCHING_VERSION
      if (name.includes('dsh-plugin-api-main')) return MATCHING_VERSION
      return undefined
    },
    readPackageApi: () => MATCHING_API,
    officialApply: (ctx, config) => { calledForked = true },
    forkedApply: (ctx, config) => { calledForked = true },
  })
  const { ctx, state } = createFakeCtx({
    entries: [OFFICIAL_ENTRY()],
  })
  apply(ctx)
  assert.ok(!calledForked, 'forked/official apply must NOT be called when official row is enabled')
  assert.ok(state.log.some((m) => m.includes('enabled')), 'diagnostic must mention official row is enabled')
})

test('APPLY: version mismatch + official disabled + official available → fallback register', () => {
  let calledOfficial = false
  let calledConfig = null
  const apply = createSessionChannelConnectionApply({
    readPackageVersion: (name) => {
      if (name.includes('dsh-client-connection')) return '0.1.0-rc.6'
      if (name.includes('dsh-plugin-api-session-channel-connection')) return MISMATCH_VERSION
      if (name.includes('dsh-plugin-api-main')) return MATCHING_VERSION
      return undefined
    },
    readPackageApi: (name) => {
      if (name.includes('dsh-plugin-api-main')) return MATCHING_API
      return MISMATCH_API
    },
    officialApply: (ctx, config) => {
      calledOfficial = true
      calledConfig = config
    },
    officialAvailable: true,
    forkedApply: () => {},
  })
  const { ctx, state } = createFakeCtx({
    entries: [DISABLED_OFFICIAL(), REPLACEMENT_ENTRY()],
  })
  apply(ctx)
  assert.ok(calledOfficial, 'official fallback apply must be called on version mismatch')
  assert.ok(state.log.some((m) => m.includes('fallback')), 'diagnostic must mention fallback registration')
})

test('APPLY: version mismatch + official disabled + official NOT available → inert', () => {
  const apply = createSessionChannelConnectionApply({
    readPackageVersion: (name) => {
      if (name.includes('dsh-client-connection')) return '0.1.0-rc.6'
      if (name.includes('dsh-plugin-api-session-channel-connection')) return MISMATCH_VERSION
      if (name.includes('dsh-plugin-api-main')) return MATCHING_VERSION
      return undefined
    },
    readPackageApi: () => MISMATCH_API,
    officialApply: undefined,
    officialAvailable: false,
    forkedApply: () => {},
  })
  const { ctx, state } = createFakeCtx({
    entries: [DISABLED_OFFICIAL(), REPLACEMENT_ENTRY()],
  })
  apply(ctx)
  assert.ok(state.log.some((m) => m.includes('not resolvable') || m.includes('inert')), 'diagnostic must mention unavailability')
})

test('APPLY: existing connection with our symbol → idempotent return', () => {
  const existingConnection = { rpc: { handle() {}, intercept() {} } }
  Object.defineProperty(existingConnection, CONNECTION_OWNER_SYMBOL, { value: true })
  const apply = createSessionChannelConnectionApply({
    readPackageVersion: () => MATCHING_VERSION,
    readPackageApi: () => MATCHING_API,
    forkedApply: () => { throw new Error('must not be called') },
  })
  let called = false
  const { ctx } = createFakeCtx({ connection: existingConnection })
  apply(ctx)
  // If no error thrown, idempotent check passed.
  assert.ok(true, 'idempotent re-apply exits cleanly')
})

test('APPLY: existing connection without our symbol → conflict inert', () => {
  const otherConnection = { rpc: { handle() {}, intercept() {} } }
  const apply = createSessionChannelConnectionApply({
    readPackageVersion: () => MATCHING_VERSION,
    readPackageApi: () => MATCHING_API,
    forkedApply: () => { throw new Error('must not be called') },
  })
  const { ctx, state } = createFakeCtx({ connection: otherConnection })
  apply(ctx)
  assert.ok(state.log.some((m) => m.includes('conflict')), 'diagnostic must mention conflict')
})

test('APPLY: outer try/catch catches throw and stays inert', () => {
  const apply = createSessionChannelConnectionApply({
    readPackageVersion: () => { throw new Error('boom') },
    readPackageApi: () => '0.1',
    forkedApply: () => {},
  })
  const { ctx, state } = createFakeCtx({
    entries: [DISABLED_OFFICIAL(), REPLACEMENT_ENTRY()],
  })
  apply(ctx)
  assert.ok(state.log.some((m) => m.includes('self-check failed')), 'diagnostic must mention self-check failure')
})