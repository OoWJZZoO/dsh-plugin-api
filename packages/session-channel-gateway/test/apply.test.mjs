import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionChannelGatewayApply } from '../lib/apply.js'
import { GATEWAY_OWNER_SYMBOL } from '../lib/shared-vocab.js'

function createFakeCtx(options = {}) {
  const services = {}
  const state = { log: [], effects: [], provides: {} }
  if (options.typertGateway !== undefined) services.typertGateway = options.typertGateway
  if (options.connection !== undefined) services.connection = options.connection
  if (options.pluginApi !== undefined) services.pluginApi = options.pluginApi
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
      provide(name, value) { state.provides[name] = value },
    },
    fiber: options.fiber ?? { entry: { options: { config: {} } } },
    loader: {
      entries() { return options.entries ?? [] },
    },
    effect(fn, label) { state.effects.push({ fn, label }) },
    on() {},
    inject(deps, cb) { cb(ctx) },
  }
  return { ctx, state }
}

const MATCHING_VERSION = '0.1.0-rc.6-0.7'
const MATCHING_API = '0.7'
const MISMATCH_VERSION = '0.1.0-rc.6-0.8'
const MISMATCH_API = '0.8'

function makeEntry(id, name, disabled) {
  return { options: { id, name }, disabled: Boolean(disabled) }
}

const OFFICIAL_ENTRY = () => makeEntry('typert-gateway', '@deepseek-ai/dsh-api-gateway', false)
const DISABLED_OFFICIAL = () => makeEntry('typert-gateway', '@deepseek-ai/dsh-api-gateway', true)
const REPLACEMENT_ENTRY = () => makeEntry('plugin-api-session-channel-gateway', '@deepseek-ai/dsh-plugin-api-session-channel-gateway', false)

test('APPLY: versionOk + official disabled → runs forked and attaches slices', () => {
  let calledForked = false
  const apply = createSessionChannelGatewayApply({
    readPackageVersion: (name) => {
      if (name.includes('dsh-api-gateway')) return '0.1.0-rc.6'
      if (name.includes('dsh-plugin-api-session-channel-gateway')) return MATCHING_VERSION
      if (name.includes('dsh-plugin-api-main')) return MATCHING_VERSION
      return undefined
    },
    readPackageApi: () => MATCHING_API,
    officialApply: undefined,
    officialAvailable: false,
    forkedApply: (ctx) => {
      calledForked = true
      const fakeGateway = { claimsEndpoint() {}, invoke() {}, dispatchRpc() {} }
      Object.defineProperty(fakeGateway, GATEWAY_OWNER_SYMBOL, { value: true })
      ctx.reflect.provide('typertGateway', fakeGateway)
    },
  })
  const { ctx, state } = createFakeCtx({
    entries: [DISABLED_OFFICIAL(), REPLACEMENT_ENTRY()],
    connection: { rpc: { handle() {} } },
  })
  apply(ctx)
  assert.ok(calledForked, 'forked apply must be called when versionOk + official disabled')
  assert.ok(state.log.some((m) => m.includes('registered')), 'diagnostic must confirm registration')
})

test('APPLY: versionOk + official enabled → leave official in place', () => {
  let called = false
  const apply = createSessionChannelGatewayApply({
    readPackageVersion: () => MATCHING_VERSION,
    readPackageApi: () => MATCHING_API,
    forkedApply: () => { called = true },
  })
  const { ctx, state } = createFakeCtx({ entries: [OFFICIAL_ENTRY()] })
  apply(ctx)
  assert.ok(!called, 'forked must NOT be called when official row is enabled')
  assert.ok(state.log.some((m) => m.includes('enabled')))
})

test('APPLY: version mismatch + official disabled + official available → fallback', () => {
  let calledOfficial = false
  const apply = createSessionChannelGatewayApply({
    readPackageVersion: (name) => {
      if (name.includes('dsh-api-gateway')) return '0.1.0-rc.6'
      if (name.includes('dsh-plugin-api-session-channel-gateway')) return MISMATCH_VERSION
      if (name.includes('dsh-plugin-api-main')) return MATCHING_VERSION
      return undefined
    },
    readPackageApi: (name) => {
      if (name.includes('dsh-plugin-api-main')) return MATCHING_API
      return MISMATCH_API
    },
    officialApply: (ctx) => { calledOfficial = true },
    officialAvailable: true,
    forkedApply: () => {},
  })
  const { ctx, state } = createFakeCtx({ entries: [DISABLED_OFFICIAL(), REPLACEMENT_ENTRY()] })
  apply(ctx)
  assert.ok(calledOfficial, 'official fallback must be called on version mismatch')
  assert.ok(state.log.some((m) => m.includes('fallback')))
})

test('APPLY: existing gateway with our symbol → idempotent', () => {
  const existing = { claimsEndpoint() {}, invoke() {}, dispatchRpc() {} }
  Object.defineProperty(existing, GATEWAY_OWNER_SYMBOL, { value: true })
  const apply = createSessionChannelGatewayApply({
    readPackageVersion: () => MATCHING_VERSION,
    readPackageApi: () => MATCHING_API,
    forkedApply: () => { throw new Error('must not be called') },
  })
  const { ctx } = createFakeCtx({ typertGateway: existing })
  apply(ctx)
  assert.ok(true, 'idempotent return')
})

test('APPLY: existing gateway without our symbol → conflict inert', () => {
  const other = { claimsEndpoint() {}, invoke() {}, dispatchRpc() {} }
  const apply = createSessionChannelGatewayApply({
    readPackageVersion: () => MATCHING_VERSION,
    readPackageApi: () => MATCHING_API,
    forkedApply: () => { throw new Error('must not be called') },
  })
  const { ctx, state } = createFakeCtx({ typertGateway: other })
  apply(ctx)
  assert.ok(state.log.some((m) => m.includes('conflict')))
})

test('APPLY: outer try/catch stays inert', () => {
  const apply = createSessionChannelGatewayApply({
    readPackageVersion: () => { throw new Error('boom') },
    readPackageApi: () => '0.7',
    forkedApply: () => {},
  })
  const { ctx, state } = createFakeCtx({ entries: [DISABLED_OFFICIAL(), REPLACEMENT_ENTRY()] })
  apply(ctx)
  assert.ok(state.log.some((m) => m.includes('self-check failed')))
})