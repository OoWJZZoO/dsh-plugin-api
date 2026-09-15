/**
 * Constitution-consumer equivalence for the convergence line.
 *
 * The constitution names two real consumers whose migration is the acceptance
 * object of this repository: `dsh-read-image` and `dsh-pro-ex-ability-anchor`.
 * The anchor half already has its regression reference in the maintenance
 * baseline (`test/consumer-migration-slices.test.mjs` slice C, the plain-method
 * remote published through the official boundary); the read-image half owes an
 * equivalence evidence in *this* line, because its admission/projection path
 * was never part of that baseline. This file adds that evidence.
 *
 * | slice | original behaviour | migrated public call | surface driven | observed result |
 * |---|---|---|---|---|
 * | A | the plugin monkey-patched the official model info resolver so an image-bearing call reaches a text-only model | `llm.admissionPolicies.register` (policy) + `llm.modelInfo` (projection) | 真实挂载面（`apply`）上的官方 `apiProxy.sessions.selectModel` 边界 | the registered policy governs the official refusal inside the official scope, the public model-info entry still reads the official artifact, and disposing the policy restores the official refusal |
 * | B | the plugin's policy only covers some inputs | `llm.admissionPolicies.register` (policy) | 同一官方 `apiProxy.sessions.selectModel` 边界 | a policy that never matches leaves the official refusal exactly as the official layer decided it |
 *
 * Evidence discipline: the policy is registered through the *public*
 * facade member the consumer calls, the decision is driven through the official
 * `apiProxy` check the facade scopes, and the boundary is the official refusal
 * itself — no same-process double is injected straight into an internal
 * registry.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

function noOp() {}

/** Mount the real facade over a contract-faithful official ctx shape. */
function mountFacade(options = {}) {
  const state = { pluginApi: undefined, effects: [], listeners: [] }
  const resolverCalls = []
  const services = {
    llm: {
      async resolveModelInfo(provider, model) {
        resolverCalls.push({ provider, model })
        return { provider, id: model, name: model, inputModalities: ['text'] }
      },
      prepareCall: noOp,
      stream() { return 'official-terminal' },
      registerAdapter: noOp,
      registerConfigurableProviders: noOp,
      registerModelDiscovery: noOp,
    },
    agents: { get: noOp, list: noOp, roots: noOp },
    tools: { register: noOp, restrict: noOp, guard: noOp, get: noOp, schemas: noOp, execute: noOp, presentAs: noOp },
    sessions: { get: noOp, list: noOp, fork: noOp },
    settings: { register: noOp, describe() { return [] }, get: noOp, mutate: noOp },
    systemPrompt: { section: noOp, context: noOp, variable: noOp, tools: noOp, suppressRuntimeContext: noOp },
    web: { registerSearchProvider: noOp, registerFetchProvider: noOp, search: noOp, fetch: noOp },
    apiProxy: {
      sessions: {
        // The official admission check shape: the image-bearing path resolves
        // the model info and refuses a text-only model.
        async prompt(request) {
          const info = await services.llm.resolveModelInfo(request.payload?.provider ?? 'provider-a', request.payload?.model ?? 'model-a')
          if (info.inputModalities !== undefined && !info.inputModalities.includes('image')) {
            return { ok: false, code: 'attachment-error' }
          }
          return { ok: true, accepted: true }
        },
        async selectModel(request) {
          const info = await services.llm.resolveModelInfo(request.payload.provider, request.payload.model)
          if (info.inputModalities !== undefined && !info.inputModalities.includes('image')) {
            return { ok: false, code: 'model-unavailable' }
          }
          return { ok: true, selected: true }
        },
      },
    },
  }
  const ctx = {
    logger: { error: noOp, warn: noOp },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value; return () => {} } },
    get(name) {
      if (name === 'pluginApi') return state.pluginApi
      return services[name]
    },
    plugin(Class) { new Class(ctx) },
    effect(fn, label) { state.effects.push({ fn, label }) },
    on(name, listener) { state.listeners.push({ name, listener }); return () => {} },
    once: noOp, emit: noOp, serial: noOp, parallel: noOp, bail: noOp, waterfall: noOp,
  }
  apply(ctx)
  return { ctx, state, services, resolverCalls }
}

test('slice A: the read-image admission policy registers publicly and governs the official image refusal', async () => {
  const harness = mountFacade()
  const imageCheck = () => harness.services.apiProxy.sessions.selectModel({
    payload: { sessionId: 's1', provider: 'provider-a', model: 'model-a' },
  })

  // Baseline without the plugin: the official check refuses a text-only model
  // on the image-bearing path.
  assert.deepEqual(await imageCheck(), { ok: false, code: 'model-unavailable' })

  // The plugin's own call: one policy registered through the public member.
  const handle = harness.state.pluginApi.llm.admissionPolicies.register({
    id: 'img-policy',
    input: 'image',
    match() { return true },
    process() { return { kind: 'pass' } },
    validate() { return true },
  })
  assert.equal(typeof handle.dispose, 'function', 'registration returns the standard handle the plugin keeps')
  assert.equal(typeof handle.ownerId, 'string')
  assert.equal(typeof handle.generation, 'string')

  // The policy governs the official refusal inside the official scope...
  assert.deepEqual(await imageCheck(), { ok: true, selected: true })
  // ...and the projection half reads the official artifact through the public
  // model-info entry: the call count pins that the public member really went
  // to the official resolver (a re-implementation would leave it unmoved).
  const callsBefore = harness.resolverCalls.length
  const info = await harness.state.pluginApi.llm.modelInfo('provider-a', 'model-a')
  assert.equal(info.id, 'model-a')
  assert.equal(harness.resolverCalls.length, callsBefore + 1, 'the public model-info entry consults the official resolver')
  assert.deepEqual(harness.resolverCalls.at(-1), { provider: 'provider-a', model: 'model-a' })

  // Disposal restores the official refusal: the plugin's decision never
  // outlives its own registration.
  assert.equal(handle.dispose().ok, true)
  assert.deepEqual(await imageCheck(), { ok: false, code: 'model-unavailable' })
})

test('slice B: a policy that never matches leaves the official refusal untouched', async () => {
  const harness = mountFacade()
  const handle = harness.state.pluginApi.llm.admissionPolicies.register({
    id: 'video-policy',
    input: 'image',
    match() { return false },
    process() { return { kind: 'pass' } },
    validate() { return true },
  })
  try {
    const refused = await harness.services.apiProxy.sessions.selectModel({ payload: { sessionId: 's1', provider: 'provider-a', model: 'model-a' } })
    assert.deepEqual(refused, { ok: false, code: 'model-unavailable' }, 'no matching policy means the official decision stands')
  } finally {
    handle.dispose()
  }
})
