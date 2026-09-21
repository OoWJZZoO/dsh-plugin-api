/**
 * Observation subject forms at the facade.
 *
 * An observation entry takes one subject: the canonical options object — whose
 * field name is the one the namespace's sibling verb uses — and, where it also
 * accepts the bare subject, the two forms must be semantically equivalent. The
 * subtle case is a bare subject that is itself an object (a resource, a
 * session): it must not be mistaken for the canonical options object.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

const HANDLE_MEMBERS = ['current', 'subscribe', 'dispose', 'epoch']
const session = { id: 'session-1', firstLiveSeq: 0, requestContext: () => undefined }

function createHarness() {
  const services = {
    llm: { resolveModelInfo() {}, prepareCall() {}, stream() {}, registerAdapter() {}, registerConfigurableProviders() {}, registerModelDiscovery() {} },
    tools: { register() {}, restrict() {}, guard() {}, get() {}, schemas() {}, execute() {}, presentAs() {} },
    agents: { get() {}, list() {}, roots() {} },
    sessions: {
      get: (id) => (id === session.id ? session : undefined),
      list: () => [session],
      fork() {},
    },
    systemPrompt: { section() {}, context() {}, variable() {}, tools() {}, suppressRuntimeContext() {} },
    apiProxy: { sessions: { prompt() {}, selectModel() {} } },
    web: { registerSearchProvider() {}, registerFetchProvider() {}, search() {}, fetch() {} },
    settings: { register() {}, describe() { return [] }, get() {}, mutate() {} },
    typert: {
      register() {}, get() {}, resolve() {}, list() {}, getPackage() {}, listPackages() {}, toJSONSchema() {},
      local: { get() {}, hasSeen() {}, list() {}, subscribe() {} },
      remotes: { register() {}, get() {}, list() {}, subscribe() {} },
      lookups: { register() {}, configure() {}, get() {}, definitions() {}, keys() {}, subscribe() {} },
      contexts: { registerHost() {}, configureHost() {}, registerClient() {}, getHost() {}, getClient() {}, subscribe() {} },
    },
  }
  const state = { pluginApi: undefined }
  const ctx = {
    logger: { error() {}, warn() {} },
    reflect: { provide(name, value) { if (name === 'pluginApi') state.pluginApi = value } },
    get(name) { return name === 'pluginApi' ? state.pluginApi : services[name] },
    plugin(Class) { new Class(ctx) },
    effect() { return () => {} },
    on() { return () => {} },
    once() {}, emit() {}, serial() {}, parallel() {}, bail() {}, waterfall() {},
    model() { return { name: 'x' } },
    runtime: { name: 'test', version: '0.1.0-rc.6' },
  }
  return { ctx, state }
}

const assertHandle = (handle, label) => {
  assert.equal(Object.isFrozen(handle), true, `${label}: the handle is frozen`)
  for (const member of HANDLE_MEMBERS) {
    assert.ok(member in handle, `${label}: the handle carries ${member}`)
  }
}

test('coordination.observe treats the canonical { resource } and the bare resource as one subject', async () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  const resource = { scope: 'workspace', key: 'subject-forms' }

  // The canonical form carries the resource under the same field `acquire`
  // takes, and the trailing options ride the same subject.
  const acquired = await api.coordination.acquire({ resource, ownerId: 'owner-1', leaseMs: 60_000 })
  assert.equal(acquired.ok, true)
  const canonical = await api.coordination.observe({ resource })
  const withOptions = await api.coordination.observe({ resource, audience: 'ui' })
  // The bare form is the resource object itself — the trap being that a
  // resource is an object and must not be read as an options object.
  const bare = await api.coordination.observe(resource)

  for (const [label, handle] of [['canonical', canonical], ['with options', withOptions], ['bare', bare]]) {
    assertHandle(handle, label)
    assert.deepEqual(handle.resource, { scope: 'workspace', key: 'subject-forms' }, `${label}: the resource extension is the observed resource`)
  }
  canonical.dispose()
  withOptions.dispose()
  bare.dispose()
  await api.coordination.release(acquired.handle)
})

test('llm.routing.observe treats the canonical { session } and the bare session as one subject', () => {
  const { ctx, state } = createHarness()
  apply(ctx)
  const api = state.pluginApi
  const canonical = api.llm.routing.observe({ session })
  const bare = api.llm.routing.observe(session)
  assertHandle(canonical, 'canonical')
  assertHandle(bare, 'bare')
  canonical.dispose()
  bare.dispose()
})
