/**
 * Client capability self-description tests.
 *
 * A capability must report the real state of its authority/carrier/source, not
 * the mere existence of a facade object: pending official leaves, a missing
 * attention runtime and an unwired request carrier are all "unavailable" even
 * though their facade shapes are always published.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/client-runtime.js'
import { CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS } from '../lib/client-official-passthrough.js'
import { PluginApiCapabilityUnavailableError } from '../lib/errors.js'
import { bootFixture, settleAll } from './official-passthrough-fixture.mjs'

const DESCRIPTORS = CLIENT_OFFICIAL_PASSTHROUGH_DESCRIPTORS

test('services reports the real leaf state: pending -> unavailable, partial -> degraded, all -> active', async () => {
  const { ctx, loader } = bootFixture({ deferred: true })
  const dispose = apply(ctx)
  const api = ctx.get('pluginApi')

  // Pending shells keep their facade shape, so object existence would claim
  // an active capability that cannot serve a single call.
  assert.equal(api.capabilities.get('services').status, 'unavailable')
  assert.throws(() => api.capabilities.require(['services']), PluginApiCapabilityUnavailableError)

  for (const descriptor of DESCRIPTORS.slice(0, 3)) loader.resolvePending(descriptor.moduleId)
  await settleAll()
  assert.equal(api.capabilities.get('services').status, 'degraded')
  assert.equal(api.capabilities.require(['services']), true, 'degraded is a real partial state, not a hidden failure')

  for (const descriptor of DESCRIPTORS.slice(3)) loader.resolvePending(descriptor.moduleId)
  await settleAll()
  assert.equal(api.capabilities.get('services').status, 'active')
  await dispose()
})

test('a degraded or unavailable services capability never drags unrelated faces down', async () => {
  const { ctx, loader } = bootFixture({ deferred: true })
  const dispose = apply(ctx)
  const api = ctx.get('pluginApi')
  for (const descriptor of DESCRIPTORS.slice(0, 2)) loader.resolvePending(descriptor.moduleId)
  await settleAll()
  assert.equal(api.capabilities.get('services').status, 'degraded')
  // Independent faces are unaffected: isolation, not aggregate contagion.
  assert.equal(api.capabilities.get('sessions').status, 'active')
  assert.equal(api.capabilities.get('codec').status, 'active')
  assert.equal(api.capabilities.get('slots').status, 'active')
  await dispose()
})

test('attention without an installed runtime is unavailable, never an active shell', async () => {
  const { ctx, loader } = bootFixture({ deferred: true })
  const dispose = apply(ctx)
  const api = ctx.get('pluginApi')
  assert.equal(api.capabilities.get('attention').status, 'unavailable')
  assert.throws(() => api.capabilities.require(['attention']), PluginApiCapabilityUnavailableError)
  // The shape is still published (typed-failing), so consumers keep compiling.
  assert.equal(typeof api.attention.contribute, 'function')
  await dispose()
})

test('sessions reports the request carrier state instead of the facade shape', async () => {
  const { ctx, loader } = bootFixture({ deferred: true })
  const dispose = apply(ctx)
  const api = ctx.get('pluginApi')
  assert.equal(api.capabilities.get('sessions').status, 'active', 'the fixture provides an rpc carrier')
  await dispose()
})
