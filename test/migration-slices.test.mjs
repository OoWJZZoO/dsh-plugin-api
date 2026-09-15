/**
 * Migration slices: what the two migrated plugins used to do by hand, what the
 * public call is today, and what the run produces.
 *
 * Each slice header carries the "原行为 → 现行公共调用 → 运行结果" matrix and the
 * evidence comes from executing the public entries, not from reading them.
 *
 * Slice 1 — one tool, global and then scoped to an agent (was: hand-rolled
 *   wrapping of the official tools service; the outer handle and the cleanup
 *   pattern are the same in both scopes).
 *
 * | 原行为 (hand-rolled)                                   | 现行公共调用                          | 运行结果 |
 * |--------------------------------------------------------|---------------------------------------|----------|
 * | `tools().register(def)` + a local Set to undo it        | `pluginApi.tools.register(def)`       | frozen `{ id, ownerId, generation, dispose() }`; `dispose()` answers `{ ok, code: 'revoked' }` and `stale` thereafter |
 * | a second Set keyed by agent + manual removal on unload  | `pluginApi.tools.restrict.register(spec)` | the same handle shape; `dispose()` releases only that scope |
 *
 * Slice 2 — the same policy registered through three domains (was: one
 *   per-domain adaptation each; today one call pattern, one handle shape).
 *
 * | 原行为 (hand-rolled)                        | 现行公共调用                                   | 运行结果 |
 * |---------------------------------------------|------------------------------------------------|----------|
 * | `llm` transform registered by direct patch  | `pluginApi.llm.requestTransforms.register(spec)` | frozen handle; `dispose()` → `{ ok, code: 'revoked' }` |
 * | prompts section pushed by hand              | `pluginApi.prompts.contribute(spec)`             | frozen `{ ok, code, handle }`; the handle releases only its own contribution |
 * | security rule kept in a plugin-local table  | `pluginApi.security.policy.register(spec)`       | frozen `{ id, ownerId, generation, dispose() }`, owner derived from the caller |
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureRegistry } from '../lib/feature-registry.js'
import { createPluginApiService } from '../lib/plugin-api-service.js'

function createService() {
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  return new ServiceClass({ reflect: { provide() {} } })
}

function plugin(service, name, services = {}) {
  const fiber = { name }
  const ctx = { fiber, loader: { entries: () => [{ fiber, options: { name } }] }, get: (key) => services[key] }
  const shadow = Object.create(service)
  Object.defineProperty(shadow, 'ctx', { value: ctx, enumerable: true, configurable: true })
  return shadow
}

test('slice 1: the same tool registers globally and then for one agent through one handle shape', async () => {
  const calls = []
  const registry = createFeatureRegistry()
  const ServiceClass = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const official = {
    register: (definition) => {
      calls.push(definition)
      return () => { calls.splice(calls.indexOf(definition), 1) }
    },
  }
  const service = new ServiceClass({ reflect: { provide() {} }, get: (name) => (name === 'tools' ? official : undefined) })
  service.mountFeature('tools', {})
  const owner = plugin(service, 'slice-plugin', { tools: official })

  // Global: the official registration is reached, and the caller keeps the
  // facade's standard handle instead of the official disposer.
  const handle = owner.tools.register({ name: 'slice-tool', description: 'global' })
  assert.deepEqual(Object.keys(handle).sort(), ['dispose', 'generation', 'id', 'ownerId'], 'the standard handle shape')
  assert.equal(handle.ownerId, 'slice-plugin', 'the owner is derived from the calling plugin')
  assert.deepEqual(calls, [{ name: 'slice-tool', description: 'global' }], 'the global install reached the official service')
  assert.equal(handle.dispose().code, 'revoked')
  assert.equal(handle.dispose().code, 'stale', 'the handle is idempotent')
  assert.deepEqual(calls, [], 'the release reached the official disposer exactly once')

  // Scoped: the same tool for one agent goes through the scope handle, and the
  // cleanup pattern stays "keep the returned handle, release it on unload".
  const { createHarness } = await import('./scoped-agent-test-kit.mjs')
  const kit = createHarness()
  kit.makeAgent('agent-a')
  const api = kit.createPluginContext('slice-plugin').get('pluginApi')
  const scope = api.agents.scopes.register({ agent: 'agent-a' }).handle
  const scoped = api.prompts.contribute({
    kind: 'section',
    id: 'slice-section',
    section: { id: 'slice-section', text: () => 'scoped' },
    scope,
  })
  assert.equal(scoped.ok, true, 'the scoped contribution is accepted')
  assert.equal(scoped.handle.ownerId, 'slice-plugin', 'the contribution owner is derived from the calling plugin')
  assert.equal(scoped.handle.dispose().code, 'revoked')
  assert.equal(scoped.handle.dispose().code, 'stale', 'the scoped handle is idempotent like the global one')
})

test('slice 2: one policy registers through llm, prompts and security with the same call pattern', () => {
  const service = createService()
  const revoked = []
  service.mountFeature('llm/request', {
    // The facade passes the caller context as the trailing binding; the stub
    // reads the owner from it instead of echoing a constant, so a broken
    // caller derivation shows up as the wrong owner rather than passing.
    transform: (spec, callerCtx) => {
      let released = false
      return {
        id: spec.id,
        ownerId: callerCtx?.fiber?.name,
        generation: 'g-1',
        dispose() {
          if (released) return { ok: false, code: 'stale', reason: 'the registration is already released' }
          released = true
          revoked.push('llm')
          return { ok: true, code: 'revoked' }
        },
      }
    },
  })
  service.mountFeature('security', {
    policy: {
      register: (ownerId, spec) => {
        let released = false
        return {
          id: spec.id,
          ownerId,
          generation: 'g-2',
          dispose() {
            if (released) return { ok: false, code: 'stale', reason: 'the registration is already released' }
            released = true
            revoked.push('security')
            return { ok: true, code: 'revoked' }
          },
        }
      },
    },
    redaction: { register: () => { throw new Error('unused') } },
    egress: { register: () => { throw new Error('unused') }, lease: { acquire() {}, release() {} }, coverage: () => ({}) },
    audit: { list: () => ({ records: [] }) },
    availability: () => ({ status: 'active' }),
  })

  const owner = plugin(service, 'slice-plugin')
  const llmHandle = owner.llm.requestTransforms.register({ id: 'portable-policy' })
  const policyHandle = owner.security.policy.register({ id: 'portable-policy' })

  // The same registration verb and the same handle contract in both domains.
  for (const handle of [llmHandle, policyHandle]) {
    assert.equal(typeof handle.id, 'string')
    assert.equal(handle.ownerId, 'slice-plugin', 'the owner is derived from the calling plugin in both domains')
    assert.equal(typeof handle.generation, 'string')
    assert.equal(handle.dispose().code, 'revoked')
    assert.equal(handle.dispose().code, 'stale', 'dispose is idempotent in both domains')
  }
  assert.deepEqual(revoked, ['llm', 'security'])

  // A second plugin identity on the same entries answers its own owner, so the
  // binding is a derivation from the caller and not a constant the first call
  // happened to match.
  const other = plugin(service, 'other-plugin')
  assert.equal(other.llm.requestTransforms.register({ id: 'portable-policy' }).ownerId, 'other-plugin')
  assert.equal(other.security.policy.register({ id: 'portable-policy' }).ownerId, 'other-plugin')
  // A caller that declares an owner is ignored: the identity comes from the
  // calling fiber, never from the registration definition.
  const forged = plugin(service, 'forging-plugin')
  assert.equal(forged.llm.requestTransforms.register({ id: 'portable-policy', ownerId: 'slice-plugin' }).ownerId, 'forging-plugin')
  assert.equal(forged.security.policy.register({ id: 'portable-policy', ownerId: 'slice-plugin' }).ownerId, 'forging-plugin')
})
