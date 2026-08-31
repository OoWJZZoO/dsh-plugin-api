import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

function createHarness(extraServices = {}) {
  const services = {
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() { return () => {} }, guard() { return () => {} }, get() {}, schemas() { return [] }, execute() {}, presentAs() {}, executionMode() { return 'mode' } },
    agents: { get() {}, list() {}, roots() {} },
    sessions: { get() {}, list() {}, fork() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    systemPrompt: { section() { return () => {} }, context() { return () => {} }, variable() { return () => {} }, tools() { return () => {} }, suppressRuntimeContext() { return () => {} }, renderPrompt() {}, renderContextSections() {}, renderContextSnapshot() {}, joinContextSections() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    ...extraServices,
  }
  const state = { pluginApi: undefined, effects: [], listeners: [] }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect(fn, label) { state.effects.push({ fn, label }) },
    on(name, listener) { state.listeners.push({ name, listener }); return () => {} },
    once() {}, emit() {}, serial() {}, parallel() {} , bail() {}, waterfall() {},
    model() { return { name: 'x' } },
    runtime: { name: 'test', version: '0.1.0-rc.6' },
  }
  return { ctx, state, services }
}

test('prompts.contribute returns a discriminated result with a seq handle and rejects duplicates', () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const contribute = state.pluginApi.prompts.contribute

  const first = contribute({ kind: 'tools', id: 'provider-a', provider: () => {} })
  assert.equal(first.ok, true)
  assert.equal(first.code, 'contributed')
  assert.equal(typeof first.handle.dispose, 'function')
  assert.equal(typeof first.handle.seq, 'number')
  assert.equal(first.handle.ownerId, 'caller')
  assert.ok(Object.isFrozen(first))
  assert.ok(Object.isFrozen(first.handle))

  const second = contribute({ kind: 'tools', id: 'provider-b', provider: () => {} })
  assert.equal(second.ok, true)
  assert.ok(second.handle.seq > first.handle.seq, 'seq is registration order')

  // same id while active: discriminated conflict, no latest-wins replacement
  const duplicate = contribute({ kind: 'tools', id: 'provider-a', provider: () => {} })
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.code, 'conflict')

  // invalid input: discriminated invalid-input
  const invalid = contribute({})
  assert.equal(invalid.ok, false)
  assert.equal(invalid.code, 'invalid-input')

  // disposal is idempotent and frees the id for a fresh contribution
  assert.equal(first.handle.dispose(), true)
  assert.equal(first.handle.dispose(), false)
  const revived = contribute({ kind: 'tools', id: 'provider-a', provider: () => {} })
  assert.equal(revived.ok, true)
  revived.handle.dispose()
  assert.equal(revived.handle.dispose(), false, 'dispose stays idempotent after revival')
})

test('the five prompt kinds merge into prompts.contribute', () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const c = state.pluginApi.prompts.contribute
  for (const kind of ['section', 'context', 'variable', 'tools', 'suppressRuntimeContext']) {
    const spec = kind === 'variable' ? { kind, name: 'v', provider: () => {} } : { kind, value: {} }
    const result = c(spec)
    assert.equal(result.ok, true, `${kind} contributes`)
    assert.equal(typeof result.handle.dispose, 'function')
    result.handle.dispose()
  }
})

test('resource registrations expose the merged register entry with official identity', () => {
  const { ctx, state, services } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  // tools policy and resource registration entries
  const restriction = api.tools.restrict.register({ tool: 'x' })
  assert.equal(typeof restriction, 'function', 'official disposer identity is preserved')
  assert.equal(typeof api.tools.guard.register, 'function')
  assert.equal(typeof api.tools.presentation.register, 'function')
  assert.equal(typeof api.tools.executionMode.register, 'function')
  // llm provider/model directory registrations
  assert.equal(typeof api.llm.providers.register, 'function')
  assert.equal(typeof api.llm.models.register, 'function')
  assert.equal(typeof api.llm.adapters.register, 'function')
  assert.equal(typeof api.llm.requestTransforms.register, 'function')
  // remotes.register is the renamed publish entry
  assert.equal(typeof api.remotes.register, 'function')
  // settings remote mounts through contribute
  assert.equal(typeof api.settings.remote.contribute, 'function')
  assert.equal('contribute' in api.settings, false, 'the registered entry is settings.remote.contribute only')
})

test('merged agent provider registration dispatches by spec shape', () => {
  const calls = []
  const agents = {
    get() {}, list() {}, roots() {},
    enter(...args) { calls.push(['enter', ...args]); return 'enter-ok' },
    announce(...args) { calls.push(['announce', ...args]); return 'announce-ok' },
    setFactory(...args) { calls.push(['setFactory', ...args]); return 'factory-ok' },
  }
  const { ctx, state } = createHarness({ agents })
  apply(ctx)
  const providers = state.pluginApi.agents.providers
  assert.equal(typeof providers.register, 'function')
  const entered = providers.register({ id: 'a', owner: 'o' })
  assert.equal(entered, 'enter-ok')
  assert.equal(calls[0][0], 'enter')
  const announced = providers.register({ id: 'b', announce: {} })
  assert.equal(announced, 'announce-ok')
  const factory = providers.register({ id: 'c', factory: () => {} })
  assert.equal(factory, 'factory-ok')
})

test('channel auth/redaction registrations and skills activation registers are shaped', () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  assert.equal(typeof api.sessions.channels.auth.register, 'function')
  assert.equal(typeof api.sessions.channels.auth.pairingProvider.register, 'function')
  assert.equal(typeof api.sessions.channels.redaction.register, 'function')
  assert.equal(typeof api.skills.activation.register, 'function')
  assert.equal(typeof api.skills.activation.policy.register, 'function')
  // disabled features keep the target registration shape with typed failure
  const disabled = createHarness()
  apply(disabled.ctx)
  assert.throws(() => disabled.state.pluginApi.skills.activation.register({}), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED')
  assert.throws(() => disabled.state.pluginApi.skills.activation.policy.register({}), (error) => error.code === 'PLUGIN_API_FEATURE_DISABLED')
})
test('facade-owned registration handles expose owner, generation and identity-bound dispose', async () => {
  const { createFeatureRegistry } = await import('../lib/feature-registry.js')
  const { createPluginApiService } = await import('../lib/plugin-api-service.js')
  const { LlmAdaptersOwnerConflictError } = await import('../lib/errors.js')
  const registry = createFeatureRegistry()
  const Service = createPluginApiService({ apiVersion: '0.1', registry, coreActive: true })
  const records = []
  const facet = {
    decorate(definition, owner) {
      const record = { id: definition.id, owner, generation: 1, spec: definition }
      records.push(record)
      return { status: 'ok', record }
    },
    dispose(owner, id) { return { status: 'ok' } },
    snapshot() { return Object.freeze([]) },
  }
  const fiber = { uid: 7 }
  const service = new Service({
    fiber, loader: { entries() { return [{ fiber, options: { name: 'plugin-a' } }] } },
    reflect: { provide() {} }, get() { return undefined }, effect() { return () => {} },
  })
  service._setLlmAdaptersProvider(() => facet)
  registry.mount('llmAdapters')
  const handle = service.llm.adapters.register({ id: 'adapter-1' })
  assert.ok(handle, 'facade-owned adapter registration returns a handle')
  assert.equal(records[0].owner, 'plugin-a', 'owner derives from the caller fiber')
  assert.equal(records[0].generation, 1)
  assert.equal(typeof handle.dispose, 'function')
  assert.equal(typeof handle.snapshot, 'function')
  const reclaimed = await handle.dispose()
  assert.equal(reclaimed.status, 'ok', 'dispose delegates to the facet')
})
